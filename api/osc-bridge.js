"use strict";
/**
 * OSC GradeSync bridge. ONLY signed-in active OSC Admin/President can access
 * the Supabase service key. Graders continue to sign into Supabase Auth on the
 * separate GradeSync website with their own code and password.
 */
import crypto from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {createRestRecoveryFetch,restRecoveryOptions} from "../lib/supabase-rest-recovery.js";
import {CAST_ACTIONS,handleCastingAction} from "../lib/casting-manager.js";
import {sendScoringMail} from "../lib/scoring-mail-relay.js";
import {verifyGradingPdf} from "../lib/osc-pdf-service.js";
import {receiptMail,deliverReceiptJob} from "../lib/receipt-mail.js";
const sendJson=(res,status,payload)=>{res.statusCode=status;res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(payload))};
const readJsonBody=req=>typeof req.body==="object"&&req.body?req.body:JSON.parse(String(req.body||"{}"));
const handleError=(res,error)=>{console.error("OSC GradeSync bridge exception",error?.code);return sendJson(res,500,{ok:false,error:"Lỗi máy chủ NỀN TẢNG CHẤM ĐIỂM."})};
const GRADER_PORTAL="https://gradesyncfinal.vercel.app/";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE=/^[A-Z][A-Z0-9_-]{2,19}$/;
const ALLOWED_ACTIONS=new Set(["overview","group-detail","create-grader","resend-grader-invite","resend-grader-completion","reopen-grader-receipt","retry-receipt-notice","update-grader","lock-grader","create-group","toggle-group","add-candidate","mark-attendance","console-documents","delete-grader"]);
function fail(message,code="osc/gradesync-invalid"){const e=new Error(message);e.code=code;throw e}
function safeText(x,max=120){return String(x??"").trim().replace(/\s+/g," ").slice(0,max)}
function sb(){return createClient(origin(),key(),restRecoveryOptions(origin()))}
function key(){const k=process.env.SUPABASE_SECRET_KEY||"";if(!k)fail("Chưa cấu hình khóa kết nối NỀN TẢNG CHẤM ĐIỂM trên máy chủ OSC.","osc/gradesync-config");return k}
function origin(){
 const u=process.env.SUPABASE_URL||"https://nkpfzjhqtdjcfypkishv.supabase.co";
 if(u!=="https://nkpfzjhqtdjcfypkishv.supabase.co")fail("Đường dẫn Supabase GradeSync không hợp lệ.","osc/gradesync-config");
 return u;
}
async function supa(path,{method="GET",body,headers={}}={}){
 if(!/^\/(?:rest\/v1\/(?:competition_groups|profiles|grader_assignments|candidates|scores|grader_verifications|audit_logs)(?:\?|$)|auth\/v1\/admin\/users(?:\/|\?|$))/.test(path))
  fail("API NỀN TẢNG CHẤM ĐIỂM không được cho phép.","osc/gradesync-forbidden");
 const timeout=AbortSignal.timeout(12000);
 const response=await createRestRecoveryFetch(origin())(origin()+path,{method,redirect:"error",signal:timeout,
  headers:{"apikey":key(),...(key().startsWith("eyJ")?{"Authorization":"Bearer "+key()}:{}),
   "Content-Type":"application/json",...headers},
  ...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const content=await response.text();let result;
 try{result=content?JSON.parse(content):null}catch{result=null}
 if(!response.ok){
  const err=safeText(result?.message||result?.msg||result?.error||"",180);
  console.warn("OSC GradeSync upstream error",response.status,err.replace(/[A-Za-z0-9]{40,}/g,"[redacted]"));
  if(err.includes("Phiên chấm đã hoàn tất."))fail("Phiên chấm đã hoàn tất.","osc/gradesync-conflict");
  if(response.status===401||response.status===403)fail("NỀN TẢNG CHẤM ĐIỂM từ chối khóa dịch vụ. Kiểm tra cấu hình Supabase.","osc/gradesync-config");
  if(response.status===409)fail("Mã hoặc tài khoản đã tồn tại.","osc/gradesync-conflict");
  fail("Không thể đồng bộ NỀN TẢNG CHẤM ĐIỂM (HTTP "+response.status+").","osc/gradesync-upstream");
 }
 return result;
}
const url=(table,filters={})=>{
 const q=new URLSearchParams({select:"*",limit:"250",...filters});
 return "/rest/v1/"+table+"?"+q.toString();
};
function hideProfile(p){return{id:p.id,code:p.code||"",name:p.name||"",role:p.role,
 status:p.status||"",assignedGroups:p.assigned_groups||[],email:p.email||"",allowedMenus:p.allowed_menus||[]}}
function groupSummary(g){return{id:g.id,name:g.name||"",passScore:g.pass_score??0,
 isOpen:g.is_open===true,criteria:g.criteria||[],openMode:g.open_mode||"",openAt:g.open_at||"",closeAt:g.close_at||""}}
async function overview(){
 const [groups,profiles,candidates,scores]=await Promise.all([
  supa(url("competition_groups",{order:"created_at.desc"})),
  supa(url("profiles",{role:"eq.Grader",order:"code.asc"})),
  supa(url("candidates",{select:"id,group_id,is_present"})),
  supa(url("scores",{select:"id,group_id,grader_id,locked,total_score"}))
 ]);
 return{ok:true,portal:GRADER_PORTAL,
  groups:(groups||[]).map(groupSummary),graders:(profiles||[]).map(hideProfile),
  stats:{groups:groups?.length||0,graders:profiles?.length||0,
   candidates:candidates?.length||0,scores:scores?.length||0},
  groupCounts:Object.fromEntries((groups||[]).map(g=>[g.id,{
   candidates:(candidates||[]).filter(x=>x.group_id===g.id).length,
   present:(candidates||[]).filter(x=>x.group_id===g.id&&x.is_present===true).length,
   scored:(scores||[]).filter(x=>x.group_id===g.id).length
  }]))};
}
async function groupDetail(body){
 const id=String(body.groupId||"");if(!ID.test(id))fail("Nhóm thi không hợp lệ.");
 const [groups,candidates,scores,verified]=await Promise.all([
  supa(url("competition_groups",{id:"eq."+id,limit:"1"})),
  supa(url("candidates",{group_id:"eq."+id,order:"code.asc"})),
  supa(url("scores",{group_id:"eq."+id})),
  supa(url("grader_verifications",{group_id:"eq."+id}))
 ]);
 if(!groups?.length)fail("Không tìm thấy nhóm thi.");
 return{ok:true,group:groupSummary(groups[0]),candidates:(candidates||[]).map(x=>({
  id:x.id,code:x.code||"",name:x.name||"",present:x.is_present===true,
  scores:(scores||[]).filter(s=>s.candidate_id===x.id).map(s=>({
   graderCode:s.grader_code||"",totalScore:s.total_score??0,locked:s.locked===true,submittedAt:s.submitted_at||null}))
 })),verifications:(verified||[]).map(v=>({graderCode:v.grader_code||"",
   name:v.grader_name||"",verified:v.is_verified===true}))};
}
async function audit(actor,action,target){
 await supa("/rest/v1/audit_logs",{method:"POST",headers:{Prefer:"return=minimal"},
  body:{action:"osc-"+action,
   details:{actorUid:actor.decoded.uid,actorRole:actor.profile.role,targetId:target,source:"osc-management"}}});
}
function graderPassword(value){
 if(value===undefined || value==="")return password();
 if(typeof value!=="string" || value.length<6 || Buffer.byteLength(value,"utf8")>72 || !value.trim())
  fail("Mật khẩu cần ít nhất 6 ký tự và tối đa 72 byte.");
 return value;
}
function password(){return crypto.randomBytes(24).toString("base64url")+"aA7!";}
function graderGoogleEmail(value){
 const email=String(value||"").trim().toLowerCase();
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail("Email Google của BGK không hợp lệ.");
 return email;
}
async function grantGraderGoogleEmail(graderId,rawEmail,revokeLinked=false){
 const email=graderGoogleEmail(rawEmail),db=sb();
 const previous=await db.from("gs_google_grader_access").select("profile_id,email,auth_user_id").eq("profile_id",graderId).maybeSingle();
 if(previous.error)fail("Không đọc được quyền email BGK.","osc/gradesync-upstream");
 if(previous.data&&previous.data.email!==email){const locked=await db.rpc("osc_judge_email_locked",{p_grader:graderId});if(locked.error||locked.data===true)fail("Email BGK đã xác nhận bảng điểm, không thể thay đổi.","osc/gradesync-conflict");}
 if(previous.data?.auth_user_id&&previous.data.email!==email&&!revokeLinked)
  fail("Email Google BGK đã liên kết tài khoản. Hãy xác nhận thu hồi liên kết cũ trước khi đổi.","osc/gradesync-conflict");
 if(!email){
  if(previous.data){
   const deleted=await db.from("gs_google_grader_access").delete().eq("profile_id",graderId);
   if(deleted.error)fail("Không thu hồi được email BGK.","osc/gradesync-upstream");
  }
  return;
 }
 const row={profile_id:graderId,email,enabled:true};
 if(!previous.data?.auth_user_id||previous.data.email!==email)row.auth_user_id=null;
 else row.auth_user_id=previous.data.auth_user_id;
 const up=await db.from("gs_google_grader_access").upsert(row,{onConflict:"profile_id"});
 if(up.error)fail(up.error.code==="23505"?"Email đã được cấp cho BGK khác.":"Không lưu được email BGK.","osc/gradesync-conflict");
}

async function assertMutableGroups(ids){
 if(!ids.length)return;
 const db=sb(),rows=await db.from("competition_groups").select("id,casting_id").in("id",ids);
 if(rows.error||rows.data.length!==ids.length)fail("Có phiên chấm không tồn tại.");
 const casts=[...new Set(rows.data.map(x=>x.casting_id).filter(Boolean))];
 if(casts.length){const r=await db.from("gs_castings").select("status").in("id",casts);if(r.error)fail("Không kiểm tra được phiên chấm.");if(r.data.some(x=>["published","archived"].includes(x.status)))fail("Phiên chấm đã hoàn tất.","osc/gradesync-conflict")}
}
async function inviteGrader(id){
 const db=sb(),[profile,access,grants]=await Promise.all([db.from("profiles").select("id,name,role,status").eq("id",id).single(),db.from("gs_google_grader_access").select("email,enabled").eq("profile_id",id).single(),db.from("grader_assignments").select("group_id").eq("grader_id",id)]);
 if(profile.error||access.error||grants.error||profile.data.role!=="Grader"||profile.data.status!=="Active"||!access.data.enabled)fail("Chưa có quyền Google hoạt động cho BGK.");
 const ids=grants.data.map(x=>x.group_id);let names=[];
 if(ids.length){const groups=await db.from("competition_groups").select("name").in("id",ids);if(groups.error)fail("Không đọc được phân công BGK.");names=groups.data.map(x=>x.name)}
 await sendScoringMail({kind:"invite",to:access.data.email,name:profile.data.name,groupName:names.join(", ")||"Chưa phân công phiên chấm"});
 return{ok:true,mailAccepted:true};
}
async function resendCompletion(body){
 const id=String(body.graderId||""),gid=String(body.groupId||"");
 if(!ID.test(id)||!ID.test(gid))fail("Giám khảo hoặc phiên chấm không hợp lệ.");
 try{return {ok:true,...await receiptMail(sb(),gid,id,true)}}catch(e){fail(e.message,"osc/gradesync-conflict")}
}
async function reopenReceipt(actor,b){
 const id=String(b.graderId||""),gid=String(b.groupId||""),code=String(b.comparisonCode||""),reason=String(b.reason||"").trim();
 if(!ID.test(id)||!ID.test(gid)||!/^\d{8}$/.test(code)||reason.length<3||reason.length>500||b.confirm!==true)fail("Cần xác nhận và nhập lý do mở lại bảng điểm.");
 const db=sb(),r=await db.rpc("osc_reopen_receipt",{p_group:gid,p_grader:id,p_code:code,p_reason:reason,p_actor:actor.decoded.uid});
 if(r.error){const map={GS_SESSION_FINAL:"Phiên đã duyệt hoặc công bố kết quả.",GS_RECEIPT_CHANGED:"Xác nhận đã thay đổi. Tải lại dữ liệu.",GS_MAIL_IN_PROGRESS:"Email đang được gửi. Hãy thử lại sau khi gửi xong.",GS_REOPEN_REASON_REQUIRED:"Cần nhập lý do mở lại."};const k=Object.keys(map).find(k=>String(r.error.message).includes(k));fail(map[k]||"Không thể mở lại bảng điểm.","osc/gradesync-conflict");}
 let mail={mailAccepted:false,mailStatus:"pending"};try{mail=await deliverReceiptJob(db,r.data.jobId)}catch(e){console.warn("Reopen notice pending",e.code||"transport")}
 return {ok:true,comparisonCode:r.data.comparisonCode,...mail};
}
async function retryReceiptNotice(b){
 const id=String(b.jobId||"");if(!ID.test(id))fail("Thông báo không hợp lệ.");
 const db=sb(),r=await db.from("osc_receipt_mail_jobs").select("id,kind,status").eq("id",id).maybeSingle();
 if(r.error||!r.data||r.data.kind!=="reopen"||r.data.status==="sent")fail("Không có thông báo thu hồi cần gửi lại.");
 return{ok:true,...await deliverReceiptJob(db,id,true)};
}
async function createGrader(actor,body){
 const code=safeText(body.code,20).toUpperCase(),name=safeText(body.name,100);
 if(name.length<2)fail("Họ tên giám khảo cần ít nhất 2 ký tự.");
 if(!CODE.test(code))fail("Mã giám khảo cần 3–20 ký tự và bắt đầu bằng chữ cái.");
 const groupIds=Array.isArray(body.groupIds)?[...new Set(body.groupIds)]:[];
 if(groupIds.length>30||groupIds.some(id=>!ID.test(String(id))))fail("Danh sách nhóm không hợp lệ.");
 if(groupIds.length){
  const groups=await supa(url("competition_groups",{id:"in.("+groupIds.join(",")+")"}));
  if(groups.length!==groupIds.length)fail("Có nhóm được phân công không còn tồn tại.");
 }
 const found=await supa(url("profiles",{code:"eq."+code,select:"id",limit:"1"}));
 if(found?.length)fail("Mã giám khảo đã tồn tại.","osc/gradesync-conflict");
 await assertMutableGroups(groupIds);
 const googleEmail=graderGoogleEmail(body.googleEmail);if(!googleEmail)fail("Cần nhập email Google được cấp quyền.");
 if(body.password)fail("Không còn hỗ trợ mật khẩu BGK.");
 const email=code.toLowerCase()+"@gradesync.local",pass=password();
 const created=await sb().auth.admin.createUser({
  email,password:pass,email_confirm:true,user_metadata:{display_name:name}});
 if(created.error)fail("Không thể tạo tài khoản giám khảo trên Supabase.","osc/gradesync-upstream");
 const id=created.data?.user?.id;
 if(!ID.test(String(id||"")))fail("Không tạo được UID giám khảo trên Supabase.","osc/gradesync-upstream");
 try{
  const profile={id,code,name,email,role:"Grader",status:"Active",
   assigned_groups:groupIds,allowed_menus:["grading_table"],extra_data:{}};
  await supa("/rest/v1/profiles",{method:"POST",body:profile,headers:{Prefer:"return=minimal"}});
  if(groupIds.length){
   const {error}=await sb().from("grader_assignments").insert(groupIds.map(group_id=>({grader_id:id,group_id})));
   if(error)fail("Không thể phân công giám khảo.");
  }
  await grantGraderGoogleEmail(id,googleEmail);
  await audit(actor,"grader-created",id);
 }catch(e){await sb().auth.admin.deleteUser(id).catch(()=>{});throw e}
 let mailAccepted=false;try{await inviteGrader(id);mailAccepted=true}catch(e){console.warn("BGK invite pending",e.code||"transport")}
 return{ok:true,id,code,name,mailAccepted,portal:GRADER_PORTAL};
}
async function updateGrader(actor,body){
 const id=String(body.graderId||""),name=safeText(body.name,100);
 const groups=Array.isArray(body.groupIds)?[...new Set(body.groupIds)]:[];
 if(!ID.test(id)||name.length<2||groups.length>30||groups.some(x=>!ID.test(x)))
  fail("Thông tin giám khảo hoặc nhóm không hợp lệ.");
 const email=body.googleEmail===undefined?null:graderGoogleEmail(body.googleEmail);
 const db=sb(),result=await db.rpc("osc_update_grader",{
  p_grader:id,p_name:name,p_groups:groups,p_change_email:body.googleEmail!==undefined,
  p_email:email,p_revoke_link:body.revokeGoogleLink===true
 });
 if(result.error)graderManagementError(result.error);
 await audit(actor,"grader-updated",id);
 return{ok:true};
}
function graderManagementError(error){
 const messages={
  GS_QUORUM_ROSTER_LOCKED:"Phiên đã có dữ liệu chấm. Hãy giữ phiên cũ đã phân công và chỉ thêm phiên chưa chấm để bảo toàn quorum.",
  GS_JUDGE_EMAIL_LOCKED:"Email BGK đã xác nhận bảng điểm, không thể thay đổi.",
  GS_JUDGE_GOOGLE_LINKED:"Email đã liên kết với Google. Hãy xác nhận thu hồi liên kết trước khi đổi.",
  GS_GRADER_ARCHIVED:"BGK đã lưu trữ. Quyền truy cập chấm đã bị vô hiệu hóa.",
  GS_GRADER_NOT_FOUND:"Không tìm thấy giám khảo.",
  GS_GRADER_HISTORY:"BGK thuộc danh sách chấm đã có dữ liệu. Hãy lưu trữ để giữ lịch sử.",
  "23503":"Có phiên chấm không còn tồn tại.",
  "23505":"Email đã được cấp cho BGK khác."
 };
 const message=messages[error.code]||Object.entries(messages).find(([code])=>String(error.message).includes(code))?.[1];
 if(message)fail(message,"osc/gradesync-conflict");
 if(String(error.message).includes("Phiên chấm đã hoàn tất."))fail("Phiên chấm đã hoàn tất.","osc/gradesync-conflict");
 console.warn("Grader management rejected",error.code);
 fail("Không lưu được thay đổi của BGK.","osc/gradesync-upstream");
}
async function protectedGrader(db,id){
 const result=await db.rpc("osc_grader_history_protected",{p_grader:id});
 if(result.error)graderManagementError(result.error);
 return result.data===true;
}
async function archiveGrader(db,actor,id){
 const result=await db.rpc("osc_archive_grader",{p_grader:id,p_actor:actor.decoded.uid});
 if(result.error)graderManagementError(result.error);
 return {ok:true,archived:true,message:"Đã vô hiệu hóa quyền chấm của BGK. Điểm, biên bản và quorum vẫn được lưu."};
}
async function lockGrader(actor,body){
 const id=String(body.graderId||"");if(!ID.test(id))fail("Giám khảo không hợp lệ.");
 const db=sb(),active=body.active===true;
 const read=await db.from("profiles").select("extra_data").eq("id",id).eq("role","Grader").maybeSingle();
 if(read.error)graderManagementError(read.error);
 if(!read.data)fail("Không tìm thấy giám khảo.");
 if(read.data.extra_data?.oscArchivedAt){
  if(active)graderManagementError({message:"GS_GRADER_ARCHIVED"});
  return archiveGrader(db,actor,id);
 }
 if(!active&&await protectedGrader(db,id))return archiveGrader(db,actor,id);
 const status=await db.from("profiles").update({status:active?"Active":"Inactive"}).eq("id",id).eq("role","Grader");
 if(status.error)graderManagementError(status.error);
 await audit(actor,active?"grader-unlocked":"grader-locked",id);
 return{ok:true};
}
async function requireOscManager(req){
 const token=String(req.headers.authorization||"");
 if(!/^Bearer [A-Za-z0-9._-]{50,6000}$/.test(token))fail("Thiếu phiên OSC.","osc/gradesync-forbidden");
 const response=await fetch("https://admin.ourstage.io.vn/api/gradesync",{
  method:"POST",redirect:"error",signal:AbortSignal.timeout(9000),
  headers:{"Content-Type":"application/json","Authorization":token},
  body:JSON.stringify({action:"verify"})});
 if(!response.ok)fail("Bạn chưa được OSC cấp quyền quản trị chấm điểm.","osc/gradesync-forbidden");
 const actor=await response.json().catch(()=>({}));
 if(actor.ok!==true||!["admin","superadmin"].includes(actor.role)||
   !/^[a-zA-Z0-9_-]{1,128}$/.test(String(actor.uid||"")))
  fail("Phiên quyền OSC không hợp lệ.","osc/gradesync-forbidden");
 return {decoded:{uid:actor.uid},profile:{role:actor.role}};
}

function validGroupName(v){const x=safeText(v,120);if(x.length<2)fail("Tên nhóm thi tối thiểu 2 ký tự.");return x}
function validateCriteria(value){
 if(!Array.isArray(value)||value.length<1||value.length>12)fail("Cần từ 1 đến 12 tiêu chí.");
 const names=new Set(),out=[];
 for(const v of value){
  const name=safeText(v?.name,80),weight=Number(v?.weight);
  if(!name||names.has(name.toLowerCase())||!Number.isFinite(weight)||weight<=0||weight>100)
   fail("Tên hoặc trọng số tiêu chí không hợp lệ.");
  names.add(name.toLowerCase());out.push({name,weight});
 }
 if(Math.abs(out.reduce((sum,c)=>sum+c.weight,0)-100)>0.01)
  fail("Tổng trọng số phải bằng 100%.");
 return out;
}
async function createGroup(actor,body){
 const name=validGroupName(body.name),criteria=validateCriteria(body.criteria);
 const pass=Number(body.passScore);
 if(!Number.isFinite(pass)||pass<0||pass>10)fail("Điểm đạt phải trong khoảng 0–10.");
 const row={name,criteria,pass_score:pass,is_open:false,open_mode:"manual"};
 const data=await supa("/rest/v1/competition_groups",{method:"POST",body:row,
  headers:{Prefer:"return=representation"}});
 if(!Array.isArray(data)||!data[0]?.id)fail("Chưa xác nhận được nhóm thi mới.","osc/gradesync-upstream");
 await audit(actor,"group-created",data[0].id);
 return{ok:true,group:groupSummary(data[0])};
}
async function toggleGroup(actor,body){
 const id=String(body.groupId||"");if(!ID.test(id)||typeof body.open!=="boolean")
  fail("Nhóm hoặc trạng thái không hợp lệ.");
 const found=await supa(url("competition_groups",{id:"eq."+id,select:"id",limit:"1"}));
 if(!found?.length)fail("Nhóm thi không tồn tại.");
 await supa("/rest/v1/competition_groups?id=eq."+id,{method:"PATCH",
  body:{is_open:body.open,open_mode:"manual"},
  headers:{Prefer:"return=minimal"}});
 await audit(actor,body.open?"group-opened":"group-closed",id);
 return{ok:true};
}
async function addCandidate(actor,body){
 const group=String(body.groupId||""),name=safeText(body.name,120),
  code=safeText(body.code,40).toUpperCase();
 if(!ID.test(group)||name.length<2||!/^[A-Z0-9_-]{2,40}$/.test(code))
  fail("Nhóm, tên hoặc mã thí sinh không hợp lệ.");
 const found=await supa(url("competition_groups",{id:"eq."+group,select:"id",limit:"1"}));
 if(!found?.length)fail("Nhóm không tồn tại.");
 const existing=await supa(url("candidates",{group_id:"eq."+group,code:"eq."+code,select:"id",limit:"1"}));
 if(existing?.length)fail("Mã thí sinh đã tồn tại trong nhóm.","osc/gradesync-conflict");
 const data=await supa("/rest/v1/candidates",{method:"POST",
  body:{group_id:group,code,name,is_present:false},
  headers:{Prefer:"return=representation"}});
 if(!data?.[0]?.id)fail("Chưa xác nhận được thí sinh mới.","osc/gradesync-upstream");
 await audit(actor,"candidate-created",data[0].id);
 return{ok:true};
}
async function markAttendance(actor,body){
 const group=String(body.groupId||""),candidate=String(body.candidateId||"");
 if(!ID.test(group)||!ID.test(candidate)||typeof body.present!=="boolean")
  fail("Thông tin điểm danh không hợp lệ.");
 const found=await supa(url("candidates",{id:"eq."+candidate,group_id:"eq."+group,select:"id",limit:"1"}));
 if(!found?.length)fail("Thí sinh không thuộc nhóm đã chọn.");
 await supa("/rest/v1/candidates?id=eq."+candidate+"&group_id=eq."+group,{
  method:"PATCH",body:{is_present:body.present,attendance_updated_at:new Date().toISOString()},
  headers:{Prefer:"return=minimal"}});
 await audit(actor,body.present?"candidate-present":"candidate-absent",candidate);
 return{ok:true};
}

async function handle(req,res){
 if(req.method!=="POST")return sendJson(res,405,{ok:false,error:"Chỉ hỗ trợ POST."});
 if((Number(req.headers["content-length"]||0)>3000000))return sendJson(res,413,{ok:false,error:"Yêu cầu quá lớn."});
 const originHeader=String(req.headers.origin||"");
 if(originHeader&&originHeader!=="https://admin.ourstage.io.vn"&&
   !/^https:\/\/ourstageclubmanagerv17vercelpackage-[a-z0-9-]+\.vercel\.app$/.test(originHeader))
  return sendJson(res,403,{ok:false,error:"Nguồn yêu cầu không hợp lệ."});
 try{
  const b=readJsonBody(req),action=String(b.action||"");
  if(action==="casting-pdf-verify"){if(Object.keys(b).some(k=>!["action","sha256","comparisonCode"].includes(k)))return sendJson(res,400,{ok:false,error:"Yêu cầu không hợp lệ."});return sendJson(res,200,await verifyGradingPdf(sb(),b));}
  const actor=await requireOscManager(req);
  if(!ALLOWED_ACTIONS.has(action)&&!CAST_ACTIONS.has(action))fail("Tác vụ không được cho phép.");
  let result;
  if(CAST_ACTIONS.has(action))result=await handleCastingAction(action,b,actor);
  else if(action==="overview")result=await overview();
  else if(action==="group-detail")result=await groupDetail(b);
  else if(action==="console-documents"){
   if(!Array.isArray(b.ops)||b.ops.length<1||b.ops.length>1000)fail("Lô dữ liệu không hợp lệ.");
   const {data,error}=await sb().rpc("osc_grading_documents",{ops:b.ops,actor_uid:actor.decoded.uid});
   if(error){
    console.warn("OSC grading document operation",error.code);
    if(error.message?.includes("Phiên chấm đã hoàn tất."))fail("Phiên chấm đã hoàn tất.","osc/gradesync-conflict");
    if(error.message?.includes("Phiên đã duyệt hoặc công bố kết quả."))fail("Không thể mở khóa: phiên đã duyệt hoặc công bố kết quả. Cần xử lý kết quả chính thức trước khi chấm lại.","osc/gradesync-conflict");
    if(error.message?.includes("Chỉ quản trị OSC có thể mở lại bảng điểm."))fail("Phiên quản trị không đủ quyền mở khóa. Vui lòng đăng nhập lại.","osc/gradesync-forbidden");
    fail(error.message?.includes("SCORE_CONFLICT")?"Điểm vừa được cập nhật. Hãy tải lại.":"Không thể lưu hoặc đọc dữ liệu chấm điểm ("+error.code+").");
   }
   result={ok:true,rows:data};
  }
  else if(action==="delete-grader"){
   const id=String(b.graderId||"");
   if(!ID.test(id))fail("Mã giám khảo không hợp lệ.");
   const profile=await supa(url("profiles",{id:"eq."+id,role:"eq.Grader",select:"id",limit:"1"}));
   if(!profile?.length)fail("Không tìm thấy giám khảo.");
   const db=sb();
   if(await protectedGrader(db,id)){
    if(b.archiveIfProtected!==true)
     fail("BGK thuộc danh sách chấm đã có dữ liệu. Dùng Khóa tài khoản để lưu trữ và giữ nguyên điểm, biên bản, quorum.","osc/gradesync-conflict");
    result=await archiveGrader(db,actor,id);
   }else{
    const deleted=await db.auth.admin.deleteUser(id);
    if(deleted.error){
     if(await protectedGrader(db,id))graderManagementError({message:"GS_GRADER_HISTORY"});
     fail("Không thể xóa giám khảo.","osc/gradesync-upstream");
    }
    await audit(actor,"grader-deleted",id);
    result={ok:true,message:"Đã xóa giám khảo chưa có dữ liệu chấm."};
   }
  }
  else if(action==="create-grader")result=await createGrader(actor,b);
  else if(action==="update-grader")result=await updateGrader(actor,b);
  else if(action==="lock-grader")result=await lockGrader(actor,b);
  else if(action==="resend-grader-invite"){if(!ID.test(String(b.graderId||"")))fail("Giám khảo không hợp lệ.");result=await inviteGrader(b.graderId)}
  else if(action==="resend-grader-completion")result=await resendCompletion(b);
  else if(action==="reopen-grader-receipt")result=await reopenReceipt(actor,b);
  else if(action==="retry-receipt-notice")result=await retryReceiptNotice(b);
  else if(action==="create-group")result=await createGroup(actor,b);
  else if(action==="toggle-group")result=await toggleGroup(actor,b);
  else if(action==="add-candidate")result=await addCandidate(actor,b);
  else if(action==="mark-attendance")result=await markAttendance(actor,b);
  return sendJson(res,200,result);
 }catch(err){
  if(err?.code?.startsWith("osc/gradesync-")){
   const status=err.code==="osc/gradesync-config"||err.code==="osc/gradesync-upstream"?503:
    err.code==="osc/gradesync-conflict"?409:err.code==="osc/gradesync-forbidden"?403:400;
   return sendJson(res,status,{ok:false,error:err.message});
  }
  return handleError(res,err);
 }
}
export default handle;
export const _test={CODE,ID,safeText,ALLOWED_ACTIONS,groupSummary,hideProfile,origin};
