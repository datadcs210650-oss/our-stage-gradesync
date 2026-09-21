import { col,addDoc,serverTimestamp } from '../data/firestore.js';
export async function audit(type,payload={},user={}){try{await addDoc(col('audit_logs'),{type,...payload,actorUid:user.authUid||'',actorName:user.name||'',actorRole:user.role||'',timestamp:serverTimestamp(),schemaVersion:3})}catch(e){console.warn('audit',e)}}
