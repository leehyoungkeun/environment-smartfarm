// src/components/Journal/JournalManager.jsx
import { useState, useEffect, useCallback, useMemo, createContext, useContext, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import Pagination from "./Pagination.jsx";

if (!document.getElementById("journal-select-fix")) {
  const s = document.createElement("style");
  s.id = "journal-select-fix";
  s.textContent = `select.jrn-select{background:#1e293b!important;color:#e2e8f0!important}select.jrn-select option{background:#1e293b;color:#e2e8f0}input[type=date].input-field::-webkit-calendar-picker-indicator{filter:invert(.7)}.cal-today{background:linear-gradient(135deg,#10b981,#3b82f6);color:#fff;border-radius:9999px}.cal-has-entry{position:relative}.cal-has-entry::after{content:'';position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:4px;height:4px;background:#10b981;border-radius:50%}.cal-selected{background:#3b82f6;color:#fff;border-radius:9999px}.detail-expand{animation:slideDown .2s ease-out}@keyframes slideDown{from{opacity:0;max-height:0}to{opacity:1;max-height:500px}}.lightbox-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;animation:fadeIn .2s}.lightbox-overlay img{max-width:90vw;max-height:85vh;object-fit:contain;border-radius:8px}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@media print{.no-print{display:none!important}.print-only{display:block!important}}`;
  document.head.appendChild(s);
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";
const FarmIdCtx = createContext(import.meta.env.VITE_FARM_ID || "farm_0001");
const WORK_TYPES = ["파종","정식","관수","시비","방제","수확","관리","기타"];
const GROWTH_STAGES = ["발아기","생장기","개화기","착과기","수확기"];
const WEATHER_OPTIONS = ["맑음","구름많음","흐림","비","눈","안개"];
const INPUT_TYPES = ["비료","농약","종자","기타"];
const GRADES = ["특","상","보통","하"];
const INPUT_UNITS = ["kg","g","L","ml","개","포","봉"];
const SC = "input-field jrn-select text-sm w-full";
// inline style — OS dark / 글로벌 CSS override 시 light 강제 보험
const LIGHT_INPUT = { backgroundColor: '#ffffff', color: '#111827', colorScheme: 'light' };

function getToken(){return localStorage.getItem("accessToken")}
async function api(path,options={}){const token=getToken();const res=await fetch(`${API_BASE}${path}`,{...options,headers:{...(options.body instanceof FormData?{}:{"Content-Type":"application/json"}),Authorization:`Bearer ${token}`,...options.headers}});const data=await res.json();if(!data.success)throw new Error(data.error||"요청 실패");return data}

// 이미지 클라이언트 압축 — 서버 용량 / 네트워크 절약
// - maxWidth: 비율 유지하며 너비 제한 (FHD 1920 기본)
// - quality: JPEG 품질 (0.82 기본 — 시각적 손실 거의 없음)
// - maxBytes: 그래도 크면 quality 낮춰가며 재시도
async function compressImageFile(file, opts = {}) {
  const { maxWidth = 1920, quality = 0.82, maxBytes = 1.5 * 1024 * 1024 } = opts;
  if (!file || !file.type?.startsWith("image/")) return file;
  // 이미 작은 이미지(<300KB)는 압축 안 함 (시간 절약)
  if (file.size < 300 * 1024) return file;

  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  let { width, height } = img;
  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  // quality 단계적으로 낮춰가며 maxBytes 충족 시도
  const tryQualities = [quality, 0.7, 0.6, 0.5];
  for (const q of tryQualities) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
    if (!blob) break;
    if (blob.size <= maxBytes || q === tryQualities[tryQualities.length - 1]) {
      const baseName = (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], baseName, { type: "image/jpeg", lastModified: Date.now() });
    }
  }
  return file;
}
function formatDate(d){return d.toISOString().split("T")[0]}
function toKR(ds){return new Date(ds).toLocaleDateString("ko-KR")}
function photoUrl(photo){
  if(!photo)return"";
  // photo는 객체 {path, filename, ...} 또는 문자열
  const p = typeof photo === "string" ? photo : (photo.path || photo.url || photo.filename || "");
  if(!p)return"";
  if(p.startsWith("http"))return p;
  // API_BASE = http://localhost:3000/api → base = http://localhost:3000
  const base=API_BASE.replace(/\/api\/?$/,"");
  // path가 /uploads/... 이면 그대로, 아니면 / 붙여줌
  const cleanPath=p.startsWith("/")?p:`/${p}`;
  return`${base}${cleanPath}`;
}

// ━━━ 사진 다운로드 (저장 대화창) ━━━
async function downloadPhoto(photo,index){
  const url=photoUrl(photo);
  try{
    const res=await fetch(url);
    const blob=await res.blob();
    const ext=url.split(".").pop().split("?")[0]||"jpg";
    const filename=`영농사진_${index+1}_${new Date().toISOString().split("T")[0]}.${ext}`;
    const blobUrl=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=blobUrl;a.download=filename;
    document.body.appendChild(a);a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }catch(e){window.open(url,"_blank")}
}

// ━━━ 사진 라이트박스 ━━━
function Lightbox({photos,startIndex,onClose}){
  const [idx,setIdx]=useState(startIndex||0);
  const [loadErr,setLoadErr]=useState(false);
  const [downloading,setDownloading]=useState(false);
  useEffect(()=>{setLoadErr(false)},[idx]);
  useEffect(()=>{const h=e=>{if(e.key==="Escape")onClose();if(e.key==="ArrowRight")setIdx(i=>(i+1)%photos.length);if(e.key==="ArrowLeft")setIdx(i=>(i-1+photos.length)%photos.length)};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h)},[photos.length,onClose]);
  if(!photos?.length)return null;
  const url=photoUrl(photos[idx]);
  const handleDownload=async(e)=>{e.stopPropagation();setDownloading(true);await downloadPhoto(photos[idx],idx);setDownloading(false)};
  return(
    <div className="lightbox-overlay" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white text-3xl hover:text-gray-300 z-10">✕</button>
      {photos.length>1&&<button onClick={e=>{e.stopPropagation();setIdx(i=>(i-1+photos.length)%photos.length)}} className="absolute left-4 text-white text-4xl hover:text-gray-300 z-10">‹</button>}
      {photos.length>1&&<button onClick={e=>{e.stopPropagation();setIdx(i=>(i+1)%photos.length)}} className="absolute right-4 text-white text-4xl hover:text-gray-300 z-10">›</button>}
      <div className="flex flex-col items-center gap-4" onClick={e=>e.stopPropagation()}>
        {loadErr?(
          <div className="text-center text-gray-400 p-10">
            <p className="text-4xl mb-3">📷</p>
            <p className="text-sm mb-3">사진을 표시할 수 없습니다</p>
            <p className="text-xs text-gray-600 mb-3 break-all max-w-md">{url}</p>
            <button onClick={handleDownload} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500">📥 다운로드</button>
          </div>
        ):(
          <img src={url} alt="" onError={()=>setLoadErr(true)} style={{maxWidth:"90vw",maxHeight:"75vh",objectFit:"contain",borderRadius:"8px"}} />
        )}
        <div className="flex items-center gap-4">
          {photos.length>1&&<span className="text-gray-400 text-sm">{idx+1} / {photos.length}</span>}
          <button onClick={handleDownload} disabled={downloading} className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-all flex items-center gap-1">{downloading?"저장 중...":"📥 다운로드"}</button>
          <button onClick={e=>{e.stopPropagation();window.open(url,"_blank")}} className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-all flex items-center gap-1">🔗 새 탭에서 열기</button>
        </div>
      </div>
    </div>
  );
}

// ━━━ 클릭 가능한 사진 썸네일 ━━━
function PhotoThumbs({photos,size="w-24 h-24"}){
  const [lb,setLb]=useState(null);
  if(!photos?.length)return null;
  return(
    <>
      <div className="flex gap-2 mt-2 flex-wrap">{photos.map((p,i)=>{
        const url=photoUrl(p);
        return(
          <div key={i} className="relative cursor-pointer" onClick={e=>{e.stopPropagation();setLb(i)}}>
            <img src={url} alt={`사진${i+1}`}
              className={`${size} object-cover rounded-lg border border-white/10 hover:opacity-80 transition-opacity bg-slate-700`}
              onError={e=>{
                // 이미지 로드 실패 시 placeholder 표시
                e.target.onerror=null;
                e.target.src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%231e293b' width='100' height='100'/%3E%3Ctext x='50' y='45' text-anchor='middle' fill='%2394a3b8' font-size='24'%3E📷%3C/text%3E%3Ctext x='50' y='65' text-anchor='middle' fill='%2394a3b8' font-size='10'%3Eclick%3C/text%3E%3C/svg%3E";
              }}
            />
          </div>
        );
      })}</div>
      {lb!==null&&<Lightbox photos={photos} startIndex={lb} onClose={()=>setLb(null)} />}
    </>
  );
}

// ━━━ 공통 인쇄/PDF HTML 생성 ━━━
function buildDocHTML(title,headers,rows,photos,mode){
  const now=new Date().toLocaleDateString("ko-KR");
  const isLandscape=mode==="pdf";
  const pageSize=isLandscape?"A4 landscape":"A4";
  return`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;padding:30px;color:#1a1a1a;font-size:11px;line-height:1.6}
.header{text-align:center;margin-bottom:20px;padding-bottom:15px;border-bottom:3px double #2d5a2d}
.header h1{font-size:22px;color:#2d5a2d;margin-bottom:4px;letter-spacing:2px}
.header .sub{font-size:12px;color:#666;margin-top:4px}
.meta{display:flex;justify-content:space-between;margin-bottom:12px;font-size:10px;color:#888}
table{width:100%;border-collapse:collapse;margin-top:8px;page-break-inside:auto}
thead{display:table-header-group}
tr{page-break-inside:avoid;page-break-after:auto}
th{background:#2d5a2d;color:#fff;padding:7px 8px;text-align:center;font-size:10px;font-weight:600;border:1px solid #2d5a2d}
td{padding:6px 8px;border:1px solid #d1d5db;text-align:center;font-size:10px;vertical-align:top;word-break:break-all}
td.left{text-align:left}
tr:nth-child(even) td{background:#f8faf8}
.photo-section{margin-top:30px;page-break-before:always}
.photo-section h2{font-size:16px;color:#2d5a2d;margin-bottom:15px;padding-bottom:8px;border-bottom:2px solid #2d5a2d}
.entry-photos{margin-bottom:20px;page-break-inside:avoid}
.entry-photos h3{font-size:12px;color:#333;margin-bottom:8px;padding:4px 8px;background:#f0f7f0;border-left:3px solid #2d5a2d}
.entry-photos .photos{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.entry-photos .photos img{width:200px;height:150px;object-fit:cover;border:1px solid #d1d5db;border-radius:4px}
.footer{margin-top:25px;text-align:center;color:#aaa;font-size:9px;padding-top:15px;border-top:1px solid #e5e7eb}
@page{size:${pageSize};margin:12mm}
@media print{body{padding:0}.header{margin-bottom:15px}}
</style></head><body>
<div class="header">
  <h1>🌱 ${title}</h1>
  <div class="sub">SmartFarm 영농관리 시스템</div>
</div>
<div class="meta"><span>출력일: ${now}</span><span>총 ${rows.length}건</span></div>
<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${
  rows.map(row=>`<tr>${row.map(cell=>{
    const s=String(cell||"");
    return`<td${s.length>20?' class="left"':''}>${s||"-"}</td>`;
  }).join("")}</tr>`).join("")
}</tbody></table>${
  photos&&photos.length>0?`
<div class="photo-section">
  <h2>📷 첨부 사진</h2>
  ${photos.map(p=>`
  <div class="entry-photos">
    <h3>${p.label}</h3>
    <div class="photos">${p.urls.map(u=>`<img src="${u}" alt="사진" onerror="this.style.display='none'" />`).join("")}</div>
  </div>`).join("")}
</div>`:""
}
<div class="footer">SmartFarm 영농일지 시스템 | ${now} 출력</div>
</body></html>`;
}

// ━━━ 인쇄 기능 (사진 포함) ━━━
function printRecords(title,headers,rows,photos){
  const html=buildDocHTML(title,headers,rows,photos,"print");
  const w=window.open("","_blank","width=1000,height=800");
  w.document.write(html);
  w.document.close();
  // 이미지 로드 대기 후 인쇄
  const imgs=w.document.querySelectorAll("img");
  if(imgs.length>0){
    let loaded=0;
    const tryPrint=()=>{loaded++;if(loaded>=imgs.length)setTimeout(()=>w.print(),300)};
    imgs.forEach(img=>{if(img.complete)tryPrint();else{img.onload=tryPrint;img.onerror=tryPrint}});
    setTimeout(()=>w.print(),3000); // 안전장치: 3초 후 강제 인쇄
  }else{setTimeout(()=>w.print(),300)}
}

// ━━━ CSV 저장 ━━━
function downloadCSV(filename,headers,rows){
  const BOM="\uFEFF";
  const csv=BOM+[headers.join(","),...rows.map(r=>r.map(c=>`"${String(c||"").replace(/"/g,'""')}"`).join(","))].join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
}

// ━━━ PDF 파일 저장 (사진 포함, 바로 다운로드) ━━━
// jspdf, html2canvas는 npm install 필요: npm install jspdf html2canvas
async function downloadPDF(title,headers,rows,filename,photos){
  try{
    const [{ default: jsPDF },{ default: html2canvas }]=await Promise.all([
      import("jspdf"),
      import("html2canvas")
    ]);

    // 숨겨진 컨테이너에 HTML 렌더링
    const container=document.createElement("div");
    container.style.cssText="position:fixed;left:-9999px;top:0;width:1100px;background:#fff;padding:30px;font-family:'맑은 고딕',sans-serif;color:#1a1a1a;font-size:11px;line-height:1.6;z-index:-1";
    
    // HTML 빌드 (style 태그 제거하고 인라인으로)
    const bodyContent=buildDocHTML(title,headers,rows,photos,"pdf")
      .replace(/<!DOCTYPE[^>]*>/gi,"").replace(/<\/?html[^>]*>/gi,"").replace(/<\/?head[^>]*>/gi,"")
      .replace(/<\/?body[^>]*>/gi,"").replace(/<meta[^>]*>/gi,"").replace(/<title[^>]*>[^<]*<\/title>/gi,"")
      .replace(/<style[\s\S]*?<\/style>/gi,"");

    const styleEl=document.createElement("style");
    styleEl.textContent=`
      .header{text-align:center;margin-bottom:20px;padding-bottom:15px;border-bottom:3px double #2d5a2d}
      .header h1{font-size:22px;color:#2d5a2d;margin-bottom:4px;letter-spacing:2px}
      .header .sub{font-size:12px;color:#666;margin-top:4px}
      .meta{display:flex;justify-content:space-between;margin-bottom:12px;font-size:10px;color:#888}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{background:#2d5a2d;color:#fff;padding:7px 8px;text-align:center;font-size:10px;font-weight:600;border:1px solid #2d5a2d}
      td{padding:6px 8px;border:1px solid #d1d5db;text-align:center;font-size:10px;vertical-align:top;word-break:break-all}
      td.left{text-align:left}
      tr:nth-child(even) td{background:#f8faf8}
      .photo-section{margin-top:30px}
      .photo-section h2{font-size:16px;color:#2d5a2d;margin-bottom:15px;padding-bottom:8px;border-bottom:2px solid #2d5a2d}
      .entry-photos{margin-bottom:20px}
      .entry-photos h3{font-size:12px;color:#333;margin-bottom:8px;padding:4px 8px;background:#f0f7f0;border-left:3px solid #2d5a2d}
      .entry-photos .photos{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
      .entry-photos .photos img{width:200px;height:150px;object-fit:cover;border:1px solid #d1d5db;border-radius:4px}
      .footer{margin-top:25px;text-align:center;color:#aaa;font-size:9px;padding-top:15px;border-top:1px solid #e5e7eb}
    `;
    container.appendChild(styleEl);
    container.insertAdjacentHTML("beforeend",bodyContent);
    document.body.appendChild(container);

    // 이미지 로드 대기
    const imgs=container.querySelectorAll("img");
    if(imgs.length>0){
      await Promise.all([...imgs].map(img=>new Promise(r=>{if(img.complete)r();else{img.onload=r;img.onerror=()=>{img.style.display="none";r()}}})));
      await new Promise(r=>setTimeout(r,300));
    }

    // html2canvas 캡처
    const canvas=await html2canvas(container,{scale:2,useCORS:true,allowTaint:true,logging:false});
    document.body.removeChild(container);

    // PDF 생성 (A4 가로)
    const pdf=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});
    const pageW=pdf.internal.pageSize.getWidth();
    const pageH=pdf.internal.pageSize.getHeight();
    const margin=10;
    const contentW=pageW-margin*2;

    // 여러 페이지 슬라이스
    const pageContentH=pageH-margin*2;
    const sliceH=Math.floor(canvas.width*(pageContentH/contentW));
    let y=0;let page=0;
    while(y<canvas.height){
      if(page>0)pdf.addPage();
      const ch=Math.min(sliceH,canvas.height-y);
      const sliceCanvas=document.createElement("canvas");
      sliceCanvas.width=canvas.width;sliceCanvas.height=ch;
      sliceCanvas.getContext("2d").drawImage(canvas,0,y,canvas.width,ch,0,0,canvas.width,ch);
      const sliceImgH=contentW*(ch/canvas.width);
      pdf.addImage(sliceCanvas.toDataURL("image/jpeg",0.92),"JPEG",margin,margin,contentW,sliceImgH);
      y+=ch;page++;
    }

    pdf.save(`${filename}.pdf`);
  }catch(err){
    console.error("PDF 생성 실패:",err);
    alert("PDF 저장을 위해 패키지 설치가 필요합니다.\n프론트엔드 폴더에서:\nnpm install jspdf html2canvas");
  }
}

// ━━━ 내보내기 버튼 ━━━
function ExportButtons({onPrint,onCSV,onPDF}){
  const[pdfLoading,setPdfLoading]=useState(false);
  const handlePDF=async()=>{setPdfLoading(true);try{await onPDF()}finally{setPdfLoading(false)}};
  return(
    <div className="flex gap-2">
      <button onClick={onPrint} className="px-3 py-1.5 rounded-lg text-xs bg-white !text-gray-700 border border-gray-300 hover:bg-gray-50 transition-all flex items-center gap-1 font-medium">🖨️ 인쇄</button>
      <button onClick={onCSV} className="px-3 py-1.5 rounded-lg text-xs bg-white !text-emerald-700 border border-emerald-300 hover:bg-emerald-50 transition-all flex items-center gap-1 font-medium">📥 CSV</button>
      <button onClick={handlePDF} disabled={pdfLoading} className="px-3 py-1.5 rounded-lg text-xs bg-rose-50 !text-rose-700 border border-rose-300 hover:bg-rose-100 transition-all flex items-center gap-1 disabled:opacity-50 font-medium">{pdfLoading?"⏳ 생성중...":"📄 PDF"}</button>
    </div>
  );
}

// ━━━ 메인 ━━━
export default function JournalManager({ farmId = import.meta.env.VITE_FARM_ID || "farm_0001" }){
  const[activeTab,setActiveTab]=useState("journal");
  const[summary,setSummary]=useState(null);
  const tabs=[{key:"journal",label:"영농일지",icon:"📝"},{key:"harvest",label:"수확",icon:"🌾"},{key:"input",label:"투입물",icon:"💊"},{key:"inventory",label:"자재대장",icon:"📦"},{key:"summary",label:"통계",icon:"📊"}];
  useEffect(()=>{if(activeTab==="summary")api(`/journal/${farmId}/summary`).then(r=>setSummary(r.data)).catch(console.error)},[activeTab,farmId]);
  return(
    <FarmIdCtx.Provider value={farmId}>
    <div className="space-y-2 md:space-y-6">
      <div className="hidden md:block"><h2 className="text-2xl font-bold text-white">영농일지</h2><p className="text-gray-400 mt-1">작업 기록, 수확, 투입물, 자재 대장</p></div>
      <div className="flex gap-2 flex-wrap">{tabs.map(tab=>(<button key={tab.key} onClick={()=>setActiveTab(tab.key)} className={`flex items-center justify-center gap-1.5 px-3 md:px-4 py-2.5 rounded-xl font-semibold transition-all text-sm flex-1 md:flex-none active:scale-[0.97] ${activeTab===tab.key?"bg-blue-600 text-white shadow-lg shadow-blue-600/20":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"}`}><span className="text-lg">{tab.icon}</span><span className="hidden md:inline">{tab.label}</span><span className="md:hidden text-xs">{tab.label}</span></button>))}</div>
      {activeTab==="journal"&&<JournalTab />}
      {activeTab==="harvest"&&<HarvestTab />}
      {activeTab==="input"&&<InputTab />}
      {activeTab==="inventory"&&<InventoryTab />}
      {activeTab==="summary"&&<SummaryTab data={summary} />}
    </div>
    </FarmIdCtx.Provider>
  );
}

