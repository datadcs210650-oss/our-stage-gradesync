import { store } from '../state/store.js';
import { esc,toast,$,confirmModal,decodeEntities } from '../utils/dom.js';
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
let adminGraderUid='';
const scrollState={tableTop:0,tableLeft:0,listTop:0,detailTop:0};

const queueLabel=s=>s==='grading'?'Đang thi':s==='done'?'Hoàn tất':'Đang chờ';
const isAdminRole=r=>['Admin','SuperAdmin'].includes(r);
const scoreFor=(st,cid,uid)=>st.scores.get(`${uid}_${cid}`)||[...st.scores.values()].find(s=>s.candidateId===cid&&s.graderUid===uid)||{};
const verificationFor=(st,gid,uid)=>st.verifications.get(`${uid}_${gid}`)||[...st.verifications.values()].find(v=>v.groupId===gid&&v.graderUid===uid)||{};
function visibleExtraFields(g,admin,candidate){
  const cfg=Array.isArray(g?.extraFields)?g.extraFields:[];
  if(cfg.length)return cfg.filter(f=>admin||f.showToGrader!==false);
  return Object.keys(candidate?.extraData||{}).map(name=>({name,showToGrader:true}));
}
function groupCandidates(st,gid){
  return [...st.candidates.values()].filter(c=>c.groupId===gid).sort((a,b)=>{
    const ac=a.queueStatus==='grading'?1:0,bc=b.queueStatus==='grading'?1:0;if(ac!==bc)return bc-ac;
    const ap=a.isPresent?1:0,bp=b.isPresent?1:0;if(ap!==bp)return bp-ap;
    const ao=Number(a.attendanceOrder||0),bo=Number(b.attendanceOrder||0);if(ap&&bp&&ao!==bo)return bo-ao;
    return Number(a.queueOrder||999999)-Number(b.queueOrder||999999);
  });
}
function availableGraders(st,gid){
  const map=new Map();
  for(const g of st.graders.values())if((g.assignedGroups||[]).includes(gid))map.set(g.authUid||g.id,{authUid:g.authUid||g.id,name:g.name||g.email||g.code||'Giám khảo',code:g.code||''});
  for(const s of st.scores.values())if(s.groupId===gid&&s.graderUid)map.set(s.graderUid,{authUid:s.graderUid,name:s.graderName||s.graderCode||'Giám khảo',code:s.graderCode||''});
  return [...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),'vi'));
}
function candidateFields(g,c,admin){
  const rows=[['Mã số / SBD',c.code||'-'],['Họ tên',c.name||'-']];
  const extras=visibleExtraFields(g,admin,c),data=c.extraData||{};
  extras.forEach(f=>rows.push([f.name,data[f.name]??'-']));
  return rows;
}
function scoreResult(s,g){
  if(!s?.candidateId)return '<span class="badge gray">CHỜ</span>';
  return Number(s.totalScore)>=Number(g.passScore)?'<span class="badge ok">ĐẠT</span>':'<span class="badge danger">TRƯỢT</span>';
}
function captureScroll(){
  const table=document.querySelector('[data-grading-table-scroll]');if(table){scrollState.tableTop=table.scrollTop;scrollState.tableLeft=table.scrollLeft}
  const list=document.querySelector('[data-candidate-list-scroll]');if(list)scrollState.listTop=list.scrollTop;
  const detail=document.querySelector('[data-personal-detail-scroll]');if(detail)scrollState.detailTop=detail.scrollTop;
}
function restoreScroll(){requestAnimationFrame(()=>{const table=document.querySelector('[data-grading-table-scroll]');if(table){table.scrollTop=scrollState.tableTop;table.scrollLeft=scrollState.tableLeft}const list=document.querySelector('[data-candidate-list-scroll]');if(list)list.scrollTop=scrollState.listTop;const detail=document.querySelector('[data-personal-detail-scroll]');if(detail)detail.scrollTop=scrollState.detailTop})}
function scoreTarget(st,g,admin){
  if(!admin)return st.user.authUid;
  const graders=availableGraders(st,g?.id);if(!graders.some(x=>x.authUid===adminGraderUid))adminGraderUid=graders[0]?.authUid||'';return adminGraderUid;
}

