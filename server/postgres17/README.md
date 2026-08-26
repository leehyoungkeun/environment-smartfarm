# postgres17 — 주 데이터베이스 재구축

서버 `smartfarm-server`(192.168.0.24) 의 `/home/afocus/postgres17/` 에 배포된다.
`monitoring/` 과 같은 목적의 사본이다 — **서버가 날아가도 여기서 되살릴 수 있게** 둔다.

2026-08-26 이전까지 이 컨테이너만 compose 없이 손으로 띄운 상태였다.
서버의 컨테이너 12개 중 유일하게 재현 근거가 없는 것이 하필 주 데이터베이스였다.

## 재구축

```bash
mkdir -p /home/afocus/postgres17 && cd /home/afocus/postgres17
# docker-compose.yml 배치 후, 비밀값은 git 에 없으므로 직접 만든다
cat > .env <<'ENV'
POSTGRES_USER=smartfarm
POSTGRES_DB=smartfarm_db
POSTGRES_PASSWORD=...
ENV
chmod 600 .env

docker compose up -d
docker exec postgres17 pg_isready -U smartfarm -d smartfarm_db
```

데이터는 `/db/postgresql/data`(전용 194GB 파티션) 바인드 마운트라 컨테이너를
지워도 남는다. 완전 소실 시에는 `/storage/backups/smartfarm/` 또는 NAS 의
일일 덤프에서 복원한다.

## 주의

- **`container_name: postgres17` 을 바꾸지 말 것.** `/usr/local/bin/backup-smartfarm.sh`
  가 이 이름으로 `docker exec` 해서 덤프한다. 이름이 바뀌면 매일 03시 백업이
  **조용히** 실패한다.
- **포트를 `0.0.0.0` 으로 되돌리지 말 것.** 2026-08-26 점검에서 LAN·테일넷 어디서나
  5432 에 닿는 상태였고 `ssl=off` 라 평문이었다. 실제 접속자는 호스트 백엔드
  하나뿐이라 `127.0.0.1` 로 좁혔다. 원격 접속이 필요해지면 테일넷 주소를
  명시적으로 추가한다(`100.71.181.121:5432:5432`).
- **정지는 `docker stop -t 60`.** compose 에 `stop_grace_period: 60s` 로 박아뒀지만
  수동 조작 시에도 체크포인트 시간을 줘야 한다.
