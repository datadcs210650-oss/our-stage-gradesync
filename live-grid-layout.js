/* GrandeSync Live: drag/reorder score columns, fixed identifiers, resize, and honest save states.
 * Pure DOM/local preference; never polls or writes to the grading server. */
(()=>{
"use strict";
const STORAGE_PREFIX="gsx-live-columns-v1:";
const key=()=>STORAGE_PREFIX+(window.currentUserData?.code||"OSC")+":"+(window._selectedGradingGroupId||document.getElementById("grading-group-select")?.value||"all");
const qs=(root,sel)=>[...root.querySelectorAll(sel)];
function findTable(){
 const input=document.querySelector("#grading-score-panel input.score-input, #main-content input.score-input");
 return input?.closest("table")||null;
}
function columns(table){
 const h=table.tHead?.rows?.[0]||table.querySelector("thead tr");
 if(!h)return null;
 const heads=[...h.cells];
 if(heads.length<4||[...table.querySelectorAll("tr")].some(row=>row.cells.length&&row.cells.length!==heads.length))return null;
 return{heads,rows:[...table.rows].filter(row=>row.cells.length===heads.length)};
}
function applyOrder(table,desired){
 const x=columns(table);if(!x)return;
 const {heads,rows}=x,keys=heads.map(h=>h.dataset.gsxColKey).filter(Boolean);
 if(!Array.isArray(desired)||desired.length!==keys.length||new Set(desired).size!==keys.length||
  desired.some(k=>!keys.includes(k)))return;
 for(const row of rows){
  const cells=[...row.cells],lookup=new Map(cells.map((cell,i)=>[keys[i],cell]));
  for(const k of desired)row.append(lookup.get(k));
 }
}
function decorate(table){
 if(!table.isConnected||table.dataset.gsxLiveTable==="true")return;
 const x=columns(table);if(!x)return;
 const {heads}=x,group=key();
 heads.forEach((h,i)=>{
  h.dataset.gsxColKey="column-"+i;
  h.dataset.gsxOrigin=String(i);
 });
 table.dataset.gsxLiveTable="true";
 table.classList.add("gsx-live-grid");
 try{const saved=JSON.parse(localStorage.getItem(group)||"null");if(saved)applyOrder(table,saved)}catch(_e){}
 const rebuild=()=>{const row=table.tHead?.rows?.[0]||table.querySelector("thead tr");return row?[...row.cells]:[]};
 let dragging=null,resizing=null;
 function persist(){try{localStorage.setItem(group,JSON.stringify(rebuild().map(h=>h.dataset.gsxColKey)))}catch(_e){}}
 const all=rebuild();
 for(let i=0;i<all.length;i++){
  const th=all[i];
  if(i<3){th.classList.add("gsx-sticky-head");continue}
  th.draggable=true;th.tabIndex=0;th.title="Kéo để sắp xếp cột";
  const grip=document.createElement("span");
  grip.className="gsx-col-grip";grip.textContent="⠿";grip.setAttribute("aria-hidden","true");th.prepend(grip);
  const handle=document.createElement("span");
  handle.className="gsx-resize";handle.title="Kéo để thay đổi độ rộng cột";
  handle.setAttribute("aria-hidden","true");th.append(handle);
  handle.addEventListener("pointerdown",e=>{
   if(e.button!==0)return;e.preventDefault();e.stopPropagation();
   const index=rebuild().indexOf(th);const original=th.getBoundingClientRect().width,start=e.clientX;
   resizing={index,original,start};handle.setPointerCapture?.(e.pointerId);
   th.draggable=false;
  });
  handle.addEventListener("pointermove",e=>{
   if(!resizing)return;const width=Math.max(90,Math.min(420,resizing.original+e.clientX-resizing.start));
   for(const row of table.rows){if(row.cells[resizing.index])row.cells[resizing.index].style.width=width+"px"}
  });
  const stop=()=>{resizing=null;th.draggable=true};
  handle.addEventListener("pointerup",stop);handle.addEventListener("pointercancel",stop);
  th.addEventListener("dragstart",e=>{dragging=th.dataset.gsxColKey;e.dataTransfer.effectAllowed="move";th.classList.add("gsx-dragging")});
  th.addEventListener("dragend",()=>{dragging=null;th.classList.remove("gsx-dragging");qs(table,"th").forEach(h=>h.classList.remove("gsx-drop"))});
  th.addEventListener("dragover",e=>{if(dragging){e.preventDefault();e.dataTransfer.dropEffect="move";th.classList.add("gsx-drop")}});
  th.addEventListener("dragleave",()=>th.classList.remove("gsx-drop"));
  th.addEventListener("drop",e=>{
   e.preventDefault();th.classList.remove("gsx-drop");
   const row=rebuild(),keys=row.map(h=>h.dataset.gsxColKey);
   const from=keys.indexOf(dragging),to=keys.indexOf(th.dataset.gsxColKey);
   if(from<3||to<3||from<0||to<0||from===to)return;
   const [moved]=keys.splice(from,1);keys.splice(to,0,moved);
   applyOrder(table,keys);persist();
  });
  th.addEventListener("keydown",e=>{
   if(!e.altKey||!["ArrowLeft","ArrowRight"].includes(e.key))return;
   e.preventDefault();const row=rebuild(),keys=row.map(h=>h.dataset.gsxColKey);
   const from=keys.indexOf(th.dataset.gsxColKey),to=from+(e.key==="ArrowLeft"?-1:1);
   if(to<3||to>=keys.length)return;
   const [moved]=keys.splice(from,1);keys.splice(to,0,moved);
   applyOrder(table,keys);persist();th.focus();
  });
 }
}
let scheduled=false;
function scan(){
 scheduled=false;
 const table=findTable();if(table)decorate(table);
}
function schedule(){if(!scheduled){scheduled=true;setTimeout(scan,130)}}
function paint(input){
 const id=input.dataset.cand,status=document.getElementById("save-status-"+id);
 if(!status)return;
 status.style.opacity="1";
 const pending=navigator.onLine===false;
 status.textContent=pending?"Lưu tạm trên thiết bị":"Đang lưu lên máy chủ…";
 status.style.color=pending?"#b45309":"#7a1837";
}
document.addEventListener("input",e=>{
 if(e.target.matches?.("input.score-input")){
  paint(e.target);
  if(navigator.onLine===false)window.showToast?.("Điểm chưa được gửi lên máy chủ. Không khóa/nộp khi mất mạng.","error");
 }
},true);
const root=document.getElementById("main-content");
if(root)new MutationObserver(schedule).observe(root,{subtree:true,childList:true});
window.addEventListener("online",schedule);
schedule();
})();
