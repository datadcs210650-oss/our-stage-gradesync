/* BGK Google and legacy login: mandatory email OTP before confirmed score locks. */
(()=>{
"use strict";
const sb=window.supabase;
const grader=()=>window.currentUserData?.role==="Grader"&&window.auth?.currentUser?.googleGrader===true;
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
function actionButton(label,fn,primary=false){const x=node("button",label,primary?"bg-red-900 text-white px-4 py-2 rounded-xl font-bold text-xs":"border px-4 py-2 rounded-xl text-xs");x.type="button";x.onclick=fn;return x}
function success(box,answer){
 if(!box.isConnected)return;
 box.replaceChildren(node("h3","✓ Bảng điểm đã được khóa","font-extrabold text-lg text-emerald-800"),node("p","Mã đối chiếu bảng điểm","text-xs text-gray-500"),node("p",answer.comparisonCode||"Chưa có mã đối chiếu","text-3xl font-mono tracking-widest font-black text-red-900"),node("p",answer.mailAccepted===true?"Email xác nhận đã được dịch vụ tiếp nhận.":"Bảng điểm đã khóa. Nếu chưa nhận email, liên hệ Admin để gửi lại.","text-xs text-gray-600"),actionButton("Đóng",()=>{close();window._lastInitAuthUid=null;window.loadGradingTable?.(document.getElementById("main-content")).catch(()=>{})},true));
}
function openOtpDialog(groupId,partial){
 const box=document.getElementById("custom-modal-box");if(!box)throw Error("Không mở được hộp thoại OTP.");
 const header=node("h3","Xác nhận & khóa bảng điểm","font-extrabold text-lg text-red-900"),explain=node("p","Đang gửi mã OTP…","text-xs text-gray-600"),input=node("input"),error=node("p","","text-xs text-red-700"),row=node("div","","flex flex-wrap gap-2 mt-2");
 input.inputMode="numeric";input.maxLength=6;input.autocomplete="one-time-code";input.placeholder="000000";input.className="border rounded-xl p-3 text-center text-xl tracking-widest w-full";
 const confirm=actionButton("Xác nhận & khóa",async()=>{
  if(!/^\d{6}$/.test(input.value))return error.textContent="Nhập đủ 6 chữ số.";
  confirm.disabled=true;try{const answer=await api("confirm",groupId,{code:input.value});if(box.contains(header))success(box,answer)}
  catch(e){if(!box.contains(header))return;try{const status=await api("completion-status",groupId);if(status.confirmed){success(box,status);return}}catch(_){}error.textContent=e.message;confirm.disabled=false}
 },true);
 const cancel=actionButton("Hủy",close),resend=actionButton("Gửi lại OTP",()=>send());
 const send=async()=>{confirm.disabled=true;resend.disabled=true;error.textContent="";explain.textContent="Đang gửi mã OTP…";try{const r=await api("request",groupId,{confirmPartial:partial});if(!box.contains(header))return;explain.textContent="Mã 6 chữ số đã gửi đến "+r.emailMasked+". Mã hết hạn sau 5 phút.";confirm.disabled=false;setTimeout(()=>{resend.disabled=false},60000)}catch(e){error.textContent=e.message;resend.disabled=false}};
 row.append(confirm,cancel,resend);box.replaceChildren(header,explain,input,error,row);window.openModal();input.focus();send();
}
window.verifyGroupGrading=async function(groupId){
 if(!grader())return notify("Vui lòng đăng nhập bằng Google.",true);
 const box=document.getElementById("custom-modal-box");if(!box)return notify("Không mở được hộp thoại xác nhận.",true);
 const heading=node("h3","Nộp bảng điểm?","font-extrabold text-lg text-red-900"),detail=node("p","Đang đối soát điểm đã lưu…","text-sm text-gray-600");
 const proceed=actionButton("Xác nhận",()=>openOtpDialog(groupId,partial),true);let partial=false;proceed.disabled=true;
 box.replaceChildren(heading,detail,actionButton("Quay lại",close),proceed);window.openModal();
 try{await flushPending(groupId);const check=await api("preflight",groupId);if(!box.contains(heading))return;const c=check.completeness||{};partial=c.partial===true;detail.textContent="Đã nhập điểm "+(c.scoredCandidates||0)+"/"+(c.totalCandidates||0)+" thí sinh; còn "+(c.incompleteCandidates||0)+" hồ sơ chưa đủ tiêu chí, "+(c.missingCriterionCells||0)+" ô điểm thiếu. "+(partial?"Bạn vẫn có thể nộp; ô chưa chấm không được tự điền 0. ":"")+"Bảng điểm sẽ khóa sau xác nhận OTP.";proceed.disabled=false}catch(e){detail.textContent=e.message}
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
 if(window.GS_MANUAL_SCORE_MODE||!grader())return;
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

// Không công khai bất kỳ hàm tải PDF nào cho giám khảo.
})();
