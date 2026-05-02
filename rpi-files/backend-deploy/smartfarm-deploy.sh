#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# smartfarm-deploy.sh — production-grade deploy 자동화 (2026-05-02)
# ════════════════════════════════════════════════════════════════════
# 특징: atomic + idempotent + locked + logged + multi-layer health + rollback
#
# 실행 모드:
#   /usr/local/bin/smartfarm-deploy.sh           — 정상 deploy
#   DRY_RUN=1 /usr/local/bin/smartfarm-deploy.sh — 시뮬레이션 (실제 변경 X)
#
# Exit codes:
#   0  — 정상 (deploy 성공 또는 NOOP)
#   1  — deploy 실패 (rollback 됨)
#   2  — 환경/권한 에러
# ════════════════════════════════════════════════════════════════════

set -uo pipefail

# ── 설정 (afocus home dir 사용 — root 권한 회피) ─────────────
# REPO_ROOT: git 작업 (모노레포 루트)
# BACKEND_DIR: npm install / prisma / pm2 작업 (backend 서브디렉토리)
REPO_ROOT="/home/afocus/smartfarm"
BACKEND_DIR="$REPO_ROOT/backend"
BRANCH="main"
PM2_NAME="smartfarm-backend"
HEALTH_URL="http://localhost:3000/health"

LOCK_FILE="/home/afocus/.smartfarm-deploy.lock"
LOG_DIR="/home/afocus/smartfarm/logs"
LOG_FILE="$LOG_DIR/deploy.log"
STATE_DIR="/home/afocus/smartfarm/.deploy-state"
LAST_GOOD_FILE="$STATE_DIR/last_known_good_commit"

DRY_RUN="${DRY_RUN:-0}"
HEALTH_TIMEOUT_SEC=5
HEALTH_LAZY_WAIT_SEC=5
INSTALL_TIMEOUT_SEC=120

# ── 초기 디렉토리 ─────────────
mkdir -p "$LOG_DIR" "$STATE_DIR" 2>/dev/null

# ── 자체 로그 회전 (sudo logrotate 회피) ─────────────
# 10MB 초과 시 .1 로 회전, .1 → .2 백업 (최대 .2 까지 보관)
LOG_MAX_BYTES=$((10 * 1024 * 1024))
if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$LOG_SIZE" -gt "$LOG_MAX_BYTES" ]; then
        [ -f "$LOG_FILE.1" ] && mv -f "$LOG_FILE.1" "$LOG_FILE.2" 2>/dev/null
        mv -f "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null
    fi
fi

# ── 로그 함수 ─────────────
log() {
    local ts="$(date '+%Y-%m-%d %H:%M:%S')"
    local msg="[$ts] $1"
    echo "$msg" >> "$LOG_FILE" 2>/dev/null
    if [ "$DRY_RUN" = "1" ]; then echo "$msg"; fi
}

# 명령 실행 wrapper — DRY_RUN 시 echo 만
run() {
    if [ "$DRY_RUN" = "1" ]; then
        echo "  [DRY-RUN] $*"
        return 0
    fi
    "$@"
}

# ── Lock 획득 (동시 실행 방지) ─────────────
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    log "⏸  다른 deploy 실행 중 — skip"
    exit 0
fi
trap 'flock -u 200' EXIT

# ── 환경 검증 ─────────────
if [ ! -d "$REPO_ROOT/.git" ]; then
    log "❌ repo 없음: $REPO_ROOT"
    exit 2
fi
if [ ! -d "$BACKEND_DIR" ]; then
    log "❌ backend 없음: $BACKEND_DIR"
    exit 2
fi

cd "$REPO_ROOT" || { log "❌ cd $REPO_ROOT 실패"; exit 2; }

# ── git fetch ─────────────
if ! git fetch origin "$BRANCH" 2>>"$LOG_FILE"; then
    log "❌ git fetch 실패 (network 또는 credential)"
    exit 2
fi

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
    # NOOP catch-up: 외부 경로(옛 webhook 등)로 동기화된 경우 last_known_good 자동 정합화
    EXISTING_LKG=$(cat "$LAST_GOOD_FILE" 2>/dev/null || echo "")
    if [ "$EXISTING_LKG" != "$LOCAL" ]; then
        if [ "$DRY_RUN" = "1" ]; then
            log "✓ NOOP: 이미 최신 ($LOCAL) — [DRY-RUN] last_known_good catch-up 예정 ($EXISTING_LKG → $LOCAL)"
        else
            echo "$LOCAL" > "$LAST_GOOD_FILE" 2>/dev/null
            log "✓ NOOP: 이미 최신 ($LOCAL) — last_known_good catch-up 갱신"
        fi
    else
        log "✓ NOOP: 이미 최신 ($LOCAL)"
    fi
    exit 0
fi

# ── Deploy 시작 ─────────────
PREV_COMMIT="$LOCAL"
SHORT_PREV="${PREV_COMMIT:0:7}"
SHORT_NEW="${REMOTE:0:7}"
log "🚀 Deploy 시작: $SHORT_PREV → $SHORT_NEW"

