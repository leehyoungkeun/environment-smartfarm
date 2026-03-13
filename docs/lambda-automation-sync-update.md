# Lambda 업데이트 - automation_sync 액션 추가

## 위치
`body` 파싱 직후, `# 파라미터 추출` 섹션 직전에 추가

## 추가할 코드

```python
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
    # 파라미터 추출 (기존 코드 그대로)
    # ========================================
```

## 삽입 위치 (기존 코드 기준)

```python
        print(f"Parsed body: {json.dumps(body)}")

    except Exception as e:
        print(f"Body parsing error: {str(e)}")
        body = event

    # ← 여기에 위 코드 삽입

    # ========================================
    # 파라미터 추출
    # ========================================
    house_id = body.get('house_id', 'house1')
```

## MQTT 토픽
- 발행: `smartfarm/{farmId}/automation/sync`
- RPi 구독: `smartfarm/+/automation/sync`

## 페이로드 (알림 신호만, 규칙 데이터 없음)
```json
{
  "action": "automation_sync",
  "farm_id": "farm_0001",
  "timestamp": "2026-03-11T12:00:00.000Z"
}
```
