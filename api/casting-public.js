/* Candidate-specific result retrieval. Never returns a published roster or private profile fields. */
import crypto from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {restRecoveryOptions} from "../lib/supabase-rest-recovery.js";
const send=(res,status,data)=>{res.statusCode=status;res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");res.end(JSON.stringify(data))};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const client=()=>{const url=process.env.SUPABASE_URL||"https://nkpfzjhqtdjcfypkishv.supabase.co";return createClient(url,process.env.SUPABASE_SECRET_KEY||"",restRecoveryOptions(url))};
const fail=(s,status=400)=>Object.assign(new Error(s),{status});
function exactEmail(a,b){
 const A=Buffer.from(String(a||"").trim().toLowerCase()),B=Buffer.from(String(b||"").trim().toLowerCase());
 return A.length>0&&A.length===B.length&&crypto.timingSafeEqual(A,B);
}
export default async function handler(req,res){
 if(req.method!=="POST")return send(res,405,{ok:false,error:"Chỉ hỗ trợ POST."});
 if(Number(req.headers["content-length"]||0)>4096)return send(res,413,{ok:false,error:"Dữ liệu quá lớn."});
 try{
  if(!process.env.SUPABASE_SECRET_KEY)throw fail("Cổng kết quả chưa sẵn sàng.",503);
  const b=typeof req.body==="object"&&req.body?req.body:JSON.parse(String(req.body||"{}"));
  const castingId=String(b.castingId||""),code=String(b.code||"").trim().toUpperCase(),email=String(b.email||"").trim().toLowerCase();
  if(!UUID.test(castingId)||!/^[A-Z0-9_-]{3,50}$/.test(code)||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
   throw fail("Thông tin tra cứu không hợp lệ.");
  const db=client(),ip=String(req.headers["x-forwarded-for"]||"").split(",")[0].trim().slice(0,100)||"unknown";
  const key=crypto.createHash("sha256").update(castingId+"|"+ip).digest("hex");
  const permit=await db.rpc("gs_allow_result_lookup",{p_key:key});
  if(permit.error||permit.data!==true)throw fail("Quá nhiều lượt tra cứu. Vui lòng thử sau.",429);
  const cast=await db.from("gs_castings").select("id,status,publish_at,public_fields").eq("id",castingId).maybeSingle();
  if(cast.error||!cast.data||cast.data.status!=="published"||!cast.data.publish_at||
      Date.parse(cast.data.publish_at)>Date.now())throw fail("Kết quả chưa được công bố.",404);
  const groups=await db.from("competition_groups").select("id,extra_data").eq("casting_id",castingId).is("osc_deleted_at",null).limit(100);
  if(groups.error||!groups.data?.length)throw fail("Chưa có dữ liệu công bố.",404);
  const groupIds=groups.data.map(x=>x.id);
  const idResult=await db.from("gs_candidate_identity").select("candidate_id,email")
    .eq("casting_id",castingId).eq("mssv",code).maybeSingle();
  if(idResult.error)throw fail("Không thể tra cứu kết quả.",503);
  let candidate,identity=idResult.data;
  if(identity){
   const c=await db.from("candidates").select("id,code,name,group_id,is_present").eq("id",identity.candidate_id)
    .in("group_id",groupIds).maybeSingle();
   if(c.error)throw fail("Không thể tra cứu kết quả.",503);
   candidate=c.data;
  }else{
   const matches=await db.from("candidates").select("id,code,name,group_id,is_present")
    .in("group_id",groupIds).eq("code",code).limit(2);
   if(matches.error)throw fail("Không thể tra cứu kết quả.",503);
   if(matches.data?.length===1){
    candidate=matches.data[0];
    const row=await db.from("gs_candidate_identity").select("candidate_id,email")
      .eq("candidate_id",candidate.id).eq("casting_id",castingId).maybeSingle();
    if(row.error)throw fail("Không thể tra cứu kết quả.",503);
    identity=row.data;
   }
  }
  if(!candidate||!identity||!exactEmail(identity.email,email)|| (groups.data.find(g=>g.id===candidate.group_id)?.extra_data?.attendanceEnabled===true&&candidate.is_present!==true))
   throw fail("Không tìm thấy kết quả theo thông tin đã nhập.",404);
  const approval=await db.from("gs_casting_decisions").select("outcome,score,review_status").eq("casting_id",castingId).eq("candidate_id",candidate.id).maybeSingle();
  if(approval.error||approval.data?.review_status!=="approved")throw fail("Kết quả chưa được phê duyệt công bố.",404);
  const allowed=new Set(cast.data.public_fields||[]),output={code:candidate.code};
  if(allowed.has("name"))output.name=candidate.name;
  if(allowed.has("score"))output.score=approval.data.score;
  if(allowed.has("outcome"))output.outcome=approval.data.outcome;
  return send(res,200,{ok:true,result:output});
 }catch(e){return send(res,e.status||500,{ok:false,error:e.message?.slice(0,160)||"Không thể tra cứu."})}
}
