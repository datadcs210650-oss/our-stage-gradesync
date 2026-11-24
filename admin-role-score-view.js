/* Saved role proposals and notes in the OSC read-only grading view. */
(()=>{
"use strict";
function scan(){
 if(!["Admin","SuperAdmin"].includes(window.currentUserData?.role))return;
 const gid=window._selectedGradingGroupId||document.getElementById("grading-group-select")?.value,policy=window._groupMapCache?.[gid]?.gsCasting,grader=document.getElementById("grading-grader-select")?.value;
 if(!gid||!grader||(!policy?.roles?.length&&!policy?.notesEnabled))return;
 const records=new Map((window._allScoresCache||[]).filter(s=>s.groupId===gid&&s.graderCode===grader).map(s=>[s.candidateId,s]));
 const root=document.getElementById("main-content");if(!root)return;
 for(const slot of root.querySelectorAll('[id^="status-container-"]')){
  const score=records.get(slot.id.slice("status-container-".length)),tr=slot.closest("tr");
  const role=tr?.querySelector(".gsx-role-cell"),note=tr?.querySelector(".gsx-note-cell");
  if(role){const value=(score?.gsProposedRoles||[]).join(", ")||"—";if(role.textContent!==value)role.textContent=value;role.classList.add("text-xs")}
  if(note){const value=score?.gsJudgeNote||"—";if(note.textContent!==value)note.textContent=value;note.classList.add("text-xs","whitespace-pre-wrap")}
  if(!tr){const value=[...(policy.roles?.length?["Vai phù hợp: "+((score?.gsProposedRoles||[]).join(", ")||"—")]:[]),...(policy.notesEnabled?["Ghi chú: "+(score?.gsJudgeNote||"—")]:[])].join("\n");let box=slot.querySelector(".gsx-admin-role-summary");if(!box){box=document.createElement("div");box.className="gsx-admin-role-summary text-left whitespace-pre-wrap text-xs mt-2";slot.append(box)}if(box.textContent!==value)box.textContent=value}
 }
}
let frame=false;const schedule=()=>{if(!frame){frame=true;requestAnimationFrame(()=>{frame=false;scan()})}};
const root=document.getElementById("main-content");if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});schedule();
})();