import { ref,setDoc,serverTimestamp,deleteDoc } from '../data/firestore.js';
let timer=null;let current={};
export function startPresence(user,getContext){stopPresence();const beat=async()=>{if(!navigator.onLine)return;current=getContext?.()||{};try{await setDoc(ref('grading_presence',user.authUid),{graderUid:user.authUid,graderCode:user.code||'',graderName:user.name||'',state:'online',groupId:current.groupId||null,candidateId:current.candidateId||null,lastSeen:serverTimestamp()},{merge:true})}catch{}};beat();timer=setInterval(beat,20000)}
export function stopPresence(){if(timer){clearInterval(timer);timer=null}}
export async function markOffline(user){stopPresence();try{await setDoc(ref('grading_presence',user.authUid),{state:'offline',lastSeen:serverTimestamp()},{merge:true})}catch{}}
