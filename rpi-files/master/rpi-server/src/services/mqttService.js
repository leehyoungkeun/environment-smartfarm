/**
 * MQTT 서비스 (RPi)
 * AWS IoT Core 연결, 원격 명령 수신 및 데이터 발행
 */
const { mqtt, iot } = require('aws-iot-device-sdk-v2');
const { topics } = require('../../../shared/mqttTopics');
const fs = require('fs');

let mqttConnection = null;
let isConnected = false;
const farmId = process.env.AWS_IOT_CLIENT_ID || 'MyFarmPi_01';
const farmTopics = topics(farmId);

// 외부 서비스 참조
let controlService = null;
let publisherService = null;

const setControlService = (service) => { controlService = service; };
const setPublisherService = (service) => { publisherService = service; };

/**
 * MQTT 서비스 초기화
 * AWS IoT Core에 인증서 기반 mTLS 연결 수립
 */
async function initMqttService() {
  try {
    const certPath = process.env.AWS_IOT_CERT_PATH;
    const keyPath = process.env.AWS_IOT_KEY_PATH;
    const caPath = process.env.AWS_IOT_CA_PATH;
    const endpoint = process.env.AWS_IOT_ENDPOINT;

    // 인증서 파일 존재 여부 확인
    if (!certPath || !fs.existsSync(certPath)) {
      throw new Error('AWS IoT 인증서를 찾을 수 없습니다: ' + certPath);
    }

    // mTLS 연결 설정 빌더 생성
    const configBuilder = iot.AwsIotMqttConnectionConfigBuilder
      .new_mtls_builder_from_path(certPath, keyPath);
    configBuilder.with_certificate_authority_from_path(undefined, caPath);
    configBuilder.with_clean_session(true);
    configBuilder.with_client_id(farmId);
    configBuilder.with_endpoint(endpoint);

    const config = configBuilder.build();
    const client = new mqtt.MqttClient();
    mqttConnection = client.new_connection(config);

    // 연결 성공 이벤트
    mqttConnection.on('connect', async () => {
      try {
        isConnected = true;
        console.log('AWS IoT Core MQTT 연결 성공');

        // 구독: 원격 명령, 설정 변경, 텔레메트리 시작/중지 요청
        await mqttConnection.subscribe(farmTopics.command, mqtt.QoS.AtLeastOnce);
        await mqttConnection.subscribe(farmTopics.configUpdate, mqtt.QoS.AtLeastOnce);
        await mqttConnection.subscribe(farmTopics.requestStart, mqtt.QoS.AtLeastOnce);
        await mqttConnection.subscribe(farmTopics.requestStop, mqtt.QoS.AtLeastOnce);
        console.log('  구독 완료: command, config/update, request/start, request/stop');
      } catch (error) {
        console.error('MQTT 구독 처리 오류:', error);
      }
    });

    // 연결 해제 이벤트
    mqttConnection.on('disconnect', () => {
      isConnected = false;
      console.warn('MQTT 연결 해제됨');
    });

    // 오류 이벤트
    mqttConnection.on('error', (error) => {
      console.error('MQTT 오류:', error);
    });

    // 수신 메시지 처리
    mqttConnection.on('message', async (topic, payload) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));

        if (topic === farmTopics.command && controlService) {
          // 원격 명령 수신 → 제어 서비스에서 실행
          const result = await controlService.executeCommand({ ...data, source: 'web_remote' });
          // 명령 실행 결과 ACK 발행
          await publish(farmTopics.commandAck, {
            ...data,
            result: result ? 'success' : 'failure',
            logId: data.logId,
          });

        } else if (topic === farmTopics.configUpdate) {
          // 원격 설정 변경 수신
          const { SystemConfig: SC, IrrigationProgram: IP } = require('../models');
          if (data.systemConfig) SC.update(data.systemConfig);
          if (data.program) IP.update(data.program.programNumber, data.program);
          // 설정 ACK 발행
          await publish(farmTopics.configUpdate.replace('update', 'ack'), {
            received: true,
            timestamp: Date.now(),
          });

        } else if (topic === farmTopics.requestStart && publisherService) {
          // 사무실 서버가 텔레메트리 시작 요청
          publisherService.start();

        } else if (topic === farmTopics.requestStop && publisherService) {
          // 사무실 서버가 텔레메트리 중단 요청
          publisherService.stop();
        }
      } catch (error) {
        console.error('MQTT 메시지 처리 오류:', error);
      }
    });

    await mqttConnection.connect();
  } catch (error) {
    console.error('MQTT 서비스 초기화 오류:', error);
    throw error;
  }
}

/**
 * MQTT 메시지 발행
 * @param {string} topic - 발행할 토픽
 * @param {object} payload - 발행할 데이터 객체
 * @returns {boolean} 발행 성공 여부
 */
async function publish(topic, payload) {
  if (!mqttConnection || !isConnected) return false;
  try {
    await mqttConnection.publish(topic, JSON.stringify(payload), mqtt.QoS.AtLeastOnce);
    return true;
  } catch (error) {
    console.error('MQTT 발행 오류:', error);
    return false;
  }
}

/**
 * MQTT 연결 상태 조회
 * @returns {boolean} 연결 여부
 */
const getConnectionStatus = () => isConnected;

/**
 * 현재 농장 토픽 객체 조회
 * @returns {object} farmTopics 객체
 */
const getFarmTopics = () => farmTopics;

module.exports = {
  initMqttService,
  publish,
  getConnectionStatus,
  getFarmTopics,
  setControlService,
  setPublisherService,
};
