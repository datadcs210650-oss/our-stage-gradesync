import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc,getDoc,collection,query,where,getDocs,setDoc,serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { auth,db } from '../config/firebase.js';

const graderEmail=code=>`${String(code||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'')}@grader.gradesync.local`;

async function resolveAdminProfile(user){
  const direct=await getDoc(doc(db,'users',user.uid));
  if(direct.exists()){const d=direct.data();if(['Admin','SuperAdmin'].includes(d?.role))await setDoc(doc(db,'admin_sessions',user.uid),{authUid:user.uid,profileId:direct.id,email:user.email,updatedAt:serverTimestamp()},{merge:true});return{id:direct.id,...d};}
  const q=query(collection(db,'users'),where('email','==',user.email));
  const s=await getDocs(q);const d=s.docs.find(x=>['Admin','SuperAdmin'].includes(x.data()?.role));
  if(!d)return null;
  await setDoc(doc(db,'admin_sessions',user.uid),{authUid:user.uid,profileId:d.id,email:user.email,updatedAt:serverTimestamp()},{merge:true});
  return{id:d.id,...d.data()};
}

export async function loginAdmin(email,password){
  const cred=await signInWithEmailAndPassword(auth,email.trim(),password);
  const profile=await resolveAdminProfile(cred.user);
  if(!profile||!['Admin','SuperAdmin'].includes(profile.role)){await signOut(auth);throw new Error('Tài khoản không có quyền Admin/SuperAdmin.');}
  return{authUid:cred.user.uid,email:cred.user.email,...profile};
}
export async function loginGrader(code,password){
  const cred=await signInWithEmailAndPassword(auth,graderEmail(code),password);
  const p=await getDoc(doc(db,'users',cred.user.uid));
  if(!p.exists()||p.data()?.role!=='Grader'){await signOut(auth);throw new Error('Tài khoản giám khảo chưa được kích hoạt.');}
  if(p.data()?.status==='Inactive'){await signOut(auth);throw new Error('Tài khoản giám khảo đã bị khóa.');}
  return{authUid:cred.user.uid,id:p.id,email:cred.user.email,...p.data()};
}
export const logout=()=>signOut(auth);
export function watchAuth(cb){return onAuthStateChanged(auth,cb)}
export async function restoreProfile(user){
  if(!user)return null;
  // Grader accounts in V28 are stored at users/{authUid}. Restore them directly
  // before trying the Admin profile resolution path.
  try{
    const own=await getDoc(doc(db,'users',user.uid));
    if(own.exists()){
      const d=own.data()||{};
      if(d.role==='Grader'){
        if(d.status==='Inactive') return null;
        return {authUid:user.uid,id:own.id,email:user.email,...d};
      }
      if(['Admin','SuperAdmin'].includes(d.role)){
        await setDoc(doc(db,'admin_sessions',user.uid),{authUid:user.uid,profileId:own.id,email:user.email,updatedAt:serverTimestamp()},{merge:true});
        return {authUid:user.uid,id:own.id,email:user.email,...d};
      }
    }
  }catch(e){ console.warn('restore own profile',e); }
  const p=await resolveAdminProfile(user);
  return p?({authUid:user.uid,email:user.email,...p}):null;
}
export async function idToken(){return auth.currentUser?.getIdToken(true)}
export {graderEmail};
