/* GrandeSync Live: drag/reorder score columns, fixed identifiers, resize, and honest save states.
 * Pure DOM/local preference; never polls or writes to the grading server. */
(()=>{
"use strict";
const STORAGE_PREFIX="gsx-live-columns-v1:";

// Prevent accidental number stepping in scoring fields without adding UI copy.
function installScoreInputGuard(doc){
 const isScore=target=>target?.matches?.("input.score-input[type='number']")===true;
 doc.addEventListener("wheel",event=>{
  const input=event.target;
  if(isScore(input)&&doc.activeElement===input&&!input.disabled)input.blur();
 },{capture:true,passive:true});
 doc.addEventListener("keydown",event=>{
  if(isScore(event.target)&&!event.target.disabled&&(event.key==="ArrowUp"||event.key==="ArrowDown"))event.preventDefault();
 },true);
}
installScoreInputGuard(document);


const sheet=document.createElement("style");
sheet.textContent=[
 ".gsx-live-grid{border-collapse:separate!important;border-spacing:0!important;width:max-content;min-width:100%}",
 ".gsx-live-grid .gsx-sticky-cell{position:sticky!important;left:var(--gsx-fixed-left)!important;z-index:18;background:#fff8fa!important;box-shadow:inset -1px 0 #e6bac9}",
 ".gsx-live-grid thead .gsx-sticky-cell{z-index:41!important;background:#f5e6ec!important}",
 ".gsx-live-grid .gsx-sticky-last{box-shadow:3px 0 8px -4px #71203e,inset -1px 0 #dfb3c4}",
 ".gsx-live-grid .gsx-col-grip{display:inline-flex;padding:2px 5px;border-radius:5px;margin-right:5px;cursor:grab;color:#9f1239;font-size:18px;user-select:none}",
 ".gsx-live-grid .gsx-col-grip:hover{background:#f6dce6}",
 ".gsx-live-grid .gsx-resize{position:absolute;right:0;top:0;bottom:0;width:9px;cursor:col-resize;touch-action:none;z-index:70}",
 ".gsx-live-grid thead th{position:sticky!important;top:0;z-index:26;background:#f9eef2}",
 ".gsx-live-grid .gsx-drop{outline:2px dashed #991b1b;outline-offset:-2px}",
 ".gsx-live-grid .gsx-dragging{opacity:.5}"
].join("\n");
document.head.append(sheet);
function updateSticky(table){
 const data=columns(table);if(!data)return;
 const head=[...(table.tHead?.rows?.[0]?.cells||[])];
 const offsets=[0,0,0];
 for(let i=1;i<3;i++)offsets[i]=offsets[i-1]+(head[i-1]?.getBoundingClientRect().width||0);
 for(const row of data.rows){
  for(let i=0;i<Math.min(3,row.cells.length);i++){
   const cell=row.cells[i];cell.classList.add("gsx-sticky-cell");
   cell.classList.toggle("gsx-sticky-last",i===2);
   cell.style.setProperty("--gsx-fixed-left",offsets[i].toFixed(1)+"px");
  }
 }
}

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
 if(heads.length<4)return null;
 return{heads,rows:[...table.rows].filter(row=>row.cells.length===heads.length)};
}
function applyOrder(table,desired){
 const x=columns(table);if(!x)return;
 const {heads,rows}=x,keys=heads.map(h=>h.dataset.gsxColKey).filter(Boolean);
 if(!Array.isArray(desired)||desired.length!==keys.length||new Set(desired).size!==keys.length||
  desired.some(k=>!keys.includes(k))||desired.slice(0,3).some((k,i)=>k!==keys[i]))return;
 for(const row of rows){
  const cells=[...row.cells],lookup=new Map(cells.map((cell,i)=>[keys[i],cell]));
  for(const k of desired)row.append(lookup.get(k));
 }
}
function decorate(table){
 if(!table.isConnected)return;
 if(table.dataset.gsxLiveTable==="true")return;
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
  if(i<3){th.title="Cột định danh cố định khi cuộn";continue}
  th.tabIndex=0;th.title="Kéo biểu tượng ⠿ để sắp xếp cột";
  const grip=document.createElement("span");
  grip.className="gsx-col-grip";grip.textContent="⠿";grip.draggable=true;grip.title="Kéo để sắp xếp cột";grip.setAttribute("aria-label","Kéo cột");th.prepend(grip);
  const handle=document.createElement("span");
  handle.className="gsx-resize";handle.title="Kéo để thay đổi độ rộng cột";
  handle.setAttribute("aria-hidden","true");th.append(handle);
  handle.addEventListener("pointerdown",e=>{
   if(e.button!==0)return;e.preventDefault();e.stopPropagation();
   const index=rebuild().indexOf(th);const original=th.getBoundingClientRect().width,start=e.clientX;
   resizing={index,original,start};handle.setPointerCapture?.(e.pointerId);
  });
  handle.addEventListener("pointermove",e=>{
   if(!resizing)return;const width=Math.max(90,Math.min(420,resizing.original+e.clientX-resizing.start));
   for(const row of columns(table)?.rows||[]){if(row.cells[resizing.index]){row.cells[resizing.index].style.width=width+"px";row.cells[resizing.index].style.minWidth=width+"px"}}updateSticky(table);
  });
  const stop=()=>{resizing=null;updateSticky(table)};
  handle.addEventListener("pointerup",stop);handle.addEventListener("pointercancel",stop);
  grip.addEventListener("dragstart",e=>{dragging=th.dataset.gsxColKey;e.dataTransfer.effectAllowed="move";th.classList.add("gsx-dragging")});
  grip.addEventListener("dragend",()=>{dragging=null;th.classList.remove("gsx-dragging");qs(table,"th").forEach(h=>h.classList.remove("gsx-drop"))});
  th.addEventListener("dragover",e=>{if(dragging){e.preventDefault();e.dataTransfer.dropEffect="move";th.classList.add("gsx-drop")}});
  th.addEventListener("dragleave",()=>th.classList.remove("gsx-drop"));
  th.addEventListener("drop",e=>{
   e.preventDefault();th.classList.remove("gsx-drop");
   const row=rebuild(),keys=row.map(h=>h.dataset.gsxColKey);
   const from=keys.indexOf(dragging),to=keys.indexOf(th.dataset.gsxColKey);
   if(from<3||to<3||from<0||to<0||from===to)return;
   const [moved]=keys.splice(from,1);keys.splice(to,0,moved);
   applyOrder(table,keys);persist();updateSticky(table);
  });
  th.addEventListener("keydown",e=>{
   if(!e.altKey||!["ArrowLeft","ArrowRight"].includes(e.key))return;
   e.preventDefault();const row=rebuild(),keys=row.map(h=>h.dataset.gsxColKey);
   const from=keys.indexOf(th.dataset.gsxColKey),to=from+(e.key==="ArrowLeft"?-1:1);
   if(to<3||to>=keys.length)return;
   const [moved]=keys.splice(from,1);keys.splice(to,0,moved);
   applyOrder(table,keys);persist();updateSticky(table);th.focus();
  });
 }
 const viewport=table.closest(".sticky-table-container")||table.parentElement;
 if(viewport?.style){viewport.style.overflowX="auto";viewport.style.position="relative"}
 updateSticky(table);
}
let scheduled=false,observed=null;
const resize=typeof ResizeObserver==="function"?new ResizeObserver(()=>{if(observed?.isConnected)updateSticky(observed)}):null;
function scan(){
 scheduled=false;
 const table=findTable();
 if(table!==observed){
  resize?.disconnect();observed=table;
  if(table){decorate(table);if(resize)for(const th of [...table.tHead.rows[0].cells].slice(0,3))resize.observe(th)}
 }
}
function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(scan)}}
function paint(input){
 const id=input.dataset.cand,status=document.getElementById("save-status-"+id);
 if(!status)return;
 status.style.opacity="1";
 const pending=navigator.onLine===false;
 status.textContent=pending?"Lưu tạm trên thiết bị":"Đang lưu lên máy chủ…";
 status.style.color=pending?"#b45309":"#7a1837";
}
document.addEventListener("input",e=>{
 if(!window.GS_MANUAL_SCORE_MODE&&e.target.matches?.("input.score-input")){
  paint(e.target);
  if(navigator.onLine===false)window.showToast?.("Điểm chưa được gửi lên máy chủ. Không khóa/nộp khi mất mạng.","error");
 }
},true);
const root=document.getElementById("main-content");
if(root)new MutationObserver(schedule).observe(root,{subtree:true,childList:true});
window.gsPrepareLiveTable=scan;
window.addEventListener("online",schedule);
schedule();
})();
