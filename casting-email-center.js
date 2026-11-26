/* GrandSync Email Center: manager-selected casting results, no lookup links. */
(()=>{
"use strict";
const api=(action,details={})=>window.oscGradingCall(action,details);
const node=(tag,cls="",text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=String(text);return el};
const field=(type="text",value="")=>{const x=node(type==="textarea"?"textarea":type==="select"?"select":"input","w-full border border-slate-200 rounded-xl p-3 bg-white text-xs");if(type!=="select"&&type!=="textarea")x.type=type;if(value)x.value=value;return x};
const label=(text,child)=>{const x=node("label","grid gap-1 text-xs font-semibold text-slate-600");x.append(node("span","",text),child);return x};
const btn=(text,fn,outline=false)=>{
 const b=node("button",(outline?"border border-rose-200 bg-white text-red-900":"bg-red-900 text-white")+" hover:opacity-90 px-4 py-2.5 rounded-xl text-xs font-bold",text);
 b.type="button";b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await fn()}catch(e){window.showToast?.(e.message||"Tác vụ không thành công.","error")}finally{b.disabled=false;b.dispatchEvent(new Event("osc-action-finished"))}};return b;
};
const card=(title)=>{
 const outer=node("section","bg-white rounded-2xl border border-rose-100 shadow-sm p-5 space-y-4");
 outer.append(node("h3","text-sm font-black text-red-900",title));return outer;
};
const badge=row=>node("span","rounded-full px-2.5 py-1 text-[10px] font-black "+
 (row.outcome==="passed"?"bg-emerald-50 text-emerald-700":row.outcome==="failed"?"bg-rose-50 text-rose-700":"bg-amber-50 text-amber-700"),
 row.outcome==="passed"?"PASSED":row.outcome==="failed"?"NOT PASSED":"CHỜ");
