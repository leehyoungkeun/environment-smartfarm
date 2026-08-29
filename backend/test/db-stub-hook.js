// 모듈 로더 훅 — 테스트 프로세스 안에서만 src/db.js 를 스텁으로 바꾼다.
// 운영 코드는 수정하지 않는다. 실제 DB 로 붙는 실수를 구조적으로 차단하는 것이 목적.

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (/[\\/]src[\\/]db\.js$/.test(new URL(resolved.url).pathname)) {
    return { ...resolved, url: new URL("./db-stub.js", import.meta.url).href, shortCircuit: true };
  }
  return resolved;
}
