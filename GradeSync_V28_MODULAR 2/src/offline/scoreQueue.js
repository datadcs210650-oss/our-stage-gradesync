const KEY='gradeSyncV28ScoreQueue';
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}};
const write=q=>localStorage.setItem(KEY,JSON.stringify(q));
export function enqueueScore(item){const q=read();const key=`${item.graderUid}_${item.candidateId}`;const next=q.filter(x=>x.key!==key);next.push({...item,key,queuedAt:Date.now()});write(next);return next.length}
export function pendingScores(){return read()}
export function removeScore(key){const q=read().filter(x=>x.key!==key);write(q);return q.length}
export function clearScoreQueue(){write([])}