const original=window.loadCastingEmail;
window.loadCastingEmail=async function(host){
 const shell=node("div","space-y-4 pb-8");
 const heading=node("div","space-y-1");
 heading.append(node("p","text-[10px] tracking-widest text-red-900 font-black","GRANDSYNC / EMAIL"),
  node("h2","text-xl font-black text-slate-900","Thông báo kết quả casting"),
  node("p","text-xs text-slate-500","Chọn riêng từng thí sinh hoặc toàn bộ. Gửi ngay hoặc hẹn giờ, không dùng link tra cứu."));
 shell.append(heading);
 const cfg=card("01 · Chọn phiên chấm");
 const casting=field("select"),group=field("select");
 const selectGrid=node("div","grid grid-cols-1 md:grid-cols-2 gap-3");
 selectGrid.append(label("Đợt tuyển",casting),label("Nhóm / Phiên chấm",group));cfg.append(selectGrid);
 const load=btn("Làm mới danh sách phiên và kết quả",async()=>refreshOptions());
 cfg.append(load);shell.append(cfg);
 const recipients=card("02 · Người nhận");
 const checkAll=field("checkbox");checkAll.className="w-4 h-4 accent-red-900";
 const selectAll=node("label","flex items-center gap-2 text-xs font-bold text-red-900");
 selectAll.append(checkAll,node("span","","Gửi toàn bộ thí sinh đủ điều kiện của phiên"));
 const summary=node("span","text-xs text-slate-500","Chưa tải danh sách");
 const controls=node("div","flex flex-wrap items-center gap-3");
 const sharedNotice=node("p","text-xs font-semibold text-amber-600");controls.append(selectAll,summary);recipients.append(controls,sharedNotice);
 const scroll=node("div","overflow-auto max-h-[430px] border border-slate-200 rounded-xl");
 const table=node("table","w-full min-w-[800px] text-left text-xs");
 table.innerHTML='<thead class="bg-rose-50 text-red-950 sticky top-0"><tr><th class="p-3">Chọn</th><th class="p-3">SBD</th><th class="p-3">Họ tên</th><th class="p-3">Email</th><th class="p-3">Phiên chấm</th><th class="p-3">Kết quả</th><th class="p-3">Điều kiện</th></tr></thead><tbody></tbody>';
 const tbody=table.querySelector("tbody");scroll.append(table);recipients.append(scroll);shell.append(recipients);
 const compose=card("03 · Nội dung và lịch công bố qua Email");
 const subject=field("text","[NTCD] THÔNG BÁO KẾT QUẢ");subject.readOnly=true;
 const intro=field("textarea");intro.rows=3;intro.maxLength=1200;intro.value="Cảm ơn bạn đã tham gia chương trình tuyển chọn diễn viên của Our Stage Club.";
 const thanks=field("textarea");thanks.rows=3;thanks.maxLength=1200;thanks.value="Cảm ơn bạn đã dành thời gian và tâm huyết tham gia. Chúc bạn luôn giữ niềm đam mê sân khấu!";
 const date=field("datetime-local"),mode=field("select");mode.append(new Option("Công bố lần đầu","dispatch"),new Option("Gửi lại kết quả đã công bố","resend"),new Option("Đang chờ công bố / chưa đủ điều kiện","none"));mode.disabled=true;
 const top=node("div","grid grid-cols-1 md:grid-cols-2 gap-3");
 const dateLabel=label("Hẹn giờ công bố (để trống nếu gửi ngay)",date);top.append(label("Thao tác",mode),label("Tiêu đề Email",subject),dateLabel);
 compose.append(top,label("Lời chào / mở đầu",intro),label("Lời cảm ơn",thanks),
  node("p","text-xs text-slate-500","Resend tự gửi đúng thời gian đã đặt dù Admin tắt web. Phiên bị khóa chỉnh sửa khi xác nhận gửi hoặc đặt lịch; chỉ mở lại nếu hủy toàn bộ lịch thành công trước giờ công bố. Thời gian tối đa 29 ngày tới. Mỗi email có họ tên, SBD, kết quả và vai chính thức nếu có. Không đính kèm liên kết tra cứu."));
 const sample=card("Xem trước nội dung");
 const sampleBody=node("div","text-xs leading-relaxed space-y-1 text-slate-600","Hãy tải danh sách và chọn thí sinh.");
 sample.append(sampleBody);compose.append(sample);
 const send=btn("Gửi ngay / Xác nhận đặt lịch",async()=>dispatch());send.addEventListener("osc-action-finished",()=>count());send.disabled=true;
 const preview=btn("Xem trước",async()=>showSample(),true);
 const buttons=node("div","flex flex-wrap gap-2");
 buttons.append(preview,send);compose.append(buttons);shell.append(compose);
 const log=card("04 · Lịch gửi và lịch sử");
 const logBody=node("div","space-y-2 text-xs text-slate-600");
 log.append(btn("Làm mới lịch sử",async()=>loadHistory(),true),logBody);shell.append(log);
 const legacy=node("details","p-4 bg-white border border-slate-200 rounded-2xl");
 legacy.append(node("summary","cursor-pointer text-xs font-bold text-slate-700","Email BGK: thư mời, nhắc chấm, xác nhận và nhật ký cũ"));
 const legacyWrap=node("div","mt-3");legacy.append(legacyWrap);
 let legacyLoaded=false;
 legacy.addEventListener("toggle",async()=>{
  if(!legacy.open||legacyLoaded)return;
  legacyLoaded=true;legacyWrap.textContent="Đang tải các công cụ Email BGK...";
  try{await original?.(legacyWrap)}catch(e){legacyWrap.textContent=e.message||"Lỗi tải Email BGK."}
 });shell.append(legacy);
 const status=node("p","text-xs font-semibold text-slate-600");status.setAttribute("role","status");shell.append(status);
 host.replaceChildren(shell);
 let allGroups=[],rows=[],chosen=new Set(),requestVersion=0,revision="",sending=false,ready=false,retryKey="",retryId="";
 const notify=(msg,err=false)=>{status.textContent=msg;status.className="text-xs font-semibold "+(err?"text-rose-700":"text-emerald-700")};
 const matchesMode=row=>!row.archived&&row.eligible&&(mode.value==="resend"?row.publicationState==="published":mode.value==="dispatch"&&row.publicationState==="unpublished");
 const eligible=()=>rows.filter(matchesMode);
 const selected=()=>eligible().filter(row=>chosen.has(row.id));
 function updateMode(){date.disabled=mode.value!=="dispatch";dateLabel.hidden=date.disabled;dateLabel.style.display=date.disabled?"none":"";if(date.disabled)date.value="";send.textContent=mode.value==="resend"?"Gửi lại email kết quả":mode.value==="dispatch"?"Công bố & gửi email":"Chưa thể gửi email";chosen.clear();checkAll.checked=false;draw()}
 mode.onchange=updateMode;
 const sharedAddressCount=list=>{const counts=new Map();for(const r of list){const e=String(r.email||"").trim().toLowerCase();if(e)counts.set(e,(counts.get(e)||0)+1);}return [...counts.values()].filter(n=>n>1).length;};
 const count=()=>{const chosenRows=checkAll.checked?eligible():selected(),n=chosenRows.length;summary.textContent="Đã chọn "+n+" / "+eligible().length+" thí sinh đủ điều kiện.";const shared=sharedAddressCount(rows);sharedNotice.textContent=shared?"⚠ "+shared+" địa chỉ email dùng chung. Hệ thống vẫn gửi riêng kết quả của từng thí sinh được chọn. Kiểm tra người nhận trước khi xác nhận.":"";checkAll.disabled=!ready||!eligible().length||sending;send.disabled=!ready||!n||sending;};
 function resultBox(row){
  const passed=row.outcome==="passed";
  const box=node("div","my-3 rounded-xl border p-4 text-center "+(passed?"bg-emerald-50 text-emerald-700 border-emerald-200":"bg-rose-50 text-rose-700 border-rose-200"));
  box.append(node("div","text-2xl font-black",passed?"PASSED":"NOT PASSED"));
  if(passed&&Array.isArray(row.assignedRoles))for(const role of row.assignedRoles)box.append(node("div","text-sm font-bold mt-1",role));
  return box;
 }
 function showSample(){
  sampleBody.replaceChildren();
  const row=(checkAll.checked?eligible():selected())[0]||eligible()[0];
  if(!row){sampleBody.textContent="Chưa có người nhận phù hợp.";return}
  sampleBody.append(
   node("p","font-black text-slate-900","Chào "+row.name+","),
   node("p","my-2",intro.value),
   node("p","","Họ và tên: "+row.name),
   node("p","","Số báo danh: "+row.code),
   resultBox(row),node("p","mt-2",thanks.value),
   node("p","text-slate-400","Ban Chủ nhiệm Our Stage Club")
  );
 }
 function draw(){
  tbody.replaceChildren();
  for(const row of rows.slice(0,650)){
   const tr=node("tr","border-b border-slate-100 hover:bg-rose-50/50");
   const select=node("td","p-3"),checkbox=field("checkbox");checkbox.className="w-4 h-4 accent-red-900";
   checkbox.disabled=!matchesMode(row)||checkAll.checked;
   checkbox.checked=matchesMode(row)&&(checkAll.checked||chosen.has(row.id));
   checkbox.onchange=()=>{if(checkbox.checked)chosen.add(row.id);else chosen.delete(row.id);count();showSample()};
   select.append(checkbox);tr.append(select);
   for(const value of [row.code,row.name,row.email,row.groupName])tr.append(node("td","p-3",value||"—"));
   const result=node("td","p-3");result.append(badge(row));tr.append(result);
   tr.append(node("td","p-3 text-slate-500",row.eligible?(row.publicationState==="published"?"Đã công bố · Có thể gửi lại":row.publicationState==="scheduled"?"Đã đặt lịch · Chờ đến giờ":"Đã duyệt · Chưa công bố"):!row.emailConsent?"Chưa đồng ý email":
    row.review!=="approved"?"Chưa duyệt":row.incomplete?"Chưa đủ điểm":"Thiếu email/kết quả"));
   tbody.append(tr);
  }
  if(!rows.length){const tr=node("tr"),td=node("td","p-8 text-center text-slate-400","Chưa có thí sinh hoặc chưa tải danh sách.");td.colSpan=7;tr.append(td);tbody.append(tr)}
  count();showSample();
 }
 function sessions(){
  const old=group.value;group.replaceChildren();
  for(const g of allGroups.filter(g=>g.castingId===casting.value&&!g.archived))group.append(new Option(g.name+(g.publicationState==="published"?" · Đã công bố":g.publicationState==="scheduled"?" · Chờ công bố":" · Chưa công bố"),g.id));
  if([...group.options].some(o=>o.value===old))group.value=old;group.disabled=!group.options.length;updateSubject();
 }
 function clear(){requestVersion++;ready=false;rows=[];chosen.clear();checkAll.checked=false;mode.value="none";updateMode();summary.textContent="Đang tải hoặc chưa chọn phiên chấm.";sampleBody.textContent="Chưa có dữ liệu người nhận.";send.disabled=true;}
 casting.onchange=()=>{revision="";sessions();clear();logBody.replaceChildren();loadRows().catch(e=>notify(e.message,true))};
 function updateSubject(){const g=allGroups.find(x=>x.id===group.value);subject.value="[NTCD] THÔNG BÁO KẾT QUẢ_"+(g?.name||"TÊN PHIÊN CỦA TỪNG THÍ SINH");}
 group.onchange=()=>{updateSubject();clear();logBody.replaceChildren();loadRows().catch(e=>notify(e.message,true))};checkAll.onchange=()=>{chosen.clear();draw()};
 async function loadRows(){
  if(!casting.value||!group.value){clear();notify("Không có phiên chấm đang tồn tại.");return;}
  const token=++requestVersion;ready=false;send.disabled=true;notify("Đang tải kết quả đã duyệt…");
  const result=await api("casting-result-email",{task:"preview",castingId:casting.value,
   groupId:group.value||undefined});
  if(token!==requestVersion)return;
  rows=(result.rows||[]).filter(r=>r.groupId===group.value&&!r.archived);const canResend=rows.some(r=>r.eligible&&r.publicationState==="published"),canDispatch=rows.some(r=>r.eligible&&r.publicationState==="unpublished");
  const g=allGroups.find(x=>x.id===group.value);if(g&&result.publicationState)g.publicationState=result.publicationState;
  if(g){const o=group.options[group.selectedIndex];if(o)o.textContent=g.name+(canResend||result.publicationState==="published"?" · Đã công bố":result.publicationState==="scheduled"?" · Chờ công bố":" · Chưa công bố");}
  mode.value=canResend?"resend":canDispatch?"dispatch":"none";ready=true;updateMode();
  notify("Đã tải "+rows.length+" hồ sơ · "+eligible().length+" thí sinh đủ điều kiện gửi email.");
 }
 function resendingHint(){return eligible().length?"Chưa chọn người nhận đủ điều kiện.":mode.value==="resend"?"Không có kết quả đã công bố trong phiên đang chọn. Hãy chọn phiên đã công bố hoặc chuyển sang Công bố lần đầu.":"Không có kết quả đủ điều kiện công bố lần đầu trong phiên đang chọn."}
 async function dispatch(){
  if(!rows.length)throw Error("Bấm tải danh sách trước khi gửi.");
  if(sending||!ready)throw Error("Danh sách chưa sẵn sàng.");
  const all=checkAll.checked,recipients=all?eligible():selected();
  if(!recipients.length)throw Error(resendingHint());
  if(recipients.length>500)throw Error("Mỗi lượt tối đa 500 email; hãy lọc theo phiên chấm.");
  const resending=mode.value==="resend";const activeCasting=casting.value,activeGroup=group.value,token=requestVersion;
  let at=null;
  if(!resending&&date.value){
   const time=new Date(date.value);
   if(!Number.isFinite(time.getTime()))throw Error("Lịch gửi không hợp lệ.");
   at=time.toISOString();
  }
  if(!window.confirm((resending?"GỬI LẠI ":at?"ĐẶT LỊCH ":"GỬI NGAY ")+recipients.length+
   " email PASSED/NOT PASSED?\n"+(at?"Thời gian: "+new Date(at).toLocaleString("vi-VN"):"")+
   "\nKhông có link tra cứu, email chỉ gửi thí sinh đã duyệt và đồng ý nhận."))return;
  sending=true;casting.disabled=true;group.disabled=true;load.disabled=true;notify("Đang gửi yêu cầu tới Resend, vui lòng không bấm gửi lặp lại...");
  window.showLoading?.(true,at?"Đang đặt lịch gửi email…":"Đang gửi email…");
  let result;
  const payload={task:resending?"resend":"dispatch",castingId:activeCasting,groupId:activeGroup||undefined,allEligible:false,candidateIds:recipients.map(x=>x.id),revision,subject:subject.value,intro:intro.value,thankYou:thanks.value,scheduledAt:at};
  const key=JSON.stringify(payload);if(retryKey!==key||!retryId){retryKey=key;retryId=crypto.randomUUID()}payload.confirmResend=resending;payload.requestId=retryId;
  try{result=await api("casting-result-email",payload);if(result.status!=="uncertain"){retryKey="";retryId=""}}
  catch(e){notify(e.message,true);try{await loadHistory()}catch(_){};throw e}
  finally{sending=false;casting.disabled=false;group.disabled=!group.options.length;load.disabled=false;window.showLoading?.(false);count()}
  if(token!==requestVersion)return;
  const failed=["rejected","uncertain","partial"].includes(result.status);const message=result.message||"Resend đã tiếp nhận yêu cầu.";
  if(!resending){try{await loadRows()}catch(e){window.showToast?.("Hãy làm mới danh sách để kiểm tra trạng thái công bố.","error")}}
  notify(message,failed);window.showToast?.(message,failed?"error":"success");
  try{await loadHistory()}catch(e){window.showToast?.("Yêu cầu đã được xử lý; chưa tải được lịch sử. Hãy làm mới lịch sử.","error")}
 }
 async function loadHistory(){
  if(!casting.value)return;
  const historyCasting=casting.value;const result=await api("casting-result-email",{task:"history",castingId:historyCasting});
  if(casting.value!==historyCasting)return;logBody.replaceChildren();
  const cancelled=(result.jobs||[]).find(x=>x.status==="cancelled");
  if(cancelled)revision=cancelled.id;
  for(const job of result.jobs||[]){
   const row=node("div","flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 py-2");
   row.append(node("span","text-xs text-slate-700",(job.mode==="resend"?"Gửi lại · ":"Công bố · ")+String(({accepted:"Đã tiếp nhận",scheduled:"Đã hẹn giờ",processing:"Đang xử lý",uncertain:"Chưa xác định",rejected:"Gửi thất bại",partial:"Gửi một phần","reservation-error":"Không thể công bố",cancelled:"Đã hủy"})[job.status]||job.status||"")+
    " · "+(job.acceptedCount||0)+"/"+job.count+" email · "+(job.scheduledAt?
      new Date(job.scheduledAt).toLocaleString("vi-VN"):
      new Date(job.createdMs).toLocaleString("vi-VN"))));
   if((job.status==="scheduled"&&Date.parse(job.scheduledAt)>Date.now()+120000)||job.status==="cancelled-lock-pending")row.append(btn("Hủy lịch",async()=>{
    if(!window.confirm("Hủy lịch gửi "+job.count+" email?"))return;
    const r=await api("casting-result-email",{task:"cancel",castingId:casting.value,jobId:job.id});
    notify("Đã hủy "+r.cancelled+"/"+r.requested+" email hẹn giờ.");
    await loadHistory();
   },true));
   if(job.lastError)row.append(node("span","text-xs text-rose-600",job.lastError));logBody.append(row);
  }
  if(!result.jobs?.length)logBody.append(node("p","text-slate-400","Chưa có lượt gửi kết quả trong lịch sử mới."));
 }
 async function refreshOptions(){const old=casting.value;clear();const data=await api("casting-group-options",{emailOptions:true});allGroups=(data.groups||[]).filter(g=>!g.archived);const allowed=new Set(allGroups.map(g=>g.castingId));casting.replaceChildren(...(data.castings||[]).filter(c=>allowed.has(c.id)).map(c=>new Option(c.term+" · "+c.name,c.id)));if([...casting.options].some(o=>o.value===old))casting.value=old;sessions();await loadRows();}
 try{await refreshOptions()}catch(e){notify("Không tải được phiên chấm: "+e.message,true)}
};
})();