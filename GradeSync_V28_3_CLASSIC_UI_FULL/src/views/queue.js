import { store } from '../state/store.js';
import { esc,toast,$ } from '../utils/dom.js';
import { setQueueState,callNext } from '../services/queue.js';
import { ref,setDoc,serverTimestamp } from '../data/firestore.js';
const qLabel=s=>s==='grading'?'Đang thi':s==='done'?'Hoàn tất':'Đang chờ';
export function renderQueue(){
  const st=store.get(),view=$('#view'),admin=['Admin','SuperAdmin'].includes(st.user.role),groups=admin?[...st.groups.values()]:(st.user.assignedGroups||[]).map(id=>st.groups.get(id)).filter(Boolean);
  if((!st.selectedGroupId||!groups.some(g=>g.id===st.selectedGroupId))&&groups[0])st.selectedGroupId=groups[0].id;
  const cands=[...st.candidates.values()].filter(c=>c.groupId===st.selectedGroupId).sort((a,b)=>{const aa=a.queueStatus==='grading'?1:0,bb=b.queueStatus==='grading'?1:0;if(aa!==bb)return bb-aa;return Number(a.queueOrder||999999)-Number(b.queueOrder||999999)});
  view.innerHTML=`<div class="toolbar"><div class="left"><select id="queue-group" class="select" style="min-width:320px;max-width:480px;font-weight:850">${groups.map(g=>`<option value="${g.id}" ${g.id===st.selectedGroupId?'selected':''}>${esc(g.name)}</option>`).join('')}</select></div>${admin?'<div class="right"><button class="btn primary" id="call-next"><i class="fa-solid fa-bullhorn"></i> Mời thí sinh tiếp theo</button></div>':''}</div><div class="card"><div style="padding:13px 14px;border-bottom:1px solid #edf0f4"><div class="tiny muted">ĐIỀU PHỐI THÍ SINH</div><b>${cands.length} thí sinh trong hàng đợi</b></div>${cands.map((c,i)=>`<div class="queue-row ${c.queueStatus==='grading'?'current':''}"><div class="queue-position">${i+1}</div><div><strong>${esc(c.name)}</strong><div class="tiny muted">${esc(c.code)} · ${qLabel(c.queueStatus)}</div></div><div>${admin?`<label class="badge ${c.isPresent?'ok':'gray'}"><input type="checkbox" data-present="${c.id}" ${c.isPresent?'checked':''}> ${c.isPresent?'Có mặt':'Chưa điểm danh'}</label>`:`<span class="badge ${c.isPresent?'ok':'gray'}">${c.isPresent?'Có mặt':'Chưa điểm danh'}</span>`}</div>${admin?`<div class="queue-actions"><button class="btn small" data-q="waiting" data-id="${c.id}">Chờ</button><button class="btn small ok" data-q="grading" data-id="${c.id}">Đang thi</button><button class="btn small" data-q="done" data-id="${c.id}">Hoàn tất</button></div>`:`<span class="badge ${c.queueStatus==='grading'?'ok':'gray'}">${qLabel(c.queueStatus)}</span>`}</div>`).join('')||'<div class="empty-state"><i class="fa-solid fa-users-slash"></i>Chưa có thí sinh.</div>'}</div>`;
  $('#queue-group')?.addEventListener('change',e=>{st.selectedGroupId=e.target.value;store.emit('selection')});
  if(admin){
    $('#call-next').onclick=async()=>{const c=await callNext(cands);toast(c?`Đã mời ${c.name}`:'Không còn thí sinh đang chờ',c?'ok':'error')};
    view.querySelectorAll('[data-q]').forEach(b=>b.onclick=async()=>setQueueState(st.candidates.get(b.dataset.id),b.dataset.q,Date.now()));
    view.querySelectorAll('[data-present]').forEach(x=>x.onchange=async()=>{const c=st.candidates.get(x.dataset.present),isPresent=x.checked;await setDoc(ref('candidates',c.id),{isPresent,attendanceOrder:isPresent?Date.now():0,attendanceUpdatedAt:serverTimestamp()},{merge:true});toast(isPresent?`Đã điểm danh ${c.name}`:`Đã bỏ điểm danh ${c.name}`)});
  }
}
