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
 if(r.error||!r.data?.user)throw fail("Phiên đăng nhập Google đã hết hạn.",401);
 const user=r.data.user;
 if(!user.identities?.some(i=>i.provider==="google"))
  throw fail("Chỉ chấp nhận BGK đăng nhập Google.",403);
 const email=String(user.email||"").toLowerCase();
 const access=required(await db.from("gs_google_grader_access").select("*").eq("auth_user_id",user.id).eq("email",email).eq("enabled",true).maybeSingle());
 if(!access)throw fail("Email chưa được cấp quyền BGK.",403);
 const profile=required(await db.from("profiles").select("id,code,name,status,role").eq("id",access.profile_id).single());
 if(profile.role!=="Grader"||profile.status!=="Active")throw fail("Tài khoản BGK đã bị khóa.",403);
 return{profile,email};
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
  return !requiredCriteria.length||requiredCriteria.some(name=>typeof marks[name]!=="number"||marks[name]<0||marks[name]>100);
 });
 if(incomplete.length)throw fail("Chưa thể khóa: "+incomplete.length+" thí sinh thiếu tiêu chí hoặc chưa lưu điểm.",409);
 return group;
}
async function sendMail(to,code,groupName){
 const key=process.env.RESEND_API_KEY||"",from=process.env.GRADESYNC_FROM_EMAIL||"";
 if(!key||!from)throw fail("Chưa cấu hình email OTP cho GrandeSync.",503);
 const clean=String(groupName||"").replace(/[<>&"']/g,"").slice(0,120);
 const response=await fetch("https://api.resend.com/emails",{
  method:"POST",signal:AbortSignal.timeout(10000),
  headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
  body:JSON.stringify({from,to:[to],subject:"OSC GrandeSync · Mã xác nhận bảng điểm",
   html:"<p>Yêu cầu xác nhận bảng điểm "+clean+".</p><p>Mã OTP: <b style='font-size:24px'>"+code+"</b></p><p>Mã có hiệu lực 5 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>"})
 });
 if(!response.ok)throw fail("Dịch vụ email từ chối gửi OTP. Hãy liên hệ BCN.",503);
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
  if(body.action==="request"){
   const group=await preflight(db,profile,gid);
   if(!process.env.RESEND_API_KEY||!process.env.GRADESYNC_FROM_EMAIL)
    throw fail("Chưa cấu hình dịch vụ email OTP.",503);
   const otp=String(crypto.randomInt(0,1000000)).padStart(6,"0");
   const expires=new Date(Date.now()+5*60*1000).toISOString();
   const issued=required(await db.rpc("gs_issue_grading_otp",{p_grader:profile.id,p_group:gid,p_digest:digest(profile.id,gid,otp),p_expires:expires}));
   if(!issued.ok)throw fail(issued.code==="COOLDOWN"?"Chỉ gửi lại OTP sau 60 giây.":"Không thể cấp OTP: "+issued.code,429);
   await sendMail(email,otp,group.name);
   return reply(res,200,{ok:true,expiresIn:300,emailMasked:email.replace(/^(.{2}).*(@[^@]+)$/,"$1***$2")});
  }
  if(body.action==="receipt"){
   const receipt=required(await db.from("gs_grading_receipts").select("email,grader_name,verified_at,snapshot,snapshot_sha256").eq("grader_id",profile.id).eq("group_id",gid).maybeSingle());
   if(!receipt)throw fail("Chưa có biên bản xác nhận.",404);
   const [group,candidates]=await Promise.all([
    db.from("competition_groups").select("name").eq("id",gid).single(),
    db.from("candidates").select("id,name,code").eq("group_id",gid).limit(1500)
   ]);
   if(group.error||candidates.error)throw fail("Không thể đọc biên bản.",503);
   const names=new Map((candidates.data||[]).map(c=>[c.id,{name:c.name,code:c.code}]));
   return reply(res,200,{ok:true,receipt:{
     groupName:group.data.name,graderName:receipt.grader_name,email:receipt.email,
     confirmedAt:receipt.verified_at,sha256:receipt.snapshot_sha256,
     rows:(receipt.snapshot||[]).map(row=>({candidateId:row.candidateId,...(names.get(row.candidateId)||{}),
      scores:row.scores,total:row.total,revision:row.revision}))
   }});
  }
  if(body.action==="confirm"){
   const code=String(body.code||"");
   if(!/^\d{6}$/.test(code))throw fail("Mã OTP phải đủ 6 chữ số.");
   const data=required(await db.rpc("gs_finalize_grading_otp",{p_grader:profile.id,p_group:gid,p_digest:digest(profile.id,gid,code)}));
   if(!data?.ok)throw fail(data.code==="OTP_INVALID"?"OTP không đúng.":data.code==="OTP_EXPIRED"?"OTP đã hết hạn.":"Không thể xác nhận: "+(data?.code||"unknown"),409);
   return reply(res,200,{ok:true,sha256:data.sha256,confirmedAt:data.confirmedAt});
  }
  throw fail("Tác vụ OTP không hợp lệ.");
 }catch(e){
  console.warn("GradeSync OTP request",e.httpStatus||500,e.code||"handled");
  return reply(res,e.httpStatus||500,{ok:false,error:e.message?.slice(0,220)||"Lỗi xác thực máy chủ."});
 }
}
