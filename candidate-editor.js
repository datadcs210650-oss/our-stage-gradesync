/* GrandSync candidates — OSC-style member profiles, scoped and paginated. */
(()=>{
"use strict";
const request=(action,details={})=>window.oscGradingCall(action,details);
const make=(tag,cls="",text)=>{const x=document.createElement(tag);x.className=cls;if(text!==undefined)x.textContent=String(text);return x};
const input=(type="text",value="",placeholder="")=>{const x=make("input","w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs outline-none focus:border-red-400");x.type=type;x.value=String(value??"");x.placeholder=placeholder;return x};
const button=(text,fn,neutral=false)=>{const x=make("button",(neutral?"bg-white text-slate-700 border border-slate-200 hover:border-red-300":"bg-red-900 text-white hover:bg-red-800")+" rounded-xl px-3 py-2.5 text-xs font-bold transition",text);x.type="button";x.onclick=async()=>{if(x.disabled)return;x.disabled=true;try{await fn()}catch(e){window.showToast?.(e.message||"Thao tác không thành công.","error")}finally{x.disabled=false}};return x};
const label=(name,control)=>{const x=make("label","grid gap-1 text-xs font-semibold text-slate-600");x.append(make("span","",name),control);return x};
const safeText=x=>String(x??"").trim();
const flag=(text,good)=>make("span","inline-flex items-center rounded-full px-2 py-1 text-[10px] font-bold "+(good?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-600"),text);
const toolsMenu=window.loadStudentList;
if(typeof toolsMenu!=="function")return;

window.loadStudentList=async function(host){
 host.replaceChildren();
 const alive=()=>host.isConnected;
 const state={groups:[],selected:"",offset:0,limit:60,items:[],defs:[],total:0,token:0,loading:false,selectedIds:new Set()};
 const shell=make("section","space-y-4 pb-8");
 const title=make("div","flex flex-wrap items-center justify-between gap-3");
 const name=make("div");
 name.append(make("p","text-[10px] uppercase tracking-[.18em] font-black text-red-700","GRANDSYNC / QUẢN LÝ THÍ SINH"),make("h2","text-xl font-black text-slate-900","Hồ sơ thí sinh"),make("p","text-xs text-slate-500 mt-1","Danh sách theo phiên chấm, tương tự hồ sơ thành viên OSC. Chỉ tải nhóm đang chọn."));
 const actions=make("div","flex flex-wrap gap-2");
 const refresh=button("↻ Làm mới",async()=>loadPage(),true);
 const addBtn=button("+ Thêm thí sinh",async()=>openCreate());
 const approveBtn=button("✓ Duyệt nhanh",async()=>bulkApprove());
 actions.append(refresh,addBtn,approveBtn);title.append(name,actions);shell.append(title);
 const toolbar=make("div","bg-white border border-rose-100 rounded-2xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-[minmax(240px,1fr)_minmax(220px,1fr)_auto] gap-3");
 const group=make("select","w-full rounded-xl border border-slate-200 p-3 text-xs bg-white");
 const search=input("search","","Tìm tên, SBD, MSSV, email, số điện thoại trong trang");
 const selectAll=make("label","flex items-center gap-2 text-xs font-semibold text-slate-600");
 const all=input("checkbox");all.className="h-4 w-4 accent-red-800";selectAll.append(all,make("span","","Chọn trang"));
 toolbar.append(label("Phiên chấm",group),label("Tìm kiếm",search),selectAll);shell.append(toolbar);
 const metrics=make("div","grid grid-cols-2 md:grid-cols-4 gap-3");
 const stats=["Thí sinh trong nhóm","Đã đồng ý nhận email","Được duyệt","Đã chọn"].map(n=>{const x=make("div","bg-white border border-slate-100 rounded-2xl p-3"),v=make("strong","text-lg font-black text-red-900","—");x.append(make("div","text-[10px] text-slate-500",n),v);metrics.append(x);return v});
 shell.append(metrics);
 const banner=make("p","text-xs text-slate-500");banner.setAttribute("role","status");shell.append(banner);
 const wrap=make("div","overflow-auto max-h-[64vh] bg-white rounded-2xl border border-slate-200 shadow-sm");
 const table=make("table","w-full min-w-[1250px] text-left text-xs");
 table.innerHTML='<thead class="bg-rose-50 sticky top-0 z-10 text-red-950"><tr><th class="px-3 py-3">Chọn</th><th class="px-3 py-3">SBD</th><th class="px-3 py-3">Họ và tên</th><th class="px-3 py-3">MSSV</th><th class="px-3 py-3">Email</th><th class="px-3 py-3">Số điện thoại</th><th class="px-3 py-3">Trường phụ</th><th class="px-3 py-3">Nhận email</th><th class="px-3 py-3">Duyệt</th><th class="px-3 py-3">Hồ sơ</th></tr></thead><tbody></tbody>';
 const tbody=table.querySelector("tbody");wrap.append(table);shell.append(wrap);
 const pager=make("div","flex items-center justify-between flex-wrap gap-2 text-xs text-slate-600"),counter=make("span");
 pager.append(button("← Trang trước",async()=>{state.offset=Math.max(0,state.offset-state.limit);await loadPage()},true),counter,button("Trang sau →",async()=>{state.offset+=state.limit;await loadPage()},true));
 const previousBtn=pager.firstChild,nextBtn=pager.lastChild;shell.append(pager);
 const legacy=make("details","bg-white border border-slate-200 rounded-2xl p-4");
 legacy.append(make("summary","cursor-pointer text-xs font-bold text-slate-800","Công cụ bổ sung: Import Excel, danh sách cũ, nhập từ OSC"));
 const legacyArea=make("div","mt-4"),legacyState=make("p","text-xs text-slate-500 mt-2","Chỉ tải công cụ này khi mở để trang thí sinh vào nhanh hơn.");
 legacy.append(legacyState,legacyArea);
 let legacyLoaded=false;
 legacy.addEventListener("toggle",async()=>{
  if(!legacy.open||legacyLoaded)return;
  legacyLoaded=true;legacyState.textContent="Đang tải công cụ bổ sung...";
  try{await toolsMenu(legacyArea);legacyState.textContent=""}
  catch(e){legacyState.textContent="Không tải được công cụ bổ sung: "+e.message}
 });
 shell.append(legacy);host.append(shell);
 const modal=make("dialog","border-0 rounded-2xl shadow-2xl p-0 bg-white text-slate-800");
 modal.style.cssText="width:min(850px,94vw);max-height:88vh;overflow:auto;margin:auto";
 document.body.append(modal);
 // A single modal is disposed when this page leaves; no extra requests on idle.
 const clean=()=>{if(!host.isConnected){modal.remove();observer.disconnect()}};
 const observer=new MutationObserver(clean);observer.observe(document.getElementById("main-content")||host.parentNode||host,{childList:true,subtree:true});
 const current=()=>state.groups.find(x=>x.id===state.selected);
 function formatReview(v){return v==="approved"?"Đã duyệt":v==="rejected"?"Từ chối":"Chờ duyệt"}
 function rerender(){
  const searchTerm=search.value.toLocaleLowerCase("vi").trim();
  const filtered=state.items.filter(r=>!searchTerm||[r.name,r.code,r.mssv,r.email,r.phone,...(r.extras||[]).map(x=>x.value)].some(v=>String(v||"").toLocaleLowerCase("vi").includes(searchTerm)));
  tbody.replaceChildren();
  for(const item of filtered){
   const tr=make("tr","border-b border-slate-100 hover:bg-red-50/40 transition");
   const chk=input("checkbox");chk.className="accent-red-900 h-4 w-4";
   chk.checked=state.selectedIds.has(item.id);
   chk.onchange=()=>{if(chk.checked)state.selectedIds.add(item.id);else state.selectedIds.delete(item.id);updateStats()};
   const choose=make("td","px-3 py-3");choose.append(chk);tr.append(choose);
   const id=make("td","px-3 py-3 font-mono font-bold text-red-900",item.code||"—");
   const person=make("td","px-3 py-3 font-semibold text-slate-900",item.name||"—");
   tr.append(id,person);
   for(const v of [item.mssv,item.email,item.phone])tr.append(make("td","px-3 py-3 text-slate-700 break-words",v||"—"));
   const extra=make("td","px-3 py-3 max-w-64 whitespace-normal");
   const items=(item.extras||[]).filter(x=>x.value!=null&&String(x.value).trim());
   for(const f of items.slice(0,7))extra.append(make("p","py-0.5 text-[11px] text-slate-600",f.label+": "+String(f.value)));
   if(items.length>7)extra.append(make("p","text-slate-400 text-[10px]","+"+(items.length-7)+" trường khác"));
   if(!items.length)extra.textContent="—";tr.append(extra);
   const agree=make("td","px-3 py-3");agree.append(flag(item.emailConsent?"Đã đồng ý":"Chưa đồng ý",item.emailConsent));tr.append(agree);
   const review=make("td","px-3 py-3");review.append(flag(formatReview(item.review),item.review==="approved"));tr.append(review);
   const edit=make("td","px-3 py-3");edit.append(button("Xem / Sửa",async()=>openProfile(item),true));tr.append(edit);tbody.append(tr);
  }
  if(!filtered.length){const r=make("tr"),c=make("td","text-center p-10 text-slate-400",state.items.length?"Không có hồ sơ khớp từ khóa.":"Chưa có thí sinh trong nhóm. Bạn có thể thêm ngay hoặc dùng công cụ Import.");c.colSpan=10;r.append(c);tbody.append(r)}
  counter.textContent="Trang "+(Math.floor(state.offset/state.limit)+1)+" · "+state.items.length+" / "+state.total+" thí sinh";
  previousBtn.disabled=state.offset===0;nextBtn.disabled=state.offset+state.items.length>=state.total;
  updateStats();
 }
 function updateStats(){
  stats[0].textContent=String(state.total);
  stats[1].textContent=String(state.items.filter(c=>c.emailConsent).length)+" / trang";
  stats[2].textContent=String(state.items.filter(c=>c.review==="approved").length)+" / trang";
  stats[3].textContent=String(state.selectedIds.size);
 }
 async function loadPage(){
  if(!state.selected){state.items=[];state.total=0;banner.textContent="Chưa có phiên chấm.";rerender();return}
  const token=++state.token,gid=state.selected,offset=state.offset;
  banner.textContent="Đang tải thí sinh của phiên đã chọn…";refresh.disabled=true;
  try{
   const response=await request("casting-candidate-roster",{groupId:gid,offset,limit:state.limit});
   if(!alive()||token!==state.token||state.selected!==gid)return;
   state.items=response.rows||[];state.total=response.total||0;state.defs=response.fields||[];
   state.selectedIds.clear();all.checked=false;search.value="";
   banner.textContent=current()?.term+" · "+current()?.name+" · dữ liệu bảo mật chỉ BCN được xem";
   rerender();
  }catch(e){if(token===state.token){banner.textContent="Không tải được hồ sơ: "+e.message;state.items=[];rerender()}}
  finally{if(token===state.token)refresh.disabled=false}
 }
 all.onchange=()=>{if(all.checked)for(const r of state.items)state.selectedIds.add(r.id);else state.selectedIds.clear();rerender()};
 search.addEventListener("input",rerender);
 group.onchange=()=>{state.selected=group.value;state.offset=0;loadPage()};
 async function loadGroups(){
  const data=await request("casting-group-options");
  if(!alive())return;
  state.groups=data.groups||[];
  const saved=state.selected;
  group.replaceChildren();
  for(const g of state.groups){const o=new Option(g.term+" · "+g.name,g.id);group.append(o)}
  if(saved&&state.groups.some(g=>g.id===saved))group.value=saved;
  state.selected=group.value||"";
  addBtn.disabled=!state.selected||["published","archived"].includes(current()?.castingStatus);
  await loadPage();
 }
 const modalShell=(heading)=>{
  modal.replaceChildren();
  const pane=make("div","p-5 md:p-6 space-y-5");
  const top=make("div","flex items-start justify-between gap-3 border-b pb-3");
  top.append(make("h3","text-base font-black text-red-900",heading),button("Đóng",()=>modal.close(),true));
  const fields=make("div","grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"),footer=make("div","flex justify-end gap-2 pt-3");
  pane.append(top,fields,footer);modal.append(pane);return{fields,footer};
 };
 const extraInputs=(container,record)=>{
  const choices=[];
  const defs=state.defs||[];
  const used=new Set(["name","mssv","email","phone","castingEmailConsent"]);
  for(const def of defs){
   if(used.has(def.field_key)||!def.field_key)continue;
   const storage=def.visibility==="admin"?record?.privateFields:record?.fields;
   const old=storage?.[def.field_key]||"";
   let el;
   if(def.kind==="select"){
    el=make("select","border border-slate-200 p-2.5 text-xs rounded-xl w-full");
    el.append(new Option("Chưa chọn",""));
    for(const choice of def.choices||[])el.append(new Option(String(choice),String(choice)));
    el.value=String(old);
   }else el=input(def.kind==="number"?"number":def.kind==="date"?"date":def.kind==="email"?"email":"text",old);
   container.append(label(def.label+(def.required?" *":""),el));
   choices.push([def.field_key,el]);
   used.add(def.field_key);
  }
  if(record){
   for(const key of [...Object.keys(record.fields||{}),...Object.keys(record.privateFields||{})]){
    if(used.has(key)||["__proto__","prototype","constructor"].includes(key))continue;
    const v=record.fields?.[key]??record.privateFields?.[key]??"";
    const el=input("text",v);
    container.append(label(key,el));choices.push([key,el]);used.add(key);
   }
  }
  return choices;
 };
 function consentBox(initial){
  const wrap=make("label","flex items-start gap-3 col-span-full p-3 rounded-xl border border-amber-100 bg-amber-50 text-xs text-amber-900");
  const check=input("checkbox");check.className="mt-1 h-4 w-4 accent-red-900";check.checked=initial;
  wrap.append(check,make("span","","Thí sinh đã xác nhận đồng ý nhận email kết quả. Chỉ đánh dấu khi đã có sự đồng ý thực tế."));
  return{wrap,check};
 }
 async function openProfile(item){
  if(!current())return;
  const {fields,footer}=modalShell("Hồ sơ · "+item.name+" · "+item.code);
  const name=input("text",item.name),code=input("text",item.code),mssv=input("text",item.mssv),
   email=input("email",item.email),phone=input("tel",item.phone);
  code.disabled=true;
  fields.append(label("Họ tên",name),label("SBD (không thay đổi tại đây)",code),label("MSSV",mssv),label("Email liên hệ",email),label("Số điện thoại",phone));
  const extras=extraInputs(fields,item),consent=consentBox(item.emailConsent);fields.append(consent.wrap);
  const locked=["published","archived"].includes(current().castingStatus);
  if(locked){fields.querySelectorAll("input,select").forEach(x=>x.disabled=true);footer.append(make("p","text-xs text-amber-800","Kết quả đã công bố: hồ sơ chỉ xem."))}
  else footer.append(button("Lưu hồ sơ",async()=>{
   if(!name.value.trim()||!email.checkValidity())throw Error("Họ tên hoặc email không hợp lệ.");
   if(consent.check.checked&&!item.emailConsent&&!window.confirm("Xác nhận thí sinh đã đồng ý nhận email kết quả?"))return;
   const update={mssv:mssv.value,email:email.value,phone:phone.value,castingEmailConsent:consent.check.checked};
   for(const [key,x] of extras)update[key]=x.value;
   await request("casting-candidate-edit",{candidateId:item.id,castingId:item.castingId,name:name.value,
    fields:update,version:item.version,identityVersion:item.identityVersion});
   modal.close();window.showToast?.("Đã cập nhật hồ sơ thí sinh.");await loadPage();
  }));
  modal.showModal();
 }
 async function openCreate(){
  if(!current())throw Error("Hãy chọn phiên chấm trước.");
  const session=current();
  if(["published","archived"].includes(session.castingStatus))throw Error("Phiên đã công bố hoặc lưu trữ.");
  const {fields,footer}=modalShell("Thêm thí sinh · "+session.name);
  const code=input("text","","SBD"),name=input("text","","Họ và tên"),mssv=input("text","","MSSV"),
   email=input("email","","Email"),phone=input("tel","","Số điện thoại");
  fields.append(label("SBD *",code),label("Họ và tên *",name),label("MSSV",mssv),label("Email",email),label("Số điện thoại",phone));
  const extras=extraInputs(fields,null),consent=consentBox(false);fields.append(consent.wrap);
  footer.append(button("Thêm hồ sơ",async()=>{
   if(!code.value.trim()||name.value.trim().length<2||!email.checkValidity())throw Error("Kiểm tra SBD, họ tên và email.");
   if(consent.check.checked&&!window.confirm("Bạn xác nhận đã được thí sinh cho phép gửi email kết quả?"))return;
   const extra={};for(const [key,x] of extras)extra[key]=x.value;
   await request("casting-candidate-add",{castingId:session.castingId,groupId:session.id,
    code:code.value,name:name.value,mssv:mssv.value,email:email.value,phone:phone.value,
    fields:extra,emailConsent:consent.check.checked,confirmConsent:consent.check.checked});
   modal.close();window.showToast?.("Đã thêm thí sinh vào nhóm.");state.offset=0;await loadPage();
  }));
  modal.showModal();
 }
 async function bulkApprove(){
  const groupInfo=current();if(!groupInfo)throw Error("Chọn phiên chấm.");
  const selected=[...state.selectedIds];if(!selected.length)throw Error("Hãy chọn thí sinh trước.");
  const consenting=state.items.filter(x=>state.selectedIds.has(x.id)&&x.emailConsent===true);
  if(!consenting.length)throw Error("Các thí sinh đã chọn chưa đồng ý nhận email.");
  const response=await request("casting-results",{castingId:groupInfo.castingId});
  const allowed=new Set(consenting.map(x=>x.id));
  const ready=(response.rows||[]).filter(x=>allowed.has(x.id)&&!x.incomplete&&["passed","failed"].includes(x.outcome)&&x.review!=="approved");
  if(!ready.length)throw Error("Chưa có thí sinh đủ điểm khóa để duyệt hoặc tất cả đã được duyệt.");
  if(!window.confirm("Duyệt kết quả "+ready.length+" thí sinh đã đồng ý nhận email? Trạng thái Passed/Not Passed sẽ theo điểm BGK đã xác nhận."))return;
  let completed=0;
  for(let i=0;i<ready.length;i+=40){
   const chunk=ready.slice(i,i+40);
   await request("casting-review",{castingId:groupInfo.castingId,
    decisions:chunk.map(x=>({candidateId:x.id,review:"approved"}))});
   completed+=chunk.length;
  }
  window.showToast?.("Đã duyệt "+completed+" kết quả. Chuyển sang menu Email để gửi hoặc đặt lịch.");
  await loadPage();
 }
 try{await loadGroups()}catch(e){banner.textContent="Không tải được danh sách phiên chấm: "+e.message}
};
})();