import admin from 'firebase-admin';

function credentials(){
  if(process.env.FIREBASE_SERVICE_ACCOUNT_JSON){
    const raw=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if(raw.private_key)raw.private_key=raw.private_key.replace(/\\n/g,'\n');
    return admin.credential.cert(raw);
  }
  const projectId=process.env.FIREBASE_PROJECT_ID;
  const clientEmail=process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey=(process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
  if(!projectId||!clientEmail||!privateKey)throw new Error('Thiếu biến môi trường Firebase Admin.');
  return admin.credential.cert({projectId,clientEmail,privateKey});
}
if(!admin.apps.length)admin.initializeApp({credential:credentials()});
export const adminAuth=admin.auth();
export const adminDb=admin.firestore();
export async function requireAdmin(req){
  const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw new Error('UNAUTHORIZED');
  const token=await adminAuth.verifyIdToken(h.slice(7));
  let p=await adminDb.collection('users').doc(token.uid).get();
  if(!p.exists&&token.email){const q=await adminDb.collection('users').where('email','==',token.email).limit(5).get();p=q.docs.find(d=>['Admin','SuperAdmin'].includes(d.data()?.role))||null}
  if(!p||!p.exists||!['Admin','SuperAdmin'].includes(p.data()?.role))throw new Error('FORBIDDEN');
  return{token,profile:{id:p.id,...p.data()}};
}
export function syntheticGraderEmail(code){return `${String(code||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'')}@grader.gradesync.local`}
