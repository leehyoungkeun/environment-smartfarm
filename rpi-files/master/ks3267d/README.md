# ks3267d — KS X 3267 마스터 드라이버 데몬

온실 통합 제어기(마스터) 역할의 표준 노드 드라이버. **별도 RS485 포트**에서 표준 노드만 상대하고,
기존 Waveshare/XY-MD02 경로(`/dev/smartfarm-485`, NR modbus 노드)는 건드리지 않는다.
NR 은 이 데몬의 로컬 REST 를 부르는 오케스트레이터다.

```
ks3267core/   ksmap.py(부속서 A 주소 공식·코드표) · codec.py(CDAB)   ← 시뮬레이터와 공유, 단일 출처
transport.py  pymodbus 래퍼 (RTU/TCP) · 예외응답/타임아웃 구분 · 프레임 링버퍼(증적)
discovery.py  6.1.1/6.1.2 탐색 → 디폴트맵 판정 → 디바이스 목록 (스코프 밖은 supported=false 로 명시)
master.py     폴링·명령(FC16 + opid)·readback · 버스 단일 락 · 이벤트
api.py        127.0.0.1:3002 REST (stdlib)
ks3267d.py    메인 (pm2 관리)
test_driver.py  유닛 18 (시리얼 없이, 시뮬레이터 노드 모델을 FakeTransport 로)
e2e_daemon.py   E2E (시뮬레이터 TCP 상대, REST 경유) — P6 자가시험 뼈대
```

## 실행

```bash
pip install -r requirements.txt
python -m unittest -v                                     # 유닛
python ks3267d.py --tcp 127.0.0.1:5020 --units 1          # 시뮬레이터 상대 (개발)
python ks3267d.py --port /dev/smartfarm-485-std --units 1,2 --api-port 3002 \
                  --nr-url http://127.0.0.1:1880/api/ks3267/status   # RPi 실선
```

옵션: `--baud 9600` · `--poll 2` · `--timeout 1` · `--retries 0`(기본 — 버스 문제를 재시도로 가리지 않는다) · `--state-dir`(opid 영속).

## REST

| 메서드 | 경로 | 내용 |
|---|---|---|
| GET | `/health` | 전송·등록 노드·통계 |
| GET | `/discover?unit=N` | 탐색+등록. 응답 없음 → `timeout`, 예외 → `exception` 코드 (숨기지 않음) |
| GET | `/nodes` | 노드 서술자 (디바이스별 상태/명령 레지스터 포함) |
| GET | `/status[?unit=N]` | 마지막 폴링 (센서 값·상태, 구동기 opid·상태·남은시간) |
| POST | `/command` | `{unit, kind:"switch"|"opener", n, op, seconds}` → `{ok, accepted, opid, status_name, remain}` |
| GET | `/frames?n=50` | 최근 TX/RX hex (진단 UI·시험 증적) |
| GET | `/events?n=50` | 탐색·명령·예외·타임아웃 이벤트 |

op: 스위치 `on|off|timed_on` / 개폐기 `open|close|stop|timed_open|timed_close`. 레벨2(`set_position` 등)는
**로컬에서 거부**(버스에 안 나감) — 디폴트맵·레벨1 스코프 선언과 일치.

## RPi 배포

1. 두 번째 USB-485(절연형 권장) 꽂고 udev 규칙 `etc/99-smartfarm-485-std.rules` 를 `/etc/udev/rules.d/` 에
   (ATTRS{serial} 또는 KERNELS 로 기존 `/dev/smartfarm-485` 와 구분) → `/dev/smartfarm-485-std`
2. `pip3 install -r requirements.txt` (pymodbus 3.9+ — **3.13 API 기준**, 구형 datastore 미사용)
3. pm2: `pm2 start ks3267d.py --name ks3267d --interpreter python3 -- --port /dev/smartfarm-485-std --units 1,2`
   (ecosystem 에 넣을 때 `cwd` 는 이 디렉터리, D16 데몬 항목과 같은 형태)
4. NR: `/api/ks3267/status` 수신 엔드포인트 + `execute_control` 의 `protocol==='ks3267'` 분기 (P3)

## 개발 중 배운 함정 (Windows)

- 준비 확인은 raw socket connect+close 로 하지 말 것 — pymodbus 서버(asyncio)의 accept 가 깨진다. 모드버스 요청으로 확인.
- 5040 은 `svchost` 가 점유. 예약 범위 `netsh interface ipv4 show excludedportrange protocol=tcp` 확인.
- pymodbus 클라이언트 키워드: `device_id=`(slave= 아님), `count=`.
