import crypto from "node:crypto";
import net from "node:net";
import {receiptMail} from "./receipt-mail.js";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,CODE=/^[A-Z][A-Z0-9_-]{2,19}$/,secretPattern=/^[A-Za-z0-9_-]{32}$/,tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const hash=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
const err=(message,status=400)=>Object.assign(Error(message),{httpStatus:status,code:status===403?"osc/gradesync-forbidden":status===409?"osc/gradesync-conflict":status===503?"osc/gradesync-upstream":"osc/gradesync-invalid"});
function checked(r){if(!r.error)return r.data;const m=String(r.error.message||"");if(m.includes("BACKUP_UNAUTHORIZED"))throw err("Phiên dự phòng đã hết hạn hoặc bị thu hồi.",401);if(m.includes("BACKUP_FORBIDDEN"))throw err("BGK không được phân công hoặc thí sinh không đủ điều kiện.",403);if(m.includes("SCORE_CONFLICT"))throw err("Điểm đã thay đổi trên thiết bị khác. Nạp lại để đối soát.",409);if(m.includes("BACKUP_CLOSED"))throw err("Phiên đã đóng, khóa hoặc công bố.",409);if(m.includes("BACKUP_INVALID")||m.includes("INVALID_ROLE_EVALUATION"))throw err("Thông tin hoặc điểm không hợp lệ.");throw err("Dịch vụ chấm điểm dự phòng chưa sẵn sàng.",503);}
export async function backupAdmin(db,actor,body){
 if(!["admin","superadmin"].includes(actor.profile?.role)||!UUID.test(String(body.graderId||"")))throw err("Không có quyền quản lý truy cập.",403);
 const action=String(body.action).replace("backup-","");if(!["status","issue","revoke"].includes(action))throw err("Tác vụ không hợp lệ.");
 let raw=null,expires=null,request=null;if(action==="issue"){
  const dt=Date.parse(body.expiresAt||"");if(!Number.isFinite(dt)||dt<=Date.now()||dt>Date.now()+30*86400000||!UUID.test(String(body.requestId||"")))throw err("Chọn thời hạn không quá 30 ngày và yêu cầu hợp lệ.");
  expires=new Date(dt).toISOString();request=body.requestId;raw=crypto.randomBytes(24).toString("base64url");
 }
 const result=checked(await db.rpc("osc_backup_admin",{p_grader:body.graderId,p_action:action,p_hash:raw?hash(raw):null,p_expires:expires,p_actor:actor.decoded.uid,p_request:request}));
 return {...result,...(raw&&result.issued?{accessCode:raw}:{}),portal:"https://backup.ourstage.io.vn/backup.html"};
}
export async function backupRequest(db,req,body){
 if(String(req.headers.origin||"")!=="https://backup.ourstage.io.vn")throw err("Nguồn yêu cầu không hợp lệ.",403);
 const action=String(body.action||"");
 if(action==="backup-login"){
  const code=String(body.code||"").trim().toUpperCase(),access=String(body.accessCode||"").trim();
  if(!CODE.test(code)||!secretPattern.test(access))throw err("Mã BGK hoặc mã truy cập không hợp lệ.",401);
  const ip=String(req.headers["x-forwarded-for"]||"").split(",")[0].trim();if(!net.isIP(ip))throw err("Không xác minh được nguồn truy cập.",403);
  const raw=crypto.randomBytes(32).toString("base64url"),r=checked(await db.rpc("osc_backup_login",{p_code:code,p_hash:hash(access),p_token:hash(raw),p_bucket:parseInt(hash(ip).slice(0,3),16)}));
  if(!r?.ok)throw err(r?.limited?"Đã đạt giới hạn thử. Vui lòng thử lại sau.":"Mã BGK hoặc mã truy cập không hợp lệ.",r?.limited?429:401);return {...r,token:raw};
 }
 const raw=String(req.headers.authorization||"").replace(/^Bearer\s+/,"");if(!tokenPattern.test(raw))throw err("Thiếu phiên dự phòng hợp lệ.",401);
 const token=hash(raw),group=body.groupId||null;
 if(action==="backup-logout"){checked(await db.rpc("osc_backup_logout",{p_token:token}));return{ok:true};}
 if(group!==null&&!UUID.test(String(group)))throw err("Phiên chấm không hợp lệ.");
 if(action==="backup-view")return checked(await db.rpc("osc_backup_view",{p_token:token,p_group:group}));
 if(!group)throw err("Chọn phiên chấm.");
 if(action==="backup-save"){
  const rows=body.rows;if(!Array.isArray(rows)||!rows.length||rows.length>20)throw err("Chỉ lưu tối đa 20 thí sinh mỗi lượt.");
  for(const r of rows)if(!UUID.test(String(r.candidateId||""))||!Number.isSafeInteger(r.revision)||r.revision<0||!r.scores||typeof r.scores!=="object"||Array.isArray(r.scores)||Object.values(r.scores).some(v=>typeof v!=="number"||!Number.isFinite(v)||v<0||v>10))throw err("Điểm hoặc phiên bản không hợp lệ.");
  return checked(await db.rpc("osc_backup_save_batch",{p_token:token,p_group:group,p_rows:rows}));
 }
 if(action==="backup-preflight"||action==="backup-submit"){
  const preview=action==="backup-preflight";if(!preview&&(body.accepted!==true||!/^[a-f0-9]{64}$/.test(String(body.version||""))))throw err("Cần xác nhận bảng điểm.");
  const r=checked(await db.rpc("osc_backup_submit",{p_token:token,p_group:group,p_expected:preview?null:body.version}));if(!r?.ok)throw err("Phiên hoặc bảng điểm đã thay đổi. Hãy đối soát lại.",409);if(preview)return r;
  let mail={mailAccepted:false,mailStatus:"pending"};try{const session=checked(await db.from("osc_backup_sessions").select("grader_id").eq("token_hash",token).maybeSingle());if(session?.grader_id)mail=await receiptMail(db,group,session.grader_id,false);}catch{}return {...r,...mail};
 }throw err("Tác vụ không hợp lệ.");
}
export const _test={hash,secretPattern,tokenPattern,CODE,UUID};
