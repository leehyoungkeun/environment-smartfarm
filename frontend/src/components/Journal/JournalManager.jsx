// src/components/Journal/JournalManager.jsx
import { useState, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import Pagination from "./Pagination.jsx";

if (!document.getElementById("journal-select-fix")) {
  const s = document.createElement("style");
  s.id = "journal-select-fix";
  s.textContent = `select.jrn-select{background:#1e293b!important;color:#e2e8f0!important}select.jrn-select option{background:#1e293b;color:#e2e8f0}input[type=date].input-field::-webkit-calendar-picker-indicator{filter:invert(.7)}.cal-today{background:linear-gradient(135deg,#10b981,#3b82f6);color:#fff;border-radius:9999px}.cal-has-entry{position:relative}.cal-has-entry::after{content:'';position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:4px;height:4px;background:#10b981;border-radius:50%}.cal-selected{background:#3b82f6;color:#fff;border-radius:9999px}.detail-expand{animation:slideDown .2s ease-out}@keyframes slideDown{from{opacity:0;max-height:0}to{opacity:1;max-height:500px}}.lightbox-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;animation:fadeIn .2s}.lightbox-overlay img{max-width:90vw;max-height:85vh;object-fit:contain;border-radius:8px}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@media print{.no-print{display:none!important}.print-only{display:block!important}}`;
  document.head.appendChild(s);
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";
const FarmIdCtx = createContext(import.meta.env.VITE_FARM_ID || "farm_001");
const WORK_TYPES = ["파종","정식","관수","시비","방제","수확","관리","기타"];
const GROWTH_STAGES = ["발아기","생장기","개화기","착과기","수확기"];
const WEATHER_OPTIONS = ["맑음","구름많음","흐림","비","눈","안개"];
const INPUT_TYPES = ["비료","농약","종자","기타"];
const GRADES = ["특","상","보통","하"];
const INPUT_UNITS = ["kg","g","L","ml","개","포","봉"];
const SC = "input-field jrn-select text-sm w-full";

function getToken(){return localStorage.getItem("accessToken")}
async function api(path,options={}){const token=getToken();const res=await fetch(`${API_BASE}${path}`,{...options,headers:{...(options.body instanceof FormData?{}:{"Content-Type":"application/json"}),Authorization:`Bearer ${token}`,...options.headers}});const data=await res.json();if(!data.success)throw new Error(data.error||"요청 실패");return data}
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
      <button onClick={onPrint} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white transition-all flex items-center gap-1">🖨️ 인쇄</button>
      <button onClick={onCSV} className="px-3 py-1.5 rounded-lg text-xs bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white transition-all flex items-center gap-1">📥 CSV</button>
      <button onClick={handlePDF} disabled={pdfLoading} className="px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all flex items-center gap-1 disabled:opacity-50">{pdfLoading?"⏳ 생성중...":"📄 PDF"}</button>
    </div>
  );
}

