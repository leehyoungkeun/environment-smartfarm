// ============================================================
// AWS API Gateway HTTP API Authorizer Lambda — JWT 검증 (ESM)
//
// ⚠️ HTTP API (v2) 용 — Simple response format 사용
// REST API 의 policyDocument 와 다름
//
// 적용:
//   1. AWS Lambda Console → smartfarm-jwt-authorizer
//   2. Code → 이 파일 내용으로 교체 → Deploy
//   3. 환경변수: JWT_SECRET (이미 설정됨)
//   4. API Gateway → farmControl_API → Authorization → Authorizer 관리:
//      - Create Lambda authorizer
//      - Name: smartfarm-jwt
//      - Authorizer source: $request.header.Authorization
//      - Lambda function: smartfarm-jwt-authorizer
//      - Response mode: Simple
//      - Authorizer caching: 5분 (300초)
//      - Identity sources: $request.header.Authorization
//   5. Routes → POST /control → Attach authorizer (smartfarm-jwt)
//   6. Auto deploy → 적용
//
// 동작:
//   - event.headers.authorization 검증 (HTTP API 2.0)
//   - 검증 성공: { isAuthorized: true, context: { farmId, userId, ... } }
//   - 검증 실패: { isAuthorized: false }
//   - 메인 Lambda 가 event.requestContext.authorizer.lambda.farmId 로 사용
//
// JWT_SECRET 1개로 모든 농장의 모든 token 검증 (stateless)
// Backend 다운 시에도 token 유효 기간 동안 자체 검증 OK
// ============================================================

import crypto from 'node:crypto';

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

export const handler = async (event) => {
    console.log('Authorizer event:', JSON.stringify(event));

    // HTTP API 2.0: event.headers.authorization (소문자)
    // REST API 호환: event.authorizationToken 도 fallback
    const authHeader =
        event.headers?.authorization ||
        event.headers?.Authorization ||
        event.authorizationToken ||
        '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
        console.error('No token in Authorization header');
        return { isAuthorized: false };
    }

    let payload;
    try {
        payload = verifyJWT(token);
    } catch (e) {
        console.error('JWT verify failed:', e.message);
        return { isAuthorized: false };
    }

    // context 는 메인 Lambda 의 event.requestContext.authorizer.lambda.* 로 전달됨
    // (HTTP API 2.0 simple response format)
    const context = {
        farmId: String(payload.farmId || ''),
        userId: String(payload.id || ''),
        username: String(payload.username || ''),
        role: String(payload.role || 'operator'),
    };

    console.log('Authorized:', context);
    return {
        isAuthorized: true,
        context,
    };
};
