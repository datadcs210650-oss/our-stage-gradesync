/* OSC semester actor roster: read-only, post-approval synchronization report. */
export function installCastingActorRoster(){
 const base=window.loadCastingHub;
 if(typeof base!=="function")return;
 let latestHost=null;
 window.loadCastingHub=async function(container){
  await base(container);
  if(!container)return;
  latestHost=container;
  const section=document.createElement("section");
  section.className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm";
  const header=document.createElement("h3");
  header.className="font-extrabold text-sm text-red-900 mb-2";
  header.textContent="Danh sách diễn viên đã đồng bộ vào học kỳ OSC";
  const info=document.createElement("p");
  info.className="text-xs text-gray-500 mb-3";
  info.textContent="Thí sinh PASSED chỉ được bổ sung sau khi BCN duyệt và đồng bộ. Thành viên cũ giữ nguyên hồ sơ, MSSV và lịch sử học kỳ.";
  const button=document.createElement("button");
  button.type="button";
  button.className="bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-2 font-bold text-xs mb-3";
  button.textContent="Làm mới danh sách diễn viên";
  const content=document.createElement("div");content.className="overflow-x-auto text-xs";
  section.append(header,info,button,content);container.append(section);
  const refresh=async()=>{
   const selected=container.querySelector("#gsxCastingSelect")?.value;
   if(!selected)return content.textContent="Chưa có casting được chọn.";
   let term="";
   try{
    const list=await window.oscGradingCall("casting-list");
    term=(list.castings||[]).find(c=>c.id===selected)?.term||"";
    if(!term)return content.textContent="Chưa xác định được học kỳ.";
    const response=await window.oscGradingCall("casting-actor-list",{term});
    content.replaceChildren();
    const count=document.createElement("p");count.className="text-xs text-gray-600 mb-2";
    count.textContent=term+" · "+response.count+" diễn viên đã đồng bộ";content.append(count);
    if(!response.rows?.length){content.append(document.createTextNode("Chưa có diễn viên được duyệt và đồng bộ."));return}
    const table=document.createElement("table");table.className="w-full min-w-[540px] text-xs border-collapse";
    const tr=document.createElement("tr");
    for(const title of ["MSSV","Họ và tên","Mã thành viên OSC"]){
     const th=document.createElement("th");th.textContent=title;th.className="p-2 text-left bg-gray-100 border-b";tr.append(th);
    }
    const thead=document.createElement("thead");thead.append(tr);table.append(thead);
    const tbody=document.createElement("tbody");
    for(const row of response.rows){
     const line=document.createElement("tr");
     for(const val of [row.mssv,row.name,row.memberId]){
      const td=document.createElement("td");td.className="p-2 border-b";td.textContent=val;line.append(td);
     }
     tbody.append(line);
    }
    table.append(tbody);content.append(table);
   }catch(e){content.textContent="Không đọc được danh sách diễn viên: "+(e.message||"lỗi kết nối")}
  };
  button.addEventListener("click",async()=>{
   button.disabled=true;try{await refresh()}finally{button.disabled=false}
  });
  const select=container.querySelector("#gsxCastingSelect");
  select?.addEventListener("change",()=>refresh());
  await refresh();
 };
}
