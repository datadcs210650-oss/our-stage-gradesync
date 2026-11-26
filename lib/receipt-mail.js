import {createHash} from "node:crypto";
import {exportGradingPdf} from "./osc-pdf-service.js";
import {pdfFilename} from "./osc-report-pdf.js";
import {sendScoringMail} from "./scoring-mail-relay.js";
const check=r=>{if(r.error)throw Error("Không thể truy cập dữ liệu xác nhận: "+r.error.code);return r.data};
const byId=async(db,t,id)=>check(await db.from(t).select("*").eq("id",id).single());
async function readAll(db,t,where){const rows=[];for(let off=0;off<1600;off+=200){let q=db.from(t).select("*").order("id").range(off,off+199);for(const [k,v] of Object.entries(where))q=q.eq(k,v);const data=check(await q);rows.push(...data);if(rows.length>1500)throw Error("Bảng điểm vượt giới hạn PDF.");if(data.length<200)return rows;}throw Error("Dữ liệu vượt giới hạn PDF.");}
async function canonicalPdf(db,j){
 if(j.pdf_sha256){
  const stored=check(await db.from("osc_grading_pdf_issues").select("sha256,pdf_base64,kind,comparison_code").eq("sha256",j.pdf_sha256).maybeSingle());
  if(!stored||stored.kind!=="individual"||stored.comparison_code!==j.comparison_code)throw Error("Không tìm thấy biên bản gốc.");
  if(createHash("sha256").update(Buffer.from(stored.pdf_base64,"base64")).digest("hex")!==stored.sha256)throw Error("Biên bản gốc không trùng khớp.");
  return {pdfBase64:stored.pdf_base64,sha256:stored.sha256,filename:pdfFilename(j.group_name,j.grader_name,j.comparison_code,"individual")};
 }
 const profile=await byId(db,"profiles",j.grader_id);
 const report=await exportGradingPdf(db,{groupId:j.group_id,graderCode:profile.code,orientation:"landscape",resultFilter:"ALL",attendanceFilter:"ALL",expHidden:false},{decoded:{uid:"receipt:"+j.grader_id}},{byId,readAll,check});
 if(!report.confirmed||report.kind!=="individual"||!report.filename.endsWith("_"+j.comparison_code+".pdf"))throw Error("Xác nhận bảng điểm đã thay đổi.");
 check(await db.from("osc_receipt_mail_jobs").update({pdf_sha256:report.sha256}).eq("id",j.id).eq("attempts",j.attempts).eq("status","sending"));
 return report;
}

