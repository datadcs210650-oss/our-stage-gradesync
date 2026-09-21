import { store } from '../state/store.js';
import { esc,toast,$,confirmModal } from '../utils/dom.js';
import { groupStatus } from '../utils/time.js';
import { saveScore,validateBeforeSubmit } from '../services/scoring.js';
import { ref,setDoc,serverTimestamp } from '../data/firestore.js';
import { audit } from '../services/audit.js';
import { normalizeContent,sectionAccess } from '../services/content.js';

const timers=new Map();
const pendingDrafts=new Map();
let contentSection='scores';
let viewMode=localStorage.getItem('gs28GradingView')||'personal';
let searchTerm='';

const queueLabel=s=>s==='grading'?'Đang thi':s==='done'?'Hoàn tất':'Đang chờ';
const userScore=(st,cid)=>st.scores.get(`${st.user.authUid}_${cid}`)||[...st.scores.values()].find(s=>s.candidateId===cid&&s.graderUid===st.user.authUid)||{};
function groupCandidates(st,gid){
  return [...st.candidates.values()].filter(c=>c.groupId===gid).sort((a,b)=>{
    const ac=a.queueStatus==='grading'?1:0,bc=b.queueStatus==='grading'?1:0;
    if(ac!==bc)return bc-ac;
    const ap=a.isPresent?1:0,bp=b.isPresent?1:0;
    if(ap!==bp)return bp-ap;
    return Number(a.queueOrder||999999)-Number(b.queueOrder||999999);
  });
}
function candidateFields(c){
  const rows=[['Mã số / SBD',c.code||'-'],['Họ tên',c.name||'-']];
  Object.entries(c.extraData||{}).forEach(([k,v])=>rows.push([k,v??'-']));
  return rows;
}
function scoreResult(s,g){
  if(!s?.candidateId)return '<span class="badge gray">CHỜ</span>';
  return Number(s.totalScore)>=Number(g.passScore)?'<span class="badge ok">ĐẠT</span>':'<span class="badge danger">TRƯỢT</span>';
}

export function renderGrading(){
  const st=store.get(),view=$('#view'),user=st.user,admin=['Admin','SuperAdmin'].includes(user.role);
  const allowed=admin?[...st.groups.values()]:[...(user.assignedGroups||[])].map(id=>st.groups.get(id)).filter(Boolean);
  if((!st.selectedGroupId||!allowed.some(x=>x.id===st.selectedGroupId))&&allowed[0])st.selectedGroupId=allowed[0].id;
  const g=st.groups.get(st.selectedGroupId),cfg=g?normalizeContent(g):null,status=g?groupStatus(g):null;
  const contentTabs=g?`<div class="tabs grading-tabs">
    <button data-section="scores" class="${contentSection==='scores'?'active':''}"><i class="fa-solid fa-table-cells"></i> Bảng chấm</button>
    ${cfg?.scoringContent?.enabled?`<button data-section="scoring" class="${contentSection==='scoring'?'active':''}"><i class="fa-solid fa-book-open"></i> Nội dung tiêu chí</button>`:''}
    ${cfg?.interviewContent?.enabled?`<button data-section="interview" class="${contentSection==='interview'?'active':''}"><i class="fa-regular fa-file-lines"></i> Câu hỏi phỏng vấn</button>`:''}
  </div>`:'';
  view.innerHTML=`
    <div class="grading-head">
      <div class="grading-head-left">
        <span class="badge ${status?.open?'ok':'warn'}"><i class="fa-solid ${status?.open?'fa-lock-open':'fa-clock'}"></i> ${esc(status?.label||'Chưa có nhóm')}</span>
        <select id="grade-group" class="select group-select">${allowed.map(x=>`<option value="${x.id}" ${x.id===st.selectedGroupId?'selected':''}>${esc(x.name)}</option>`).join('')}</select>
      </div>
      <div class="grading-head-right">
        ${contentSection==='scores'?`<div style="position:relative;min-width:230px"><i class="fa-solid fa-magnifying-glass" style="position:absolute;left:12px;top:13px;color:#98a2b3;font-size:11px"></i><input id="grade-search" class="input" style="padding-left:32px" placeholder="Tìm tên hoặc SBD..." value="${esc(searchTerm)}"></div>
          <div class="segmented"><button data-mode="table" class="${viewMode==='table'?'active':''}"><i class="fa-solid fa-table"></i> Xem bảng</button><button data-mode="personal" class="${viewMode==='personal'?'active':''}"><i class="fa-regular fa-id-card"></i> Xem cá nhân</button></div>`:''}
        ${!admin&&g&&contentSection==='scores'?`<button class="btn primary" id="submit-grading"><i class="fa-solid fa-lock"></i> Khóa & Nộp</button>`:''}
      </div>
    </div>
    ${contentTabs}
    <div id="grading-body"></div>`;
  $('#grade-group')?.addEventListener('change',e=>{st.selectedGroupId=e.target.value;st.selectedCandidateId=null;contentSection='scores';searchTerm='';store.emit('selection')});
  $('#grade-search')?.addEventListener('input',e=>{searchTerm=e.target.value||'';renderBody(g,admin)});
  view.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{viewMode=b.dataset.mode;localStorage.setItem('gs28GradingView',viewMode);renderGrading()});
  view.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{contentSection=b.dataset.section;renderGrading()});
  if($('#submit-grading'))$('#submit-grading').onclick=()=>submitGroup(g);
  renderBody(g,admin);
}