// ━━━ 미니 달력 ━━━
function MiniCalendar({selectedDate,onDateSelect,entryDates}){
  const[viewDate,setViewDate]=useState(()=>{const d=selectedDate?new Date(selectedDate):new Date();return{year:d.getFullYear(),month:d.getMonth()}});
  const todayStr=formatDate(new Date());const selectedStr=selectedDate||"";
  const entrySet=useMemo(()=>new Set(entryDates||[]),[entryDates]);
  const daysInMonth=new Date(viewDate.year,viewDate.month+1,0).getDate();
  const firstDay=new Date(viewDate.year,viewDate.month,1).getDay();
  const dayNames=["일","월","화","수","목","금","토"];
  const prev=()=>setViewDate(p=>{const d=new Date(p.year,p.month-1,1);return{year:d.getFullYear(),month:d.getMonth()}});
  const next=()=>setViewDate(p=>{const d=new Date(p.year,p.month+1,1);return{year:d.getFullYear(),month:d.getMonth()}});
  const cells=[];for(let i=0;i<firstDay;i++)cells.push(null);for(let d=1;d<=daysInMonth;d++)cells.push(d);
  return(
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prev} className="text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-white/10">◀</button>
        <span className="text-sm font-semibold text-white">{viewDate.year}년 {viewDate.month+1}월</span>
        <button onClick={next} className="text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-white/10">▶</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center mb-1">{dayNames.map((d,i)=><div key={d} className={`text-[10px] font-medium py-1 ${i===0?"text-red-400":i===6?"text-blue-400":"text-gray-500"}`}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-0.5 text-center">{cells.map((day,i)=>{
        if(!day)return<div key={`e${i}`}/>;
        const ds=`${viewDate.year}-${String(viewDate.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const isT=ds===todayStr,isS=ds===selectedStr,has=entrySet.has(ds),dow=new Date(viewDate.year,viewDate.month,day).getDay();
        return(<button key={day} onClick={()=>onDateSelect(ds)} className={`relative w-8 h-8 mx-auto flex items-center justify-center text-xs rounded-full transition-all hover:bg-white/10 ${isS?"cal-selected":isT?"cal-today":""} ${!isS&&!isT&&dow===0?"text-red-400":""} ${!isS&&!isT&&dow===6?"text-blue-400":""} ${!isS&&!isT&&dow>0&&dow<6?"text-gray-300":""} ${has?"cal-has-entry font-semibold":""}`}>{day}</button>);
      })}</div>
      <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500"></span>오늘</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span>기록 있음</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span>선택됨</span>
      </div>
    </div>
  );
}

// ━━━ 공통 ━━━
function SearchFilterBar({dateRange,setDateRange,periodLabel,setPeriod,selectedDate,setSelectedDate,children}){
  return(
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-600 font-medium">조회기간</span>
        {[["1개월",1],["3개월",3],["6개월",6],["1년",12]].map(([label,m])=>(<button key={label} onClick={()=>setPeriod(label,m)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${periodLabel===label?"bg-blue-600 text-white":"bg-white/5 text-gray-400 hover:bg-white/10"}`}>{label}</button>))}
        <div className="flex items-center gap-1 ml-2">
          <input type="date" value={dateRange.start} onChange={e=>{setDateRange(p=>({...p,start:e.target.value}));setPeriod("",0);setSelectedDate(null)}} className="input-field text-xs py-1 px-2 w-32" />
          <span className="text-gray-500 text-xs">~</span>
          <input type="date" value={dateRange.end} onChange={e=>{setDateRange(p=>({...p,end:e.target.value}));setPeriod("",0);setSelectedDate(null)}} className="input-field text-xs py-1 px-2 w-32" />
        </div>
        {selectedDate&&<span className="px-2 py-1 rounded-lg text-xs bg-blue-500/20 text-blue-400 flex items-center gap-1">📅 {toKR(selectedDate)}<button onClick={()=>setSelectedDate(null)} className="hover:text-white ml-1">×</button></span>}
      </div>
      {children}
    </div>
  );
}

function useDateFilter(){
  const now=new Date();const ms=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
  const[dateRange,setDateRange]=useState({start:ms,end:formatDate(now)});
  const[periodLabel,setPeriodLabel]=useState("1개월");
  const[selectedDate,setSelectedDate]=useState(null);
  const setPeriod=(label,months)=>{if(!months){setPeriodLabel(label);return}const end=new Date();const start=new Date();start.setMonth(start.getMonth()-months);setDateRange({start:formatDate(start),end:formatDate(end)});setPeriodLabel(label);setSelectedDate(null)};
  const handleDateSelect=ds=>setSelectedDate(p=>p===ds?null:ds);
  const resetFilters=()=>{setPeriod("1개월",1);setSelectedDate(null)};
  return{dateRange,setDateRange,periodLabel,setPeriod,selectedDate,setSelectedDate,handleDateSelect,resetFilters};
}

function DetailRow({label,value,color,markdown}){if(!value&&value!==0)return null;return(<div className="flex"><span className="text-xs text-gray-500 w-20 shrink-0">{label}</span><span className={`text-xs ${color||"!text-gray-700"} whitespace-pre-wrap flex-1`}>{markdown?<MarkdownText text={String(value)} />:value}</span></div>)}

// ━━━ 간단 마크다운 렌더러 (P1-D) ━━━
// 농민 메모 수준만 지원: # 제목, ## 작은제목, **굵은**, *기울임*, `코드`, - 리스트, 1. 번호 리스트, 줄바꿈
function MarkdownInline({ text }) {
  if (!text) return null;
  const parts = [];
  const re = /\*\*([^*]+?)\*\*|\*([^*]+?)\*|`([^`]+?)`/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={key++} className="font-bold">{m[1]}</strong>);
    else if (m[2]) parts.push(<em key={key++} className="italic">{m[2]}</em>);
    else if (m[3]) parts.push(<code key={key++} className="bg-gray-100 px-1 rounded text-[0.95em] font-mono !text-rose-700">{m[3]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
function MarkdownText({ text }) {
  if (!text) return null;
  const blocks = String(text).split(/\n\s*\n+/);
  return (
    <div className="space-y-1.5">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        // 불릿 리스트
        if (lines.every((l) => /^\s*[-*]\s/.test(l))) {
          return (
            <ul key={bi} className="list-disc pl-5 space-y-0.5">
              {lines.map((l, i) => <li key={i}><MarkdownInline text={l.replace(/^\s*[-*]\s/, '')} /></li>)}
            </ul>
          );
        }
        // 번호 리스트
        if (lines.every((l) => /^\s*\d+\.\s/.test(l))) {
          return (
            <ol key={bi} className="list-decimal pl-5 space-y-0.5">
              {lines.map((l, i) => <li key={i}><MarkdownInline text={l.replace(/^\s*\d+\.\s/, '')} /></li>)}
            </ol>
          );
        }
        // 헤더 (블록 단독)
        if (lines.length === 1) {
          const h1 = /^#\s+(.+)/.exec(lines[0]);
          if (h1) return <div key={bi} className="text-sm font-bold !text-gray-900 mt-1"><MarkdownInline text={h1[1]} /></div>;
          const h2 = /^##\s+(.+)/.exec(lines[0]);
          if (h2) return <div key={bi} className="text-xs font-bold !text-gray-800 mt-0.5"><MarkdownInline text={h2[1]} /></div>;
        }
        // 일반 단락 — 줄바꿈 보존
        return (
          <p key={bi} className="whitespace-pre-line">
            {lines.map((l, i) => (
              <span key={i}>{i > 0 && <br />}<MarkdownInline text={l} /></span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 영농일지 탭
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function JournalTab(){
  const[subTab,setSubTab]=useState("list");
  const tabBtn=(id,emoji,label)=>(
    <button key={id} onClick={()=>setSubTab(id)} className={`flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-xl text-sm font-medium transition-all min-w-0 active:scale-[0.97] ${subTab===id?"bg-blue-600 text-white shadow-lg shadow-blue-600/20":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"}`}><span className="flex-shrink-0">{emoji}</span><span className="truncate">{label}</span></button>
  );
  return(<div className="space-y-4"><div className="flex gap-1.5 flex-wrap">
    {tabBtn("list","📋","일지 조회")}
    {tabBtn("write","✏️","일지 작성")}
    {tabBtn("gallery","📸","사진 갤러리")}
    {tabBtn("analytics","📊","분석")}
  </div>
  {subTab==="list"&&<JournalSearch />}
  {subTab==="write"&&<JournalWrite />}
  {subTab==="gallery"&&<PhotoGallery />}
  {subTab==="analytics"&&<JournalAnalytics />}
  </div>);
}

