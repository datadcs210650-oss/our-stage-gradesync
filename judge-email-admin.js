/* Native OSC GradeSync BGK email fields. Loaded after legacy account manager definitions. */
export function installJudgeEmailAdmin({call}){
 const access=new Map();
 const emailRE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 const safe=v=>String(v||"").trim().toLowerCase();
 const valid=value=>emailRE.test(safe(value))&&safe(value).length<=254;
 function input(initial=""){
  const wrapper=document.createElement("label");
  wrapper.className="block text-xs font-semibold text-gray-700 gsx-google-email-field";
  const text=document.createElement("span");
  text.textContent="Email Google giám khảo (được BCN cấp quyền đăng nhập)";
  text.className="block mb-2";
  const e=document.createElement("input");
  e.type="email";e.required=true;e.autocomplete="email";e.value=initial;
  e.placeholder="ten.giamkhao@example.com";e.maxLength=254;
  e.className="block w-full px-4 py-3 border border-gray-200 bg-gray-50 rounded-xl text-sm outline-none";
  wrapper.append(text,e);
  return {wrapper,e};
 }
 const load=window.loadAccountManager;
 window.loadAccountManager=async function(container){
  const value=await load?.(container);
  if(!container)return value;
  try{
   const data=await call("casting-list");
   access.clear();
   for(const g of data.graders||[])access.set(g.id,{
    email:g.email||"",enabled:g.googleEnabled===true,name:g.name||"",assignedGroups:g.assignedGroups||[]});
   const createName=container.querySelector("#acc-name");
   if(createName&&!container.querySelector("#acc-google-email")){
    const {wrapper,e}=input();
    e.id="acc-google-email";
    const target=createName.closest(".relative")||createName.parentElement;
    target?.after(wrapper);
   }
   container.querySelectorAll('button[onclick*="openEditGraderModal"]').forEach(button=>{
    const match=(button.getAttribute("onclick")||"").match(/openEditGraderModal\('([0-9a-f-]{36})'/i);
    if(!match)return;
    const record=access.get(match[1]);
    const card=button.closest(".rounded-3xl");
    if(!card||card.querySelector(".gsx-grader-google-chip"))return;
    const chip=document.createElement("p");
    chip.className="gsx-grader-google-chip text-xs mt-2 text-gray-600 break-all";
    chip.textContent=record?.email?"Email BGK: "+record.email+(record.enabled?" · Được cấp quyền Google":" · Chưa kích hoạt"):"Chưa cấp email Google";
    const groups=card.querySelector(".mb-5");
    if(groups)groups.append(chip);else card.append(chip);
   });
  }catch(error){window.showToast?.("Không tải được thông tin email BGK: "+(error.message||"thử lại"),"error")}
  return value;
 };
 const originalModal=window.openEditGraderModal;
 window.openEditGraderModal=function(graderId,name,code,assignedStr){
  originalModal?.(graderId,name,code,assignedStr);
  const box=document.getElementById("custom-modal-box");
  if(!box||box.querySelector("#edit-grader-google-email"))return;
  const {wrapper,e}=input(access.get(graderId)?.email||"");
  e.id="edit-grader-google-email";
  const base=box.querySelector("#edit-grader-name-modal")?.closest("div");
  if(base)base.after(wrapper);else box.append(wrapper);
 };
 window.saveGraderEdit=async function(graderId){
  const name=document.getElementById("edit-grader-name-modal")?.value.trim()||"";
  const field=document.getElementById("edit-grader-google-email");
  const googleEmail=safe(field?.value);
  if(name.length<2){window.showToast?.("Họ tên giám khảo cần từ hai ký tự.","error");return}
  if(!valid(googleEmail)){
   field?.setCustomValidity("Nhập email Google hợp lệ để cấp quyền.");
   field?.reportValidity();field?.setCustomValidity("");return;
  }
  const groupIds=[...document.querySelectorAll(".grader-edit-chk-modal:checked")].map(x=>x.value);
  const original=access.get(graderId)?.email||"";
  const changed=!!original&&original!==googleEmail;
  const send=async revokeGoogleLink=>call("update-grader",{graderId,name,groupIds,googleEmail,revokeGoogleLink});
  const saveButton=document.querySelector('button[onclick*="saveGraderEdit"]');
  if(saveButton?.disabled)return;if(saveButton)saveButton.disabled=true;
  try{
   try{await send(false)}catch(e){
    if(!changed||!String(e.message).includes("liên kết"))throw e;
    if(!window.confirm("Email cũ đã liên kết tài khoản Google. Thu hồi quyền Google cũ và cấp cho email mới?"))return;
    await send(true);
   }
   window.closeCustomModal?.();
   await window.loadAccountManager?.(document.getElementById("main-content"));
   window.showToast?.("Đã lưu email Google và phân quyền nhóm giám khảo.");
  }catch(e){window.showToast?.("Không lưu được BGK: "+(e.message||"lỗi máy chủ"),"error")}
  finally{if(saveButton)saveButton.disabled=false}
 };
}
