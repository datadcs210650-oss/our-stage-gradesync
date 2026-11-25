import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {makeReportPdf,pdfFilename} from "./osc-report-pdf.js";
const hash=/^[a-f0-9]{64}$/,codePattern=/^[0-9]{8}$/;
const dateFormat=new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",day:"2-digit",month:"2-digit",year:"numeric"});
const timeFormat=new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
const txt=(x,max=300)=>String(x??"").normalize("NFC").trim().slice(0,max);
const fmt=x=>x!==null&&x!==undefined&&x!==""&&Number.isFinite(Number(x))?Number(Number(x).toFixed(2)).toString():"-";
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const formatDate=d=>{const [day,month,year]=dateFormat.format(d).split("/");return "Cần Thơ, ngày "+day+" tháng "+month+" năm "+year};
function asDate(x){if(!x)return null;const d=new Date(x);return Number.isFinite(d.getTime())?d:null;}
let font;
function reportFont(){return font||(font=readFileSync(new URL("./pdf-fonts/Tinos-Regular.ttf",import.meta.url)))}
function receiptValid(r){return r?.confirmation_method==="email-otp"&&hash.test(r.snapshot_sha256||"")&&codePattern.test(r.comparison_code||"")&&Array.isArray(r.snapshot)&&!!asDate(r.verified_at)}
function criteriaFor(g){return Array.isArray(g.criteria)?g.criteria:[]}
function validScore(v){return typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=10}
function selectResult(row,filter){return filter==="ALL"||(filter==="PASS"&&row.result==="ĐẠT")||(filter==="FAIL"&&row.result==="KHÔNG ĐẠT")}
function makeRows(candidates,criteria,fields,roleHeader,entries,filter){
 const rows=[];for(const c of candidates){const r=entries.get(c.id)||{result:"CHỜ",scores:{},total:null,roles:[]};if(!selectResult(r,filter))continue;
 const extra={...(c.extra_data?.extraData||{}),...(c.custom_fields||{})};rows.push([String(rows.length+1),txt(c.code,80)||"-",txt(c.name,300)||"-",...fields.map(f=>txt(extra[f.name],500)||"-"),...criteria.map(k=>fmt(r.scores?.[k.name])),...(roleHeader?[r.roles?.join(", ")||"-"]:[]),fmt(r.total),r.result]);}
 return rows;
}
function assertRequest(b){if(!["ALL","PASS","FAIL"].includes(b.resultFilter||"ALL")||!["ALL","PRESENT","ABSENT"].includes(b.attendanceFilter||"ALL")||!["landscape","portrait"].includes(b.orientation||"landscape"))throw Error("Bộ lọc PDF không hợp lệ.");}
export async function exportGradingPdf(db,b,actor,h){
 const {byId,readAll,check,results}=h;
 assertRequest(b);
 const group=await byId(db,"competition_groups",b.groupId),all=String(b.graderCode||"ALL")==="ALL";
 const criteria=criteriaFor(group),fields=(group.extra_data?.extraFields||[]).filter(f=>f&&typeof f.name==="string"&&(b.expHidden===true||f.showToGrader===true)).slice(0,40);
 let candidates=await readAll(db,"candidates",{group_id:group.id});candidates.sort((a,z)=>String(a.code).localeCompare(String(z.code),"vi",{numeric:true}));
 const wholeCandidates=candidates.slice();
 if(group.extra_data?.attendanceEnabled===true&&b.attendanceFilter&&b.attendanceFilter!=="ALL")candidates=candidates.filter(c=>b.attendanceFilter==="PRESENT"?c.is_present===true:c.is_present!==true);
 const entries=new Map();let judge="Hội đồng Giám khảo",graderId=null,receipt=null,confirmed=false,signTime="",signDate=new Date(),roleHeader="",note="",issueKind="draft",code="";
 if(!all){
  const graderCode=txt(b.graderCode,20).toUpperCase();if(!/^[A-Z0-9_-]{3,20}$/.test(graderCode))throw Error("Mã BGK không hợp lệ.");
  const graders=check(await db.from("profiles").select("id,name,code").eq("code",graderCode).eq("role","Grader").limit(2));if(graders.length!==1)throw Error("Không tìm thấy BGK.");
  const grader=graders[0];judge=grader.name||graderCode;graderId=grader.id;
  const [rec,assign,grants,raw]=await Promise.all([
   db.from("gs_grading_receipts").select("grader_name,verified_at,snapshot,snapshot_sha256,comparison_code,confirmation_method,completeness").eq("group_id",group.id).eq("grader_id",grader.id).maybeSingle(),
   db.from("grader_assignments").select("id").eq("group_id",group.id).eq("grader_id",grader.id).maybeSingle(),
   db.from("gs_criterion_grants").select("criterion").eq("group_id",group.id).eq("grader_id",grader.id),
   db.from("scores").select("candidate_id,scores,total_score,extra_data").eq("group_id",group.id).eq("grader_id",grader.id).limit(1501)
  ]);
  receipt=check(rec);if(!check(assign)&&!receipt)throw Error("BGK không được phân công phiên này.");
  const allowed=new Set(check(grants).map(g=>g.criterion)),expected=criteria.filter(k=>!allowed.size||allowed.has(k.name));
  confirmed=receiptValid(receipt);
  if(confirmed){issueKind="individual";judge=receipt.grader_name||judge;code=receipt.comparison_code;signDate=asDate(receipt.verified_at);signTime=timeFormat.format(signDate)+" - "+dateFormat.format(signDate);note="Nguồn điểm: bảng điểm đã khóa qua OTP. "+(receipt.completeness?.partial?"Xác nhận một phần; các ô chưa chấm không tính là điểm.":"");}
  else{note="Bản chưa có xác nhận OTP đủ thông tin đối chiếu; không phải biên bản đã xác nhận.";}
  const items=confirmed?receipt.snapshot:check(raw).map(s=>({candidateId:s.candidate_id,scores:s.scores,total:s.total_score,proposedRoles:s.extra_data?.gsProposedRoles||[]}));
  if(items.length>1500)throw Error("Dữ liệu vượt giới hạn xuất PDF.");
  if(confirmed&&items.some(s=>!wholeCandidates.some(c=>c.id===s.candidateId)))throw Error("Hồ sơ trong bảng điểm đã khóa không còn đầy đủ; không thể phát hành biên bản.");
  if(group.extra_data?.gsCasting?.roles?.length)roleHeader="Vai BGK đề xuất";
  for(const s of items){const vals=s.scores||{},entered=Object.values(vals).some(validScore),complete=expected.length>0&&expected.every(k=>validScore(vals[k.name]))&&s.total!==null&&Number.isFinite(Number(s.total))&&Number(s.total)>=0&&Number(s.total)<=10;
   entries.set(s.candidateId,{scores:vals,total:entered?s.total:null,result:!entered?"CHƯA CHẤM":!complete?"CHƯA ĐỦ":Number(s.total)>=Number(group.pass_score)?"ĐẠT":"KHÔNG ĐẠT",roles:Array.isArray(s.proposedRoles)?s.proposedRoles:[]});}
 }else{
  if(!group.casting_id)throw Error("Phiên chưa thuộc casting. Hãy gắn phiên vào casting trước khi xuất tổng hợp.");
  const [info,q,raw,official]=await Promise.all([results(db,group.casting_id),db.rpc("osc_candidate_quorum",{p_casting:group.casting_id}),readAll(db,"scores",{group_id:group.id}),readAll(db,"gs_casting_decisions",{casting_id:group.casting_id})]);
  const qm=new Map(check(q).map(x=>[x.candidate_id,x])),dm=new Map(official.map(x=>[x.candidate_id,x])),current=info.rows.filter(x=>x.groupId===group.id);
  const byCandidate=new Map();for(const s of raw){const l=byCandidate.get(s.candidate_id)||[];l.push(s);byCandidate.set(s.candidate_id,l);}
  confirmed=wholeCandidates.length>0&&current.length===wholeCandidates.length&&current.every(r=>!r.incomplete&&r.review==="approved"&&dm.get(r.id)?.score!=null&&Math.abs(Number(dm.get(r.id).score)-Number(r.score))<0.005&&dm.get(r.id)?.outcome===r.outcome);
  if(confirmed)issueKind="aggregate";
  const first=current[0];signTime=first?"BGK xác nhận: "+first.submittedJudges+"/"+first.expectedJudges:"Chưa có BGK xác nhận";
  if(group.extra_data?.gsCasting?.roles?.length)roleHeader="Vai chính thức";
  note=confirmed?"Tổng hợp kết quả đã được BCN duyệt; không phải xác nhận cá nhân của BGK.":"Bản tổng hợp đối soát; chỉ dùng điểm BGK đã khóa hợp lệ. Hồ sơ chưa đủ trên 50% BGK hoặc chưa duyệt được đánh dấu chờ.";
  for(const r of current){const valid=new Set(qm.get(r.id)?.valid_ids||[]),scores=(byCandidate.get(r.id)||[]).filter(s=>valid.has(s.grader_id)),vals={};
   for(const k of criteria){const a=scores.map(s=>s.scores?.[k.name]).filter(validScore);if(a.length)vals[k.name]=a.reduce((s,x)=>s+x,0)/a.length;}
   const d=dm.get(r.id),approved=!r.incomplete&&r.review==="approved"&&d?.score!=null&&Math.abs(Number(d.score)-Number(r.score))<0.005&&d.outcome===r.outcome;
   entries.set(r.id,{scores:vals,total:r.incomplete?null:approved?d.score:r.score,result:r.incomplete?"CHỜ":approved?(d.outcome==="passed"?"ĐẠT":d.outcome==="failed"?"KHÔNG ĐẠT":"CHỜ DUYỆT"):"CHỜ DUYỆT",roles:approved?(d.assigned_roles||[]):[]});
  }
 }
 const filter=b.resultFilter||"ALL",attendance=b.attendanceFilter||"ALL";
 if(filter!=="ALL")note+=" Bộ lọc: "+(filter==="PASS"?"Đạt":"Không đạt")+".";
 if(attendance!=="ALL"&&group.extra_data?.attendanceEnabled===true)note+=" Điểm danh: "+(attendance==="PRESENT"?"Có mặt":"Vắng mặt")+".";
 const columns=["STT","Mã số","Họ tên thí sinh",...fields.map(f=>txt(f.name,120)),...criteria.map(k=>txt(k.name,120)+"\n"+fmt(k.weight)+"%"),...(roleHeader?[roleHeader]:[]),"Tổng","Kết quả"];
 const model={documentKey:digest(Buffer.from(group.id+"|"+(receipt?.snapshot_sha256||"")+"|"+(receipt?.comparison_code||""))),title:txt(b.docTitle,160)||"BIÊN BẢN CHẤM THI KẾT QUẢ",session:group.name||group.id,judge,kind:all?"aggregate":"individual",code,confirmed,passScore:group.pass_score??0,note,dateLine:formatDate(signDate),signTime,orientation:b.orientation||"landscape",columns,rows:makeRows(candidates,criteria,fields,roleHeader,entries,filter)};
 const result=makeReportPdf(model,reportFont());if(result.bytes.length>2800000)throw Error("Biên bản vượt 2,8 MB; hãy giảm bộ lọc/trường phụ để xuất.");
 const sha256=digest(result.bytes),pdfBase64=result.bytes.toString("base64"),filename=pdfFilename(model.session,judge,code,model.kind);
 check(await db.from("osc_grading_pdf_issues").upsert({sha256,group_id:group.id,grader_id:graderId,kind:issueKind,comparison_code:code||null,receipt_hash:confirmed&&!all?receipt.snapshot_sha256:null,receipt_at:confirmed&&!all?receipt.verified_at:null,pdf_base64:pdfBase64,byte_length:result.bytes.length,actor_uid:actor.decoded.uid},{onConflict:"sha256",ignoreDuplicates:true}));
 return {ok:true,pdfBase64,filename,sha256,pages:result.pages,confirmed,kind:issueKind};
}
export async function verifyGradingPdf(db,b){
 const sha=String(b.sha256||"").toLowerCase(),code=String(b.comparisonCode||"").trim();
 if(!hash.test(sha)||(code&&!codePattern.test(code)))return {ok:true,verified:false,status:"invalid"};
 const response=await db.from("osc_grading_pdf_issues").select("group_id,grader_id,kind,comparison_code,receipt_hash,receipt_at").eq("sha256",sha).maybeSingle();if(response.error)throw Error("Không thể truy cập sổ biên bản.");
 const row=response.data;if(!row||row.comparison_code!==(code||null))return {ok:true,verified:false,status:"not-found"};
 if(row.kind==="draft")return {ok:true,verified:false,status:"draft"};
 if(row.kind==="individual"){
  const r=await db.from("gs_grading_receipts").select("snapshot_sha256,verified_at,comparison_code,confirmation_method").eq("group_id",row.group_id).eq("grader_id",row.grader_id).maybeSingle();if(r.error)throw Error("Không thể đối chiếu trạng thái bảng điểm.");
  if(!r.data||r.data.confirmation_method!=="email-otp"||r.data.snapshot_sha256!==row.receipt_hash||r.data.comparison_code!==row.comparison_code||asDate(r.data.verified_at)?.getTime()!==asDate(row.receipt_at)?.getTime())return {ok:true,verified:false,status:"superseded"};
  return {ok:true,verified:true,status:"individual"};
 }
 return {ok:true,verified:true,status:"aggregate-archive"};
}
