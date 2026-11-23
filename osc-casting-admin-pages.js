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
  grid.append(field("Học kỳ",term),field("Phân ban / nhóm chấm",division),field("Lưu trong casting",destination),field("Điểm đạt (0–10)",pass),sessionName);
  const submit=btn("Tạo phiên chấm",async()=>{
   const d=division.value.trim();
   if(!d)throw Error("Vui lòng nhập phân ban.");
   const response=await api("casting-create-session",{term:term.value,division:d,
    castingId:destination.value||undefined,passScore:Number(pass.value)});
   window.showToast?.("Đã tạo "+response.group.name+" (mặc định đang đóng).");
   await window.loadGroupsManager(host);
  });
  wrap.append(grid,submit);
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
   row.append(left,btn("Sao chép link BGK",()=>copy(groupLink(g.id)),true));list.append(row);
  }
  if(!groups.length)list.append(el("p","Chưa có phiên chấm.","text-xs text-gray-500"));
  const container=el("div","","space-y-4");
  container.append(wrap,policy,list);
  host.prepend(container);
  existing();naming();
 }
 async function graderSettings(host){
  const data=await api("casting-list"),graders=data.graders||[],groups=data.groups||[];
  const box=panel("Email Google, phân nhóm & quyền chấm của BGK",
   "Chỉ cho phép BGK chấm đúng nhóm và tiêu chí được phân công. Mã BGK và mật khẩu cũ vẫn sử dụng được.");
  const judge=sel(),email=input("gmail@domain.com","email"),group=sel(),criteria=el("div","","grid grid-cols-1 md:grid-cols-2 gap-2");
  options(judge,graders,g=>g.name+" · "+g.code);options(group,groups,g=>g.name);
  const info=el("p","","text-xs text-gray-600");
  const refreshJudge=()=>{
   const g=graders.find(g=>g.id===judge.value);email.value=g?.email||"";
   const assigned=(g?.assignedGroups||[]).filter(x=>groups.some(item=>item.id===x));
   const prior=group.value;
   group.replaceChildren();
   for(const id of assigned){const x=groups.find(g=>g.id===id);group.append(new Option(x.name,x.id))}
   if(assigned.includes(prior))group.value=prior;
   info.textContent=g?"BGK "+g.code+" · "+assigned.length+" phiên được phân công":"Chưa có giám khảo. Hãy tạo BGK ở phía trên trước.";
   refreshCriteria();
  };
  const refreshCriteria=()=>{
   const gg=groups.find(g=>g.id===group.value),j=judge.value;
   const grants=(data.criteriaGrants||[]).filter(x=>x.graderId===j&&x.groupId===group.value).map(x=>x.criterion);
   criteria.replaceChildren();
   for(const criterion of gg?.criteria||[]){
    const label=el("label","","flex items-center gap-2 p-2.5 bg-gray-50 rounded-xl text-xs font-semibold");
    const chk=input("","checkbox");chk.className="w-4 h-4";chk.value=criterion.name;
    chk.checked=grants.length?grants.includes(criterion.name):true;
    label.append(chk,el("span",criterion.name+" · "+criterion.weight+"%"));criteria.append(label);
   }
  };
  judge.onchange=refreshJudge;group.onchange=refreshCriteria;refreshJudge();
  const grants=el("div","","grid grid-cols-1 md:grid-cols-2 gap-4");
  grants.append(field("Chọn giám khảo",judge),field("Email Google nhận OTP",email),field("Phiên chấm đã phân công",group));
  const actions=el("div","","flex flex-wrap gap-2");
  actions.append(
   btn("Lưu email Google",async()=>{
    if(!judge.value)throw Error("Chưa có BGK.");
    const address=email.value.trim();if(!address||!email.checkValidity())throw Error("Email không hợp lệ.");
    await api("casting-grant-google",{graderId:judge.value,email:address,enabled:true});
    window.showToast?.("Đã cấp email Google cho BGK.");await window.loadAccountManager(host);
   }),
   btn("Lưu quyền tiêu chí",async()=>{
    if(!judge.value||!group.value)throw Error("Chưa phân công BGK vào phiên chấm. Hãy sửa nhóm được giao ở thẻ BGK.");
    const selected=[...criteria.querySelectorAll("input:checked")].map(x=>x.value);
    if(!selected.length)throw Error("Hãy chọn ít nhất một tiêu chí.");
    await api("casting-grant-criteria",{graderId:judge.value,groupId:group.value,criteria:selected});
    window.showToast?.("Đã cấp quyền tiêu chí, áp dụng tại máy chủ.");await window.loadAccountManager(host);
   },true),
   btn("Sao chép link phiên BGK",()=>{if(!group.value)throw Error("Hãy phân công một nhóm chấm trước.");return copy(groupLink(group.value))},true),
   btn("Sao chép cổng BGK",()=>copy("https://gradesyncfinal.vercel.app/"),true)
  );
  box.append(grants,field("Tiêu chí được phép chấm",criteria),info,actions);
  host.append(box);
 }
 const oldGroups=window.loadGroupsManager;
 if(typeof oldGroups==="function")window.loadGroupsManager=async function(host){
  await oldGroups(host);
  if(host)try{await sessionSettings(host)}catch(e){window.showToast?.("Không tải được thiết lập phiên chấm: "+e.message,"error")}
 };
 const oldAccounts=window.loadAccountManager;
 if(typeof oldAccounts==="function")window.loadAccountManager=async function(host){
  await oldAccounts(host);
  if(host)try{await graderSettings(host)}catch(e){window.showToast?.("Không tải được quyền BGK: "+e.message,"error")}
 };
}
