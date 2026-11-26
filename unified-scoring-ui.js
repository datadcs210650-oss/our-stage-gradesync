/* Unified OSC scoring workspace. The legacy personal grid remains the only
   live score subscription owner. Reports use the same selected session. */
export function installUnifiedScoring(){
 const oldGrid=window.loadGradingTable,call=(action,body)=>window.oscGradingCall(action,body);
 const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||"";if(text!==undefined)e.textContent=String(text);return e};
 const button=(label,fn,primary=false)=>{const b=el("button",(primary?"bg-red-900 text-white":"bg-white border border-rose-100 text-red-900")+" rounded-lg px-3 py-2 text-xs font-bold",label);b.type="button";b.onclick=fn;return b};
 const select=()=>el("select","w-full sm:w-auto min-w-0 border border-rose-100 bg-white rounded-xl p-2.5 text-xs font-bold");
 const link=()=>{const a=el("a","text-xs font-bold text-red-900 underline","Xác thực biên bản");a.href="https://portal.ourstage.io.vn/xac-thuc-bien-ban";a.target="_blank";a.rel="noopener noreferrer";return a};
 const field=(name,input)=>{const x=el("label","grid gap-1 text-xs font-bold text-gray-600");x.append(el("span","",name),input);return x};
 const safeCsv=x=>{let s=String(x??"");if(/^[\s]*[=+@\-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};
 const msg=(s,error=false)=>window.showToast?.(s,error?"error":"success");
 let cleanup=null,remember={group:"",judge:"ALL",tab:"score"};
 function asBlob(base64){const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));return new Blob([bytes],{type:"application/pdf"})}
 function download(blob,name){const u=URL.createObjectURL(blob),a=el("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);}
 function compareDialog(prefill={}){
  const modal=document.getElementById("custom-modal-box");if(!modal)return;
  const root=el("section","space-y-3"),doc=el("input","w-full border rounded-xl p-2 text-xs"),code=el("input","w-full border rounded-xl p-2 text-xs"),file=el("input","w-full border rounded-xl p-2 text-xs"),status=el("p","text-xs text-gray-600"),outputs=el("div","space-y-3"),choices=select();
  doc.placeholder="ID ở chân mỗi trang (nếu có)";doc.value=prefill.documentId||"";code.placeholder="Mã 8 số; bản tổng hợp để trống";code.value=prefill.comparisonCode||"";code.inputMode="numeric";code.maxLength=8;file.type="file";file.accept="application/pdf,image/jpeg,image/png";
  let generation=0,urls=[];
  function clear(){urls.forEach(u=>URL.revokeObjectURL(u));urls=[];outputs.replaceChildren();}
  const dispose=()=>{generation++;clear();obs.disconnect()};const obs=new MutationObserver(()=>{if(!root.isConnected)dispose()});
  async function load(hash){
   const version=++generation;clear();status.textContent="Đang truy xuất bản PDF lưu trữ…";loadButton.disabled=true;
   try{
    const b=hash?await call("casting-original-by-hash",{sha256:hash,comparisonCode:code.value.trim()}):await call("casting-scan-original",{documentId:doc.value.trim(),comparisonCode:code.value.trim()});
    if(version!==generation||!root.isConnected)return;
    if(b.status==="choose-original"){choices.replaceChildren(...b.documents.map(d=>new Option(new Date(d.issued_at).toLocaleString("vi-VN")+" · "+(d.document_id||d.sha256.slice(0,12)),d.sha256)));outputs.append(field("Chọn đúng bản gốc đã phát hành",choices),button("Mở bản đã chọn",()=>load(choices.value)));status.textContent=b.documents.length?"Đối chiếu đúng phiên bản và bộ lọc của biên bản.":"Không tìm thấy bản lưu.";return;}
    if(!b.originalBase64){status.textContent=b.status==="superseded"?"Mã đã hết hiệu lực.":b.status==="draft"?"Bản chưa xác nhận.":"Không tìm thấy biên bản tương ứng.";return;}
    const u=URL.createObjectURL(asBlob(b.originalBase64));urls.push(u);
    const area=el("div","grid grid-cols-1 lg:grid-cols-2 gap-3");
    function pane(title,url,isImage=false){const x=el("div","min-w-0 border border-rose-100 rounded-xl p-2 space-y-2");x.append(el("h4","text-xs font-bold text-red-900",title));const v=el(isImage?"img":"iframe","w-full border-0 rounded-md");v.src=url;v.title=title;v.style.height="min(64vh, 540px)";if(isImage)v.style.objectFit="contain";else v.setAttribute("sandbox","allow-same-origin");x.append(v);return x;}
    area.append(pane("Bản gốc từ máy chủ",u));
    const scan=file.files?.[0];if(scan){if(scan.size>25000000||!["application/pdf","image/jpeg","image/png"].includes(scan.type))throw Error("Chọn PDF, JPG hoặc PNG tối đa 25 MB.");const scanURL=URL.createObjectURL(scan);urls.push(scanURL);area.append(pane("Tệp scan – chỉ trên thiết bị",scanURL,scan.type.startsWith("image/")));}
    outputs.append(area,button("Tải bản gốc để đối chiếu",()=>download(asBlob(b.originalBase64),"OSC-bien-ban-goc.pdf")));
    status.textContent=b.status==="superseded"?"BIÊN BẢN ĐÃ HẾT HIỆU LỰC — bản lưu chỉ để đối chiếu lịch sử.":"CẦN ĐỐI CHIẾU THỦ CÔNG. Kiểm tra tất cả ô điểm, họ tên, tiêu chí, tổng điểm, kết quả, chữ ký và số/thứ tự trang. Không tự động công nhận bản scan.";
   }catch(e){if(version===generation)status.textContent=e.message;}finally{if(version===generation)loadButton.disabled=false}
  }
  const loadButton=button("Tra cứu bản gốc",()=>load(),true);
  root.append(el("h3","font-black text-lg text-red-900","Đối chiếu tài liệu bản scan"),el("p","text-xs text-gray-600","Bản scan không được tải lên máy chủ. Chỉ quản trị viên được xem bản gốc; không dùng mã đối chiếu để tự kết luận tài liệu hợp lệ."),field("ID tài liệu",doc),field("Mã đối chiếu",code),field("Chọn bản scan hoặc ảnh",file),loadButton,status,outputs,button("Đóng",()=>{dispose();window.closeCustomModal?.()}));
  modal.replaceChildren(root);modal.style.maxHeight="calc(100dvh - 28px)";modal.className="bg-white p-4 sm:p-6 rounded-3xl shadow-2xl w-[96%] max-w-[1100px] overflow-auto border border-white/50 my-auto";window.openModal?.();obs.observe(modal,{childList:true});if(prefill.sha256)load(prefill.sha256);else if(prefill.comparisonCode)load();
 }
 window.oscCompareScan=compareDialog;
 window.loadUnifiedScoring=async function(host){
  if(!["Admin","SuperAdmin"].includes(window.currentUserData?.role))return oldGrid(host);
  cleanup?.();let active=true,revision=0,reportSeq=0,timer=null,monitorGroup="",aggregate=null,report=null,scopeList=[],currentTab=remember.tab;let unwatch=()=>{};
  const root=el("section","space-y-3 min-w-0 h-full");root.dataset.oscUnified="1";
  const head=el("div","bg-white border border-rose-100 rounded-2xl p-4 space-y-3");
  const header=el("div","flex flex-wrap items-center justify-between gap-2");header.append(el("h3","text-lg font-black text-red-950","QUẢN LÝ CHẤM ĐIỂM"),link(),button("Đối chiếu bản scan",()=>compareDialog()));
  const group=select(),judge=select(),refresh=button("Làm mới dữ liệu điểm",()=>manualRefresh()),bar=el("div","grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2");bar.append(field("Phiên chấm",group),field("Giám khảo",judge),refresh);
  const summary=el("div","grid grid-cols-2 lg:grid-cols-4 gap-2"),state=el("p","text-sm font-bold text-red-900","Đang tải phiên chấm...");
  const tabs=el("div","flex flex-wrap gap-2 border-b border-rose-100 pb-2"),tabButtons={};
  for(const [id,title] of [["score","Bảng điểm"],["monitor","Giám sát BGK"],["report","Báo cáo & Xuất"]]){tabButtons[id]=button(title,()=>switchTab(id));tabs.append(tabButtons[id]);}
  head.append(header,bar,summary,state,tabs);
  const grid=el("div","flex flex-col min-h-0 min-w-0"),monitor=el("div","min-w-0"),reportPanel=el("div","min-w-0 space-y-3");root.append(head,grid,monitor,reportPanel);host.replaceChildren(root);
  let lastReportAt=0;const onFocus=()=>{if(active&&root.isConnected&&(!aggregate||Date.now()-lastReportAt>30000))refreshAll(!!aggregate)};
  function dispose(){active=false;revision++;reportSeq++;clearTimeout(timer);unwatch();window.removeEventListener("osc-score-group-change",event);window.removeEventListener("focus",onFocus);if(window.oscUnifiedRefresh===onFocus)window.oscUnifiedRefresh=null;}
  cleanup=dispose;window.activeListeners.push(dispose);window.oscUnifiedRefresh=onFocus;window.addEventListener("focus",onFocus);
  function getGroup(){return window._groupMapCache?.[group.value]||{}}
  window.oscAttendanceLock=()=>!aggregate||aggregate.attendanceState?.enabled!==true||aggregate.attendanceState?.locked===true;
  function confirmAbsence(){
   return new Promise(resolve=>{
    const dialog=el("dialog","rounded-xl p-5 max-w-sm"),description=el("p","mb-4","Thí sinh đã có điểm. Chuyển sang vắng mặt sẽ loại thí sinh khỏi đối soát. Điểm đã nhập vẫn được lưu.");
    dialog.setAttribute("aria-label","Xác nhận chuyển vắng mặt");
    dialog.append(description,button("Giữ có mặt",()=>dialog.close()),button("Chuyển vắng mặt",()=>dialog.close("absent"),true));
    dialog.addEventListener("close",()=>{dialog.remove();resolve(dialog.returnValue==="absent")},{once:true});
    root.append(dialog);dialog.showModal();
   });
  }
  async function markAttendance(id,present){
   const gid=group.value,c=(window._allCandidatesCache||[]).find(x=>x.id===id&&x.groupId===gid);if(!c||window.oscAttendanceLock())throw Error("Điểm danh đang khóa hoặc chưa sẵn sàng.");

   if(!present&&(window._allScoresCache||[]).some(x=>x.candidateId===id&&Object.keys(x.scores||{}).length)&&!(await confirmAbsence()))return false;
   if(!active||group.value!==gid)return false;
   await call("mark-attendance",{groupId:gid,candidateId:id,present});
   if(!active||group.value!==gid)return true;
   c.isPresent=present;
   await refreshAll(true);
   msg(present?"Đã điểm danh có mặt.":"Đã chuyển vắng mặt.");return true;
  }
  window.toggleCandAttendance=async(id,present)=>{try{await markAttendance(id,present)}catch(e){msg(e.message,true);refreshAll(true)}finally{window.renderGradingTables?.()}};
  function setJudgeOptions(wanted=judge.value||remember.judge){
   const opts=(window._allGradersCache||[]).filter(g=>(g.assignedGroups||[]).includes(group.value));
   judge.replaceChildren(new Option("Hội đồng Giám khảo","ALL"),...opts.map(g=>new Option((g.name||g.code)+" · "+g.code,g.code)));
   judge.value=[...judge.options].some(o=>o.value===wanted)?wanted:"ALL";remember.judge=judge.value;
  }
  function progress(){
   const id=group.value,roster=(window._allCandidatesCache||[]).filter(c=>c.groupId===id),total=roster.length,eligible=new Set(roster.filter(c=>getGroup().attendanceEnabled!==true||c.isPresent===true).map(c=>c.id)),records=(window._allScoresCache||[]).filter(s=>s.groupId===id&&eligible.has(s.candidateId)),opts=[...judge.options].filter(x=>x.value!=="ALL");
   const verified=Object.values(window._allVerificationsCache||{}).filter(v=>v.groupId===id&&v.isVerified===true&&opts.some(o=>o.value===v.graderCode)).length;
   const receiptCount=scopeList.length?scopeList.filter(r=>r.confirmed&&r.comparisonCode&&opts.some(o=>o.value===r.graderCode)).length:verified;
   const rs=aggregate?.reviewSummary,approved=rs?rs.approved+"/"+rs.total:"—";
   const assigned=rs?.assigned??opts.length,submitted=rs?.submitted??receiptCount;
   const items=[["Thí sinh",rs?.registered??total],...(rs?.attendanceEnabled?[["Có mặt",rs.present],["Vắng mặt",rs.absent]]:[]),["BGK phân công",assigned],["BGK xác nhận",submitted+"/"+assigned+" · "+(assigned?Math.round(submitted/assigned*100):0)+"%"],["Kết quả đã duyệt",approved+(rs?.total?" · "+Math.round(rs.approved/rs.total*100)+"%":"")]];
   summary.replaceChildren(...items.map(([k,v])=>{const x=el("div","border border-rose-100 rounded-xl p-3");x.append(el("p","text-xs text-gray-500",k),el("p","text-xl font-black text-red-900",v));return x;}));
   for(const item of monitor.querySelectorAll("[data-receipt-progress]")){
    const c=item.dataset.receiptProgress,done=new Set(records.filter(s=>s.graderCode===c&&Object.values(s.scores||{}).some(x=>x!==null&&x!==""&&x!==undefined)).map(s=>s.candidateId)).size;
    const need=eligible.size,pct=need?Math.round(done/need*100):0;item.replaceChildren(el("p","",done+"/"+need+" thí sinh thuộc diện chấm · "+pct+"%"));
    const track=el("div","h-1.5 rounded-full bg-rose-100 overflow-hidden"),fill=el("div","h-full rounded-full bg-red-900");fill.style.width=Math.min(100,pct)+"%";track.append(fill);item.append(track);
   }window.refreshPresenceBadges?.();
  }
  function syncLegacy(){
   const g=grid.querySelector("#grading-group-select");if(g&&g.value!==group.value){g.value=group.value;window.changeGradingGroup?.();}
   const j=grid.querySelector("#grading-grader-select");
   if(j&&judge.value!=="ALL"&&[...j.options].some(o=>o.value===judge.value)){j.value=judge.value;window.renderGradingTables?.();}
  }
  function visible(){
   const personal=currentTab==="score"&&judge.value!=="ALL";
   grid.style.display=personal?"flex":"none";monitor.style.display=currentTab==="monitor"?"block":"none";reportPanel.style.display=currentTab==="report"||(currentTab==="score"&&!personal)?"block":"none";
   for(const [id,b] of Object.entries(tabButtons)){b.className=(id===currentTab?"bg-red-900 text-white":"bg-white border border-rose-100 text-red-900")+" rounded-lg px-3 py-2 text-xs font-bold";b.setAttribute("aria-pressed",String(id===currentTab));}
  }
  function renderReport(data){
   if(!data||!active)return;
   const tools=el("div","flex flex-wrap gap-2 items-center"),search=el("input","border rounded-lg p-2 text-xs flex-1"),status=el("p","text-xs text-gray-500",data.note),wrap=el("div","overflow-auto border border-rose-100 rounded-xl max-h-[65vh] bg-white");
   search.placeholder="Tìm tên hoặc số báo danh...";
   if(currentTab==="report"){tools.append(button("Xuất Excel",()=>exportDialog("xlsx")),button("Xuất CSV",()=>exportDialog("csv")),button("Xuất PDF",()=>window.openPDFConfigModalLive(group.value,judge.value),true));}
   else tools.append(button("Xuất báo cáo",()=>switchTab("report")));
   tools.append(search);if(aggregate?.attendanceState?.enabled){const label=el("span","text-xs font-bold "+(aggregate.attendanceState.locked?"text-red-800":"text-emerald-700"),aggregate.attendanceState.locked?"🔒 Điểm danh đã khóa (≥50% BGK)":"Điểm danh đang mở");tools.append(label);}
   const table=el("table","w-full text-xs min-w-max border-collapse"),thead=el("thead","sticky top-0 z-10 bg-rose-50"),tr=el("tr"),tbody=el("tbody","divide-y divide-rose-50");
   for(const col of data.columns)tr.append(el("th","p-3 text-left font-bold whitespace-pre-line border-b border-rose-100",col));const showLive=currentTab==="report"||currentTab==="score"&&judge.value==="ALL";if(showLive)tr.append(el("th","p-3 text-left","Điểm từng BGK đã lưu (chưa nộp vẫn hiển thị)"));thead.append(tr);table.append(thead,tbody);wrap.append(table);
   function body(){tbody.replaceChildren();const q=search.value.trim().toLowerCase(),cached=window._allCandidatesCache||[],scores=window._allScoresCache||[],map=new Map(cached.map(c=>[String(c.code),c.id])),byCand=new Map();for(const s of scores){if(s.groupId!==group.value||(judge.value!=="ALL"&&s.graderCode!==judge.value))continue;const arr=byCand.get(s.candidateId)||[];arr.push(s);byCand.set(s.candidateId,arr);}
    for(const row of data.rows){if(q&&!row.slice(1,3).join(" ").toLowerCase().includes(q))continue;const tr=el("tr","hover:bg-rose-50");row.forEach((v,i)=>{const td=el("td","p-3 align-top whitespace-pre-line "+(i===row.length-1?(v==="ĐẠT"?"text-emerald-700 font-bold":v==="KHÔNG ĐẠT"?"text-red-700 font-bold":"text-gray-500"):""),v);if(data.columns[i]==="Điểm danh"&&currentTab==="score"&&judge.value==="ALL"){const input=select();input.append(new Option("Có mặt","yes"),new Option("Vắng mặt","no"));input.value=v==="Có mặt"?"yes":"no";input.disabled=window.oscAttendanceLock()||!map.has(String(row[1]));input.onchange=async()=>{const requested=input.value;input.disabled=true;let saved=false;try{saved=await markAttendance(map.get(String(row[1])),requested==="yes")}catch(e){msg(e.message,true)}finally{input.value=saved?requested:(v==="Có mặt"?"yes":"no");input.disabled=window.oscAttendanceLock()}};td.replaceChildren(input);}tr.append(td);});
     if(showLive){const details=el("td","p-3 min-w-[260px]");const entries=new Map((byCand.get(map.get(String(row[1])))||[]).map(s=>[s.graderCode,s]));const judges=[...judge.options].filter(o=>o.value!=="ALL"&&(judge.value==="ALL"||o.value===judge.value));for(const j of judges){const s=entries.get(j.value),confirmed=window._allVerificationsCache?.[j.value+"_"+group.value]?.isVerified===true;const v=el("div","border rounded-md p-2 mb-1");v.append(el("p","font-bold text-red-900",s?.graderName||j.textContent),el("p","text-gray-600",s?Object.entries(s.scores||{}).map(([k,n])=>k+": "+(n??"—")).join(" · "):"Chưa lưu điểm"),el("p","text-xs "+(confirmed?"text-emerald-700":"text-gray-500"),s?"Tổng: "+(s.totalScore??"—")+" · "+(confirmed?"Đã nộp":"Đã lưu máy chủ / chưa nộp"):confirmed?"Đã nộp · không có điểm":"Chưa có dữ liệu"));details.append(v)}tr.append(details);}
     tbody.append(tr);
    }
   }search.oninput=body;body();reportPanel.replaceChildren(tools,status,wrap);
  }
  async function fetchReport(force=false){
   const gid=group.value,j=judge.value;if(!gid||!active)return;const gen=++reportSeq;const end=window.OSCProgress?.foreground()?window.OSCProgress?.begin("Đang tải bảng điểm…"):null;
   if(force||!aggregate){state.textContent="Đang đối soát dữ liệu...";}
   try{
    if(force||!aggregate){const a=await call("casting-report-data",{groupId:gid,graderCode:"ALL",expHidden:false});if(gen!==reportSeq||!active||gid!==group.value)return;aggregate=a;lastReportAt=Date.now();}
    const complete=aggregate.confirmed;
    const stage=aggregate.reviewSummary?.stage;
    state.textContent=({published:"✓ ĐÃ CÔNG BỐ KẾT QUẢ · Đã đối soát",approved:"✓ ĐÃ ĐỐI SOÁT KẾT QUẢ · Sử dụng quyết định chính thức",partial:"ĐANG ĐỐI SOÁT · Chưa hoàn tất","pending-review":"CHỜ DUYỆT KẾT QUẢ",insufficient:"CHƯA ĐỦ ĐIỀU KIỆN ĐỐI SOÁT · Kiểm tra từng thí sinh",grading:"ĐANG CHẤM ĐIỂM"})[stage]||"CHƯA XÁC ĐỊNH";
    if(aggregate.attendanceState?.enabled)state.textContent+=" · "+(aggregate.attendanceState.locked?"Điểm danh đã khóa":"Điểm danh đang mở");state.className="text-sm font-bold "+(complete?"text-emerald-700":"text-amber-700");progress();if(currentTab==="score"&&judge.value!=="ALL")window.renderGradingTables?.();
    if(currentTab==="report"||currentTab==="score"&&j==="ALL"){
     const d=j==="ALL"?aggregate:(!force&&report?.key===gid+"|"+j?report.data:await call("casting-report-data",{groupId:gid,graderCode:j,expHidden:false}));
     if(gen!==reportSeq||!active||group.value!==gid||judge.value!==j)return;report={key:gid+"|"+j,data:d};renderReport(d);
    }
   }catch(e){if(gen===reportSeq&&active){aggregate=null;state.textContent="Chưa xác định trạng thái đối soát: "+e.message;state.className="text-xs text-red-700";if(currentTab!=="monitor"&&reportPanel.style.display!=="none")reportPanel.replaceChildren(el("p","text-sm text-red-700",e.message));}}finally{end?.()}
  }
  async function mountMonitor(force=false){
   const gid=group.value;if(!gid)return;if(!force&&monitorGroup===gid)return;monitorGroup=gid;monitor.replaceChildren();
   await window.loadAdminLiveMonitor(monitor,{groupId:gid,groupName:getGroup().name||gid,viewJudge:code=>{judge.value=code;remember.judge=code;switchTab("score");},viewOriginal:r=>compareDialog({comparisonCode:r.comparisonCode,sha256:r.originalSha}),onRender:list=>{if(group.value===gid){scopeList=list;progress();for(const card of monitor.querySelectorAll("[data-grader-code]"))card.hidden=judge.value!=="ALL"&&card.dataset.graderCode!==judge.value;}},onChanged:()=>refreshAll(true)});
  }
  async function manualRefresh(){
   const gid=group.value;if(!active||!gid||refresh.disabled)return;refresh.disabled=true;const end=window.OSCProgress?.begin("Đang làm mới dữ liệu điểm…");
   try{const queryFor=t=>window.query(window.collection(window.db,t),window.where("groupId","==",gid));
    const [c,s,v]=await Promise.all(["candidates","scores","grader_verifications"].map(t=>window.getDocs(queryFor(t))));
    if(!active||gid!==group.value||!root.isConnected)return;
    const collect=x=>x.docs.map(d=>({id:d.id,...d.data()}));
    window._allCandidatesCache=collect(c);window._allScoresCache=collect(s);window._allVerificationsCache=Object.fromEntries(collect(v).map(x=>[x.graderCode+"_"+x.groupId,x]));
    window.renderGradingTables?.();progress();await refreshAll(true);
    if(active&&gid===group.value&&aggregate)window.showToast?.("Đã làm mới dữ liệu điểm của phiên.");
   }catch(e){msg(e.message||"Không làm mới được dữ liệu điểm.",true)}finally{refresh.disabled=false;end?.()}
  }
  async function refreshAll(force=false){if(!active||!root.isConnected)return;if(currentTab==="monitor")await mountMonitor(force);await fetchReport(force);}
  function switchTab(id){if(id===currentTab)return;window.OSCProgress?.pulse("Đang chuyển bảng điểm…");currentTab=id;remember.tab=id;visible();syncLegacy();if(id==="monitor")mountMonitor(false);fetchReport(false);}
  function event(e){
   if(!active||!root.isConnected||e.detail?.groupId!==group.value)return;progress();if(e.detail.kind==="directory"){setJudgeOptions(judge.value);syncLegacy();}if(e.detail.kind==="verification"&&currentTab==="monitor"){monitorGroup="";mountMonitor(true);}
   if(e.detail.kind==="score"){if(report?.data&&(currentTab==="score"&&judge.value==="ALL"||currentTab==="report"&&judge.value==="ALL"))renderReport(report.data);else if(currentTab==="report"&&judge.value!=="ALL"&&!timer)timer=setTimeout(()=>{timer=null;fetchReport(true)},2500);return;}
   if(currentTab==="report"||currentTab==="score"&&judge.value==="ALL"||["verification","candidate","directory"].includes(e.detail.kind)){if(!timer)timer=setTimeout(()=>{timer=null;fetchReport(true)},2000);}
  }
  window.addEventListener("osc-score-group-change",event);
  unwatch=window.oscWatchReviewChanges?.(()=>{if(!active||!root.isConnected||!group.value)return;if(!timer)timer=setTimeout(()=>{timer=null;refreshAll(true)},1800);})||(()=>{});
  async function exportDialog(format){
   const modal=document.getElementById("custom-modal-box");const r=el("div","space-y-3"),result=select(),attendance=select(),title=el("input","border rounded-lg p-2 w-full text-sm"),hidden=el("input"),filename=el("input","border rounded-lg p-2 w-full text-sm");result.append(new Option("Tất cả","ALL"),new Option("Đạt","PASS"),new Option("Không đạt","FAIL"));attendance.append(new Option("Tất cả","ALL"),new Option("Có mặt","PRESENT"),new Option("Vắng mặt","ABSENT"));hidden.type="checkbox";title.value="BIÊN BẢN CHẤM THI KẾT QUẢ";filename.placeholder="Tên file tự động (có thể chỉnh sửa)";
   const gid=group.value,j=judge.value,help=el("p","text-xs text-gray-500","Xuất từ dữ liệu máy chủ. Sau duyệt sử dụng quyết định chính thức.");
   const go=button("Tải "+format.toUpperCase(),async()=>{go.disabled=true;try{const d=await call("casting-report-data",{groupId:gid,graderCode:j,resultFilter:result.value,attendanceFilter:attendance.value,docTitle:title.value,expHidden:hidden.checked});const rows=[[d.title],["Phiên chấm: "+d.session],["Giám khảo: "+d.judge],[d.note],[d.summary],[],d.columns,...d.rows];let name=(filename.value.trim()||d.filename.replace(/\.pdf$/i,"")).replace(/[\\/:*?"<>|]/g,"_").replace(/\.(xlsx|csv)$/i,"")||"NTCD";if(format==="csv"){download(new Blob(["\uFEFF"+rows.map(row=>row.map(safeCsv).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),name+".csv");}else{await window.oscEnsureAsset("XLSX");const ws=window.XLSX.utils.aoa_to_sheet(rows.map(row=>row.map(v=>typeof v==="string"&&/^[\s]*[=+@\-]/.test(v)?"'"+v:v)));ws["!cols"]=d.columns.map((c,i)=>({wch:i===2?32:Math.min(28,Math.max(12,c.length))}));const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,ws,"BienBan");window.XLSX.writeFile(wb,name+".xlsx");}window.closeCustomModal?.();}catch(e){help.textContent=e.message;}finally{go.disabled=false}},true);
   const extra=el("label","flex gap-2 text-xs");extra.append(hidden,el("span","","Xuất kèm trường ẩn"));r.append(el("h3","font-bold text-lg text-red-900","Xuất "+format.toUpperCase()),el("p","text-xs",(getGroup().name||gid)+" · "+judge.selectedOptions[0]?.textContent),field("Lọc kết quả",result),field("Lọc điểm danh",attendance),field("Tiêu đề",title),field("Tên file",filename),extra,help,go,button("Hủy",()=>window.closeCustomModal?.()));modal.replaceChildren(r);window.openModal?.();
  }
  group.onchange=()=>{remember.group=group.value;aggregate=report=null;scopeList=[];monitorGroup="";setJudgeOptions("ALL");syncLegacy();progress();visible();refreshAll(true)};
  judge.onchange=()=>{remember.judge=judge.value;report=null;visible();syncLegacy();if(currentTab==="monitor"){const code=judge.value;for(const card of monitor.querySelectorAll("[data-grader-code]"))card.hidden=code!=="ALL"&&card.dataset.graderCode!==code;}fetchReport(false)};
  try{
   await oldGrid(grid);if(!active||!root.isConnected)return;
   const gs=grid.querySelector("#grading-group-select"),options=[...(gs?.options||[])].filter(o=>o.value);group.replaceChildren(...options.map(o=>new Option(o.textContent,o.value)));
   if(!group.options.length){state.textContent="Chưa có phiên chấm.";return;}
   group.value=options.some(o=>o.value===remember.group)?remember.group:(gs?.value||options[0].value);
   // Retain the old grid's internal selectors for existing edit/resize/attendance handlers.
   if(gs)gs.closest("div.flex.items-center")?.classList.add("hidden");
   const js=grid.querySelector("#grading-grader-select");if(js)js.closest("div.flex.items-center")?.classList.add("hidden");
   setJudgeOptions();syncLegacy();visible();progress();await refreshAll(true);
  }catch(e){state.textContent=e.message;}
 };
}
