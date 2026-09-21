import { ref,getDoc,setDoc,runTransaction,serverTimestamp } from '../data/firestore.js';
import { weightedTotal,validateScoreSheet } from '../utils/scoring.js';
import { enqueueScore,pendingScores,removeScore } from '../offline/scoreQueue.js';

export async function saveScore({grader,candidate,group,scores,criterionComments={},candidateComment='',standout=false,baseRevision=0}){
  const totalScore=weightedTotal(group.criteria||[],scores);
  const scoreId=`${grader.authUid}_${candidate.id}`;
  const scoreRef=ref('scores',scoreId);
  const payload={candidateId:candidate.id,groupId:group.id,graderUid:grader.authUid,graderCode:grader.code,graderName:grader.name,scores,criterionComments,candidateComment,standout,totalScore,schemaVersion:3,updatedAt:serverTimestamp()};
  if(!navigator.onLine){enqueueScore({graderUid:grader.authUid,candidateId:candidate.id,groupId:group.id,baseRevision:Number(baseRevision||0),payload:{...payload,updatedAt:null}});return{queued:true,totalScore}}
  const snap=await getDoc(scoreRef);
  if(!snap.exists()){
    await setDoc(scoreRef,{...payload,revision:1,createdAt:serverTimestamp()});return{revision:1,totalScore};
  }
  const expected=Number(snap.data()?.revision||0);
  const revision=await runTransaction((await import('../config/firebase.js')).db,async tx=>{
    const latest=await tx.get(scoreRef);if(!latest.exists())throw new Error('SCORE_MISSING');
    const server=Number(latest.data()?.revision||0);if(server!==expected){const e=new Error('SCORE_CONFLICT');e.code='SCORE_CONFLICT';throw e}
    tx.set(scoreRef,{...payload,revision:server+1},{merge:true});return server+1;
  });
  return{revision,totalScore};
}

export async function flushScoreQueue(grader){
  const q=pendingScores();let done=0,failed=0,conflicts=0;
  const {db}=await import('../config/firebase.js');
  for(const item of q){
    if(item.graderUid!==grader.authUid)continue;
    try{
      const scoreRef=ref('scores',item.key);
      await runTransaction(db,async tx=>{
        const snap=await tx.get(scoreRef);
        if(!snap.exists()){
          if(Number(item.baseRevision||0)!==0){const e=new Error('OFFLINE_CONFLICT');e.code='OFFLINE_CONFLICT';throw e}
          tx.set(scoreRef,{...item.payload,revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
          return;
        }
        const serverRevision=Number(snap.data()?.revision||0);
        if(serverRevision!==Number(item.baseRevision||0)){const e=new Error('OFFLINE_CONFLICT');e.code='OFFLINE_CONFLICT';throw e}
        tx.set(scoreRef,{...item.payload,revision:serverRevision+1,updatedAt:serverTimestamp()},{merge:true});
      });
      removeScore(item.key);done++;
    }catch(e){if(e.code==='OFFLINE_CONFLICT'||e.message==='OFFLINE_CONFLICT')conflicts++;else failed++;}
  }
  return{done,failed,conflicts};
}
export function validateBeforeSubmit(group,candidates,scoreMap,graderUid){
  const problems=[];for(const c of candidates){if(group.attendanceEnabled&&!c.isPresent)continue;if(c.locked)continue;const s=scoreMap.get(`${graderUid}_${c.id}`)||{};const v=validateScoreSheet(group.criteria||[],s);if(!v.ok)problems.push({candidate:c,missing:v.missing})}return problems;
}
