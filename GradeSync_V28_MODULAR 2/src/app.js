import { auth } from './config/firebase.js';
import { renderLogin } from './views/login.js';
import { renderLayout,updateEmergency } from './views/layout.js';
import { renderDashboard } from './views/dashboard.js';
import { renderGroups } from './views/groups.js';
import { renderCandidates } from './views/candidates.js';
import { renderGrading } from './views/grading.js';
import { renderQueue } from './views/queue.js';
import { renderLiveMonitor } from './views/liveMonitor.js';
import { renderAnalytics } from './views/analytics.js';
import { renderReports } from './views/reports.js';
import { renderGraders } from './views/graders.js';
import { renderAudit } from './views/audit.js';
import { renderBackup } from './views/backupView.js';
import { watchAuth,restoreProfile,logout } from './auth/auth.js';
import { startRealtime,stopRealtime } from './realtime/realtime.js';
import { store } from './state/store.js';
import { startPresence,markOffline } from './services/presence.js';
import { flushScoreQueue } from './services/scoring.js';
import { pendingScores } from './offline/scoreQueue.js';
import { toast } from './utils/dom.js';
import { migrateLegacyDataOnce } from './services/migration.js';

let route='grading',renderTimer=null,sessionTimer=null,warningTimer=null,currentUser=null,booting=true;
const adminRoutes={dashboard:renderDashboard,groups:renderGroups,candidates:renderCandidates,queue:renderQueue,live:renderLiveMonitor,grading:renderGrading,analytics:renderAnalytics,reports:renderReports,audit:renderAudit,graders:renderGraders,backup:renderBackup};
const graderRoutes={grading:renderGrading,queue:renderQueue};
function allowedRoute(user,r){return ['Admin','SuperAdmin'].includes(user.role)?(adminRoutes[r]?r:'dashboard'):(graderRoutes[r]?r:'grading')}
function navigate(r){route=allowedRoute(currentUser,r);renderLayout(currentUser,route,navigate,doLogout);renderRoute()}
async function renderRoute(){if(!currentUser)return;updateEmergency(store.get().system,currentUser);const fn=['Admin','SuperAdmin'].includes(currentUser.role)?adminRoutes[route]:graderRoutes[route];try{await fn?.(currentUser)}catch(e){console.error(e);document.querySelector('#view').innerHTML=`<div class="notice danger">${String(e.message||e)}</div>`}updateStatus()}
function scheduleRender(){clearTimeout(renderTimer);const editing=route==='grading'&&document.activeElement&&['INPUT','TEXTAREA'].includes(document.activeElement.tagName);renderTimer=setTimeout(()=>{if(editing&&document.activeElement&&['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){scheduleRender();return}renderRoute()},editing?700:80)}
function updateStatus(){const p=document.querySelector('#pending-state');if(p)p.textContent=`${pendingScores().length} chờ sync`;updateEmergency(store.get().system,currentUser)}
function startSessionClock(user){clearTimeout(sessionTimer);clearTimeout(warningTimer);if(user.role!=='Grader')return;const max=2*60*60*1000;const signedAt=auth.currentUser?.metadata?.lastSignInTime?new Date(auth.currentUser.metadata.lastSignInTime).getTime():Date.now();const remain=Math.max(0,max-(Date.now()-signedAt));if(remain<=0){toast('Phiên giám khảo đã hết hạn. Hệ thống tự đăng xuất.','error');return doLogout()}if(remain>5*60*1000)warningTimer=setTimeout(()=>toast('Phiên giám khảo sẽ tự đăng xuất sau 5 phút.','error'),remain-5*60*1000);sessionTimer=setTimeout(()=>{toast('Phiên giám khảo đã hết hạn. Hệ thống tự đăng xuất.','error');doLogout()},remain)}
async function startUser(user){currentUser=user;store.set({user});route=allowedRoute(user,['Admin','SuperAdmin'].includes(user.role)?'dashboard':'grading');renderLayout(user,route,navigate,doLogout);startRealtime(user);startSessionClock(user);if(['Admin','SuperAdmin'].includes(user.role))migrateLegacyDataOnce(user).catch(e=>console.warn('migration',e));if(user.role==='Grader')startPresence(user,()=>({groupId:store.get().selectedGroupId,candidateId:store.get().selectedCandidateId}));await renderRoute();booting=false}
async function doLogout(){if(currentUser?.role==='Grader')await markOffline(currentUser);stopRealtime();clearTimeout(sessionTimer);clearTimeout(warningTimer);currentUser=null;await logout();renderLogin(startUser)}
const routeEvents={dashboard:new Set(['groups','candidates','scores','verifications','presence','system','user','selection','state']),groups:new Set(['groups','selection']),candidates:new Set(['groups','candidates','selection']),queue:new Set(['groups','candidates','selection','system']),live:new Set(['groups','candidates','scores','verifications','presence','system']),grading:new Set(['groups','candidates','scores','verifications','system','user','selection']),analytics:new Set(['groups','candidates','scores','selection']),reports:new Set(['groups','candidates','scores','selection','system']),graders:new Set(['groups','user']),backup:new Set([]),audit:new Set([])};
store.subscribe((_state,type)=>{if(routeEvents[route]?.has(type)||type==='state')scheduleRender()});
window.addEventListener('online',async()=>{if(currentUser?.role==='Grader'){const r=await flushScoreQueue(currentUser);if(r.done)toast(`Đã đồng bộ ${r.done} bảng điểm offline`);if(r.conflicts)toast(`${r.conflicts} bảng điểm offline bị xung đột, chưa ghi đè dữ liệu mới trên server.`,'error');updateStatus()}});
window.addEventListener('offline',()=>toast('Mất kết nối. Điểm mới sẽ được lưu vào hàng chờ offline.','error'));
watchAuth(async user=>{if(booting){if(!user){booting=false;renderLogin(startUser);return}try{const p=await restoreProfile(user);if(p)await startUser(p);else{await logout();renderLogin(startUser)}}catch(e){console.error(e);renderLogin(startUser);toast('Không thể khôi phục phiên đăng nhập.','error')}return}if(!user&&currentUser){currentUser=null;renderLogin(startUser)}});
