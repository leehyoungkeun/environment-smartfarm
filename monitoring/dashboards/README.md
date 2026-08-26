# Grafana 대시보드

`https://grafana.smartgreen.kr` 에 등록되어 있다. 이 폴더는 **서버가 날아가도
되살릴 수 있게** 두는 사본이다 (`monitoring/` 의 다른 파일들과 같은 목적).

## 두 화면

| 화면 | uid | 용도 |
|---|---|---|
| 농장 개요 | `smartfarm-overview` | 전 농장을 한 줄씩. 이상 있는 곳만 색으로 표시 |
| 농장 운영 현황 | `smartfarm-ops` | 한 농장의 상세 추이. 개요에서 농장명을 누르면 이동 |

농장이 늘어나면 상세 화면 하나로는 선이 겹쳐 못 읽는다. 개요에서 이상을
찾고 상세로 들어가는 구성이다.

## 왜 Grafana 인가

Prometheus·Alertmanager UI 는 `127.0.0.1` 전용이고 **인증이 없다.**
터널에 붙이면 지표가 그대로 공개되므로, 이미 인증이 걸린 Grafana 로 모았다.
진단이 필요하면 SSH 터널을 쓴다.

```bash
ssh -L 9090:localhost:9090 -L 9093:localhost:9093 afocus@192.168.0.24
# http://localhost:9090  Prometheus
# http://localhost:9093  Alertmanager
```

## 복원

```bash
GFPW=$(grep -oP '^GF_PASSWORD=\K.*' /home/afocus/monitoring/.env)
for f in farm-overview.json farm-detail.json; do
  curl -s -u "admin:$GFPW" -X POST http://localhost:3030/api/dashboards/db \
    -H 'Content-Type: application/json' --data-binary @$f
done
```

## 주의

- **데이터소스 uid 가 박혀 있다** (`bflmwho4bsnb4c`). Prometheus 데이터소스를
  다시 만들면 uid 가 바뀌므로 JSON 안의 값을 함께 고쳐야 한다.
- 표에 나오는 농장은 `farms.status='active'` 인 곳뿐이다. 운영 중지 농장은
  상태만 바꾸면 자동으로 빠진다 — 대시보드는 손댈 필요 없다.
- 농장·하우스 드롭다운은 지표에서 자동으로 채워진다. 농장이 추가되면
  저절로 목록에 나타난다.
