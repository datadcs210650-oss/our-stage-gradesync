export function weightedTotal(criteria=[],scores={}){return Number(criteria.reduce((sum,c)=>sum+(Number(scores[c.name]??0)*Number(c.weight||0)/100),0).toFixed(2))}
export function validateScoreSheet(criteria=[],scoreDoc={}){const missing=criteria.filter(c=>scoreDoc?.scores?.[c.name]===undefined||scoreDoc?.scores?.[c.name]==='').map(c=>c.name);return{ok:missing.length===0,missing}}
export function mean(xs=[]){const n=xs.filter(Number.isFinite);return n.length?n.reduce((a,b)=>a+b,0)/n.length:0}
export function stddev(xs=[]){const m=mean(xs);const n=xs.filter(Number.isFinite);return n.length?Math.sqrt(n.reduce((s,x)=>s+(x-m)**2,0)/n.length):0}
export function councilAverage(scoreDocs=[]){return Number(mean(scoreDocs.map(s=>Number(s.totalScore))).toFixed(2))}
export function histogram(values=[],step=10){const bins=Array.from({length:Math.ceil(100/step)},(_,i)=>({from:i*step,to:(i+1)*step,count:0}));values.forEach(v=>{const n=Math.max(0,Math.min(99.999,Number(v)||0));bins[Math.floor(n/step)].count++});return bins}
