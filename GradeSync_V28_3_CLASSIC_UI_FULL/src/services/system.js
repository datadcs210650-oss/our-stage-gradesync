import { ref,setDoc,serverTimestamp } from '../data/firestore.js';
export async function setEmergencyLock(lockAll,reason='',user=null){await setDoc(ref('system_config','global'),{emergencyLock:!!lockAll,reason:String(reason||''),updatedAt:serverTimestamp(),updatedBy:user?.name||user?.email||''},{merge:true})}
export async function setReportLogo(dataUrl,user=null){await setDoc(ref('system_config','global'),{reportLogoDataUrl:dataUrl||'',updatedAt:serverTimestamp(),updatedBy:user?.name||''},{merge:true})}
