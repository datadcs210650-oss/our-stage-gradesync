/* BGK Google and legacy login: mandatory email OTP before confirmed score locks. */
(()=>{
"use strict";
const sb=window.supabase;
const grader=()=>window.currentUserData?.role==="Grader"&&window.auth?.currentUser?.isAnonymous===true;
const notify=(text,isError=false)=>window.showToast?.(text,isError?"error":"success");
function node(tag,text,cls){const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e}
async function api(action,groupId,extras={}){
 const session=(await sb.auth.getSession()).data.session;
 if(!session?.access_token)throw Error("Phiên Google đã hết hạn. Hãy đăng nhập lại.");
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
 try{
  const res=await fetch("/api/grader-confirm",{method:"POST",cache:"no-store",signal:controller.signal,
   headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},
   body:JSON.stringify({action,groupId,...extras})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.ok)throw Error(data.error||"Không thể xác thực bảng điểm.");
  return data;
 }finally{clearTimeout(timer)}
}
async function flushPending(groupId){
 if(navigator.onLine===false)throw Error("Không thể khóa bảng điểm khi mất mạng.");
 const pending=window._scoreSavePending||{},keys=Object.keys(pending).filter(id=>pending[id]?.gId===groupId);
 for(const id of keys){
  clearTimeout(window._scoreSaveTimers?.[id]);
  const saved=await window.saveScoreNow(id,groupId,pending[id].pS);
  if(saved===false)throw Error("Có điểm chưa lưu lên máy chủ. Hãy kiểm tra bảng điểm trước khi xác nhận.");
 }
}
function close(){window.closeCustomModal?.()}
function buildPrint(receipt){
 const root=node("div");root.style.cssText="padding:24px;background:white;color:#171717;font:13px/1.5 Arial,sans-serif";
 const h=node("h2","BIÊN BẢN XÁC NHẬN BẢNG ĐIỂM");h.style.textAlign="center";root.append(h);
 for(const line of [
  "Phiên chấm: "+receipt.groupName,
  "Giám khảo: "+receipt.graderName+" ("+receipt.email+")",
  "Xác nhận qua OTP email lúc: "+new Date(receipt.confirmedAt).toLocaleString("vi-VN"),
  "SHA-256 bản chốt: "+receipt.sha256
 ]){root.append(node("p",line))}
 const t=node("table");t.style.cssText="border-collapse:collapse;width:100%;margin-top:18px";
 const header=node("tr");for(const item of ["SBD","Thí sinh","Điểm từng tiêu chí","Tổng"]){
  const th=node("th",item);th.style.cssText="border:1px solid #bbb;padding:6px";header.append(th)
 }t.append(header);
 for(const row of receipt.rows||[]){
  const tr=node("tr");
  for(const value of [row.code||row.candidateId,row.name||"—",Object.entries(row.scores||{}).map(([k,v])=>k+": "+v).join("; "),String(row.total??"—")]){
   const td=node("td",String(value));td.style.cssText="border:1px solid #bbb;padding:6px";tr.append(td);
  }t.append(tr);
 }
 root.append(t,node("p","Đây là xác nhận điện tử qua OTP email, không phải chữ ký số có chứng thư số."));
 return root;
}
async function exportPdf(groupId){
 const data=await api("receipt",groupId);
 if(typeof window.html2pdf!=="function")throw Error("Trình tạo PDF chưa sẵn sàng.");
 const name="GrandeSync_BienBan_"+String(window.currentUserData?.code||"BGK").replace(/[^a-zA-Z0-9_-]/g,"_")+".pdf";
 await window.html2pdf().set({
  margin:10,filename:name,image:{type:"jpeg",quality:0.96},
  html2canvas:{scale:2,backgroundColor:"#fff"},
  jsPDF:{unit:"mm",format:"a4",orientation:"landscape"}
 }).from(buildPrint(data.receipt)).save();
 notify("Đã xuất biên bản PDF xác nhận OTP.");
}
function openOtpDialog(groupId,masked){
 const box=document.getElementById("custom-modal-box");if(!box)throw Error("Không mở được hộp thoại OTP.");
 box.replaceChildren();
 const header=node("h3","Xác nhận & khóa bảng điểm","font-extrabold text-lg text-red-900");
 const explain=node("p","Mã 6 chữ số đã gửi đến "+masked+". Mã hết hạn sau 5 phút.","text-xs text-gray-600");
 const input=node("input");input.inputMode="numeric";input.maxLength=6;input.autocomplete="one-time-code";
 input.placeholder="000000";input.className="border rounded-xl p-3 text-center text-xl tracking-widest w-full";
 const error=node("p","","text-xs text-red-700"),row=node("div","","flex flex-wrap gap-2 mt-2");
 const confirm=node("button","Xác nhận & khóa","bg-red-900 text-white px-4 py-2 rounded-xl font-bold text-xs");
 const cancel=node("button","Hủy","bg-gray-100 px-4 py-2 rounded-xl text-xs");
 const resend=node("button","Gửi lại OTP","border px-4 py-2 rounded-xl text-xs");
 cancel.onclick=close;confirm.onclick=async()=>{
  if(!/^\d{6}$/.test(input.value))return error.textContent="Nhập đủ 6 chữ số.";
  confirm.disabled=true;try{
   const answer=await api("confirm",groupId,{code:input.value});
   close();notify("Bảng điểm đã xác nhận và khóa thành công.");
   const signed=window.confirm("Đã xác nhận bảng điểm. Bạn có muốn tải biên bản PDF?");
   if(signed)await exportPdf(groupId);
   window._lastInitAuthUid=null;
   window.loadGradingTable?.(document.getElementById("main-content")).catch(()=>{});
  }catch(e){error.textContent=e.message}finally{confirm.disabled=false}
 };
 resend.onclick=async()=>{
  resend.disabled=true;try{const v=await api("request",groupId);explain.textContent="Đã gửi OTP mới đến "+v.emailMasked+". Mã có hiệu lực 5 phút.";error.textContent=""}
  catch(e){error.textContent=e.message}finally{setTimeout(()=>{resend.disabled=false},60000)}
 };
 row.append(confirm,cancel,resend);box.append(header,explain,input,error,row);window.openModal();input.focus();
}
const original=window.verifyGroupGrading;
window.verifyGroupGrading=function(groupId){
 if(!grader())return original?.(groupId);
 window.showCustomConfirm?.("Gửi mã OTP đến email của bạn để xác nhận và khóa vĩnh viễn bảng điểm?",async()=>{
  try{
   await flushPending(groupId);
   const r=await api("request",groupId);
   openOtpDialog(groupId,r.emailMasked);
  }catch(e){notify("Không thể gửi OTP: "+e.message,true)}
 });
};
/* Legacy BGK also receives criterion visibility from its own RLS-scoped grants. */
const startApp=window.initApp;
if(typeof startApp==="function"){
 window.initApp=function(){
  const response=startApp.apply(this,arguments);
  const graderId=window.currentUserData?.id;
  if(graderId&&window.currentUserData?.role==="Grader"&&!window.auth?.currentUser?.googleGrader){
   Promise.resolve(response).then(async()=>{
    const result=await sb.from("gs_criterion_grants").select("group_id,criterion").eq("grader_id",graderId);
    if(result.error||window.currentUserData?.id!==graderId)return;
    const map={};
    for(const grant of result.data||[])(map[grant.group_id] ||= []).push(grant.criterion);
    window._gsCriterionRestrictions=map;
    if(document.querySelector("#main-content input.score-input"))window.renderGradingTables?.();
   }).catch(e=>console.warn("BGK criterion scope read",e?.code||"read-failed"));
  }
  return response;
 };
}

const render=window.renderGradingTables;
if(typeof render==="function"){
 window.renderGradingTables=function(){
  const answer=render.apply(this,arguments);
  if(grader()){
   const groups=window._gsCriterionRestrictions;
   const groupId=window._selectedGradingGroupId||document.getElementById("grading-group-select")?.value;
   const allowed=groups?.[groupId];
   if(Array.isArray(allowed)&&allowed.length){
    document.querySelectorAll('input.score-input[data-group]').forEach(input=>{
     if(input.dataset.group!==groupId)return;
     if(!allowed.includes(input.dataset.crit)){
      input.disabled=true;input.title="Tiêu chí không được phân công";
      input.closest("td, .gs-score-card, .gs-score-row")?.classList.add("opacity-40");
     }
    });
   }
  }
  return answer;
 };
}
/* Display local draft state; never claim a browser draft was saved on server. */
function readDraftCount(){
 try{
  const data=JSON.parse(localStorage.getItem("gradeSyncQuotaDraftsV1")||"{}"),code=window.currentUserData?.code;
  return Object.values(data).filter(row=>row?.graderCode===code).length;
 }catch(_e){return 0}
}
function showRecoveryStatus(){
 if(!grader())return;
 const root=document.getElementById("main-content");
 if(!root||!root.querySelector("input.score-input"))return;
 let panel=root.querySelector("#gsx-recovery-panel");
 if(!panel){
  panel=document.createElement("div");panel.id="gsx-recovery-panel";
  panel.className="flex flex-wrap items-center gap-3 mx-3 my-2 px-4 py-3 border border-amber-200 bg-amber-50 rounded-xl text-xs text-amber-950";
  const status=document.createElement("span");status.className="flex-1 font-bold";status.dataset.role="status";
  const retry=document.createElement("button");retry.type="button";retry.textContent="Đồng bộ lại điểm nháp";
  retry.className="border border-amber-400 px-3 py-2 rounded-lg bg-white font-bold";
  retry.addEventListener("click",async()=>{
   if(navigator.onLine===false){notify("Chưa có mạng; điểm vẫn chỉ lưu tạm trên thiết bị.","error");return}
   retry.disabled=true;
   try{
    await window.retryQuotaDrafts?.(true);
    notify("Đã gửi yêu cầu đồng bộ. Chỉ tin trạng thái 'Đã lưu' ở từng thí sinh.");
   }catch(e){notify("Không thể đồng bộ nháp: "+e.message,"error")}
   finally{retry.disabled=false;refreshRecovery()}
  });
  panel.append(status,retry);root.prepend(panel);
 }
 refreshRecovery();
}
function refreshRecovery(){
 const panel=document.querySelector("#gsx-recovery-panel");
 if(!panel)return;
 const count=readDraftCount(),online=navigator.onLine!==false;
 const text=(online?"Đang có mạng":"Mất mạng")+" • "+(count?count+" bản nháp trên thiết bị chưa xác nhận lưu":"Chưa có bản nháp chờ đồng bộ")+
  ". Chỉ điểm báo 'Đã lưu' mới chắc chắn ở máy chủ.";
 const status=panel.querySelector('[data-role="status"]');
 if(status&&status.textContent!==text)status.textContent=text;
 const retry=panel.querySelector("button");if(retry)retry.disabled=!online||!count;
}
let lastScan=null;
const scheduleRecovery=()=>{if(lastScan)return;lastScan=setTimeout(()=>{lastScan=null;showRecoveryStatus()},160)};
const root=document.getElementById("main-content");
if(root)new MutationObserver(scheduleRecovery).observe(root,{childList:true,subtree:true});
for(const type of ["online","offline"])window.addEventListener(type,refreshRecovery);
document.addEventListener("input",e=>{if(e.target.matches?.("input.score-input"))setTimeout(refreshRecovery,30)},true);
document.addEventListener("visibilitychange",refreshRecovery);
scheduleRecovery();

window.gsExportConfirmedPdf=exportPdf;
})();
