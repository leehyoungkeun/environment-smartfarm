import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const DEFAULT_LED = {
  enabled: false,
  ip: '169.254.255.254',
  interval: 300,
  items: ['temp', 'humidity'],
  format: '{temp:.1f}C {humid:.0f}%',
};

export const AccessoryManager = ({ farmId }) => {
  return (
    <div className="space-y-4 animate-fade-in-up">
      <LEDDisplayCard farmId={farmId} />
      {/* 미래 확장: 스피커, 부저 등 */}
    </div>
  );
};

const LEDDisplayCard = ({ farmId }) => {
  const [config, setConfig] = useState(DEFAULT_LED);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  // 제어기에서 실제로 적용된 OS 상태. 화면의 체크박스는 '내가 원하는 값' 이고
  // 이 값은 '기기가 실제로 그렇게 되었는가' 다. 둘을 구분해서 보여준다.
  const [net, setNet] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/config/system-settings/${farmId}`);
        // backend 는 settings.settings.display 또는 settings.display 로 반환할 수 있음
        const raw = res.data?.data || {};
        const disp = raw.settings?.display || raw.display;
        if (alive && disp) setConfig({ ...DEFAULT_LED, ...disp });
      } catch (e) {
        console.warn('load display config', e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [farmId]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await axios.put(`${API_BASE}/config/system-settings/${farmId}`, {
        settings: { display: config },
      });
      // 예전엔 저장만 되면 무조건 '저장 완료' 였다. 제어기가 꺼져 있어도 그렇게 떠서
      // 농장주는 반영된 줄 알고 전광판이 왜 그대로인지 알 수 없었다.
      const push = res.data?.displayPush;
      setNet(push?.network || null);
      if (!push) {
        setMessage({ type: 'ok', text: '저장 완료' });
      } else if (!push.delivered) {
        setMessage({
          type: 'err',
          text: '설정은 저장했지만 제어기에 전달하지 못했습니다. 제어기 전원과 네트워크를 확인한 뒤 다시 저장하세요.',
        });
      } else if (config.enabled) {
        setMessage({ type: 'ok', text: `제어기에 반영했습니다 — 최대 ${Math.ceil(config.interval / 60)}분 내 전광판 표시` });
      } else {
        setMessage({ type: 'ok', text: '제어기에 반영했습니다. 전광판 전용 DHCP 와 이더넷 설정도 함께 내렸습니다.' });
      }
    } catch (e) {
      setMessage({ type: 'err', text: '저장 실패: ' + (e.response?.data?.error || e.message) });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 8000);
    }
  };

  const toggleItem = (id) => {
    const items = config.items.includes(id)
      ? config.items.filter(i => i !== id)
      : [...config.items, id];
    setConfig({ ...config, items });
  };

  if (loading) return <div className="glass-card p-4 text-gray-500">로딩 중...</div>;

  return (
    <div className="glass-card p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📺</span>
          <div>
            <h3 className="text-lg font-bold text-gray-800">LED 전광판 (Huidu D16)</h3>
            <p className="text-xs text-gray-500">농장 온습도 실시간 표시</p>
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-sm font-bold text-gray-700">사용</span>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            className="w-5 h-5 accent-blue-600 cursor-pointer"
          />
        </label>
      </div>

      {config.enabled && (
        <div className="space-y-3 pl-3 border-l-2 border-blue-100">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">IP 주소</label>
            <input
              type="text"
              value={config.ip}
              onChange={(e) => setConfig({ ...config, ip: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:outline-none font-mono"
              placeholder="169.254.255.254"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">갱신 주기</label>
            <select
              value={config.interval}
              onChange={(e) => setConfig({ ...config, interval: parseInt(e.target.value) })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:outline-none"
            >
              <option value={60}>1분</option>
              <option value={180}>3분</option>
              <option value={300}>5분 (권장)</option>
              <option value={600}>10분</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">표시 항목</label>
            <div className="flex gap-3 flex-wrap">
              {[
                { id: 'temp', label: '온도' },
                { id: 'humidity', label: '습도' },
                { id: 'time', label: '시간' },
              ].map(item => (
                <label key={item.id} className="flex items-center gap-1 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={config.items.includes(item.id)}
                    onChange={() => toggleItem(item.id)}
                    className="w-4 h-4 accent-blue-600 cursor-pointer"
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">표시 방식</label>
            <div className="flex gap-3 flex-wrap mb-2">
              {[
                { label: '한 줄', value: '{temp:.1f}C {humid:.0f}%' },
                { label: '두 줄 (온도/습도)', value: '{temp:.1f}C\\n{humid:.0f}%' },
                { label: '두 줄 (라벨)', value: 'T:{temp:.1f}C\\nH:{humid:.0f}%' },
              ].map(preset => (
                <label key={preset.label} className="flex items-center gap-1 text-sm cursor-pointer select-none">
                  <input
                    type="radio"
                    name="displayFormat"
                    checked={config.format === preset.value}
                    onChange={() => setConfig({ ...config, format: preset.value })}
                    className="w-4 h-4 accent-blue-600 cursor-pointer"
                  />
                  {preset.label}
                </label>
              ))}
            </div>
            <label className="block text-xs font-bold text-gray-600 mb-1">표시 형식 (직접 편집)</label>
            <input
              type="text"
              value={config.format}
              onChange={(e) => setConfig({ ...config, format: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:outline-none font-mono"
              placeholder="{temp:.1f}C {humid:.0f}%"
            />
            <p className="text-xs text-gray-400 mt-1">
              변수: <code className="bg-gray-100 px-1 rounded">{'{temp}'}</code> <code className="bg-gray-100 px-1 rounded">{'{humid}'}</code> <code className="bg-gray-100 px-1 rounded">{'{time}'}</code> · 줄바꿈: <code className="bg-gray-100 px-1 rounded">\n</code>
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {message && (
        <p className={`mt-3 text-sm font-bold text-center ${
          message.type === 'ok' ? 'text-green-600' : 'text-red-600'
        }`}>
          {message.text}
        </p>
      )}

      {/* 제어기에서 실제로 적용된 상태. 체크 한 칸이 OS 까지 내려갔는지 눈으로 확인한다. */}
      {net && (
        <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-1">
          <p className="font-bold text-gray-600">제어기 적용 상태</p>
          <p>
            전광판 전용 DHCP{' '}
            <b className={net.dhcp?.active === 'active' ? 'text-green-600' : 'text-gray-700'}>
              {net.dhcp?.active === 'active' ? '가동 중' : '정지'}
            </b>
            {net.dhcp?.enabled === 'enabled' ? ', 부팅 시 자동 시작' : ', 부팅 시 시작 안 함'}
          </p>
          <p>
            전광판 랜선{' '}
            <b className={net.eth0?.carrier === 1 ? 'text-green-600' : 'text-gray-700'}>
              {net.eth0?.carrier === 1 ? '연결됨' : '연결 안 됨'}
            </b>
          </p>
          {net.note ? <p className="text-amber-600">{net.note}</p> : null}
        </div>
      )}
    </div>
  );
};

export default AccessoryManager;
