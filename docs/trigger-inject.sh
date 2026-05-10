TOKEN=$(curl -sS -X POST http://localhost:1880/node-red/auth/token \
  -d 'client_id=node-red-admin&grant_type=password&scope=*&username=admin&password=admin1234' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
echo "Token len: ${#TOKEN}"
curl -sS -X POST "http://localhost:1880/node-red/inject/gt_test_inject" \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nStatus: %{http_code}\n"
