import { store } from '../state/store.js';
import { ref,setDoc,serverTimestamp,col,getDocs,query,where,chunkedCommit } from '../data/firestore.js';
import { esc,toast,modal,confirmModal,$,decodeEntities } from '../utils/dom.js';
import { validateImport } from '../utils/importValidation.js';

let filterGroup='ALL',searchTerm='';
const groupFields=g=>Array.isArray(g?.extraFields)?g.extraFields:[];
const cleanBaseKeys=new Set(['SBD','Mã SBD','Mã số','Mã số / SBD','Code','code','Họ tên','Name','name']);
function extraForGroup(row,g){
  const fields=groupFields(g),out={};
  if(fields.length){fields.forEach(f=>out[f.name]=String(row?.[f.name]??'').trim());return out}
  Object.entries(row||{}).forEach(([k,v])=>{if(!cleanBaseKeys.has(k)&&!['valid','errors','index'].includes(k))out[k]=String(v??'').trim()});
  return out;
}
function candidateExtraSummary(c,g){
  const data=c.extraData||{},fields=groupFields(g);
  const entries=fields.length?fields.map(f=>[f.name,data[f.name]]):Object.entries(data);
  const clean=entries.filter(([,v])=>String(v??'').trim()!=='');
  if(!clean.length)return '<span class="muted">—</span>';
  return `<div class="candidate-extra-summary">${clean.slice(0,4).map(([k,v])=>`<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join('')}${clean.length>4?`<span class="muted">+${clean.length-4} trường</span>`:''}</div>`;
}

export function renderCandidates(user){
  const st=store.get(),view=$('#view'),groups=[...st.groups.values()];
  let cands=[...st.candidates.values()];
  if(filterGroup!=='ALL')cands=cands.filter(c=>c.groupId===filterGroup);
  const q=searchTerm.trim().toLowerCase();
  if(q)cands=cands.filter(c=>String(c.name||'').toLowerCase().includes(q)||String(c.code||'').toLowerCase().includes(q)||Object.values(c.extraData||{}).some(v=>String(v||'').toLowerCase().includes(q)));
  view.innerHTML=`
    <div class="toolbar v27-section-head">
      <div><div class="tiny muted">DỮ LIỆU THÍ SINH</div><h3 style="margin:3px 0 0">Quản lý thí sinh</h3><div class="tiny muted" style="margin-top:4px">Quản lý đầy đủ thông tin bổ sung, import có xem trước và phát hiện SBD trùng.</div></div>
      <div class="right"><button class="btn" id="template-btn"><i class="fa-solid fa-file-arrow-down"></i> File mẫu</button><button class="btn" id="export-btn"><i class="fa-solid fa-file-excel"></i> Xuất danh sách</button><button class="btn" id="import-btn"><i class="fa-solid fa-file-import"></i> Import Excel</button><button class="btn primary" id="add-cand"><i class="fa-solid fa-user-plus"></i> Thêm thí sinh</button></div>
    </div>
    <div class="candidate-admin-filters card pad">
      <select id="cand-filter-group" class="select"><option value="ALL">Tất cả nhóm</option>${groups.map(g=>`<option value="${g.id}" ${filterGroup===g.id?'selected':''}>${esc(decodeEntities(g.name))}</option>`).join('')}</select>
      <div class="filter-search"><i class="fa-solid fa-magnifying-glass"></i><input id="cand-search" class="input" placeholder="Tìm tên, SBD, email, SĐT..." value="${esc(searchTerm)}"></div>
      <button class="btn danger" id="bulk-delete" disabled><i class="fa-solid fa-trash"></i> Xóa đã chọn</button>
    </div>
    <div class="table-wrap candidate-admin-table"><table class="table"><thead><tr><th style="width:42px"><input id="cand-check-all" type="checkbox"></th><th>SBD</th><th>Họ tên</th><th>Thông tin bổ sung</th><th>Nhóm</th><th>Có mặt</th><th>Khóa chấm</th><th>Thao tác</th></tr></thead><tbody>${cands.map(c=>{const g=st.groups.get(c.groupId);return`<tr><td><input class="cand-check" type="checkbox" value="${c.id}"></td><td><span class="code">${esc(c.code||'—')}</span></td><td><strong>${esc(c.name||'—')}</strong></td><td>${candidateExtraSummary(c,g)}</td><td><span class="badge gray">${esc(decodeEntities(g?.name||'-'))}</span></td><td>${c.isPresent?'<span class="badge ok"><i class="fa-solid fa-user-check"></i> Có mặt</span>':'<span class="badge gray">Chưa</span>'}</td><td>${c.locked?'<span class="badge danger">Đã khóa</span>':'<span class="badge ok">Đang mở</span>'}</td><td><div class="row-actions"><button class="btn small" data-edit-cand="${c.id}"><i class="fa-solid fa-pen"></i> Sửa</button><button class="btn small ${c.locked?'ok':'danger'}" data-lock="${c.id}">${c.locked?'Mở khóa':'Khóa'}</button><button class="btn small danger" data-del="${c.id}"><i class="fa-solid fa-trash"></i></button></div></td></tr>`}).join('')||'<tr><td colspan="8" class="empty-cell">Không có thí sinh phù hợp.</td></tr>'}</tbody></table></div>`;
  $('#add-cand').onclick=()=>candidateModal(groups,null);
  $('#import-btn').onclick=()=>importModal(groups,[...st.candidates.values()]);
  $('#template-btn').onclick=()=>downloadTemplate(groups);
  $('#export-btn').onclick=()=>exportCandidates([...st.candidates.values()],st.groups);
  $('#cand-filter-group').onchange=e=>{filterGroup=e.target.value;renderCandidates(user)};
  $('#cand-search').oninput=e=>{searchTerm=e.target.value;renderCandidates(user)};
  view.querySelectorAll('[data-edit-cand]').forEach(b=>b.onclick=()=>candidateModal(groups,st.candidates.get(b.dataset.editCand)));
  view.querySelectorAll('[data-lock]').forEach(b=>b.onclick=async()=>{const c=st.candidates.get(b.dataset.lock);await setDoc(ref('candidates',c.id),{locked:!c.locked,lockedAt:serverTimestamp(),lockedBy:user.name||user.email||''},{merge:true});toast(!c.locked?'Đã khóa thí sinh':'Đã mở khóa thí sinh')});
  view.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteCandidateCascade(st.candidates.get(b.dataset.del)));
  const bulk=$('#bulk-delete'),checks=()=>[...view.querySelectorAll('.cand-check:checked')].map(x=>x.value);
  const updateBulk=()=>{bulk.disabled=!checks().length};view.querySelectorAll('.cand-check').forEach(x=>x.onchange=updateBulk);
  $('#cand-check-all').onchange=e=>{view.querySelectorAll('.cand-check').forEach(x=>x.checked=e.target.checked);updateBulk()};
  bulk.onclick=()=>bulkDelete(checks());
}

function extraFieldsHtml(group,data={}){
  const fields=groupFields(group);if(!fields.length)return '<div class="empty-inline">Nhóm này chưa cấu hình trường thông tin bổ sung.</div>';
  return `<div class="candidate-extra-form">${fields.map(f=>`<div><label class="label">${esc(f.name)} ${f.showToGrader?'<span class="field-visible-note">· BGK được xem</span>':''}</label><input class="input candidate-extra-input" data-extra="${esc(f.name)}" value="${esc(data?.[f.name]??'')}"></div>`).join('')}</div>`;
}
function candidateModal(groups,candidate){
  const initialGroup=groups.find(g=>g.id===candidate?.groupId)||groups[0];
  const root=modal({title:candidate?'Chỉnh sửa thí sinh':'Thêm thí sinh',body:`<div class="candidate-editor"><div class="grid grid-2"><div><label class="label">Nhóm</label><select id="c-group" class="select">${groups.map(g=>`<option value="${g.id}" ${g.id===initialGroup?.id?'selected':''}>${esc(decodeEntities(g.name))}</option>`).join('')}</select></div><div><label class="label">SBD / Mã số</label><input id="c-code" class="input" value="${esc(candidate?.code||'')}"></div></div><label class="label" style="margin-top:12px">Họ tên</label><input id="c-name" class="input" value="${esc(candidate?.name||'')}"><div class="editor-subtitle"><span>Thông tin bổ sung</span><small>Được cấu hình theo từng nhóm</small></div><div id="candidate-extra-host">${extraFieldsHtml(initialGroup,candidate?.extraData||{})}</div></div>`,actions:`<span class="tiny muted">Thông tin được đồng bộ realtime sang giao diện chấm.</span><div><button class="btn" data-close>Hủy</button> <button class="btn primary" id="c-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button></div>`});
  const gSelect=root.querySelector('#c-group'),host=root.querySelector('#candidate-extra-host');
  gSelect.onchange=()=>{const g=groups.find(x=>x.id===gSelect.value);host.innerHTML=extraFieldsHtml(g,candidate?.groupId===g?.id?candidate?.extraData||{}:{})};
  root.querySelector('#c-save').onclick=async()=>{
    const groupId=gSelect.value,code=root.querySelector('#c-code').value.trim(),name=root.querySelector('#c-name').value.trim();if(!groupId||!name)return toast('Hãy chọn nhóm và nhập họ tên.','error');
    const extraData={};root.querySelectorAll('.candidate-extra-input').forEach(i=>extraData[i.dataset.extra]=i.value.trim());
    const id=candidate?.id||crypto.randomUUID();
    await setDoc(ref('candidates',id),{groupId,code,name,extraData,isPresent:candidate?.isPresent||false,locked:candidate?.locked||false,queueStatus:candidate?.queueStatus||'waiting',queueOrder:candidate?.queueOrder||Date.now(),updatedAt:serverTimestamp(),createdAt:candidate?.createdAt||serverTimestamp()},{merge:true});
    root.innerHTML='';toast(candidate?'Đã cập nhật thí sinh':'Đã thêm thí sinh');
  };
}

