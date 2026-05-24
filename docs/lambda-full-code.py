import boto3
import json
import datetime

client = boto3.client('iot-data', region_name='ap-northeast-2')

def lambda_handler(event, context):
    # ========================================
    # CORS 헤더 정의
    # ========================================
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET'
    }

    # ========================================
    # 디버깅: 전체 이벤트 로깅
    # ========================================
    print(f"Received event: {json.dumps(event)}")

    # ========================================
    # OPTIONS 요청 처리 (여러 형식 지원)
    # ========================================
    # HTTP API 2.0 형식
    http_method = event.get('requestContext', {}).get('http', {}).get('method')
    # REST API 형식 또는 직접 호출
    if not http_method:
        http_method = event.get('httpMethod')
    # 직접 Lambda 테스트
    if not http_method:
        http_method = event.get('method', 'POST')

    print(f"HTTP Method: {http_method}")

    if http_method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': ''
        }

    # ========================================
    # 요청 본문 파싱
    # ========================================
    try:
        # HTTP API는 body를 문자열로 전달
        if isinstance(event.get('body'), str):
            body = json.loads(event.get('body', '{}'))
        else:
            # 직접 Lambda 호출이나 테스트
            body = event.get('body', event)

        print(f"Parsed body: {json.dumps(body)}")

    except Exception as e:
        print(f"Body parsing error: {str(e)}")
        body = event

    # ========================================
    # ping/헬스체크 (제어 실행 없이 응답만)
    # ========================================
    cmd = body.get('command', '')
    if cmd == 'ping' or not cmd:
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({
                'success': True,
                'message': 'pong',
                'timestamp': datetime.datetime.utcnow().isoformat() + "Z"
            })
        }

    # ========================================
    # 자동화 sync 알림 (규칙 변경 시 RPi에 알림)
    # ========================================
    action = body.get('action', '')
    if action == 'automation_sync':
        farm_id = body.get('farm_id', 'unknown')
        sync_topic = f"smartfarm/{farm_id}/automation/sync"
        sync_msg = {
            'action': 'automation_sync',
            'farm_id': farm_id,
            'timestamp': body.get('timestamp', datetime.datetime.utcnow().isoformat() + "Z")
        }

        print(f"Automation sync → topic: {sync_topic}")

        try:
            client.publish(
                topic=sync_topic,
                qos=1,
                payload=json.dumps(sync_msg)
            )
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps({
                    'success': True,
                    'message': f'Automation sync sent to {sync_topic}',
                    'farm_id': farm_id
                })
            }
        except Exception as e:
            print(f"Sync publish error: {str(e)}")
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({
                    'success': False,
                    'error': str(e)
                })
            }

    # ========================================
    # 필수 파라미터 검증 (빈 요청으로 인한 오작동 방지)
    # ========================================
    house_id = body.get('house_id')
    window_id = body.get('window_id')
    command = body.get('command')

    if not command or not window_id or not house_id:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': 'house_id, window_id, command는 필수입니다'
            })
        }

    # ========================================
    # 파라미터 추출
    # ========================================
    timestamp = body.get('timestamp', datetime.datetime.utcnow().isoformat() + "Z")
    operator = body.get('operator', 'mobile_app')
    request_id = body.get('request_id', f"req-{int(datetime.datetime.now().timestamp())}")
    modbus = body.get('modbus', None)
    duration = body.get('duration', 0)
    delay_sec = body.get('delay_sec', 0)  # 자동 OFF 예약 시간 (초) — schedule-off 명령용
    farm_id = body.get('farm_id', None)  # 100농장 표준화 — 있으면 farmId-prefix 새 토픽도 publish

    # ========================================
    # IoT 메시지 발행
    # ========================================
    # 옛 토픽 (legacy, 100농장 호환 유지)
    legacy_topic = f"smartfarm/{house_id}/{window_id}/control"
    # 새 토픽 (farmId prefix, 농장 격리 보장) — farm_id 있을 때만
    new_topic = f"smartfarm/{farm_id}/{house_id}/{window_id}/control" if farm_id else None

    control_msg = {
        "command": command,
        "timestamp": timestamp,
        "house_id": house_id,
        "window_id": window_id,
        "operator": operator,
        "request_id": request_id,
        "duration": duration
    }

    if farm_id:
        control_msg["farm_id"] = farm_id
    if modbus is not None:
        control_msg["modbus"] = modbus
    if delay_sec and delay_sec > 0:
        control_msg["delay_sec"] = delay_sec

    print(f"Publishing to legacy topic: {legacy_topic}" + (f" + new topic: {new_topic}" if new_topic else ""))
    print(f"Message: {json.dumps(control_msg)}")

    try:
        # 옛 토픽 publish (호환)
        response = client.publish(
            topic=legacy_topic,
            qos=1,
            retain=False,
            payload=json.dumps(control_msg)
        )

        # 새 토픽 publish (farm_id 있을 때만)
        if new_topic:
            client.publish(
                topic=new_topic,
                qos=1,
                retain=False,
                payload=json.dumps(control_msg)
            )

        print(f"Publish successful: {response}")

        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({
                'success': True,
                'message': f"Topic: {legacy_topic}" + (f" + {new_topic}" if new_topic else "") + " 로 메시지 전송 성공",
                'topic': legacy_topic,
                'new_topic': new_topic,
                'command': command,
                'farm_id': farm_id,
                'house_id': house_id,
                'window_id': window_id,
                'request_id': request_id
            })
        }

    except Exception as e:
        print(f"Publish error: {str(e)}")

        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': str(e),
                'message': '메시지 전송 실패'
            })
        }
