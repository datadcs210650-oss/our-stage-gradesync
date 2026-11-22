/* OSC GrandeSync casting hub. All writes pass the already authenticated OSC bridge. */
(()=>{
"use strict";
const api=(action,details={})=>window.oscGradingCall(action,details);
const el=(tag,cls="",text="")=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e};
const field=(kind,placeholder)=>{const x=el(kind,"border rounded-lg p-2 text-xs w-full");if(placeholder)x.placeholder=placeholder;return x};
const button=(label,fn)=>{const b=el("button","bg-red-900 hover:bg-red-800 text-white rounded-lg px-3 py-2 text-xs font-bold",label);b.type="button";b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await fn()}catch(e){toast(e.message,true)}finally{b.disabled=false}};return b};
let host,current="",all={},result=null,status;
function toast(t,error=false){if(status){status.textContent=t;status.style.color=error?"#b91c1c":"#166534"}}
function choose(select,items,label){select.replaceChildren(...items.map(x=>{const o=el("option","",label(x));o.value=x.id;return o}))}
function panel(title){const x=el("section","bg-white border border-gray-200 rounded-2xl p-4 shadow-sm"),h=el("h3","font-extrabold text-sm text-red-900 mb-3",title);x.append(h);return x}
function stack(){return el("div","grid grid-cols-1 md:grid-cols-2 gap-3")}
function summary(){return (all.castings||[]).find(x=>x.id===current)}
async function action(name,body,ok){const r=await api(name,body);toast(ok||"Đã lưu.");return r}
function formRow(label,element){const x=el("label","block text-xs font-bold text-gray-700");x.append(el("span","block mb-1",label),element);return x}
async function reload(){
 all=await api("casting-list");
 choose(castingSelect,all.castings||[],c=>c.term+" · "+c.name+" ("+c.status+")");
 if(!(all.castings||[]).some(c=>c.id===current))current=all.castings?.[0]?.id||"";
 castingSelect.value=current;
 choose(groupSelect,all.groups||[],g=>g.name+(g.castingId?" · đã gắn":""));
 choose(graderSelect,all.graders||[],g=>g.name+" · "+g.code+(g.email?" · "+g.email:""));
 choose(criterionGroup,all.groups||[],g=>g.name);
 showCriteria();
 title.textContent=summary()?summary().term+" • "+summary().name:"Chưa có casting. Hãy tạo casting mới.";
}
let castingSelect,groupSelect,graderSelect,criterionGroup,criteriaList,title,table;
function showCriteria(){
 const g=all.groups?.find(x=>x.id===criterionGroup.value);criteriaList.replaceChildren();
 for(const c of g?.criteria||[]){
  const lab=el("label","flex items-center gap-2 bg-gray-50 rounded-lg p-2 text-xs");
  const chk=document.createElement("input");chk.type="checkbox";chk.checked=true;chk.value=c.name;chk.className="cast-criteria";
  lab.append(chk,document.createTextNode(c.name+" · "+c.weight+"%"));criteriaList.append(lab);
 }
}
async function showResults(){
 if(!current){toast("Chưa chọn casting.",true);return}
 result=await api("casting-results",{castingId:current});
 const wrap=el("div","overflow-x-auto border rounded-xl"),t=el("table","w-full min-w-[760px] text-xs border-collapse");
 const head=el("thead","bg-gray-100 text-gray-600"),hr=document.createElement("tr");
 for(const h of ["Chọn","MSSV / SBD","Thí sinh","Nhóm thi","Điểm HĐ","BGK","Kết quả","Duyệt"]){hr.append(el("th","p-3 text-left",h))}
 head.append(hr);t.append(head);const body=document.createElement("tbody");
 for(const r of result.rows||[]){
  const tr=el("tr","border-t"),td=document.createElement("td"),checkbox=document.createElement("input");
  checkbox.type="checkbox";checkbox.value=r.id;checkbox.className="cast-chosen";checkbox.disabled=r.outcome==="pending"||r.incomplete;
  td.className="p-3";td.append(checkbox);tr.append(td);
  for(const item of [r.mssv||r.code,r.name,r.groupName,r.score==null?"—":Number(r.score).toFixed(2),
    r.judges+"/"+r.expectedJudges,r.incomplete?"Thiếu điểm":r.outcome.toUpperCase(),r.review])tr.append(el("td","p-3",String(item||"")));
  body.append(tr);
 }
 t.append(body);wrap.append(t);table.replaceChildren(wrap);
 toast("Đã đối soát "+(result.rows||[]).length+" thí sinh. Chỉ điểm BGK đã khóa/nộp được tính.");
}
let year=new Date().getFullYear()%100;
function setTermOptions(select){for(const y of [year,year+1])for(const prefix of ["SP","SU","FA"]){const val=prefix+String(y).padStart(2,"0");const option=el("option","",val);option.value=val;select.append(option)}}
async function loadCastingHub(parent){
 host=parent;host.replaceChildren();const root=el("div","space-y-4 pb-8");
 root.append(el("h2","text-xl font-black text-red-900","Quản lý casting theo học kỳ"));
 root.append(el("p","text-xs text-gray-500","Casting FA/SU/SP • Google BGK • Đối soát điểm • Duyệt kết quả • Công bố theo lịch"));
 status=el("p","text-xs font-semibold");status.setAttribute("role","status");root.append(status);
 castingSelect=field("select");castingSelect.id="gsxCastingSelect";castingSelect.onchange=()=>{current=castingSelect.value;title.textContent=summary()?.name||"";result=null;table.replaceChildren()};
 root.append(formRow("Chọn casting",castingSelect));
 const setup=stack(),create=panel("Tạo casting mới"),cgrid=stack(),term=field("select"),name=field("input","Tên casting"),
 method=field("select"),pass=field("input");setTermOptions(term);
 for(const [v,t] of [["mean","Trung bình"],["weighted","Trọng số BGK"],["trimmed","Bỏ điểm cao nhất & thấp nhất (≥3 BGK)"]]){const op=el("option","",t);op.value=v;method.append(op)}
 pass.type="number";pass.min="0";pass.max="10";pass.step=".1";pass.value="5";
 cgrid.append(formRow("Học kỳ",term),formRow("Tên casting",name),formRow("Phương pháp",method),formRow("Điểm đạt (0–10)",pass));
 create.append(cgrid,button("Tạo casting",async()=>{const r=await action("casting-save",{term:term.value,name:name.value,method:method.value,passScore:Number(pass.value)});current=r.casting.id;await reload()}));
 setup.append(create);
 const grants=panel("Đăng nhập Google & quyền BGK");graderSelect=field("select");const email=field("input","Email Google đã được cấp");email.type="email";
 grants.append(formRow("Giám khảo",graderSelect),formRow("Email Google",email),button("Cấp quyền Google",async()=>{await action("casting-grant-google",{graderId:graderSelect.value,email:email.value,enabled:true});await reload()}));
 criterionGroup=field("select");criterionGroup.onchange=showCriteria;criteriaList=el("div","grid grid-cols-2 gap-2 mt-2 mb-2");
 grants.append(formRow("Nhóm chấm",criterionGroup),criteriaList,button("Lưu quyền tiêu chí",async()=>{
  await action("casting-grant-criteria",{graderId:graderSelect.value,groupId:criterionGroup.value,
  criteria:[...criteriaList.querySelectorAll("input:checked")].map(e=>e.value)});
 }));
 setup.append(grants);root.append(setup);
 const details=panel("Thông tin casting & thí sinh"),inside=stack();title=el("p","text-xs font-bold mb-2");details.append(title);
 groupSelect=field("select");
 const groupArea=el("div");groupArea.append(formRow("Nhóm thi",groupSelect),
  button("Gắn nhóm vào casting",async()=>{await action("casting-assign-group",{castingId:current,groupId:groupSelect.value});await reload()}));
 inside.append(groupArea);
 const cf=el("div"),key=field("input","Mã trường, ví dụ phone"),label=field("input","Tên trường"),kind=field("select"),visibility=field("select");
 for(const t of ["text","email","number","date","select"]){const o=el("option","",t);o.value=t;kind.append(o)}
 for(const [v,t] of [["admin","Chỉ BCN"],["judge","BGK được xem"],["public","Công khai nếu được duyệt"]]){const o=el("option","",t);o.value=v;visibility.append(o)}
 const fg=stack();fg.append(key,label,kind,visibility);cf.append(formRow("Trường tùy chỉnh",fg),
  button("Lưu cấu hình trường",async()=>{await action("casting-field",{castingId:current,key:key.value,label:label.value,kind:kind.value,visibility:visibility.value})}));
 inside.append(cf);details.append(inside);root.append(details);
 const review=panel("Đối soát điểm & duyệt PASSED");
 table=el("div","text-xs text-gray-500");table.textContent="Bấm Tải bảng điểm để kiểm tra.";
 review.append(button("Tải bảng điểm",showResults),table);
 const actions=el("div","flex flex-wrap gap-2 mt-3");
 actions.append(button("Duyệt kết quả đã chọn",async()=>{
  const ids=[...table.querySelectorAll(".cast-chosen:checked")].slice(0,40).map(x=>x.value);
  if(!ids.length)throw Error("Chưa chọn thí sinh đủ điều kiện.");
  await action("casting-review",{castingId:current,decisions:ids.map(candidateId=>({candidateId,review:"approved"}))});
  await showResults();
 }),button("Kiểm tra đồng bộ OSC",async()=>{
  const res=await action("casting-sync-payload",{castingId:current});
  toast("Đã đối chiếu "+res.candidates.length+" hồ sơ học kỳ "+res.term+". Chưa ghi vào OSC khi chưa xác nhận.");
 }),button("Đồng bộ vào OSC",async()=>{
  if(!current)throw Error("Chưa chọn casting.");
  if(!window.confirm("Xác nhận đồng bộ các thí sinh PASSED đã được BCN duyệt vào danh sách diễn viên học kỳ?"))return;
  const response=await api("sync-approved-members",{castingId:current});
  toast(response.pendingReconcile?"Đã lưu vào OSC, cần đối soát trạng thái GrandeSync.":"Đã đồng bộ "+response.synced+" thành viên vào OSC.");
  await showResults();
 }),button("Xuất CSV",()=>{
  if(!result)throw Error("Chưa tải kết quả.");const rows=[["SBD","MSSV","Tên","Điểm","Kết quả","Duyệt"],...result.rows.map(r=>[r.code,r.mssv,r.name,r.score,r.outcome,r.review])];
  const csv="\uFEFF"+rows.map(row=>row.map(v=>{let s=String(v??"");if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="OSC_Casting_DoiSoat.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }));review.append(actions);root.append(review);
 const publication=panel("Công bố & thông báo"),publishAt=field("input");publishAt.type="datetime-local";
 publication.append(formRow("Thời điểm công bố (giờ địa phương)",publishAt));
 publication.append(el("p","text-xs text-gray-500 mt-2 mb-2","Kết quả chỉ trả khi thí sinh tự tra cứu đúng MSSV/SBD và email đã khai báo; không hiển thị danh sách công khai."));
 const mail=field("select");for(const [v,t] of [["invite","Mời BGK"],["reminder","Nhắc chấm"],["submission","Xác nhận"],["publication","Công bố"]]){const o=el("option","",t);o.value=v;mail.append(o)}
 publication.append(mail,button("Lên lịch công bố",async()=>{if(!window.confirm("Xác nhận lịch công bố kết quả?"))return;await action("casting-publish",{castingId:current,publishAt:publishAt.value?new Date(publishAt.value).toISOString():null});await reload()}),
 button("Xếp hàng email",async()=>{
  let addresses;
  if(mail.value==="publication"){
   const rows=(await api("casting-results",{castingId:current})).rows||[];
   addresses=rows.filter(x=>x.outcome!=="pending"&&x.review==="approved"&&x.fields?.castingEmailConsent===true)
    .map(x=>x.email).filter(Boolean);
  }else addresses=(all.graders||[]).map(g=>g.email).filter(Boolean);
  if(!addresses.length)throw Error("Không có địa chỉ email đủ quyền/đồng ý nhận thư.");
  const r=await action("casting-notification-queue",{castingId:current,kind:mail.value,emails:addresses});
  toast("Đã xếp "+r.queued+" email vào hàng chờ. Chưa gửi mail.");
 }),button("Gửi email đã xếp hàng",async()=>{
  if(!current)throw Error("Chưa chọn casting.");
  if(!window.confirm("Gửi tối đa 20 thông báo casting đã xếp hàng qua Resend?"))return;
  const r=await api("casting-send-notifications",{castingId:current});
  toast(r.message||"Đã gửi yêu cầu thông báo.");
 }));
 root.append(publication);host.append(root);
 try{await reload()}catch(e){toast(e.message,true)}
}
window.loadCastingHub=loadCastingHub;
})();