function importModal(groups,candidates){
  const root=modal({title:'Nhập Excel có xem trước',body:`<div class="notice warn" style="margin-bottom:12px"><i class="fa-solid fa-circle-info"></i> Chọn đúng nhóm trước khi tải file. Các cột thông tin bổ sung nên có tên giống cấu hình nhóm.</div><label class="label">Nhóm</label><select id="imp-group" class="select">${groups.map(g=>`<option value="${g.id}">${esc(decodeEntities(g.name))}</option>`).join('')}</select><label class="label" style="margin-top:12px">File Excel / CSV</label><input id="imp-file" class="input" type="file" accept=".xlsx,.xls,.csv"><div id="imp-preview" style="margin-top:14px"></div>`,actions:`<span></span><div><button class="btn" data-close>Hủy</button> <button class="btn primary" id="imp-save" disabled>Nhập các dòng hợp lệ</button></div>`});
  let checked=[];
  root.querySelector('#imp-file').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;const buf=await file.arrayBuffer();const wb=window.XLSX.read(buf);const rows=window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});const groupId=root.querySelector('#imp-group').value,g=groups.find(x=>x.id===groupId);checked=validateImport(rows,candidates.filter(c=>c.groupId===groupId).map(c=>c.code));const fields=groupFields(g);root.querySelector('#imp-preview').innerHTML=`<div class="notice ${checked.some(x=>!x.valid)?'warn':'ok'}">${checked.filter(x=>x.valid).length}/${checked.length} dòng hợp lệ. ${fields.length?`Trường phụ: ${fields.map(x=>esc(x.name)).join(', ')}`:''}</div><div class="table-wrap" style="max-height:390px"><table class="table"><thead><tr><th>#</th><th>SBD</th><th>Họ tên</th>${fields.slice(0,4).map(f=>`<th>${esc(f.name)}</th>`).join('')}<th>Trạng thái</th></tr></thead><tbody>${checked.map(x=>`<tr><td>${x.index}</td><td>${esc(x.row.code)}</td><td>${esc(x.row.name)}</td>${fields.slice(0,4).map(f=>`<td>${esc(x.row[f.name]??'')}</td>`).join('')}<td>${x.valid?'<span class="badge ok">Hợp lệ</span>':`<span class="badge danger">${esc(x.errors.join(', '))}</span>`}</td></tr>`).join('')}</tbody></table></div>`;root.querySelector('#imp-save').disabled=!checked.some(x=>x.valid)
  };
  root.querySelector('#imp-save').onclick=async()=>{const groupId=root.querySelector('#imp-group').value,g=groups.find(x=>x.id===groupId);for(const x of checked.filter(x=>x.valid)){await setDoc(ref('candidates',crypto.randomUUID()),{groupId,code:x.row.code,name:x.row.name,extraData:extraForGroup(x.row,g),isPresent:false,locked:false,queueStatus:'waiting',queueOrder:Date.now()+x.index,createdAt:serverTimestamp()})}root.innerHTML='';toast('Nhập danh sách hoàn tất')};
}
function downloadTemplate(groups){
  const group=groups.find(g=>g.id===(filterGroup!=='ALL'?filterGroup:null))||groups[0];if(!group)return toast('Hãy tạo nhóm trước.','error');
  const row={SBD:'SBD01','Họ tên':'Nguyễn Văn A'};groupFields(group).forEach(f=>row[f.name]='');
  const ws=window.XLSX.utils.json_to_sheet([row]),wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,ws,'Mẫu');window.XLSX.writeFile(wb,`Mau_ThiSinh_${String(group.name||'Nhom').replace(/[\\/:*?"<>|]/g,'_')}.xlsx`);
}
function exportCandidates(candidates,groups){
  const rows=candidates.map(c=>{const g=groups.get(c.groupId),r={'Mã số / SBD':c.code||'','Họ tên':c.name||'',Nhóm:g?.name||'', 'Có mặt':c.isPresent?'Có':'Chưa'};Object.assign(r,c.extraData||{});return r});const ws=window.XLSX.utils.json_to_sheet(rows),wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,ws,'Thí sinh');window.XLSX.writeFile(wb,'GradeSync_DanhSach_ThiSinh.xlsx');
}
async function deleteCandidateCascade(c){if(!c)return;confirmModal(`Xóa ${c.name}? Điểm và lịch sử liên quan cũng bị xóa.`,async()=>{try{const ops=[{type:'delete',ref:ref('candidates',c.id)}];for(const name of ['scores','audit_logs']){const s=await getDocs(query(col(name),where('candidateId','==',c.id)));s.forEach(d=>ops.push({type:'delete',ref:d.ref}))}await chunkedCommit(ops);toast('Đã xóa thí sinh, điểm và lịch sử liên quan')}catch(e){toast(e.message,'error')}})}
function bulkDelete(ids){if(!ids.length)return;confirmModal(`Xóa ${ids.length} thí sinh đã chọn? Điểm và lịch sử liên quan cũng bị xóa.`,async()=>{for(const id of ids){const c=store.get().candidates.get(id);if(c)await deleteCandidateDirect(c)}toast(`Đã xóa ${ids.length} thí sinh.`)})}
async function deleteCandidateDirect(c){const ops=[{type:'delete',ref:ref('candidates',c.id)}];for(const name of ['scores','audit_logs']){const s=await getDocs(query(col(name),where('candidateId','==',c.id)));s.forEach(d=>ops.push({type:'delete',ref:d.ref}))}await chunkedCommit(ops)}