export function renderGrading(){
  captureScroll();
  const st=store.get(),view=$('#view'),user=st.user,admin=isAdminRole(user.role);
  const allowed=admin?[...st.groups.values()]:[...(user.assignedGroups||[])].map(id=>st.groups.get(id)).filter(Boolean);
  if((!st.selectedGroupId||!allowed.some(x=>x.id===st.selectedGroupId))&&allowed[0])st.selectedGroupId=allowed[0].id;
  const g=st.groups.get(st.selectedGroupId),cfg=g?normalizeContent(g):null,status=g?groupStatus(g):null,graders=g&&admin?availableGraders(st,g.id):[];
  scoreTarget(st,g,admin);
  const contentTabs=g?`<div class="tabs grading-tabs v27-tabs">
    <button data-section="scores" class="${contentSection==='scores'?'active':''}"><i class="fa-solid fa-table-cells"></i> 1. Tiêu chí chấm điểm</button>
    ${cfg?.scoringContent?.enabled?`<button data-section="scoring" class="${contentSection==='scoring'?'active':''}"><i class="fa-solid fa-book-open"></i> Nội dung tiêu chí chấm</button>`:''}
    ${cfg?.interviewContent?.enabled?`<button data-section="interview" class="${contentSection==='interview'?'active':''}"><i class="fa-regular fa-file-lines"></i> Câu hỏi phỏng vấn</button>`:''}
  </div>`:'';
  view.innerHTML=`
    <div class="grading-head v27-grading-head">
      <div class="grading-head-left">
        <div class="grading-group-icon"><i class="fa-solid fa-layer-group"></i></div>
        <select id="grade-group" class="select group-select">${allowed.map(x=>`<option value="${x.id}" ${x.id===st.selectedGroupId?'selected':''}>${esc(decodeEntities(x.name))}</option>`).join('')||'<option>Chưa được phân quyền nhóm</option>'}</select>
        ${g?`<span class="badge ${status?.open?'ok':'warn'}"><i class="fa-solid ${status?.open?'fa-lock-open':'fa-clock'}"></i> ${esc(status?.label||'')}</span>`:''}
      </div>
      <div class="grading-head-right">
        ${admin&&g?`<div class="admin-grader-filter"><i class="fa-solid fa-eye"></i><select id="admin-grader-select" class="select"><option value="">-- Chọn giám khảo --</option>${graders.map(x=>`<option value="${x.authUid}" ${x.authUid===adminGraderUid?'selected':''}>${esc(x.name)}${x.code?` · ${esc(x.code)}`:''}</option>`).join('')}</select></div>`:''}
        ${contentSection==='scores'?`<div class="grading-search"><i class="fa-solid fa-magnifying-glass"></i><input id="grade-search" class="input" placeholder="Tìm thí sinh nhanh..." value="${esc(searchTerm)}"></div><div class="segmented"><button data-mode="table" class="${viewMode==='table'?'active':''}"><i class="fa-solid fa-table"></i> Xem bảng</button><button data-mode="personal" class="${viewMode==='personal'?'active':''}"><i class="fa-regular fa-id-card"></i> Xem cá nhân</button></div>`:''}
        ${!admin&&g&&contentSection==='scores'?`<button class="btn primary" id="submit-grading"><i class="fa-solid fa-lock"></i> Khóa & Nộp</button>`:''}
      </div>
    </div>
    ${contentTabs}
    <div id="grading-body"></div>`;
  $('#grade-group')?.addEventListener('change',e=>{st.selectedGroupId=e.target.value;st.selectedCandidateId=null;adminGraderUid='';contentSection='scores';searchTerm='';scrollState.tableTop=scrollState.listTop=scrollState.detailTop=0;store.emit('selection')});
  $('#admin-grader-select')?.addEventListener('change',e=>{adminGraderUid=e.target.value;renderBody(g,admin)});
  $('#grade-search')?.addEventListener('input',e=>{searchTerm=e.target.value||'';renderBody(g,admin)});
  view.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{viewMode=b.dataset.mode;localStorage.setItem('gs28GradingView',viewMode);scrollState.tableTop=scrollState.listTop=scrollState.detailTop=0;renderGrading()});
  view.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{contentSection=b.dataset.section;renderGrading()});
  if($('#submit-grading'))$('#submit-grading').onclick=()=>submitGroup(g);
  renderBody(g,admin);restoreScroll();
}

