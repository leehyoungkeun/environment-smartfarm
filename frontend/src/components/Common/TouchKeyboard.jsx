import React, { useState, useRef, useEffect, useCallback } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

const isTouchPanel = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && ['80', '443', ''].includes(window.location.port);

// ─── 한글 자모 조합 엔진 ───
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

// 겹모음 조합: 앞모음 + 뒷모음 → 겹모음
const DOUBLE_JUNG = { 'ㅗㅏ':'ㅘ','ㅗㅐ':'ㅙ','ㅗㅣ':'ㅚ','ㅜㅓ':'ㅝ','ㅜㅔ':'ㅞ','ㅜㅣ':'ㅟ','ㅡㅣ':'ㅢ' };
// 겹받침 조합: 앞자음 + 뒷자음 → 겹받침
const DOUBLE_JONG = { 'ㄱㅅ':'ㄳ','ㄴㅈ':'ㄵ','ㄴㅎ':'ㄶ','ㄹㄱ':'ㄺ','ㄹㅁ':'ㄻ','ㄹㅂ':'ㄼ','ㄹㅅ':'ㄽ','ㄹㅌ':'ㄾ','ㄹㅍ':'ㄿ','ㄹㅎ':'ㅀ','ㅂㅅ':'ㅄ','ㅅㅅ':'ㅆ' };
// 겹받침 분리: 겹받침 → [앞, 뒤]
const SPLIT_JONG = { 'ㄳ':['ㄱ','ㅅ'],'ㄵ':['ㄴ','ㅈ'],'ㄶ':['ㄴ','ㅎ'],'ㄺ':['ㄹ','ㄱ'],'ㄻ':['ㄹ','ㅁ'],'ㄼ':['ㄹ','ㅂ'],'ㄽ':['ㄹ','ㅅ'],'ㄾ':['ㄹ','ㅌ'],'ㄿ':['ㄹ','ㅍ'],'ㅀ':['ㄹ','ㅎ'],'ㅄ':['ㅂ','ㅅ'],'ㅆ':['ㅅ','ㅅ'] };

const isCho = (c) => CHO.includes(c);
const isJung = (c) => JUNG.includes(c);

function composeHangul(cho, jung, jong) {
  const ci = CHO.indexOf(cho);
  const ji = JUNG.indexOf(jung);
  const ki = jong ? JONG.indexOf(jong) : 0;
  if (ci < 0 || ji < 0 || ki < 0) return null;
  return String.fromCharCode(0xAC00 + ci * 21 * 28 + ji * 28 + ki);
}

function decomposeHangul(ch) {
  const code = ch.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null;
  const offset = code - 0xAC00;
  const cho = Math.floor(offset / (21 * 28));
  const jung = Math.floor((offset % (21 * 28)) / 28);
  const jong = offset % 28;
  return { cho: CHO[cho], jung: JUNG[jung], jong: JONG[jong] || null };
}

class HangulComposer {
  constructor() { this.buffer = []; } // 조합 중인 자모 버퍼

  reset() { this.buffer = []; }

  // 현재 조합 중인 글자 반환 (없으면 '')
  getComposing() {
    const b = this.buffer;
    if (b.length === 0) return '';
    if (b.length === 1) return b[0];
    if (b.length === 2 && isCho(b[0]) && isJung(b[1])) return composeHangul(b[0], b[1]) || b.join('');
    if (b.length === 3 && isCho(b[0]) && isJung(b[1]) && isCho(b[2])) return composeHangul(b[0], b[1], b[2]) || b.join('');
    return b.join('');
  }

