import {createHash} from "node:crypto";
import {sendScoringMail} from "./scoring-mail-relay.js";
const checked=r=>{if(r.error)throw Error("Không thể đọc lịch email cấp quyền.");return r.data;};
const key=id=>createHash("sha256").update("osc-invite:"+id).digest("hex");
export async function deliverInviteJob(db,id){
 const row=checked(await db.from("osc_session_invite_jobs").select("*").eq("id",id).maybeSingle());
 if(!row||["accepted","cancelled"].includes(row.status))return {id,status:row?.status||"unavailable"};
 if(row.attempts>=5||row.status==="sending"&&Date.parse(row.lease_until||0)>Date.now())return {id,status:row.status};
 const j=checked(await db.from("osc_session_invite_jobs").update({status:"sending",attempts:row.attempts+1,lease_until:new Date(Date.now()+45000).toISOString()}).eq("id",id).eq("status",row.status).eq("attempts",row.attempts).select("*").maybeSingle());
 if(!j)return {id,status:"pending"};
 try{
  const [a,p,e]=await Promise.all([db.from("grader_assignments").select("id").eq("group_id",j.group_id).eq("grader_id",j.grader_id).maybeSingle(),db.from("profiles").select("status,extra_data").eq("id",j.grader_id).maybeSingle(),db.from("gs_google_grader_access").select("email,enabled").eq("profile_id",j.grader_id).maybeSingle()]);
  const grant=checked(a),profile=checked(p),access=checked(e);
  if(!grant||profile?.status!=="Active"||profile.extra_data?.oscArchivedAt||!access?.enabled||access.email!==j.email){
   checked(await db.from("osc_session_invite_jobs").update({status:"cancelled",lease_until:null,last_error:"Quyền hoặc email BGK đã thay đổi."}).eq("id",id).eq("status","sending"));return {id,status:"cancelled"};
  }
  const sent=await sendScoringMail({kind:"invite",to:j.email,name:j.grader_name,groupName:j.group_name,deliveryKey:key(id),scheduledAt:j.send_at});
  if(!sent.providerId)throw Error("Nhà cung cấp chưa trả mã email.");
  checked(await db.from("osc_session_invite_jobs").update({status:"accepted",provider_id:sent.providerId,lease_until:null,last_error:null}).eq("id",id).eq("attempts",j.attempts).eq("status","sending"));
  return {id,status:"accepted"};
 }catch(e){
  await db.from("osc_session_invite_jobs").update({status:"failed",lease_until:null,last_error:String(e.message||"Lỗi email").slice(0,160)}).eq("id",id).eq("attempts",j.attempts).eq("status","sending");return {id,status:"failed"};
 }
}
export async function retryInviteJobs(db,groupId=null,ids=null){
 let q=db.from("osc_session_invite_jobs").select("id").in("status",["pending","failed","sending"]).lt("attempts",5).order("created_at").limit(12);
 if(groupId)q=q.eq("group_id",groupId);if(ids)q=q.in("id",ids);
 const rows=checked(await q),out=[];
 for(let i=0;i<rows.length;i+=4)out.push(...await Promise.all(rows.slice(i,i+4).map(j=>deliverInviteJob(db,j.id))));
 return out;
}
export async function cancelRemovedInvites(db,groupId,desired){
 const rows=checked(await db.from("osc_session_invite_jobs").select("*").eq("group_id",groupId).in("status",["accepted","sending"]).gt("send_at",new Date().toISOString()).limit(100));
 for(const j of rows.filter(j=>!desired.includes(j.grader_id))){
  if(j.status==="sending"||!j.provider_id)throw Error("Lời mời đang được gửi. Hãy thử lại sau.");
  await sendScoringMail({kind:"invite-cancel",to:j.email,name:j.grader_name,groupName:j.group_name,deliveryKey:key(j.id),providerId:j.provider_id});
  checked(await db.from("osc_session_invite_jobs").update({status:"cancelled",lease_until:null}).eq("id",j.id).eq("status","accepted"));
 }
}