# 1. atomic git reset
if ! run git reset --hard "$REMOTE" 2>>"$LOG_FILE"; then
    log "❌ git reset --hard 실패"
    exit 1
fi
log "  ✓ git reset --hard $SHORT_NEW"

# 2. package-lock 변경 시만 npm install (backend 디렉토리에서 수행)
NEED_INSTALL=0
if [ "$DRY_RUN" = "1" ]; then
    NEED_INSTALL=1
elif ! git diff --quiet "$PREV_COMMIT" "$REMOTE" -- backend/package-lock.json 2>/dev/null; then
    NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" = "1" ]; then
    log "  📦 backend/package-lock 변경 — npm install"
    if ! run bash -c "cd '$BACKEND_DIR' && timeout $INSTALL_TIMEOUT_SEC npm install --omit=dev" 2>>"$LOG_FILE"; then
        log "  ❌ npm install 실패 — rollback to $SHORT_PREV"
        run git reset --hard "$PREV_COMMIT" 2>>"$LOG_FILE"
        log "  ↩️ Rollback 완료 (npm 단계)"
        exit 1
    fi
    log "  ✓ npm install 완료"
else
    log "  ⏭  backend/package-lock 동일 — npm install skip"
fi

# 3. prisma generate (backend 디렉토리에서 수행, 실패해도 진행)
run bash -c "cd '$BACKEND_DIR' && npx prisma generate" >> "$LOG_FILE" 2>&1 || log "  ⚠️ prisma generate 경고 (무시)"

# 4. PM2 reload (graceful) → 실패 시 restart
RELOAD_OK=0
if run pm2 reload "$PM2_NAME" >> "$LOG_FILE" 2>&1; then
    RELOAD_OK=1
    log "  ✓ pm2 reload (graceful)"
else
    log "  ⚠️ pm2 reload 실패 — restart 시도"
    if run pm2 restart "$PM2_NAME" >> "$LOG_FILE" 2>&1; then
        RELOAD_OK=1
        log "  ✓ pm2 restart"
    fi
fi

if [ "$RELOAD_OK" = "0" ]; then
    log "  ❌ pm2 reload/restart 모두 실패 — rollback"
    run git reset --hard "$PREV_COMMIT" 2>>"$LOG_FILE"
    run pm2 restart "$PM2_NAME" >> "$LOG_FILE" 2>&1
    log "  ↩️ Rollback (pm2 단계)"
    exit 1
fi

# 5. Multi-layer health check
HEALTH_FAIL=""

if [ "$DRY_RUN" = "1" ]; then
    log "  🔍 [DRY-RUN] Health check skip"
else
    sleep "$HEALTH_TIMEOUT_SEC"

    # Layer 1: HTTP 200
    HEALTH_RESP=$(curl -s -m 5 -w "\n%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "$'\n'000")
    HTTP_CODE=$(echo "$HEALTH_RESP" | tail -n1)
    HEALTH_BODY=$(echo "$HEALTH_RESP" | sed '$d')

    if [ "$HTTP_CODE" != "200" ]; then
        HEALTH_FAIL="L1: HTTP $HTTP_CODE"
    fi

    # Layer 2: prisma connected
    if [ -z "$HEALTH_FAIL" ]; then
        if echo "$HEALTH_BODY" | grep -q '"prisma":"connected"'; then
            : # OK
        else
            HEALTH_FAIL="L2: prisma not connected"
        fi
    fi

    # Layer 3: 5초 후 또 200 (lazy crash 회피)
    if [ -z "$HEALTH_FAIL" ]; then
        sleep "$HEALTH_LAZY_WAIT_SEC"
        HTTP_CODE2=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
        if [ "$HTTP_CODE2" != "200" ]; then
            HEALTH_FAIL="L3: lazy crash (HTTP $HTTP_CODE2)"
        fi
    fi
fi

# 6. Rollback if health failed
if [ -n "$HEALTH_FAIL" ]; then
    log "  ❌ Health 실패: $HEALTH_FAIL — rollback to $SHORT_PREV"
    run git reset --hard "$PREV_COMMIT" 2>>"$LOG_FILE"
    if [ "$NEED_INSTALL" = "1" ]; then
        run bash -c "cd '$BACKEND_DIR' && timeout $INSTALL_TIMEOUT_SEC npm install --omit=dev" >> "$LOG_FILE" 2>&1
    fi
    run bash -c "cd '$BACKEND_DIR' && npx prisma generate" >> "$LOG_FILE" 2>&1 || true
    run pm2 restart "$PM2_NAME" >> "$LOG_FILE" 2>&1
    log "  ↩️ Rollback 완료: last_known_good=$SHORT_PREV 유지"
    log "  📢 ALERT 필요: deploy 실패 ($SHORT_NEW) — 코드 점검 필요"
    exit 1
fi

# 7. Success — last_known_good 갱신
echo "$REMOTE" > "$LAST_GOOD_FILE" 2>/dev/null
log "✅ Deploy 성공: $SHORT_PREV → $SHORT_NEW"
log "   last_known_good 갱신: $SHORT_NEW"

exit 0
