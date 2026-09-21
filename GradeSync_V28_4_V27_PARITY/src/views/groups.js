import { store } from '../state/store.js';
import { ref,setDoc,serverTimestamp,col,getDocs,query,where,chunkedCommit } from '../data/firestore.js';
import { esc,toast,modal,confirmModal,$,decodeEntities } from '../utils/dom.js';
import { audit } from '../services/audit.js';
import { openContentEditor } from './groupContent.js';
import { groupStatus } from '../utils/time.js';

export function renderGroups(user){
  const view=$('#view'),groups=[...store.get().groups.values()];
  view.innerHTML=`
    <div class="toolbar v27-section-head">
      <div>
        <div class="tiny muted">CẤU HÌNH NHÓM CHẤM</div>
        <h3 style="margin:3px 0 0">Quản lý nhóm thi</h3>
        <div class="tiny muted" style="margin-top:4px">Quản lý thời gian, tiêu chí, trường thông tin thí sinh và quyền hiển thị cho giám khảo.</div>
      </div>
      <button class="btn primary" id="add-group"><i class="fa-solid fa-plus"></i> Tạo nhóm mới</button>
    </div>
    <div class="group-admin-grid">
      ${groups.map(g=>groupCard(g)).join('')||'<div class="card pad muted">Chưa có nhóm chấm.</div>'}
    </div>`;
  $('#add-group').onclick=()=>editGroup(null,user);
  view.querySelectorAll('[data-content]').forEach(b=>b.onclick=()=>openContentEditor(store.get().groups.get(b.dataset.content)));
  view.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editGroup(store.get().groups.get(b.dataset.edit),user));
  view.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{
    const g=store.get().groups.get(b.dataset.toggle);
    await setDoc(ref('competition_groups',g.id),{isManuallyOpened:!g.isManuallyOpened,updatedAt:serverTimestamp()},{merge:true});
    toast(!g.isManuallyOpened?'Đã mở nhóm. BGK được phân quyền sẽ nhận trạng thái ngay.':'Đã khóa nhóm. BGK vẫn thấy nhóm nhưng không thể chấm.');
  });
  view.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteGroupCascade(b.dataset.delete,user));
}

function groupCard(g){
  const st=groupStatus(g),criteria=g.criteria||[],extra=g.extraFields||[];
  const visibleExtra=extra.filter(x=>x.showToGrader).length;
  return `<div class="card pad group-admin-card">
    <div class="group-card-top">
      <div class="group-title-wrap">
        <div class="group-icon"><i class="fa-solid fa-layer-group"></i></div>
        <div class="min-w-0"><h3>${esc(decodeEntities(g.name||'Nhóm chấm'))}</h3><div class="tiny muted">${g.openMode==='auto'?'Tự động theo thời gian':'Mở thủ công'} · Điểm đạt ≥ ${Number(g.passScore||0)}</div></div>
      </div>
      <span class="badge ${st.open?'ok':'warn'}"><i class="fa-solid ${st.open?'fa-lock-open':'fa-clock'}"></i> ${esc(st.label)}</span>
    </div>
    <div class="group-summary-grid">
      <div class="group-summary"><span>Tiêu chí</span><b>${criteria.length}</b></div>
      <div class="group-summary"><span>Trường phụ</span><b>${extra.length}</b></div>
      <div class="group-summary"><span>Hiện BGK</span><b>${visibleExtra}</b></div>
      <div class="group-summary"><span>Điểm danh</span><b>${g.attendanceEnabled?'Có':'Không'}</b></div>
    </div>
    <div class="group-chip-list">${criteria.slice(0,4).map(c=>`<span class="group-chip">${esc(c.name)} · ${Number(c.weight||0)}%</span>`).join('')}${criteria.length>4?`<span class="group-chip">+${criteria.length-4}</span>`:''}</div>
    <div class="group-actions">
      <button class="btn small" data-content="${g.id}"><i class="fa-solid fa-book-open"></i> Nội dung chấm</button>
      <button class="btn small" data-edit="${g.id}"><i class="fa-solid fa-pen"></i> Chỉnh sửa</button>
      ${g.openMode==='manual'?`<button class="btn small ${g.isManuallyOpened?'danger':'ok'}" data-toggle="${g.id}"><i class="fa-solid ${g.isManuallyOpened?'fa-lock':'fa-lock-open'}"></i> ${g.isManuallyOpened?'Khóa nhóm':'Mở nhóm'}</button>`:''}
      <button class="btn small danger" data-delete="${g.id}"><i class="fa-solid fa-trash"></i></button>
    </div>
  </div>`;
}

