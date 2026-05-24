// ============================================================
// AWS API Gateway Authorizer Lambda — JWT 검증
//
// 적용:
//   1. AWS Lambda Console → 함수 생성 → Node.js 22.x
//   2. 함수명: smartfarm-jwt-authorizer
//   3. 이 파일 내용 그대로 복사 (index.mjs 또는 index.js)
//   4. 환경변수 추가: JWT_SECRET = backend/.env 의 JWT_SECRET 동일 값
//   5. 배포 (Deploy)
//   6. API Gateway → SmartFarm API → Authorizers → Create:
//      - Name: smartfarm-jwt
//      - Type: Lambda
//      - Lambda function: smartfarm-jwt-authorizer
//      - Token source (Header name): Authorization
//      - Authorization caching: 5분 (300초)
//   7. /control method → Method Request → Authorization: smartfarm-jwt
//   8. API 배포 (Actions → Deploy API → prod)
//
// 동작:
//   - Authorization: Bearer <JWT> 헤더 검증
//   - 외부 의존성 없이 Node.js crypto 모듈로 HMAC-SHA256 검증
//   - 검증 성공 시 context 에 farmId/userId/role 전달 → 메인 Lambda 가 사용
//
// Backend 다운 시: token 유효 기간 동안 자체 검증 OK (Backend 호출 X)
// ============================================================

const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('JWT_SECRET 환경변수 미설정 — 모든 요청 거부됩니다');
}

function base64UrlDecode(str) {
    return Buffer.from(str, 'base64url').toString();
}

function verifyJWT(token) {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET not configured');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid token format');
    }
    const [headerB64, payloadB64, signatureB64] = parts;

    // HMAC-SHA256 서명 검증
    const expectedSig = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(headerB64 + '.' + payloadB64)
        .digest('base64url');
    if (signatureB64 !== expectedSig) {
        throw new Error('Invalid signature');
    }

    // payload 파싱
    const payload = JSON.parse(base64UrlDecode(payloadB64));

    // 만료 검증
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('Token expired');
    }

    return payload;
}

function generatePolicy(principalId, effect, methodArn, context = {}) {
    return {
        principalId,
        policyDocument: {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: 'execute-api:Invoke',
                    Effect: effect,
                    Resource: methodArn,
                },
            ],
        },
        context,
    };
}

exports.handler = async (event) => {
    console.log('Authorizer event:', JSON.stringify(event));

    const authHeader = event.authorizationToken || event.headers?.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
        console.error('No token in Authorization header');
        throw new Error('Unauthorized');
    }

    let payload;
    try {
        payload = verifyJWT(token);
    } catch (e) {
        console.error('JWT verify failed:', e.message);
        throw new Error('Unauthorized');
    }

    // context 는 메인 Lambda 의 event.requestContext.authorizer 로 전달됨
    // (값은 string 만 허용 — number/boolean 은 string 으로 변환)
    const context = {
        farmId: String(payload.farmId || ''),
        userId: String(payload.id || ''),
        username: String(payload.username || ''),
        role: String(payload.role || 'operator'),
    };

    console.log('Authorized:', context);
    return generatePolicy(context.userId || 'unknown', 'Allow', event.methodArn, context);
};
