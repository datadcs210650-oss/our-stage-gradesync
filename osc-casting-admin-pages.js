/* OSC GradeSync: each management action lives in its own corresponding menu. */
export function installCastingAdminPages(){
 const api=(action,details={})=>window.oscGradingCall(action,details);
 const el=(tag,text="",cls="")=>{const x=document.createElement(tag);if(text)x.textContent=text;if(cls)x.className=cls;return x};
 const sel=()=>el("select","","w-full rounded-xl border border-rose-100 bg-white px-3 py-2.5 text-sm");
 const input=(placeholder="",type="text")=>{const x=el("input","","w-full rounded-xl border border-rose-100 bg-white px-3 py-2.5 text-sm");x.placeholder=placeholder;x.type=type;return x};
 const btn=(text,fn,secondary=false)=>{const b=el("button",text,(secondary?"bg-white text-red-900 border border-red-200 hover:bg-rose-50":"bg-red-900 text-white hover:bg-red-800")+" rounded-xl px-4 py-2.5 text-xs font-extrabold");b.type="button";b.onclick=async()=>{if(b.disabled)return;b.disabled=true;b.setAttribute("aria-busy","true");const end=window.OSCProgress?.begin(text+"…");try{await fn()}catch(e){window.showToast?.(e.message||"Yêu cầu không thành công.","error")}finally{end?.();b.removeAttribute("aria-busy");b.disabled=false}};return b};
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
  if(!host.isConnected)return;
  const root=el("section","","space-y-4 pb-8"),header=el("div","","flex flex-wrap justify-between items-center gap-3");
  header.append(el("h2","Quản lý phiên chấm","text-xl font-black text-red-950"),btn("+ Tạo phiên chấm",()=>openEditor(null)));
  const list=el("div","","grid grid-cols-1 lg:grid-cols-2 gap-4");
  const dialog=el("dialog","","rounded-2xl border border-rose-100 bg-white shadow-2xl p-0");
  dialog.style.cssText="width:min(940px,95vw);max-height:90vh;overflow:auto;margin:auto";
  const search=input("Tìm phiên chấm / học kỳ"),filter=sel();for(const [v,t] of [["","Tất cả trạng thái"],["open","Đang mở"],["closed","Đã đóng chấm"],["scheduled","Chờ lịch"],["review","Đối soát"],["approved","Đã duyệt"],["published","Đã công bố"],["publication-scheduled","Đã đặt lịch công bố"],["archived","Lưu trữ"]])filter.append(new Option(t,v));const filters=el("div","","grid grid-cols-1 sm:grid-cols-2 gap-3");filters.append(search,filter);header.append(btn("Làm mới dữ liệu",()=>sessionSettings(host),true));root.append(header,filters,list,dialog);const stateFor=g=>["open","closed","scheduled"].includes(g.accessState)?g.accessState:"unknown";
  const statusNames={open:"Đang mở chấm",closed:"Đã đóng chấm",scheduled:"Chờ lịch mở",unknown:"Chưa xác định",draft:"Chưa duyệt",review:"Đang đối soát",approved:"Đã đối soát",published:"Đã công bố","publication-scheduled":"Đã đặt lịch công bố",archived:"Đã lưu trữ"};
  const accessColor={open:"bg-emerald-100 text-emerald-800",closed:"bg-gray-100 text-gray-700",scheduled:"bg-amber-100 text-amber-800",unknown:"bg-gray-100 text-gray-700"};
  const applyFilter=()=>{for(const card of list.children)card.hidden=!!(filter.value&&card.dataset.status!==filter.value&&card.dataset.review!==filter.value)||!(card.dataset.search||"").includes(search.value.trim().toLocaleLowerCase("vi"))};search.oninput=filter.onchange=applyFilter;
  function openDelete(g,published){
   dialog.replaceChildren();
   const pane=el("div","","p-5 md:p-6 space-y-4");
   pane.append(el("h3","Xóa phiên chấm","text-lg font-black text-red-950"),el("p",published?"Phiên "+g.name+" sẽ được xóa khỏi danh sách quản lý và BGK. Điểm, biên bản, kết quả đã công bố, nhật ký và thành viên đã đồng bộ vẫn được bảo toàn.": "Phiên "+g.name+" sẽ bị xóa vĩnh viễn nếu chưa có dữ liệu chấm hoặc kết quả duyệt. Không thể hoàn tác.","text-sm text-red-800 leading-relaxed"),el("p","Nhập đúng tên phiên để xác nhận.","text-xs font-bold text-gray-700"));
   const name=input(g.name);pane.append(name);
   const actions=el("div","","flex flex-wrap gap-2 justify-end");
   const remove=btn(published?"Xóa khỏi danh sách":"Xóa vĩnh viễn",async()=>{await api("casting-session-control",{operation:"delete",groupId:g.id,version:g.version,confirmName:name.value,confirm:true,archivePublished:published});dialog.close();window.showToast?.("Đã xóa phiên chấm.");await sessionSettings(host)});
   remove.disabled=true;name.oninput=()=>{remove.disabled=name.value!==g.name};actions.append(btn("Hủy",()=>dialog.close(),true),remove);pane.append(actions);dialog.append(pane);dialog.showModal();
  }
  function localDate(v){if(!v)return "";const d=new Date(v);if(!Number.isFinite(d.getTime()))return "";return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
  function openEditor(group){
   const casting=allCastings.find(x=>x.id===group?.castingId);
   const original=group?.sessionPolicy,policy=original||{method:casting?.aggregate_method||"mean",weights:casting?.grader_weights||{},roles:[],maxRegistered:1,maxProposed:1,notesEnabled:false};
   dialog.replaceChildren();
   const pane=el("div","","p-5 md:p-6 space-y-4");
   const top=el("div","","flex justify-between items-center gap-3 border-b border-rose-100 pb-3");
   top.append(el("h3",group?"Chỉnh sửa phiên chấm":"Tạo phiên chấm","text-lg font-black text-red-950"),btn("Đóng",()=>dialog.close(),true));
   pane.append(top);
   const general=panel("Thông tin phiên"),grid=el("div","","grid grid-cols-1 sm:grid-cols-2 gap-3");
   const term=sel();const termItems=semesters();if(casting&&!termItems.some(x=>x.id===casting.term))termItems.push({id:casting.term,name:casting.term});
   options(term,termItems,x=>x.name);term.value=casting?.term||"FA"+String(new Date().getFullYear()%100).padStart(2,"0");
   const name=input(group?"Tên phiên":"Phân ban");name.value=group?.name||"";
   const destination=sel();
   const syncDest=()=>{destination.replaceChildren(new Option("Tạo casting riêng",""));for(const v of allCastings.filter(x=>x.term===term.value&&!["published","archived"].includes(x.status)))destination.append(new Option(v.name,v.id))};
   term.onchange=syncDest;syncDest();
   const pass=input("0–10","number");pass.min="0";pass.max="10";pass.step=".01";pass.value=String(original?group.passScore:casting?.pass_score??group?.passScore??5);
   grid.append(field("Học kỳ",term),field(group?"Tên phiên":"Phân ban",name),field("Ngưỡng PASSED",pass));
   if(group){term.disabled=true}else grid.append(field("Lưu trong casting",destination));
   const mode=sel();mode.append(new Option("Mở thủ công","manual"),new Option("Mở tự động","auto"));mode.value=group?.openMode||"manual";
   const start=input("","datetime-local"),end=input("","datetime-local");start.value=localDate(group?.startTime);end.value=localDate(group?.endTime);
   const sessionAt=input("","datetime-local");sessionAt.required=true;
   if(group?.sessionAt){const when=new Date(group.sessionAt);if(Number.isFinite(when.getTime()))sessionAt.value=new Date(when.getTime()+7*3600000).toISOString().slice(0,16)}
   grid.append(field("Ngày giờ chấm (GMT+7) *",sessionAt));
   const blockAfter=input("","checkbox");blockAfter.checked=true;blockAfter.disabled=true;grid.append(field("Chặn BGK truy cập sau công bố",blockAfter));
   const attendance=input("","checkbox");attendance.className="h-4 w-4 accent-red-900";attendance.checked=group?.attendanceEnabled===true;attendance.disabled=Boolean(group&&group.verifiedCount>0);attendance.title="Khi bật lần đầu ở phiên chưa chấm, tất cả thí sinh mặc định vắng mặt. Sau khi đã có dữ liệu chấm không được đổi chế độ.";
   grid.append(field("Chế độ mở",mode),field("Giờ mở",start),field("Giờ khóa",end),field("Yêu cầu điểm danh",attendance));
   mode.onchange=()=>{start.disabled=mode.value!=="auto"};mode.onchange();
   general.append(grid);pane.append(general);
   const score=panel("Quy chế & tiêu chí"),method=sel();
   for(const [v,t] of [["mean","Trung bình BGK"],["weighted","Trọng số BGK"],["trimmed","Loại điểm cao nhất và thấp nhất (từ 3 BGK)"]])method.append(new Option(t,v));
   method.value=policy.method;
   const weights=el("div","","grid grid-cols-1 sm:grid-cols-2 gap-3");
   for(const g of (data.graders||[]).filter(g=>group&&(g.assignedGroups||[]).includes(group.id))){
    const w=input("1","number");w.min=".01";w.max="100";w.step=".01";w.dataset.code=g.code;w.value=String(policy.weights?.[g.code]??1);weights.append(field(g.name+" · "+g.code,w));
   }
   if(!weights.childElementCount)weights.append(el("p","Trọng số mặc định 1 cho BGK chưa được phân công.","text-xs text-gray-500"));
   method.onchange=()=>weights.hidden=method.value!=="weighted";method.onchange();
   score.append(field("Phương pháp tổng hợp",method),weights);
   const criteria=el("div","","space-y-2");
   function addCriterion(n="",w=""){
    const row=el("div","","flex gap-2 items-center"),name=input("Tên tiêu chí"),weight=input("Trọng số (%)","number");name.value=n;weight.value=String(w);weight.classList.add("max-w-[110px]");weight.min="0";weight.max="100";weight.step=".01";
    row.append(name,weight,btn("Xóa",()=>row.remove(),true));criteria.append(row);
   }
   (group?.criteria||[{name:"ĐÀI TỪ",weight:30},{name:"DIỄN XUẤT",weight:30},{name:"ỨNG BIẾN",weight:30},{name:"VẤN ĐÁP",weight:10}]).forEach(x=>addCriterion(x.name,x.weight));
   const extras=el("div","","space-y-2");
   function addExtra(n="",visible=true){
    const row=el("div","","flex items-center gap-2"),name=input("Tên trường phụ");name.value=n;
    const chk=input("","checkbox");chk.className="h-4 w-4 accent-red-900";chk.checked=visible;
    const label=el("label","BGK","flex items-center gap-1 text-xs whitespace-nowrap");label.prepend(chk);
    row.append(name,label,btn("Xóa",()=>row.remove(),true));extras.append(row);
   }
   (group?.extraFields||[]).forEach(x=>addExtra(x.name,x.showToGrader));
   score.append(el("h4","Tiêu chí · tổng 100%","font-bold text-xs text-red-900"),criteria,btn("+ Tiêu chí",()=>addCriterion(),true),el("h4","Trường thông tin phụ","font-bold text-xs text-red-900"),extras,btn("+ Trường phụ",()=>addExtra(),true));pane.append(score);
   const roles=panel("Casting theo vai diễn"),enable=input("","checkbox"),notes=input("","checkbox");
   enable.className=notes.className="h-4 w-4 accent-red-900";enable.checked=Boolean(policy.roles?.length);notes.checked=policy.notesEnabled===true;
   const roleFields=el("div","","space-y-3"),roleList=el("div","","space-y-2");
   function addRole(value=""){const row=el("div","","grid grid-cols-[minmax(0,1fr)_minmax(80px,110px)_auto] items-end gap-2");const name=input("Tên vai diễn");name.value=value;name.dataset.roleName="1";const cap=input("Số lượng","number");cap.min="1";cap.max="1000";cap.step="1";cap.value=String(group?.roleLimits?.capacity?.[value]??1);cap.dataset.capacity="1";row.append(field("Tên vai",name),field("Tối đa",cap),btn("Xóa",()=>row.remove(),true));roleList.append(row)}
   (policy.roles||[]).forEach(addRole);
   const reg=input("","number"),proposed=input("","number");reg.min=proposed.min="1";reg.max=proposed.max="40";reg.step=proposed.step="1";reg.value=String(policy.maxRegistered||1);proposed.value=String(policy.maxProposed||1);
   const official=input("","number");official.min="1";official.max="40";official.step="1";official.value=String(group?.roleLimits?.maxOfficialRoles??1);const limits=el("div","","grid grid-cols-1 sm:grid-cols-3 gap-3");limits.append(field("Số vai tối đa thí sinh đăng ký",reg),field("Số vai tối đa BGK tick",proposed),field("Số vai chính thức mỗi thí sinh",official));
   roleFields.append(roleList,btn("+ Thêm vai diễn",()=>addRole(),true),limits);
   enable.onchange=()=>{roleFields.hidden=!enable.checked;if(enable.checked&&!roleList.childElementCount)addRole()};enable.onchange();
   roles.append(field("Bật casting theo vai diễn",enable),roleFields,field("Cho phép BGK ghi chú",notes));pane.append(roles);

   const roster=panel("Phân công Ban Giám khảo","Khi lưu, hệ thống gửi ngay email cấp quyền cho BGK mới được phân công.");
   const rosterList=el("div","","space-y-2 max-h-[360px] overflow-auto");
   const picks=new Map(),historyLocked=!!group&&(group.verifiedCount>0||group.approvedCount>0);
   const currentCriteria=()=>[...criteria.children].map(r=>r.querySelector("input")?.value.trim()).filter(Boolean);
   function renderRoster(){
    rosterList.replaceChildren();const names=currentCriteria();
    for(const judge of (data.graders||[]).filter(j=>j.status==="Active"&&j.googleEnabled||group&&j.assignedGroups.includes(group.id))){
     if(!picks.has(judge.id)){
      const assigned=!!group&&judge.assignedGroups.includes(group.id);
      const grants=(data.criteriaGrants||[]).filter(g=>g.groupId===group?.id&&g.graderId===judge.id).map(g=>g.criterion);
      picks.set(judge.id,{selected:assigned,criteria:new Set(grants.length?grants:names),all:!grants.length});
     }
     const state=picks.get(judge.id),card=el("div","","border rounded-xl p-3 space-y-2"),check=input("","checkbox");check.checked=state.selected;check.disabled=historyLocked;check.className="w-4 h-4";
     const head=el("label","","flex gap-2 items-center font-bold text-sm");head.append(check,el("span",judge.name+" · "+judge.code));card.append(head,el("p",judge.email||"Chưa có email","text-xs text-gray-500 break-all"));
     const checks=el("div","","grid grid-cols-1 md:grid-cols-2 gap-1");checks.hidden=!state.selected;
     for(const name of names){const c=input("","checkbox");c.checked=state.all||state.criteria.has(name);c.disabled=historyLocked;c.className="w-4 h-4";const label=el("label","","flex gap-2 items-center text-xs");label.append(c,el("span",name));checks.append(label);c.onchange=()=>{if(state.all){state.all=false;state.criteria=new Set(names)}if(c.checked)state.criteria.add(name);else state.criteria.delete(name);};}
     check.onchange=()=>{state.selected=check.checked;checks.hidden=!state.selected;};card.append(checks);rosterList.append(card);
    }
   }
   const readRoster=()=>[...picks].filter(([_,s])=>s.selected).map(([graderId,s])=>({graderId,criteria:currentCriteria().filter(n=>s.all||s.criteria.has(n))}));
   renderRoster();
   const initialRoster=JSON.stringify(readRoster());
   criteria.addEventListener("change",renderRoster);
   roster.append(rosterList);
   if(historyLocked)roster.append(el("p","Phiên đã có lịch sử chấm hoặc duyệt. Hội đồng đã khóa.","text-xs text-amber-800"));
   async function saveRoster(groupId,judges){
    const result=await api("casting-session-assignments",{groupId,judges});
    if(!result.inviteJobs)return "Đã lưu phân công. Không có BGK mới cần gửi thư.";
    const waiting=result.mailPending?" · "+result.mailPending+" lời mời chờ xử lý":"";
    return "Đã lưu phân công. Resend tiếp nhận "+result.accepted+" lời mời mới"+waiting+".";
   }
   if(group){
    if(!historyLocked)roster.append(btn("Lưu phân công BGK",async()=>{
     if(JSON.stringify(currentCriteria())!==JSON.stringify((group.criteria||[]).map(c=>c.name)))throw Error("Hãy lưu phiên chấm để cập nhật tiêu chí cùng phân công.");
     const judges=readRoster();
     if(judges.some(j=>!j.criteria.length))throw Error("Chọn ít nhất một tiêu chí cho từng BGK.");
     window.showToast?.(await saveRoster(group.id,judges));dialog.close();await sessionSettings(host);
    },true));
    roster.append(btn("Thử gửi lại email cấp quyền đang chờ",async()=>{const r=await api("casting-session-invite-retry",{groupId:group.id});window.showToast?.("Đã xử lý "+r.processed+" lời mời, tiếp nhận "+r.accepted+".");},true));
   }
   pane.append(roster);
   const actions=el("div","","flex flex-wrap gap-2 justify-end border-t border-rose-100 pt-4");
   if(group)actions.append(btn("Hướng dẫn / câu hỏi chấm",()=>{dialog.close();window.openGroupContentModal?.(group.id)},true));
   actions.append(btn("Hủy",()=>dialog.close(),true),btn(group?"Lưu phiên chấm":"Tạo phiên chấm",async()=>{
    const passScore=Number(pass.value);
    if(!name.value.trim()||!pass.value.trim()||!Number.isFinite(passScore)||passScore<0||passScore>10)throw Error("Tên phiên hoặc ngưỡng điểm không hợp lệ.");
    const criteriaData=[...criteria.children].map(row=>{const [n,w]=row.querySelectorAll("input");return {name:n.value.trim(),weight:w.value.trim()?Number(w.value):NaN}});
    const extrasData=[...extras.children].map(row=>{const [n,v]=row.querySelectorAll("input");return {name:n.value.trim(),showToGrader:v.checked}});
    const graderWeights={...policy.weights};
    if(method.value==="weighted")weights.querySelectorAll("input[data-code]").forEach(w=>{graderWeights[w.dataset.code]=Number(w.value)});
    const roleNames=enable.checked?[...roleList.querySelectorAll("input[data-role-name]")].map(x=>x.value.trim()):[];
    if(enable.checked&&(!roleNames.length||roleNames.some(x=>!x)))throw Error("Cần nhập tên các vai diễn.");
    const cap=Object.fromEntries([...roleList.children].filter(()=>enable.checked).map(row=>[row.querySelector("[data-role-name]").value.trim().normalize("NFC"),Number(row.querySelector("[data-capacity]").value)]));const roleLimits={capacity:cap,maxOfficialRoles:enable.checked?Number(official.value):1};if(!Number.isInteger(roleLimits.maxOfficialRoles)||roleLimits.maxOfficialRoles<1||roleLimits.maxOfficialRoles>Math.max(1,roleNames.length)||Object.values(cap).some(x=>!Number.isInteger(x)||x<1||x>1000))throw Error("Kiểm tra số vai chính thức và số lượng tối đa từng vai.");
    const sessionPolicy={method:method.value,weights:graderWeights,roles:roleNames,maxRegistered:enable.checked?Number(reg.value):0,maxProposed:enable.checked?Number(proposed.value):0,notesEnabled:notes.checked};
    // Do not silently alter a legacy policy while editing unrelated settings.
    const unchangedLegacy=group&&!original&&!enable.checked&&!notes.checked&&method.value===(casting?.aggregate_method||"mean")&&passScore===Number(casting?.pass_score??group.passScore)&&JSON.stringify(graderWeights)===JSON.stringify(policy.weights||{});
    if(!sessionAt.value||!sessionAt.checkValidity())throw Error("Hãy nhập ngày giờ chấm (GMT+7).");
    const body={sessionAt:new Date(sessionAt.value+"+07:00").toISOString(),passScore,criteria:criteriaData,extraFields:extrasData,openMode:mode.value,startAt:mode.value==="auto"&&start.value?new Date(start.value).toISOString():null,endAt:end.value?new Date(end.value).toISOString():null,attendanceEnabled:attendance.checked,blockGraderAfterPublish:blockAfter.checked,...(unchangedLegacy?{}:{sessionPolicy,roleLimits})};
    const judges=readRoster();
    const saveAssignments=group?!historyLocked&&JSON.stringify(judges)!==initialRoster:judges.length>0;
    if(saveAssignments&&judges.some(j=>!j.criteria.length))throw Error("Chọn ít nhất một tiêu chí cho từng BGK.");
    let saved;
    if(group){
     const changes=JSON.stringify(criteriaData)!==JSON.stringify(group.criteria||[])||passScore!==Number(group.passScore)||(!unchangedLegacy&&JSON.stringify(sessionPolicy)!==JSON.stringify(original))||(!unchangedLegacy&&JSON.stringify(roleLimits)!==JSON.stringify(group.roleLimits));
     const confirmRevision=changes&&(group.verifiedCount>0||group.approvedCount>0||group.judgeCount>0);
     if(confirmRevision&&!window.confirm("Thay đổi quy chế điểm có thể tạo phiên bản mới, thu hồi biên bản cũ, chuyển kết quả về chờ đối soát và yêu cầu BGK xác nhận OTP lại. Điểm gốc được lưu lịch sử. Tiếp tục?"))return;
     saved=await api("casting-update-session",{...body,groupId:group.id,version:group.version,name:name.value.trim(),confirmRevision});
    }else{
     saved=await api("casting-create-session",{...body,term:term.value,division:name.value.trim(),castingId:destination.value||undefined});
    }
    let message=saved.version?"Đã lưu phiên bản "+saved.version+".":"Đã lưu phiên chấm.";
    if(saveAssignments){
     try{message+=" "+await saveRoster(group?.id||saved.group.id,judges);}
     catch(e){dialog.close();await window.loadGroupsManager(host);throw Error(message+" Phân công hoặc email cần kiểm tra: "+e.message);}
    }
    dialog.close();window.showToast?.(message);await window.loadGroupsManager(host);
   }));
   pane.append(actions);dialog.append(pane);dialog.showModal();
  }
  for(const g of groups){
   const casting=allCastings.find(c=>c.id===g.castingId),card=panel(g.name),status=stateFor(g),review=g.publicationAt?(Date.parse(g.publicationAt)>Date.now()?"publication-scheduled":"published"):casting?.status==="published"||casting?.status==="archived"?casting.status:(g.eligibleCount>0&&g.approvedCount===g.eligibleCount?"approved":g.approvedCount>0?"review":casting?.status==="review"?"review":"draft"),locked=["published","archived","publication-scheduled"].includes(review);card.dataset.status=status;card.dataset.review=review;card.dataset.search=(g.name+" "+(casting?.term||"")).toLocaleLowerCase("vi");const badges=el("div","","flex flex-wrap gap-2");badges.append(el("span",statusNames[status],"inline-block rounded-full px-3 py-1 font-bold text-xs "+accessColor[status]),el("span","Kết quả: "+(statusNames[review]||review),"inline-block rounded-full bg-rose-50 text-red-900 px-3 py-1 font-bold text-xs"));if(g.judgeCount>0&&g.verifiedCount===g.judgeCount)badges.append(el("span","Đã nộp toàn bộ","inline-block rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 font-bold text-xs"));card.append(badges);if(g.sessionAt)card.append(el("p","Ngày chấm: "+new Date(g.sessionAt).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"}),"text-xs text-gray-600"));if(g.publicationAt)card.append(el("p","Giờ công bố: "+new Date(g.publicationAt).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"}),"text-xs text-gray-600"));if(g.configVersion)card.append(el("p","Phiên bản quy chế điểm: "+g.configVersion,"text-xs font-bold text-red-900"));if(g.controlReason)card.append(el("p",g.controlReason,"text-xs text-gray-500 leading-relaxed"));
   const info=el("div","","flex flex-wrap items-center gap-2 text-xs text-gray-600");
   info.append(el("span",casting?.term||"Chưa gắn casting","rounded-lg bg-rose-50 px-2 py-1 font-bold text-red-900"),el("span",(g.criteria||[]).length+" tiêu chí"),el("span",g.sessionPolicy?.roles?.length?g.sessionPolicy.roles.length+" vai diễn":"Casting thông thường"));
   const actions=el("div","","flex flex-wrap gap-2");
   if(!locked)actions.append(btn("Chỉnh sửa",()=>openEditor(g),true));if(!["published","archived"].includes(review))actions.append(btn("Sao chép link BGK",()=>copy(groupLink(g.id)),true));
   if(g.openMode!=="auto"&&status!=="unknown"&&!["published","archived","publication-scheduled"].includes(review)){
    const open=status==="open";
    if(open||g.canOpen===true){
     const toggle=btn(open?"Đóng chấm":"Mở chấm",async()=>{await api("casting-session-control",{operation:open?"close":"open",groupId:g.id,version:g.version,confirm:true});window.showToast?.(open?"Đã đóng phiên chấm.":"Đã mở phiên chấm.");await sessionSettings(host)},true);
     toggle.classList.add(open?"text-amber-800":"text-emerald-800");actions.append(toggle);
    }
   }
   if(g.canDelete===true){const del=btn("Xóa phiên",()=>openDelete(g,["published","archived"].includes(review)),true);del.classList.add("text-red-700","border-red-300");actions.append(del)}
   
   if(!casting&&allCastings.length){const target=sel();target.append(new Option("Chọn casting",""));for(const x of allCastings.filter(x=>!["published","archived"].includes(x.status)))target.append(new Option(x.term+" · "+x.name,x.id));card.append(field("Gắn casting",target),btn("Gắn",async()=>{if(!target.value)throw Error("Chọn casting.");await api("casting-assign-group",{castingId:target.value,groupId:g.id});await window.loadGroupsManager(host)},true))}
   const counts=el("div","","grid grid-cols-2 sm:grid-cols-4 gap-2");for(const [name,num] of [["Thí sinh",g.candidateCount],["BGK",g.judgeCount],["Đã nộp",g.verifiedCount],["Đã duyệt",g.approvedCount+"/"+g.eligibleCount]])counts.append(el("div",name+" · "+(num??"—"),"rounded-lg bg-gray-50 p-2 text-xs font-bold"));card.append(info,counts,actions);list.append(card);
  }
  if(!groups.length)list.append(el("p","Chưa có phiên chấm.","text-xs text-gray-500"));
  host.replaceChildren(root);
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
  if(host)try{await sessionSettings(host)}catch(e){window.showToast?.("Không tải được thiết lập phiên chấm: "+e.message,"error")}
 };
 // Standalone account directory: never edits group assignments or sends invitation mail.
 window.loadAccountManager=async function(host){
  let data;try{data=await api("casting-account-list")}catch(e){if(!/không (được |)hỗ trợ|không được cho phép|không hợp lệ/i.test(e.message))throw e;data=await api("casting-list")}
  if(!host?.isConnected)return;
  const root=el("section","","space-y-4 pb-8"),top=el("div","","flex flex-wrap justify-between items-center gap-3");
  const dialog=el("dialog","","rounded-2xl border border-rose-100 bg-white p-0 shadow-2xl");dialog.style.cssText="width:min(600px,94vw);max-height:90vh;overflow:auto;margin:auto";
  const search=input("Tìm tên, mã BGK hoặc email"),list=el("div","","overflow-x-auto bg-white border border-rose-100 rounded-2xl");
  function edit(j){
   const form=el("div","","p-6 space-y-4"),name=input("Họ và tên"),code=input("Mã BGK"),email=input("Email Google","email");
   name.value=j?.name||"";code.value=j?.code||"";code.disabled=!!j;email.value=j?.email||"";email.disabled=j?.emailLocked===true;
   form.append(el("h3",j?"Chỉnh sửa tài khoản BGK":"Tạo tài khoản BGK","text-lg font-black text-red-950"),field("Họ tên",name),field("Mã BGK",code),field("Email Google",email),el("p",j?.emailLocked?"Email đã khóa sau xác nhận OTP.":"Tạo tài khoản không gửi email. Chỉ phân công và gửi lời mời ở Chỉnh sửa phiên.","text-xs text-gray-500"));
   const actions=el("div","","flex gap-2 justify-end");actions.append(btn("Đóng",()=>dialog.close(),true),btn("Lưu tài khoản",async()=>{
    if(name.value.trim().length<2||!email.value.trim()||!email.checkValidity())throw Error("Nhập họ tên và email Google hợp lệ.");
    if(!j){await api("create-grader",{name:name.value.trim(),code:code.value.trim(),googleEmail:email.value.trim()});}
    else{const details={graderId:j.id,name:name.value.trim(),...(email.disabled?{}:{googleEmail:email.value.trim()})};try{await api("update-grader",details)}catch(e){if(!String(e.message).includes("liên kết")||!window.confirm("Thu hồi liên kết Google cũ và cấp email mới?"))throw e;await api("update-grader",{...details,revokeGoogleLink:true})}}
    dialog.close();window.showToast?.(j?"Đã lưu tài khoản BGK.":"Đã tạo tài khoản, chưa gửi email.");await window.loadAccountManager(host);
   }));form.append(actions);dialog.replaceChildren(form);dialog.showModal();
  }
  top.append(el("h2","Quản lý Ban Giám khảo","text-xl font-black text-red-950"),btn("+ Tạo tài khoản",()=>edit(null)),btn("Làm mới",()=>window.loadAccountManager(host),true));
  const table=el("table","","w-full min-w-[740px] text-sm text-left"),thead=el("thead","","bg-rose-50 text-red-950"),tr=el("tr");for(const label of ["Họ tên / Mã BGK","Email Google","Phiên đã phân công","Trạng thái","Thao tác"])tr.append(el("th",label,"p-3 font-bold"));thead.append(tr);const tbody=el("tbody","","divide-y divide-rose-50");table.append(thead,tbody);list.append(table);
  function draw(){tbody.replaceChildren();const q=search.value.trim().toLocaleLowerCase("vi");for(const j of data.graders||[]){if(q&&!(j.name+" "+j.code+" "+j.email).toLocaleLowerCase("vi").includes(q))continue;const row=el("tr","","hover:bg-rose-50/50"),n=el("td","","p-3");n.append(el("strong",j.name),el("p",j.code,"font-mono text-xs text-gray-500"));row.append(n,el("td",j.email||"—","p-3 break-all"),el("td",(data.groups||[]).filter(g=>j.assignedGroups.includes(g.id)).map(g=>g.name).join(", ")||"Chưa phân công","p-3 text-xs"),el("td",j.archived?"Đã lưu trữ":j.status==="Active"?"Hoạt động":"Đã khóa","p-3 font-bold text-xs"));
    const action=el("td","","p-3 flex flex-wrap gap-1");if(!j.archived){action.append(btn("Sửa",()=>edit(j),true),btn(j.status==="Active"?"Khóa":"Mở",async()=>{if(!window.confirm("Thay đổi trạng thái tài khoản BGK?"))return;await api("lock-grader",{graderId:j.id,active:j.status!=="Active"});await window.loadAccountManager(host)},true),btn("Xóa / lưu trữ",async()=>{if(!window.confirm("Xóa BGK chưa có lịch sử hoặc lưu trữ nếu đã có dữ liệu?"))return;await api("delete-grader",{graderId:j.id,archiveIfProtected:true});await window.loadAccountManager(host)},true));}row.append(action);tbody.append(row);}}
  search.oninput=draw;draw();root.append(top,el("p","Danh bạ tài khoản Google. Vào Phiên chấm → Chỉnh sửa để phân công nhóm, tiêu chí và lịch gửi email.","text-xs text-gray-500"),search,list,dialog);host.replaceChildren(root);
 };
}