// ━━━ 메인 ━━━
export default function JournalManager({ farmId = import.meta.env.VITE_FARM_ID || "farm_001" }){
  const[activeTab,setActiveTab]=useState("journal");
  const[summary,setSummary]=useState(null);
  const tabs=[{key:"journal",label:"영농일지",icon:"📝"},{key:"harvest",label:"수확 기록",icon:"🌾"},{key:"input",label:"투입물 기록",icon:"💊"},{key:"summary",label:"통계",icon:"📊"}];
  useEffect(()=>{if(activeTab==="summary")api(`/journal/${farmId}/summary`).then(r=>setSummary(r.data)).catch(console.error)},[activeTab,farmId]);
  return(
    <FarmIdCtx.Provider value={farmId}>
    <div className="space-y-6">
      <div><h2 className="text-2xl font-bold text-white">영농일지</h2><p className="text-gray-400 mt-1">작업 기록, 수확, 투입물 관리</p></div>
      <div className="flex gap-2 flex-wrap">{tabs.map(tab=>(<button key={tab.key} onClick={()=>setActiveTab(tab.key)} className={`px-4 py-2 rounded-lg font-medium transition-all ${activeTab===tab.key?"bg-emerald-600 text-white":"bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"}`}>{tab.icon} {tab.label}</button>))}</div>
      {activeTab==="journal"&&<JournalTab />}
      {activeTab==="harvest"&&<HarvestTab />}
      {activeTab==="input"&&<InputTab />}
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
        <span className="text-xs text-gray-400 font-medium">조회기간</span>
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

function DetailRow({label,value,color}){if(!value&&value!==0)return null;return(<div className="flex"><span className="text-xs text-gray-500 w-20 shrink-0">{label}</span><span className={`text-xs ${color||"text-gray-300"} whitespace-pre-wrap`}>{value}</span></div>)}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 영농일지 탭
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function JournalTab(){
  const[subTab,setSubTab]=useState("list");
  return(<div className="space-y-4"><div className="flex gap-2">
    <button onClick={()=>setSubTab("list")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${subTab==="list"?"bg-blue-600 text-white":"bg-white/5 text-gray-400 hover:bg-white/10"}`}>📋 일지 조회</button>
    <button onClick={()=>setSubTab("write")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${subTab==="write"?"bg-blue-600 text-white":"bg-white/5 text-gray-400 hover:bg-white/10"}`}>✏️ 일지 작성</button>
  </div>{subTab==="list"&&<JournalSearch />}{subTab==="write"&&<JournalWrite />}</div>);
}

function JournalSearch(){const FARM_ID=useContext(FarmIdCtx);
  const df=useDateFilter();
  const[entries,setEntries]=useState([]);const[loading,setLoading]=useState(true);
  const[pagination,setPagination]=useState({page:1,totalPages:1});
  const[entryDates,setEntryDates]=useState([]);const[filter,setFilter]=useState({workType:"",keyword:""});
  const[editingEntry,setEditingEntry]=useState(null);const[expandedId,setExpandedId]=useState(null);

  useEffect(()=>{api(`/journal/${FARM_ID}/entries?limit=200&startDate=${df.dateRange.start}&endDate=${df.dateRange.end}`).then(res=>setEntryDates([...new Set(res.data.map(e=>e.date?.split("T")[0]))])).catch(console.error)},[df.dateRange]);

  const load=useCallback(async(page=1)=>{
    try{setLoading(true);let url=`/journal/${FARM_ID}/entries?page=${page}&limit=20`;
      if(df.selectedDate)url+=`&startDate=${df.selectedDate}&endDate=${df.selectedDate}`;
      else{if(df.dateRange.start)url+=`&startDate=${df.dateRange.start}`;if(df.dateRange.end)url+=`&endDate=${df.dateRange.end}`}
      if(filter.workType)url+=`&workType=${filter.workType}`;
      const res=await api(url);let data=res.data;
      if(filter.keyword.trim()){const kw=filter.keyword.trim().toLowerCase();data=data.filter(e=>e.content?.toLowerCase().includes(kw)||e.pest?.toLowerCase().includes(kw)||e.notes?.toLowerCase().includes(kw))}
      setEntries(data);setPagination(res.pagination);
    }catch(e){console.error(e)}finally{setLoading(false)}
  },[df.dateRange,df.selectedDate,filter]);
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
              <div className="flex items-center gap-2"><span className="text-xs text-gray-400 font-medium">작업유형</span><select value={filter.workType} onChange={e=>setFilter(p=>({...p,workType:e.target.value}))} className="input-field jrn-select text-xs py-1 px-2 w-28"><option value="">전체</option>{WORK_TYPES.map(w=><option key={w} value={w}>{w}</option>)}</select></div>
              <div className="flex items-center gap-2"><span className="text-xs text-gray-400 font-medium">작업내용</span><input type="text" value={filter.keyword} onChange={e=>setFilter(p=>({...p,keyword:e.target.value}))} placeholder="검색어" className="input-field text-xs py-1 px-2 w-40" /></div>
              <button onClick={()=>{setFilter({workType:"",keyword:""});df.resetFilters()}} className="px-3 py-1 rounded-lg text-xs bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white">↺ 초기화</button>
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
                <div className="p-4 flex items-center gap-3" onClick={()=>setExpandedId(isOpen?null:entry._id)}>
                  <span className={`text-xs transition-transform ${isOpen?"rotate-90":""}`}>▶</span>
                  <span className="text-sm text-gray-400 w-24 shrink-0">{toKR(entry.date)}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">{entry.workType}</span>
                  {entry.growthStage&&<span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">{entry.growthStage}</span>}
                  {entry.weather&&<span className="text-xs text-gray-500">☁ {entry.weather}</span>}
                  <span className="text-sm text-gray-300 truncate flex-1">{entry.content}</span>
                  {entry.photos?.length>0&&<span className="text-xs text-gray-500">📷 {entry.photos.length}</span>}
                </div>
                {isOpen&&(
                  <div className="px-4 pb-4 pt-0 border-t border-white/5 detail-expand">
                    <div className="mt-3 space-y-2">
                      <DetailRow label="작업 내용" value={entry.content} color="text-white" />
                      <DetailRow label="날씨" value={entry.weather} />
                      <DetailRow label="온도" value={(entry.tempMin||entry.tempMax)?`${entry.tempMin||"-"} ~ ${entry.tempMax||"-"} °C`:null} />
                      <DetailRow label="습도" value={entry.humidity?`${entry.humidity}%`:null} />
                      <DetailRow label="생육단계" value={entry.growthStage} color="text-blue-400" />
                      <DetailRow label="병해충" value={entry.pest} color="text-orange-400" />
                      <DetailRow label="비고" value={entry.notes} />
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

// ━━━ 영농일지 폼 ━━━
function JournalForm({entry,onSave,onCancel}){const FARM_ID=useContext(FarmIdCtx);
  const today=new Date().toISOString().split("T")[0];
  const[form,setForm]=useState({date:entry?.date?new Date(entry.date).toISOString().split("T")[0]:today,weather:entry?.weather||"",tempMin:entry?.tempMin||"",tempMax:entry?.tempMax||"",humidity:entry?.humidity||"",workType:entry?.workType||"관리",growthStage:entry?.growthStage||"",content:entry?.content||"",pest:entry?.pest||"",notes:entry?.notes||"",photos:entry?.photos||[]});
  const[uploading,setUploading]=useState(false);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const handlePhotoUpload=async e=>{const files=e.target.files;if(!files?.length)return;setUploading(true);try{const fd=new FormData();for(const f of files)fd.append("photos",f);const res=await fetch(`${API_BASE}/journal/${FARM_ID}/photos`,{method:"POST",headers:{Authorization:`Bearer ${getToken()}`},body:fd});const data=await res.json();if(data.success)set("photos",[...form.photos,...data.data])}catch(err){alert("업로드 실패")}finally{setUploading(false)}};
  const handleSubmit=async()=>{if(!form.content.trim()){alert("작업 내용을 입력하세요");return}await onSave(form);if(!entry)setForm({date:today,weather:"",tempMin:"",tempMax:"",humidity:"",workType:"관리",growthStage:"",content:"",pest:"",notes:"",photos:[]})};
  return(
    <div className="glass-card p-5 space-y-4">
      <h3 className="text-lg font-semibold text-white">{entry?"일지 수정":"새 일지 작성"}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label className="text-xs text-gray-400 mb-1 block">날짜 *</label><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">작업유형 *</label><select value={form.workType} onChange={e=>set("workType",e.target.value)} className={SC}>{WORK_TYPES.map(w=><option key={w} value={w}>{w}</option>)}</select></div>
        <div><label className="text-xs text-gray-400 mb-1 block">날씨</label><select value={form.weather} onChange={e=>set("weather",e.target.value)} className={SC}><option value="">선택</option>{WEATHER_OPTIONS.map(w=><option key={w} value={w}>{w}</option>)}</select></div>
        <div><label className="text-xs text-gray-400 mb-1 block">생육단계</label><select value={form.growthStage} onChange={e=>set("growthStage",e.target.value)} className={SC}><option value="">선택</option>{GROWTH_STAGES.map(g=><option key={g} value={g}>{g}</option>)}</select></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="text-xs text-gray-400 mb-1 block">최저 온도</label><input type="number" step="0.1" value={form.tempMin} onChange={e=>set("tempMin",e.target.value)} placeholder="°C" className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">최고 온도</label><input type="number" step="0.1" value={form.tempMax} onChange={e=>set("tempMax",e.target.value)} placeholder="°C" className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">습도</label><input type="number" step="0.1" value={form.humidity} onChange={e=>set("humidity",e.target.value)} placeholder="%" className="input-field text-sm w-full" /></div>
      </div>
      <div><label className="text-xs text-gray-400 mb-1 block">작업 내용 *</label><textarea value={form.content} onChange={e=>set("content",e.target.value)} rows={4} placeholder="오늘의 작업 내용을 기록하세요..." className="input-field text-sm w-full resize-none" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-gray-400 mb-1 block">병해충</label><input type="text" value={form.pest} onChange={e=>set("pest",e.target.value)} placeholder="발견된 병해충" className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">비고</label><input type="text" value={form.notes} onChange={e=>set("notes",e.target.value)} className="input-field text-sm w-full" /></div>
      </div>
      <div><label className="text-xs text-gray-400 mb-1 block">사진</label><div className="flex gap-2 items-center flex-wrap">
        {form.photos.map((photo,i)=>(<div key={i} className="relative"><img src={photoUrl(photo)} alt="" className="w-20 h-20 object-cover rounded-lg border border-white/10" /><button onClick={()=>set("photos",form.photos.filter((_,j)=>j!==i))} className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">×</button></div>))}
        {form.photos.length<5&&(<label className="w-20 h-20 flex items-center justify-center border-2 border-dashed border-white/20 rounded-lg cursor-pointer hover:border-emerald-400/50 transition-colors"><input type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />{uploading?<span className="text-xs text-gray-400">...</span>:<span className="text-2xl text-gray-500">+</span>}</label>)}
      </div></div>
      <div className="flex justify-end gap-2">{onCancel&&<button onClick={onCancel} className="btn-secondary">취소</button>}<button onClick={handleSubmit} className="btn-primary">{entry?"수정":"저장"}</button></div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 수확 기록 탭
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function HarvestTab(){
  const[subTab,setSubTab]=useState("list");
  return(<div className="space-y-4"><div className="flex gap-2">
    <button onClick={()=>setSubTab("list")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${subTab==="list"?"bg-blue-600 text-white":"bg-white/5 text-gray-400 hover:bg-white/10"}`}>📋 수확 조회</button>
    <button onClick={()=>setSubTab("write")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${subTab==="write"?"bg-blue-600 text-white":"bg-white/5 text-gray-400 hover:bg-white/10"}`}>✏️ 수확 기록</button>
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
              <div className="flex items-center gap-2"><span className="text-xs text-gray-400 font-medium">검색</span><input type="text" value={filter.keyword} onChange={e=>setFilter({keyword:e.target.value})} placeholder="작물명 / 출하처" className="input-field text-xs py-1 px-2 w-48" /></div>
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
                    <DetailRow label="매출" value={r.totalRevenue?`${r.totalRevenue.toLocaleString()}원`:null} color="text-emerald-400" />
                    <DetailRow label="비고" value={r.notes} />
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
  const[form,setForm]=useState({date:record?.date?new Date(record.date).toISOString().split("T")[0]:today,cropName:record?.cropName||"",quantity:record?.quantity||"",unit:record?.unit||"kg",grade:record?.grade||"",destination:record?.destination||"",unitPrice:record?.unitPrice||"",notes:record?.notes||""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const revenue=form.quantity&&form.unitPrice?(parseFloat(form.quantity)*parseFloat(form.unitPrice)).toLocaleString():null;
  const handleSubmit=async()=>{if(!form.cropName.trim()||!form.quantity){alert("작물명과 수확량은 필수입니다");return}await onSave(form);if(!record)setForm({date:today,cropName:"",quantity:"",unit:"kg",grade:"",destination:"",unitPrice:"",notes:""})};
  return(
    <div className="glass-card p-5 space-y-4">
      <h3 className="text-lg font-semibold text-white">{record?"수확 기록 수정":"새 수확 기록"}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label className="text-xs text-gray-400 mb-1 block">날짜 *</label><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">작물명 *</label><input type="text" value={form.cropName} onChange={e=>set("cropName",e.target.value)} placeholder="예: 토마토" className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">수확량 *</label><div className="flex gap-1"><input type="number" step="0.1" value={form.quantity} onChange={e=>set("quantity",e.target.value)} className="input-field text-sm flex-1" /><select value={form.unit} onChange={e=>set("unit",e.target.value)} className="input-field jrn-select text-sm w-16"><option value="kg">kg</option><option value="g">g</option><option value="개">개</option><option value="박스">박스</option></select></div></div>
        <div><label className="text-xs text-gray-400 mb-1 block">등급</label><select value={form.grade} onChange={e=>set("grade",e.target.value)} className={SC}><option value="">선택</option>{GRADES.map(g=><option key={g} value={g}>{g}</option>)}</select></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div><label className="text-xs text-gray-400 mb-1 block">출하처</label><input type="text" value={form.destination} onChange={e=>set("destination",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">단가 (원/{form.unit})</label><input type="number" value={form.unitPrice} onChange={e=>set("unitPrice",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">예상 매출</label><div className="input-field text-sm w-full bg-white/5 text-emerald-400 font-medium">{revenue?`${revenue}원`:"-"}</div></div>
      </div>
      <div><label className="text-xs text-gray-400 mb-1 block">비고</label><input type="text" value={form.notes} onChange={e=>set("notes",e.target.value)} className="input-field text-sm w-full" /></div>
      <div className="flex justify-end gap-2">{onCancel&&<button onClick={onCancel} className="btn-secondary">취소</button>}<button onClick={handleSubmit} className="btn-primary">{record?"수정":"저장"}</button></div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 투입물 기록 탭
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function InputTab(){
  const[subTab,setSubTab]=useState("list");
  return(<div className="space-y-4"><div className="flex gap-2">
    <button onClick={()=>setSubTab("list")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${subTab==="list"?"bg-blue-600 text-white":"bg-white/5 text-gray-400 hover:bg-white/10"}`}>📋 투입물 조회</button>
    <button onClick={()=>setSubTab("write")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${subTab==="write"?"bg-blue-600 text-white":"bg-white/5 text-gray-400 hover:bg-white/10"}`}>✏️ 투입물 기록</button>
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
              <div className="flex items-center gap-2"><span className="text-xs text-gray-400 font-medium">투입유형</span><select value={filter.inputType} onChange={e=>setFilter(p=>({...p,inputType:e.target.value}))} className="input-field jrn-select text-xs py-1 px-2 w-28"><option value="">전체</option>{INPUT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
              <div className="flex items-center gap-2"><span className="text-xs text-gray-400 font-medium">검색</span><input type="text" value={filter.keyword} onChange={e=>setFilter(p=>({...p,keyword:e.target.value}))} placeholder="제품명 / 제조사" className="input-field text-xs py-1 px-2 w-48" /></div>
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
  const[form,setForm]=useState({date:record?.date?new Date(record.date).toISOString().split("T")[0]:today,inputType:record?.inputType||"비료",productName:record?.productName||"",manufacturer:record?.manufacturer||"",quantity:record?.quantity||"",unit:record?.unit||"kg",cost:record?.cost||"",targetArea:record?.targetArea||"",method:record?.method||"",notes:record?.notes||""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const handleSubmit=async()=>{if(!form.productName.trim()||!form.quantity||!form.unit){alert("제품명, 사용량, 단위는 필수입니다");return}await onSave(form);if(!record)setForm({date:today,inputType:"비료",productName:"",manufacturer:"",quantity:"",unit:"kg",cost:"",targetArea:"",method:"",notes:""})};
  return(
    <div className="glass-card p-5 space-y-4">
      <h3 className="text-lg font-semibold text-white">{record?"투입물 수정":"새 투입물 기록"}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label className="text-xs text-gray-400 mb-1 block">날짜 *</label><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">투입유형 *</label><select value={form.inputType} onChange={e=>set("inputType",e.target.value)} className={SC}>{INPUT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
        <div><label className="text-xs text-gray-400 mb-1 block">제품명 *</label><input type="text" value={form.productName} onChange={e=>set("productName",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">제조사</label><input type="text" value={form.manufacturer} onChange={e=>set("manufacturer",e.target.value)} className="input-field text-sm w-full" /></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label className="text-xs text-gray-400 mb-1 block">사용량 *</label><div className="flex gap-1"><input type="number" step="0.1" value={form.quantity} onChange={e=>set("quantity",e.target.value)} className="input-field text-sm flex-1" /><select value={form.unit} onChange={e=>set("unit",e.target.value)} className="input-field jrn-select text-sm w-16">{INPUT_UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select></div></div>
        <div><label className="text-xs text-gray-400 mb-1 block">비용 (원)</label><input type="number" value={form.cost} onChange={e=>set("cost",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">투입 면적 (평)</label><input type="number" value={form.targetArea} onChange={e=>set("targetArea",e.target.value)} className="input-field text-sm w-full" /></div>
        <div><label className="text-xs text-gray-400 mb-1 block">투입 방법</label><select value={form.method} onChange={e=>set("method",e.target.value)} className={SC}><option value="">선택</option><option value="관주">관주</option><option value="엽면살포">엽면살포</option><option value="토양시비">토양시비</option><option value="점적">점적</option><option value="직접투입">직접투입</option><option value="기타">기타</option></select></div>
      </div>
      <div><label className="text-xs text-gray-400 mb-1 block">비고</label><input type="text" value={form.notes} onChange={e=>set("notes",e.target.value)} className="input-field text-sm w-full" /></div>
      <div className="flex justify-end gap-2">{onCancel&&<button onClick={onCancel} className="btn-secondary">취소</button>}<button onClick={handleSubmit} className="btn-primary">{record?"수정":"저장"}</button></div>
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