function criteriaRow(c={name:'',weight:0}){
  return `<div class="config-row crit-row">
    <input class="input crit-name" value="${esc(c.name||'')}" placeholder="Tên tiêu chí">
    <div class="weight-wrap"><input class="input crit-weight" type="number" min="0" max="100" step="0.01" value="${Number(c.weight||0)}"><span>%</span></div>
    <button type="button" class="icon-danger remove-row" title="Xóa"><i class="fa-solid fa-trash"></i></button>
  </div>`;
}
function extraRow(f={name:'',showToGrader:true}){
  return `<div class="config-row extra-row">
    <input class="input extra-name" value="${esc(f.name||'')}" placeholder="Ví dụ: Email, SĐT, Chuyên ngành...">
    <label class="visibility-toggle"><input class="extra-show" type="checkbox" ${f.showToGrader!==false?'checked':''}><span><i class="fa-solid fa-eye"></i> Hiện BGK</span></label>
    <button type="button" class="icon-danger remove-row" title="Xóa"><i class="fa-solid fa-trash"></i></button>
  </div>`;
}

function editGroup(g,user){
  const criteria=g?.criteria?.length?g.criteria:[{name:'Tiêu chí 1',weight:100}],extra=g?.extraFields||[];
  const root=modal({
    title:g?'Chỉnh sửa nhóm chấm':'Tạo nhóm chấm',
    body:`<div class="group-editor">
      <section class="editor-section">
        <div class="editor-section-title"><div><span class="editor-kicker">THÔNG TIN NHÓM</span><h4>Cấu hình chung</h4></div></div>
        <div class="grid grid-2">
          <div><label class="label">Tên nhóm</label><input id="g-name" class="input" value="${esc(decodeEntities(g?.name||''))}"></div>
          <div><label class="label">Điểm đạt</label><input id="g-pass" class="input" type="number" min="0" value="${Number(g?.passScore??50)}"></div>
          <div><label class="label">Chế độ mở</label><select id="g-mode" class="select"><option value="manual" ${g?.openMode!=='auto'?'selected':''}>Thủ công</option><option value="auto" ${g?.openMode==='auto'?'selected':''}>Tự động theo thời gian</option></select></div>
          <div><label class="label">Yêu cầu điểm danh</label><select id="g-att" class="select"><option value="1" ${g?.attendanceEnabled?'selected':''}>Có</option><option value="0" ${!g?.attendanceEnabled?'selected':''}>Không</option></select></div>
          <div><label class="label">Giờ mở</label><input id="g-start" class="input" type="datetime-local" value="${toLocal(g?.startTime)}"></div>
          <div><label class="label">Giờ khóa</label><input id="g-end" class="input" type="datetime-local" value="${toLocal(g?.endTime)}"></div>
        </div>
      </section>
      <div class="editor-columns">
        <section class="editor-section">
          <div class="editor-section-title"><div><span class="editor-kicker red">CỘT ĐIỂM</span><h4>Tiêu chí chấm</h4></div><button class="btn small" id="add-crit"><i class="fa-solid fa-plus"></i> Thêm</button></div>
          <div id="criteria-list" class="editor-rows">${criteria.map(criteriaRow).join('')}</div>
          <div class="weight-total">Tổng trọng số: <b id="weight-total">0%</b></div>
        </section>
        <section class="editor-section">
          <div class="editor-section-title"><div><span class="editor-kicker blue">THÔNG TIN THÍ SINH</span><h4>Trường thông tin bổ sung</h4></div><button class="btn small" id="add-extra"><i class="fa-solid fa-plus"></i> Thêm</button></div>
          <div class="tiny muted" style="margin-bottom:10px">Bật “Hiện BGK” cho trường mà giám khảo được phép xem khi chấm.</div>
          <div id="extra-list" class="editor-rows">${extra.length?extra.map(extraRow).join(''):'<div class="empty-inline" id="extra-empty">Chưa có trường bổ sung.</div>'}</div>
        </section>
      </div>
    </div>`,
    actions:`<span class="tiny muted">Thay đổi sẽ đồng bộ realtime tới BGK.</span><div><button class="btn" data-close>Hủy</button> <button class="btn primary" id="save-group"><i class="fa-solid fa-floppy-disk"></i> Lưu nhóm</button></div>`
  });
  const list=root.querySelector('#criteria-list'),extraList=root.querySelector('#extra-list'),total=root.querySelector('#weight-total');
  const updateTotal=()=>{const sum=[...root.querySelectorAll('.crit-weight')].reduce((s,x)=>s+Number(x.value||0),0);total.textContent=`${sum}%`;total.className=Math.abs(sum-100)<.01?'ok-text':'danger-text'};
  const wireRemoves=()=>root.querySelectorAll('.remove-row').forEach(b=>b.onclick=()=>{b.closest('.config-row')?.remove();updateTotal()});
  root.querySelector('#add-crit').onclick=()=>{list.insertAdjacentHTML('beforeend',criteriaRow({name:'',weight:0}));wireRemoves();updateTotal()};
  root.querySelector('#add-extra').onclick=()=>{root.querySelector('#extra-empty')?.remove();extraList.insertAdjacentHTML('beforeend',extraRow());wireRemoves()};
  root.querySelectorAll('.crit-weight').forEach(x=>x.oninput=updateTotal);wireRemoves();updateTotal();
  list.addEventListener('input',e=>{if(e.target.classList.contains('crit-weight'))updateTotal()});
  root.querySelector('#save-group').onclick=async()=>{
    const name=root.querySelector('#g-name').value.trim();if(!name)return toast('Tên nhóm không được để trống.','error');
    const criteria=[...root.querySelectorAll('.crit-row')].map(r=>({name:r.querySelector('.crit-name').value.trim(),weight:Number(r.querySelector('.crit-weight').value||0)})).filter(x=>x.name);
    const sum=criteria.reduce((s,x)=>s+x.weight,0);if(!criteria.length)return toast('Nhóm phải có ít nhất 1 tiêu chí.','error');if(Math.abs(sum-100)>.01)return toast(`Tổng trọng số phải bằng 100% (hiện ${sum}%).`,'error');
    const extraFields=[...root.querySelectorAll('.extra-row')].map(r=>({name:r.querySelector('.extra-name').value.trim(),showToGrader:r.querySelector('.extra-show').checked})).filter(x=>x.name);
    const dup=new Set(),dups=[];extraFields.forEach(x=>{const k=x.name.toLowerCase();if(dup.has(k))dups.push(x.name);dup.add(k)});if(dups.length)return toast(`Trường thông tin bị trùng: ${dups.join(', ')}`,'error');
    const id=g?.id||crypto.randomUUID();
    await setDoc(ref('competition_groups',id),{
      name,passScore:Number(root.querySelector('#g-pass').value||0),criteria,extraFields,
      openMode:root.querySelector('#g-mode').value,attendanceEnabled:root.querySelector('#g-att').value==='1',
      startTime:root.querySelector('#g-start').value?new Date(root.querySelector('#g-start').value):null,
      endTime:root.querySelector('#g-end').value?new Date(root.querySelector('#g-end').value):null,
      isManuallyOpened:g?.isManuallyOpened||false,updatedAt:serverTimestamp(),createdAt:g?.createdAt||serverTimestamp()
    },{merge:true});
    await audit(g?'GROUP_UPDATE':'GROUP_CREATE',{groupId:id,groupName:name},user);root.innerHTML='';toast('Đã lưu nhóm và đồng bộ cấu hình.');
  };
}
function toLocal(v){if(!v)return'';const d=v.toDate?v.toDate():new Date(v);if(Number.isNaN(d.getTime()))return'';d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)}
async function deleteGroupCascade(id,user){confirmModal('Xóa nhóm sẽ xóa toàn bộ thí sinh, điểm, lịch sử, trạng thái nộp và gỡ phân quyền nhóm. Tiếp tục?',async()=>{try{const collections=['candidates','scores','audit_logs','grader_verifications','submission_notifications'];const ops=[];for(const c of collections){const s=await getDocs(query(col(c),where('groupId','==',id)));s.forEach(d=>ops.push({type:'delete',ref:d.ref}))}ops.push({type:'delete',ref:ref('competition_groups',id)});ops.push({type:'delete',ref:ref('attendance_realtime',id)});const users=await getDocs(col('users'));users.forEach(d=>{const x=d.data();if((x.assignedGroups||[]).includes(id))ops.push({type:'set',ref:d.ref,data:{assignedGroups:(x.assignedGroups||[]).filter(v=>v!==id)},options:{merge:true}})});await chunkedCommit(ops);await audit('GROUP_DELETE',{groupId:id},user);toast('Đã xóa nhóm và dữ liệu liên quan')}catch(e){toast(e.message,'error')}})}
