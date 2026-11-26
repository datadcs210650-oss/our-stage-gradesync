/* GrandSync Email Center: manager-selected casting results, no lookup links. */
(()=>{
"use strict";
const api=(action,details={})=>window.oscGradingCall(action,details);
const node=(tag,cls="",text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=String(text);return el};
const field=(type="text",value="")=>{const x=node(type==="textarea"?"textarea":type==="select"?"select":"input","w-full border border-slate-200 rounded-xl p-3 bg-white text-xs");if(type!=="select"&&type!=="textarea")x.type=type;if(value)x.value=value;return x};
const label=(text,child)=>{const x=node("label","grid gap-1 text-xs font-semibold text-slate-600");x.append(node("span","",text),child);return x};
const btn=(text,fn,outline=false)=>{
 const b=node("button",(outline?"border border-rose-200 bg-white text-red-900":"bg-red-900 text-white")+" hover:opacity-90 px-4 py-2.5 rounded-xl text-xs font-bold",text);
 b.type="button";b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await fn()}catch(e){window.showToast?.(e.message||"Tác vụ không thành công.","error")}finally{b.disabled=false}};return b;
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
 const load=btn("Làm mới dữ liệu điểm",async()=>loadRows());
 cfg.append(load);shell.append(cfg);
 const recipients=card("02 · Người nhận");
 const checkAll=field("checkbox");checkAll.className="w-4 h-4 accent-red-900";
 const selectAll=node("label","flex items-center gap-2 text-xs font-bold text-red-900");
 selectAll.append(checkAll,node("span","","Gửi toàn bộ thí sinh đủ điều kiện của phiên"));
 const summary=node("span","text-xs text-slate-500","Chưa tải danh sách");
 const controls=node("div","flex flex-wrap items-center gap-3");
 controls.append(selectAll,summary);recipients.append(controls);
 const scroll=node("div","overflow-auto max-h-[430px] border border-slate-200 rounded-xl");
 const table=node("table","w-full min-w-[800px] text-left text-xs");
 table.innerHTML='<thead class="bg-rose-50 text-red-950 sticky top-0"><tr><th class="p-3">Chọn</th><th class="p-3">SBD</th><th class="p-3">Họ tên</th><th class="p-3">Email</th><th class="p-3">Phiên chấm</th><th class="p-3">Kết quả</th><th class="p-3">Điều kiện</th></tr></thead><tbody></tbody>';
 const tbody=table.querySelector("tbody");scroll.append(table);recipients.append(scroll);shell.append(recipients);
 const compose=card("03 · Nội dung và lịch công bố qua Email");
 const subject=field("text","[NTCD] THÔNG BÁO KẾT QUẢ");subject.readOnly=true;
 const intro=field("textarea");intro.rows=3;intro.maxLength=1200;intro.value="Cảm ơn bạn đã tham gia chương trình tuyển chọn diễn viên của Our Stage Club.";
 const thanks=field("textarea");thanks.rows=3;thanks.maxLength=1200;thanks.value="Cảm ơn bạn đã dành thời gian và tâm huyết tham gia. Chúc bạn luôn giữ niềm đam mê sân khấu!";
 const date=field("datetime-local");
 const top=node("div","grid grid-cols-1 md:grid-cols-2 gap-3");
 top.append(label("Tiêu đề Email",subject),label("Hẹn giờ công bố (để trống nếu gửi ngay)",date));
 compose.append(top,label("Lời chào / mở đầu",intro),label("Lời cảm ơn",thanks),
  node("p","text-xs text-slate-500","Resend tự gửi đúng thời gian đã đặt dù Admin tắt web. Phiên bị khóa chỉnh sửa khi xác nhận gửi hoặc đặt lịch; chỉ mở lại nếu hủy toàn bộ lịch thành công trước giờ công bố. Thời gian tối đa 29 ngày tới. Mỗi email có họ tên, SBD, kết quả và vai chính thức nếu có. Không đính kèm liên kết tra cứu."));
 const sample=card("Xem trước nội dung");
 const sampleBody=node("div","text-xs leading-relaxed space-y-1 text-slate-600","Hãy tải danh sách và chọn thí sinh.");
 sample.append(sampleBody);compose.append(sample);
 const send=btn("Gửi ngay / Xác nhận đặt lịch",async()=>dispatch());
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
 let allGroups=[],rows=[],chosen=new Set(),requestVersion=0,revision="";
 const notify=(msg,err=false)=>{status.textContent=msg;status.className="text-xs font-semibold "+(err?"text-rose-700":"text-emerald-700")};
 const eligible=()=>rows.filter(row=>row.eligible);
 const selected=()=>rows.filter(row=>row.eligible&&chosen.has(row.id));
 const count=()=>summary.textContent=checkAll.checked?
  "Toàn bộ "+eligible().length+" thí sinh đã duyệt, có email và đồng ý nhận thư.":
  "Đã chọn "+selected().length+" / "+eligible().length+" thí sinh đủ điều kiện.";
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
   checkbox.disabled=!row.eligible||checkAll.checked;
   checkbox.checked=(checkAll.checked&&row.eligible)||(chosen.has(row.id)&&row.eligible);
   checkbox.onchange=()=>{if(checkbox.checked)chosen.add(row.id);else chosen.delete(row.id);count();showSample()};
   select.append(checkbox);tr.append(select);
   for(const value of [row.code,row.name,row.email,row.groupName])tr.append(node("td","p-3",value||"—"));
   const result=node("td","p-3");result.append(badge(row));tr.append(result);
   tr.append(node("td","p-3 text-slate-500",row.eligible?"Đã duyệt, đồng ý nhận":!row.emailConsent?"Chưa đồng ý email":
    row.review!=="approved"?"Chưa duyệt":row.incomplete?"Chưa đủ điểm":"Thiếu email/kết quả"));
   tbody.append(tr);
  }
  if(!rows.length){const tr=node("tr"),td=node("td","p-8 text-center text-slate-400","Chưa có thí sinh hoặc chưa tải danh sách.");td.colSpan=7;tr.append(td);tbody.append(tr)}
  count();showSample();
 }
 function sessions(){
  group.replaceChildren(new Option("Tất cả phiên chấm",""));
  for(const g of allGroups.filter(g=>g.castingId===casting.value))group.append(new Option(g.name,g.id));
  if(group.options.length>1)group.selectedIndex=1;updateSubject();
 }
 function clear(){requestVersion++;rows=[];chosen.clear();checkAll.checked=false;tbody.replaceChildren();summary.textContent="Chọn phiên rồi nhấn Tải kết quả."}
 casting.onchange=()=>{sessions();clear();logBody.replaceChildren()};
 function updateSubject(){const g=allGroups.find(x=>x.id===group.value);subject.value="[NTCD] THÔNG BÁO KẾT QUẢ_"+(g?.name||"TÊN PHIÊN CỦA TỪNG THÍ SINH");}
 group.onchange=()=>{updateSubject();clear()};checkAll.onchange=()=>{chosen.clear();draw()};
 async function loadRows(){
  if(!casting.value)throw Error("Chưa chọn casting.");
  const token=++requestVersion;notify("Đang tải kết quả đã duyệt…");
  const result=await api("casting-result-email",{task:"preview",castingId:casting.value,
   groupId:group.value||undefined});
  if(token!==requestVersion)return;
  rows=result.rows||[];chosen.clear();checkAll.checked=false;draw();
  notify("Đã tải "+rows.length+" hồ sơ · "+eligible().length+" thí sinh đủ điều kiện gửi email.");
 }
 async function dispatch(){
  if(!rows.length)throw Error("Bấm tải danh sách trước khi gửi.");
  const all=checkAll.checked,recipients=all?eligible():selected();
  if(!recipients.length)throw Error("Chưa chọn người nhận đủ điều kiện.");
  if(recipients.length>500)throw Error("Mỗi lượt tối đa 500 email; hãy lọc theo phiên chấm.");
  let at=null;
  if(date.value){
   const time=new Date(date.value);
   if(!Number.isFinite(time.getTime()))throw Error("Lịch gửi không hợp lệ.");
   at=time.toISOString();
  }
  if(!window.confirm((at?"ĐẶT LỊCH ":"GỬI NGAY ")+recipients.length+
   " email PASSED/NOT PASSED?\n"+(at?"Thời gian: "+new Date(at).toLocaleString("vi-VN"):"")+
   "\nKhông có link tra cứu, email chỉ gửi thí sinh đã duyệt và đồng ý nhận."))return;
  notify("Đang gửi yêu cầu tới Resend, vui lòng không bấm gửi lặp lại...");
  window.showLoading?.(true,at?"Đang đặt lịch gửi email…":"Đang gửi email…");
  let result;
  try{result=await api("casting-result-email",{task:"dispatch",castingId:casting.value,
   groupId:group.value||undefined,allEligible:all,candidateIds:all?[]:recipients.map(x=>x.id),
   revision,subject:subject.value,intro:intro.value,thankYou:thanks.value,scheduledAt:at});}
  finally{window.showLoading?.(false)}
  notify(result.message||"Resend đã tiếp nhận yêu cầu.");
  await loadHistory();
 }
 async function loadHistory(){
  if(!casting.value)return;
  const result=await api("casting-result-email",{task:"history",castingId:casting.value});
  logBody.replaceChildren();
  const cancelled=(result.jobs||[]).find(x=>x.status==="cancelled");
  if(cancelled)revision=cancelled.id;
  for(const job of result.jobs||[]){
   const row=node("div","flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 py-2");
   row.append(node("span","text-xs text-slate-700",String(job.status||"")+
    " · "+job.count+" email · "+(job.scheduledAt?
      new Date(job.scheduledAt).toLocaleString("vi-VN"):
      new Date(job.createdMs).toLocaleString("vi-VN"))));
   if(["scheduled","cancelled-lock-pending"].includes(job.status))row.append(btn("Hủy lịch",async()=>{
    if(!window.confirm("Hủy lịch gửi "+job.count+" email?"))return;
    const r=await api("casting-result-email",{task:"cancel",castingId:casting.value,jobId:job.id});
    notify("Đã hủy "+r.cancelled+"/"+r.requested+" email hẹn giờ.");
    await loadHistory();
   },true));
   logBody.append(row);
  }
  if(!result.jobs?.length)logBody.append(node("p","text-slate-400","Chưa có lượt gửi kết quả trong lịch sử mới."));
 }
 try{
  const data=await api("casting-group-options");allGroups=data.groups||[];
  for(const c of data.castings||[])casting.append(new Option(c.term+" · "+c.name,c.id));
  sessions();clear();
 }catch(e){notify("Không tải được phiên chấm: "+e.message,true)}
};
})();