function renderBody(g,admin){
  const st=store.get(),host=$('#grading-body');if(!host)return;
  if(!g){host.innerHTML='<div class="card pad empty-state"><i class="fa-solid fa-layer-group"></i><b>Chưa có nhóm chấm</b><div class="tiny" style="margin-top:5px">Tài khoản chưa được phân quyền nhóm.</div></div>';return}
  if(contentSection!=='scores'){renderContentSection(g,contentSection,host);return}
  const status=groupStatus(g);
  if(st.system.emergencyLock){host.innerHTML=`<div class="notice danger"><i class="fa-solid fa-triangle-exclamation"></i> Hệ thống đang khóa khẩn cấp. ${esc(st.system.reason||'')}</div>`;return}
  if(!admin&&!status.open){host.innerHTML=`<div class="card pad v27-closed-group"><div class="candidate-profile"><div><div class="tiny muted">NHÓM ĐÃ ĐƯỢC PHÂN QUYỀN</div><h2 style="margin:4px 0">${esc(decodeEntities(g.name))}</h2></div><span class="badge warn"><i class="fa-solid fa-clock"></i> ${esc(status.label)}</span></div><div class="notice warn" style="margin-top:14px">Nhóm luôn hiển thị sau khi được phân quyền. Danh sách thí sinh và bảng chấm sẽ tự mở theo thời gian thực khi nhóm bắt đầu.</div></div>`;return}
  const targetUid=scoreTarget(st,g,admin);
  if(admin&&!targetUid){host.innerHTML='<div class="card pad empty-state"><i class="fa-solid fa-user-shield"></i><b>Chưa có giám khảo để xem điểm</b><div class="tiny" style="margin-top:5px">Khi giám khảo được phân quyền hoặc có dữ liệu điểm, họ sẽ xuất hiện ở bộ lọc phía trên.</div></div>';return}
  let cands=groupCandidates(st,g.id);const q=searchTerm.trim().toLowerCase();if(q)cands=cands.filter(c=>String(c.name||'').toLowerCase().includes(q)||String(c.code||'').toLowerCase().includes(q)||Object.values(c.extraData||{}).some(v=>String(v||'').toLowerCase().includes(q)));
  if(!cands.length){host.innerHTML='<div class="card pad empty-state"><i class="fa-solid fa-user-slash"></i><b>Không có thí sinh phù hợp</b><div class="tiny" style="margin-top:5px">Kiểm tra điểm danh, dữ liệu nhóm hoặc từ khóa tìm kiếm.</div></div>';return}
  if(!st.selectedCandidateId||!cands.some(c=>c.id===st.selectedCandidateId))st.selectedCandidateId=(cands.find(c=>c.queueStatus==='grading')||cands.find(c=>c.isPresent)||cands[0]).id;
  if(viewMode==='table')renderTable(g,cands,admin,targetUid);else renderPersonal(g,cands,admin,targetUid);
}

