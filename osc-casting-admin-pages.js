/* OSC GradeSync: each management action lives in its own corresponding menu. */
export function installCastingAdminPages(){
 const api=(action,details={})=>window.oscGradingCall(action,details);
 const el=(tag,text="",cls="")=>{const x=document.createElement(tag);if(text)x.textContent=text;if(cls)x.className=cls;return x};
 const sel=()=>el("select","","w-full rounded-xl border border-rose-100 bg-white px-3 py-2.5 text-sm");
 const input=(placeholder="",type="text")=>{const x=el("input","","w-full rounded-xl border border-rose-100 bg-white px-3 py-2.5 text-sm");x.placeholder=placeholder;x.type=type;return x};
 const btn=(text,fn,secondary=false)=>{const b=el("button",text,(secondary?"bg-white text-red-900 border border-red-200 hover:bg-rose-50":"bg-red-900 text-white hover:bg-red-800")+" rounded-xl px-4 py-2.5 text-xs font-extrabold");b.type="button";b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await fn()}catch(e){window.showToast?.(e.message||"Yêu cầu không thành công.","error")}finally{b.disabled=false}};return b};
 const field=(label,x)=>{const p=el("label","","block text-xs font-semibold text-gray-700");p.append(el("span",label,"block mb-2"),x);return p};
 const panel=(heading,sub="")=>{const box=el("section","","bg-white border border-rose-100 rounded-2xl p-5 mt-4 shadow-sm space-y-4");box.append(el("h3",heading,"text-sm font-black text-red-900"));if(sub)box.append(el("p",sub,"text-xs text-gray-500"));return box};
 const options=(element,items,format)=>{const prev=element.value;element.replaceChildren();for(const item of items){const opt=el("option",format(item));opt.value=item.id;element.append(opt)}if(items.some(x=>x.id===prev))element.value=prev;return element.value};
 async function copy(value){
  try{await navigator.clipboard.writeText(value)}
  catch(_){
   const item=el("textarea");item.value=value;item.style.position="fixed";item.style.opacity="0";
   document.body.append(item);item.select();const ok=document.execCommand("copy");item.remove();if(!ok)throw Error("Trình duyệt không cho sao chép, hãy sao chép từ ô link.");
  }
  window.showToast?.("Đã sao chép link riêng cho phiên chấm.");
 }
 function groupLink(groupId){return "https://gradesyncfinal.vercel.app/?groupId="+encodeURIComponent(groupId)}
 const semesters=()=>{
  const year=new Date().getFullYear()%100;
  const out=[];for(const y of [year-1,year,year+1])for(const p of ["SP","SU","FA"])
   out.push({id:p+String(y).padStart(2,"0"),name:p+String(y).padStart(2,"0")});
  return out;
 };
 async function sessionSettings(host){
  const data=await api("casting-list"),allCastings=data.castings||[],groups=data.groups||[];
  const wrap=panel("Tạo phiên chấm theo học kỳ / phân ban",
   "Tên phiên tự động theo mẫu FA26_DIỄN VIÊN, SU27_BIÊN KỊCH... Có thể mở thêm nhiều phiên riêng trong cùng một học kỳ.");
  const grid=el("div","","grid grid-cols-1 md:grid-cols-2 gap-4");
  const term=sel();options(term,semesters(),x=>x.name);
  term.value=allCastings.find(c=>semesters().some(s=>s.id===c.term))?.term||("FA"+String(new Date().getFullYear()%100).padStart(2,"0"));
  const division=input("Ví dụ: DIỄN VIÊN & BIÊN KỊCH");
  const destination=sel();
  const sessionName=el("p","","text-xs font-bold text-red-800 md:col-span-2");
  const pass=input("5","number");pass.min="0";pass.max="10";pass.step="0.1";pass.value="5";
  const existing=()=>{const list=allCastings.filter(c=>c.term===term.value);
   const current=destination.value;destination.replaceChildren(new Option("Tạo casting riêng cho phiên này",""));
   for(const c of list)destination.append(new Option(c.name,c.id));
   destination.value=[...destination.options].some(o=>o.value===current)?current:"";
  };
  const naming=()=>{sessionName.textContent="Tên phiên: "+term.value+"_"+(division.value.trim().toUpperCase()||"PHÂN BAN");};
  term.onchange=()=>{existing();naming()};division.oninput=naming;
  // Khôi phục trình cấu hình nhóm cũ, nhưng luôn gắn với đúng học kỳ/casting.
  const mode=sel();
  mode.append(new Option("Mở thủ công","manual"),new Option("Mở tự động theo lịch","auto"));
  const start=input("Giờ mở","datetime-local"),end=input("Giờ khóa","datetime-local");
  const attendance=input("","checkbox");attendance.className="h-4 w-4 accent-red-800";
  const attendanceBox=el("label","","flex items-center gap-2 text-sm font-semibold text-gray-700");
  attendanceBox.append(attendance,el("span","Yêu cầu điểm danh khi chấm"));
  const schedule=el("div","","grid grid-cols-1 md:grid-cols-3 gap-4");
  schedule.append(field("Chế độ mở",mode),field("Giờ mở (nếu tự động)",start),field("Giờ khóa (tùy chọn nếu thủ công)",end));
  const criteriaList=el("div","","space-y-2");
  const addCriterion=(name="",weight="")=>{
   const row=el("div","","gsx-criterion-row flex flex-col sm:flex-row gap-2");
   const n=input("Tên tiêu chí"),w=input("Trọng số (%)","number");
   n.value=name;w.value=String(weight);w.min="0";w.max="100";w.step="0.01";w.classList.add("sm:w-28");
   const remove=btn("Xóa",()=>row.remove(),true);
   row.append(n,w,remove);criteriaList.append(row);
  };
  [["ĐÀI TỪ TIẾNG NÓI SÂN KHẤU",30],["NĂNG KHIẾU DIỄN XUẤT",30],["ỨNG BIẾN",30],["VẤN ĐÁP",10]].forEach(([n,w])=>addCriterion(n,w));
  const extraList=el("div","","space-y-2");
  const addExtra=()=>{
   const row=el("div","","gsx-extra-row flex flex-col sm:flex-row gap-2 sm:items-center");
   const n=input("Tên trường phụ, ví dụ: Lớp");
   const visible=input("","checkbox");visible.checked=true;visible.className="h-4 w-4 accent-red-800";
   const label=el("label","","flex gap-2 items-center text-xs font-semibold");
   label.append(visible,el("span","Hiển thị cho BGK"));
   row.append(n,label,btn("Xóa",()=>row.remove(),true));extraList.append(row);
  };
  const scoreSettings=panel("Cấu hình nhóm và cột điểm",
   "Tùy chỉnh cột điểm, trọng số, trường phụ, điểm danh và lịch mở chấm như GrandSync cũ. Tổng trọng số phải bằng 100%.");
  scoreSettings.append(schedule,attendanceBox,el("h4","Tiêu chí chấm · Tổng 100%","text-xs font-black text-red-900"),criteriaList,
   btn("+ Thêm tiêu chí",()=>addCriterion(),true),
   el("h4","Thông tin bổ sung cho thí sinh","text-xs font-black text-red-900"),extraList,
   btn("+ Thêm trường phụ",addExtra,true));
  mode.onchange=()=>{start.disabled=mode.value!=="auto";};
  mode.onchange();
  const collectCriteria=()=>{
   const rows=[...criteriaList.querySelectorAll(".gsx-criterion-row")];
   if(!rows.length||rows.length>20)throw Error("Cần 1–20 tiêu chí chấm.");
   const list=rows.map(row=>{const [name,weight]=row.querySelectorAll("input");return{name:name.value.trim(),weight:Number(weight.value)};});
   if(list.some(x=>!x.name||!Number.isFinite(x.weight)||x.weight<0||x.weight>100)||
    new Set(list.map(x=>x.name.toLowerCase())).size!==list.length)throw Error("Tên tiêu chí phải khác nhau và trọng số từ 0–100%.");
   if(Math.abs(list.reduce((a,x)=>a+x.weight,0)-100)>.01)throw Error("Tổng trọng số các tiêu chí phải bằng 100%.");
   return list;
  };
  const collectExtras=()=>{
   const rows=[...extraList.querySelectorAll(".gsx-extra-row")];
   if(rows.length>20)throw Error("Tối đa 20 trường phụ.");
   const values=rows.map(row=>({name:row.querySelector('input[type="text"]').value.trim(),
    showToGrader:row.querySelector('input[type="checkbox"]').checked})).filter(x=>x.name);
   if(new Set(values.map(x=>x.name.toLowerCase())).size!==values.length)throw Error("Tên trường phụ bị trùng.");
   return values;
  };
  grid.append(field("Học kỳ",term),field("Phân ban / nhóm chấm",division),field("Lưu trong casting",destination),field("Điểm đạt (0–10)",pass),sessionName);
  const submit=btn("Tạo phiên chấm",async()=>{
   const d=division.value.trim();
   if(!d)throw Error("Vui lòng nhập phân ban.");
   const passScore=Number(pass.value);
   if(!Number.isFinite(passScore)||passScore<0||passScore>10)throw Error("Điểm đạt phải từ 0 đến 10.");
   if(mode.value==="auto"&&(!start.value||!end.value))throw Error("Phiên tự động cần giờ mở và giờ khóa.");
   if(start.value&&end.value&&new Date(start.value)>=new Date(end.value))throw Error("Giờ khóa phải sau giờ mở.");
   const response=await api("casting-create-session",{term:term.value,division:d,
    castingId:destination.value||undefined,passScore,criteria:collectCriteria(),
    extraFields:collectExtras(),openMode:mode.value,
    startAt:start.value?new Date(start.value).toISOString():null,
    endAt:end.value?new Date(end.value).toISOString():null,
    attendanceEnabled:attendance.checked});
   window.showToast?.("Đã tạo "+response.group.name+" (mặc định đang đóng).");
   await window.loadGroupsManager(host);
  });
  wrap.append(grid,scoreSettings,submit);
  const policy=panel("Quy chế tổng hợp & cài đặt theo casting",
   "Phương pháp trung bình, trọng số giám khảo hoặc loại điểm cao nhất/thấp nhất. Chỉ thay đổi được trước khi BCN duyệt.");
  const casts=sel(),method=sel(),threshold=input("5","number"),weights=el("div","","grid grid-cols-1 md:grid-cols-2 gap-3");
  threshold.min="0";threshold.max="10";threshold.step=".1";
  for(const [v,t] of [["mean","Trung bình BGK"],["weighted","Trọng số BGK"],["trimmed","Bỏ điểm cao nhất & thấp nhất (≥3 BGK)"]])method.append(new Option(t,v));
  options(casts,allCastings,c=>c.term+" · "+c.name);
  const refreshPolicy=()=>{
   const c=allCastings.find(c=>c.id===casts.value);
   method.value=c?.aggregate_method||"mean";threshold.value=String(c?.pass_score??5);
   weights.replaceChildren();
   if(!c)return;
   const ids=new Set(groups.filter(g=>g.castingId===c.id).map(g=>g.id));
   const participants=(data.graders||[]).filter(g=>(g.assignedGroups||[]).some(id=>ids.has(id)));
   for(const g of participants){
    const w=input("1","number");w.min="0.1";w.max="100";w.step=".1";w.value=String(c.grader_weights?.[g.code]??1);w.dataset.code=g.code;
    weights.append(field(g.name+" ("+g.code+")",w));
   }
   if(!participants.length)weights.append(el("p","Chưa phân công BGK vào phiên chấm.","text-xs text-gray-500"));
  };
  casts.onchange=refreshPolicy;refreshPolicy();
  policy.append(field("Casting",casts),el("div","","grid grid-cols-1 md:grid-cols-2 gap-3"));
  policy.lastChild.append(field("Phương pháp",method),field("Ngưỡng PASSED",threshold));
  policy.append(el("p","Trọng số từng BGK (chỉ áp dụng khi chọn phương pháp trọng số)","text-xs font-semibold text-gray-600"),weights,
   btn("Lưu quy chế",async()=>{
    const c=allCastings.find(c=>c.id===casts.value);if(!c)throw Error("Chưa có casting.");
    const graderWeights={};
    weights.querySelectorAll("input[data-code]").forEach(x=>{const n=Number(x.value);if(!Number.isFinite(n)||n<=0||n>100)throw Error("Trọng số phải lớn hơn 0 và tối đa 100.");graderWeights[x.dataset.code]=n});
    await api("casting-save",{id:c.id,term:c.term,name:c.name,method:method.value,passScore:Number(threshold.value),weights:graderWeights});
    window.showToast?.("Đã lưu quy chế casting.");await window.loadGroupsManager(host);
   }));
  const list=panel("Các phiên chấm & đường dẫn BGK","Link chỉ mở đúng phiên khi BGK đã được cấp quyền.");
  for(const g of groups){
   const c=allCastings.find(c=>c.id===g.castingId);
   const row=el("div","","flex flex-col md:flex-row md:items-center gap-2 py-3 border-b border-gray-100");
   const left=el("div","","flex-1 min-w-0");left.append(el("div",g.name,"font-bold text-sm"),el("div",c?c.term+" · "+c.name:"Chưa gắn casting","text-xs text-gray-500"));
   const nameInput=host.querySelector("#e-gn-"+CSS.escape(g.id));
   if(nameInput&&g.version)nameInput.dataset.version=g.version;
   const editor=nameInput?.closest("tr");
   const edit=btn("Chỉnh sửa phiên",()=>{
    const details=editor?.closest("details");
    if(details){details.open=true;editor.scrollIntoView({block:"nearest"});editor.querySelector("input")?.focus()}
   },true);
   if(editor)row.append(left,edit);else row.append(left);
   if(!c&&allCastings.length){
    const link=sel();link.append(new Option("Chọn casting",""));
    for(const casting of allCastings.filter(c=>!["published","archived"].includes(c.status)))
     link.append(new Option(casting.term+" · "+casting.name,casting.id));
    row.append(field("Gắn casting",link),btn("Gắn",async()=>{
     if(!link.value)throw Error("Hãy chọn casting.");
     await api("casting-assign-group",{castingId:link.value,groupId:g.id});
     await window.loadGroupsManager(host);
    },true));
   }
   row.append(btn("Sao chép link BGK",()=>copy(groupLink(g.id)),true));list.append(row);
  }
  if(!groups.length)list.append(el("p","Chưa có phiên chấm.","text-xs text-gray-500"));
  const container=el("div","","space-y-4");
  const collapse=(label,section)=>{
   const details=el("details","","mb-3");
   details.append(el("summary",label,"cursor-pointer font-bold text-sm text-red-900"),section);
   return details;
  };
  container.append(list,collapse("Tạo phiên chấm",wrap),collapse("Quy chế tổng hợp theo casting",policy));
  // Legacy unscoped group creation conflicts with semester-bound casting sessions.
  // Keep the existing per-group configuration editor; use this guided creation form instead.
  for(const child of [...host.children]){
   if(child.querySelector("h3")?.textContent?.includes("Khởi tạo Nhóm"))child.remove();
  }
  const legacy=el("details","","mt-4 bg-white border rounded-2xl p-4");
  legacy.append(el("summary","Chỉnh sửa phiên và cấu hình điểm","cursor-pointer font-bold text-sm text-red-900"));
  legacy.append(...host.children);
  host.append(container,legacy);
  legacy.querySelectorAll('button[onclick*="deleteGroup"]').forEach(button=>button.remove());
  existing();naming();
 }
 async function graderSettings(host,graderId){
  const data=await api("casting-list");
  if(!host.isConnected)return;
  const grader=(data.graders||[]).find(g=>g.id===graderId);
  if(!grader)throw Error("Không tìm thấy hồ sơ BGK.");
  const groups=(data.groups||[]).filter(g=>(grader.assignedGroups||[]).includes(g.id));
  const box=panel("Quyền chấm theo tiêu chí");
  const group=sel(),criteria=el("div","","grid grid-cols-1 md:grid-cols-2 gap-2");
  options(group,groups,g=>g.name);
  const stored=new Map();
  for(const g of groups)stored.set(g.id,(data.criteriaGrants||[]).filter(x=>x.graderId===graderId&&x.groupId===g.id).map(x=>x.criterion));
  const refreshCriteria=()=>{
   const gg=groups.find(g=>g.id===group.value),grants=stored.get(group.value)||[];
   criteria.replaceChildren();
   for(const criterion of gg?.criteria||[]){
    const label=el("label","","flex items-center gap-2 p-2.5 bg-gray-50 rounded-xl text-xs font-semibold");
    const chk=input("","checkbox");chk.className="w-4 h-4 accent-red-800";chk.value=criterion.name;
    chk.checked=grants.length?grants.includes(criterion.name):true;
    label.append(chk,el("span",criterion.name+" · "+criterion.weight+"%"));criteria.append(label);
   }
  };
  group.onchange=refreshCriteria;refreshCriteria();
  if(!groups.length){
   box.append(el("p","Hãy lưu phân công nhóm trước khi thiết lập tiêu chí.","text-xs text-gray-500"));
  }else{
   box.append(field("Phiên chấm đã phân công",group),field("Tiêu chí được phép chấm",criteria));
   const actions=el("div","","flex flex-wrap gap-2");
   actions.append(btn("Lưu quyền tiêu chí",async()=>{
    const groupId=group.value,selected=[...criteria.querySelectorAll("input:checked")].map(x=>x.value);
    if(!selected.length)throw Error("Hãy chọn ít nhất một tiêu chí.");
    await api("casting-grant-criteria",{graderId,groupId,criteria:selected});
    stored.set(groupId,selected);window.showToast?.("Đã lưu quyền tiêu chí.");
   }),btn("Sao chép link phiên BGK",()=>copy(groupLink(group.value)),true));
   box.append(actions,el("p","Nếu thay đổi nhóm, hãy lưu hồ sơ trước rồi mở lại để thiết lập tiêu chí.","text-xs text-gray-500"));
  }
  host.replaceChildren(box);
 }
 const oldGroups=window.loadGroupsManager;
 if(typeof oldGroups==="function")window.loadGroupsManager=async function(host){
  await oldGroups(host);
  if(host)try{await sessionSettings(host)}catch(e){window.showToast?.("Không tải được thiết lập phiên chấm: "+e.message,"error")}
 };
 const oldAccounts=window.loadAccountManager;
 if(typeof oldAccounts==="function")window.loadAccountManager=async function(host){
  await oldAccounts(host);
  const form=host?.querySelector("#acc-name")?.closest(".rounded-3xl");
  if(!form)return;
  const dialog=el("dialog","","rounded-2xl bg-white shadow-2xl border border-rose-100 p-0");
  dialog.style.cssText="width:min(760px,94vw);max-height:88vh;overflow:auto;margin:auto";
  const bar=el("div","","flex justify-between items-center px-5 py-3 border-b border-rose-100");
  bar.append(el("h3","Thêm giám khảo","font-bold text-red-900"),btn("Đóng",()=>dialog.close(),true));
  const launch=el("div","","flex items-center justify-end mb-4");
  launch.append(btn("+ Thêm giám khảo",()=>dialog.showModal()));
  form.before(launch,dialog);dialog.append(bar,form);
  form.classList.remove("mb-6","shadow-sm","border","rounded-3xl");
 };
 const editGrader=window.openEditGraderModal;
 if(typeof editGrader==="function")window.openEditGraderModal=function(graderId,...args){
  editGrader.call(this,graderId,...args);
  const modal=document.getElementById("custom-modal-box");
  if(!modal)return;
  const pane=el("div","Đang tải quyền chấm…","mb-4 text-xs text-gray-500");
  modal.querySelector('button[onclick*="saveGraderEdit"]')?.parentElement?.before(pane);
  if(!pane.isConnected)modal.append(pane);
  graderSettings(pane,graderId).catch(e=>{if(pane.isConnected)pane.textContent=e.message||"Không tải được quyền chấm."});
 };
}
