/* Candidate editing using OSC's actual configured member-field schema.
 * Identity/contact fields remain on the manager-only candidate identity table. */
(()=>{
"use strict";
const api=(name,details={})=>window.oscGradingCall(name,details);
const create=(tag,cls="",text="")=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e};
const control=(type,value="")=>{const e=document.createElement("input");e.type=type;e.value=value;
 e.className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm";return e};
const field=(text,input)=>{const label=create("label","block text-xs font-bold text-gray-700");label.append(create("span","block mb-1",text),input);return label};
const btn=(label,run)=>{const b=create("button","px-3 py-2 bg-red-900 text-white rounded-lg font-semibold text-xs",label);b.type="button";b.onclick=async()=>{if(b.disabled)return;b.disabled=true;
 try{await run()}catch(e){window.showToast?.(e.message||"Không thể lưu hồ sơ.","error")}finally{b.disabled=false}};return b};
let active=[],defs=[],schema=[],selector,form,select,notice,cid;
async function reload(){
 const castingId=document.getElementById("gsxCastingSelect")?.value||"";
 if(!castingId){notice.textContent="Chưa có casting.";return}
 const [candidates,member]=await Promise.all([
  api("casting-candidate-list",{castingId}),
  api("casting-member-schema")
 ]);
 active=candidates.candidates||[];defs=candidates.fields||[];schema=member.fields||[];
 select.replaceChildren();
 for(const c of active){const o=create("option","",c.code+" · "+c.name);o.value=c.id;select.append(o)}
 if(cid&&active.some(c=>c.id===cid))select.value=cid;else cid=active[0]?.id||"";
 show();
}
function show(){
 const item=active.find(c=>c.id===select.value);form.replaceChildren();
 if(!item){notice.textContent="Nhóm thi chưa có thí sinh.";return}
 cid=item.id;notice.textContent="Trường định danh (MSSV/email) chỉ BCN xem. BGK chỉ nhìn thấy trường có quyền xem.";
 const pieces=[];
 function addField(label,key,defaultValue,kind="text"){
  const input=control(kind,defaultValue);input.dataset.key=key;input.dataset.privacy="core";
  pieces.push(field(label,input));return input;
 }
 const name=addField("Họ và tên", "name",item.name);
 const mssv=addField("MSSV", "mssv",item.mssv||item.fields?.mssv||"");
 const email=addField("Email liên hệ", "email",item.email||item.fields?.email||"","email");
 const consent=create("label","flex items-center gap-2 text-xs font-semibold");
 const allow=control("checkbox");allow.checked=item.emailConsent===true;allow.dataset.key="castingEmailConsent";allow.dataset.privacy="core";
 allow.className="w-4 h-4";consent.append(allow,document.createTextNode("Đồng ý nhận email thông báo casting"));
 pieces.push(consent);
 for(const def of defs){
  if(["mssv","email","name","castingEmailConsent"].includes(def.field_key))continue;
  const stored=def.visibility==="admin"?(item.privateFields||{}):(item.fields||{});
  let input;
  if(def.kind==="select"){
   input=create("select","w-full px-3 py-2 border rounded-lg text-sm");
   input.append(new Option("Chưa chọn",""));
   for(const choice of Array.isArray(def.choices)?def.choices:[])input.append(new Option(choice,choice));
   input.value=String(stored[def.field_key]||"");
  }else{
   input=control(def.kind==="date"?"date":def.kind==="number"?"number":def.kind==="email"?"email":"text",
    String(stored[def.field_key]||""));
  }
  input.dataset.key=def.field_key;
  input.dataset.privacy=def.visibility;
  pieces.push(field(def.label+(def.required?" *":"")+" · "+(def.visibility==="admin"?"BCN":def.visibility==="judge"?"BGK":"Công khai"),input));
 }
 const grid=create("div","grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3");
 grid.append(...pieces);
 form.append(grid,btn("Lưu hồ sơ thí sinh",async()=>{
  const fields={mssv:mssv.value,email:email.value,castingEmailConsent:allow.checked};
  for(const input of form.querySelectorAll("[data-key]")){
   if(["name","mssv","email","castingEmailConsent"].includes(input.dataset.key))continue;
   fields[input.dataset.key]=input.value;
  }
  await api("casting-candidate-edit",{castingId:document.getElementById("gsxCastingSelect").value,
   candidateId:item.id,name:name.value,fields});
  window.showToast?.("Đã lưu hồ sơ trên máy chủ.");
  await reload();
 }));
}
async function renderEditor(host){
 const box=create("section","bg-white border border-gray-200 rounded-2xl p-4 space-y-3");
 box.append(create("h3","font-extrabold text-sm text-red-900","Hồ sơ thí sinh · Theo cấu hình thành viên OSC"));
 const top=create("div","grid grid-cols-1 md:grid-cols-2 gap-3");
 select=create("select","w-full px-3 py-2 border rounded-lg text-sm");
 select.onchange=()=>{cid=select.value;show()};
 top.append(field("Chọn thí sinh",select));
 const addRow=create("div","grid grid-cols-1 md:grid-cols-3 gap-2");
 const fieldChoices=create("select","border rounded-lg p-2 text-sm"),privacy=create("select","border rounded-lg p-2 text-sm");
 const vis=[["admin","Chỉ BCN"],["judge","Cho BGK xem"],["public","Công khai nếu duyệt"]];
 for(const [v,t] of vis){const o=new Option(t,v);privacy.append(o)}
 const add=btn("Thêm trường OSC",async()=>{
  if(!fieldChoices.value)throw Error("Chưa chọn trường từ hồ sơ OSC.");
  const f=schema.find(x=>x.key===fieldChoices.value);
  if(!f)throw Error("Trường đã thay đổi, hãy tải lại.");
  await api("casting-field",{castingId:document.getElementById("gsxCastingSelect").value,
   key:f.key,label:f.label,kind:f.kind,visibility:privacy.value,required:f.required,choices:f.choices});
  await reload();
 });
 addRow.append(fieldChoices,privacy,add);
 top.append(field("Bổ sung trường từ cấu hình thành viên OSC",addRow));
 box.append(top);notice=create("p","text-xs text-gray-600");box.append(notice);
 form=create("div","pt-2");box.append(form);
 const updateOptions=()=>{
  fieldChoices.replaceChildren();
  const available=schema.filter(f=>!defs.some(d=>d.field_key===f.key)&&
   !["name","mssv","email","status","department","position"].includes(f.key));
  for(const f of available){const opt=new Option(f.label,f.key);fieldChoices.append(opt)}
  add.disabled=available.length===0;
 };
 const lastReload=reload;
 const refreshed=async()=>{await lastReload();updateOptions()};
 host.append(box);
 try{await refreshed()}catch(e){notice.textContent=e.message}
 const cast=document.getElementById("gsxCastingSelect");
 cast?.addEventListener("change",()=>{cid="";refreshed().catch(e=>notice.textContent=e.message)});
}
const previous=window.loadCastingHub;
if(typeof previous==="function"){
 window.loadCastingHub=async function(root){
  await previous(root);
  await renderEditor(root);
 };
}
})();
