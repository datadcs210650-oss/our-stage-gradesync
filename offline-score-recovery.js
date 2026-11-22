/* Durable, per-account local score drafts. Never labels a draft as saved on the server. */
(()=>{
 "use strict";
 const PREFIX="gsx-local-score-draft:v1:";
 const TTL=48*60*60*1000;
 let activeUser="",shownFor="";
 const user=()=>window.currentUserData?.role==="Grader"?String(window.currentUserData?.id||""):"";
 const key=()=>PREFIX+user();
 const read=()=>{
  if(!user())return{};
  try{
   const raw=JSON.parse(localStorage.getItem(key())||"{}");
   const entries=Object.entries(raw).filter(([,v])=>Date.now()-v.at<TTL&&v.groupId&&v.criterion&&v.candidateId);
   return Object.fromEntries(entries);
  }catch(_e){return{}}
 };
 const write=d=>{try{if(user())localStorage.setItem(key(),JSON.stringify(d))}catch(_e){}};
 const removeCandidate=(cid,gid)=>{
  const drafts=read();for(const [id,row] of Object.entries(drafts)){
   if(row.candidateId===cid&&row.groupId===gid)delete drafts[id];
  }write(drafts);
 };
 const status=(cId,value)=>{
  const e=document.getElementById("save-status-"+cId);
  if(!e)return;
  e.style.opacity="1";e.textContent=value;e.style.color="#b45309";
 };
 document.addEventListener("input",e=>{
  const x=e.target;
  if(!x?.matches?.('input.score-input[data-cand][data-group][data-crit]')||!user())return;
  const payload=read();
  const id=x.dataset.group+"|"+x.dataset.cand+"|"+x.dataset.crit;
  payload[id]={groupId:x.dataset.group,candidateId:x.dataset.cand,
    criterion:x.dataset.crit,value:x.value,at:Date.now()};
  if(Object.keys(payload).length>600){
   const oldest=Object.keys(payload).sort((a,b)=>payload[a].at-payload[b].at);
   for(const k of oldest.slice(0,Object.keys(payload).length-600))delete payload[k];
  }
  write(payload);
  status(x.dataset.cand,navigator.onLine?"Đang gửi điểm…":"Lưu tạm trên thiết bị (chưa gửi)");
 },true);
 const previous=window.saveScoreNow;
 if(typeof previous==="function"){
  window.saveScoreNow=async function(cid,gid,pass){
   let result=false;
   try{
    result=await previous.call(this,cid,gid,pass);
    if(result===true)removeCandidate(cid,gid);
    else status(cid,"Chưa xác nhận lưu trên máy chủ");
    return result;
   }catch(e){status(cid,"Lưu tạm, máy chủ chưa nhận");throw e}
  };
 }
 function show(){
  if(!user()||!document.querySelector("input.score-input")||!Object.keys(read()).length)return;
  const who=user(),drafts=read(),list=Object.values(drafts);
  if(shownFor===who&&document.getElementById("gsx-draft-alert"))return;
  const target=document.getElementById("main-content");if(!target)return;
  const alert=document.createElement("div");alert.id="gsx-draft-alert";
  alert.style.cssText="position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;margin:6px 0;border:1px solid #e7bf72;background:#fff7e6;border-radius:10px;font:600 12px system-ui;color:#754a11";
  const label=document.createElement("span");label.textContent="Có "+list.length+" ô điểm lưu tạm trên thiết bị. Chưa chắc đã lưu trên máy chủ.";
  const restore=document.createElement("button");restore.type="button";restore.textContent="Xem và khôi phục nháp";
  restore.style.cssText="padding:8px 12px;border-radius:8px;background:#7b1e3b;color:#fff";
  restore.onclick=()=>{
   if(!window.confirm("Khôi phục điểm nháp vào bảng chấm đang hiển thị? Hệ thống sẽ thử lưu lại. Hãy đối chiếu điểm trước khi khóa."))return;
   let applied=0;
   for(const row of Object.values(read())){
    const input=[...document.querySelectorAll('input.score-input[data-cand][data-crit][data-group]')]
     .find(x=>x.dataset.cand===row.candidateId&&x.dataset.group===row.groupId&&x.dataset.crit===row.criterion);
    if(!input||input.disabled)continue;
    input.value=row.value;input.dispatchEvent(new Event("input",{bubbles:true}));applied++;
   }
   label.textContent="Đã khôi phục "+applied+" ô. Điểm chỉ được báo 'Đã lưu' sau khi máy chủ xác nhận.";
   if(navigator.onLine===false)window.showToast?.("Chưa thể gửi điểm nháp khi mất mạng.","error");
  };
  alert.append(label,restore);target.prepend(alert);shownFor=who;
 }
 const root=document.getElementById("main-content");
 if(root)new MutationObserver(()=>{if(user()!==activeUser){activeUser=user();shownFor=""}show()}).observe(root,{childList:true,subtree:true});
 window.addEventListener("online",show);
})();
