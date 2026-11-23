/* OSC GrandeSync casting hub. All writes pass the already authenticated OSC bridge. */
(()=>{
"use strict";
const api=(action,details={})=>window.oscGradingCall(action,details);
const el=(tag,cls="",text="")=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e};
const field=(kind,placeholder)=>{const x=el(kind,"border rounded-lg p-2 text-xs w-full");if(placeholder)x.placeholder=placeholder;return x};
const button=(label,fn)=>{const b=el("button","bg-red-900 hover:bg-red-800 text-white rounded-lg px-3 py-2 text-xs font-bold",label);b.type="button";b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await fn()}catch(e){toast(e.message,true)}finally{b.disabled=false}};return b};
let current="",castings=[],status,castingSelect,table,result;
function toast(t,error=false){if(status){status.textContent=t;status.style.color=error?"#b91c1c":"#166534"}}
function choose(select,items,label){select.replaceChildren(...items.map(x=>{const o=el("option","",label(x));o.value=x.id;return o}))}
function panel(title){const x=el("section","bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3");x.append(el("h3","font-extrabold text-sm text-red-900",title));return x}
async function action(name,body,ok){const r=await api(name,body);toast(ok||"Đã lưu.");return r}
function formRow(label,element){const x=el("label","block text-xs font-bold text-gray-700");x.append(el("span","block mb-1",label),element);return x}
async function reload(){
 castings=(await api("casting-list")).castings||[];
 choose(castingSelect,castings,c=>c.term+" · "+c.name);
 if(!castings.some(c=>c.id===current))current=castings[0]?.id||"";
 castingSelect.value=current;
}
async function showResults(){
 if(!current){toast("Chưa chọn casting.",true);return}
 const castingId=current,view=table;
 const response=await api("casting-results",{castingId});
 if(castingId!==current||table!==view||!view.isConnected)return;
 result=response;
 const wrap=el("div","overflow-x-auto border rounded-xl"),t=el("table","w-full min-w-[760px] text-xs border-collapse");
 const head=el("thead","bg-gray-100 text-gray-600"),hr=document.createElement("tr");
 for(const h of ["Chọn","MSSV / SBD","Thí sinh","Nhóm thi","Điểm HĐ","BGK","Đối soát","Kết quả","Duyệt"]){hr.append(el("th","p-3 text-left",h))}
 head.append(hr);t.append(head);const body=document.createElement("tbody");
 for(const r of result.rows||[]){
  const tr=el("tr","border-t"),td=document.createElement("td"),checkbox=document.createElement("input");
  checkbox.type="checkbox";checkbox.value=r.id;checkbox.className="cast-chosen";checkbox.disabled=r.outcome==="pending"||r.incomplete;
  td.className="p-3";td.append(checkbox);tr.append(td);
  for(const item of [r.mssv||r.code,r.name,r.groupName,r.score==null?"—":Number(r.score).toFixed(2),
    r.judges+"/"+r.expectedJudges,(r.anomalies||[]).join("; ")||(r.incomplete?"Chưa hoàn tất":"Đủ điểm"),r.incomplete?"CHỜ":r.outcome.toUpperCase(),r.review])tr.append(el("td","p-3",String(item||"")));
  body.append(tr);
 }
 t.append(body);wrap.append(t);table.replaceChildren(wrap);
 toast("Đã đối soát "+(result.rows||[]).length+" thí sinh. Chỉ điểm BGK đã khóa/nộp được tính.");
}
async function loadCastingHub(parent){
 const root=el("div","space-y-4 pb-8");
 status=el("p","text-xs font-semibold");status.setAttribute("role","status");root.append(status);
 castingSelect=field("select");castingSelect.onchange=()=>{
  current=castingSelect.value;result=null;table.textContent="Bấm Tải bảng điểm để kiểm tra.";
 };
 root.append(formRow("Chọn casting",castingSelect));
 const review=panel("Đối soát điểm & duyệt PASSED / FAILED");
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
 const publication=panel("Công bố kết quả tra cứu"),publishAt=field("input");publishAt.type="datetime-local";
 const showScore=field("input");showScore.type="checkbox";showScore.className="w-4 h-4 mr-2";
 publication.append(formRow("Thời điểm công bố (giờ địa phương)",publishAt));
 const scoreToggle=el("label","flex items-center text-xs font-semibold mt-2");scoreToggle.append(showScore,document.createTextNode("Cho thí sinh xem điểm tổng (mặc định chỉ xem PASSED / FAILED)"));publication.append(scoreToggle);
 publication.append(el("p","text-xs text-gray-500 mt-2 mb-2","Kết quả chỉ trả khi thí sinh tự tra cứu đúng MSSV/SBD và email đã khai báo; không hiển thị danh sách công khai."));
 publication.append(button("Lên lịch công bố",async()=>{
  if(!current)throw Error("Chưa chọn casting.");
  if(!window.confirm("Xác nhận lịch công bố kết quả?"))return;
  await action("casting-publish",{castingId:current,publishAt:publishAt.value?new Date(publishAt.value).toISOString():null,publicFields:showScore.checked?["outcome","score"]:["outcome"]});
  await reload();
 }));
 root.append(publication);parent.replaceChildren(root);
 result=null;
 try{await reload()}catch(e){toast(e.message,true)}
}
async function loadCastingEmail(parent){
 const root=panel("Thông báo casting");
 const data=await api("casting-list");
 const picker=field("select"),kind=field("select");
 const types={invite:"Mời BGK",reminder:"Nhắc chấm",submission:"Xác nhận",publication:"Công bố kết quả"};
 const states={queued:"Chờ gửi",sent:"Đã gửi",failed:"Gửi lỗi"};
 choose(picker,data.castings||[],c=>c.term+" · "+c.name);
 choose(kind,Object.entries(types).map(([id,label])=>({id,label})),x=>x.label);
 const message=el("p","text-xs text-gray-600");message.setAttribute("role","status");
 const list=el("div","space-y-2");
 const pagination=el("div","flex items-center gap-2");
 let offset=0,request=0;
 const perform=(label,run)=>{
  const control=button(label,async()=>{
   try{await run()}catch(error){message.textContent=error.message}
  });
  return control;
 };
 async function history(){
  const version=++request,castingId=picker.value;
  if(!castingId){list.textContent="Chưa có casting.";return}
  const data=await api("casting-notice-history",{castingId,offset});
  if(version!==request)return;
  list.replaceChildren();
  for(const row of data.rows){
   const box=el("div","flex flex-wrap items-center justify-between gap-2 border-b py-2 text-xs");
   const when=new Date(row.sent_at||row.created_at).toLocaleString("vi-VN");
   box.append(el("span","break-all",[row.recipient_email,types[row.event_type],states[row.status],when].join(" · ")));
   if(row.status!=="queued")box.append(perform("Xếp hàng gửi lại",async()=>{
    if(!window.confirm("Xếp hàng gửi lại thông báo tới "+row.recipient_email+"?"))return;
    await api("casting-notice-retry",{castingId,noticeId:row.id});
    message.textContent="Đã xếp hàng gửi lại.";offset=0;await history();
   }));
   list.append(box);
  }
  if(!data.rows.length)list.textContent="Chưa có thông báo trên trang này.";
  pagination.replaceChildren();
  if(offset>0)pagination.append(perform("Trang trước",async()=>{offset-=50;await history()}));
  if(data.hasMore)pagination.append(perform("Trang sau",async()=>{offset+=50;await history()}));
 }
 picker.onchange=()=>{
  offset=0;list.replaceChildren();pagination.replaceChildren();message.textContent="";
  history().catch(error=>message.textContent=error.message);
 };
 const controls=el("div","flex flex-wrap gap-2");
 controls.append(perform("Xếp hàng email",async()=>{
  if(!picker.value)throw Error("Chưa chọn casting.");
  const response=await api("casting-notification-queue",{castingId:picker.value,kind:kind.value,allEligible:true});
  message.textContent=response.queued?"Đã xếp "+response.queued+" email vào hàng đợi.":"Không có người nhận mới đủ điều kiện.";
  offset=0;await history();
 }),perform("Gửi email trong hàng đợi",async()=>{
  if(!picker.value)throw Error("Chưa chọn casting.");
  if(!window.confirm("Gửi tối đa 20 thông báo đang chờ cho casting này?"))return;
  const response=await api("casting-send-notifications",{castingId:picker.value});
  message.textContent=response.reconciled===false?
   "Resend đã tiếp nhận. Trạng thái hàng đợi đang chờ đối soát.":response.message;
  offset=0;await history();
 }),perform("Tải lại lịch sử",history));
 root.append(formRow("Casting",picker),formRow("Loại thông báo",kind),controls,message,
  el("h4","font-bold text-sm text-red-900","Hàng đợi và lịch sử gửi"),list,pagination);
 parent.replaceChildren(root);await history();
}
window.loadCastingHub=loadCastingHub;
window.loadCastingEmail=loadCastingEmail;
})();
