/* Import OSC member profiles as GradeSync contestants without copying private data to BGK. */
export function installCastingImportFromOSC(){
 const earlier=window.loadCastingHub;
 if(typeof earlier!=="function")return;
 window.loadCastingHub=async function(host){
  await earlier(host);
  if(!host)return;
  const root=document.createElement("section");
  root.className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3";
  const title=document.createElement("h3");
  title.textContent="Nhập thí sinh từ danh sách thành viên OSC";
  title.className="font-extrabold text-red-900 text-sm";
  const description=document.createElement("p");
  description.textContent="Đồng bộ một chiều từ hồ sơ thành viên học kỳ sang thí sinh casting; MSSV được đối chiếu để không tạo trùng. Điểm và trạng thái PASSED không thay đổi.";
  description.className="text-xs text-gray-500";
  const group=document.createElement("select");
  group.className="w-full p-2 border rounded-lg text-sm";
  const info=document.createElement("p");info.className="text-xs text-gray-600";
  const checklist=document.createElement("div");
  checklist.className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-52 overflow-y-auto border rounded-xl p-2";
  const tool=document.createElement("div");tool.className="flex flex-wrap items-center gap-2";
  const load=document.createElement("button"),submit=document.createElement("button");
  for(const b of [load,submit]){b.type="button";b.className="bg-red-900 text-white rounded-lg px-4 py-2 font-bold text-xs"}
  load.textContent="Tải thành viên học kỳ";
  submit.textContent="Thêm thí sinh đã chọn (tối đa 10)";
  tool.append(load,submit);root.append(title,description,group,tool,info,checklist);host.append(root);
  const casting=host.querySelector("#gsxCastingSelect");
  const listGroups=async()=>{
   const selected=casting?.value||"";
   const data=await window.oscGradingCall("casting-list");
   group.replaceChildren();
   const c=(data.castings||[]).find(x=>x.id===selected);
   for(const g of (data.groups||[]).filter(g=>g.castingId===selected)){
    const option=document.createElement("option");option.value=g.id;option.textContent=g.name;group.append(option);
   }
   info.textContent=c?c.term+" • "+group.options.length+" nhóm thuộc casting":"Chưa có casting.";
   checklist.replaceChildren();
   return c;
  };
  casting?.addEventListener("change",()=>listGroups().catch(e=>info.textContent=e.message));
  load.onclick=async()=>{
   load.disabled=true;
   try{
    const c=await listGroups();
    if(!c||!group.value)throw Error("Hãy gắn nhóm thi vào casting trước.");
    const people=await window.oscGradingCall("casting-member-picklist",{term:c.term});
    checklist.replaceChildren();
    if(!people.members?.length){info.textContent="Chưa có thành viên học kỳ "+c.term;return}
    for(const m of people.members){
     const label=document.createElement("label");label.className="flex gap-2 items-center bg-gray-50 px-3 py-2 rounded-lg text-xs";
     const input=document.createElement("input");input.type="checkbox";input.className="gsx-osc-import-member";input.value=m.id;
     const name=document.createElement("span");name.textContent=m.mssv+" · "+m.name;
     label.append(input,name);checklist.append(label);
    }
    info.textContent="Đã tải "+people.members.length+" thành viên "+c.term+". Chọn tối đa 10 người/lượt.";
   }catch(e){info.textContent=e.message}finally{load.disabled=false}
  };
  submit.onclick=async()=>{
   const selected=casting?.value||"",ids=[...checklist.querySelectorAll(".gsx-osc-import-member:checked")].map(x=>x.value);
   if(!selected||!group.value||!ids.length||ids.length>10){
    info.textContent="Hãy chọn 1–10 thành viên và nhóm thi hợp lệ.";return
   }
   if(!window.confirm("Thêm "+ids.length+" thành viên OSC vào thí sinh casting?"))return;
   submit.disabled=true;
   try{
    const response=await window.oscGradingCall("casting-import-members",{castingId:selected,groupId:group.value,memberIds:ids});
    info.textContent="Đã nhập "+response.imported+" thí sinh, bỏ qua "+response.skipped+" MSSV đã tồn tại. Không thay đổi bảng điểm.";
    checklist.querySelectorAll("input:checked").forEach(x=>x.checked=false);
    window.showToast?.("Đã đồng bộ thí sinh từ OSC.");
    await window.loadCastingHub(host);
   }catch(e){info.textContent="Không thể đồng bộ: "+e.message}finally{submit.disabled=false}
  };
  try{await listGroups()}catch(e){info.textContent=e.message}
 };
}
