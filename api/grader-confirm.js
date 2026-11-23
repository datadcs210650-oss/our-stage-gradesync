/* BGK: Google-authenticated, email OTP confirmation, never touches OSC admin rights. */
import crypto from "node:crypto";
import {createClient} from "@supabase/supabase-js";
const URL=process.env.SUPABASE_URL||"https://nkpfzjhqtdjcfypkishv.supabase.co";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(res,status,data)=>{res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");res.statusCode=status;res.end(JSON.stringify(data))};
const sb=()=>createClient(URL,process.env.SUPABASE_SECRET_KEY||"",{auth:{persistSession:false,autoRefreshToken:false}});
const fail=(msg,status=400)=>Object.assign(new Error(msg),{httpStatus:status});
const required=(r)=>{if(r.error)throw fail("Không thể xác thực dữ liệu ("+(r.error.code||"server")+").",503);return r.data};
function digest(profile,group,code){
 const secret=process.env.GRADESYNC_OTP_SECRET||"";
 if(secret.length<32)throw fail("Máy chủ chưa cấu hình khóa xác thực OTP.",503);
 return crypto.createHmac("sha256",secret).update(profile+":"+group+":"+code).digest("hex");
}
async function actor(db,token){
 const r=await db.auth.getUser(token);
 if(r.error||!r.data?.user)throw fail("Phiên BGK đã hết hạn.",401);
 const user=r.data.user;
 const google=user.identities?.some(i=>i.provider==="google")||user.app_metadata?.provider==="google";
 const legacy=String(user.email||"").toLowerCase().endsWith("@gradesync.local");
 if(!google&&!legacy)throw fail("Tài khoản chưa được phép xác nhận bảng điểm.",403);
 let access;
 if(google){
  access=required(await db.from("gs_google_grader_access").select("*")
    .eq("auth_user_id",user.id).eq("email",String(user.email||"").toLowerCase())
    .eq("enabled",true).maybeSingle());
 }else{
  access=required(await db.from("gs_google_grader_access").select("*")
    .eq("profile_id",user.id).eq("enabled",true).maybeSingle());
 }
 if(!access)throw fail("BGK chưa được BCN cấp email nhận OTP.",403);
 const profile=required(await db.from("profiles").select("id,code,name,status,role")
  .eq("id",access.profile_id).single());
 if(profile.role!=="Grader"||profile.status!=="Active")
  throw fail("Tài khoản BGK đã bị khóa.",403);
 if(!google&&profile.id!==user.id)
  throw fail("Mã BGK không khớp tài khoản đăng nhập.",403);
 return{profile,email:access.email,provider:google?"google":"legacy"};
}
async function preflight(db,profile,groupId){
 const grant=required(await db.from("grader_assignments").select("id").eq("grader_id",profile.id).eq("group_id",groupId).maybeSingle());
 if(!grant)throw fail("BGK không được phân công phiên này.",403);
 const receipt=required(await db.from("gs_grading_receipts").select("verified_at").eq("grader_id",profile.id).eq("group_id",groupId).maybeSingle());
 if(receipt)throw fail("Bảng điểm đã được xác nhận và khóa.",409);
 const group=required(await db.from("competition_groups").select("id,name,criteria").eq("id",groupId).single());
 const [{data:candidates,error:ce},{data:scores,error:se},{data:grants,error:ge}]=await Promise.all([
  db.from("candidates").select("id").eq("group_id",groupId).limit(1500),
  db.from("scores").select("candidate_id,scores").eq("group_id",groupId).eq("grader_id",profile.id).limit(1500),
  db.from("gs_criterion_grants").select("criterion").eq("grader_id",profile.id).eq("group_id",groupId)
 ]);
 if(ce||se||ge)throw fail("Không đối soát được bảng điểm.",503);
 if(candidates.length>=1500||scores.length>=1500)throw fail("Quá nhiều thí sinh để xác nhận trong một lượt.",413);
 if(!candidates.length)throw fail("Phiên chấm chưa có thí sinh.",409);
 const byCandidate=new Map(scores.map(x=>[x.candidate_id,x.scores||{}]));
 const allowed=grants.length?new Set(grants.map(x=>x.criterion)):null;
 const requiredCriteria=(group.criteria||[]).filter(c=>!allowed||allowed.has(c.name)).map(c=>c.name);
 const incomplete=candidates.filter(c=>{
  const marks=byCandidate.get(c.id)||{};
  return requiredCriteria.some(name=>typeof marks[name]!=="number"||marks[name]<0||marks[name]>10);
 });
 const scored=candidates.filter(c=>Object.keys(byCandidate.get(c.id)||{}).length>0).length;
 const missingCriteria=candidates.reduce((count,c)=>{
  const marks=byCandidate.get(c.id)||{};
  return count+requiredCriteria.filter(name=>typeof marks[name]!=="number").length;
 },0);
 return {group,completeness:{
  totalCandidates:candidates.length,scoredCandidates:scored,
  missingCandidates:candidates.length-scored,missingCriterionCells:missingCriteria,
  partial:incomplete.length>0, incompleteCandidates:incomplete.length
 }};
}
async function sendMail(to,code,groupName){
 const secret=process.env.GRADESYNC_OTP_RELAY_SECRET||"";
 if(secret.length<32)throw fail("Chưa cấu hình kênh gửi OTP an toàn.",503);
 const payload={action:"gradesync-otp-relay",to,code,groupName:String(groupName||"").slice(0,120),nonce:crypto.randomUUID()};
 const body=JSON.stringify(payload),ts=String(Date.now());
 const signature=crypto.createHmac("sha256",secret).update(ts+"\n"+body).digest("hex");
 const response=await fetch("https://admin.ourstage.io.vn/api/gradesync",{
   method:"POST",redirect:"error",signal:AbortSignal.timeout(12000),
   headers:{"Content-Type":"application/json","X-OSC-Timestamp":ts,"X-OSC-Signature":signature},
   body
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok||result.ok!==true)throw fail(result.error||"Dịch vụ OTP chưa chấp nhận gửi mã.",503);
}

export default async function handler(req,res){
 if(req.method!=="POST")return reply(res,405,{ok:false,error:"Chỉ hỗ trợ POST."});
 if(Number(req.headers["content-length"]||0)>12000)return reply(res,413,{ok:false,error:"Yêu cầu quá lớn."});
 const origin=String(req.headers.origin||"");
 if(origin&&origin!=="https://gradesyncfinal.vercel.app")return reply(res,403,{ok:false,error:"Nguồn không hợp lệ."});
 try{
  if(!process.env.SUPABASE_SECRET_KEY)throw fail("Máy chủ chưa cấu hình dịch vụ.",503);
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/,"");
  if(token.length<50||token.length>6000)throw fail("Thiếu phiên xác thực BGK.",401);
  const body=typeof req.body==="object"&&req.body?req.body:JSON.parse(String(req.body||"{}"));
  const gid=String(body.groupId||"");
  if(!UUID.test(gid))throw fail("Phiên chấm không hợp lệ.");
  const db=sb(),{profile,email}=await actor(db,token);
  if(body.action==="preflight"){
   const info=await preflight(db,profile,gid);
   return reply(res,200,{ok:true,groupName:info.group.name,completeness:info.completeness});
  }
  if(body.action==="request"){
   const {group,completeness}=await preflight(db,profile,gid);
   if(completeness.partial&&body.confirmPartial!==true)
    throw fail("Bảng điểm chưa đầy đủ; cần xác nhận rõ số thí sinh/tiêu chí còn thiếu trước khi gửi OTP.",409);
   if(!process.env.GRADESYNC_OTP_RELAY_SECRET)
    throw fail("Chưa cấu hình dịch vụ email OTP.",503);
   const otp=String(crypto.randomInt(0,1000000)).padStart(6,"0");
   const expires=new Date(Date.now()+5*60*1000).toISOString();
   const issued=required(await db.rpc("gs_issue_grading_otp",{p_grader:profile.id,p_group:gid,p_digest:digest(profile.id,gid,otp),p_expires:expires}));
   if(!issued.ok)throw fail(issued.code==="COOLDOWN"?"Chỉ gửi lại OTP sau 60 giây.":"Không thể cấp OTP: "+issued.code,429);
   await sendMail(email,otp,group.name);
   return reply(res,200,{ok:true,expiresIn:300,completeness,emailMasked:email.replace(/^(.{2}).*(@[^@]+)$/,"$1***$2")});
  }
  // Biên bản chứa điểm chi tiết chỉ BCN được cấp quyền mới có thể xuất.
  // Không trả bản snapshot đã chốt cho endpoint xác thực BGK.
  if(body.action==="receipt")throw fail("Giám khảo không có quyền tải hoặc xuất bảng điểm.",403);
  if(body.action==="confirm"){
   const code=String(body.code||"");
   if(!/^\d{6}$/.test(code))throw fail("Mã OTP phải đủ 6 chữ số.");
   const data=required(await db.rpc("gs_finalize_grading_otp",{p_grader:profile.id,p_group:gid,p_digest:digest(profile.id,gid,code)}));
   if(!data?.ok)throw fail(data.code==="OTP_INVALID"?"OTP không đúng.":data.code==="OTP_EXPIRED"?"OTP đã hết hạn.":"Không thể xác nhận: "+(data?.code||"unknown"),409);
   return reply(res,200,{ok:true,sha256:data.sha256,confirmedAt:data.confirmedAt,completeness:data.completeness});
  }
  throw fail("Tác vụ OTP không hợp lệ.");
 }catch(e){
  console.warn("GradeSync OTP request",e.httpStatus||500,e.code||"handled");
  return reply(res,e.httpStatus||500,{ok:false,error:e.message?.slice(0,220)||"Lỗi xác thực máy chủ."});
 }
}
