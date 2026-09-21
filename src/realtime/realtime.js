import { store } from '../state/store.js';
import { col,ref,query,where,onSnapshot } from '../data/firestore.js';
import { groupOpen } from '../utils/time.js';

const perGroup=new Map();let clock=null;
function applyChanges(map,snap){for(const ch of snap.docChanges()){if(ch.type==='removed')map.delete(ch.doc.id);else map.set(ch.doc.id,{id:ch.doc.id,...ch.doc.data()})}}
function clearGroupData(id){const st=store.get();for(const [k,v] of [...st.candidates])if(v.groupId===id)st.candidates.delete(k);for(const [k,v] of [...st.scores])if(v.groupId===id)st.scores.delete(k);for(const [k,v] of [...st.verifications])if(v.groupId===id)st.verifications.delete(k)}
function stopData(entry,id){(entry.dataUnsubs||[]).forEach(u=>{try{u()}catch{}});entry.dataUnsubs=[];entry.dataActive=false;clearGroupData(id)}
function startData(entry,id,user){if(entry.dataActive)return;entry.dataActive=true;const us=[];
  us.push(onSnapshot(query(col('candidates'),where('groupId','==',id)),snap=>{applyChanges(store.get().candidates,snap);store.emit('candidates')},e=>{console.warn('cands',e);entry.dataActive=false}));
  us.push(onSnapshot(query(col('scores'),where('groupId','==',id),where('graderUid','==',user.authUid)),snap=>{applyChanges(store.get().scores,snap);store.emit('scores')},e=>{console.warn('scores',e);entry.dataActive=false}));
  us.push(onSnapshot(query(col('grader_verifications'),where('groupId','==',id),where('graderUid','==',user.authUid)),snap=>{applyChanges(store.get().verifications,snap);store.emit('verifications')},e=>{console.warn('verify',e);entry.dataActive=false}));
  entry.dataUnsubs=us;
}
function syncData(id,user){const entry=perGroup.get(id);if(!entry)return;const g=store.get().groups.get(id);const should=!!g&&groupOpen(g);if(should&&!entry.dataActive)startData(entry,id,user);else if(!should&&entry.dataActive)stopData(entry,id)}
function attachGroup(id,user){if(perGroup.has(id))return;const entry={dataUnsubs:[],dataActive:false,unsubGroup:null};entry.unsubGroup=onSnapshot(ref('competition_groups',id),snap=>{const st=store.get();if(snap.exists())st.groups.set(id,{id:snap.id,...snap.data()});else st.groups.delete(id);syncData(id,user);store.emit('groups')},e=>console.warn('group',e));perGroup.set(id,entry)}
function stopGroup(id){const entry=perGroup.get(id);if(!entry)return;try{entry.unsubGroup?.()}catch{}stopData(entry,id);perGroup.delete(id);store.get().groups.delete(id)}

export function startRealtime(user){stopRealtime();const st=store.get();st.user=user;
  if(['Admin','SuperAdmin'].includes(user.role)){
    store.addUnsub(onSnapshot(col('competition_groups'),snap=>{applyChanges(st.groups,snap);if(!st.selectedGroupId&&snap.docs[0])st.selectedGroupId=snap.docs[0].id;store.emit('groups')},e=>console.warn('groups admin',e)));
    store.addUnsub(onSnapshot(col('candidates'),snap=>{applyChanges(st.candidates,snap);store.emit('candidates')},e=>console.warn('candidates admin',e)));
    store.addUnsub(onSnapshot(col('scores'),snap=>{applyChanges(st.scores,snap);store.emit('scores')},e=>console.warn('scores admin',e)));
    store.addUnsub(onSnapshot(col('grader_verifications'),snap=>{applyChanges(st.verifications,snap);store.emit('verifications')},e=>console.warn('verifications admin',e)));
    store.addUnsub(onSnapshot(col('grading_presence'),snap=>{applyChanges(st.presence,snap);store.emit('presence')},e=>console.warn('presence',e)));
  }else{
    store.addUnsub(onSnapshot(ref('users',user.authUid),snap=>{if(!snap.exists())return;const profile={authUid:user.authUid,id:snap.id,...snap.data()};st.user=profile;const ids=new Set(profile.assignedGroups||[]);for(const id of ids)attachGroup(id,profile);for(const id of [...perGroup.keys()])if(!ids.has(id))stopGroup(id);if(!st.selectedGroupId||!ids.has(st.selectedGroupId))st.selectedGroupId=[...ids][0]||null;store.emit('user')},e=>console.warn('grader profile',e)));
    clock=setInterval(()=>{for(const id of perGroup.keys())syncData(id,st.user)},2000);
  }
  store.addUnsub(onSnapshot(ref('system_config','global'),snap=>{st.system=snap.exists()?{...st.system,...snap.data()}:st.system;store.emit('system')},e=>console.warn('system config',e)));
}
export function stopRealtime(){store.clearListeners();for(const id of [...perGroup.keys()])stopGroup(id);if(clock){clearInterval(clock);clock=null}}
