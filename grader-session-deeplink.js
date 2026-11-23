/* Optional BGK session link. Authentication and group permission checks remain server-side. */
(()=>{
 "use strict";
 const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const param=new URLSearchParams(location.search).get("groupId");
 if(param&&idPattern.test(param)){
  try{sessionStorage.setItem("gsxBGKTargetGroup",param)}catch(_){}
 }
 let target="";
 try{target=sessionStorage.getItem("gsxBGKTargetGroup")||""}catch(_){}
 if(!idPattern.test(target))return;
 let applied=false,observer;
 function select(){
  if(applied||window.currentUserData?.role!=="Grader")return;
  const field=document.getElementById("grading-group-select");
  if(!field)return;
  const allowed=[...field.options].some(x=>x.value===target&&!x.disabled);
  if(!allowed)return;
  applied=true;field.value=target;window._selectedGradingGroupId=target;
  try{sessionStorage.removeItem("gsxBGKTargetGroup")}catch(_){}
  observer?.disconnect();
  window.changeGradingGroup?.();
  window.showToast?.("Đã mở phiên chấm được cấp quyền từ link BGK.");
 }
 const root=document.getElementById("main-content");
 if(root){observer=new MutationObserver(select);observer.observe(root,{childList:true,subtree:true})}
 select();
})();