async function revisionPdf(db,j){
 const filename="NTCD_BANG_DIEM_DIEU_CHINH_CHUA_XAC_NHAN.pdf";
 if(j.pdf_sha256){
  const stored=check(await db.from("osc_grading_pdf_issues").select("sha256,pdf_base64,kind,group_id,grader_id").eq("sha256",j.pdf_sha256).maybeSingle());
  if(!stored||stored.kind!=="draft"||stored.group_id!==j.group_id||stored.grader_id!==j.grader_id||createHash("sha256").update(Buffer.from(stored.pdf_base64,"base64")).digest("hex")!==stored.sha256)throw Error("Không tìm thấy bảng điểm điều chỉnh lưu trữ.");
  return {pdfBase64:stored.pdf_base64,filename};
 }
 const profile=await byId(db,"profiles",j.grader_id);
 const report=await exportGradingPdf(db,{groupId:j.group_id,graderCode:profile.code,orientation:"landscape",resultFilter:"ALL",attendanceFilter:"ALL",expHidden:false,docTitle:"BẢNG ĐIỂM ĐIỀU CHỈNH - CHƯA XÁC NHẬN OTP"},{decoded:{uid:"revision:"+j.grader_id}},{byId,readAll,check});
 if(report.confirmed||report.kind!=="draft")throw Error("BGK đã xác nhận lại; không thể phát hành bản dự thảo thay cho biên bản chính thức.");
 check(await db.from("osc_receipt_mail_jobs").update({pdf_sha256:report.sha256}).eq("id",j.id).eq("attempts",j.attempts).eq("status","sending"));
 return {pdfBase64:report.pdfBase64,filename};
}
export async function deliverReceiptJob(db,id,resend=false){
 const claimed=check(await db.rpc("osc_claim_receipt_mail",{p_id:id,p_resend:resend}));
 const j=claimed?.[0];
 if(!j){const row=check(await db.from("osc_receipt_mail_jobs").select("status").eq("id",id).maybeSingle());return {mailAccepted:row?.status==="sent",mailStatus:row?.status||"unavailable"};}
 try{
  const pdf=j.kind==="completion"?await canonicalPdf(db,j):String(j.reason||"").startsWith("Thay đổi tiêu chí, trọng số hoặc điểm chuẩn; phiên bản ")?await revisionPdf(db,j):null;
  // A new deliberate resend has a new generation; transport retries share the same provider key.
  const generation=j.sent_at?new Date(j.sent_at).toISOString():"initial";
  const deliveryKey=createHash("sha256").update(j.id+"|"+generation).digest("hex");
  const payload={kind:j.kind,to:j.email,name:j.grader_name,groupName:j.group_name,code:j.comparison_code,confirmedAt:j.confirmed_at,reason:j.reason,deliveryKey,...(pdf?{pdfBase64:pdf.pdfBase64,filename:pdf.filename}: {})};
  await sendScoringMail(payload);
  check(await db.from("osc_receipt_mail_jobs").update({status:"sent",sent_at:new Date().toISOString(),lease_until:null,last_error:null}).eq("id",j.id).eq("attempts",j.attempts).eq("status","sending"));
  return {mailAccepted:true,mailStatus:"sent"};
 }catch(e){
  const delay=Math.min(3600,30*2**Math.min(j.attempts,7));
  await db.from("osc_receipt_mail_jobs").update({status:"failed",lease_until:null,next_at:new Date(Date.now()+delay*1000).toISOString(),last_error:String(e.message||"Lỗi gửi thư").slice(0,180)}).eq("id",j.id).eq("attempts",j.attempts).eq("status","sending");
  return {mailAccepted:false,mailStatus:"failed"};
 }
}
export async function receiptMail(db,gid,jid,resend=false){
 const r=check(await db.from("gs_grading_receipts").select("email,grader_name,verified_at,comparison_code,confirmation_method").eq("group_id",gid).eq("grader_id",jid).maybeSingle());
 if(!r||r.confirmation_method!=="email-otp"||!/^\d{8}$/.test(r.comparison_code||""))throw Error("Chưa có biên bản đối chiếu hiện hành.");
 let j=check(await db.from("osc_receipt_mail_jobs").select("id").eq("comparison_code",r.comparison_code).eq("kind","completion").maybeSingle());
 if(!j){const group=await byId(db,"competition_groups",gid);check(await db.from("osc_receipt_mail_jobs").upsert({group_id:gid,grader_id:jid,comparison_code:r.comparison_code,kind:"completion",email:r.email,grader_name:r.grader_name,group_name:group.name,confirmed_at:r.verified_at},{onConflict:"comparison_code,kind",ignoreDuplicates:true}));j=check(await db.from("osc_receipt_mail_jobs").select("id").eq("comparison_code",r.comparison_code).eq("kind","completion").single());}
 return deliverReceiptJob(db,j.id,resend);
}
export async function retryReceiptMail(db,groupId){
 const now=new Date().toISOString();let q=db.from("osc_receipt_mail_jobs").select("id").in("status",["pending","failed","sending"]).lt("attempts",8).lte("next_at",now).order("next_at").limit(2);
 if(groupId)q=q.eq("group_id",groupId);
 const jobs=check(await q);const out=[];for(const j of jobs)out.push(await deliverReceiptJob(db,j.id));return out;
}
