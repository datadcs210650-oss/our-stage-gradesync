import { groupStatus } from '../utils/time.js';
export const defaultColumns=()=>[
  {key:'stt',label:'STT',type:'text'},
  {key:'criterion',label:'TIÊU CHÍ CHẤM ĐIỂM',type:'text'},
  {key:'content',label:'NỘI DUNG',type:'textarea'},
  {key:'weight',label:'TRỌNG SỐ',type:'percent'},
  {key:'maxScore',label:'ĐIỂM TỐI ĐA',type:'number'},
  {key:'note',label:'GHI CHÚ',type:'textarea'}
];
export function normalizeContent(g={}){
  const cfg=g.contentConfig||{},sc=cfg.scoringContent||{},iv=cfg.interviewContent||{};
  const columns=Array.isArray(sc.columns)&&sc.columns.length?sc.columns:defaultColumns();
  const rows=(sc.rows||[]).map((r,i)=>r.cells?{id:r.id||crypto.randomUUID(),cells:{...r.cells}}:{id:r.id||crypto.randomUUID(),cells:{stt:String(i+1),criterion:r.name||r.criterion||'',content:r.content||'',weight:r.weight??'',maxScore:r.maxScore??'',note:r.note||''}});
  const groups=(iv.groups||[]).map((x,i)=>({id:x.id||crypto.randomUUID(),title:x.title||x.type||`Dạng ${i+1}`,description:x.description||'',questions:(x.questions||[]).map(q=>typeof q==='string'?{id:crypto.randomUUID(),text:q,note:''}:{id:q.id||crypto.randomUUID(),text:q.text||q.question||'',note:q.note||''})}));
  return{scoringContent:{enabled:sc.enabled===true,mode:sc.mode==='before'?'before':'group',title:sc.title||'TIÊU CHÍ CHẤM ĐIỂM',columns,rows},interviewContent:{enabled:iv.enabled===true,mode:iv.mode==='before'?'before':'group',title:iv.title||'CÂU HỎI PHỎNG VẤN',groups}};
}
export function sectionAccess(g,key){const cfg=normalizeContent(g),sec=cfg[key];if(!sec.enabled)return{enabled:false,open:false,text:'Chưa bật'};if(sec.mode==='before')return{enabled:true,open:true,text:'Mở trước giờ chấm'};const st=groupStatus(g);return{enabled:true,open:st.open,text:st.open?'Đang mở theo nhóm':st.label}}
