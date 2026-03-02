/**
 * farmId/houseId 정규화 미들웨어
 * farm_001 → farm_0001, house_02 → house_0002
 *
 * req.url 경로를 직접 정규화하여 Express 라우트 매칭 전에 적용.
 * query, body, req.farmId도 함께 정규화.
 */

function normalizeId(id, prefix) {
  if (!id || typeof id !== "string") return id;
  const m = id.match(new RegExp(`^${prefix}[_-]?(\\d+)$`));
  if (m) return `${prefix}_${m[1].padStart(4, "0")}`;
  return id;
}

function padShortId(match, prefix, num) {
  return num.length < 4 ? `${prefix}_${num.padStart(4, "0")}` : match;
}

export function normalizeIds(req, res, next) {
  // 1) URL 경로 정규화 (라우트 매칭 전 → req.params에 반영됨)
  const [path, qs] = req.url.split("?");
  const normalized = path
    .replace(/farm_(\d+)/g, (m, n) => padShortId(m, "farm", n))
    .replace(/house_(\d+)/g, (m, n) => padShortId(m, "house", n));
  if (normalized !== path) {
    req.url = qs ? `${normalized}?${qs}` : normalized;
  }

  // 2) query string
  if (req.query.farmId)
    req.query.farmId = normalizeId(req.query.farmId, "farm");
  if (req.query.houseId)
    req.query.houseId = normalizeId(req.query.houseId, "house");

  // 3) body (POST/PUT)
  if (req.body?.farmId)
    req.body.farmId = normalizeId(req.body.farmId, "farm");
  if (req.body?.houseId)
    req.body.houseId = normalizeId(req.body.houseId, "house");

  // 4) req.farmId (authenticateApiKey에서 설정)
  if (req.farmId) req.farmId = normalizeId(req.farmId, "farm");

  next();
}

export { normalizeId };