  // 자모 하나 입력, 반환: { committed: string, composing: string }
  feed(jamo) {
    const b = this.buffer;

    // 빈 버퍼
    if (b.length === 0) {
      b.push(jamo);
      return { committed: '', composing: this.getComposing() };
    }

    // 버퍼[0] = 초성만
    if (b.length === 1 && isCho(b[0])) {
      if (isJung(jamo)) {
        b.push(jamo);
        return { committed: '', composing: this.getComposing() };
      }
      // 자음 연속: 쌍자음 체크
      const double = b[0] + jamo;
      const ssang = { 'ㄱㄱ':'ㄲ','ㄷㄷ':'ㄸ','ㅂㅂ':'ㅃ','ㅅㅅ':'ㅆ','ㅈㅈ':'ㅉ' };
      if (ssang[double]) {
        const committed = '';
        this.buffer = [ssang[double]];
        return { committed, composing: this.getComposing() };
      }
      const committed = b[0];
      this.buffer = [jamo];
      return { committed, composing: this.getComposing() };
    }

    // 버퍼[0]=초성, 버퍼[1]=중성 (모음)
    if (b.length === 2 && isCho(b[0]) && isJung(b[1])) {
      // 겹모음 체크
      if (isJung(jamo)) {
        const dj = DOUBLE_JUNG[b[1] + jamo];
        if (dj) {
          b[1] = dj;
          return { committed: '', composing: this.getComposing() };
        }
        // 새 모음 → 현재 글자 확정, 새 모음 버퍼
        const committed = this.getComposing();
        this.buffer = [jamo];
        return { committed, composing: this.getComposing() };
      }
      // 자음 → 받침
      if (isCho(jamo)) {
        b.push(jamo);
        return { committed: '', composing: this.getComposing() };
      }
    }

    // 버퍼[0]=초성, 버퍼[1]=중성, 버퍼[2]=종성
    if (b.length === 3 && isCho(b[0]) && isJung(b[1]) && isCho(b[2])) {
      // 모음 입력 → 종성을 초성으로 분리
      if (isJung(jamo)) {
        // 겹받침이면 분리
        const split = SPLIT_JONG[b[2]];
        if (split) {
          const committed = composeHangul(b[0], b[1], split[0]);
          this.buffer = [split[1], jamo];
          return { committed, composing: this.getComposing() };
        }
        const committed = composeHangul(b[0], b[1]);
        this.buffer = [b[2], jamo];
        return { committed, composing: this.getComposing() };
      }
      // 자음 → 겹받침 체크
      if (isCho(jamo)) {
        const dk = DOUBLE_JONG[b[2] + jamo];
        if (dk && JONG.includes(dk)) {
          b[2] = dk;
          return { committed: '', composing: this.getComposing() };
        }
        const committed = this.getComposing();
        this.buffer = [jamo];
        return { committed, composing: this.getComposing() };
      }
    }

    // 그 외: 확정 후 새로 시작
    const committed = this.getComposing();
    this.buffer = [jamo];
    return { committed, composing: this.getComposing() };
  }

  // backspace: 버퍼 마지막 자모 제거
  backspace() {
    if (this.buffer.length > 0) {
      // 겹받침/겹모음 분리
      const last = this.buffer[this.buffer.length - 1];
      if (this.buffer.length === 3 && SPLIT_JONG[last]) {
        this.buffer[2] = SPLIT_JONG[last][0];
        return { deleted: false, composing: this.getComposing() };
      }
      const dj = Object.entries(DOUBLE_JUNG).find(([, v]) => v === last);
      if (this.buffer.length === 2 && dj) {
        this.buffer[1] = dj[0][0];
        return { deleted: false, composing: this.getComposing() };
      }
      this.buffer.pop();
      return { deleted: false, composing: this.getComposing() };
    }
    return { deleted: true, composing: '' };
  }

  // 현재 조합 확정
  flush() {
    const result = this.getComposing();
    this.buffer = [];
    return result;
  }
}

