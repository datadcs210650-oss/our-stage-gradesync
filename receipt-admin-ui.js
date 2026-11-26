/* Receipt lifecycle controls; no polling, selected-session reads only. */
export function installReceiptAdmin(){
 const URL="https://portal.ourstage.io.vn/xac-thuc-bien-ban";
 const call=(a,b)=>window.oscGradingCall(a,b);
 const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||"";if(text!==undefined)e.textContent=text;return e};
 const button=(text,fn,danger=false)=>{const b=el("button",(danger?"bg-red-900 text-white":"bg-white border border-rose-200 text-red-900")+" rounded-lg px-3 py-2 text-xs font-bold",text);b.type="button";b.onclick=fn;return b};
 const link=()=>{const a=el("a","inline-flex items-center rounded-lg px-3 py-2 text-xs font-bold border border-rose-200 text-red-900","Xác thực biên bản");a.href=URL;a.target="_blank";a.rel="noopener noreferrer";return a};
 const toast=(msg,err=false)=>window.showToast?.(msg,err?"error":"success");
 const labels={pending:"Đang chờ gửi",sending:"Đang gửi",sent:"Resend đã tiếp nhận",failed:"Gửi thất bại",cancelled:"Đã hủy"};
 let refreshActive=null;
 async function reopen(groupId,record,groupName){
  if(!record?.canReopen||!record.comparisonCode)return toast("Không thể mở lại: phiên đã duyệt hoặc chưa có xác nhận hợp lệ.",true);
  const box=document.getElementById("custom-modal-box");if(!box)return;
  const form=el("div","space-y-3");
  form.append(el("h3","text-lg font-black text-red-900","Mở lại bảng điểm"),el("p","text-sm","BGK: "+record.graderName+" · "+groupName),el("p","font-mono font-bold text-sm","Mã hiện hành: "+record.comparisonCode));
  const reason=el("textarea","w-full border rounded-xl p-3 text-sm");reason.rows=3;reason.maxLength=500;reason.placeholder="Nhập lý do bắt buộc...";
  const notice=el("div","rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2");
  notice.append(el("p","text-sm font-bold text-red-900","🔒 Thu hồi mã và biên bản cũ ngay lập tức"),el("p","text-sm font-bold","🔒 Tự động gửi email thông báo bắt buộc"),el("p","text-xs text-gray-600","Nếu email gặp lỗi, hệ thống lưu yêu cầu và thử gửi lại. Email BGK vẫn bị khóa."));
  const status=el("p","text-xs text-red-900"),row=el("div","flex gap-2 flex-wrap justify-end");
  const submit=button("Xác nhận mở lại",async()=>{
   if(reason.value.trim().length<3||submit.disabled)return;submit.disabled=true;
   try{
    const r=await call("reopen-grader-receipt",{groupId,graderId:record.graderId,comparisonCode:record.comparisonCode,reason:reason.value.trim(),confirm:true});
    window.closeCustomModal?.();toast("Đã mở lại và thu hồi mã cũ. "+(r.mailAccepted?"Email thông báo đã được Resend tiếp nhận.":"Email thông báo đang chờ gửi lại."));
    await refreshActive?.();window.oscUnifiedRefresh?.();
   }catch(e){status.textContent=e.message;submit.disabled=false}
  },true);
  submit.disabled=true;reason.oninput=()=>submit.disabled=reason.value.trim().length<3;
  row.append(button("Hủy",()=>window.closeCustomModal?.()),submit);
  form.append(el("label","text-xs font-bold","Lý do mở lại bảng điểm *"),reason,notice,status,row);box.replaceChildren(form);window.openModal?.();
 }
 window.adminUnlockGrader=async(groupId,graderCode)=>{
  try{const [d,groups]=await Promise.all([call("casting-receipt-list",{groupId}),call("casting-group-options")]);const r=d.receipts.find(x=>x.graderCode===graderCode);await reopen(groupId,r,groups.groups.find(g=>g.id===groupId)?.name||groupId)}catch(e){toast(e.message,true)}
 };
 const original=window.loadAdminLiveMonitor;
 window.loadAdminLiveMonitor=async function(host,scope=null){
  if(!scope&&host?.querySelector("[data-osc-unified]")){window.oscUnifiedRefresh?.();return;}
  if(!host)return;
  if(host.querySelector(":scope > [data-osc-receipt-monitor]")){await refreshActive?.();return;}
  const panel=el("section","bg-white border border-rose-100 rounded-2xl p-4 space-y-3 mb-4");panel.dataset.oscReceiptMonitor="1";
  const main=el("div","min-w-0");host.replaceChildren(panel,main);
  const heading=el("div","flex flex-wrap items-center justify-between gap-2");heading.append(el("h3","text-lg font-black text-red-900","Quản lý xác nhận BGK"),link());
  const select=el("select","w-full rounded-xl border border-rose-100 p-3 text-sm"),rows=el("div","space-y-2"),status=el("p","text-xs text-gray-500","Đang tải phiên chấm...");
  panel.append(heading,select,status,rows);if(scope)select.hidden=true;
  let generation=0;
  const read=async()=>{
   const id=select.value;if(!id)return;const current=++generation;
   status.textContent="Đang tải trạng thái xác nhận...";
   try{
    const data=await call("casting-receipt-list",{groupId:id});if(current!==generation||!panel.isConnected)return;
    const list=data.receipts||[],count=list.filter(r=>r.confirmed&&r.comparisonCode).length;
    status.textContent=count+"/"+list.length+" BGK đã xác nhận · "+(list.length&&count>list.length/2?"Đủ tỷ lệ cấp phiên; vẫn kiểm tra từng thí sinh":"Chưa đủ trên 50%");
    rows.replaceChildren();
    for(const r of list){
     const card=el("article","rounded-xl border border-rose-100 p-3 space-y-2");card.dataset.graderCode=r.graderCode;
     const top=el("div","flex flex-wrap items-center justify-between gap-2");top.append(el("strong","text-sm text-red-950",r.graderName),el("span",r.confirmed?"text-xs text-emerald-700 font-bold":"text-xs text-gray-500",r.confirmed?"Đã xác nhận":"Chưa xác nhận"));card.append(top);
     if(scope){const progress=el("div","text-xs text-gray-600");progress.dataset.receiptProgress=r.graderCode;card.append(progress);const presence=el("span","text-xs");presence.dataset.presenceCode=r.graderCode;card.append(presence);const view=button("Xem bảng điểm",()=>scope.viewJudge?.(r.graderCode));card.append(view);}
     if(r.comparisonCode){
      card.append(el("p","text-xs font-mono","Mã đối chiếu: "+r.comparisonCode),el("p","text-xs text-gray-600",labels[r.mailStatus]||"Chưa ghi nhận gửi email"));
      const buttons=el("div","flex flex-wrap gap-2");
      buttons.append(button("Xem PDF",()=>scope?.viewOriginal?scope.viewOriginal(r):window.adminExportGraderPDF?.(id,r.graderCode)),button("Gửi lại email đối chiếu",async()=>{if(!window.confirm("Gửi lại biên bản hiện hành đến email đã xác thực của BGK?"))return;const b=buttons.querySelectorAll("button")[1];b.disabled=true;try{const x=await call("resend-grader-completion",{groupId:id,graderId:r.graderId});toast(x.mailAccepted?"Resend đã tiếp nhận email đối chiếu.":"Email chưa gửi thành công; đã ghi nhận trạng thái.");await read();scope?.onChanged?.()}catch(e){toast(e.message,true)}finally{b.disabled=false}}));
      const unlock=button("Mở lại bảng điểm",()=>reopen(id,r,select.selectedOptions[0]?.textContent||id),true);unlock.disabled=!r.canReopen;buttons.append(unlock);card.append(buttons);
     }
     if(r.history?.length){
      const details=el("details","text-xs border-t pt-2");details.append(el("summary","cursor-pointer font-bold text-gray-600","Lịch sử xác nhận và email"));
      for(const h of r.history){const line=el("div","flex flex-wrap items-center justify-between gap-2 py-2");line.append(el("span","",h.code+" · "+(h.kind==="reopen"?"Đã thu hồi":"Xác nhận")+" · "+(labels[h.status]||h.status)));
       if(h.kind==="reopen"&&h.status!=="sent"){const retry=button("Gửi lại thông báo",async()=>{retry.disabled=true;try{const x=await call("retry-receipt-notice",{jobId:h.id});toast(x.mailAccepted?"Đã tiếp nhận thông báo.":"Thông báo đang chờ gửi.");await read()}catch(e){toast(e.message,true)}finally{retry.disabled=false}});line.append(retry)}details.append(line);}
      card.append(details);
     }
     rows.append(card);
    }
    scope?.onRender?.(list);
   }catch(e){if(current===generation)status.textContent=e.message}
  };
  refreshActive=read;select.onchange=read;
  heading.append(button("Làm mới",read));
  // Original realtime monitor is retained in its own container.
  const legacy=scope?Promise.resolve():Promise.resolve(original?.(main)).catch(e=>{main.textContent=e.message});
  try{const g=scope?{groups:[{id:scope.groupId,name:scope.groupName}]}:await call("casting-group-options");if(!panel.isConnected)return;select.append(...(g.groups||[]).map(x=>new Option(x.name,x.id)));if(select.options.length)await read();else status.textContent="Chưa có phiên chấm."}catch(e){status.textContent=e.message}
  await legacy;
 };
}
