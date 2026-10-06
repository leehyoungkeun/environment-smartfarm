import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * 화면 안 확인창 (2026-10-06)
 *
 * 왜 window.confirm 을 쓰지 않나:
 *   브라우저가 "이 페이지가 대화상자를 만들지 못하게" 를 켜면 window.confirm 은
 *   **아무 말 없이 false** 를 돌려준다. 사용자는 삭제를 눌러도 아무 일도 일어나지 않은
 *   것으로 보고, 화면에는 오류도 안 뜬다 (2026-09-27 실제 증상). 키오스크 브라우저는
 *   특히 잘 막는다. 확인은 반드시 우리 화면 안에서 받는다.
 *
 * 쓰는 법:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: '삭제할까요?', message: '되돌릴 수 없습니다', tone: 'danger' }))) return;
 */
const Ctx = createContext(null);

export const useConfirm = () => {
  const ctx = useContext(Ctx);
  // Provider 밖에서 불려도 앱이 죽지 않게 — 다만 확인 없이 진행하지는 않는다(안전쪽).
  return ctx || (async () => false);
};

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve;
    setReq(typeof opts === 'string' ? { message: opts } : (opts || {}));
  }), []);

  const close = useCallback((ok) => {
    setReq(null);
    const r = resolver.current;
    resolver.current = null;
    if (r) r(ok);
  }, []);

  const value = useMemo(() => confirm, [confirm]);
  const danger = req?.tone === 'danger';

  return (
    <Ctx.Provider value={value}>
      {children}
      {req && (
        <div
          role="dialog" aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) close(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15,23,42,0.45)',
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 20px 8px' }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0f172a' }}>
                {req.title || (danger ? '정말 진행할까요?' : '확인')}
              </h3>
              {req.message && (
                // 여러 줄 메시지를 그대로 보이게 (\n 유지)
                <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: '#475569', whiteSpace: 'pre-line' }}>
                  {req.message}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px 20px' }}>
              <button onClick={() => close(false)} autoFocus
                style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #e2e8f0',
                         background: '#fff', color: '#334155', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {req.cancelText || '취소'}
              </button>
              <button onClick={() => close(true)}
                style={{ padding: '9px 18px', borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 14,
                         cursor: 'pointer', color: '#fff', background: danger ? '#e11d48' : '#2563eb' }}>
                {req.confirmText || (danger ? '삭제' : '확인')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export default ConfirmProvider;