// ─── 키 → 자모 매핑 (두벌식) ───
const KEY_TO_JAMO = {
  'ㄱ':'ㄱ','ㄲ':'ㄲ','ㄴ':'ㄴ','ㄷ':'ㄷ','ㄸ':'ㄸ','ㄹ':'ㄹ','ㅁ':'ㅁ','ㅂ':'ㅂ','ㅃ':'ㅃ',
  'ㅅ':'ㅅ','ㅆ':'ㅆ','ㅇ':'ㅇ','ㅈ':'ㅈ','ㅉ':'ㅉ','ㅊ':'ㅊ','ㅋ':'ㅋ','ㅌ':'ㅌ','ㅍ':'ㅍ','ㅎ':'ㅎ',
  'ㅏ':'ㅏ','ㅐ':'ㅐ','ㅑ':'ㅑ','ㅒ':'ㅒ','ㅓ':'ㅓ','ㅔ':'ㅔ','ㅕ':'ㅕ','ㅖ':'ㅖ',
  'ㅗ':'ㅗ','ㅛ':'ㅛ','ㅜ':'ㅜ','ㅠ':'ㅠ','ㅡ':'ㅡ','ㅣ':'ㅣ',
};

const TouchKeyboard = () => {
  const [visible, setVisible] = useState(false);
  const [layout, setLayout] = useState('default');
  const keyboardRef = useRef(null);
  const activeInputRef = useRef(null);
  const composerRef = useRef(new HangulComposer());
  const baseTextRef = useRef(''); // 조합 확정된 텍스트

  const setNativeValue = useCallback((input, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (setter) {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, []);

  const updateInput = useCallback((base, composing) => {
    const input = activeInputRef.current;
    if (!input) return;
    const fullVal = base + composing;
    setNativeValue(input, fullVal);
    if (keyboardRef.current) keyboardRef.current.setInput(fullVal);
  }, [setNativeValue]);

  useEffect(() => {
    if (!isTouchPanel) return;

    const handleFocusIn = (e) => {
      const el = e.target;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file' || el.readOnly) return;
        activeInputRef.current = el;
        composerRef.current.reset();
        baseTextRef.current = el.value || '';
        if (keyboardRef.current) keyboardRef.current.setInput(el.value || '');
        if (el.type === 'number' || el.inputMode === 'numeric') {
          setLayout('numpad');
        } else {
          setLayout('korean');
        }
        setVisible(true);
      }
    };

    const handleFocusOut = () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        const kbEl = document.querySelector('.touch-keyboard-wrapper');
        if (kbEl && kbEl.contains(document.activeElement)) return;
        // 조합 확정
        const flushed = composerRef.current.flush();
        if (flushed) baseTextRef.current += flushed;
        setVisible(false);
        activeInputRef.current = null;
      }, 200);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  const onKeyPress = useCallback((button) => {
    const input = activeInputRef.current;
    if (!input) return;
    const composer = composerRef.current;

    // 레이아웃 전환
    if (button === '{shift}' || button === '{lock}') {
      setLayout(prev => prev === 'korean' ? 'korean_shift' : prev === 'korean_shift' ? 'korean' : prev === 'default' ? 'shift' : 'default');
      return;
    }
    if (button === '{numbers}') {
      baseTextRef.current += composer.flush();
      setLayout('numpad');
      updateInput(baseTextRef.current, '');
      return;
    }
    if (button === '{korean}') {
      baseTextRef.current += composer.flush();
      setLayout('korean');
      updateInput(baseTextRef.current, '');
      return;
    }
    if (button === '{eng}') {
      baseTextRef.current += composer.flush();
      setLayout('default');
      updateInput(baseTextRef.current, '');
      return;
    }
    if (button === '{abc}') {
      baseTextRef.current += composer.flush();
      setLayout('korean');
      updateInput(baseTextRef.current, '');
      return;
    }
    if (button === '{enter}') {
      baseTextRef.current += composer.flush();
      updateInput(baseTextRef.current, '');
      setVisible(false);
      input.blur();
      return;
    }
    if (button === '{bksp}') {
      const result = composer.backspace();
      if (result.deleted) {
        // 버퍼 비어있으면 확정 텍스트에서 삭제
        baseTextRef.current = baseTextRef.current.slice(0, -1);
      }
      updateInput(baseTextRef.current, result.composing);
      return;
    }
    if (button === '{space}') {
      baseTextRef.current += composer.flush() + ' ';
      updateInput(baseTextRef.current, '');
      return;
    }
    if (button === '{tab}') return;

    // 한글 자모인지 체크
    const jamo = KEY_TO_JAMO[button];
    if (jamo) {
      const { committed, composing } = composer.feed(jamo);
      baseTextRef.current += committed;
      updateInput(baseTextRef.current, composing);
      if (layout === 'korean_shift') setLayout('korean');
    } else {
      // 영문/기호: 조합 확정 후 추가
      baseTextRef.current += composer.flush() + button;
      updateInput(baseTextRef.current, '');
      if (layout === 'shift') setLayout('default');
    }
  }, [layout, updateInput]);

  if (!isTouchPanel || !visible) return null;

  const layouts = {
    korean: [
      '1 2 3 4 5 6 7 8 9 0',
      'ㅂ ㅈ ㄷ ㄱ ㅅ ㅛ ㅕ ㅑ ㅐ ㅔ',
      'ㅁ ㄴ ㅇ ㄹ ㅎ ㅗ ㅓ ㅏ ㅣ',
      '{shift} ㅋ ㅌ ㅊ ㅍ ㅜ ㅡ {bksp}',
      '{eng} {numbers} {space} . {enter}',
    ],
    korean_shift: [
      '! @ # $ % ^ & * ( )',
      'ㅃ ㅉ ㄸ ㄲ ㅆ ㅛ ㅕ ㅑ ㅒ ㅖ',
      'ㅁ ㄴ ㅇ ㄹ ㅎ ㅗ ㅓ ㅏ ㅣ',
      '{shift} ㅋ ㅌ ㅊ ㅍ ㅜ ㅡ {bksp}',
      '{eng} {numbers} {space} . {enter}',
    ],
    default: [
      '1 2 3 4 5 6 7 8 9 0',
      'q w e r t y u i o p',
      'a s d f g h j k l',
      '{shift} z x c v b n m {bksp}',
      '{korean} {numbers} {space} . - _ @ {enter}',
    ],
    shift: [
      '! @ # $ % ^ & * ( )',
      'Q W E R T Y U I O P',
      'A S D F G H J K L',
      '{shift} Z X C V B N M {bksp}',
      '{korean} {numbers} {space} . - _ @ {enter}',
    ],
    numpad: [
      '1 2 3',
      '4 5 6',
      '7 8 9',
      '. 0 {bksp}',
      '{abc} - {enter}',
    ],
  };

  return (
    <div
      className="touch-keyboard-wrapper fixed bottom-0 left-0 right-0 z-[9999] bg-gray-100 border-t border-gray-300 shadow-2xl"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex justify-end px-2 py-1">
        <button
          onClick={() => {
            baseTextRef.current += composerRef.current.flush();
            updateInput(baseTextRef.current, '');
            setVisible(false);
            activeInputRef.current?.blur();
          }}
          className="text-xs text-gray-500 px-3 py-1 hover:bg-gray-200 rounded"
        >
          닫기
        </button>
      </div>
      <Keyboard
        keyboardRef={r => (keyboardRef.current = r)}
        onKeyPress={onKeyPress}
        layout={layouts}
        layoutName={layout}
        display={{
          '{bksp}': '⌫',
          '{enter}': '확인',
          '{shift}': '⇧',
          '{lock}': '⇪',
          '{space}': '           ',
          '{tab}': '→',
          '{numbers}': '123',
          '{abc}': '가/A',
          '{korean}': '한글',
          '{eng}': 'ENG',
        }}
        theme="hg-theme-default hg-layout-default"
      />
    </div>
  );
};

export default TouchKeyboard;
