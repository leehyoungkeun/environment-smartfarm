import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const FarmSelector = () => {
  const { farms, selectedFarmId, selectFarm } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!farms || farms.length <= 1) return null;

  const current = selectedFarmId ? farms.find((f) => f.farmId === selectedFarmId) : null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium transition-all border ${
          current
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
            : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
        }`}
      >
        <span className="max-w-[120px] truncate">{current ? current.name : '농장 선택'}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-9 w-56 bg-white border border-gray-200 rounded-xl
                       p-1.5 z-[100] shadow-xl">
          <div className="px-2 py-1.5 text-xs text-gray-400 font-medium">
            농장 선택
          </div>
          {farms.map((farm) => (
            <button
              key={farm.farmId}
              onClick={() => { selectFarm(farm.farmId, farm); setOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                farm.farmId === selectedFarmId
                  ? 'bg-emerald-50 text-emerald-700 font-semibold'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <div className="font-medium">{farm.name}</div>
              <div className="text-xs text-gray-400 flex items-center gap-2">
                <span>{farm.farmId}</span>
                {farm.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />}
                {farm.status === 'inactive' && <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />}
                {farm.status === 'maintenance' && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FarmSelector;