function renderBody(g,admin){
  const st=store.get(),host=$('#grading-body');
  if(!g){host.innerHTML='<div class="card pad empty-state"><i class="fa-solid fa-layer-group"></i><b>Chưa có nhóm chấm</b><div class="tiny" style="margin-top:5px">Tài khoản chưa được phân quyền nhóm hoặc dữ liệu đang đồng bộ.</div></div>';return}
  if(contentSection!=='scores'){renderContentSection(g,contentSection,host);return}
  const status=groupStatus(g);
  if(st.system.emergencyLock){host.innerHTML=`<div class="notice danger"><i class="fa-solid fa-triangle-exclamation"></i> Hệ thống đang khóa khẩn cấp. ${esc(st.system.reason||'')}</div>`;return}
  if(!admin&&!status.open){host.innerHTML=`<div class="card pad"><div class="candidate-profile"><div><div class="tiny muted">NHÓM ĐÃ ĐƯỢC PHÂN QUYỀN</div><h2 style="margin:4px 0">${esc(g.name)}</h2></div><span class="badge warn"><i class="fa-solid fa-clock"></i> ${esc(status.label)}</span></div><div class="notice warn" style="margin-top:14px">Nhóm luôn hiển thị sau khi được phân quyền. Danh sách thí sinh và ô chấm sẽ tự mở theo trạng thái nhóm.</div></div>`;return}
  let cands=groupCandidates(st,g.id);
  const q=searchTerm.trim().toLowerCase();
  if(q)cands=cands.filter(c=>String(c.name||'').toLowerCase().includes(q)||String(c.code||'').toLowerCase().includes(q));
  if(!cands.length){host.innerHTML='<div class="card pad empty-state"><i class="fa-solid fa-user-slash"></i><b>Không có thí sinh phù hợp</b><div class="tiny" style="margin-top:5px">Kiểm tra điểm danh, quyền đọc dữ liệu hoặc từ khóa tìm kiếm.</div></div>';return}
  if(!st.selectedCandidateId||!cands.some(c=>c.id===st.selectedCandidateId))st.selectedCandidateId=(cands.find(c=>c.queueStatus==='grading')||cands[0]).id;
  if(viewMode==='table')renderTable(g,cands,admin);else renderPersonal(g,cands,admin);
}

