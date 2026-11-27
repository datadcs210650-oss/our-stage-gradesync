/* Manual score editing: one explicit, revision-checked save per candidate.
 * Reuses the existing authenticated gradesync_save_score RPC; never auto-sends. */
(()=>{
"use strict";
if(!window.GS_MANUAL_SCORE_MODE)return;
const PREFIX="gsx-manual-scores-v1:",uid=()=>window.currentUserData?.role==="Grader"?String(window.currentUserData.id||""):"";
const memory=new Map(),busy=new Set(),failures=new Map();
const key=(gid,cid)=>gid+"|"+cid;
function drafts(){
 const u=uid();if(!u)return {};
 if(!memory.has(u)){
  let value={};try{value=JSON.parse(localStorage.getItem(PREFIX+u)||"{}")}catch(_){}
  memory.set(u,value&&typeof value==="object"&&!Array.isArray(value)?value:{});
 }
 return memory.get(u);
}
function persist(){
 const u=uid();if(!u)return;
 try{localStorage.setItem(PREFIX+u,JSON.stringify(drafts()))}catch(_){window.showToast?.("Không lưu được nháp trên thiết bị. Không đóng trang trước khi lưu điểm.","error")}
}
const inputs=(gid,cid)=>[...document.querySelectorAll("input.score-input[data-group][data-cand]")].filter(x=>x.dataset.group===gid&&x.dataset.cand===cid);
const allowed=(gid,criterion)=>{const list=window._gsCriterionRestrictions?.[gid];return !Array.isArray(list)||!list.length||list.includes(criterion)};
const current=(gid,cid)=> (window._allScoresCache||[]).filter(s=>s.groupId===gid&&s.candidateId===cid&&(s.graderId?s.graderId===uid():s.graderCode===window.currentUserData?.code)).sort((a,b)=>Number(b.revision||0)-Number(a.revision||0))[0]||null;
function normalize(values){
 const scores={};let invalid=false;
 for(const [criterion,raw] of Object.entries(values)){
  const s=String(raw).trim().replace(",",".");if(!s)continue;
  if(!/^\d+(?:\.\d{1,2})?$/.test(s)||Number(s)<0||Number(s)>10){invalid=true;continue}
  scores[criterion]=Number(s);
 }
 return {scores,invalid};
}
const equal=(a,b)=>Object.keys(a||{}).length===Object.keys(b||{}).length&&Object.entries(a||{}).every(([k,v])=>Object.hasOwn(b||{},k)&&Number(b[k])===Number(v));
function take(gid,cid){
 const row=inputs(gid,cid);
 const values=Object.fromEntries(row.filter(x=>allowed(gid,x.dataset.crit)).map(x=>[x.dataset.crit,x.value]));
 return {row,values,...normalize(values)};
}
function currentDraft(gid,cid){return drafts()[key(gid,cid)]}
const policyFor=gid=>window._groupMapCache?.[gid]?.gsCasting||null;
const candidateFor=(gid,cid)=>(window._allCandidatesCache||[]).find(x=>x.id===cid&&x.groupId===gid);
const registeredFor=(gid,cid)=>{const p=policyFor(gid),c=candidateFor(gid,cid);return (c?.customFields?.gsRoleIds||[]).filter(x=>p?.roles?.includes(x))};
const sameEvaluation=(a,b)=>JSON.stringify([...(a?.roles||[])].sort())===JSON.stringify([...(b?.roles||[])].sort())&&String(a?.note||"")===String(b?.note||"");
const committedEvaluation=base=>({roles:base?.gsProposedRoles||[],note:base?.gsJudgeNote||""});
function renderEvaluation(controls,gid,cid,disabled){
 const policy=policyFor(gid),roles=registeredFor(gid,cid),slot=document.getElementById("status-container-"+cid);
 if(!policy?.roles?.length&&!policy?.notesEnabled)return;
 const tr=slot?.closest("tr"),roleHost=tr?.querySelector(".gsx-role-cell")||controls,noteHost=tr?.querySelector(".gsx-note-cell")||controls;
 const signature=JSON.stringify([policy.roles,roles,policy.maxProposed]);
 if(policy.roles?.length){
  let pane=roleHost.querySelector(".gsx-role-panel");
  if(!pane||pane.dataset.signature!==signature){
   const old=pane;pane=document.createElement("div");pane.className="gsx-role-panel text-left w-full rounded-lg p-2 space-y-1";pane.dataset.signature=signature;
   const title=document.createElement("p");title.className="font-bold text-[10px] text-red-900";title.textContent="Tối đa "+policy.maxProposed+" vai";pane.append(title);
   if(!roles.length){const empty=document.createElement("p");empty.className="text-[10px] text-gray-500";empty.textContent="Chưa đăng ký vai";pane.append(empty)}
   for(const role of roles){
    const label=document.createElement("label"),check=document.createElement("input"),text=document.createElement("span");
    label.className="flex items-center gap-2 text-xs";check.type="checkbox";check.className="gsx-role-tick accent-red-900";check.value=role;text.textContent=role;
    check.onchange=()=>{if([...pane.querySelectorAll(".gsx-role-tick:checked")].length>policy.maxProposed){check.checked=false;window.showToast?.("Đã đạt số vai tối đa.","error")}record(gid,cid)};
    label.append(check,text);pane.append(label);
   }
   if(old)old.replaceWith(pane);else roleHost.prepend(pane);
  }
  const e=currentDraft(gid,cid)?.evaluation||committedEvaluation(current(gid,cid));
  for(const x of pane.querySelectorAll(".gsx-role-tick")){x.checked=e.roles.includes(x.value);x.disabled=disabled||(!x.checked&&e.roles.length>=policy.maxProposed)}
 }
 if(policy.notesEnabled){
  let note=noteHost.querySelector(".gsx-judge-note");
  if(!note){note=document.createElement("textarea");note.className="gsx-judge-note w-full rounded-md border p-2 text-xs font-normal";note.rows=2;note.maxLength=1000;note.placeholder="Nhận xét…";note.setAttribute("aria-label","Ghi chú BGK");note.oninput=()=>record(gid,cid);noteHost.prepend(note)}
  const e=currentDraft(gid,cid)?.evaluation||committedEvaluation(current(gid,cid));if(document.activeElement!==note)note.value=e.note;note.disabled=disabled;
 }
}
function readEvaluation(gid,cid){
 const p=policyFor(gid),slot=document.getElementById("status-container-"+cid),pane=slot?.closest("tr")||slot;
 if(!p||!pane)return currentDraft(gid,cid)?.evaluation||committedEvaluation(current(gid,cid));
 return {roles:[...pane.querySelectorAll(".gsx-role-tick:checked")].map(x=>x.value),note:p.notesEnabled?(pane.querySelector(".gsx-judge-note")?.value||""):""};
}
function record(gid,cid){
 if(!uid())return;
 const x=take(gid,cid);if(!x.row.length||x.row.every(i=>i.disabled))return;
 const id=key(gid,cid),old=currentDraft(gid,cid),base=current(gid,cid),evaluation=readEvaluation(gid,cid);
 if(!busy.has(id)&&!x.invalid&&equal(x.scores,base?.scores||{})&&sameEvaluation(evaluation,committedEvaluation(base))){delete drafts()[id];failures.delete(id)}
 else drafts()[id]={gid,cid,values:x.values,evaluation,revision:old?.revision??Number(base?.revision||0),at:Date.now()};
 persist();paint(gid,cid);
}
function paint(gid,cid){
 const id=key(gid,cid),d=currentDraft(gid,cid),base=current(gid,cid),row=inputs(gid,cid);
 if(!row.length)return;
 const slot=document.getElementById("status-container-"+cid);
 if(!slot)return;
 let controls=slot.querySelector(".gsx-manual-controls");
 if(!controls){
  controls=document.createElement("div");controls.className="gsx-manual-controls flex flex-col items-center gap-1 mt-2";
  const status=document.createElement("span");status.className="gsx-manual-state text-[10px] font-bold";
  const button=document.createElement("button");button.type="button";button.className="gsx-manual-save bg-red-900 text-white rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50";
  button.onclick=()=>save(gid,cid);
  const undo=document.createElement("button");undo.type="button";undo.textContent="Hoàn tác";undo.className="gsx-manual-undo text-[10px] font-bold text-gray-500";
  undo.onclick=()=>{if(busy.has(id))return;if(!window.confirm("Bỏ thay đổi chưa lưu của thí sinh này?"))return;delete drafts()[id];failures.delete(id);persist();for(const i of inputs(gid,cid))i.value=String(current(gid,cid)?.scores?.[i.dataset.crit]??"");paint(gid,cid)};
  controls.append(status,button,undo);slot.append(controls);
 }
 renderEvaluation(controls,gid,cid,row.every(i=>i.disabled));
 const status=controls.querySelector(".gsx-manual-state"),button=controls.querySelector(".gsx-manual-save"),undo=controls.querySelector(".gsx-manual-undo");
 const state=busy.has(id)?"Đang lưu…":failures.has(id)?failures.get(id):d?(base?"Có thay đổi chưa lưu":"Chưa lưu"):base?"Đã lưu ✓":"Chưa chấm";
 if(status.textContent!==state)status.textContent=state;
 status.style.color=failures.has(id)?"#be123c":d?"#a16207":base?"#047857":"#64748b";
 const label=d?(base?"Lưu lại":"Lưu điểm"):base?"Đã lưu":"Lưu điểm";
 if(button.textContent!==label)button.textContent=label;
 button.disabled=busy.has(id)||!d||row.every(i=>i.disabled)||normalize(d.values).invalid;
 undo.hidden=!d;undo.disabled=busy.has(id);
 const old=document.getElementById("save-status-"+cid);if(old)old.style.opacity="0";
 const values=d?normalize(d.values):{scores:base?.scores||{},invalid:false};
 for(const i of row){
  const v=String(i.value).trim(),bad=v&&!/^\d+(?:[.,]\d{1,2})?$/.test(v)||v&&Number(v.replace(",","."))>10;
  i.setAttribute("aria-invalid",String(Boolean(bad)));
  i.style.borderColor=bad?"#be123c":d&&String(i.value)!==String(base?.scores?.[i.dataset.crit]??"")?"#d6a34c":"";
 }
 const relevant=row.filter(i=>allowed(gid,i.dataset.crit)),weights=relevant.reduce((s,i)=>s+Number(i.dataset.weight||0),0);
 const total=document.getElementById("tot-"+cid);
 if(total&&d){
  const value=values.invalid||!Object.keys(values.scores).length||!weights?"—":(relevant.reduce((s,i)=>s+Number(values.scores[i.dataset.crit]??0)*Number(i.dataset.weight||0),0)/weights).toFixed(2);
  if(total.textContent!==value)total.textContent=value;
 }
 if(total&&!d){const value=base&&Object.keys(base.scores||{}).length?String(base.totalScore??"—"):"—";if(total.textContent!==value)total.textContent=value}
}
async function save(gid,cid){
 const u=uid(),id=key(gid,cid),d=currentDraft(gid,cid),row=inputs(gid,cid);
 if(!u||!d||busy.has(id)||!row.length||row.every(i=>i.disabled))return;
 if(navigator.onLine===false){failures.set(id,"Mất mạng · Chưa lưu");paint(gid,cid);return}
 const x=normalize(d.values);if(x.invalid)return;
 // Recheck scope against current grant data before writing; server checks again.
 if(Object.keys(x.scores).some(k=>!allowed(gid,k))){failures.set(id,"Quyền chấm đã thay đổi");paint(gid,cid);return}
 busy.add(id);failures.delete(id);paint(gid,cid);
 try{
  const policy=policyFor(gid),evaluation=d.evaluation||committedEvaluation(current(gid,cid));
  const args={p_candidate_id:cid,p_group_id:gid,p_scores:x.scores,p_total_score:0,p_expected_revision:d.revision};
  const {data,error}=await window.supabase.rpc(policy?.roles?.length||policy?.notesEnabled?"gs_save_casting_evaluation":"gradesync_save_score",policy?.roles?.length||policy?.notesEnabled?{...args,p_roles:evaluation.roles,p_note:evaluation.note}:args);
  if(error)throw error;
  const saved=Array.isArray(data)?data[0]:data;
  if(!saved||saved.candidate_id!==cid||saved.group_id!==gid||saved.grader_id!==u||Number(saved.revision)!==d.revision+1)throw Error("Không xác nhận được phiên bản điểm.");
  if(uid()!==u)return;
  const mapped={gsProposedRoles:saved.extra_data?.gsProposedRoles||[],gsJudgeNote:saved.extra_data?.gsJudgeNote||"",id:saved.id,candidateId:cid,groupId:gid,graderId:saved.grader_id,graderCode:saved.grader_code,graderName:saved.grader_name,scores:saved.scores,totalScore:saved.total_score,revision:saved.revision,locked:saved.locked,updatedAt:saved.updated_at,timestamp:{seconds:Math.floor(Date.parse(saved.updated_at)/1000)}};
  const cache=window._allScoresCache||[];
  if(!cache.some(s=>s.groupId===gid&&s.candidateId===cid&&(s.graderId?s.graderId===u:s.graderCode===mapped.graderCode)&&Number(s.revision)>Number(mapped.revision))){
   window._allScoresCache=cache.filter(s=>!(s.groupId===gid&&s.candidateId===cid&&(s.graderId?s.graderId===u:s.graderCode===mapped.graderCode)));window._allScoresCache.push(mapped);
   (window._gradedDataCache||={})[cid]=mapped;
  }
  const latest=currentDraft(gid,cid);
  if(latest&&latest!==d&&(!equal(normalize(latest.values).scores,saved.scores||{})||!sameEvaluation(latest.evaluation,committedEvaluation(mapped)))){
   drafts()[id]={...latest,revision:Number(saved.revision)};
   window.showToast?.("Đã lưu phiên bản trước; thay đổi mới vẫn chưa lưu.");
  }else if(latest&&latest!==d&&normalize(latest.values).invalid){
   drafts()[id]={...latest,revision:Number(saved.revision)};
  }else{delete drafts()[id];window.showToast?.("Đã lưu điểm.");}
  persist();
 }catch(e){
  if(uid()!==u)return;
  failures.set(id,/SCORE_CONFLICT/.test(String(e.message))?"Xung đột phiên bản · Chưa lưu":"Lưu thất bại");
  // A response can be lost after commit. Reconcile only this judge and row;
  // never blindly overwrite a newer version from another tab/device.
  if(navigator.onLine!==false){try{const result=await window.supabase.from("scores").select("id,group_id,candidate_id,grader_id,grader_code,grader_name,scores,total_score,revision,locked,updated_at,extra_data").eq("group_id",gid).eq("candidate_id",cid).eq("grader_id",u).maybeSingle();const s=result.data,latest=currentDraft(gid,cid);if(!result.error&&s&&uid()===u&&s.grader_id===u){const committed={id:s.id,groupId:gid,candidateId:cid,graderId:u,graderCode:s.grader_code,graderName:s.grader_name,scores:s.scores,totalScore:s.total_score,revision:s.revision,locked:s.locked,gsProposedRoles:s.extra_data?.gsProposedRoles||[],gsJudgeNote:s.extra_data?.gsJudgeNote||""};if(!current(gid,cid)||Number(current(gid,cid).revision)<=Number(s.revision)){window._allScoresCache=(window._allScoresCache||[]).filter(r=>!(r.groupId===gid&&r.candidateId===cid&&(r.graderId?r.graderId===u:r.graderCode===s.grader_code)));window._allScoresCache.push(committed)}if(latest&&!normalize(latest.values).invalid&&equal(normalize(latest.values).scores,s.scores)&&sameEvaluation(latest.evaluation,committedEvaluation(committed))){delete drafts()[id];failures.delete(id);persist();window.showToast?.("Đã đối chiếu: điểm đã lưu trên máy chủ.");return;}if(latest&&Number(s.revision)!==Number(latest.revision))failures.set(id,"Điểm máy chủ đã thay đổi · Chưa lưu");}}catch(_){}}
  window.showToast?.("Chưa lưu điểm: "+(e.message||"lỗi kết nối")+". Bản nháp vẫn được giữ.","error");
 }finally{
  busy.delete(id);
  if(uid()===u){
   paint(gid,cid);
  }
 }
}
let pending=false;
function scan(){
 pending=false;if(!uid())return;
 const rows=new Map();
 for(const i of document.querySelectorAll("input.score-input[data-group][data-cand]"))rows.set(key(i.dataset.group,i.dataset.cand),[i.dataset.group,i.dataset.cand]);
 for(const [gid,cid] of rows.values()){
  const d=currentDraft(gid,cid);
  if(d)for(const i of inputs(gid,cid))if(Object.hasOwn(d.values,i.dataset.crit)&&i.value!==String(d.values[i.dataset.crit])&&document.activeElement!==i)i.value=String(d.values[i.dataset.crit]);
  paint(gid,cid);
 }
}
function schedule(){if(!pending){pending=true;requestAnimationFrame(scan)}}
document.addEventListener("input",e=>{const i=e.target;if(i.matches?.("input.score-input[data-group][data-cand]"))record(i.dataset.group,i.dataset.cand)},true);
document.addEventListener("keydown",e=>{const i=e.target;if((e.metaKey||e.ctrlKey)&&e.key==="Enter"&&i.matches?.("input.score-input[data-group][data-cand]")){e.preventDefault();save(i.dataset.group,i.dataset.cand)}},true);
window.addEventListener("beforeunload",e=>{if(uid()&&Object.keys(drafts()).length){e.preventDefault();e.returnValue=""}});
window.autoSaveScore=(cid,gid)=>record(gid,cid);
window.saveScoreNow=async()=>false;
window.retryQuotaDrafts=async()=>false;
window.submitSessionGrading=async()=>{throw Error("Phải lưu từng thí sinh trước khi khóa điểm.")};
window.refreshSessionModeUI=()=>{};window.enforceSessionModeScoreListener=()=>{};
for(const timer of Object.values(window._scoreSaveTimers||{}))clearTimeout(timer);
window._scoreSaveTimers={};window._scoreSavePending={};window._offlinePendingScores={};
window.oscPendingScoreEdits=gid=>Object.values(drafts()).some(d=>d.gid===gid)||[...busy].some(id=>id.startsWith(gid+"|"));
const verify=window.verifyGroupGrading;
window.verifyGroupGrading=async function(gid){
 if(!uid()||!window.auth?.currentUser?.googleGrader)return window.showToast?.("Vui lòng đăng nhập BGK để nộp bảng điểm.","error");
 if(window.oscPendingScoreEdits(gid))return window.showToast?.("Còn điểm chưa lưu. Hãy lưu hoặc hoàn tác trước khi khóa bảng điểm.","error");
 return verify?.(gid);
};
window.vGG=window.verifyGroupGrading;
const root=document.getElementById("main-content");
if(root)new MutationObserver(schedule).observe(root,{subtree:true,childList:true});
window.addEventListener("online",schedule);schedule();
})();