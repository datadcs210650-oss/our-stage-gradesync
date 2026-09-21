import { idToken } from '../auth/auth.js';
async function call(path,body){const token=await idToken();const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j}
export const createGraderAccount=data=>call('/api/admin/create-grader',data);
export const resetGraderPassword=data=>call('/api/admin/reset-grader',data);
export const deleteGraderAccount=data=>call('/api/admin/delete-grader',data);
