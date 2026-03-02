import React, { useLayoutEffect, useRef } from 'react';

/**
 * 숫자를 부드럽게 애니메이션하는 컴포넌트
 * - useLayoutEffect로 브라우저 paint 전에 텍스트 설정 (깜빡임 방지)
 * - React children 없음 → ref.textContent만 사용 (재렌더링 시 덮어쓰기 없음)
 */
export const AnimatedNumber = ({ value, precision = 1, duration = 800, fallback = '\u2014' }) => {
  const spanRef = useRef(null);
  const prevRef = useRef(null);
  const frameRef = useRef(null);

  useLayoutEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    // 숫자가 아닌 경우 즉시 표시
    if (value === null || value === undefined || typeof value !== 'number') {
      el.textContent = fallback;
      prevRef.current = value;
      return;
    }

    // 이전 값이 없거나 같으면 즉시 표시 (애니메이션 불필요)
    const from = typeof prevRef.current === 'number' ? prevRef.current : value;
    if (from === value) {
      el.textContent = value.toFixed(precision);
      prevRef.current = value;
      return;
    }

    // 즉시 이전 값 표시 (브라우저 paint 전 — 깜빡임 방지)
    el.textContent = from.toFixed(precision);

    // 애니메이션 시작
    const startTime = performance.now();
    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = (from + (value - from) * eased).toFixed(precision);
      if (t < 1) frameRef.current = requestAnimationFrame(animate);
    };

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(animate);
    prevRef.current = value;

    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [value, precision, duration, fallback]);

  // 빈 span — 모든 텍스트는 ref로 관리 (React가 덮어쓰지 않음)
  return <span ref={spanRef} />;
};
