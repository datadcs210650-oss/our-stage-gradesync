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
async function renderEditor(host){
let active=[],defs=[],schema=[],form,notice,cid,reloadRoster,activeGroup;
let requestVersion=0;
let castingSelector;
let readOnly=false;
async function reload(){
 const castingId=castingSelector.value||null;
 if(!activeGroup){notice.textContent="Chọn hồ sơ trong danh sách.";return}
 const version=++requestVersion;
 const candidates=await api("casting-candidate-list",{castingId,groupId:activeGroup.groupId});
 if(!host.isConnected||version!==requestVersion)return;
 readOnly=["published","archived"].includes(candidates.casting?.status);
 active=candidates.candidates||[];defs=candidates.fields||[];
 show();
}
function show(){
 const item=active.find(c=>c.id===cid);form.replaceChildren();
 if(!item){notice.textContent="Nhóm thi chưa có thí sinh.";return}
 heading.textContent=item.name+" · "+item.code;notice.textContent="Trường định danh (MSSV/email) chỉ BCN xem. BGK chỉ nhìn thấy trường có quyền xem.";
 const pieces=[];
 function addField(label,key,defaultValue,kind="text"){
  const input=control(kind,defaultValue);input.dataset.key=key;input.dataset.privacy="core";
  pieces.push(field(label,input));return input;
 }
 const name=addField("Họ và tên", "name",item.name);
 const mssv=addField("MSSV", "mssv",item.mssv||item.fields?.mssv||"");
 const email=addField("Email liên hệ", "email",item.email||item.fields?.email||"","email");
 const phone=addField("Điện thoại","phone",item.privateFields?.phone??item.fields?.phone??
  item.privateFields?.sdt??item.fields?.sdt??item.privateFields?.phoneNumber??item.fields?.phoneNumber??
  item.privateFields?.["Số điện thoại"]??item.fields?.["Số điện thoại"]??item.fields?.["Điện thoại"]??"","tel");
 const consent=create("label","flex items-center gap-2 text-xs font-semibold");
 const allow=control("checkbox");allow.checked=item.emailConsent===true;allow.dataset.key="castingEmailConsent";allow.dataset.privacy="core";
 allow.className="w-4 h-4";consent.append(allow,document.createTextNode("Thí sinh đã đồng ý nhận email kết quả"));
 pieces.push(consent);
 const isCore=value=>["mssv","masosinhvien","email","gmail","emaillienhe","phone","phonenumber","sdt","sodienthoai","dienthoai","name","castingemailconsent"].includes(String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replaceAll("đ","d").replace(/[^a-z0-9]/g,""));
 const flexible=new Set([...Object.keys(item.fields||{}),...Object.keys(item.privateFields||{}),
  ...(activeGroup.extraFieldNames||[])]);
 const known=new Set(defs.map(def=>def.field_key));
 const fieldsToEdit=[...defs,...[...flexible].filter(key=>!known.has(key)&&!isCore(key)&&
  !["__proto__","constructor","prototype"].includes(key)).map(key=>({
   field_key:key,label:key,kind:"text",visibility:Object.hasOwn(item.privateFields||{},key)?"admin":"judge"
  }))];
 for(const def of fieldsToEdit){
  if(isCore(def.field_key)||isCore(def.label))continue;
  const stored=def.visibility==="admin"?(item.privateFields||{}):(item.fields||{});
  let input;
  if(def.kind==="select"){
   input=create("select","w-full px-3 py-2 border rounded-lg text-sm");
   input.append(new Option("Chưa chọn",""));
   for(const choice of Array.isArray(def.choices)?def.choices:[])input.append(new Option(choice,choice));
   const current=String(stored[def.field_key]??"");
   if(current&&![...input.options].some(option=>option.value===current))input.append(new Option(current,current));
   input.value=current;
  }else{
   input=control(def.kind==="date"?"date":def.kind==="number"?"number":def.kind==="email"?"email":"text",
    String(stored[def.field_key]??""));
  }
  input.dataset.key=def.field_key;
  input.dataset.initial=input.value;
  pieces.push(field(def.label+(def.required?" *":"")+" · "+(def.visibility==="admin"?"BCN":def.visibility==="judge"?"BGK":"Công khai"),input));
 }
 const grid=create("div","grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3");
 grid.append(...pieces);
 form.append(grid);
 if(readOnly){
  for(const input of grid.querySelectorAll("input,select"))input.disabled=true;
  form.append(create("p","text-xs text-gray-500","Kết quả đã công bố. Hồ sơ chỉ xem."));
  return;
 }
 form.append(btn("Lưu hồ sơ thí sinh",async()=>{
  const fields={mssv:mssv.value,email:email.value,phone:phone.value,castingEmailConsent:allow.checked};
  for(const input of grid.querySelectorAll("[data-key]")){
   if(["name","mssv","email","phone","castingEmailConsent"].includes(input.dataset.key))continue;
   if(input.value!==input.dataset.initial)fields[input.dataset.key]=input.value;
  }
  if(!email.checkValidity()){email.reportValidity();return}
  await api("casting-candidate-edit",{castingId:castingSelector.value||null,
   candidateId:item.id,name:name.value,fields,version:item.version,identityVersion:item.identityVersion});
  window.showToast?.("Đã lưu hồ sơ trên máy chủ.");
  await reload();
  await reloadRoster?.();
  box.close();
 }));
}
// Danh sách có thẩm quyền từ OSC bridge, không phụ thuộc bộ nhớ/cache của bảng chấm.
async function renderRoster(host,onEdit){
 const box=create("section","bg-white border border-rose-100 rounded-2xl p-5 space-y-4 shadow-sm");
 box.id="gsx-candidate-roster";
 const title=create("h3","font-black text-red-900 text-base","Danh sách thí sinh toàn hệ thống");
 const summary=create("p","text-xs text-gray-500","Đang đối chiếu thí sinh trên máy chủ...");
 const controls=create("div","grid grid-cols-1 md:grid-cols-[1fr_240px_auto] gap-2");
 const search=control("search");search.placeholder="Tìm họ tên, SBD, MSSV, email hoặc điện thoại";
 const group=create("select","w-full p-2 border border-rose-100 rounded-xl text-sm");
 const refresh=btn("Tải lại",load);
 controls.append(search,group,refresh);
 const status=create("p","text-xs text-gray-500");
 const tableWrap=create("div","overflow-auto max-h-[550px] border rounded-xl");
 const table=create("table","w-full min-w-[820px] text-left text-xs");
 table.innerHTML='<thead class="sticky top-0 bg-rose-50 text-red-950"><tr><th class="p-3">SBD</th><th class="p-3">Họ và tên</th><th class="p-3">Học kỳ</th><th class="p-3">Nhóm / phiên chấm</th><th class="p-3">MSSV</th><th class="p-3">Email</th><th class="p-3">Điện thoại</th><th class="p-3">Trường phụ</th><th class="p-3">Hồ sơ</th></tr></thead><tbody></tbody>';
 const body=table.querySelector("tbody");tableWrap.append(table);
 box.append(title,summary,controls,status,tableWrap);host.prepend(box);
 let records=[];
 const render=()=>{
  const term=search.value.trim().toLocaleLowerCase("vi");
  const selected=group.value;
  const visible=records.filter(item=>(!selected||item.groupId===selected)&&
   (!term||[item.name,item.code,item.term,item.groupName,item.mssv,item.email,item.phone].some(v=>String(v||"").toLocaleLowerCase("vi").includes(term))));
  body.replaceChildren();
  const shown=visible;
  for(const item of shown){
   const tr=create("tr","border-b hover:bg-rose-50/50");
   for(const value of [item.code,item.name,item.term,item.groupName,item.mssv,item.email,item.phone]){
    tr.append(create("td","p-3",String(value||"—")));
   }
   const extras=create("td","p-3 min-w-40");
   for(const field of item.extras||[]){
    if(field.value!=null&&String(field.value)!=="")
     extras.append(create("div","break-words",field.label+" — "+String(field.value)));
   }
   if(!extras.childNodes.length)extras.textContent="—";
   tr.append(extras);
   const cell=create("td","p-3");
   const edit=btn("Xem / sửa",async()=>{
     try{await onEdit(item)}catch(e){status.textContent="Không mở được hồ sơ: "+e.message}
    });
   edit.classList.add("whitespace-nowrap");cell.append(edit);
   tr.append(cell);body.append(tr);
  }
  if(!shown.length){const tr=create("tr"),td=create("td","text-center p-8 text-gray-500",records.length?"Không có thí sinh phù hợp bộ lọc.":"Chưa có thí sinh. Dùng công cụ thêm mới, Import Excel hoặc nhập từ thành viên OSC ở bên dưới.");td.colSpan=9;tr.append(td);body.append(tr)}
  status.textContent="Hiển thị "+shown.length+"/"+visible.length+" thí sinh phù hợp";
 };
 async function load(){
  status.textContent="Đang tải dữ liệu thí sinh...";
  const data=await api("casting-candidate-roster");
  records=Array.isArray(data.rows)?data.rows:[];
  const was=group.value;group.replaceChildren(new Option("Tất cả học kỳ và nhóm",""));
  const unique=new Map(records.map(c=>[c.groupId,{id:c.groupId,label:c.term+" · "+c.groupName}]));
  for(const item of [...unique.values()].sort((a,b)=>a.label.localeCompare(b.label,"vi"))){
   const opt=new Option(item.label,item.id);group.append(opt);
  }
  if([...group.options].some(x=>x.value===was))group.value=was;
  summary.textContent=records.length+" thí sinh · "+unique.size+" nhóm có thí sinh. Danh sách lấy trực tiếp từ hệ thống.";
  render();
 }
 search.addEventListener("input",render);group.addEventListener("change",render);
 reloadRoster=load;
 try{await load()}catch(e){summary.textContent="Không tải được danh sách thí sinh từ hệ thống.";status.textContent=e.message;body.replaceChildren()}
}
 const box=create("dialog","bg-white border rounded-2xl p-5 space-y-4");
 box.style.cssText="width:min(56rem,94vw);max-height:88vh;margin:auto;overflow:auto";
 box.setAttribute("aria-labelledby","candidate-profile-title");
 const heading=create("h3","font-bold text-red-900");
 heading.id="candidate-profile-title";
 const bar=create("div","flex items-center justify-between gap-3");
 bar.append(heading,btn("Đóng",()=>box.close()));box.append(bar);
 castingSelector=create("select","w-full px-3 py-2 border rounded-xl text-sm");
 castingSelector.id="gsxCastingSelect";
 castingSelector.hidden=true;box.append(castingSelector);
 const top=create("div","grid grid-cols-1 md:grid-cols-2 gap-3");
 const addRow=create("div","grid grid-cols-1 md:grid-cols-3 gap-2");
 const fieldChoices=create("select","border rounded-lg p-2 text-sm"),privacy=create("select","border rounded-lg p-2 text-sm");
 const vis=[["admin","Chỉ BCN"],["judge","Cho BGK xem"],["public","Công khai nếu duyệt"]];
 for(const [v,t] of vis){const o=new Option(t,v);privacy.append(o)}
 const add=btn("Thêm trường OSC",async()=>{
  if(!castingSelector.value||!fieldChoices.value)throw Error("Chưa chọn trường thuộc casting.");
  const f=schema.find(x=>x.key===fieldChoices.value);
  if(!f)throw Error("Trường đã thay đổi, hãy tải lại.");
  await api("casting-field",{castingId:castingSelector.value,
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
 const refreshed=async()=>{await reload();updateOptions();addRow.hidden=!castingSelector.value||readOnly};

 host.append(box);
 let schemaPromise;
 await renderRoster(host,async item=>{
 
  activeGroup=item;
  castingSelector.replaceChildren(new Option(item.castingName,item.castingId||""));
  cid=item.id;
  if(item.castingId){
   schemaPromise ||= api("casting-member-schema").then(data=>data.fields||[]).catch(()=>[]);
   schema=await schemaPromise;
  }else schema=[];
  if(activeGroup!==item)return;
  await refreshed();
  if(activeGroup!==item||!host.isConnected)return;
  if(!box.open)box.showModal();
 });
}
const previous=window.loadStudentList;
if(typeof previous==="function"){
 window.loadStudentList=async function(root){
  root.replaceChildren();
  const tools=create("details","mt-4 bg-white border rounded-2xl p-4");
  tools.append(create("summary","cursor-pointer font-bold text-sm","Thêm, nhập và quản lý thí sinh"));
  const legacy=create("div","mt-4");tools.append(legacy);root.append(tools);
  try{await previous(legacy)}
  catch(e){
   legacy.replaceChildren(create("p","p-4 text-red-800","Bảng quản lý cũ chưa tải được: "+e.message));
  }
  try{await renderEditor(root)}
  catch(e){root.append(create("p","p-4 text-red-800","Không thể tải danh sách thí sinh: "+e.message))}
 };
}
})();