function renderContentSection(g,type,host){
  const key=type==='scoring'?'scoringContent':'interviewContent',access=sectionAccess(g,key),cfg=normalizeContent(g),sec=cfg[key];
  if(!access.enabled){host.innerHTML='<div class="card pad empty-state"><i class="fa-regular fa-folder-open"></i><b>Phần này chưa được bật</b></div>';return}
  if(!access.open){host.innerHTML=`<div class="card pad"><div class="notice warn"><i class="fa-solid fa-lock"></i> Nội dung đang khóa: ${esc(access.text)}</div></div>`;return}
  if(type==='scoring'){
    const cols=sec.columns||[],rows=sec.rows||[];
    host.innerHTML=`<div class="card pad"><div class="toolbar"><div><div class="tiny muted">TÀI LIỆU DÀNH CHO GIÁM KHẢO</div><h3 style="margin:3px 0 0">${esc(sec.title)}</h3></div><span class="badge ok"><i class="fa-solid fa-lock-open"></i> ${esc(access.text)}</span></div><div class="table-wrap"><table class="table"><thead><tr>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r,i)=>`<tr>${cols.map((c,j)=>`<td>${esc(r.cells?.[c.key]??(j===0?i+1:''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;return;
  }
  host.innerHTML=`<div class="card pad"><div class="toolbar"><div><div class="tiny muted">TÀI LIỆU PHỎNG VẤN</div><h3 style="margin:3px 0 0">${esc(sec.title)}</h3></div><span class="badge ok"><i class="fa-solid fa-lock-open"></i> ${esc(access.text)}</span></div>${(sec.groups||[]).map(gr=>`<article style="margin-top:18px"><h4 style="margin-bottom:8px;color:#7f1d1d">• ${esc(gr.title)}</h4>${gr.description?`<p class="muted" style="font-size:12px">${esc(gr.description)}</p>`:''}${(gr.questions||[]).map((q,i)=>`<div class="score-box" style="margin-top:8px"><strong>${i+1}. ${esc(q.text)}</strong>${q.note?`<div class="tiny muted" style="margin-top:6px">Gợi ý / lưu ý: ${esc(q.note)}</div>`:''}</div>`).join('')}</article>`).join('')}</div>`;
}

function renderTable(g,cands,admin){
  const st=store.get(),host=$('#grading-body');
  host.innerHTML=`<div class="card"><div style="padding:12px 14px;border-bottom:1px solid #edf0f4;display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b>${esc(g.name)}</b><div class="tiny muted">${cands.length} thí sinh · Điểm đạt ≥ ${Number(g.passScore||0)}</div></div><span class="badge gray"><i class="fa-solid fa-cloud"></i> Tự động lưu</span></div><div class="table-wrap" style="border:0;border-radius:0 0 15px 15px"><table class="table"><thead><tr><th>STT</th><th>SBD</th><th>Thí sinh</th><th>Trạng thái</th>${(g.criteria||[]).map(c=>`<th>${esc(c.name)}<br><span class="tiny">${c.weight}%</span></th>`).join('')}<th>Tổng</th><th>Ghi chú</th></tr></thead><tbody>${cands.map((c,i)=>{const s=userScore(st,c.id),disabled=admin||c.locked||(g.attendanceEnabled&&!c.isPresent);return`<tr><td>${i+1}</td><td><span class="code">${esc(c.code)}</span></td><td><strong>${esc(c.name)}</strong>${s.standout?'<span class="badge warn" style="margin-left:6px">★ Nổi bật</span>':''}</td><td>${c.locked?'<span class="badge danger">Đã khóa</span>':(c.isPresent?'<span class="badge ok">Có mặt</span>':'<span class="badge gray">Chờ điểm danh</span>')}</td>${(g.criteria||[]).map(cr=>`<td><input class="input score-input" style="width:78px" type="number" min="0" max="100" value="${s.scores?.[cr.name]??''}" data-cid="${c.id}" data-crit="${esc(cr.name)}" ${disabled?'disabled':''}></td>`).join('')}<td><strong data-total="${c.id}" style="color:#991b1b">${s.totalScore??0}</strong></td><td style="max-width:220px;white-space:normal">${esc(s.candidateComment||'')}</td></tr>`}).join('')}</tbody></table></div></div>`;
  host.querySelectorAll('.score-input').forEach(inp=>inp.oninput=()=>scheduleSave(g,inp.dataset.cid,host));
}

function renderPersonal(g,cands,admin){
  const st=store.get(),host=$('#grading-body'),c=cands.find(x=>x.id===st.selectedCandidateId)||cands[0],s=userScore(st,c.id),disabled=admin||c.locked||(g.attendanceEnabled&&!c.isPresent);
  const fields=candidateFields(c).map(([label,value])=>`<div class="profile-field"><div class="field-label">${esc(label)}</div><div class="field-value">${esc(String(value??'-'))}</div></div>`).join('');
  host.innerHTML=`<div class="split">
    <div class="card candidate-list"><div class="candidate-list-head"><div class="tiny muted">DANH SÁCH THÍ SINH</div><b>${cands.length} thí sinh</b></div>${cands.map(x=>{const sx=userScore(st,x.id);return`<div class="candidate-item ${x.id===c.id?'active':''}" data-cand="${x.id}"><div style="display:flex;align-items:flex-start;gap:8px"><div style="min-width:0;flex:1"><div class="candidate-name">${esc(x.name)}</div><div class="candidate-meta"><span class="tiny muted">${esc(x.code)}</span><span class="badge ${x.queueStatus==='grading'?'ok':'gray'}">${queueLabel(x.queueStatus)}</span>${x.isPresent?'<span class="badge ok">Có mặt</span>':''}</div></div><div class="candidate-score">${sx.totalScore??0}</div></div></div>`}).join('')}</div>
    <div class="card pad personal-panel"><div class="candidate-profile"><div><div class="tiny muted">HỒ SƠ THÍ SINH</div><h2>${esc(c.name)}</h2><div class="muted code">${esc(c.code)}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap">${c.locked?'<span class="badge danger">Đã khóa</span>':''}${s.standout?'<span class="badge warn">★ Nổi bật</span>':''}<span class="badge ${c.isPresent?'ok':'gray'}">${c.isPresent?'Có mặt':'Chưa điểm danh'}</span>${scoreResult(s,g)}</div></div>
      <div class="grid grid-4" style="margin-top:14px"><div class="card stat"><div class="label">Điểm tổng</div><div class="value" data-total="${c.id}">${s.totalScore??0}</div></div><div class="card stat"><div class="label">Điểm đạt</div><div class="value">${g.passScore??0}</div></div><div class="card stat"><div class="label">Kết quả</div><div class="value" style="font-size:17px">${s.candidateId?(Number(s.totalScore)>=Number(g.passScore)?'ĐẠT':'TRƯỢT'):'CHỜ'}</div></div><div class="card stat"><div class="label">Hàng đợi</div><div class="value" style="font-size:17px">${queueLabel(c.queueStatus)}</div></div></div>
      <div class="profile-fields">${fields}</div>
      ${disabled?`<div class="notice warn" style="margin-top:14px"><i class="fa-solid fa-circle-info"></i> ${admin?'Quản trị viên đang xem ở chế độ chỉ đọc.':c.locked?'Thí sinh đã bị khóa chấm.':'Thí sinh chưa được điểm danh nên tạm khóa ô nhập điểm.'}</div>`:''}
      <div class="score-section-title"><h3>Chấm điểm</h3><span class="save-hint"><i class="fa-solid fa-cloud-arrow-up"></i> Tự động lưu & đồng bộ</span></div>
      <div class="score-grid">${(g.criteria||[]).map(cr=>`<div class="score-box"><h4>${esc(cr.name)} <span class="tiny muted">· Trọng số ${cr.weight}%</span></h4><input class="input score-input" type="number" min="0" max="100" data-cid="${c.id}" data-crit="${esc(cr.name)}" value="${s.scores?.[cr.name]??''}" ${disabled?'disabled':''} placeholder="0 - 100"><label class="label" style="margin-top:9px">Nhận xét tiêu chí</label><textarea class="textarea criterion-comment" data-crit="${esc(cr.name)}" ${disabled?'disabled':''} placeholder="Nhập nhận xét nếu cần...">${esc(s.criterionComments?.[cr.name]||'')}</textarea></div>`).join('')}</div>
      <label class="label" style="margin-top:15px">Nhận xét chung về thí sinh</label><textarea id="candidate-comment" class="textarea" ${disabled?'disabled':''} placeholder="Nhập nhận xét chung...">${esc(s.candidateComment||'')}</textarea>
      ${!admin?`<label style="display:flex;gap:8px;align-items:center;margin-top:11px;font-size:11px;font-weight:850"><input id="standout" type="checkbox" ${s.standout?'checked':''} ${disabled?'disabled':''}> Đánh dấu thí sinh nổi bật</label>`:''}
    </div>
  </div>`;
  host.querySelectorAll('[data-cand]').forEach(x=>x.onclick=()=>{st.selectedCandidateId=x.dataset.cand;store.emit('selection')});
  host.querySelectorAll('.score-input,.criterion-comment,#candidate-comment,#standout').forEach(inp=>inp.oninput=()=>scheduleSave(g,c.id,host));
}

function gatherDraft(g,cid,host){
  const st=store.get(),current=userScore(st,cid),scores={...(current.scores||{})},criterionComments={...(current.criterionComments||{})};
  host.querySelectorAll(`.score-input[data-cid="${cid}"]`).forEach(i=>scores[i.dataset.crit]=i.value===''?'':Number(i.value));
  host.querySelectorAll('.criterion-comment').forEach(i=>criterionComments[i.dataset.crit]=i.value);
  return{scores,criterionComments,candidateComment:host.querySelector('#candidate-comment')?.value??current.candidateComment??'',standout:host.querySelector('#standout')?.checked??current.standout??false};
}
function scheduleSave(g,cid,host){const draft=gatherDraft(g,cid,host);pendingDrafts.set(cid,{g,draft,host});clearTimeout(timers.get(cid));timers.set(cid,setTimeout(()=>flushDraft(cid),450))}
async function flushDraft(cid){
  const item=pendingDrafts.get(cid);if(!item)return;pendingDrafts.delete(cid);clearTimeout(timers.get(cid));timers.delete(cid);
  const {g,draft,host}=item,st=store.get(),c=st.candidates.get(cid);if(!c)return;
  try{
    const baseRevision=Number(userScore(st,cid).revision||0),r=await saveScore({grader:st.user,candidate:c,group:g,...draft,baseRevision}),scoreId=`${st.user.authUid}_${cid}`;
    st.scores.set(scoreId,{id:scoreId,candidateId:cid,groupId:g.id,graderUid:st.user.authUid,graderCode:st.user.code,graderName:st.user.name,...draft,totalScore:r.totalScore,revision:r.revision??baseRevision,offlinePending:!!r.queued});
    store.emit('scores');
    if(r.queued)toast('Mất mạng: điểm đã được đưa vào hàng chờ đồng bộ.','error');else{const el=host?.querySelector?.(`[data-total="${cid}"]`);if(el)el.textContent=r.totalScore}
  }catch(e){toast(e.code==='SCORE_CONFLICT'?'Điểm đã thay đổi ở một phiên khác. Hãy tải lại dữ liệu trước khi sửa tiếp.':e.message,'error')}
}
async function submitGroup(g){
  if(!navigator.onLine)return toast('Không thể nộp khi đang mất kết nối. Hãy chờ đồng bộ điểm hoàn tất.','error');
  for(const [cid,item] of [...pendingDrafts])if(item.g.id===g.id)await flushDraft(cid);
  const {pendingScores}=await import('../offline/scoreQueue.js');
  if(pendingScores().some(x=>x.groupId===g.id))return toast('Vẫn còn điểm chưa đồng bộ. Chưa thể nộp bảng điểm.','error');
  const st=store.get(),cands=groupCandidates(st,g.id),problems=validateBeforeSubmit(g,cands,st.scores,st.user.authUid);
  if(problems.length){const preview=problems.slice(0,5).map(x=>`${x.candidate.name}: thiếu ${x.missing.join(', ')}`).join(' · ');return toast(`Chưa thể nộp: ${problems.length} thí sinh chưa đủ điểm. ${preview}`,'error')}
  confirmModal('Sau khi nộp, bảng điểm của bạn sẽ bị khóa. Bạn có chắc muốn tiếp tục?',async()=>{await setDoc(ref('grader_verifications',`${st.user.authUid}_${g.id}`),{graderUid:st.user.authUid,graderCode:st.user.code,graderName:st.user.name,groupId:g.id,isVerified:true,submittedAt:serverTimestamp()},{merge:true});await audit('GRADING_SUBMITTED',{groupId:g.id,groupName:g.name},st.user);toast('Đã khóa và nộp bảng điểm.','ok')});
}