function renderContentSection(g,type,host){
  const key=type==='scoring'?'scoringContent':'interviewContent',access=sectionAccess(g,key),cfg=normalizeContent(g),sec=cfg[key];
  if(!access.enabled){host.innerHTML='<div class="card pad empty-state"><i class="fa-regular fa-folder-open"></i><b>Phần này chưa được bật</b></div>';return}
  if(!access.open){host.innerHTML=`<div class="card pad"><div class="notice warn"><i class="fa-solid fa-lock"></i> Nội dung đang khóa: ${esc(access.text)}</div></div>`;return}
  if(type==='scoring'){
    const cols=sec.columns||[],rows=sec.rows||[];host.innerHTML=`<div class="card pad v27-doc-card"><div class="toolbar"><div><div class="tiny muted">TÀI LIỆU DÀNH CHO GIÁM KHẢO</div><h3 style="margin:3px 0 0">${esc(sec.title)}</h3></div><span class="badge ok"><i class="fa-solid fa-lock-open"></i> ${esc(access.text)}</span></div><div class="table-wrap"><table class="table"><thead><tr>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r,i)=>`<tr>${cols.map((c,j)=>`<td>${esc(r.cells?.[c.key]??(j===0?i+1:''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;return;
  }
  host.innerHTML=`<div class="card pad v27-doc-card"><div class="toolbar"><div><div class="tiny muted">TÀI LIỆU PHỎNG VẤN</div><h3 style="margin:3px 0 0">${esc(sec.title)}</h3></div><span class="badge ok"><i class="fa-solid fa-lock-open"></i> ${esc(access.text)}</span></div><div class="interview-doc">${(sec.groups||[]).map(gr=>`<article class="interview-block"><h4>• ${esc(gr.title)}</h4>${gr.description?`<p class="muted">${esc(gr.description)}</p>`:''}${(gr.questions||[]).map((q,i)=>`<div class="interview-question"><span>${i+1}.</span><div><strong>${esc(q.text)}</strong>${q.note?`<div class="tiny muted">Gợi ý / lưu ý: ${esc(q.note)}</div>`:''}</div></div>`).join('')}</article>`).join('')}</div></div>`;
}

function buildCandidateView(st,g,c,targetUid,admin){
  const s=scoreFor(st,c.id,targetUid),submitted=!!verificationFor(st,g.id,targetUid)?.isVerified,disabled=admin||submitted||c.locked||(g.attendanceEnabled&&!c.isPresent);return{c,s,submitted,disabled,total:Number(s.totalScore||0),hasScore:!!s.candidateId,pass:Number(s.totalScore||0)>=Number(g.passScore||0)};
}
function statusBadges(v,g){return`${v.c.locked?'<span class="badge danger">Đã khóa</span>':''}${v.s.standout?'<span class="badge warn">★ Nổi bật</span>':''}<span class="badge ${v.c.isPresent?'ok':'gray'}">${v.c.isPresent?'Có mặt':'Chưa điểm danh'}</span>${scoreResult(v.s,g)}`}

function renderTable(g,cands,admin,targetUid){
  const st=store.get(),host=$('#grading-body'),extras=visibleExtraFields(g,admin,cands[0]),views=cands.map(c=>buildCandidateView(st,g,c,targetUid,admin)),submitted=!!verificationFor(st,g.id,targetUid)?.isVerified;
  host.innerHTML=`<div class="card v27-table-card"><div class="v27-table-titlebar"><div><div class="tiny muted">BẢNG ĐIỂM LIVE</div><b>${esc(decodeEntities(g.name))}</b><div class="tiny muted">${cands.length} thí sinh · Điểm đạt ≥ ${Number(g.passScore||0)} ${submitted?'· Bảng điểm đã khóa':''}</div></div><span class="badge gray"><i class="fa-solid fa-cloud-arrow-up"></i> Tự động lưu & đồng bộ</span></div><div class="table-wrap v27-score-table" data-grading-table-scroll><table class="table"><thead><tr><th>STT</th><th>SBD</th><th>Họ tên</th>${g.attendanceEnabled?'<th>Có mặt</th>':''}${extras.map(f=>`<th>${esc(f.name)}${admin&&!f.showToGrader?' <i class="fa-solid fa-eye-slash"></i>':''}</th>`).join('')}${(g.criteria||[]).map(c=>`<th>${esc(c.name)}<br><span class="tiny">${c.weight}%</span></th>`).join('')}<th>Tổng</th><th>Kết quả</th><th>Ghi chú</th></tr></thead><tbody>${views.map((v,i)=>{const c=v.c,s=v.s;return`<tr class="${c.queueStatus==='grading'?'current-candidate-row':''}"><td>${i+1}</td><td><span class="code">${esc(c.code)}</span></td><td><strong>${esc(c.name)}</strong>${c.queueStatus==='grading'?'<span class="badge ok" style="margin-left:6px">Đang thi</span>':''}${s.standout?'<span class="badge warn" style="margin-left:6px">★</span>':''}</td>${g.attendanceEnabled?`<td>${admin?`<label class="attendance-switch"><input type="checkbox" data-attendance="${c.id}" ${c.isPresent?'checked':''}><span>${c.isPresent?'Có mặt':'Chưa'}</span></label>`:(c.isPresent?'<span class="badge ok">Có mặt</span>':'<span class="badge gray">Chờ</span>')}</td>`:''}${extras.map(f=>`<td>${esc(c.extraData?.[f.name]??'-')}</td>`).join('')}${(g.criteria||[]).map(cr=>`<td><input class="input score-input" style="width:82px" type="number" min="0" max="100" step="0.5" value="${s.scores?.[cr.name]??''}" data-cid="${c.id}" data-crit="${esc(cr.name)}" ${v.disabled?'disabled':''}></td>`).join('')}<td><strong data-total="${c.id}" class="total-score">${v.total}</strong></td><td>${scoreResult(s,g)}</td><td class="comment-cell">${esc(s.candidateComment||'')}</td></tr>`}).join('')}</tbody></table></div></div>`;
  host.querySelectorAll('.score-input').forEach(inp=>inp.oninput=()=>scheduleSave(g,inp.dataset.cid,host,targetUid));
  host.querySelectorAll('[data-attendance]').forEach(x=>x.onchange=async()=>{const c=st.candidates.get(x.dataset.attendance),isPresent=x.checked;await setDoc(ref('candidates',c.id),{isPresent,attendanceOrder:isPresent?Date.now():0,attendanceUpdatedAt:serverTimestamp()},{merge:true});toast(isPresent?`Đã điểm danh ${c.name}`:`Đã bỏ điểm danh ${c.name}`)});
  restoreScroll();
}

function renderPersonal(g,cands,admin,targetUid){
  const st=store.get(),host=$('#grading-body'),c=cands.find(x=>x.id===st.selectedCandidateId)||cands[0],v=buildCandidateView(st,g,c,targetUid,admin),s=v.s,fields=candidateFields(g,c,admin).map(([label,value])=>`<div class="v27-readonly-field"><label>${esc(label)}</label><div>${esc(String(value??'-'))}</div></div>`).join('');
  const idx=cands.findIndex(x=>x.id===c.id),prev=cands[Math.max(0,idx-1)],next=cands[Math.min(cands.length-1,idx+1)];
  host.innerHTML=`<div class="v27-personal-shell">
    <aside class="card v27-candidate-list"><div class="v27-candidate-list-head"><div><div class="tiny muted">DANH SÁCH THÍ SINH</div><h3>Thông tin thí sinh</h3></div><span class="badge gray">${cands.length}</span></div><div class="v27-candidate-list-scroll" data-candidate-list-scroll>${cands.map((x,i)=>{const vx=buildCandidateView(st,g,x,targetUid,admin);return`<button class="v27-candidate-item ${x.id===c.id?'active':''}" data-cand="${x.id}"><div class="cand-index">${i+1}</div><div class="cand-copy"><strong>${esc(x.name)}</strong><div>${esc(x.code||'---')} ${x.isPresent?'· <span class="present-dot">Có mặt</span>':''}</div></div><div class="cand-result"><b>${vx.total}</b>${vx.hasScore?(vx.pass?'<span class="badge ok">ĐẠT</span>':'<span class="badge danger">TRƯỢT</span>'):'<span class="badge gray">CHỜ</span>'}</div></button>`}).join('')}</div></aside>
    <section class="card v27-candidate-detail">
      <div class="v27-detail-head"><div><span class="candidate-label">Thí sinh</span><h2>${esc(c.name)}</h2><div class="code muted">${esc(c.code||'---')}</div></div><div class="detail-head-right">${statusBadges(v,g)}</div></div>
      <div class="v27-detail-stats"><div><span>Điểm tổng</span><b data-total="${c.id}">${v.total}</b></div><div><span>Kết quả</span><b>${v.hasScore?(v.pass?'ĐẠT':'TRƯỢT'):'CHỜ'}</b></div><div><span>Điểm đạt</span><b>≥ ${Number(g.passScore||0)}</b></div><div><span>Hàng đợi</span><b>${queueLabel(c.queueStatus)}</b></div></div>
      ${v.submitted?'<div class="notice ok v27-mode-banner"><i class="fa-solid fa-check-double"></i> Bảng điểm này đã được khóa và nộp.</div>':v.disabled?`<div class="notice warn v27-mode-banner"><i class="fa-solid fa-circle-info"></i> ${admin?'Quản trị viên đang xem ở chế độ chỉ đọc.':c.locked?'Thí sinh đã bị khóa chấm.':'Thí sinh chưa được điểm danh nên tạm khóa ô nhập điểm.'}</div>`:''}
      <div class="v27-detail-scroll" data-personal-detail-scroll>
        <div class="v27-detail-toolbar"><div class="tiny muted">THÔNG TIN THÍ SINH</div><div class="candidate-nav"><button class="btn small" data-prev="${prev?.id||''}" ${idx===0?'disabled':''}><i class="fa-solid fa-chevron-left"></i> Trước</button><button class="btn small" data-next="${next?.id||''}" ${idx===cands.length-1?'disabled':''}>Sau <i class="fa-solid fa-chevron-right"></i></button></div></div>
        <div class="v27-candidate-fields">${fields}</div>
        <div class="v27-section-divider"><span>BẢNG CHẤM CÁ NHÂN</span><small><i class="fa-solid fa-cloud-arrow-up"></i> Tự động lưu & đồng bộ</small></div>
        <div class="v27-score-cards">${(g.criteria||[]).map(cr=>`<div class="v27-score-card"><div class="score-card-row"><div><h4>${esc(cr.name)}</h4><p>Trọng số <b>${cr.weight}%</b> · Điểm 0–100</p></div><input class="input score-input" type="number" min="0" max="100" step="0.5" data-cid="${c.id}" data-crit="${esc(cr.name)}" value="${s.scores?.[cr.name]??''}" ${v.disabled?'disabled':''} placeholder="-"></div><label class="label">Nhận xét tiêu chí</label><textarea class="textarea criterion-comment" data-crit="${esc(cr.name)}" ${v.disabled?'disabled':''} placeholder="Nhập nhận xét nếu cần...">${esc(s.criterionComments?.[cr.name]||'')}</textarea></div>`).join('')||'<div class="empty-inline">Nhóm chưa có tiêu chí chấm.</div>'}</div>
        <div class="v27-comment-card"><label class="label">Nhận xét chung về thí sinh</label><textarea id="candidate-comment" class="textarea" ${v.disabled?'disabled':''} placeholder="Nhập nhận xét chung...">${esc(s.candidateComment||'')}</textarea>${!admin?`<label class="standout-check"><input id="standout" type="checkbox" ${s.standout?'checked':''} ${v.disabled?'disabled':''}> <span>Đánh dấu thí sinh nổi bật</span></label>`:''}<div class="save-state" id="save-state-${c.id}">Đã đồng bộ</div></div>
      </div>
    </section>
  </div>`;
  host.querySelectorAll('[data-cand]').forEach(x=>x.onclick=()=>{captureScroll();st.selectedCandidateId=x.dataset.cand;store.emit('selection')});
  host.querySelector('[data-prev]')?.addEventListener('click',e=>{if(e.currentTarget.dataset.prev){st.selectedCandidateId=e.currentTarget.dataset.prev;scrollState.detailTop=0;store.emit('selection')}});
  host.querySelector('[data-next]')?.addEventListener('click',e=>{if(e.currentTarget.dataset.next){st.selectedCandidateId=e.currentTarget.dataset.next;scrollState.detailTop=0;store.emit('selection')}});
  host.querySelectorAll('.score-input,.criterion-comment,#candidate-comment,#standout').forEach(inp=>inp.oninput=()=>scheduleSave(g,c.id,host,targetUid));
  restoreScroll();
}

function gatherDraft(g,cid,host,targetUid){
  const st=store.get(),current=scoreFor(st,cid,targetUid),scores={...(current.scores||{})},criterionComments={...(current.criterionComments||{})};
  host.querySelectorAll(`.score-input[data-cid="${cid}"]`).forEach(i=>scores[i.dataset.crit]=i.value===''?'':Number(i.value));
  host.querySelectorAll('.criterion-comment').forEach(i=>criterionComments[i.dataset.crit]=i.value);
  return{scores,criterionComments,candidateComment:host.querySelector('#candidate-comment')?.value??current.candidateComment??'',standout:host.querySelector('#standout')?.checked??current.standout??false};
}
function scheduleSave(g,cid,host,targetUid){
  const st=store.get();if(isAdminRole(st.user.role))return;
  const draft=gatherDraft(g,cid,host,targetUid),state=host.querySelector(`#save-state-${cid}`);if(state){state.textContent='Đang chờ lưu...';state.classList.add('saving')}
  pendingDrafts.set(cid,{g,draft,host,targetUid});clearTimeout(timers.get(cid));timers.set(cid,setTimeout(()=>flushDraft(cid),450));
}
async function flushDraft(cid){
  const item=pendingDrafts.get(cid);if(!item)return;pendingDrafts.delete(cid);clearTimeout(timers.get(cid));timers.delete(cid);
  const {g,draft,host,targetUid}=item,st=store.get(),c=st.candidates.get(cid);if(!c)return;
  const state=host?.querySelector?.(`#save-state-${cid}`);if(state)state.textContent=navigator.onLine?'Đang lưu...':'Chờ mạng...';
  try{
    const current=scoreFor(st,cid,targetUid),baseRevision=Number(current.revision||0),r=await saveScore({grader:st.user,candidate:c,group:g,...draft,baseRevision}),scoreId=`${st.user.authUid}_${cid}`;
    st.scores.set(scoreId,{id:scoreId,candidateId:cid,groupId:g.id,graderUid:st.user.authUid,graderCode:st.user.code,graderName:st.user.name,...draft,totalScore:r.totalScore,revision:r.revision??baseRevision,offlinePending:!!r.queued});store.emit('scores');
    const el=host?.querySelector?.(`[data-total="${cid}"]`);if(el)el.textContent=r.totalScore;if(state){state.textContent=r.queued?'Đã lưu ngoại tuyến · chờ đồng bộ':'Đã đồng bộ';state.classList.toggle('saving',!!r.queued)}if(r.queued)toast('Mất mạng: điểm đã được đưa vào hàng chờ đồng bộ.','error');
  }catch(e){if(state)state.textContent='Lỗi lưu';toast(e.code==='SCORE_CONFLICT'?'Điểm đã thay đổi ở một phiên khác. Hãy tải lại dữ liệu trước khi sửa tiếp.':e.message,'error')}
}
async function submitGroup(g){
  if(!navigator.onLine)return toast('Không thể nộp khi đang mất kết nối. Hãy chờ đồng bộ điểm hoàn tất.','error');
  for(const [cid,item] of [...pendingDrafts])if(item.g.id===g.id)await flushDraft(cid);
  const {pendingScores}=await import('../offline/scoreQueue.js');if(pendingScores().some(x=>x.groupId===g.id))return toast('Vẫn còn điểm chưa đồng bộ. Chưa thể nộp bảng điểm.','error');
  const st=store.get(),cands=groupCandidates(st,g.id),problems=validateBeforeSubmit(g,cands,st.scores,st.user.authUid);if(problems.length){const preview=problems.slice(0,5).map(x=>`${x.candidate.name}: thiếu ${x.missing.join(', ')}`).join(' · ');return toast(`Chưa thể nộp: ${problems.length} thí sinh chưa đủ điểm. ${preview}`,'error')}
  confirmModal('Sau khi nộp, bảng điểm của bạn sẽ bị khóa. Bạn có chắc muốn tiếp tục?',async()=>{await setDoc(ref('grader_verifications',`${st.user.authUid}_${g.id}`),{graderUid:st.user.authUid,graderCode:st.user.code,graderName:st.user.name,groupId:g.id,isVerified:true,submittedAt:serverTimestamp()},{merge:true});await audit('GRADING_SUBMITTED',{groupId:g.id,groupName:g.name},st.user);toast('Đã khóa và nộp bảng điểm.','ok')});
}
