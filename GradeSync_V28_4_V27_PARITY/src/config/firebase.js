import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore, enableIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

export const firebaseConfig={
  apiKey:'AIzaSyDwH3O5e4BQFcXouq-O_q2qs2xqbIwSK7s',
  authDomain:'grading-management-software.firebaseapp.com',
  projectId:'grading-management-software',
  storageBucket:'grading-management-software.firebasestorage.app',
  messagingSenderId:'470253933713',
  appId:'1:470253933713:web:17d27fe21def1fc3449b30'
};
export const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getFirestore(app);
setPersistence(auth,browserLocalPersistence).catch(()=>{});
enableIndexedDbPersistence(db).catch(()=>{});
