import json, subprocess, sys

HOSTS = ['farm-0001', 'farm-0006']

def run_ssh(host, cmd, timeout=10):
    try:
        r = subprocess.run(['ssh', '-o', f'ConnectTimeout={timeout}', '-o', 'BatchMode=yes',
                            f'lhk@{host}', cmd], capture_output=True, text=True, timeout=timeout+5)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None

print('═══ RPi clientId 표준 형식 + MQTT 안정성 점검 ═══\n')
for host in HOSTS:
    farm_id = host.replace('-', '_')
    print(f'{host}: ', end='', flush=True)

    # Express clientId
    out = run_ssh(host, "grep -oP '^AWS_IOT_CLIENT_ID=\\K.*' ~/smartfarm/rpi-server/.env")
    if out is None:
        print('✗ SSH 실패'); continue
    express_id = out.strip()
    express_ok = (express_id == f'MyFarmPi_{farm_id}')

    # Node-RED clientId
    out = run_ssh(host, "python3 -c \"import json; print(next((n.get('clientid','') for n in json.load(open('/home/lhk/.node-red/flows.json')) if n.get('type')=='mqtt-broker'), ''))\"")
    nodered_id = (out or '').strip()
    import re
    nodered_ok = bool(re.match(f'^MyFarmPi_{farm_id}_.+_nodered$', nodered_id))

    # MQTT disconnect 빈도
    out = run_ssh(host, "pm2 logs node-red --lines 200 --nostream 2>&1 | grep -c Disconnected || true")
    disc = int(out.strip().split('\n')[-1] or 0) if out else 0
    mqtt_ok = (disc <= 3)

    mark = '✓' if (express_ok and nodered_ok and mqtt_ok) else '✗'
    e_status = 'OK' if express_ok else f'BAD({express_id})'
    n_status = 'OK' if nodered_ok else f'BAD({nodered_id})'
    m_status = 'stable' if mqtt_ok else f'FLAPPING({disc}/200)'
    print(f'{mark}  Express={e_status}  NodeRED={n_status}  MQTT={m_status}')

print('\n복구: rpi_master_image_traps.md #6-B 참조')
