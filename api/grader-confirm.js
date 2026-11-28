import {createClient} from "@supabase/supabase-js";
import {restRecoveryOptions} from "../lib/supabase-rest-recovery.js";
import {receiptMail,retryReceiptMail} from "../lib/receipt-mail.js";
import {retryInviteJobs} from "../lib/session-invite-mail.js";
import {backupRequest} from "../lib/backup-grader.js";
const URL=process.env.SUPABASE_URL||"https://nkpfzjhqtdjcfypkishv.supabase.co";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(res,status,data)=>{res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");res.statusCode=status;res.end(JSON.stringify(data))};
const sb=()=>createClient(URL,process.env.SUPABASE_SECRET_KEY||"",restRecoveryOptions(URL));
const fail=(msg,status=400)=>Object.assign(new Error(msg),{httpStatus:status});
const required=(r)=>{if(r.error)throw fail("Không thể xác thực dữ liệu ("+(r.error.code||"server")+").",503);return r.data};
async function actor(db,token){
 const r=await db.auth.getUser(token);
 if(r.error||!r.data?.user)throw fail("Phiên BGK đã hết hạn.",401);
 const user=r.data.user;
 // Token signature was validated by Supabase getUser; inspect only its signed AMR.
 const claims=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8"));
 const google=user.identities?.some(i=>i.provider==="google")&&user.app_metadata?.provider==="google"&&user.email_confirmed_at&&claims.amr?.some(x=>x.method==="oauth");
 if(!google)throw fail("Chỉ cho phép xác thực bằng tài khoản Google đã được cấp quyền.",403);
 const access=required(await db.from("gs_google_grader_access").select("*").eq("auth_user_id",user.id).eq("email",String(user.email||"").toLowerCase()).eq("enabled",true).maybeSingle());
 if(!access)throw fail("BGK chưa được cấp quyền truy cập.",403);
 const profile=required(await db.from("profiles").select("id,code,name,status,role")
  .eq("id",access.profile_id).single());
 if(profile.role!=="Grader"||profile.status!=="Active")
  throw fail("Tài khoản BGK đã bị khóa.",403);
 return {profile, userId:user.id, authenticatedAt:Math.max(0,...claims.amr.filter(x=>x.method==="oauth").map(x=>Number(x.timestamp)||0))};
}
export default async function handler(req,res){
 if(req.method==="GET"){const key=process.env.CRON_SECRET||"";const supplied=String(req.headers.authorization||"");if(key.length<32||supplied!=="Bearer "+key)return reply(res,401,{ok:false});try{const db=sb(),jobs=await retryReceiptMail(db),invites=await retryInviteJobs(db);return reply(res,200,{ok:true,processed:jobs.length+invites.length});}catch(e){return reply(res,503,{ok:false});}}
 if(req.method!=="POST")return reply(res,405,{ok:false,error:"Chỉ hỗ trợ POST."});
 if(Number(req.headers["content-length"]||0)>130000)return reply(res,413,{ok:false,error:"Yêu cầu quá lớn."});
 const origin=String(req.headers.origin||"");
 if(origin&&!["https://gradesyncfinal.vercel.app","https://score.ourstage.io.vn","https://backup.ourstage.io.vn"].includes(origin))return reply(res,403,{ok:false,error:"Nguồn không hợp lệ."});
 try{
  if(!process.env.SUPABASE_SECRET_KEY)throw fail("Máy chủ chưa cấu hình dịch vụ.",503);
  const body=typeof req.body==="object"&&req.body?req.body:JSON.parse(String(req.body||"{}"));
  if(String(body.action||"").startsWith("backup-"))return reply(res,200,await backupRequest(sb(),req,body));
  if(origin==="https://backup.ourstage.io.vn"||Number(req.headers["content-length"]||0)>12000)throw fail("Yêu cầu không hợp lệ.",403);
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/,"");
  if(token.length<50||token.length>6000)throw fail("Thiếu phiên xác thực BGK.",401);
  const gid=String(body.groupId||"");
  if(!UUID.test(gid))throw fail("Phiên chấm không hợp lệ.");
  const db=sb(),{profile,userId,authenticatedAt}=await actor(db,token);
  const assignment=required(await db.from("grader_assignments").select("id").eq("group_id",gid).eq("grader_id",profile.id).maybeSingle());if(!assignment)throw fail("BGK không được phân công phiên này.",403);
  const scope=required(await db.from("competition_groups").select("casting_id,osc_deleted_at").eq("id",gid).single());
  const publication=required(await db.from("osc_group_publications").select("scheduled_at").eq("group_id",gid).is("cancelled_at",null).order("scheduled_at").limit(1));
  if(scope.osc_deleted_at||publication.some(x=>Date.parse(x.scheduled_at)<=Date.now()))throw fail("Phiên đã công bố, không còn quyền truy cập.",403);
  if(scope.casting_id){const casting=required(await db.from("gs_castings").select("status,publish_at").eq("id",scope.casting_id).single());if(["published","archived"].includes(casting.status)&&(!casting.publish_at||Date.parse(casting.publish_at)<=Date.now()))throw fail("Phiên đã công bố, không còn quyền truy cập.",403);}
  if(publication.length&&body.action!=="completion-status")throw fail("Phiên đã khóa để công bố kết quả.",409);
  if(body.action==="preflight"||body.action==="submit"){
   if(Date.now()/1000-authenticatedAt>12*3600)throw fail("Vui lòng đăng nhập lại bằng Google trước khi nộp.",401);
   const preview=body.action==="preflight";
   if(!preview&&(body.accepted!==true||!/^[a-f0-9]{64}$/.test(body.version||"")))
    throw fail("Vui lòng kiểm tra và xác nhận phiên bản bảng điểm.");
   const data=required(await db.rpc("osc_submit_grading",{p_auth_user:userId,p_group:gid,p_expected:preview?null:body.version}));
   if(!data?.ok)throw fail(data?.code==="VERSION_CHANGED"?"Điểm hoặc danh sách đã thay đổi. Hãy mở lại hộp thoại để đối soát.":"Phiên hoặc bảng điểm không còn đủ điều kiện nộp.",409);
   if(preview)return reply(res,200,data);
   let mail={mailAccepted:false,mailStatus:"pending"};
   try{mail=await receiptMail(db,gid,profile.id,false)}catch{console.warn("Receipt mail pending")}
   return reply(res,200,{...data,...mail});
  }
  // Biên bản chứa điểm chi tiết chỉ BCN được cấp quyền mới có thể xuất.
  // Không trả bản snapshot đã chốt cho endpoint xác thực BGK.
  if(body.action==="receipt")throw fail("Giám khảo không có quyền tải hoặc xuất bảng điểm.",403);
  if(body.action==="completion-status"){
   const row=required(await db.from("gs_grading_receipts").select("verified_at,comparison_code").eq("grader_id",profile.id).eq("group_id",gid).maybeSingle());
   const job=row?.comparison_code?required(await db.from("osc_receipt_mail_jobs").select("status").eq("comparison_code",row.comparison_code).eq("kind","completion").maybeSingle()):null;
   return reply(res,200,{ok:true,confirmed:!!row,comparisonCode:row?.comparison_code||null,confirmedAt:row?.verified_at||null,mailStatus:job?.status||null});
  }
  throw fail("Hãy tải lại trang để sử dụng quy trình nộp bảng điểm hiện tại.");
 }catch(e){
  console.warn("GradeSync OTP request",e.httpStatus||500,e.code||"handled");
  return reply(res,e.httpStatus||500,{ok:false,error:e.message?.slice(0,220)||"Lỗi xác thực máy chủ."});
 }
}
