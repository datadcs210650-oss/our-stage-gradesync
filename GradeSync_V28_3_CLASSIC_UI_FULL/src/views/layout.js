import { esc,$ } from '../utils/dom.js';
const adminItems=[
  ['dashboard','Tổng quan','fa-chart-pie'],
  ['groups','Quản lý nhóm thi','fa-layer-group'],
  ['candidates','Quản lý thí sinh','fa-users'],
  ['queue','Hàng đợi thí sinh','fa-list-ol'],
  ['live','Giám sát trực tiếp','fa-satellite-dish'],
  ['grading','Bảng điểm trực tiếp','fa-clipboard-check'],
  ['analytics','Phân tích & thống kê','fa-chart-line'],
  ['reports','Xuất kết quả','fa-file-export'],
  ['audit','Truy vết lịch sử','fa-clock-rotate-left'],
  ['graders','Quản lý giám khảo','fa-user-shield'],
  ['backup','Sao lưu & Khôi phục','fa-database']
];
const graderItems=[
  ['grading','Bảng điểm trực tiếp','fa-clipboard-check'],
  ['queue','Hàng đợi thí sinh','fa-list-ol']
];
const roleLabel=r=>r==='SuperAdmin'?'Quản trị viên cấp cao':r==='Admin'?'Quản trị viên':'Giám khảo';
const initial=name=>String(name||'G').trim().slice(0,1).toUpperCase();
export function renderLayout(user,route,onNavigate,onLogout){
  const admin=['Admin','SuperAdmin'].includes(user.role),items=admin?adminItems:graderItems;
  const collapsed=localStorage.getItem('gsSidebarCollapsed')==='1';
  const nav=items.map(([id,label,icon])=>`<button data-nav="${id}" class="${route===id?'active':''}" title="${esc(label)}"><i class="fa-solid ${icon}"></i><span>${esc(label)}</span></button>`).join('');
  const page=items.find(x=>x[0]===route)?.[1]||'GradeSync';
  document.querySelector('#app').innerHTML=`
    <div id="emergency-strip"></div>
    <div class="app-shell ${collapsed?'sidebar-collapsed':''}" id="app-shell">
      <div class="mobile-overlay" id="mobile-overlay"></div>
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-mark">G</div>
          <div class="brand-copy"><h1>GradeSync <span class="build-badge">V28.3</span></h1><small>Hệ thống chấm điểm thời gian thực</small></div>
        </div>
        <div class="nav-title">${admin?'QUẢN TRỊ HỆ THỐNG':'KHU VỰC GIÁM KHẢO'}</div>
        <div class="nav">${nav}</div>
        <div class="sidebar-footer">
          <div class="user-mini">
            <div class="user-avatar">${esc(initial(user.name||user.email||user.code))}</div>
            <div class="user-mini-copy"><div class="user-mini-name">${esc(user.name||user.email||user.code||'Người dùng')}</div><div class="user-mini-role">${esc(roleLabel(user.role))}</div></div>
          </div>
          <button class="logout-btn" id="logout-btn"><i class="fa-solid fa-right-from-bracket"></i><span>Đăng xuất</span></button>
        </div>
      </aside>
      <section class="main">
        <header class="topbar">
          <div class="topbar-left">
            <button class="menu-toggle" id="menu-toggle" title="Thu gọn / mở rộng menu"><i class="fa-solid fa-bars"></i></button>
            <div class="page-copy"><div class="page-kicker">GRADESYNC · THỜI GIAN THỰC</div><h2 id="page-title">${esc(page)}</h2></div>
          </div>
          <div class="topbar-right">
            <div class="status-pill" id="network-pill"><span class="status-dot"></span><span id="network-state">Trực tuyến</span></div>
            <div class="status-pill sync"><i class="fa-solid fa-rotate"></i><span id="pending-state">0 chờ đồng bộ</span></div>
          </div>
        </header>
        <main class="content" id="view"></main>
      </section>
    </div>`;
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{closeMobile();onNavigate(b.dataset.nav)});
  $('#logout-btn').onclick=onLogout;
  const shell=$('#app-shell'),sidebar=$('#sidebar'),overlay=$('#mobile-overlay');
  const closeMobile=()=>{sidebar?.classList.remove('mobile-open');overlay?.classList.remove('show')};
  $('#menu-toggle').onclick=()=>{
    if(innerWidth<=900){sidebar?.classList.toggle('mobile-open');overlay?.classList.toggle('show');return}
    shell?.classList.toggle('sidebar-collapsed');localStorage.setItem('gsSidebarCollapsed',shell?.classList.contains('sidebar-collapsed')?'1':'0');
  };
  if(overlay)overlay.onclick=closeMobile;
  if(!window.__gsNetworkBound){window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);window.__gsNetworkBound=true}
  updateNetwork();
}
function updateNetwork(){const txt=document.querySelector('#network-state'),pill=document.querySelector('#network-pill');if(txt)txt.textContent=navigator.onLine?'Trực tuyến':'Mất kết nối';if(pill)pill.classList.toggle('offline',!navigator.onLine)}
export function updateEmergency(system,user){const host=document.querySelector('#emergency-strip');if(!host)return;if(system?.emergencyLock){host.innerHTML=`<div class="danger-strip"><span><i class="fa-solid fa-triangle-exclamation"></i> HỆ THỐNG ĐANG KHÓA KHẨN CẤP${system.reason?`: ${esc(system.reason)}`:''}</span>${['Admin','SuperAdmin'].includes(user.role)?'<span>Quản trị viên có thể mở lại trong mục Giám sát trực tiếp</span>':''}</div>`}else host.innerHTML=''}