// ━━━ 분석 — 생육 측정 시계열 (P2-1) ━━━
// farmJournal 의 measurements JSON 을 시간순으로 모아 그래프
// 표준 4 필드 (초장/엽수/개화율/착과율) + 사용자 정의 metric 선택
const MEASURE_LINE_COLORS = {
  plantHeight: "#10b981",   // emerald
  leafCount: "#3b82f6",     // blue
  floweringRate: "#ec4899", // pink
  fruitSetRate: "#f59e0b",  // amber
};
const MEASURE_LINE_LABELS = {
  plantHeight: "초장(cm)",
  leafCount: "엽수(장)",
  floweringRate: "개화율(%)",
  fruitSetRate: "착과율(%)",
};
// ━━━ 권장 작업 / 알림 (일지 기반 룰) ━━━
// 룰:
// 1) 마지막 방제일 + 14일 경과 → 다음 방제 검토
// 2) 마지막 측정일 + 7일 경과 → 생육 측정 누락
// 3) 병해충 발견 후 7일 경과 → 후속 조치 확인
// 4) 작년 같은 시기(±3일)에 했던 작업 → "작년 이맘때는 X"
function JournalRecommendations({ entries, entriesYoY, houses, houseId }) {
  const recs = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const filtered = entries.filter(e => !houseId || e.houseId === houseId);
    const list = [];

    const dayDiff = (date) => {
      if (!date) return Infinity;
      const d = new Date(date);
      return Math.floor((today - d) / (1000 * 3600 * 24));
    };

    // 1) 마지막 방제일
    const lastSpray = filtered.filter(e => e.workType === "방제").sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    if (lastSpray) {
      const diff = dayDiff(lastSpray.date);
      if (diff >= 14 && diff < 60) {
        list.push({
          icon: "🧪",
          color: "amber",
          title: `방제 검토 시점`,
          desc: `마지막 방제 ${diff}일 전 (${toKR(lastSpray.date)}). PLS 안전사용기준 확인 후 다음 방제 검토.`,
        });
      }
    } else if (filtered.length >= 5) {
      list.push({ icon: "🧪", color: "amber", title: "방제 기록 없음", desc: "최근 5건 일지에 방제 작업이 없습니다. 정기 점검 권장." });
    }

    // 2) 마지막 측정일
    const lastMeasure = filtered.filter(e => {
      const m = e.measurements || {};
      return ["plantHeight", "leafCount", "floweringRate", "fruitSetRate"].some(k => m[k] != null);
    }).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    if (lastMeasure) {
      const diff = dayDiff(lastMeasure.date);
      if (diff >= 7) {
        list.push({
          icon: "📈",
          color: "blue",
          title: `생육 측정 누락 ${diff}일`,
          desc: `마지막 측정 ${toKR(lastMeasure.date)}. 매주 측정으로 추세 파악 정확도 ↑.`,
        });
      }
    } else if (filtered.length >= 3) {
      list.push({ icon: "📈", color: "blue", title: "생육 측정 시작 권장", desc: "측정값 0건. 일지 작성 시 📈 측정 영역 입력으로 시계열 분석 가능." });
    }

    // 3) 병해충 발견 후 후속 조치
    const lastPest = filtered.filter(e => e.pest && e.pest.trim()).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    if (lastPest) {
      const diff = dayDiff(lastPest.date);
      if (diff >= 5 && diff <= 21) {
        // 그 사이에 방제 작업 있었나?
        const sprayAfter = filtered.find(e => e.workType === "방제" && e.date && e.date > lastPest.date);
        if (!sprayAfter) {
          list.push({
            icon: "⚠",
            color: "rose",
            title: `병해 후속 조치 필요`,
            desc: `${toKR(lastPest.date)}에 "${lastPest.pest}" 발견 후 ${diff}일 — 방제 기록 없음.`,
          });
        }
      }
    }

    // 4) 작년 같은 시기 ±3일 작업
    if (Array.isArray(entriesYoY) && entriesYoY.length > 0) {
      const today_mmdd = todayStr.slice(5);
      const close = entriesYoY.filter(e => {
        const m = (e.date || "").slice(5);
        if (!m) return false;
        // mmdd 차이 ±3일 (단순 비교)
        return Math.abs(parseInt(m.replace("-", "")) - parseInt(today_mmdd.replace("-", ""))) <= 3;
      });
      const types = [...new Set(close.map(e => e.workType).filter(Boolean))];
      if (types.length > 0) {
        list.push({
          icon: "📅",
          color: "violet",
          title: `작년 이맘때는`,
          desc: `${types.join(", ")} 작업을 했습니다 (${close.length}건). 분석 탭의 작년 비교 ON 으로 자세히.`,
        });
      }
    }

    return list;
  }, [entries, entriesYoY, houseId]);

  if (recs.length === 0) return null;

  const colorMap = {
    amber: "bg-amber-50 border-amber-300 !text-amber-900",
    blue: "bg-blue-50 border-blue-300 !text-blue-900",
    rose: "bg-rose-50 border-rose-300 !text-rose-900",
    violet: "bg-violet-50 border-violet-300 !text-violet-900",
    emerald: "bg-emerald-50 border-emerald-300 !text-emerald-900",
  };

  return (
    <div className="glass-card p-4">
      <h4 className="text-sm font-bold !text-gray-800 mb-3 flex items-center gap-2">
        📌 권장 작업
        <span className="text-[10px] !text-gray-500 font-normal">— 일지 데이터 기반</span>
      </h4>
      <div className="space-y-2">
        {recs.map((r, i) => (
          <div key={i} className={`rounded-lg border-2 px-3 py-2 flex items-start gap-2 ${colorMap[r.color] || colorMap.blue}`}>
            <span className="text-lg leading-none mt-0.5">{r.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold">{r.title}</div>
              <div className="text-[11px] mt-0.5 opacity-90">{r.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ━━━ AI 자동 요약 (P2-4) ━━━
function AiSummaryCard({ farmId }) {
  const [period, setPeriod] = useState("week");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const run = async () => {
    setLoading(true); setError(null);
    try {
      const r = await api(`/journal/${farmId}/ai-summary?period=${period}`);
      if (r?.success) setData(r.data);
    } catch (e) { setError(e?.message || "분석 실패"); }
    finally { setLoading(false); }
  };
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h4 className="text-sm font-bold !text-gray-800 flex items-center gap-2">✨ AI 자동 요약</h4>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button type="button" onClick={() => setPeriod("week")} className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${period === "week" ? "bg-white !text-violet-800 shadow-sm" : "!text-gray-600"}`}>주간</button>
            <button type="button" onClick={() => setPeriod("month")} className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${period === "month" ? "bg-white !text-violet-800 shadow-sm" : "!text-gray-600"}`}>월간</button>
          </div>
          <button type="button" onClick={run} disabled={loading}
            className="px-3 py-1 rounded-md text-xs font-semibold bg-violet-100 !text-violet-800 border border-violet-400 hover:bg-violet-200 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? "분석 중..." : "✨ 요약 생성"}
          </button>
        </div>
      </div>
      {error && <div className="text-xs !text-rose-700 bg-rose-50 border border-rose-300 rounded-md px-3 py-2">{error}</div>}
      {!data && !loading && !error && (
        <div className="text-xs !text-gray-500 text-center py-4">"✨ 요약 생성" 버튼을 누르면 최근 {period === "week" ? "1주일" : "1개월"} 일지를 AI 가 요약합니다.</div>
      )}
      {data && (
        <div className="space-y-3 text-sm">
          {data.summary && (
            <div className="bg-violet-50 border border-violet-300 rounded-lg p-3">
              <div className="text-[11px] !text-violet-700 font-semibold mb-1">요약</div>
              <div className="!text-gray-800"><MarkdownText text={data.summary} /></div>
            </div>
          )}
          {Array.isArray(data.highlights) && data.highlights.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
              <div className="text-[11px] !text-amber-700 font-semibold mb-1">하이라이트</div>
              <ul className="list-disc pl-4 space-y-0.5 text-xs !text-gray-800">
                {data.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(data.suggestions) && data.suggestions.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3">
              <div className="text-[11px] !text-emerald-700 font-semibold mb-1">권장 작업</div>
              <ul className="list-disc pl-4 space-y-0.5 text-xs !text-gray-800">
                {data.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {data.stats?.trendNotes && (
            <div className="text-[11px] !text-gray-600 italic">📈 {data.stats.trendNotes}</div>
          )}
          <div className="text-[10px] !text-gray-500 pt-2 border-t border-gray-200">
            대상 일지 {data.stats?.entryCount || 0}건 · {period === "week" ? "최근 7일" : "최근 30일"}
          </div>
        </div>
      )}
    </div>
  );
}

// ━━━ 일지 타임라인 (P2-3) ━━━
// 분석 탭 안: 같은 기간/하우스의 모든 일지를 시간순 compact 카드로
function JournalTimeline({ entries, houses, houseId }) {
  const filtered = useMemo(() => {
    return entries
      .filter(e => !houseId || e.houseId === houseId)
      .map(e => ({ ...e, _sortKey: e.date || "" }))
      .sort((a, b) => b._sortKey.localeCompare(a._sortKey)); // 최신 순
  }, [entries, houseId]);

  if (entries.length === 0) return null;

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold !text-gray-800">📅 일지 타임라인</h4>
        <span className="text-[10px] !text-gray-500">{filtered.length}건 · 최신순</span>
      </div>
      {filtered.length === 0 ? (
        <div className="text-xs !text-gray-400 text-center py-6">조건에 맞는 일지가 없습니다</div>
      ) : (
        <div className="relative pl-4">
          {/* 좌측 세로 라인 */}
          <div className="absolute left-1.5 top-1 bottom-1 w-px bg-gray-200"></div>
          <div className="space-y-3">
            {filtered.slice(0, 50).map((e, i) => {
              const houseName = houses.find(h => h.houseId === e.houseId)?.houseName || e.houseId || "공통";
              const m = e.measurements || {};
              const hasMeasure = ["plantHeight", "leafCount", "floweringRate", "fruitSetRate"].some(k => m[k] != null);
              const photo = Array.isArray(e.photos) && e.photos.length > 0 ? e.photos[0] : null;
              return (
                <div key={e._id || i} className="relative">
                  {/* 좌측 점 */}
                  <div className="absolute -left-3.5 top-1 w-3 h-3 rounded-full border-2 border-white" style={{ backgroundColor: workTypeColor(e.workType) }}></div>
                  <div className="flex gap-3 items-start">
                    {photo && (
                      <img src={photoUrl(photo)} alt="" loading="lazy"
                        className="w-14 h-14 object-cover rounded-md border border-gray-200 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs !text-gray-500 font-medium">{toKR(e.date)}</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold !text-white" style={{ backgroundColor: workTypeColor(e.workType) }}>{e.workType}</span>
                        {e.houseId && <span className="text-[10px] !text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded-full font-medium">{houseName}</span>}
                        {e.growthStage && <span className="text-[10px] !text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full font-medium">{e.growthStage}</span>}
                        {e.pest && <span className="text-[10px] !text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-full font-medium">⚠ {e.pest}</span>}
                      </div>
                      <div className="text-xs !text-gray-700 line-clamp-2 mb-1">{e.content}</div>
                      {hasMeasure && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {m.plantHeight != null && <span className="px-1.5 py-0.5 bg-emerald-100 !text-emerald-800 border border-emerald-300 rounded-full text-[10px] font-medium">초장 {m.plantHeight}cm</span>}
                          {m.leafCount != null && <span className="px-1.5 py-0.5 bg-blue-100 !text-blue-800 border border-blue-300 rounded-full text-[10px] font-medium">엽수 {m.leafCount}장</span>}
                          {m.floweringRate != null && <span className="px-1.5 py-0.5 bg-pink-100 !text-pink-800 border border-pink-300 rounded-full text-[10px] font-medium">개화 {m.floweringRate}%</span>}
                          {m.fruitSetRate != null && <span className="px-1.5 py-0.5 bg-amber-100 !text-amber-800 border border-amber-300 rounded-full text-[10px] font-medium">착과 {m.fruitSetRate}%</span>}
                        </div>
                      )}
                      {Array.isArray(e.tags) && e.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {e.tags.slice(0, 5).map(t => (
                            <span key={t} className="text-[10px] !text-emerald-700">#{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length > 50 && (
            <div className="text-center text-[10px] !text-gray-500 mt-3">+{filtered.length - 50}건 — 일지 조회 탭에서 전체 보기</div>
          )}
        </div>
      )}
    </div>
  );
}

// 작업유형별 색
function workTypeColor(type) {
  const map = {
    "파종": "#10b981", "정식": "#059669",
    "관수": "#3b82f6", "시비": "#6366f1",
    "방제": "#ef4444", "수확": "#f59e0b",
    "관리": "#8b5cf6", "기타": "#6b7280",
  };
  return map[type] || "#6b7280";
}

// 날짜 → 작년 같은 month-day
function shiftYear(dateStr, deltaYears) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + deltaYears);
  return d.toISOString().split("T")[0];
}
function JournalAnalytics(){const FARM_ID=useContext(FarmIdCtx);
  const df=useDateFilter();
  const[entries,setEntries]=useState([]);const[loading,setLoading]=useState(true);
  const[entriesYoY,setEntriesYoY]=useState([]);  // 작년 같은 시기
  const[yoyEnabled,setYoyEnabled]=useState(false);
  const[houses,setHouses]=useState([]);
  const[filter,setFilter]=useState({houseId:"",metrics:["plantHeight","leafCount","floweringRate","fruitSetRate"]});

  useEffect(()=>{api(`/config/farm/${FARM_ID}`).then(r=>setHouses(r.data||[])).catch(()=>{})},[FARM_ID]);
  useEffect(()=>{
    let url=`/journal/${FARM_ID}/entries?limit=500`;
    if(df.dateRange.start)url+=`&startDate=${df.dateRange.start}`;
    if(df.dateRange.end)url+=`&endDate=${df.dateRange.end}`;
    setLoading(true);
    api(url).then(r=>setEntries(r.data||[])).finally(()=>setLoading(false));
  },[FARM_ID,df.dateRange]);
  // YoY 토글 시 작년 같은 시기 데이터 fetch
  useEffect(()=>{
    if(!yoyEnabled||!df.dateRange.start||!df.dateRange.end){setEntriesYoY([]);return;}
    const ys=shiftYear(df.dateRange.start,-1);
    const ye=shiftYear(df.dateRange.end,-1);
    api(`/journal/${FARM_ID}/entries?limit=500&startDate=${ys}&endDate=${ye}`).then(r=>setEntriesYoY(r.data||[])).catch(()=>setEntriesYoY([]));
  },[yoyEnabled,FARM_ID,df.dateRange]);

  // measurements 있는 일지만 + 하우스 필터
  const buildPoints=(arr)=>arr
    .filter(e=>{
      if(filter.houseId&&e.houseId!==filter.houseId)return false;
      const m=e.measurements;
      if(!m||typeof m!=='object')return false;
      return ['plantHeight','leafCount','floweringRate','fruitSetRate'].some(k=>m[k]!=null);
    })
    .map(e=>({
      date:e.date?.split('T')[0],
      dateLabel:toKR(e.date),
      mmdd:(e.date?.split('T')[0]||'').slice(5), // 월-일 키 (YoY 매핑용)
      plantHeight:e.measurements?.plantHeight ?? null,
      leafCount:e.measurements?.leafCount ?? null,
      floweringRate:e.measurements?.floweringRate ?? null,
      fruitSetRate:e.measurements?.fruitSetRate ?? null,
      houseId:e.houseId,
      custom:e.measurements?.custom||[],
    }))
    .sort((a,b)=>a.date.localeCompare(b.date));
  const measurePoints=useMemo(()=>buildPoints(entries),[entries,filter]);
  const measurePointsYoY=useMemo(()=>buildPoints(entriesYoY),[entriesYoY,filter]);

  // 사용자 정의 metric 이름 모음
  const customNames=useMemo(()=>{
    const set=new Set();
    measurePoints.forEach(p=>(p.custom||[]).forEach(c=>{if(c.name)set.add(c.name);}));
    return Array.from(set).sort();
  },[measurePoints]);

  const toggleMetric=(k)=>{
    setFilter(p=>({...p,metrics:p.metrics.includes(k)?p.metrics.filter(x=>x!==k):[...p.metrics,k]}));
  };

  // 사용자 정의 metric 1 개 선택 시 데이터에 평탄화
  const[selectedCustom,setSelectedCustom]=useState("");
  // YoY 모드: mmdd 키 기준 올해/작년 동시 매핑
  const chartData=useMemo(()=>{
    if(yoyEnabled){
      // mmdd 합집합 — 올해 또는 작년에 데이터 있는 모든 월-일
      const map=new Map();
      measurePoints.forEach(p=>{
        const cur=map.get(p.mmdd)||{mmdd:p.mmdd,dateLabel:p.mmdd};
        ['plantHeight','leafCount','floweringRate','fruitSetRate'].forEach(k=>{cur[k]=p[k];});
        if(selectedCustom){const c=(p.custom||[]).find(x=>x.name===selectedCustom);cur.__custom__=c?Number(c.value):null;}
        map.set(p.mmdd,cur);
      });
      measurePointsYoY.forEach(p=>{
        const cur=map.get(p.mmdd)||{mmdd:p.mmdd,dateLabel:p.mmdd};
        ['plantHeight','leafCount','floweringRate','fruitSetRate'].forEach(k=>{cur[`${k}_yoy`]=p[k];});
        map.set(p.mmdd,cur);
      });
      return Array.from(map.values()).sort((a,b)=>a.mmdd.localeCompare(b.mmdd));
    }
    return measurePoints.map(p=>{
      const row={...p};
      if(selectedCustom){
        const c=(p.custom||[]).find(x=>x.name===selectedCustom);
        row[`__custom__`]=c?Number(c.value):null;
      }
      return row;
    });
  },[measurePoints,measurePointsYoY,selectedCustom,yoyEnabled]);

  // 통계 (기간 평균/최저/최고) + YoY 비교
  const calcStats=(pts)=>{
    const out={};
    ['plantHeight','leafCount','floweringRate','fruitSetRate'].forEach(k=>{
      const vals=pts.map(p=>p[k]).filter(v=>v!=null);
      if(vals.length===0){out[k]=null;return;}
      out[k]={
        count:vals.length,
        avg:Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*10)/10,
        min:Math.min(...vals),
        max:Math.max(...vals),
        latest:vals[vals.length-1],
      };
    });
    return out;
  };
  const stats=useMemo(()=>calcStats(measurePoints),[measurePoints]);
  const statsYoY=useMemo(()=>calcStats(measurePointsYoY),[measurePointsYoY]);

  return(
    <div className="space-y-4">
      <SearchFilterBar {...df}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 font-medium">하우스</span>
            <select value={filter.houseId} onChange={e=>setFilter(p=>({...p,houseId:e.target.value}))} style={LIGHT_INPUT} className="input-field jrn-select text-xs py-1 px-2 w-32"><option value="">전체</option>{houses.map(h=><option key={h.houseId} value={h.houseId}>{h.houseName||h.houseId}</option>)}</select>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-600 font-medium">표시 항목</span>
            {['plantHeight','leafCount','floweringRate','fruitSetRate'].map(k=>(
              <button key={k} type="button" onClick={()=>toggleMetric(k)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-all ${filter.metrics.includes(k)?'!text-white':'!text-gray-600 bg-white border-gray-300 hover:bg-gray-50'}`}
                style={filter.metrics.includes(k)?{backgroundColor:MEASURE_LINE_COLORS[k],borderColor:MEASURE_LINE_COLORS[k]}:undefined}>
                {MEASURE_LINE_LABELS[k]}
              </button>
            ))}
          </div>
          {customNames.length>0&&(
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600 font-medium">사용자 측정</span>
              <select value={selectedCustom} onChange={e=>setSelectedCustom(e.target.value)} style={LIGHT_INPUT} className="input-field jrn-select text-xs py-1 px-2 w-32"><option value="">없음</option>{customNames.map(n=><option key={n} value={n}>{n}</option>)}</select>
            </div>
          )}
          <button type="button" onClick={()=>setYoyEnabled(!yoyEnabled)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${yoyEnabled?'bg-amber-100 !text-amber-800 border-amber-400':'bg-white !text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
            📅 작년 비교 {yoyEnabled?'ON':'OFF'}
          </button>
          <span className="text-xs text-gray-500 ml-auto">
            측정 {measurePoints.length}건
            {yoyEnabled&&entriesYoY.length>0&&` · 작년 ${measurePointsYoY.length}건`}
          </span>
        </div>
      </SearchFilterBar>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['plantHeight','leafCount','floweringRate','fruitSetRate'].map(k=>{
          const s=stats[k];
          const sy=yoyEnabled?statsYoY[k]:null;
          const color=MEASURE_LINE_COLORS[k];
          // YoY 평균 변화율
          const yoyDiff=(s&&sy)?Math.round((s.avg-sy.avg)*10)/10:null;
          const yoyPct=(s&&sy&&sy.avg!==0)?Math.round((s.avg-sy.avg)/sy.avg*100):null;
          return(
            <div key={k} className="glass-card p-3" style={{borderTop:`3px solid ${color}`}}>
              <div className="text-[11px] !text-gray-600 font-medium mb-1">{MEASURE_LINE_LABELS[k]}</div>
              {s?(<>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold !text-gray-900">{s.latest}</span>
                  <span className="text-[10px] !text-gray-500">최근값</span>
                </div>
                <div className="text-[10px] !text-gray-500 mt-0.5">평균 {s.avg} · 최저 {s.min} · 최고 {s.max} · {s.count}회</div>
                {yoyEnabled&&sy&&(
                  <div className={`text-[10px] mt-1 pt-1 border-t border-gray-200 font-medium ${yoyDiff>0?'!text-emerald-700':yoyDiff<0?'!text-rose-700':'!text-gray-500'}`}>
                    작년 평균 {sy.avg} · {yoyDiff>0?'▲':yoyDiff<0?'▼':'='} {Math.abs(yoyDiff)}{yoyPct!=null&&` (${yoyPct>0?'+':''}${yoyPct}%)`}
                  </div>
                )}
                {yoyEnabled&&!sy&&(
                  <div className="text-[10px] mt-1 pt-1 border-t border-gray-200 !text-gray-400">작년 측정 없음</div>
                )}
              </>):(
                <div className="text-xs !text-gray-400">측정 없음</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 📌 권장 작업 / 알림 — 일지 데이터 기반 룰 */}
      <JournalRecommendations entries={entries} entriesYoY={entriesYoY} houses={houses} houseId={filter.houseId} />

      {/* AI 자동 요약 (P2-4) */}
      <AiSummaryCard farmId={FARM_ID} />

      {/* 일지 타임라인 (P2-3) — 같은 기간/하우스의 모든 일지를 시간순 카드로 */}
      <JournalTimeline entries={entries} houses={houses} houseId={filter.houseId} />

      {/* 차트 */}
      <div className="glass-card p-4">
        <h4 className="text-sm font-bold !text-gray-800 mb-3">생육 측정 시계열</h4>
        {loading?(
          <div className="text-center !text-gray-400 py-10 text-sm">불러오는 중...</div>
        ):measurePoints.length===0?(
          <div className="text-center py-10 text-sm">
            <div className="!text-gray-400 mb-2">측정 기록이 없습니다</div>
            <div className="!text-gray-500 text-xs">일지 작성 시 📈 생육 측정 영역에 초장/엽수 등을 입력하세요</div>
          </div>
        ):(
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{top:5,right:20,bottom:5,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="dateLabel" tick={{fontSize:11,fill:'#6b7280'}} />
              <YAxis tick={{fontSize:11,fill:'#6b7280'}} />
              <Tooltip contentStyle={{backgroundColor:'#fff',border:'1px solid #d1d5db',borderRadius:8,fontSize:12}} />
              <Legend wrapperStyle={{fontSize:12}} />
              {filter.metrics.includes('plantHeight')&&<Line type="monotone" dataKey="plantHeight" name="초장(cm)" stroke={MEASURE_LINE_COLORS.plantHeight} strokeWidth={2} dot={{r:3}} connectNulls />}
              {filter.metrics.includes('leafCount')&&<Line type="monotone" dataKey="leafCount" name="엽수(장)" stroke={MEASURE_LINE_COLORS.leafCount} strokeWidth={2} dot={{r:3}} connectNulls />}
              {filter.metrics.includes('floweringRate')&&<Line type="monotone" dataKey="floweringRate" name="개화율(%)" stroke={MEASURE_LINE_COLORS.floweringRate} strokeWidth={2} dot={{r:3}} connectNulls />}
              {filter.metrics.includes('fruitSetRate')&&<Line type="monotone" dataKey="fruitSetRate" name="착과율(%)" stroke={MEASURE_LINE_COLORS.fruitSetRate} strokeWidth={2} dot={{r:3}} connectNulls />}
              {selectedCustom&&<Line type="monotone" dataKey="__custom__" name={selectedCustom} stroke="#8b5cf6" strokeWidth={2} dot={{r:3}} connectNulls />}
              {/* 작년 비교 — 점선 + 연한 색 */}
              {yoyEnabled&&filter.metrics.includes('plantHeight')&&<Line type="monotone" dataKey="plantHeight_yoy" name="초장(작년)" stroke={MEASURE_LINE_COLORS.plantHeight} strokeWidth={1.5} strokeDasharray="4 4" strokeOpacity={0.5} dot={{r:2}} connectNulls />}
              {yoyEnabled&&filter.metrics.includes('leafCount')&&<Line type="monotone" dataKey="leafCount_yoy" name="엽수(작년)" stroke={MEASURE_LINE_COLORS.leafCount} strokeWidth={1.5} strokeDasharray="4 4" strokeOpacity={0.5} dot={{r:2}} connectNulls />}
              {yoyEnabled&&filter.metrics.includes('floweringRate')&&<Line type="monotone" dataKey="floweringRate_yoy" name="개화율(작년)" stroke={MEASURE_LINE_COLORS.floweringRate} strokeWidth={1.5} strokeDasharray="4 4" strokeOpacity={0.5} dot={{r:2}} connectNulls />}
              {yoyEnabled&&filter.metrics.includes('fruitSetRate')&&<Line type="monotone" dataKey="fruitSetRate_yoy" name="착과율(작년)" stroke={MEASURE_LINE_COLORS.fruitSetRate} strokeWidth={1.5} strokeDasharray="4 4" strokeOpacity={0.5} dot={{r:2}} connectNulls />}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ━━━ 사진 갤러리 (P1-C) ━━━
// 모든 일지의 photos 를 평탄화 — 작목/하우스/작업/날짜별 필터 + lightbox
function PhotoGallery(){const FARM_ID=useContext(FarmIdCtx);
  const df=useDateFilter();
  const[entries,setEntries]=useState([]);const[loading,setLoading]=useState(true);
  const[houses,setHouses]=useState([]);
  const[filter,setFilter]=useState({houseId:"",workType:"",tag:""});
  const[groupBy,setGroupBy]=useState("date"); // date|house|workType
  const[lightbox,setLightbox]=useState(null); // { url, entry, idx, total }

  useEffect(()=>{api(`/config/farm/${FARM_ID}`).then(r=>setHouses(r.data||[])).catch(()=>{})},[FARM_ID]);
  useEffect(()=>{
    let url=`/journal/${FARM_ID}/entries?limit=500`;
    if(df.dateRange.start)url+=`&startDate=${df.dateRange.start}`;
    if(df.dateRange.end)url+=`&endDate=${df.dateRange.end}`;
    setLoading(true);
    api(url).then(r=>{
      const all=(r.data||[]).filter(e=>Array.isArray(e.photos)&&e.photos.length>0);
      setEntries(all);
    }).finally(()=>setLoading(false));
  },[FARM_ID,df.dateRange]);

  // 평탄화 — 사진 1 장 = 1 row + 출처 일지 메타
  const photos=useMemo(()=>{
    const list=[];
    for(const e of entries){
      if(filter.houseId&&e.houseId!==filter.houseId)continue;
      if(filter.workType&&e.workType!==filter.workType)continue;
      if(filter.tag&&!(Array.isArray(e.tags)&&e.tags.includes(filter.tag)))continue;
      (e.photos||[]).forEach((p,idx)=>{
        list.push({
          url:photoUrl(p),
          date:e.date,
          houseId:e.houseId,
          houseName:houses.find(h=>h.houseId===e.houseId)?.houseName||e.houseId,
          workType:e.workType,
          growthStage:e.growthStage,
          pest:e.pest,
          content:e.content,
          tags:e.tags||[],
          entryId:e._id,
          photoIdx:idx,
          totalInEntry:e.photos.length,
        });
      });
    }
    return list;
  },[entries,filter,houses]);

  // 그룹핑
  const groups=useMemo(()=>{
    const map=new Map();
    const keyFn=p=>{
      if(groupBy==="house")return p.houseName||p.houseId||"(없음)";
      if(groupBy==="workType")return p.workType||"(없음)";
      // date — 일자
      return toKR(p.date);
    };
    for(const p of photos){
      const k=keyFn(p);
      if(!map.has(k))map.set(k,[]);
      map.get(k).push(p);
    }
    return Array.from(map.entries());
  },[photos,groupBy]);

  // 사용 가능한 태그 모음
  const allTags=useMemo(()=>{
    const set=new Set();
    entries.forEach(e=>(e.tags||[]).forEach(t=>set.add(t)));
    return Array.from(set).sort();
  },[entries]);

  return(
    <div className="space-y-4">
      <SearchFilterBar {...df}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">하우스</span>
            <select value={filter.houseId} onChange={e=>setFilter(p=>({...p,houseId:e.target.value}))} style={LIGHT_INPUT} className="input-field jrn-select text-xs py-1 px-2 w-32"><option value="">전체</option>{houses.map(h=><option key={h.houseId} value={h.houseId}>{h.houseName||h.houseId}</option>)}</select>
          </div>
          <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">작업</span>
            <select value={filter.workType} onChange={e=>setFilter(p=>({...p,workType:e.target.value}))} style={LIGHT_INPUT} className="input-field jrn-select text-xs py-1 px-2 w-28"><option value="">전체</option>{WORK_TYPES.map(w=><option key={w} value={w}>{w}</option>)}</select>
          </div>
          {allTags.length>0&&(
            <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">태그</span>
              <select value={filter.tag} onChange={e=>setFilter(p=>({...p,tag:e.target.value}))} style={LIGHT_INPUT} className="input-field jrn-select text-xs py-1 px-2 w-32"><option value="">전체</option>{allTags.map(t=><option key={t} value={t}>#{t}</option>)}</select>
            </div>
          )}
          <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">묶음</span>
            <select value={groupBy} onChange={e=>setGroupBy(e.target.value)} style={LIGHT_INPUT} className="input-field jrn-select text-xs py-1 px-2 w-24">
              <option value="date">날짜별</option>
              <option value="house">하우스별</option>
              <option value="workType">작업별</option>
            </select>
          </div>
          <button onClick={()=>{setFilter({houseId:"",workType:"",tag:""});df.resetFilters();}} className="px-3 py-1 rounded-lg text-xs bg-white !text-gray-700 border border-gray-300 hover:bg-gray-50 font-medium">↺ 초기화</button>
          <span className="text-xs text-gray-500 ml-auto">사진 {photos.length}장 / 일지 {entries.length}건</span>
        </div>
      </SearchFilterBar>

      {loading?(
        <div className="glass-card p-10 text-center text-gray-400">불러오는 중...</div>
      ):photos.length===0?(
        <div className="glass-card p-10 text-center text-gray-400">조건에 맞는 사진이 없습니다</div>
      ):(
        <div className="space-y-4">
          {groups.map(([groupKey,items])=>(
            <div key={groupKey} className="glass-card p-4">
              <h4 className="text-sm font-bold !text-gray-800 mb-3 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${groupBy==="house"?"bg-violet-100 !text-violet-800":groupBy==="workType"?"bg-emerald-100 !text-emerald-800":"bg-blue-100 !text-blue-800"}`}>{groupKey}</span>
                <span className="text-xs !text-gray-500 font-normal">{items.length}장</span>
              </h4>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {items.map((p,i)=>(
                  <button key={`${p.entryId}-${p.photoIdx}`} type="button" onClick={()=>setLightbox(p)}
                    className="aspect-square rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-all relative group">
                    <img src={p.url} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    {p.pest&&<span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-rose-500/90 text-white text-[9px] font-bold">⚠</span>}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="text-[9px] text-white font-medium truncate">{toKR(p.date)}</div>
                      <div className="text-[9px] text-white/80 truncate">{p.workType}{p.growthStage?` · ${p.growthStage}`:""}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox&&(
        <div className="lightbox-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={()=>setLightbox(null)}>
          <div className="max-w-4xl w-full bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50">
              <div>
                <div className="text-sm font-bold !text-gray-800">{toKR(lightbox.date)} · {lightbox.workType}</div>
                <div className="text-xs !text-gray-500">{lightbox.houseName||lightbox.houseId||""}{lightbox.growthStage?` · ${lightbox.growthStage}`:""}</div>
              </div>
              <button onClick={()=>setLightbox(null)} className="!text-gray-500 hover:!text-gray-900 text-2xl px-2">×</button>
            </div>
            <img src={lightbox.url} alt="" className="w-full max-h-[70vh] object-contain bg-black" />
            <div className="px-5 py-3 space-y-2 text-sm">
              {lightbox.content&&<div className="!text-gray-800"><MarkdownText text={lightbox.content} /></div>}
              {lightbox.pest&&<div className="!text-rose-700"><span className="font-semibold">⚠ 병해충:</span> {lightbox.pest}</div>}
              {lightbox.tags?.length>0&&(
                <div className="flex flex-wrap gap-1 pt-1">
                  {lightbox.tags.map(t=>(
                    <span key={t} className="px-2 py-0.5 bg-emerald-100 !text-emerald-800 border border-emerald-300 rounded-full text-xs font-semibold">#{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JournalSearch(){const FARM_ID=useContext(FarmIdCtx);
  const df=useDateFilter();
  const[entries,setEntries]=useState([]);const[loading,setLoading]=useState(true);
  const[pagination,setPagination]=useState({page:1,totalPages:1});
  const[entryDates,setEntryDates]=useState([]);const[filter,setFilter]=useState({workType:"",keyword:"",tags:[],tagsMode:"any"});
  const[tagInput,setTagInput]=useState("");
  const[editingEntry,setEditingEntry]=useState(null);const[expandedId,setExpandedId]=useState(null);

  useEffect(()=>{api(`/journal/${FARM_ID}/entries?limit=200&startDate=${df.dateRange.start}&endDate=${df.dateRange.end}`).then(res=>setEntryDates([...new Set(res.data.map(e=>e.date?.split("T")[0]))])).catch(console.error)},[df.dateRange]);

  const load=useCallback(async(page=1)=>{
    try{setLoading(true);let url=`/journal/${FARM_ID}/entries?page=${page}&limit=20`;
      if(df.selectedDate)url+=`&startDate=${df.selectedDate}&endDate=${df.selectedDate}`;
      else{if(df.dateRange.start)url+=`&startDate=${df.dateRange.start}`;if(df.dateRange.end)url+=`&endDate=${df.dateRange.end}`}
      if(filter.workType)url+=`&workType=${filter.workType}`;
      if(filter.tags.length>0)url+=`&tags=${encodeURIComponent(filter.tags.join(','))}&tagsMode=${filter.tagsMode}`;
      const res=await api(url);let data=res.data;
      if(filter.keyword.trim()){const kw=filter.keyword.trim().toLowerCase();data=data.filter(e=>e.content?.toLowerCase().includes(kw)||e.pest?.toLowerCase().includes(kw)||e.notes?.toLowerCase().includes(kw)||e.tags?.some(t=>t.toLowerCase().includes(kw)))}
      setEntries(data);setPagination(res.pagination);
    }catch(e){console.error(e)}finally{setLoading(false)}
  },[df.dateRange,df.selectedDate,filter]);

  // 태그 필터 조작 헬퍼
  const addFilterTag=(raw)=>{
    const t=String(raw||'').trim().replace(/^#/,'');
    if(!t||filter.tags.includes(t))return;
    setFilter(p=>({...p,tags:[...p.tags,t]}));
    setTagInput('');
  };
  const removeFilterTag=(t)=>setFilter(p=>({...p,tags:p.tags.filter(x=>x!==t)}));
  const toggleFilterTagFromCard=(t)=>{
    if(filter.tags.includes(t))removeFilterTag(t);
    else setFilter(p=>({...p,tags:[...p.tags,t]}));
  };
  useEffect(()=>{load()},[load]);

  const handleDelete=async id=>{if(!confirm("삭제하시겠습니까?"))return;await api(`/journal/${FARM_ID}/entries/${id}`,{method:"DELETE"});load(pagination.page)};
  const handleSave=async data=>{await api(`/journal/${FARM_ID}/entries/${editingEntry._id}`,{method:"PUT",body:JSON.stringify(data)});setEditingEntry(null);load()};

  const handlePrint=()=>{
    const headers=["날짜","작업유형","날씨","온도","습도","생육단계","작업내용","병해충","비고"];
    const rows=entries.map(e=>[toKR(e.date),e.workType,e.weather||"",(e.tempMin||e.tempMax)?`${e.tempMin||"-"}~${e.tempMax||"-"}°C`:"",e.humidity?`${e.humidity}%`:"",e.growthStage||"",e.content,e.pest||"",e.notes||""]);
    const photos=entries.filter(e=>e.photos?.length>0).map(e=>({label:`${toKR(e.date)} - ${e.workType} : ${(e.content||"").substring(0,30)}`,urls:e.photos.map(p=>photoUrl(p))}));
    printRecords("영농일지",headers,rows,photos);
  };
  const handleCSV=()=>{
    const headers=["날짜","작업유형","날씨","최저온도","최고온도","습도","생육단계","작업내용","병해충","비고"];
    const rows=entries.map(e=>[toKR(e.date),e.workType,e.weather||"",e.tempMin||"",e.tempMax||"",e.humidity||"",e.growthStage||"",e.content,e.pest||"",e.notes||""]);
    downloadCSV(`영농일지_${formatDate(new Date())}.csv`,headers,rows);
  };
  const handlePDF=()=>{
    const headers=["날짜","작업유형","날씨","온도","습도","생육단계","작업내용","병해충","비고"];
    const rows=entries.map(e=>[toKR(e.date),e.workType,e.weather||"",(e.tempMin||e.tempMax)?`${e.tempMin||"-"}~${e.tempMax||"-"}°C`:"",e.humidity?`${e.humidity}%`:"",e.growthStage||"",e.content,e.pest||"",e.notes||""]);
    const photos=entries.filter(e=>e.photos?.length>0).map(e=>({label:`${toKR(e.date)} - ${e.workType} : ${(e.content||"").substring(0,30)}`,urls:e.photos.map(p=>photoUrl(p))}));
    downloadPDF("영농일지",headers,rows,`영농일지_${formatDate(new Date())}`,photos);
  };

  return(
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="lg:col-span-1">
        <MiniCalendar selectedDate={df.selectedDate} onDateSelect={df.handleDateSelect} entryDates={entryDates} />
        <div className="glass-card p-4 mt-3"><h4 className="text-xs font-medium text-gray-400 mb-2">현황</h4><div className="grid grid-cols-2 gap-2">
          <div className="bg-white/5 rounded-lg p-2 text-center"><p className="text-lg font-bold text-emerald-400">{entryDates.length}</p><p className="text-[10px] text-gray-500">작성일수</p></div>
          <div className="bg-white/5 rounded-lg p-2 text-center"><p className="text-lg font-bold text-blue-400">{entries.length}</p><p className="text-[10px] text-gray-500">검색결과</p></div>
        </div></div>
      </div>
      <div className="lg:col-span-3 space-y-4">
        <SearchFilterBar {...df}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">작업유형</span><select style={LIGHT_INPUT} value={filter.workType} onChange={e=>setFilter(p=>({...p,workType:e.target.value}))} className="input-field jrn-select text-xs py-1 px-2 w-28"><option value="">전체</option>{WORK_TYPES.map(w=><option key={w} value={w}>{w}</option>)}</select></div>
              <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">작업내용</span><input style={LIGHT_INPUT} type="text" value={filter.keyword} onChange={e=>setFilter(p=>({...p,keyword:e.target.value}))} placeholder="검색어" className="input-field text-xs py-1 px-2 w-40" /></div>
              {/* 태그 필터 — chip 입력 + AND/ANY 토글 */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 font-medium">태그</span>
                <div className={`flex items-center gap-1 px-2 py-1 rounded-md border-2 ${filter.tags.length>0?'border-emerald-400 bg-emerald-50':'border-gray-300 bg-white'}`}>
                  {filter.tags.map(t=>(
                    <span key={t} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 !text-emerald-800 border border-emerald-400 rounded-full text-[11px] font-semibold">
                      #{t}
                      <button type="button" onClick={()=>removeFilterTag(t)} className="!text-emerald-700 hover:!text-rose-600 font-bold">×</button>
                    </span>
                  ))}
                  <input type="text" value={tagInput} onChange={e=>setTagInput(e.target.value)}
                    onKeyDown={e=>{if(['Enter',',',' '].includes(e.key)){e.preventDefault();addFilterTag(tagInput);}else if(e.key==='Backspace'&&!tagInput&&filter.tags.length>0){removeFilterTag(filter.tags[filter.tags.length-1]);}}}
                    onBlur={()=>{if(tagInput)addFilterTag(tagInput);}}
                    placeholder={filter.tags.length===0?'#방제 #수확':'추가'}
                    style={LIGHT_INPUT}
                    className="bg-transparent text-xs placeholder:!text-gray-400 outline-none w-24" />
                </div>
                {filter.tags.length>1&&(
                  <button type="button" onClick={()=>setFilter(p=>({...p,tagsMode:p.tagsMode==='any'?'all':'any'}))}
                    title="any: 일부만 일치 / all: 모두 포함"
                    className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-colors ${filter.tagsMode==='all'?'bg-blue-100 !text-blue-800 border-blue-400':'bg-white !text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                    {filter.tagsMode==='all'?'AND':'OR'}
                  </button>
                )}
              </div>
              <button onClick={()=>{setFilter({workType:"",keyword:"",tags:[],tagsMode:"any"});setTagInput("");df.resetFilters()}} className="px-3 py-1 rounded-lg text-xs bg-white !text-gray-700 border border-gray-300 hover:bg-gray-50 font-medium">↺ 초기화</button>
            </div>
            {entries.length>0&&<ExportButtons onPrint={handlePrint} onCSV={handleCSV} onPDF={handlePDF} />}
          </div>
        </SearchFilterBar>
        {editingEntry&&<JournalForm entry={editingEntry} onSave={handleSave} onCancel={()=>setEditingEntry(null)} />}
        {loading?<div className="text-center text-gray-400 py-10">불러오는 중...</div>:entries.length===0?(
          <div className="glass-card p-10 text-center text-gray-400">{df.selectedDate?`${toKR(df.selectedDate)}에 작성된 일지가 없습니다`:"검색 결과가 없습니다"}</div>
        ):(
          <div className="space-y-2">{entries.map(entry=>{
            const isOpen=expandedId===entry._id;
            return(
              <div key={entry._id} className={`glass-card transition-all ${isOpen?"ring-1 ring-emerald-500/30":"hover:bg-white/[0.03] cursor-pointer"}`}>
                <div className="p-4 flex items-center gap-3 flex-wrap" onClick={()=>setExpandedId(isOpen?null:entry._id)}>
                  <span className={`text-xs transition-transform ${isOpen?"rotate-90":""}`}>▶</span>
                  <span className="text-sm text-gray-400 w-24 shrink-0">{toKR(entry.date)}</span>
                  {entry.houseId&&<span className="px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/20 text-violet-400">{entry.houseName||entry.houseId}</span>}
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">{entry.workType}</span>
                  {entry.growthStage&&<span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">{entry.growthStage}</span>}
                  {entry.weather&&<span className="text-xs text-gray-500">☁ {entry.weather}</span>}
                  <span className="text-sm text-gray-300 truncate flex-1 min-w-[120px]">{entry.content}</span>
                  {entry.tags?.length>0&&entry.tags.slice(0,3).map(t=>(
                    <button key={t} type="button" onClick={e=>{e.stopPropagation();toggleFilterTagFromCard(t);}}
                      title={filter.tags.includes(t)?'필터에서 제거':'이 태그로 필터'}
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${filter.tags.includes(t)?'bg-emerald-500 text-white border-emerald-600':'bg-emerald-100 !text-emerald-800 border-emerald-400 hover:bg-emerald-200'}`}>
                      #{t}
                    </button>
                  ))}
                  {entry.tags?.length>3&&<span className="text-[10px] text-gray-500">+{entry.tags.length-3}</span>}
                  {entry.photos?.length>0&&<span className="text-xs text-gray-500">📷 {entry.photos.length}</span>}
                </div>
                {isOpen&&(
                  <div className="px-4 pb-4 pt-0 border-t border-white/5 detail-expand">
                    <div className="mt-3 space-y-2">
                      {entry.houseId&&<DetailRow label="하우스" value={entry.houseName||entry.houseId} color="text-violet-400" />}
                      <DetailRow label="작업 내용" value={entry.content} color="!text-gray-800" markdown />
                      <DetailRow label="날씨" value={entry.weather} />
                      <DetailRow label="온도" value={(entry.tempMin||entry.tempMax)?`${entry.tempMin||"-"} ~ ${entry.tempMax||"-"} °C`:null} />
                      <DetailRow label="습도" value={entry.humidity?`${entry.humidity}%`:null} />
                      <DetailRow label="생육단계" value={entry.growthStage} color="text-blue-400" />
                      <DetailRow label="병해충" value={entry.pest} color="text-orange-400" />
                      <DetailRow label="비고" value={entry.notes} markdown />
                      {entry.measurements&&Object.keys(entry.measurements).length>0&&(
                        <div className="flex items-start gap-3">
                          <span className="text-xs text-gray-400 w-20 shrink-0 pt-1">📈 생육 측정</span>
                          <div className="flex flex-wrap gap-1.5">
                            {entry.measurements.plantHeight!=null&&<span className="px-2 py-0.5 bg-emerald-100 !text-emerald-800 border border-emerald-300 rounded-full text-xs font-medium">초장 {entry.measurements.plantHeight}cm</span>}
                            {entry.measurements.leafCount!=null&&<span className="px-2 py-0.5 bg-emerald-100 !text-emerald-800 border border-emerald-300 rounded-full text-xs font-medium">엽수 {entry.measurements.leafCount}장</span>}
                            {entry.measurements.floweringRate!=null&&<span className="px-2 py-0.5 bg-pink-100 !text-pink-800 border border-pink-300 rounded-full text-xs font-medium">개화율 {entry.measurements.floweringRate}%</span>}
                            {entry.measurements.fruitSetRate!=null&&<span className="px-2 py-0.5 bg-amber-100 !text-amber-800 border border-amber-300 rounded-full text-xs font-medium">착과율 {entry.measurements.fruitSetRate}%</span>}
                            {Array.isArray(entry.measurements.custom)&&entry.measurements.custom.map((c,i)=>(
                              <span key={i} className="px-2 py-0.5 bg-blue-100 !text-blue-800 border border-blue-300 rounded-full text-xs font-medium">{c.name} {c.value}{c.unit||''}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {entry.tags?.length>0&&(
                        <div className="flex items-start gap-3">
                          <span className="text-xs text-gray-400 w-20 shrink-0 pt-1">태그</span>
                          <div className="flex flex-wrap gap-1">
                            {entry.tags.map(t=>(
                              <button key={t} type="button" onClick={e=>{e.stopPropagation();toggleFilterTagFromCard(t);}}
                                title={filter.tags.includes(t)?'필터에서 제거':'이 태그로 필터'}
                                className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${filter.tags.includes(t)?'bg-emerald-500 text-white border-emerald-600':'bg-emerald-100 !text-emerald-800 border-emerald-400 hover:bg-emerald-200'}`}>
                                #{t}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <PhotoThumbs photos={entry.photos} />
                    </div>
                    <div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
                      <button onClick={e=>{e.stopPropagation();setEditingEntry(entry)}} className="px-3 py-1.5 rounded-lg text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">✏️ 수정</button>
                      <button onClick={e=>{e.stopPropagation();handleDelete(entry._id)}} className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30">🗑️ 삭제</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}</div>
        )}
        <Pagination pagination={pagination} onPageChange={p=>load(p)} />
      </div>
    </div>
  );
}

function JournalWrite(){const FARM_ID=useContext(FarmIdCtx);
  const[saved,setSaved]=useState(false);
  const handleSave=async data=>{await api(`/journal/${FARM_ID}/entries`,{method:"POST",body:JSON.stringify(data)});setSaved(true);setTimeout(()=>setSaved(false),3000)};
  return(<div className="space-y-4">{saved&&<div className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-4 py-3 rounded-lg text-sm">✅ 영농일지가 저장되었습니다!</div>}<JournalForm entry={null} onSave={handleSave} onCancel={null} /></div>);
}

// ━━━ 템플릿 저장 박스 (이름·이모지) ━━━
function TemplateSaveBox({onSave,onCancel}){
  const[name,setName]=useState('');
  const[emoji,setEmoji]=useState('');
  const canSave=!!name.trim();
  return(
    <div className="bg-amber-500/15 border border-amber-500/40 rounded-lg p-3 flex items-end gap-2 flex-wrap">
      <div className="flex-1 min-w-[140px]">
        <label className="text-xs text-amber-700 dark:text-amber-200 font-semibold mb-1 block">템플릿 이름</label>
        <input style={LIGHT_INPUT} autoFocus type="text" value={name} onChange={e=>setName(e.target.value)}
          placeholder="예: 매일 양액 점검"
          className="input-field text-sm w-full" />
      </div>
      <div className="w-20">
        <label className="text-xs text-amber-700 dark:text-amber-200 font-semibold mb-1 block">이모지</label>
        <input style={LIGHT_INPUT} type="text" value={emoji} onChange={e=>setEmoji(e.target.value)}
          placeholder="⭐"
          className="input-field text-sm w-full text-center" />
      </div>
      <button type="button" onClick={()=>onSave(name,emoji)} disabled={!canSave}
        className={`px-4 py-2 rounded-md text-sm font-semibold border transition-colors ${canSave?'bg-amber-500 text-white border-amber-600 hover:bg-amber-600':'bg-gray-200 dark:bg-white/5 text-gray-400 border-gray-300 dark:border-white/10 cursor-not-allowed'}`}>
        저장
      </button>
      <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">취소</button>
    </div>
  );
}

// ━━━ 생육 측정 입력 (P1-A) ━━━
// 표준 4 필드 (초장/엽수/개화율/착과율) + 사용자 정의 metric 최대 8 개
// 측정 1 개라도 있으면 자동 펼침, 없으면 접힘 (입력 부담 0)
// 음성 입력 지원 — 농민이 "초장 25, 엽수 12, 개화율 60" 말하면 AI 가 4 필드로 추출
const MEASURE_FIELDS = [
  { key: "plantHeight", label: "초장(草長)", unit: "cm", min: 0, max: 500, step: 0.5 },
  { key: "leafCount", label: "엽수", unit: "장", min: 0, max: 200, step: 1 },
  { key: "floweringRate", label: "개화율", unit: "%", min: 0, max: 100, step: 1 },
  { key: "fruitSetRate", label: "착과율", unit: "%", min: 0, max: 100, step: 1 },
];
function MeasurementSection({ measurements, onChange, aiHighlight, farmId }) {
  const m = measurements || {};
  const hasAny = MEASURE_FIELDS.some((f) => m[f.key] !== undefined && m[f.key] !== null && m[f.key] !== "")
    || (Array.isArray(m.custom) && m.custom.length > 0);
  const [open, setOpen] = useState(hasAny || aiHighlight);
  useEffect(() => { if (hasAny || aiHighlight) setOpen(true); }, [hasAny, aiHighlight]);

  const setField = (k, v) => onChange({ ...m, [k]: v === "" ? null : v });
  const custom = Array.isArray(m.custom) ? m.custom : [];
  const setCustom = (next) => onChange({ ...m, custom: next });
  const addCustom = () => setCustom([...custom, { name: "", value: "", unit: "" }]);
  const updCustom = (i, k, v) => setCustom(custom.map((c, idx) => idx === i ? { ...c, [k]: v } : c));
  const rmCustom = (i) => setCustom(custom.filter((_, idx) => idx !== i));

  // ── 음성 → AI → 측정값 자동 채움 ──
  const [listening, setListening] = useState(false);
  const [parsing, setParsing] = useState(false);
  const recRef = useRef(null);
  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('이 브라우저는 음성인식을 지원하지 않습니다'); return; }
    if (listening) { recRef.current?.stop(); return; }
    let buffer = "";
    const r = new SR();
    r.lang = 'ko-KR';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (last.isFinal) buffer += (buffer ? ' ' : '') + last[0].transcript.trim();
    };
    r.onend = async () => {
      setListening(false);
      const text = buffer.trim();
      if (!text) return;
      // AI 호출 — 측정값 4 필드만 추출 (parse-text 동일 endpoint)
      setParsing(true);
      try {
        const res = await api(`/ai/${farmId}/journal/parse-text`, {
          method: 'POST',
          body: JSON.stringify({ text: `생육 측정 음성 메모: ${text}`, hints: {} }),
        });
        if (res?.success && res.data?.measurements) {
          const got = res.data.measurements;
          const next = { ...m };
          let added = false;
          ['plantHeight', 'leafCount', 'floweringRate', 'fruitSetRate'].forEach((k) => {
            if (got[k] != null && (m[k] == null || m[k] === '' || m[k] === undefined)) {
              next[k] = got[k];
              added = true;
            }
          });
          if (added) onChange(next);
          else alert(`AI 가 측정값을 인식하지 못했습니다.\n인식된 음성: "${text}"`);
        }
      } catch (err) { alert('AI 분석 실패: ' + err.message); }
      finally { setParsing(false); }
    };
    r.onerror = () => setListening(false);
    recRef.current = r;
    r.start();
    setListening(true);
  };

  return (
    <div className={`rounded-lg border ${aiHighlight ? 'border-violet-400 bg-violet-50' : 'border-gray-300 bg-white'}`}>
      <button type="button" onClick={() => setOpen(!open)}
        className={`w-full px-3 py-2 flex items-center justify-between text-xs font-semibold !text-gray-800 hover:bg-gray-50 transition-colors ${open ? 'border-b border-gray-200' : ''}`}>
        <span className="flex items-center gap-2">
          📈 생육 측정
          {aiHighlight && <span className="!text-violet-700" title="AI 채움">✨</span>}
          {hasAny && <span className="text-[10px] !text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">기록됨</span>}
          <span className="text-[10px] text-gray-500 font-normal">— 측정 안 했으면 비워두세요</span>
        </span>
        <span className="text-gray-500">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="p-3 space-y-3">
          {/* 음성 입력 — 농민이 "초장 25, 엽수 12" 말하면 자동 채움 */}
          {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={startVoice} disabled={parsing}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all border ${
                  listening ? 'bg-red-100 !text-red-700 border-red-400 animate-pulse'
                  : parsing ? 'bg-violet-200 !text-violet-800 border-violet-500 animate-pulse'
                  : 'bg-emerald-50 !text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                }`}>
                🎙️ {listening ? '듣는 중... (다시 누르면 분석)' : parsing ? 'AI 분석 중...' : '음성으로 측정값 입력'}
              </button>
              <span className="text-[10px] text-gray-500">
                예: "초장 25, 엽수 12장, 개화율 60%, 착과율 80%"
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {MEASURE_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-[11px] text-gray-600 mb-0.5 block">{f.label} <span className="text-gray-400">({f.unit})</span></label>
                <input type="number" step={f.step} min={f.min} max={f.max}
                  value={m[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder="-"
                  style={LIGHT_INPUT}
                  className="input-field text-sm w-full" />
              </div>
            ))}
          </div>
          {/* 사용자 정의 metric */}
          {custom.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] !text-gray-600 font-medium">사용자 정의 측정</div>
              {custom.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input type="text" value={c.name} onChange={(e) => updCustom(i, "name", e.target.value)} placeholder="항목명 (예: 줄기 두께)" style={LIGHT_INPUT} className="input-field text-xs flex-1" />
                  <input type="number" step="0.01" value={c.value} onChange={(e) => updCustom(i, "value", e.target.value)} placeholder="값" style={LIGHT_INPUT} className="input-field text-xs w-24" />
                  <input type="text" value={c.unit} onChange={(e) => updCustom(i, "unit", e.target.value)} placeholder="단위" style={LIGHT_INPUT} className="input-field text-xs w-20" />
                  <button type="button" onClick={() => rmCustom(i)} className="px-2 py-1 text-xs !text-rose-600 hover:bg-rose-50 rounded">×</button>
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={addCustom}
            className="text-xs !text-blue-700 hover:!text-blue-900 hover:bg-blue-50 px-2 py-1 rounded font-medium">
            + 사용자 정의 측정 추가
          </button>
        </div>
      )}
    </div>
  );
}

// ━━━ 영농일지 폼 ━━━
// drafts — LocalStorage 자동 저장 (작성 도중 페이지 닫혀도 복구)
const DRAFT_KEY = (farmId) => `smartfarm_journal_draft_${farmId}`;
const DRAFT_DEBOUNCE_MS = 1000;

function JournalForm({entry,onSave,onCancel}){const FARM_ID=useContext(FarmIdCtx);
  const today=new Date().toISOString().split("T")[0];
  const[houses,setHouses]=useState([]);
  const emptyForm={houseId:"",date:today,weather:"",tempMin:"",tempMax:"",humidity:"",workType:"관리",growthStage:"",content:"",pest:"",notes:"",tags:[],measurements:{},photos:[]};
  const[form,setForm]=useState({houseId:entry?.houseId||"",date:entry?.date?new Date(entry.date).toISOString().split("T")[0]:today,weather:entry?.weather||"",tempMin:entry?.tempMin||"",tempMax:entry?.tempMax||"",humidity:entry?.humidity||"",workType:entry?.workType||"관리",growthStage:entry?.growthStage||"",content:entry?.content||"",pest:entry?.pest||"",notes:entry?.notes||"",tags:entry?.tags||[],measurements:entry?.measurements||{},photos:entry?.photos||[]});
  // ── drafts ──
  const[draftRestore,setDraftRestore]=useState(null); // { form, savedAt } 또는 null
  // 마운트 시 LocalStorage에서 draft 검사 (새 일지 작성 모드만)
  useEffect(()=>{
    if(entry)return; // 수정 모드는 draft 무시
    try{
      const raw=localStorage.getItem(DRAFT_KEY(FARM_ID));
      if(!raw)return;
      const d=JSON.parse(raw);
      if(d?.form&&d?.savedAt){
        // 24시간 이상 묵으면 폐기
        const age=Date.now()-new Date(d.savedAt).getTime();
        if(age>24*3600*1000){localStorage.removeItem(DRAFT_KEY(FARM_ID));return;}
        // 폼이 거의 비어있으면 무시
        const meaningful=d.form.content?.trim()||d.form.pest||d.form.notes||(d.form.photos?.length>0)||(d.form.tags?.length>0);
        if(!meaningful){localStorage.removeItem(DRAFT_KEY(FARM_ID));return;}
        setDraftRestore(d);
      }
    }catch{}
  },[FARM_ID,entry]);
  const restoreDraft=()=>{
    if(!draftRestore?.form)return;
    setForm({...emptyForm,...draftRestore.form,date:draftRestore.form.date||today});
    setDraftRestore(null);
  };
  const discardDraft=()=>{
    localStorage.removeItem(DRAFT_KEY(FARM_ID));
    setDraftRestore(null);
  };
  // 폼 변경 시 debounced 저장 (수정 모드 X, 빈 폼 X)
  useEffect(()=>{
    if(entry)return;
    if(draftRestore)return; // 복구 결정 전엔 저장 안 함 (덮어쓰기 방지)
    const meaningful=form.content?.trim()||form.pest||form.notes||(form.photos?.length>0)||(form.tags?.length>0);
    if(!meaningful)return;
    const tid=setTimeout(()=>{
      try{
        localStorage.setItem(DRAFT_KEY(FARM_ID),JSON.stringify({form,savedAt:new Date().toISOString()}));
      }catch{}
    },DRAFT_DEBOUNCE_MS);
    return()=>clearTimeout(tid);
  },[form,FARM_ID,entry,draftRestore]);
  const[uploading,setUploading]=useState(false);
  const[listening,setListening]=useState(false);
  const[parsing,setParsing]=useState(false);
  // AI 가 채운 필드 추적 — 사용자에게 시각적 표시 (보라 ring + ✨)
  const[aiFilled,setAiFilled]=useState(/** @type {Set<string>} */(new Set()));
  const recognitionRef=useRef(null);
  const contentRef=useRef(form.content);
  useEffect(()=>{contentRef.current=form.content},[form.content]);
  const toggleSTT=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){alert('이 브라우저는 음성인식을 지원하지 않습니다');return}
    if(listening){recognitionRef.current?.stop();return}
    const r=new SR();r.lang='ko-KR';r.continuous=true;r.interimResults=false;
    r.onresult=(e)=>{const last=e.results[e.results.length-1];if(last.isFinal){const text=last[0].transcript.trim();const prev=contentRef.current;set('content',prev?prev+' '+text:text)}};
    r.onend=()=>setListening(false);r.onerror=()=>setListening(false);
    recognitionRef.current=r;r.start();setListening(true);
  };

  // 자유 텍스트(음성/타자) → AI 구조화 → 빈 필드 자동 채움
  // 사용자가 이미 입력한 필드는 보존 (덮어쓰지 않음)
  const handleAiParse=async()=>{
    const text=(form.content||'').trim();
    if(text.length<5){alert('작업 내용에 문장을 입력하거나 음성으로 말한 후 다시 눌러주세요');return}
    setParsing(true);
    try{
      const r=await api(`/ai/${FARM_ID}/journal/parse-text`,{method:'POST',body:JSON.stringify({
        text,
        hints:{
          houses:houses.map(h=>({houseId:h.houseId,houseName:h.houseName})),
          workTypes:WORK_TYPES,weatherOptions:WEATHER_OPTIONS,growthStages:GROWTH_STAGES,
        },
      })});
      if(!r.success){alert('AI 분석 실패: '+(r.error||'unknown'));return}
      const d=r.data||{};
      const filled=new Set(aiFilled);
      setForm(prev=>{
        const next={...prev};
        // 빈 필드만 채움 (사용자가 직접 입력한 값은 보존)
        const fill=(k,v)=>{if(v!==null&&v!==undefined&&v!==''&&(!prev[k]||prev[k]===''||(k==='workType'&&prev[k]==='관리'))){next[k]=v;filled.add(k)}};
        fill('houseId',d.houseId);
        fill('workType',d.workType);
        fill('weather',d.weather);
        fill('growthStage',d.growthStage);
        fill('tempMin',d.tempMin);
        fill('tempMax',d.tempMax);
        fill('humidity',d.humidity);
        fill('pest',d.pest);
        fill('notes',d.notes);
        // tags: AI 추천 태그를 기존 태그와 합치기 (중복 제거)
        if(Array.isArray(d.tags)&&d.tags.length>0){
          const merged=Array.from(new Set([...(prev.tags||[]),...d.tags])).slice(0,20);
          if(merged.length>(prev.tags||[]).length){next.tags=merged;filled.add('tags');}
        }
        // measurements: AI 가 추출한 수치를 빈 필드만 채움
        if(d.measurements&&typeof d.measurements==='object'){
          const prevM=prev.measurements||{};
          const nextM={...prevM};
          let added=false;
          ['plantHeight','leafCount','floweringRate','fruitSetRate'].forEach(k=>{
            if(d.measurements[k]!=null&&(prevM[k]==null||prevM[k]===''||prevM[k]===undefined)){
              nextM[k]=d.measurements[k];
              added=true;
            }
          });
          if(added){next.measurements=nextM;filled.add('measurements');}
        }
        // content 는 AI 가 정제한 버전이 있으면 교체 (원문은 이미 음성/타자 그대로)
        if(d.content&&d.content.length>0&&d.content!==prev.content){next.content=d.content;filled.add('content')}
        return next;
      });
      setAiFilled(filled);
    }catch(err){alert('AI 분석 오류: '+err.message);}
    finally{setParsing(false);}
  };
  useEffect(()=>{api(`/config/farm/${FARM_ID}`).then(r=>{const h=r.data||[];setHouses(h);if(!form.houseId&&h.length>0)set("houseId",h[0].houseId)}).catch(()=>{})},[FARM_ID]);

  // ── 환경 자동 채움: date+houseId 변경 시 sensorData/controlLog 으로 빈 필드만 채움 ──
  // 사용자가 이미 입력한 값(P0-2 AI 분석 포함)은 보존. 작성 부담 줄이기 핵심.
  const[autoSummary,setAutoSummary]=useState(null);  // controlLog 요약 안내 표시용
  useEffect(()=>{
    if(!form.date||!form.houseId)return;
    if(entry)return; // 기존 일지 수정 시는 자동 채움 X
    const tid=setTimeout(async()=>{
      try{
        const r=await api(`/journal/${FARM_ID}/auto-fill?date=${form.date}&houseId=${encodeURIComponent(form.houseId)}`);
        if(!r.success||!r.data)return;
        const s=r.data.sensor||{};
        const c=r.data.control||{};
        const filled=new Set(aiFilled);
        setForm(prev=>{
          const next={...prev};
          // 빈 값일 때만 채움. tempMin/tempMax/humidity 가 핵심.
          if(s.available){
            if((!prev.tempMin||prev.tempMin==='')&&s.tempMin!=null){next.tempMin=String(s.tempMin);filled.add('tempMin');}
            if((!prev.tempMax||prev.tempMax==='')&&s.tempMax!=null){next.tempMax=String(s.tempMax);filled.add('tempMax');}
            if((!prev.humidity||prev.humidity==='')&&s.humidity!=null){next.humidity=String(s.humidity);filled.add('humidity');}
          }
          return next;
        });
        setAiFilled(filled);
        setAutoSummary({sensor:s,control:c});
      }catch{/* 오프라인/권한 실패 무시 */}
    },400);
    return()=>clearTimeout(tid);
  },[form.date,form.houseId,FARM_ID,entry]);
  // 사용자가 필드 수정하면 AI 표시 자동 해제 (수동 편집 의미)
  const set=(k,v)=>{
    setForm(p=>({...p,[k]:v}));
    if(aiFilled.has(k)){const ns=new Set(aiFilled);ns.delete(k);setAiFilled(ns);}
  };
  // 사진 업로드 후 AI 가 분석한 결과 (병해충 진단 등) — 별도 패널 표시용
  const[photoAi,setPhotoAi]=useState(null);
  const[photoAnalyzing,setPhotoAnalyzing]=useState(false);
  // 사진 한 장으로 폼 빈 필드 자동 채움 + 분석 패널 표시
  const analyzePhoto=async(filename)=>{
    if(!filename)return;
    setPhotoAnalyzing(true);
    try{
      const r=await api(`/ai/${FARM_ID}/journal/parse-photo`,{method:'POST',body:JSON.stringify({
        filename,
        text:form.content||'',
        hints:{workTypes:WORK_TYPES,growthStages:GROWTH_STAGES},
      })});
      if(!r.success){return}
      const d=r.data||{};
      const filled=new Set(aiFilled);
      setForm(prev=>{
        const next={...prev};
        const fill=(k,v)=>{if(v!==null&&v!==undefined&&v!==''&&(!prev[k]||prev[k]===''||(k==='workType'&&prev[k]==='관리'))){next[k]=v;filled.add(k);}};
        fill('growthStage',d.growthStage);
        fill('workType',d.workType);
        fill('pest',d.pest);
        // observation 은 content 가 비었을 때만 채움 (사용자 음성/타자 보존 우선)
        if(d.observation&&!prev.content){next.content=d.observation;filled.add('content');}
        // tags: AI 가 사진에서 추출한 태그를 기존과 머지 (P1-B 강화)
        if(Array.isArray(d.tags)&&d.tags.length>0){
          const merged=Array.from(new Set([...(prev.tags||[]),...d.tags])).slice(0,20);
          if(merged.length>(prev.tags||[]).length){next.tags=merged;filled.add('tags');}
        }
        return next;
      });
      setAiFilled(filled);
      setPhotoAi(d);
    }catch{/* 분석 실패해도 사진은 첨부된 상태 */}
    finally{setPhotoAnalyzing(false);}
  };
  const handlePhotoUpload=async e=>{
    const filesList=e.target.files;if(!filesList?.length)return;
    // 5 장 한도 — 추가 가능한 만큼만 처리
    const remaining=5-form.photos.length;
    if(remaining<=0){alert("사진은 최대 5 장까지 첨부할 수 있습니다");e.target.value="";return;}
    const files=Array.from(filesList).slice(0,remaining);
    if(filesList.length>remaining){
      alert(`사진은 최대 5 장까지만 추가할 수 있어 ${files.length} 장만 처리됩니다 (선택 ${filesList.length} 장)`);
    }

    setUploading(true);
    try{
      // 1) 각 파일 클라이언트 압축 — 서버 용량/네트워크 절약
      let beforeTotal=0,afterTotal=0;
      const compressed=await Promise.all(files.map(async f=>{
        beforeTotal+=f.size;
        try{
          const c=await compressImageFile(f,{maxWidth:1920,quality:0.82,maxBytes:1.5*1024*1024});
          afterTotal+=c.size;
          return c;
        }catch{
          // 압축 실패 (HEIC 등 디코드 불가) — 원본 사용
          afterTotal+=f.size;
          return f;
        }
      }));

      // 2) 업로드
      const fd=new FormData();for(const f of compressed)fd.append("photos",f);
      const res=await fetch(`${API_BASE}/journal/${FARM_ID}/photos`,{method:"POST",headers:{Authorization:`Bearer ${getToken()}`},body:fd});
      const data=await res.json();
      if(data.success&&data.data?.length){
        set("photos",[...form.photos,...data.data]);
        // 압축 통계 (사용자에게 한 번만)
        if(beforeTotal>afterTotal*1.1){
          const ratio=Math.round((1-afterTotal/beforeTotal)*100);
          console.log(`📦 사진 압축: ${(beforeTotal/1024/1024).toFixed(1)}MB → ${(afterTotal/1024/1024).toFixed(1)}MB (${ratio}% 절약)`);
        }
        // 첫 사진 자동 분석 (이미 분석된 게 없을 때만)
        if(!photoAi&&!entry){
          const first=data.data[0];
          if(first?.filename)analyzePhoto(first.filename);
        }
      }else if(data.error){alert("업로드 실패: "+data.error);}
    }catch(err){console.error("사진 업로드 실패",err);alert("업로드 실패: "+(err?.message||"네트워크 오류"));}
    finally{setUploading(false);e.target.value="";}
  };
  const[saving,setSaving]=useState(false);
  const handleSubmit=async()=>{
    if(!form.content.trim()){alert("작업 내용을 입력하세요");return}
    if(saving)return;
    setSaving(true);
    try{
      await onSave(form);
      if(!entry){
        // 저장 성공 — draft 폐기
        try{localStorage.removeItem(DRAFT_KEY(FARM_ID));}catch{}
        setForm({houseId:houses[0]?.houseId||"",date:today,weather:"",tempMin:"",tempMax:"",humidity:"",workType:"관리",growthStage:"",content:"",pest:"",notes:"",tags:[],measurements:{},photos:[]});
        setAiFilled(new Set());setPhotoAi(null);setAutoSummary(null);
      }
    }catch(e){
      console.error('일지 저장 실패',e);
      alert('저장 실패: '+(e?.message||'알 수 없는 오류')+'\n\n잠시 후 다시 시도해주세요.');
    }finally{
      setSaving(false);
    }
  };

  // ── 템플릿 (P0-4) ──
  const[templates,setTemplates]=useState([]);
  const[showTplSave,setShowTplSave]=useState(false);
  useEffect(()=>{api(`/journal/${FARM_ID}/templates`).then(r=>setTemplates(r.data||[])).catch(()=>{})},[FARM_ID]);
  const applyTemplate=async(t)=>{
    const p=t.payload||{};
    setForm(prev=>({
      ...prev,
      workType:p.workType||prev.workType,
      growthStage:p.growthStage||prev.growthStage,
      content:p.content||prev.content,
      pest:p.pest||prev.pest,
      notes:p.notes||prev.notes,
      tags:Array.isArray(p.tags)?p.tags:prev.tags,
    }));
    // 사용 카운트 증가 (실패해도 UI 영향 없음)
    api(`/journal/${FARM_ID}/templates/${t._id}/use`,{method:'POST'}).catch(()=>{});
  };
  const saveCurrentAsTemplate=async(name,emoji)=>{
    if(!name?.trim())return;
    const r=await api(`/journal/${FARM_ID}/templates`,{method:'POST',body:JSON.stringify({
      name:name.trim(),emoji:emoji||null,
      payload:{workType:form.workType,growthStage:form.growthStage,content:form.content,pest:form.pest,notes:form.notes,tags:form.tags},
    })});
    if(r.success){setTemplates(prev=>[r.data,...prev]);setShowTplSave(false);}
  };
  const deleteTemplate=async(id)=>{
    if(!confirm('템플릿을 삭제하시겠습니까?'))return;
    await api(`/journal/${FARM_ID}/templates/${id}`,{method:'DELETE'});
    setTemplates(prev=>prev.filter(t=>t._id!==id));
  };

  // ── 태그 chip 입력 (P0-5) ──
  const[tagInput,setTagInput]=useState('');
  const addTag=(raw)=>{
    const t=String(raw||'').trim().replace(/^#/,'');
    if(!t)return;
    if(form.tags.includes(t))return;
    setForm(p=>({...p,tags:[...p.tags,t].slice(0,20)}));
    setTagInput('');
  };
  const removeTag=(t)=>setForm(p=>({...p,tags:p.tags.filter(x=>x!==t)}));
  return(
    <div className="glass-card p-5 space-y-4">
      {draftRestore&&(
        <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-3 flex items-start gap-3 flex-wrap">
          <span className="text-2xl">📝</span>
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-semibold !text-blue-900">이전에 작성하던 일지가 있습니다</p>
            <p className="text-[11px] !text-blue-700 mt-0.5">
              {(() => {
                const age=Math.round((Date.now()-new Date(draftRestore.savedAt).getTime())/60000);
                if(age<60)return `${age}분 전 자동 저장됨`;
                const h=Math.floor(age/60);
                return `${h}시간 ${age%60}분 전 자동 저장됨`;
              })()}
              {draftRestore.form?.content&&` · "${draftRestore.form.content.slice(0,40)}${draftRestore.form.content.length>40?'…':''}"`}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={restoreDraft} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700">↩️ 복구</button>
            <button type="button" onClick={discardDraft} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-white !text-gray-700 border border-gray-300 hover:bg-gray-50">🗑️ 버리기</button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold text-white">{entry?"일지 수정":"새 일지 작성"}</h3>
        {!entry&&(
          <div className="flex items-center gap-2 flex-wrap">
            {templates.length>0&&(
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-xs text-gray-400">템플릿:</span>
                {templates.slice(0,5).map(t=>(
                  <div key={t._id} className="inline-flex items-stretch text-xs bg-amber-100 dark:bg-amber-900/40 border border-amber-500 dark:border-amber-600 rounded-md overflow-hidden">
                    {/* 적용 — 좌측 영역. button 에 색 직접 명시 (부모 상속 안 되는 경우 대비) */}
                    <button type="button" onClick={()=>applyTemplate(t)}
                      title="이 템플릿으로 폼 채우기"
                      style={{color:'inherit'}}
                      className="px-2.5 py-1.5 font-semibold !text-amber-900 dark:!text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-800/40 transition-colors">
                      {t.emoji||'⭐'} {t.name}
                    </button>
                    {/* 삭제 — 우측 영역, 충분한 터치 영역 */}
                    <button type="button"
                      onClick={(e)=>{e.preventDefault();e.stopPropagation();deleteTemplate(t._id);}}
                      title="템플릿 삭제"
                      aria-label={`템플릿 삭제: ${t.name}`}
                      className="px-2.5 py-1.5 border-l border-amber-500 dark:border-amber-600 !text-amber-700 dark:!text-amber-300 font-bold hover:bg-rose-500 hover:!text-white transition-colors">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={()=>setShowTplSave(true)}
              disabled={!form.content?.trim()&&!form.workType}
              className="px-2 py-1 text-xs bg-white/5 text-gray-400 border border-white/10 rounded-md hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">
              💾 템플릿 저장
            </button>
          </div>
        )}
      </div>
      {showTplSave&&(
        <TemplateSaveBox onSave={saveCurrentAsTemplate} onCancel={()=>setShowTplSave(false)} />
      )}
      {autoSummary&&(autoSummary.sensor?.available||autoSummary.control?.available)&&(
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs space-y-1">
          {autoSummary.sensor?.available&&(
            <div className="text-emerald-300">
              🌡️ 그 날 센서 측정값 자동 반영됨 — 최저 {autoSummary.sensor.tempMin}°C / 최고 {autoSummary.sensor.tempMax}°C / 평균 습도 {autoSummary.sensor.humidity}% (기록 {autoSummary.sensor.readingCount}건)
            </div>
          )}
          {autoSummary.control?.available&&autoSummary.control.summary&&(
            <div className="text-emerald-300/90">{autoSummary.control.summary}</div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="col-span-2 md:col-span-1"><label className="text-xs text-gray-600 mb-1 block">날짜 *</label><input style={LIGHT_INPUT} type="date" value={form.date} onChange={e=>set("date",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-1">하우스 *{aiFilled.has('houseId')&&<span className="text-violet-400" title="AI 채움">✨</span>}</label><select style={LIGHT_INPUT} value={form.houseId} onChange={e=>set("houseId",e.target.value)} className={`${SC} ${aiFilled.has('houseId')?'ring-1 ring-violet-400/40':''}`}><option value="">전체(공통)</option>{houses.map(h=><option key={h.houseId} value={h.houseId}>{h.houseName||h.houseId}</option>)}</select></div>
        <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-1">작업유형 *{aiFilled.has('workType')&&<span className="text-violet-400" title="AI 채움">✨</span>}</label><select style={LIGHT_INPUT} value={form.workType} onChange={e=>set("workType",e.target.value)} className={`${SC} ${aiFilled.has('workType')?'ring-1 ring-violet-400/40':''}`}>{WORK_TYPES.map(w=><option key={w} value={w}>{w}</option>)}</select></div>
        <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-1">날씨{aiFilled.has('weather')&&<span className="text-violet-400" title="AI 채움">✨</span>}</label><select style={LIGHT_INPUT} value={form.weather} onChange={e=>set("weather",e.target.value)} className={`${SC} ${aiFilled.has('weather')?'ring-1 ring-violet-400/40':''}`}><option value="">선택</option>{WEATHER_OPTIONS.map(w=><option key={w} value={w}>{w}</option>)}</select></div>
        <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-1">생육단계{aiFilled.has('growthStage')&&<span className="text-violet-400" title="AI 채움">✨</span>}</label><select style={LIGHT_INPUT} value={form.growthStage} onChange={e=>set("growthStage",e.target.value)} className={`${SC} ${aiFilled.has('growthStage')?'ring-1 ring-violet-400/40':''}`}><option value="">선택</option>{GROWTH_STAGES.map(g=><option key={g} value={g}>{g}</option>)}</select></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-1">최저 온도{aiFilled.has('tempMin')&&<span className="text-violet-400" title="AI 채움">✨</span>}</label><input style={LIGHT_INPUT} type="number" step="0.1" value={form.tempMin} onChange={e=>set("tempMin",e.target.value)} placeholder="°C" className={`input-field text-sm w-full ${aiFilled.has('tempMin')?'ring-1 ring-violet-400/40':''}`} /></div>
        <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-1">최고 온도{aiFilled.has('tempMax')&&<span className="text-violet-400" title="AI 채움">✨</span>}</label><input style={LIGHT_INPUT} type="number" step="0.1" value={form.tempMax} onChange={e=>set("tempMax",e.target.value)} placeholder="°C" className={`input-field text-sm w-full ${aiFilled.has('tempMax')?'ring-1 ring-violet-400/40':''}`} /></div>
        <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-1">습도{aiFilled.has('humidity')&&<span className="text-violet-400" title="AI 채움">✨</span>}</label><input style={LIGHT_INPUT} type="number" step="0.1" value={form.humidity} onChange={e=>set("humidity",e.target.value)} placeholder="%" className={`input-field text-sm w-full ${aiFilled.has('humidity')?'ring-1 ring-violet-400/40':''}`} /></div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <label className="text-xs text-gray-600">작업 내용 *</label>
          {(window.SpeechRecognition||window.webkitSpeechRecognition)&&(
            <button type="button" onClick={toggleSTT}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all border ${listening?'bg-red-100 !text-red-700 border-red-400 animate-pulse':'bg-emerald-50 !text-emerald-700 border-emerald-300 hover:bg-emerald-100'}`}>
              🎙️ {listening?'듣는 중...':'음성입력'}
            </button>
          )}
          <button type="button" onClick={handleAiParse} disabled={parsing||!form.content?.trim()}
            title="작업 내용을 AI가 읽고 빈 필드들(하우스/작업유형/날씨/생육/온습도/병해충)을 자동으로 채웁니다"
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all border ${parsing?'bg-violet-200 !text-violet-800 border-violet-500 animate-pulse':'bg-violet-100 !text-violet-800 border-violet-400 hover:bg-violet-200 disabled:opacity-40 disabled:cursor-not-allowed'}`}>
            ✨ {parsing?'분석 중...':'AI 자동 채움'}
          </button>
          {aiFilled.size>0&&(
            <span className="text-[11px] !text-violet-700 font-medium ml-auto">✨ AI가 {aiFilled.size}개 필드를 채웠습니다 — 수정 가능</span>
          )}
        </div>
        <textarea style={LIGHT_INPUT} value={form.content} onChange={e=>set("content",e.target.value)} rows={4} placeholder="음성 또는 자유 문장으로 작성 후 ✨AI 자동 채움 버튼을 눌러보세요.&#10;&#10;마크다운 사용 가능:&#10;# 큰 제목&#10;## 작은 제목&#10;**굵은 글씨**, *기울임*, `코드`&#10;- 리스트 항목&#10;1. 번호 리스트" className={`input-field text-sm w-full resize-none ${aiFilled.has('content')?'ring-1 ring-violet-400/40':''}`} />
        <p className="text-[10px] text-gray-500 mt-1">💡 마크다운 사용 가능: <code className="bg-gray-100 px-1 rounded font-mono">**굵은**</code> <code className="bg-gray-100 px-1 rounded font-mono">- 리스트</code> <code className="bg-gray-100 px-1 rounded font-mono"># 제목</code></p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-1">병해충{aiFilled.has('pest')&&<span className="text-violet-400" title="AI 채움">✨</span>}</label><input style={LIGHT_INPUT} type="text" value={form.pest} onChange={e=>set("pest",e.target.value)} placeholder="발견된 병해충" className={`input-field text-sm w-full ${aiFilled.has('pest')?'ring-1 ring-violet-400/40':''}`} /></div>
        <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-1">비고{aiFilled.has('notes')&&<span className="text-violet-400" title="AI 채움">✨</span>}</label><input style={LIGHT_INPUT} type="text" value={form.notes} onChange={e=>set("notes",e.target.value)} className={`input-field text-sm w-full ${aiFilled.has('notes')?'ring-1 ring-violet-400/40':''}`} /></div>
      </div>
      {/* 태그 chip 입력 (P0-5) */}
      <div>
        <label className="text-xs text-gray-600 mb-1 flex items-center gap-1">태그 {aiFilled.has('tags')&&<span className="!text-violet-700" title="AI 채움">✨</span>}<span className="text-[10px] text-gray-500">— 검색·분류용 (#방제 #수확 등)</span></label>
        <div className={`flex flex-wrap gap-1.5 items-center px-2 py-1.5 rounded-lg border-2 ${aiFilled.has('tags')?'border-violet-400 bg-violet-50':'border-gray-300 bg-white'}`}>
          {form.tags.map((t,i)=>(
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 !text-emerald-800 border border-emerald-400 rounded-full text-xs font-semibold">
              #{t}
              <button type="button" onClick={()=>removeTag(t)} className="!text-emerald-700 hover:!text-rose-600 font-bold ml-0.5">×</button>
            </span>
          ))}
          <input type="text" value={tagInput} onChange={e=>setTagInput(e.target.value)}
            onKeyDown={e=>{if(['Enter',',',' '].includes(e.key)){e.preventDefault();addTag(tagInput);}else if(e.key==='Backspace'&&!tagInput&&form.tags.length>0){removeTag(form.tags[form.tags.length-1]);}}}
            onBlur={()=>{if(tagInput)addTag(tagInput);}}
            placeholder={form.tags.length===0?'태그 입력 후 Enter 또는 쉼표':'추가...'}
            style={LIGHT_INPUT}
            className="flex-1 min-w-[80px] bg-transparent text-xs placeholder:!text-gray-400 outline-none" />
        </div>
      </div>
      {/* 생육 측정 (P1-A) — 토글로 펼침. 매주 1회 정도 측정한 수치를 기록. */}
      <MeasurementSection measurements={form.measurements||{}} onChange={(m)=>set('measurements',m)} aiHighlight={aiFilled.has('measurements')} farmId={FARM_ID} />
      <div><label className="text-xs text-gray-600 mb-1 flex items-center gap-2">사진
        <span className="text-[10px] text-gray-500">— 최대 5장 · 자동 압축</span>
        <span className="text-[10px] text-gray-500">({form.photos.length}/5)</span>
        {uploading&&<span className="text-[10px] text-emerald-300 animate-pulse">압축·업로드 중…</span>}
        {photoAnalyzing&&<span className="text-[10px] text-violet-300 animate-pulse">✨ 사진 분석 중…</span>}
      </label><div className="flex gap-2 items-center flex-wrap">
        {form.photos.map((photo,i)=>(<div key={i} className="relative"><img src={photoUrl(photo)} alt="" className="w-20 h-20 object-cover rounded-lg border border-white/10" /><button onClick={()=>set("photos",form.photos.filter((_,j)=>j!==i))} className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">×</button></div>))}
        {form.photos.length<5&&(<>
          <label className="w-20 h-20 flex flex-col items-center justify-center border-2 border-dashed border-white/20 rounded-lg cursor-pointer hover:border-emerald-400/50 transition-colors"><input style={LIGHT_INPUT} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />{uploading?<span className="text-xs text-gray-400">...</span>:<><span className="text-2xl text-gray-500">+</span><span className="text-[10px] text-gray-500 mt-0.5">갤러리</span></>}</label>
          <label className="w-20 h-20 flex flex-col items-center justify-center border-2 border-dashed border-white/20 rounded-lg cursor-pointer hover:border-blue-400/50 transition-colors"><input style={LIGHT_INPUT} type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} className="hidden" />{uploading?<span className="text-xs text-gray-400">...</span>:<><span className="text-2xl">📷</span><span className="text-[10px] text-gray-500 mt-0.5">촬영</span></>}</label>
        </>)}
      </div></div>
      {photoAi&&(
        <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-violet-300 font-semibold">✨ 사진 AI 분석 결과</span>
            <button type="button" onClick={()=>setPhotoAi(null)} className="text-violet-400/60 hover:text-violet-300 text-[10px]">닫기</button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-violet-200/90">
            {photoAi.cropName&&<div>🌱 작목: <span className="text-white">{photoAi.cropName}</span></div>}
            {photoAi.growthStage&&<div>📈 생육: <span className="text-white">{photoAi.growthStage}</span></div>}
            {photoAi.leafColor&&<div>🍃 잎상태: <span className="text-white">{photoAi.leafColor}</span></div>}
            {photoAi.confidence&&<div>🎯 신뢰도: <span className="text-white">{photoAi.confidence}</span></div>}
          </div>
          {photoAi.diagnosis&&(
            <div className="mt-1 pt-1 border-t border-violet-500/20">
              <div className="text-amber-300">⚠️ 진단: {photoAi.diagnosis}{photoAi.pestSeverity?` · ${photoAi.pestSeverity}`:''}</div>
              {photoAi.treatment&&<div className="text-amber-200/90 mt-0.5">💊 권장: {photoAi.treatment}</div>}
            </div>
          )}
          {photoAi.observation&&<div className="mt-1 pt-1 border-t border-violet-500/20 text-violet-100/80">{photoAi.observation}</div>}
        </div>
      )}
      <div className="flex justify-end gap-2">{onCancel&&<button onClick={onCancel} disabled={saving} className="btn-secondary disabled:opacity-50">취소</button>}<button onClick={handleSubmit} disabled={saving||!form.content?.trim()} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">{saving?"저장 중...":(entry?"수정":"저장")}</button></div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 수확 기록 탭
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function HarvestTab(){
  const[subTab,setSubTab]=useState("list");
  return(<div className="space-y-4"><div className="flex gap-1.5">
    <button onClick={()=>setSubTab("list")} className={`flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-xl text-sm font-medium transition-all min-w-0 active:scale-[0.97] ${subTab==="list"?"bg-blue-600 text-white shadow-lg shadow-blue-600/20":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"}`}><span className="flex-shrink-0">📋</span><span className="truncate">수확 조회</span></button>
    <button onClick={()=>setSubTab("write")} className={`flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-xl text-sm font-medium transition-all min-w-0 active:scale-[0.97] ${subTab==="write"?"bg-blue-600 text-white shadow-lg shadow-blue-600/20":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"}`}><span className="flex-shrink-0">✏️</span><span className="truncate">수확 기록</span></button>
  </div>{subTab==="list"&&<HarvestSearch />}{subTab==="write"&&<HarvestWrite />}</div>);
}

function HarvestSearch(){const FARM_ID=useContext(FarmIdCtx);
  const df=useDateFilter();
  const[records,setRecords]=useState([]);const[loading,setLoading]=useState(true);
  const[pagination,setPagination]=useState({page:1,totalPages:1});
  const[entryDates,setEntryDates]=useState([]);const[filter,setFilter]=useState({keyword:""});
  const[editing,setEditing]=useState(null);const[expandedId,setExpandedId]=useState(null);

  useEffect(()=>{api(`/journal/${FARM_ID}/harvests?limit=200&startDate=${df.dateRange.start}&endDate=${df.dateRange.end}`).then(res=>setEntryDates([...new Set(res.data.map(e=>e.date?.split("T")[0]))])).catch(console.error)},[df.dateRange]);

  const load=useCallback(async(page=1)=>{
    try{setLoading(true);let url=`/journal/${FARM_ID}/harvests?page=${page}&limit=20`;
      if(df.selectedDate)url+=`&startDate=${df.selectedDate}&endDate=${df.selectedDate}`;
      else{if(df.dateRange.start)url+=`&startDate=${df.dateRange.start}`;if(df.dateRange.end)url+=`&endDate=${df.dateRange.end}`}
      const res=await api(url);let data=res.data;
      if(filter.keyword.trim()){const kw=filter.keyword.trim().toLowerCase();data=data.filter(r=>r.cropName?.toLowerCase().includes(kw)||r.destination?.toLowerCase().includes(kw))}
      setRecords(data);setPagination(res.pagination);
    }catch(e){console.error(e)}finally{setLoading(false)}
  },[df.dateRange,df.selectedDate,filter]);
  useEffect(()=>{load()},[load]);

  const handleDelete=async id=>{if(!confirm("삭제하시겠습니까?"))return;await api(`/journal/${FARM_ID}/harvests/${id}`,{method:"DELETE"});load(pagination.page)};
  const handleSave=async data=>{await api(`/journal/${FARM_ID}/harvests/${editing._id}`,{method:"PUT",body:JSON.stringify(data)});setEditing(null);load()};
  const totalQty=records.reduce((s,r)=>s+(r.quantity||0),0);
  const totalRev=records.reduce((s,r)=>s+(r.totalRevenue||0),0);

  const handlePrint=()=>{
    const headers=["날짜","작물명","수확량","단위","등급","출하처","단가","매출","비고"];
    const rows=records.map(r=>[toKR(r.date),r.cropName,r.quantity,r.unit,r.grade||"",r.destination||"",r.unitPrice?`${r.unitPrice.toLocaleString()}원`:"",r.totalRevenue?`${r.totalRevenue.toLocaleString()}원`:"",r.notes||""]);
    const photos=records.filter(r=>r.photos?.length>0).map(r=>({label:`${toKR(r.date)} - ${r.cropName} ${r.quantity}${r.unit}`,urls:r.photos.map(p=>photoUrl(p))}));
    printRecords("수확 기록",headers,rows,photos);
  };
  const handleCSV=()=>{
    const headers=["날짜","작물명","수확량","단위","등급","출하처","단가","매출","비고"];
    const rows=records.map(r=>[toKR(r.date),r.cropName,r.quantity,r.unit,r.grade||"",r.destination||"",r.unitPrice||"",r.totalRevenue||"",r.notes||""]);
    downloadCSV(`수확기록_${formatDate(new Date())}.csv`,headers,rows);
  };
  const handlePDF=()=>{
    const headers=["날짜","작물명","수확량","단위","등급","출하처","단가","매출","비고"];
    const rows=records.map(r=>[toKR(r.date),r.cropName,r.quantity,r.unit,r.grade||"",r.destination||"",r.unitPrice?`${r.unitPrice.toLocaleString()}원`:"",r.totalRevenue?`${r.totalRevenue.toLocaleString()}원`:"",r.notes||""]);
    const photos=records.filter(r=>r.photos?.length>0).map(r=>({label:`${toKR(r.date)} - ${r.cropName} ${r.quantity}${r.unit}`,urls:r.photos.map(p=>photoUrl(p))}));
    downloadPDF("수확 기록",headers,rows,`수확기록_${formatDate(new Date())}`,photos);
  };

  return(
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="lg:col-span-1">
        <MiniCalendar selectedDate={df.selectedDate} onDateSelect={df.handleDateSelect} entryDates={entryDates} />
        <div className="glass-card p-4 mt-3"><h4 className="text-xs font-medium text-gray-400 mb-2">수확 현황</h4><div className="space-y-2">
          <div className="bg-white/5 rounded-lg p-2 text-center"><p className="text-lg font-bold text-emerald-400">{totalQty.toLocaleString()} kg</p><p className="text-[10px] text-gray-500">총 수확량</p></div>
          <div className="bg-white/5 rounded-lg p-2 text-center"><p className="text-lg font-bold text-yellow-400">{totalRev.toLocaleString()} 원</p><p className="text-[10px] text-gray-500">총 매출</p></div>
        </div></div>
      </div>
      <div className="lg:col-span-3 space-y-4">
        <SearchFilterBar {...df}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">검색</span><input style={LIGHT_INPUT} type="text" value={filter.keyword} onChange={e=>setFilter({keyword:e.target.value})} placeholder="작물명 / 출하처" className="input-field text-xs py-1 px-2 w-48" /></div>
              <button onClick={()=>{setFilter({keyword:""});df.resetFilters()}} className="px-3 py-1 rounded-lg text-xs bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white">↺ 초기화</button>
            </div>
            {records.length>0&&<ExportButtons onPrint={handlePrint} onCSV={handleCSV} onPDF={handlePDF} />}
          </div>
        </SearchFilterBar>
        {editing&&<HarvestForm record={editing} onSave={handleSave} onCancel={()=>setEditing(null)} />}
        {loading?<div className="text-center text-gray-400 py-10">불러오는 중...</div>:records.length===0?(
          <div className="glass-card p-10 text-center text-gray-400">{df.selectedDate?`${toKR(df.selectedDate)}에 수확 기록이 없습니다`:"검색 결과가 없습니다"}</div>
        ):(
          <div className="space-y-2">{records.map(r=>{
            const isOpen=expandedId===r._id;
            return(
              <div key={r._id} className={`glass-card transition-all ${isOpen?"ring-1 ring-yellow-500/30":"hover:bg-white/[0.03] cursor-pointer"}`}>
                <div className="p-4 flex items-center gap-3" onClick={()=>setExpandedId(isOpen?null:r._id)}>
                  <span className={`text-xs transition-transform ${isOpen?"rotate-90":""}`}>▶</span>
                  <span className="text-sm text-gray-400 w-24 shrink-0">{toKR(r.date)}</span>
                  <span className="text-sm text-white font-medium">{r.cropName}</span>
                  <span className="text-sm text-emerald-400">{r.quantity} {r.unit}</span>
                  {r.grade&&<span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">{r.grade}</span>}
                  <span className="flex-1"></span>
                  {r.totalRevenue?<span className="text-sm font-medium text-emerald-400">{r.totalRevenue.toLocaleString()}원</span>:null}
                </div>
                {isOpen&&(
                  <div className="px-4 pb-4 pt-0 border-t border-white/5 detail-expand"><div className="mt-3 space-y-2">
                    <DetailRow label="작물명" value={r.cropName} color="text-white" />
                    <DetailRow label="수확량" value={`${r.quantity} ${r.unit}`} color="text-emerald-400" />
                    <DetailRow label="등급" value={r.grade} color="text-yellow-400" />
                    <DetailRow label="출하처" value={r.destination} />
                    <DetailRow label="단가" value={r.unitPrice?`${r.unitPrice.toLocaleString()}원/${r.unit}`:null} />
                    <DetailRow label="매출" value={r.totalRevenue?`${r.totalRevenue.toLocaleString()}원`:null} color="!text-emerald-700" />
                    <DetailRow label="비고" value={r.notes} markdown />
                    {/* 출하 이력 chip (단계 3) */}
                    {(r.lotNumber||r.traceabilityNo||r.buyer||r.invoiceNo||r.loss||(r.qualityMetrics&&Object.keys(r.qualityMetrics||{}).length>0))&&(
                      <div className="flex items-start gap-3 pt-2 border-t border-blue-200">
                        <span className="text-xs text-gray-400 w-20 shrink-0 pt-1">📦 이력</span>
                        <div className="flex flex-wrap gap-1.5">
                          {r.lotNumber&&<span className="px-2 py-0.5 bg-blue-100 !text-blue-800 border border-blue-300 rounded-full text-xs font-mono font-medium">LOT {r.lotNumber}</span>}
                          {r.traceabilityNo&&<span className="px-2 py-0.5 bg-violet-100 !text-violet-800 border border-violet-300 rounded-full text-xs font-mono font-medium">이력 {r.traceabilityNo}</span>}
                          {r.buyer&&<span className="px-2 py-0.5 bg-emerald-100 !text-emerald-800 border border-emerald-300 rounded-full text-xs font-medium">🏪 {r.buyer}</span>}
                          {r.invoiceNo&&<span className="px-2 py-0.5 bg-gray-100 !text-gray-700 border border-gray-300 rounded-full text-xs font-medium">📄 {r.invoiceNo}</span>}
                          {r.loss!=null&&<span className="px-2 py-0.5 bg-rose-100 !text-rose-800 border border-rose-300 rounded-full text-xs font-medium">폐기 {r.loss}{r.unit}{r.lossReason?` · ${r.lossReason}`:''}</span>}
                          {r.qualityMetrics?.brix&&<span className="px-2 py-0.5 bg-amber-100 !text-amber-800 border border-amber-300 rounded-full text-xs font-medium">당도 {r.qualityMetrics.brix}Brix</span>}
                          {r.qualityMetrics?.acidity&&<span className="px-2 py-0.5 bg-amber-100 !text-amber-800 border border-amber-300 rounded-full text-xs font-medium">pH {r.qualityMetrics.acidity}</span>}
                        </div>
                      </div>
                    )}
                    <PhotoThumbs photos={r.photos} />
                  </div><div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
                    <button onClick={e=>{e.stopPropagation();setEditing(r)}} className="px-3 py-1.5 rounded-lg text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">✏️ 수정</button>
                    <button onClick={e=>{e.stopPropagation();handleDelete(r._id)}} className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30">🗑️ 삭제</button>
                  </div></div>
                )}
              </div>
            );
          })}</div>
        )}
        <Pagination pagination={pagination} onPageChange={p=>load(p)} />
      </div>
    </div>
  );
}

function HarvestWrite(){const FARM_ID=useContext(FarmIdCtx);
  const[saved,setSaved]=useState(false);
  const handleSave=async data=>{await api(`/journal/${FARM_ID}/harvests`,{method:"POST",body:JSON.stringify(data)});setSaved(true);setTimeout(()=>setSaved(false),3000)};
  return(<div className="space-y-4">{saved&&<div className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-4 py-3 rounded-lg text-sm">✅ 수확 기록이 저장되었습니다!</div>}<HarvestForm record={null} onSave={handleSave} onCancel={null} /></div>);
}

// ━━━ 수확 폼 ━━━
function HarvestForm({record,onSave,onCancel}){
  const today=new Date().toISOString().split("T")[0];
  const empty={date:today,cropName:"",quantity:"",unit:"kg",grade:"",destination:"",unitPrice:"",notes:"",lotNumber:"",traceabilityNo:"",buyer:"",invoiceNo:"",loss:"",lossReason:"",qualityMetrics:{}};
  const[form,setForm]=useState({date:record?.date?new Date(record.date).toISOString().split("T")[0]:today,cropName:record?.cropName||"",quantity:record?.quantity||"",unit:record?.unit||"kg",grade:record?.grade||"",destination:record?.destination||"",unitPrice:record?.unitPrice||"",notes:record?.notes||"",lotNumber:record?.lotNumber||"",traceabilityNo:record?.traceabilityNo||"",buyer:record?.buyer||"",invoiceNo:record?.invoiceNo||"",loss:record?.loss||"",lossReason:record?.lossReason||"",qualityMetrics:record?.qualityMetrics||{}});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const setQM=(k,v)=>setForm(p=>({...p,qualityMetrics:{...p.qualityMetrics,[k]:v}}));
  const revenue=form.quantity&&form.unitPrice?(parseFloat(form.quantity)*parseFloat(form.unitPrice)).toLocaleString():null;
  const handleSubmit=async()=>{if(!form.cropName.trim()||!form.quantity){alert("작물명과 수확량은 필수입니다");return}await onSave(form);if(!record)setForm(empty)};
  // 로트번호 미리보기 (입력 안 했을 때)
  const lotPreview=(()=>{
    if(form.lotNumber)return null;
    if(!form.date||!form.cropName)return null;
    const dt=new Date(form.date);
    const ymd=`${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
    const cropPart=form.cropName.slice(0,4).toUpperCase();
    return `${ymd}-${cropPart}-001`;
  })();
  return(
    <div className="glass-card p-5 space-y-4">
      <h3 className="text-lg font-semibold text-white">{record?"수확 기록 수정":"새 수확 기록"}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label className="text-xs text-gray-600 mb-1 block">날짜 *</label><input style={LIGHT_INPUT} type="date" value={form.date} onChange={e=>set("date",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">작물명 *</label><input style={LIGHT_INPUT} type="text" value={form.cropName} onChange={e=>set("cropName",e.target.value)} placeholder="예: 토마토" className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">수확량 *</label><div className="flex gap-1"><input style={LIGHT_INPUT} type="number" step="0.1" value={form.quantity} onChange={e=>set("quantity",e.target.value)} className="input-field text-sm flex-1" /><select style={LIGHT_INPUT} value={form.unit} onChange={e=>set("unit",e.target.value)} className="input-field jrn-select text-sm w-16"><option value="kg">kg</option><option value="g">g</option><option value="개">개</option><option value="박스">박스</option></select></div></div>
        <div><label className="text-xs text-gray-600 mb-1 block">등급</label><select style={LIGHT_INPUT} value={form.grade} onChange={e=>set("grade",e.target.value)} className={SC}><option value="">선택</option>{GRADES.map(g=><option key={g} value={g}>{g}</option>)}</select></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div><label className="text-xs text-gray-600 mb-1 block">출하처</label><input style={LIGHT_INPUT} type="text" value={form.destination} onChange={e=>set("destination",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">단가 (원/{form.unit})</label><input style={LIGHT_INPUT} type="number" value={form.unitPrice} onChange={e=>set("unitPrice",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">예상 매출</label><div className="input-field text-sm w-full bg-emerald-50 !text-emerald-800 border-emerald-300 font-semibold" style={LIGHT_INPUT}>{revenue?`${revenue}원`:"-"}</div></div>
      </div>
      {/* 출하 이력 (단계 3) — 농산물이력제 */}
      <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold !text-blue-900">📦 출하 이력 / 거래</span>
          <span className="text-[11px] !text-blue-700">— 농산물이력제 + 거래 추적</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><label className="text-xs text-gray-700 mb-1 block">로트번호 <span className="text-[10px] text-gray-500">(미입력 시 자동)</span></label><input style={LIGHT_INPUT} type="text" value={form.lotNumber} onChange={e=>set("lotNumber",e.target.value)} placeholder={lotPreview||"YYYYMMDD-CROP-001"} className="input-field text-sm w-full" /></div>
          <div><label className="text-xs text-gray-700 mb-1 block">이력추적번호 <a href="https://www.naqs.go.kr" target="_blank" rel="noreferrer" className="!text-blue-700 underline text-[10px]">NAQS</a></label><input style={LIGHT_INPUT} type="text" value={form.traceabilityNo} onChange={e=>set("traceabilityNo",e.target.value)} placeholder="12자리 (등록 시)" className="input-field text-sm w-full" /></div>
          <div><label className="text-xs text-gray-700 mb-1 block">거래처/구매자</label><input style={LIGHT_INPUT} type="text" value={form.buyer} onChange={e=>set("buyer",e.target.value)} placeholder="대형마트·학교급식·도매시장" className="input-field text-sm w-full" /></div>
          <div><label className="text-xs text-gray-700 mb-1 block">거래명세서 번호</label><input style={LIGHT_INPUT} type="text" value={form.invoiceNo} onChange={e=>set("invoiceNo",e.target.value)} className="input-field text-sm w-full" /></div>
          <div><label className="text-xs text-gray-700 mb-1 block">폐기/등외품 ({form.unit})</label><input style={LIGHT_INPUT} type="number" step="0.1" value={form.loss} onChange={e=>set("loss",e.target.value)} className="input-field text-sm w-full" /></div>
          <div><label className="text-xs text-gray-700 mb-1 block">폐기 사유</label><input style={LIGHT_INPUT} type="text" value={form.lossReason} onChange={e=>set("lossReason",e.target.value)} placeholder="크기 미달·병해·낙과 등" className="input-field text-sm w-full" /></div>
        </div>
        {/* 품질 측정 — 거래처 요구 시 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-blue-200">
          <div><label className="text-[11px] text-gray-700 mb-1 block">당도 (Brix)</label><input style={LIGHT_INPUT} type="number" step="0.1" value={form.qualityMetrics?.brix||""} onChange={e=>setQM("brix",e.target.value)} className="input-field text-sm w-full" /></div>
          <div><label className="text-[11px] text-gray-700 mb-1 block">산도 (pH)</label><input style={LIGHT_INPUT} type="number" step="0.1" value={form.qualityMetrics?.acidity||""} onChange={e=>setQM("acidity",e.target.value)} className="input-field text-sm w-full" /></div>
          <div><label className="text-[11px] text-gray-700 mb-1 block">평균 크기 (mm/g)</label><input style={LIGHT_INPUT} type="text" value={form.qualityMetrics?.size||""} onChange={e=>setQM("size",e.target.value)} placeholder="예: 80mm" className="input-field text-sm w-full" /></div>
          <div><label className="text-[11px] text-gray-700 mb-1 block">색·외관</label><input style={LIGHT_INPUT} type="text" value={form.qualityMetrics?.color||""} onChange={e=>setQM("color",e.target.value)} placeholder="예: 진홍" className="input-field text-sm w-full" /></div>
        </div>
      </div>
      <div><label className="text-xs text-gray-600 mb-1 block">비고</label><input style={LIGHT_INPUT} type="text" value={form.notes} onChange={e=>set("notes",e.target.value)} className="input-field text-sm w-full" /></div>
      <div className="flex justify-end gap-2">{onCancel&&<button onClick={onCancel} className="btn-secondary">취소</button>}<button onClick={handleSubmit} className="btn-primary">{record?"수정":"저장"}</button></div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 투입물 기록 탭
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function InputTab(){
  const[subTab,setSubTab]=useState("list");
  return(<div className="space-y-4"><div className="flex gap-1.5">
    <button onClick={()=>setSubTab("list")} className={`flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-xl text-sm font-medium transition-all min-w-0 active:scale-[0.97] ${subTab==="list"?"bg-blue-600 text-white shadow-lg shadow-blue-600/20":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"}`}><span className="flex-shrink-0">📋</span><span className="truncate">투입물 조회</span></button>
    <button onClick={()=>setSubTab("write")} className={`flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-xl text-sm font-medium transition-all min-w-0 active:scale-[0.97] ${subTab==="write"?"bg-blue-600 text-white shadow-lg shadow-blue-600/20":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"}`}><span className="flex-shrink-0">✏️</span><span className="truncate">투입물 기록</span></button>
  </div>{subTab==="list"&&<InputSearch />}{subTab==="write"&&<InputWrite />}</div>);
}

function InputSearch(){const FARM_ID=useContext(FarmIdCtx);
  const df=useDateFilter();
  const[records,setRecords]=useState([]);const[loading,setLoading]=useState(true);
  const[pagination,setPagination]=useState({page:1,totalPages:1});
  const[entryDates,setEntryDates]=useState([]);const[filter,setFilter]=useState({inputType:"",keyword:""});
  const[editing,setEditing]=useState(null);const[expandedId,setExpandedId]=useState(null);

  useEffect(()=>{api(`/journal/${FARM_ID}/inputs?limit=200&startDate=${df.dateRange.start}&endDate=${df.dateRange.end}`).then(res=>setEntryDates([...new Set(res.data.map(e=>e.date?.split("T")[0]))])).catch(console.error)},[df.dateRange]);

  const load=useCallback(async(page=1)=>{
    try{setLoading(true);let url=`/journal/${FARM_ID}/inputs?page=${page}&limit=20`;
      if(df.selectedDate)url+=`&startDate=${df.selectedDate}&endDate=${df.selectedDate}`;
      else{if(df.dateRange.start)url+=`&startDate=${df.dateRange.start}`;if(df.dateRange.end)url+=`&endDate=${df.dateRange.end}`}
      if(filter.inputType)url+=`&inputType=${filter.inputType}`;
      const res=await api(url);let data=res.data;
      if(filter.keyword.trim()){const kw=filter.keyword.trim().toLowerCase();data=data.filter(r=>r.productName?.toLowerCase().includes(kw)||r.manufacturer?.toLowerCase().includes(kw))}
      setRecords(data);setPagination(res.pagination);
    }catch(e){console.error(e)}finally{setLoading(false)}
  },[df.dateRange,df.selectedDate,filter]);
  useEffect(()=>{load()},[load]);

  const handleDelete=async id=>{if(!confirm("삭제하시겠습니까?"))return;await api(`/journal/${FARM_ID}/inputs/${id}`,{method:"DELETE"});load(pagination.page)};
  const handleSave=async data=>{await api(`/journal/${FARM_ID}/inputs/${editing._id}`,{method:"PUT",body:JSON.stringify(data)});setEditing(null);load()};
  const totalCost=records.reduce((s,r)=>s+(r.cost||0),0);

  const handlePrint=()=>{
    const headers=["날짜","투입유형","제품명","제조사","사용량","단위","비용","투입면적","투입방법","비고"];
    const rows=records.map(r=>[toKR(r.date),r.inputType,r.productName,r.manufacturer||"",r.quantity,r.unit,r.cost?`${r.cost.toLocaleString()}원`:"",r.targetArea?`${r.targetArea}평`:"",r.method||"",r.notes||""]);
    printRecords("투입물 기록",headers,rows,[]);
  };
  const handleCSV=()=>{
    const headers=["날짜","투입유형","제품명","제조사","사용량","단위","비용","투입면적","투입방법","비고"];
    const rows=records.map(r=>[toKR(r.date),r.inputType,r.productName,r.manufacturer||"",r.quantity,r.unit,r.cost||"",r.targetArea||"",r.method||"",r.notes||""]);
    downloadCSV(`투입물기록_${formatDate(new Date())}.csv`,headers,rows);
  };
  const handlePDF=()=>{
    const headers=["날짜","투입유형","제품명","제조사","사용량","단위","비용","투입면적","투입방법","비고"];
    const rows=records.map(r=>[toKR(r.date),r.inputType,r.productName,r.manufacturer||"",r.quantity,r.unit,r.cost?`${r.cost.toLocaleString()}원`:"",r.targetArea?`${r.targetArea}평`:"",r.method||"",r.notes||""]);
    downloadPDF("투입물 기록",headers,rows,`투입물기록_${formatDate(new Date())}`,[]);
  };

  return(
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="lg:col-span-1">
        <MiniCalendar selectedDate={df.selectedDate} onDateSelect={df.handleDateSelect} entryDates={entryDates} />
        <div className="glass-card p-4 mt-3"><h4 className="text-xs font-medium text-gray-400 mb-2">투입물 현황</h4><div className="space-y-2">
          <div className="bg-white/5 rounded-lg p-2 text-center"><p className="text-lg font-bold text-blue-400">{records.length}</p><p className="text-[10px] text-gray-500">기록 수</p></div>
          <div className="bg-white/5 rounded-lg p-2 text-center"><p className="text-lg font-bold text-orange-400">{totalCost.toLocaleString()} 원</p><p className="text-[10px] text-gray-500">총 비용</p></div>
        </div></div>
      </div>
      <div className="lg:col-span-3 space-y-4">
        <SearchFilterBar {...df}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">투입유형</span><select style={LIGHT_INPUT} value={filter.inputType} onChange={e=>setFilter(p=>({...p,inputType:e.target.value}))} className="input-field jrn-select text-xs py-1 px-2 w-28"><option value="">전체</option>{INPUT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">검색</span><input style={LIGHT_INPUT} type="text" value={filter.keyword} onChange={e=>setFilter(p=>({...p,keyword:e.target.value}))} placeholder="제품명 / 제조사" className="input-field text-xs py-1 px-2 w-48" /></div>
              <button onClick={()=>{setFilter({inputType:"",keyword:""});df.resetFilters()}} className="px-3 py-1 rounded-lg text-xs bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white">↺ 초기화</button>
            </div>
            {records.length>0&&<ExportButtons onPrint={handlePrint} onCSV={handleCSV} onPDF={handlePDF} />}
          </div>
        </SearchFilterBar>
        {editing&&<InputForm record={editing} onSave={handleSave} onCancel={()=>setEditing(null)} />}
        {loading?<div className="text-center text-gray-400 py-10">불러오는 중...</div>:records.length===0?(
          <div className="glass-card p-10 text-center text-gray-400">{df.selectedDate?`${toKR(df.selectedDate)}에 투입물 기록이 없습니다`:"검색 결과가 없습니다"}</div>
        ):(
          <div className="space-y-2">{records.map(r=>{
            const isOpen=expandedId===r._id;
            const tc=r.inputType==="비료"?"bg-green-500/20 text-green-400":r.inputType==="농약"?"bg-red-500/20 text-red-400":r.inputType==="종자"?"bg-blue-500/20 text-blue-400":"bg-gray-500/20 text-gray-400";
            return(
              <div key={r._id} className={`glass-card transition-all ${isOpen?"ring-1 ring-blue-500/30":"hover:bg-white/[0.03] cursor-pointer"}`}>
                <div className="p-4 flex items-center gap-3" onClick={()=>setExpandedId(isOpen?null:r._id)}>
                  <span className={`text-xs transition-transform ${isOpen?"rotate-90":""}`}>▶</span>
                  <span className="text-sm text-gray-400 w-24 shrink-0">{toKR(r.date)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${tc}`}>{r.inputType}</span>
                  <span className="text-sm text-white">{r.productName}</span>
                  <span className="text-sm text-gray-400">{r.quantity} {r.unit}</span>
                  <span className="flex-1"></span>
                  {r.cost?<span className="text-sm text-orange-400">{r.cost.toLocaleString()}원</span>:null}
                </div>
                {isOpen&&(
                  <div className="px-4 pb-4 pt-0 border-t border-white/5 detail-expand"><div className="mt-3 space-y-2">
                    <DetailRow label="투입유형" value={r.inputType} />
                    <DetailRow label="제품명" value={r.productName} color="text-white" />
                    <DetailRow label="제조사" value={r.manufacturer} />
                    <DetailRow label="사용량" value={`${r.quantity} ${r.unit}`} color="text-blue-400" />
                    <DetailRow label="비용" value={r.cost?`${r.cost.toLocaleString()}원`:null} color="text-orange-400" />
                    <DetailRow label="투입면적" value={r.targetArea?`${r.targetArea}평`:null} />
                    <DetailRow label="투입방법" value={r.method} />
                    <DetailRow label="비고" value={r.notes} />
                    {/* PLS 정보 (농약일 때만) */}
                    {r.inputType==="농약"&&(r.pesticideRegNo||r.dilutionRatio||r.applicationCount||r.safeUseInterval||r.applicator||r.preHarvestDate)&&(
                      <div className="flex items-start gap-3 pt-2 border-t border-amber-200">
                        <span className="text-xs text-gray-400 w-20 shrink-0 pt-1">🏅 PLS</span>
                        <div className="flex flex-wrap gap-1.5">
                          {r.pesticideRegNo&&<span className="px-2 py-0.5 bg-amber-100 !text-amber-800 border border-amber-300 rounded-full text-xs font-medium">등록 {r.pesticideRegNo}</span>}
                          {r.dilutionRatio&&<span className="px-2 py-0.5 bg-amber-100 !text-amber-800 border border-amber-300 rounded-full text-xs font-medium">{r.dilutionRatio}</span>}
                          {r.applicationCount!=null&&<span className="px-2 py-0.5 bg-amber-100 !text-amber-800 border border-amber-300 rounded-full text-xs font-medium">{r.applicationCount}회차</span>}
                          {r.applicator&&<span className="px-2 py-0.5 bg-amber-100 !text-amber-800 border border-amber-300 rounded-full text-xs font-medium">살포자 {r.applicator}</span>}
                          {r.preHarvestDate&&<span className="px-2 py-0.5 bg-emerald-100 !text-emerald-800 border border-emerald-300 rounded-full text-xs font-medium">📅 수확가능 {String(r.preHarvestDate).slice(0,10)}</span>}
                        </div>
                      </div>
                    )}
                  </div><div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
                    <button onClick={e=>{e.stopPropagation();setEditing(r)}} className="px-3 py-1.5 rounded-lg text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">✏️ 수정</button>
                    <button onClick={e=>{e.stopPropagation();handleDelete(r._id)}} className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30">🗑️ 삭제</button>
                  </div></div>
                )}
              </div>
            );
          })}</div>
        )}
        <Pagination pagination={pagination} onPageChange={p=>load(p)} />
      </div>
    </div>
  );
}

function InputWrite(){const FARM_ID=useContext(FarmIdCtx);
  const[saved,setSaved]=useState(false);
  const handleSave=async data=>{await api(`/journal/${FARM_ID}/inputs`,{method:"POST",body:JSON.stringify(data)});setSaved(true);setTimeout(()=>setSaved(false),3000)};
  return(<div className="space-y-4">{saved&&<div className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-4 py-3 rounded-lg text-sm">✅ 투입물 기록이 저장되었습니다!</div>}<InputForm record={null} onSave={handleSave} onCancel={null} /></div>);
}

// ━━━ 투입물 폼 ━━━
function InputForm({record,onSave,onCancel}){
  const today=new Date().toISOString().split("T")[0];
  const emptyForm={date:today,inputType:"비료",productName:"",manufacturer:"",quantity:"",unit:"kg",cost:"",targetArea:"",method:"",notes:"",pesticideRegNo:"",dilutionRatio:"",applicationCount:"",safeUseInterval:"",applicator:""};
  const[form,setForm]=useState({date:record?.date?new Date(record.date).toISOString().split("T")[0]:today,inputType:record?.inputType||"비료",productName:record?.productName||"",manufacturer:record?.manufacturer||"",quantity:record?.quantity||"",unit:record?.unit||"kg",cost:record?.cost||"",targetArea:record?.targetArea||"",method:record?.method||"",notes:record?.notes||"",pesticideRegNo:record?.pesticideRegNo||"",dilutionRatio:record?.dilutionRatio||"",applicationCount:record?.applicationCount||"",safeUseInterval:record?.safeUseInterval||"",applicator:record?.applicator||""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const handleSubmit=async()=>{if(!form.productName.trim()||!form.quantity||!form.unit){alert("제품명, 사용량, 단위는 필수입니다");return}await onSave(form);if(!record)setForm(emptyForm)};
  // 살포일 + 안전사용기준 = 마지막 농약사용일자 (수확 가능 시점) 자동 계산
  const preHarvestDate=(form.inputType==="농약"&&form.safeUseInterval&&form.date)?(()=>{const d=new Date(form.date);d.setDate(d.getDate()+parseInt(form.safeUseInterval));return d.toISOString().slice(0,10);})():null;
  return(
    <div className="glass-card p-5 space-y-4">
      <h3 className="text-lg font-semibold text-white">{record?"투입물 수정":"새 투입물 기록"}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label className="text-xs text-gray-600 mb-1 block">날짜 *</label><input style={LIGHT_INPUT} type="date" value={form.date} onChange={e=>set("date",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">투입유형 *</label><select style={LIGHT_INPUT} value={form.inputType} onChange={e=>set("inputType",e.target.value)} className={SC}>{INPUT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
        <div><label className="text-xs text-gray-600 mb-1 block">제품명 *</label><input style={LIGHT_INPUT} type="text" value={form.productName} onChange={e=>set("productName",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">제조사</label><input style={LIGHT_INPUT} type="text" value={form.manufacturer} onChange={e=>set("manufacturer",e.target.value)} className="input-field text-sm w-full" /></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label className="text-xs text-gray-600 mb-1 block">사용량 *</label><div className="flex gap-1"><input style={LIGHT_INPUT} type="number" step="0.1" value={form.quantity} onChange={e=>set("quantity",e.target.value)} className="input-field text-sm flex-1" /><select style={LIGHT_INPUT} value={form.unit} onChange={e=>set("unit",e.target.value)} className="input-field jrn-select text-sm w-16">{INPUT_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select></div></div>
        <div><label className="text-xs text-gray-600 mb-1 block">비용 (원)</label><input style={LIGHT_INPUT} type="number" value={form.cost} onChange={e=>set("cost",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">투입 면적 (평)</label><input style={LIGHT_INPUT} type="number" value={form.targetArea} onChange={e=>set("targetArea",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">투입 방법</label><select style={LIGHT_INPUT} value={form.method} onChange={e=>set("method",e.target.value)} className={SC}><option value="">선택</option><option value="관주">관주</option><option value="엽면살포">엽면살포</option><option value="토양시비">토양시비</option><option value="점적">점적</option><option value="직접투입">직접투입</option><option value="기타">기타</option></select></div>
      </div>
      {/* PLS 농약 정밀 기록 — 농약일 때만 노출 (GAP/PLS 인증 의무 항목) */}
      {form.inputType==="농약"&&(
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold !text-amber-900">🏅 PLS / GAP 의무 기록</span>
            <span className="text-[11px] !text-amber-700">— 농약 등록번호·희석배수·안전사용기준 (인증 필수 항목)</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label className="text-xs text-gray-700 mb-1 block">농약 등록번호 <a href="https://psis.rda.go.kr/" target="_blank" rel="noreferrer" className="!text-blue-700 underline text-[10px]">PSIS 검색</a></label><input style={LIGHT_INPUT} type="text" value={form.pesticideRegNo} onChange={e=>set("pesticideRegNo",e.target.value)} placeholder="예: 12345-호" className="input-field text-sm w-full" /></div>
            <div><label className="text-xs text-gray-700 mb-1 block">희석 배수</label><input style={LIGHT_INPUT} type="text" value={form.dilutionRatio} onChange={e=>set("dilutionRatio",e.target.value)} placeholder="예: 1000배" className="input-field text-sm w-full" /></div>
            <div><label className="text-xs text-gray-700 mb-1 block">사용 횟수 (PLS 제한)</label><input style={LIGHT_INPUT} type="number" value={form.applicationCount} onChange={e=>set("applicationCount",e.target.value)} placeholder="작목별 제한 횟수" className="input-field text-sm w-full" /></div>
            <div><label className="text-xs text-gray-700 mb-1 block">수확 전 사용 가능일</label><input style={LIGHT_INPUT} type="number" value={form.safeUseInterval} onChange={e=>set("safeUseInterval",e.target.value)} placeholder="예: 7 (수확 7일 전까지)" className="input-field text-sm w-full" /></div>
            <div><label className="text-xs text-gray-700 mb-1 block">살포자</label><input style={LIGHT_INPUT} type="text" value={form.applicator} onChange={e=>set("applicator",e.target.value)} placeholder="이름 (안전관리)" className="input-field text-sm w-full" /></div>
            {preHarvestDate&&(
              <div className="flex flex-col justify-end">
                <div className="bg-emerald-50 border border-emerald-400 rounded-md px-2 py-1.5 text-xs">
                  <div className="!text-emerald-700 font-semibold text-[10px]">📅 수확 가능일 (자동 계산)</div>
                  <div className="!text-emerald-900 font-bold">{preHarvestDate}</div>
                </div>
              </div>
            )}
          </div>
          <p className="text-[11px] !text-amber-800 leading-relaxed">
            ⚠ <strong>PLS 안전사용기준</strong>: 농약을 작물별 등록된 횟수·희석배수로만 사용. 수확 전 사용 가능일자 이후엔 살포 금지. GAP 인증 시 의무 기록.
          </p>
        </div>
      )}
      <div><label className="text-xs text-gray-600 mb-1 block">비고</label><input style={LIGHT_INPUT} type="text" value={form.notes} onChange={e=>set("notes",e.target.value)} className="input-field text-sm w-full" /></div>
      <div className="flex justify-end gap-2">{onCancel&&<button onClick={onCancel} className="btn-secondary">취소</button>}<button onClick={handleSubmit} className="btn-primary">{record?"수정":"저장"}</button></div>
    </div>
  );
}

// ━━━ 자재 입출고 대장 (인증/규제 단계 2) ━━━
function InventoryTab(){
  const[subTab,setSubTab]=useState("list");
  const tabBtn=(id,emoji,label)=>(
    <button key={id} onClick={()=>setSubTab(id)} className={`flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-xl text-sm font-medium transition-all min-w-0 active:scale-[0.97] ${subTab===id?"bg-blue-600 text-white shadow-lg shadow-blue-600/20":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"}`}><span className="flex-shrink-0">{emoji}</span><span className="truncate">{label}</span></button>
  );
  return(<div className="space-y-4"><div className="flex gap-1.5 flex-wrap">
    {tabBtn("list","📋","입출고 조회")}
    {tabBtn("write","➕","새 등록")}
    {tabBtn("stock","📊","현재 보관량")}
  </div>
  {subTab==="list"&&<InventoryList />}
  {subTab==="write"&&<InventoryWrite />}
  {subTab==="stock"&&<InventoryStock />}
  </div>);
}

const INV_ACTIONS = [
  { value: "IN", label: "입고", icon: "📥", color: "emerald" },
  { value: "OUT", label: "사용", icon: "📤", color: "blue" },
  { value: "DISPOSAL", label: "폐기", icon: "🗑️", color: "rose" },
];

function InventoryList(){const FARM_ID=useContext(FarmIdCtx);
  const df=useDateFilter();
  const[rows,setRows]=useState([]);const[loading,setLoading]=useState(true);
  const[filter,setFilter]=useState({type:"",action:"",productName:""});
  const[editing,setEditing]=useState(null);
  const load=useCallback(async()=>{
    try{setLoading(true);
      let url=`/journal/${FARM_ID}/inventory?limit=200`;
      if(df.dateRange.start)url+=`&startDate=${df.dateRange.start}`;
      if(df.dateRange.end)url+=`&endDate=${df.dateRange.end}`;
      if(filter.type)url+=`&type=${filter.type}`;
      if(filter.action)url+=`&action=${filter.action}`;
      if(filter.productName)url+=`&productName=${encodeURIComponent(filter.productName)}`;
      const r=await api(url);
      setRows(r.data||[]);
    }finally{setLoading(false);}
  },[FARM_ID,df.dateRange,filter]);
  useEffect(()=>{load()},[load]);
  const handleDelete=async(id)=>{
    if(!confirm("삭제하시겠습니까?"))return;
    await api(`/journal/${FARM_ID}/inventory/${id}`,{method:"DELETE"});
    load();
  };
  const actionMeta=(a)=>INV_ACTIONS.find(x=>x.value===a)||INV_ACTIONS[0];
  return(
    <div className="space-y-4">
      <SearchFilterBar {...df}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">유형</span>
            <select value={filter.type} onChange={e=>setFilter(p=>({...p,type:e.target.value}))} style={LIGHT_INPUT} className="input-field jrn-select text-xs py-1 px-2 w-24"><option value="">전체</option>{INPUT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select>
          </div>
          <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">액션</span>
            <select value={filter.action} onChange={e=>setFilter(p=>({...p,action:e.target.value}))} style={LIGHT_INPUT} className="input-field jrn-select text-xs py-1 px-2 w-24"><option value="">전체</option>{INV_ACTIONS.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}</select>
          </div>
          <div className="flex items-center gap-2"><span className="text-xs text-gray-600 font-medium">제품명</span>
            <input style={LIGHT_INPUT} type="text" value={filter.productName} onChange={e=>setFilter(p=>({...p,productName:e.target.value}))} placeholder="검색" className="input-field text-xs py-1 px-2 w-32" />
          </div>
          <button onClick={()=>{setFilter({type:"",action:"",productName:""});df.resetFilters()}} className="px-3 py-1 rounded-lg text-xs bg-white !text-gray-700 border border-gray-300 hover:bg-gray-50 font-medium">↺ 초기화</button>
          <span className="text-xs text-gray-500 ml-auto">{rows.length}건</span>
        </div>
      </SearchFilterBar>
      {editing&&<InventoryWrite editing={editing} onDone={()=>{setEditing(null);load();}} />}
      {loading?(
        <div className="glass-card p-10 text-center text-gray-400">불러오는 중...</div>
      ):rows.length===0?(
        <div className="glass-card p-10 text-center text-gray-400">조건에 맞는 기록이 없습니다</div>
      ):(
        <div className="space-y-2">
          {rows.map(r=>{
            const m=actionMeta(r.action);
            return(
              <div key={r._id} className="glass-card p-3 flex items-center gap-3 flex-wrap">
                <span className={`px-2 py-1 rounded-md text-xs font-bold bg-${m.color}-100 !text-${m.color}-800 border border-${m.color}-300 w-20 text-center`} style={m.color==="emerald"?{backgroundColor:"#d1fae5",color:"#065f46",borderColor:"#34d399"}:m.color==="blue"?{backgroundColor:"#dbeafe",color:"#1e40af",borderColor:"#60a5fa"}:{backgroundColor:"#fee2e2",color:"#9f1239",borderColor:"#fb7185"}}>
                  {m.icon} {m.label}
                </span>
                <span className="text-xs text-gray-500 w-24">{toKR(r.date)}</span>
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 !text-gray-700 rounded font-medium">{r.type}</span>
                <span className="text-sm font-semibold !text-gray-900 flex-1 min-w-[150px]">{r.productName}{r.manufacturer&&<span className="text-xs !text-gray-500 ml-1">({r.manufacturer})</span>}</span>
                <span className="text-sm !text-gray-700 font-medium">{r.quantity} {r.unit}</span>
                {r.cost&&<span className="text-xs !text-amber-700 font-medium">{r.cost.toLocaleString()}원</span>}
                {r.supplier&&<span className="text-xs !text-violet-700">📍 {r.supplier}</span>}
                <button onClick={()=>setEditing(r)} className="px-2 py-1 rounded text-xs bg-blue-50 !text-blue-700 border border-blue-300 hover:bg-blue-100">✏️</button>
                <button onClick={()=>handleDelete(r._id)} className="px-2 py-1 rounded text-xs bg-rose-50 !text-rose-700 border border-rose-300 hover:bg-rose-100">🗑️</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InventoryWrite({editing,onDone}){const FARM_ID=useContext(FarmIdCtx);
  const today=new Date().toISOString().split("T")[0];
  const empty={date:today,type:"비료",productName:"",manufacturer:"",action:"IN",quantity:"",unit:"kg",supplier:"",cost:"",notes:""};
  const[form,setForm]=useState(editing?{...empty,...editing,date:editing.date?new Date(editing.date).toISOString().split("T")[0]:today}:empty);
  const[saving,setSaving]=useState(false);const[saved,setSaved]=useState(false);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const handleSubmit=async()=>{
    if(!form.productName.trim()||!form.quantity||!form.unit){alert("제품명·수량·단위는 필수");return;}
    setSaving(true);
    try{
      if(editing){
        await api(`/journal/${FARM_ID}/inventory/${editing._id}`,{method:"PUT",body:JSON.stringify(form)});
        if(onDone)onDone();
      }else{
        await api(`/journal/${FARM_ID}/inventory`,{method:"POST",body:JSON.stringify(form)});
        setSaved(true);setTimeout(()=>setSaved(false),3000);
        setForm(empty);
      }
    }catch(e){alert("저장 실패: "+e.message);}finally{setSaving(false);}
  };
  return(
    <div className="glass-card p-5 space-y-4">
      {saved&&<div className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-600 px-4 py-3 rounded-lg text-sm">✅ 자재 기록이 저장되었습니다!</div>}
      <h3 className="text-lg font-semibold !text-gray-900">{editing?"자재 기록 수정":"새 자재 기록"}</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="col-span-2 md:col-span-1"><label className="text-xs text-gray-600 mb-1 block">날짜 *</label><input style={LIGHT_INPUT} type="date" value={form.date} onChange={e=>set("date",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">자재 유형 *</label><select style={LIGHT_INPUT} value={form.type} onChange={e=>set("type",e.target.value)} className={SC}>{INPUT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
        <div><label className="text-xs text-gray-600 mb-1 block">액션 *</label>
          <div className="flex gap-1">
            {INV_ACTIONS.map(a=>(
              <button key={a.value} type="button" onClick={()=>set("action",a.value)}
                className={`flex-1 px-1 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${form.action===a.value?"!text-white":"bg-white !text-gray-600 border-gray-300 hover:bg-gray-50"}`}
                style={form.action===a.value?{backgroundColor:a.color==="emerald"?"#10b981":a.color==="blue"?"#3b82f6":"#f43f5e",borderColor:a.color==="emerald"?"#10b981":a.color==="blue"?"#3b82f6":"#f43f5e"}:undefined}>
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2"><label className="text-xs text-gray-600 mb-1 block">제품명 *</label><input style={LIGHT_INPUT} type="text" value={form.productName} onChange={e=>set("productName",e.target.value)} placeholder="예: 다이센엠45 수화제" className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">제조사</label><input style={LIGHT_INPUT} type="text" value={form.manufacturer} onChange={e=>set("manufacturer",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-600 mb-1 block">{form.action==="IN"?"공급처/판매처":form.action==="OUT"?"사용 위치":"폐기 사유"}</label><input style={LIGHT_INPUT} type="text" value={form.supplier} onChange={e=>set("supplier",e.target.value)} className="input-field text-sm w-full" /></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2"><label className="text-xs text-gray-600 mb-1 block">수량 *</label>
          <div className="flex gap-1">
            <input style={LIGHT_INPUT} type="number" step="0.01" value={form.quantity} onChange={e=>set("quantity",e.target.value)} className="input-field text-sm flex-1" />
            <select style={LIGHT_INPUT} value={form.unit} onChange={e=>set("unit",e.target.value)} className="input-field jrn-select text-sm w-16">{INPUT_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select>
          </div>
        </div>
        {form.action==="IN"&&(
          <div className="col-span-2"><label className="text-xs text-gray-600 mb-1 block">구매 비용 (원)</label><input style={LIGHT_INPUT} type="number" value={form.cost} onChange={e=>set("cost",e.target.value)} placeholder="영수증 합계" className="input-field text-sm w-full" /></div>
        )}
      </div>
      <div><label className="text-xs text-gray-600 mb-1 block">비고</label><input style={LIGHT_INPUT} type="text" value={form.notes} onChange={e=>set("notes",e.target.value)} className="input-field text-sm w-full" /></div>
      <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-[11px] !text-amber-800">
        💡 친환경/GAP 인증 시 자재의 <strong>구매·사용·보관</strong> 기록 의무. 입고 시 영수증 보관 권장.
      </div>
      <div className="flex justify-end gap-2">
        {editing&&<button onClick={onDone} className="btn-secondary">취소</button>}
        <button onClick={handleSubmit} disabled={saving} className="btn-primary disabled:opacity-50">{saving?"저장 중...":editing?"수정":"저장"}</button>
      </div>
    </div>
  );
}

function InventoryStock(){const FARM_ID=useContext(FarmIdCtx);
  const[summary,setSummary]=useState([]);const[loading,setLoading]=useState(true);
  useEffect(()=>{
    setLoading(true);
    api(`/journal/${FARM_ID}/inventory/summary`).then(r=>setSummary(r.data||[])).finally(()=>setLoading(false));
  },[FARM_ID]);
  const totalValue=summary.reduce((a,r)=>a+(r.totalCost||0),0);
  const lowStock=summary.filter(r=>r.currentStock<=0&&r.outQty>0);
  return(
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-card p-3"><div className="text-[11px] !text-gray-600 mb-1">총 품목</div><div className="text-2xl font-bold !text-gray-900">{summary.length}</div></div>
        <div className="glass-card p-3"><div className="text-[11px] !text-gray-600 mb-1">총 구매액</div><div className="text-2xl font-bold !text-emerald-700">{totalValue.toLocaleString()}원</div></div>
        <div className="glass-card p-3"><div className="text-[11px] !text-gray-600 mb-1">소진/부족</div><div className="text-2xl font-bold !text-rose-700">{lowStock.length}품목</div></div>
        <div className="glass-card p-3"><div className="text-[11px] !text-gray-600 mb-1">활성 품목</div><div className="text-2xl font-bold !text-blue-700">{summary.filter(r=>r.currentStock>0).length}</div></div>
      </div>
      {loading?(
        <div className="glass-card p-10 text-center text-gray-400">불러오는 중...</div>
      ):summary.length===0?(
        <div className="glass-card p-10 text-center text-gray-400">자재 기록이 없습니다. "새 등록" 탭에서 입고를 먼저 등록하세요.</div>
      ):(
        <div className="glass-card p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 text-xs !text-gray-600 font-semibold">유형</th>
              <th className="text-left py-2 px-2 text-xs !text-gray-600 font-semibold">제품명</th>
              <th className="text-right py-2 px-2 text-xs !text-gray-600 font-semibold">입고</th>
              <th className="text-right py-2 px-2 text-xs !text-gray-600 font-semibold">사용</th>
              <th className="text-right py-2 px-2 text-xs !text-gray-600 font-semibold">폐기</th>
              <th className="text-right py-2 px-2 text-xs !text-gray-600 font-semibold">현재 보관량</th>
              <th className="text-right py-2 px-2 text-xs !text-gray-600 font-semibold">구매액</th>
            </tr></thead>
            <tbody>
              {summary.map((r,i)=>(
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-2 text-xs"><span className="px-1.5 py-0.5 bg-gray-100 !text-gray-700 rounded font-medium">{r.type}</span></td>
                  <td className="py-2 px-2 text-sm font-semibold !text-gray-900">{r.productName}{r.manufacturer&&<span className="text-xs !text-gray-500 ml-1">({r.manufacturer})</span>}</td>
                  <td className="py-2 px-2 text-right !text-emerald-700 font-medium">{r.inQty.toFixed(2)} {r.unit}</td>
                  <td className="py-2 px-2 text-right !text-blue-700 font-medium">{r.outQty.toFixed(2)}</td>
                  <td className="py-2 px-2 text-right !text-rose-700">{r.disposalQty.toFixed(2)}</td>
                  <td className={`py-2 px-2 text-right font-bold ${r.currentStock<=0?'!text-rose-700':r.currentStock<r.inQty*0.2?'!text-amber-700':'!text-gray-900'}`}>{r.currentStock.toFixed(2)} {r.unit}</td>
                  <td className="py-2 px-2 text-right text-xs !text-gray-700">{r.totalCost?r.totalCost.toLocaleString():"-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ━━━ 통계 ━━━
function SummaryTab({data}){
  if(!data)return<div className="text-center text-gray-400 py-10">불러오는 중...</div>;
  const cards=[
    {label:"영농일지",value:data.journalCount,unit:"건",color:"text-emerald-400"},
    {label:"수확 기록",value:data.harvestCount,unit:"건",color:"text-yellow-400"},
    {label:"투입물 기록",value:data.inputCount,unit:"건",color:"text-blue-400"},
    {label:"총 수확량",value:data.totalHarvest,unit:"kg",color:"text-emerald-400"},
    {label:"총 매출",value:data.totalRevenue?.toLocaleString(),unit:"원",color:"text-emerald-400"},
    {label:"총 투입비용",value:data.totalInputCost?.toLocaleString(),unit:"원",color:"text-orange-400"},
    {label:"순이익",value:data.profit?.toLocaleString(),unit:"원",color:data.profit>=0?"text-emerald-400":"text-red-400"},
  ];
  return(
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{cards.map(c=>(<div key={c.label} className="glass-card p-4"><p className="text-xs text-gray-400">{c.label}</p><p className={`text-2xl font-bold ${c.color} mt-1`}>{c.value} <span className="text-sm font-normal text-gray-500">{c.unit}</span></p></div>))}</div>
      {data.workTypeStats?.length>0&&(<div className="glass-card p-4"><h3 className="text-sm font-medium text-white mb-3">작업유형별 일지 수</h3><div className="space-y-2">{data.workTypeStats.map(s=>(<div key={s.workType} className="flex items-center gap-3"><span className="text-sm text-gray-300 w-16">{s.workType}</span><div className="flex-1 bg-white/5 rounded-full h-5"><div className="bg-emerald-500/50 h-5 rounded-full flex items-center px-2" style={{width:`${Math.max((s.count/Math.max(...data.workTypeStats.map(x=>x.count)))*100,10)}%`}}><span className="text-xs text-white">{s.count}</span></div></div></div>))}</div></div>)}
      {data.inputByType&&Object.keys(data.inputByType).length>0&&(<div className="glass-card p-4"><h3 className="text-sm font-medium text-white mb-3">투입유형별 비용</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Object.entries(data.inputByType).map(([type,cost])=>(<div key={type} className="bg-white/5 rounded-lg p-3"><p className="text-xs text-gray-400">{type}</p><p className="text-lg font-bold text-orange-400">{cost.toLocaleString()} <span className="text-xs font-normal">원</span></p></div>))}</div></div>)}
    </div>
  );
}
