# 모니터링 / 알림 스택

서버 `smartfarm-server`(192.168.0.24) 의 `/home/afocus/monitoring/` 에 배포된다.
이 디렉토리는 그 사본이다 — **서버가 날아가도 여기서 재구축할 수 있게** 두는 것이 목적이다.

## 왜 만들었나

2026-08-25 전체 점검에서 감지 실패 3건이 드러났다. 셋 다 로그에는 명확히 찍혀
있었으나 보는 사람이 없었다.

| 사고 | 미탐지 기간 |
|---|---|
| AWS 계정 정지로 MQTT 단절 | 3주 |
| farm_0006 MQTT 플래핑 32만회 | 3.5개월 |
| RPi 전원 꺼짐 (센서 9일 공백) | 9일 |

Prometheus·Grafana·Loki 는 4주째 돌고 있었지만 **알림 규칙 0개, Alertmanager 없음**
이었다. 수집만 하고 아무도 안 보는 상태였다.

## 구조

```
Prometheus (30초 평가, 규칙 7개)
     ↓
Alertmanager  ─┬─→ Discord          즉시 푸시 — 사람이 본다
               └─→ 백엔드 webhook → alerts 테이블 (이력 + 카카오 확장 지점)
```

알림 **채널을 Alertmanager 설정에서 분리**했다. 카카오 알림톡처럼 심사가 필요한
채널은 백엔드 `/internal/alert-webhook` 핸들러에만 추가하면 되고,
Alertmanager 설정은 다시 건드리지 않는다.

## 파일

| 파일 | 역할 |
|---|---|
| `docker-compose.yml` | 전체 스택 (GlitchTip / Prometheus / Alertmanager / Loki / Grafana / node-exporter) |
| `prometheus.yml` | 스크레이프 대상 + alerting/rule_files |
| `alert_rules.yml` | 알림 규칙 7개 |
| `alertmanager.yml` | 라우팅 + Discord/webhook 수신자 |
| `.env` | GlitchTip·Grafana 비밀값 — **gitignore** |
| `discord_webhook_url` | Discord 웹훅 URL — **gitignore** |

## 재구축 절차

```bash
# 1) 파일 배치
scp monitoring/*.yml afocus@<server>:/home/afocus/monitoring/

# 2) 비밀값 2개 생성 (git 에 없다)
cd /home/afocus/monitoring
cat > .env <<'EOF'
GT_DB_PASSWORD=...
GT_SECRET=...
GF_PASSWORD=...
EOF

#    Discord 채널 설정 → 연동 → 웹후크 → URL 복사
echo 'https://discord.com/api/webhooks/...' > discord_webhook_url
chmod 644 discord_webhook_url      # 컨테이너가 nobody 로 실행되므로 600 이면 permission denied

# 3) 기동
docker compose up -d

# 4) 확인
curl -s localhost:9090/api/v1/rules      | grep -c alertname   # 7
curl -s localhost:9090/api/v1/targets    | grep -c '"up"'      # 3
curl -s localhost:9093/-/ready                                 # OK
```

## 알림 규칙

| 규칙 | 조건 | 대응하는 사고 |
|---|---|---|
| `MqttDisconnected` | `smartfarm_mqtt_connected == 0` 5분 | AWS 단절 (3주 → 5분) |
| `SensorDataStalled` | 센서 무수신 15분 | RPi 꺼짐 (9일 → 20분) |
| `RelayStatusStalled` | 릴레이 상태 무갱신 10분 | MQTT 플래핑 (3.5개월 → 15분) |
| `TargetDown` | `up == 0` 10분 | 호스트 다운 |
| `DiskSpaceLow` / `Critical` | 여유 15% / 5% | 디스크 |
| `RpiHighTemperature` | 75°C 15분 | 과열·스로틀링 |

지표 3종(`smartfarm_mqtt_connected`, `smartfarm_sensor_last_seen_seconds`,
`smartfarm_relay_status_age_seconds`)은 백엔드 `src/app.js` 가 `/metrics` 로 노출한다.

## 함정 (겪은 것들)

- **`discord_webhook_url` 은 644 여야 한다.** 컨테이너가 `nobody` 로 실행되어
  600 이면 `permission denied: read webhook_url_file` 로 전송이 실패한다.
- **Alertmanager 이미지에 tzdata 가 없다.** `TZ: Asia/Seoul` 만으로는 부족하고
  `/usr/share/zoneinfo` 를 마운트해야 알림 시각이 KST 로 나온다.
- **`prometheus.yml` 변경 후 `curl -X POST localhost:9090/-/reload`** 가 필요하다.
  컨테이너 재시작만으로는 `alerting:` 섹션이 반영되지 않은 사례가 있었다.
- **farm_0006 은 스크레이프 대상에서 제외**했다. 테스트기라 node_exporter 를
  설치하지 않았고, 그대로 두면 `TargetDown` 이 영구 발동한다. 영구 발동 알림은
  알림 피로를 만들어 정작 진짜 사고를 무시하게 만든다.
