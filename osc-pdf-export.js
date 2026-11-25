/* PDF exports are issued from trusted OSC server data, never browser score state. */
(()=>{
"use strict";
const el=(tag,cls,text)=>{const x=document.createElement(tag);x.className=cls||"";if(text!==undefined)x.textContent=text;return x};
const field=(label,control)=>{const box=el("label","grid gap-1 text-xs font-bold text-slate-600");box.append(el("span","",label),control);return box};
const select=()=>el("select","w-full min-w-0 border border-slate-200 rounded-xl px-3 py-3 bg-white text-sm text-slate-900");
const option=(val,name)=>new Option(name,val);
const button=(name,primary=false)=>{const b=el("button",(primary?"bg-red-900 text-white":"bg-white border border-rose-200 text-red-900")+" rounded-xl px-4 py-3 font-bold text-sm",name);b.type="button";return b};
const box=()=>document.getElementById("custom-modal-box");
const call=(action,body)=>window.oscGradingCall(action,body);
const reportTitle="BIÊN BẢN CHẤM THI KẾT QUẢ";
const authorized=()=>["Admin","SuperAdmin"].includes(window.currentUserData?.role);
const part=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"D").toUpperCase().replace(/[^A-Z0-9_ -]/g," ").replace(/\s+/g," ").trim().slice(0,95)||"KHONG TEN";
function nameFor(g,judge){return "NTCD_"+part(g?.name)+"_"+(!judge?"HOI DONG GIAM KHAO":part(judge.graderName)+"_"+(/^[0-9]{8}$/.test(judge.comparisonCode||"")?judge.comparisonCode:"CHUA XAC NHAN"))+".pdf";}
let url="",sequence=0;
function clearUrl(){if(url){URL.revokeObjectURL(url);url=""}}
window.addEventListener("pagehide",clearUrl);
function download(link){const a=document.createElement("a");a.href=link.url;a.download=link.filename;a.click();}
async function requestReport(args){if(!authorized())throw Error("Không có quyền xuất biên bản.");const r=await call("casting-pdf-export",args);if(!r?.ok||typeof r.pdfBase64!=="string"||!/^NTCD_.+\.pdf$/i.test(r.filename))throw Error("Máy chủ chưa xác nhận phát hành PDF.");
 const bytes=Uint8Array.from(atob(r.pdfBase64),s=>s.charCodeAt(0));if(String.fromCharCode(...bytes.slice(0,5))!=="%PDF-")throw Error("Tệp PDF không hợp lệ.");
 if(!crypto.subtle)throw Error("Trình duyệt không hỗ trợ kiểm tra PDF.");
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");if(sha!==r.sha256)throw Error("Tệp tải về không khớp mã SHA-256.");
 return {...r,blob:new Blob([bytes],{type:"application/pdf"})};
}
async function openConfig(groupId="",graderCode="ALL"){
 if(!authorized())return;
 const token=++sequence;clearUrl();window.showLoading?.(true,"Chuẩn bị biên bản PDF...");
 try{
  let groups=Object.entries(window._overviewCache?.groupMap||{}).map(([id,g])=>({id,...g}));if(!groups.length||groupId&&!groups.some(g=>g.id===groupId))groups=(await call("casting-list",{})).groups||[];
  if(token!==sequence)return;if(!groups.length)throw Error("Chưa có phiên chấm.");
  const group=select(),grader=select(),result=select(),attendance=select(),orientation=select(),title=el("input","w-full border border-slate-200 rounded-xl px-3 py-3 text-sm"),hidden=el("input","accent-red-900");title.maxLength=160;title.value=reportTitle;hidden.type="checkbox";
  group.append(...groups.map(g=>option(g.id,g.name)));if(groups.some(g=>g.id===groupId))group.value=groupId;
  result.append(option("ALL","Tất cả kết quả"),option("PASS","ĐẠT"),option("FAIL","KHÔNG ĐẠT"));attendance.append(option("ALL","Tất cả thí sinh"),option("PRESENT","Có mặt"),option("ABSENT","Vắng mặt"));orientation.append(option("landscape","A4 ngang (khuyến nghị)"),option("portrait","A4 dọc"));
  const file=el("div","rounded-xl bg-rose-50 border border-rose-100 p-3 break-all text-xs font-bold text-red-900"),hint=el("p","text-xs text-slate-500","Chỉ biên bản cá nhân đã xác nhận OTP có mã đối chiếu.");
  const wrap=el("div","space-y-4"),heading=el("h3","text-xl font-black text-red-950","Xuất biên bản PDF"),note=el("p","text-xs text-slate-600 leading-relaxed","Tệp được tạo từ dữ liệu máy chủ. Hàng dữ liệu và khối xác nhận không bị chia trang. Khi quá nhiều tiêu chí, bảng được chia thành các phần có cột định danh lặp lại.");
  const form=el("div","grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-rose-100 bg-slate-50 p-4");const att=field("Lọc điểm danh",attendance),extra=el("label","flex items-center gap-2 text-xs font-bold text-slate-700");extra.append(hidden,el("span","","In kèm thông tin ẩn"));
  form.append(field("Phiên chấm",group),field("Giám khảo",grader),field("Lọc kết quả",result),att,field("Khổ giấy",orientation),field("Tiêu đề bản in",title),extra);
  const preview=button("Xem trước PDF",true),save=button("Tải PDF",true),cancel=button("Đóng");const controls=el("div","flex flex-wrap gap-2 justify-end sticky bottom-0 bg-white pt-3");controls.append(cancel,preview,save);
  const previewHost=el("div","space-y-2");wrap.append(heading,note,form,field("Tên file tự động",file),hint,previewHost,controls);const modal=box();modal.replaceChildren(wrap);modal.className="bg-white p-4 sm:p-6 rounded-3xl shadow-2xl w-[96%] max-w-[860px] overflow-auto border border-white/50 my-auto";modal.style.maxHeight="calc(100dvh - 28px)";window.openModal?.();
  let judges=[],generation=0,currentReport=null;
  const selectedGroup=()=>groups.find(x=>x.id===group.value),chosenJudge=()=>judges.find(j=>j.graderCode===grader.value);
  function invalidate(){generation++;currentReport=null;clearUrl();previewHost.replaceChildren();file.textContent=nameFor(selectedGroup(),chosenJudge());}
  async function refreshJudges(wanted="ALL"){
   const version=++generation,g=selectedGroup();preview.disabled=save.disabled=true;grader.disabled=true;grader.replaceChildren(option("ALL","Hội đồng Giám khảo"));judges=[];att.hidden=!g?.attendanceEnabled;extra.hidden=!(g?.extraFields||[]).some(f=>!f.showToGrader);if(att.hidden)attendance.value="ALL";if(extra.hidden)hidden.checked=false;
   try{const directory=await call("casting-receipt-list",{groupId:g.id});if(token!==sequence||version!==generation||!wrap.isConnected)return;judges=(directory.receipts||[]).filter(j=>j.graderCode);grader.append(...judges.map(j=>option(j.graderCode,j.graderName+(j.confirmed?" · Đã xác nhận":" · Chưa xác nhận"))));if(judges.some(j=>j.graderCode===wanted))grader.value=wanted;invalidate();hint.textContent="Mã đối chiếu chỉ hiển thị trên biên bản cá nhân đã xác nhận OTP.";preview.disabled=save.disabled=false;grader.disabled=false;}
   catch(e){if(token===sequence&&version===generation){hint.textContent=e.message||"Không tải được danh sách BGK.";}}
  }
  group.onchange=()=>{invalidate();refreshJudges()};[grader,result,attendance,orientation,hidden].forEach(x=>x.onchange=invalidate);title.oninput=invalidate;
  cancel.onclick=()=>{sequence++;clearUrl();window.closeCustomModal?.()};
  async function run(show){
   if(preview.disabled||save.disabled)return;const version=generation;preview.disabled=save.disabled=true;const lockedControls=[group,grader,result,attendance,orientation,title,hidden];lockedControls.forEach(x=>x.disabled=true);hint.textContent="Đang tạo và lưu bản PDF gốc...";
   try{
    if(!currentReport){const report=await requestReport({groupId:group.value,graderCode:grader.value,resultFilter:result.value,attendanceFilter:attendance.value,orientation:orientation.value,docTitle:title.value,expHidden:hidden.checked});if(token!==sequence||generation!==version||!wrap.isConnected)return;clearUrl();url=URL.createObjectURL(report.blob);currentReport={...report,url};file.textContent=report.filename;}
    if(show){const frame=el("iframe","w-full rounded-xl border border-slate-200");frame.title="Xem trước biên bản PDF";frame.src=currentReport.url;frame.style.height="min(55dvh, 540px)";const help=el("p","text-xs text-slate-500","Nếu trình duyệt không hiển thị bản xem trước, hãy dùng Tải PDF.");previewHost.replaceChildren(frame,help);}
    else download(currentReport);
    hint.textContent="Đã tạo "+currentReport.pages+" trang. "+(currentReport.confirmed?"Bản đã xác nhận/đối soát.":"Bản chưa xác nhận đầy đủ.");
   }catch(e){hint.textContent=e.message||"Không tạo được PDF.";window.showToast?.(hint.textContent,"error")}
   finally{if(token===sequence&&version===generation){preview.disabled=save.disabled=false;lockedControls.forEach(x=>x.disabled=false)}}
  }
  preview.onclick=()=>run(true);save.onclick=()=>run(false);await refreshJudges(graderCode);
 }catch(e){window.showToast?.(e.message,"error")}finally{window.showLoading?.(false)}
}
window.openPDFConfigModalLive=()=>openConfig();
window.adminExportGraderPDF=(groupId,graderCode)=>openConfig(groupId,graderCode);
window.executePDFExport=async function(groupId,graderCode,rF,title,signerTitle,graderOptionText,docTitle,attendanceFilter,expHidden){if(!authorized())return;window.showLoading?.(true,"Đang tạo PDF...");try{const r=await requestReport({groupId,graderCode,resultFilter:rF||"ALL",attendanceFilter:attendanceFilter||"ALL",docTitle,expHidden:!!expHidden,orientation:"landscape"});clearUrl();url=URL.createObjectURL(r.blob);download({...r,url});window.showToast?.("Đã tạo biên bản PDF.")}catch(e){window.showToast?.(e.message,"error")}finally{window.showLoading?.(false)}};
})();
