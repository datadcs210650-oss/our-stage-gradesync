import { collection,doc,getDoc,getDocs,setDoc,addDoc,deleteDoc,query,where,onSnapshot,writeBatch,serverTimestamp,runTransaction,orderBy,limit } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { db } from '../config/firebase.js';
export {db,collection,doc,getDoc,getDocs,setDoc,addDoc,deleteDoc,query,where,onSnapshot,writeBatch,serverTimestamp,runTransaction,orderBy,limit};
export const col=n=>collection(db,n);export const ref=(c,id)=>doc(db,c,id);
export async function chunkedCommit(ops,chunk=350){for(let i=0;i<ops.length;i+=chunk){const b=writeBatch(db);for(const op of ops.slice(i,i+chunk)){if(op.type==='delete')b.delete(op.ref);else b.set(op.ref,op.data,op.options||{merge:true})}await b.commit()}}
