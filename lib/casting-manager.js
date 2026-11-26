import {createClient} from "@supabase/supabase-js";
import {createHash} from "node:crypto";
import {exportGradingPdf,buildGradingReport,lookupScan,getArchivedOriginal} from "./osc-pdf-service.js";
import {restRecoveryOptions} from "./supabase-rest-recovery.js";
import {retryInviteJobs,cancelRemovedInvites} from "./session-invite-mail.js";
import {deliverReceiptJob} from "./receipt-mail.js";
import {normalizeSessionPolicy,registeredRoles,officialRoles,finalOutcome,scoringPolicy} from "./casting-role-rules.js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERM=/^(FA|SU|SP)[0-9]{2}$/;
const FIELD=/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/;
const CAST_ACTIONS=new Set(["semester-plan-casting-draft","casting-account-list","casting-list","casting-save","casting-create-session","casting-update-session","casting-session-assignments","casting-session-invite-retry","casting-cancel-review","casting-session-control","casting-assign-group","casting-grant-google","casting-grant-criteria","casting-field","casting-grader-receipt","casting-pdf-export","casting-report-data","casting-scan-original","casting-original-by-hash","casting-receipt-list","casting-group-options","casting-candidate-roster","casting-candidate-list","casting-candidate-add","casting-candidate-import","casting-candidate-delete","casting-candidate-edit","casting-bulk-consent","casting-add-members","casting-results","casting-review","casting-publish","casting-sync-payload","casting-sync-complete","casting-notification-queue","casting-notice-batch","casting-notice-ack","casting-notice-history","casting-notice-retry"]);
const client=()=>{const url=process.env.SUPABASE_URL||"https://nkpfzjhqtdjcfypkishv.supabase.co";return createClient(url,process.env.SUPABASE_SECRET_KEY||"",restRecoveryOptions(url))};
function err(message){throw Object.assign(Error(message),{code:"osc/gradesync-invalid"})}
function safe(v,max=120){return String(v??"").trim().replace(/\s+/g," ").slice(0,max)}
function uid(v){if(typeof v!=="string"||!UUID.test(v))err("ID không hợp lệ.");return v}
function validTerm(v){const term=String(v||"").toUpperCase();if(!TERM.test(term))err("Học kỳ phải theo mẫu FA26, SU26 hoặc SP26.");return term}
function check(result){if(result.error){if(String(result.error.message||"").includes("Phiên chấm đã hoàn tất."))throw Object.assign(Error("Phiên chấm đã hoàn tất."),{code:"osc/gradesync-conflict"});err("Không thể truy cập dữ liệu casting ("+(result.error.code||"server")+").")}return result.data}
async function byId(db,table,id){let q=db.from(table).select("*").eq("id",uid(id));if(table==="competition_groups")q=q.is("osc_deleted_at",null);return check(await q.single())}
async function readAll(db,table,where,max=1500,fields="*"){
 const out=[];
 const keys={gs_candidate_identity:["candidate_id"],gs_criterion_grants:["group_id","grader_id","criterion"],
   gs_casting_decisions:["casting_id","candidate_id"],gs_candidate_fields:["casting_id","field_key"],
   gs_google_grader_access:["profile_id"],grader_assignments:["group_id","grader_id"]}[table]||["id"];
 for(let off=0;off<=max;off+=200){
  let q=db.from(table).select(fields).range(off,Math.min(off+199,max));
  if(table==="competition_groups")q=q.is("osc_deleted_at",null);
  for(const key of keys)q=q.order(key);
  for(const [k,v] of Object.entries(where||{}))q=Array.isArray(v)?q.in(k,v):q.eq(k,v);
  const data=check(await q);
  if(out.length+(data?.length||0)>max)break;
  out.push(...(data||[]));if(!data||data.length<200)return out;
 }
 err("Dữ liệu vượt giới hạn an toàn. Hãy chia nhỏ theo học kỳ.");
}
function scoreAggregate(scores,config){
 const values=scores.filter(s=>s.total_score!==null&&s.total_score!==undefined)
  .map(s=>({score:Number(s.total_score),code:s.grader_code||""}))
  .filter(s=>Number.isFinite(s.score)&&s.score>=0&&s.score<=10);
 if(!values.length)return null;
 if(config.aggregate_method==="trimmed"&&values.length>=3){
  const ordered=values.map(v=>v.score).sort((a,b)=>a-b).slice(1,-1);
  return Number((ordered.reduce((a,b)=>a+b,0)/ordered.length).toFixed(2));
 }
 if(config.aggregate_method==="weighted"){
  const weights=config.grader_weights||{};
  let total=0,denom=0;
  for(const v of values){const w=Number(weights[v.code]??1);if(w>0&&w<=100){total+=v.score*w;denom+=w}}
  return denom?Number((total/denom).toFixed(2)):null;
 }
 return Number((values.reduce((a,b)=>a+b.score,0)/values.length).toFixed(2));
}
function candidateProfile(candidate,identity){
 const fields={...candidate.extra_data?.extraData,...candidate.custom_fields};
 delete fields.gsRoleIds;
 const aliases={mssv:["mssv","masosinhvien"],email:["email","gmail","emaillienhe"],
  phone:["phone","phonenumber","sdt","sodienthoai","dienthoai"]};
 const contacts={};
 for(const [key,value] of Object.entries(fields)){
  const normalized=key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replaceAll("đ","d").replace(/[^a-z0-9]/g,"");
  const canonical=Object.keys(aliases).find(name=>aliases[name].includes(normalized));
  if(canonical){contacts[canonical]=value;delete fields[key]}
 }
 const code=String(candidate.code||"");
 return{fields,privateFields:{...identity?.private_fields,phone:identity?.private_fields?.phone??contacts.phone??""},
  mssv:identity?identity.mssv||"":contacts.mssv||(/^[a-z]{2}\d{6}$/i.test(code)?code:""),
  email:identity?identity.email||"":String(contacts.email||"").trim().toLowerCase()};
}
function emailPublicationState(casting,group,publicationAt,now=Date.now()){
 if(casting.status==="archived")return "published";
 const castingTime=casting.status==="published"?(casting.publish_at?Date.parse(casting.publish_at):0):Infinity;
 const groupTime=publicationAt?Date.parse(publicationAt):Infinity;
 const at=Math.min(Number.isFinite(castingTime)?castingTime:Infinity,Number.isFinite(groupTime)?groupTime:Infinity);
 return at<=now?"published":Number.isFinite(at)?"scheduled":"unpublished";
}
function prepareRosterImport(b,group,defs){
  const code=safe(b.code,40).toUpperCase(),name=safe(b.name,120),
   mssv=safe(b.mssv,50).toUpperCase(),email=String(b.email||"").trim().toLowerCase(),
   phone=safe(b.phone,40);
  if(!/^[A-Z0-9_-]{2,40}$/.test(code)||name.length<2||
   (mssv&&!/^[A-Z0-9_-]{3,50}$/.test(mssv))||
   (email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
   err("Họ tên, SBD, MSSV hoặc email không hợp lệ.");
  const fields=b.fields&&typeof b.fields==="object"&&!Array.isArray(b.fields)?b.fields:{};
  if(Object.keys(fields).length>40)err("Quá nhiều trường phụ.");
  const allowed=new Map(defs.map(x=>[x.field_key,x])),custom={},privateFields={};
  if(phone)privateFields.phone=phone;
  for(const [key,value] of Object.entries(fields)){
   if(!FIELD.test(key)||!allowed.has(key))err("Trường dữ liệu không thuộc cấu hình: "+key);
   const def=allowed.get(key),val=safe(value,300);
   if(def.kind==="select"&&val&&Array.isArray(def.choices)&&def.choices.length&&!def.choices.includes(val))
    err("Giá trị chưa cấu hình: "+key);
   if(def.visibility==="admin")privateFields[key]=val;else custom[key]=val;
  }
  for(const def of defs){
   if(!def.required)continue;
   const v={name,mssv,email,phone,...privateFields,...custom}[def.field_key];
   if(!String(v??"").trim())err("Thiếu trường bắt buộc: "+def.label);
  }
  // Explicitly documented consent is required; never infer permission from email.
  if(group.extra_data?.gsCasting?.roles?.length)custom.gsRoleIds=registeredRoles(group.extra_data.gsCasting,b.registeredRoles??[]);
  else if(b.registeredRoles?.length)err("Phiên không casting theo vai.");
 return {code,name,mssv,email,custom,privateFields};
}
const rosterErrors={GS_ROSTER_INVALID:"Yêu cầu không hợp lệ.",GS_ROSTER_FINAL:"Phiên đã công bố hoặc đặt lịch công bố.",GS_ROSTER_NOT_FOUND:"Phiên không còn tồn tại.",GS_ROSTER_CHANGED:"Cấu hình phiên vừa thay đổi. Hãy làm mới.",GS_ROSTER_LOCKED:"Phiên đã có BGK xác nhận hoặc khóa điểm danh. Không thay đổi danh sách để bảo toàn biên bản.",GS_ROSTER_INVALID_ROW:"Dữ liệu dòng không hợp lệ.",GS_ROSTER_IDENTITY_MISMATCH:"SBD trùng nhưng MSSV không khớp; không cập nhật.",GS_ROSTER_EXISTING_ROLES:"Hồ sơ đã có vai khác với file; không ghi đè.",GS_ROSTER_DUPLICATE_CODE:"SBD đã tồn tại trong phiên.",GS_ROSTER_DUPLICATE_MSSV:"MSSV đã tồn tại trong đợt tuyển.",GS_ROSTER_DUPLICATE:"SBD hoặc MSSV đã tồn tại.",GS_ROSTER_CANDIDATE_NOT_FOUND:"Hồ sơ không còn tồn tại trong phiên.",GS_ROSTER_CANDIDATE_CHANGED:"Hồ sơ vừa thay đổi. Hãy tải lại.",GS_ROSTER_CANDIDATE_PROTECTED:"Hồ sơ đã có điểm, kết quả hoặc đồng bộ; không thể xóa.",INVALID_REGISTERED_ROLES:"Vai đăng ký không đúng cấu hình.",GS_ATTENDANCE_LOCKED:"Điểm danh đã khóa.",GS_ROSTER_WRITE_FAILED:"Không thể lưu dòng này."};
function rosterMessage(message){return rosterErrors[Object.keys(rosterErrors).sort((a,b)=>b.length-a.length).find(k=>String(message).includes(k))]||"Không thể cập nhật danh sách thí sinh."}
async function emailResults(db,castingId,groupId){
 const c=await byId(db,"gs_castings",castingId);
 const groups=await readAll(db,"competition_groups",groupId?{casting_id:c.id,id:uid(groupId)}:{casting_id:c.id},1000,"id,name,casting_id,extra_data,osc_deleted_at");
 if(groupId&&!groups.length)err("Phiên chấm không thuộc đợt tuyển.");
 if(!groups.length)return{casting:c,groups:[],rows:[]};
 const [candidates,publicationResult]=await Promise.all([
  readAll(db,"candidates",{group_id:groups.map(g=>g.id)},1500,"id,group_id,code,name,is_present,custom_fields,extra_data"),
  db.rpc("osc_session_publication_meta")
 ]);
 const publications=new Map(check(publicationResult).map(x=>[x.group_id,x.publish_at]));
 const groupMap=new Map(groups.map(g=>{g.publicationAt=publications.get(g.id)||null;g.publicationState=emailPublicationState(c,g,g.publicationAt);return[g.id,g]}));
 const present=candidates.filter(x=>groupMap.get(x.group_id)?.extra_data?.attendanceEnabled!==true||x.is_present===true);
 const ids=present.map(x=>x.id);
 const chunks=Array.from({length:Math.ceil(ids.length/80)},(_,i)=>ids.slice(i*80,i*80+80));
 const [decisions,identities]=await Promise.all([
  Promise.all(chunks.map(candidate_id=>readAll(db,"gs_casting_decisions",{casting_id:c.id,candidate_id},100,"candidate_id,review_status,outcome,score,assigned_roles"))).then(x=>x.flat()),
  Promise.all(chunks.map(candidate_id=>readAll(db,"gs_candidate_identity",{candidate_id},100,"candidate_id,mssv,email,email_consent,private_fields"))).then(x=>x.flat())
 ]);
 const dm=new Map(decisions.map(x=>[x.candidate_id,x])),im=new Map(identities.map(x=>[x.candidate_id,x]));
 const rows=present.map(x=>{
  const g=groupMap.get(x.group_id),d=dm.get(x.id),i=im.get(x.id);
  const official=d?.review_status==="approved"&&d.score!=null&&Number.isFinite(Number(d.score))&&["passed","failed"].includes(d.outcome);
  return {id:x.id,groupId:g.id,groupName:g.name,code:x.code,name:x.name,email:candidateProfile(x,i).email,
   emailConsent:i?.email_consent===true,review:d?.review_status||"pending",outcome:official?d.outcome:"pending",assignedRoles:official?(d.assigned_roles||[]):[],
   incomplete:!official,publicationAt:g.publicationAt,publicationState:g.publicationState,archived:!!g.osc_deleted_at};
 });
 return{casting:c,groups:groups.map(g=>({id:g.id,name:g.name,publicationAt:g.publicationAt,publicationState:g.publicationState,osc_deleted_at:g.osc_deleted_at})),rows};
}
async function results(db,castingId,reportGroupId=null){
 const c=await byId(db,"gs_castings",castingId);
 const groups=await readAll(db,"competition_groups",reportGroupId?{casting_id:c.id,id:reportGroupId}:{casting_id:c.id},1000);
 if(!groups.length)return{casting:c,groups:[],rows:[]};
 const gids=groups.map(g=>g.id);
 const allCandidates=await readAll(db,"candidates",{group_id:gids});
 const attendanceGroups=new Set(groups.filter(g=>g.extra_data?.attendanceEnabled===true).map(g=>g.id));
 const candidates=allCandidates.filter(p=>!attendanceGroups.has(p.group_id)||p.is_present===true);
 const candidateIds=candidates.map(p=>p.id);
 const decisionScope={casting_id:c.id};
 const decisionRead=()=>reportGroupId?Promise.all(Array.from({length:Math.ceil(candidateIds.length/80)},(_,i)=>readAll(db,"gs_casting_decisions",{...decisionScope,candidate_id:candidateIds.slice(i*80,i*80+80)}))).then(parts=>parts.flat()):readAll(db,"gs_casting_decisions",decisionScope);
 const [scores,verifications,assignments,decisions,identities,criterionGrants,profiles,quorumResult,publications]=await Promise.all([
  readAll(db,"scores",{group_id:gids}),
  readAll(db,"grader_verifications",{group_id:gids}),
  readAll(db,"grader_assignments",{group_id:gids}),
  candidateIds.length?decisionRead():Promise.resolve([]),
  reportGroupId?Promise.resolve([]):readAll(db,"gs_candidate_identity",{casting_id:c.id}),
  readAll(db,"gs_criterion_grants",{group_id:gids}),
  readAll(db,"profiles",{role:"Grader"},1000),(reportGroupId?db.rpc("osc_candidate_quorum",{p_casting:c.id}).eq("group_id",reportGroupId):db.rpc("osc_candidate_quorum",{p_casting:c.id})),db.rpc("osc_session_publication_meta")
 ]);
 const quorum=new Map((check(quorumResult)||[]).map(q=>[q.candidate_id,q]));
 const publicationMap=new Map(check(publications).map(p=>[p.group_id,p.publish_at]));for(const g of groups)g.publicationAt=publicationMap.get(g.id)||null;
 const active=new Set(profiles.filter(p=>p.status==="Active").map(p=>p.id));
 const valid=new Set(verifications.filter(v=>v.is_verified===true&&active.has(v.grader_id)).map(v=>v.group_id+"|"+v.grader_id));
 const assignedCriteria=new Map();
 for(const grant of criterionGrants){
  const key=grant.group_id+"|"+grant.grader_id;
  if(!assignedCriteria.has(key))assignedCriteria.set(key,new Set());
  assignedCriteria.get(key).add(grant.criterion);
 }
 const identityMap=new Map(identities.map(d=>[d.candidate_id,d]));
 const allScores=new Map();
 for(const row of scores){
  const items=allScores.get(row.candidate_id)||[];items.push(row);allScores.set(row.candidate_id,items);
 }
 const scoreMap=new Map(),decisionMap=new Map(decisions.map(d=>[d.candidate_id,d])),expected=new Map(),groupMap=new Map(groups.map(g=>[g.id,g]));
 for(const a of assignments)if(active.has(a.grader_id))expected.set(a.group_id,(expected.get(a.group_id)||0)+1);
 for(const s of scores){if(!valid.has(s.group_id+"|"+s.grader_id))continue;const arr=scoreMap.get(s.candidate_id)||[];arr.push(s);scoreMap.set(s.candidate_id,arr)}
 const rows=candidates.map(p=>{
  const q=quorum.get(p.id),validIds=new Set(q?.valid_ids||[]),graded=(scoreMap.get(p.id)||[]).filter(s=>validIds.has(s.grader_id)),group=groupMap.get(p.group_id),policy=group?.extra_data?.gsCasting||null,limits=group?.extra_data?.gsRoleLimits||{},config=scoringPolicy(group,c),score=scoreAggregate(graded,config);
  const missing=graded.some(s=>{
   const allow=assignedCriteria.get(s.group_id+"|"+s.grader_id);
   return (group?.criteria||[]).some(x=>(!allow||allow.has(x.name))&&
     !Object.prototype.hasOwnProperty.call(s.scores||{},x.name));
  });
  const required=Math.ceil(Number(q?.expected_count||0)/2);
  const completed=Number(q?.expected_count||0)>0&&Number(q?.submitted_count||0)>=required&&graded.length>=required&&q?.covered===true&&!missing;
  const records=allScores.get(p.id)||[];
  const unsubmitted=records.filter(s=>!valid.has(s.group_id+"|"+s.grader_id)).length;
  const anomalies=[];
  if(missing)anomalies.push("Thiếu tiêu chí được phân công");
  if(unsubmitted)anomalies.push(unsubmitted+" bảng điểm chưa xác nhận");
  if(records.some(s=>s.total_score!=null&&(!Number.isFinite(Number(s.total_score))||
     Number(s.total_score)<0||Number(s.total_score)>10)))anomalies.push("Điểm ngoài thang 0–10");
  const validTotals=graded.map(s=>Number(s.total_score)).filter(n=>Number.isFinite(n));
  if(validTotals.length>=2&&Math.max(...validTotals)-Math.min(...validTotals)>=4)
   anomalies.push("Chênh lệch giữa BGK từ 4 điểm trở lên");
  if(!graded.length)anomalies.push("Chưa có bảng điểm BGK được khóa");
  if(!completed)anomalies.push("Cần "+required+" BGK hợp lệ; phiên đã xác nhận "+(q?.submitted_count||0)+"/"+(q?.expected_count||0)+", thí sinh "+graded.length+"/"+(q?.expected_count||0)+(q?.covered===false?"; chưa đủ phạm vi tiêu chí":""));
  const scoreOutcome=score===null||!completed?"pending":score>=Number(config.pass_score)?"passed":"failed";
  const review=decisionMap.get(p.id)||null,identity=identityMap.get(p.id)||null;
  const assignedRoles=review?.assigned_roles||[];
  const official=review?.review_status==="approved"&&review.score!=null&&["passed","failed"].includes(review.outcome);
  const outcome=official?review.outcome:finalOutcome(scoreOutcome,policy,assignedRoles);
  return{id:p.id,groupId:p.group_id,groupName:group?.name||"",publicationAt:publicationMap.get(p.group_id)||null,code:p.code,name:p.name,
    ...candidateProfile(p,identity),emailConsent:identity?.email_consent===true,
    score:official?Number(review.score):score,liveScore:score,judges:graded.length,expectedJudges:Number(q?.expected_count||0),requiredJudges:required,submittedJudges:Number(q?.submitted_count||0),roleCapacity:limits.capacity||{},maxOfficialRoles:limits.maxOfficialRoles||1,
    incomplete:!completed,missing,unsubmitted,anomalies,outcome,scoreOutcome,roleOptions:policy?.roles||[],assignedRoles,registeredRoles:p.custom_fields?.gsRoleIds||[],judgeEvaluations:graded.map(s=>({grader:s.grader_name||s.grader_code,roles:s.extra_data?.gsProposedRoles||[],note:s.extra_data?.gsJudgeNote||""})),review:review?.review_status||"pending",
    syncState:review?.synced_at?"synced":"not-synced",memberId:review?.member_id||null};
 });
 return{casting:c,groups,rows,attendanceSummary:{registered:allCandidates.length,eligible:candidates.length,absent:allCandidates.length-candidates.length},...(reportGroupId?{reportData:{scores,decisions,quorum:[...quorum.values()]}}:{})};
}
function validateRoleLimits(raw,roles){
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||!raw.capacity||typeof raw.capacity!=="object"||Array.isArray(raw.capacity))err("Giới hạn vai không hợp lệ.");
 const max=Number(raw.maxOfficialRoles);
 if(!Number.isInteger(max)||max<1||max>Math.max(1,roles.length))err("Số vai chính thức tối đa không hợp lệ.");
 const capacity=Object.fromEntries(roles.map(name=>[name,Number(Object.hasOwn(raw.capacity,name)?raw.capacity[name]:1)]));
 if(Object.values(capacity).some(v=>!Number.isInteger(v)||v<1||v>1000))err("Số diễn viên cho mỗi vai phải từ 1 đến 1000.");
 return {capacity,maxOfficialRoles:max};
}
async function handleCastingAction(action,b,actor){
 if(!CAST_ACTIONS.has(action))err("Tác vụ casting không được phép.");
 const db=client(),by=actor.decoded.uid;
 if(action==="casting-report-data"){
  const report=await buildGradingReport(db,{...b,tabular:true},{byId,readAll,check,results,attendanceState:async(db,id)=>check(await db.rpc("osc_attendance_state",{p_group:id}))});
  const m=report.model;
  return {ok:true,title:m.title,session:m.session,judge:m.judge,note:m.note,confirmed:m.confirmed,kind:m.kind,columns:m.columns,rows:m.rows,summary:m.signTime,reviewSummary:report.reviewSummary,attendanceState:report.attendanceState,filename:report.filename};
 }
 if(action==="casting-scan-original")return lookupScan(db,b,true);
 if(action==="casting-original-by-hash")return getArchivedOriginal(db,b);
 if(action==="casting-pdf-export"){if(!["admin","superadmin"].includes(actor.profile.role))err("Không có quyền xuất PDF.");try{return await exportGradingPdf(db,b,actor,{byId,readAll,check,results,attendanceState:async(db,id)=>check(await db.rpc("osc_attendance_state",{p_group:id}))})}catch(e){err(String(e.message||"Không thể tạo biên bản.").slice(0,240))}}
 if(action==="semester-plan-casting-draft"){
  // Stable OSC activity key: a retry can recover a committed draft, never
  // overwrite grading configuration or create a second casting.
  if(!["admin","superadmin"].includes(actor.profile.role))err("Không có quyền tạo casting.");
  const term=validTerm(b.term),planId=uid(b.planId),name=safe(b.name,140);
  if(name.length<2)err("Tên casting quá ngắn.");
  const hex=createHash("sha256").update("osc-semester-planner:v1:"+term+":"+planId).digest("hex").slice(0,32);
  const id=hex.slice(0,8)+"-"+hex.slice(8,12)+"-4"+hex.slice(13,16)+"-a"+hex.slice(17,20)+"-"+hex.slice(20);
  let row=check(await db.from("gs_castings").select("id,term,name,status").eq("id",id).maybeSingle());
  if(!row){
   const made=await db.from("gs_castings").insert({id,term,name,status:"draft",aggregate_method:"mean",pass_score:5});
   if(made.error&&made.error.code!=="23505")check(made);
   row=check(await db.from("gs_castings").select("id,term,name,status").eq("id",id).single());
  }
  if(row.term!==term)err("Casting không thuộc học kỳ.");
  return{ok:true,casting:row};
 }
 if(action==="casting-group-options"){
  // Lightweight selector for the member-style candidate list: no grader, score,
  // or other semesters' candidate profiles are fetched on page entry.
  const emailOptions=b.emailOptions===true;
  const groupQuery=db.from("competition_groups").select("id,casting_id,name,osc_deleted_at").is("osc_deleted_at",null).order("name").limit(600);
  const [castingRows,groupRows,pubs]=await Promise.all([
   db.from("gs_castings").select("id,term,name,status,publish_at").order("created_at",{ascending:false}).limit(300),groupQuery,
   emailOptions?db.rpc("osc_session_publication_meta"):Promise.resolve({data:[]})
  ]);
  const castings=check(castingRows),groups=check(groupRows);
  const byCasting=new Map(castings.map(c=>[c.id,c]));
  const publicationMap=new Map(check(pubs).map(x=>[x.group_id,x.publish_at]));
  const activeCastingIds=new Set(groups.map(g=>g.casting_id));
  return{ok:true,castings:castings.filter(c=>activeCastingIds.has(c.id)),groups:groups.filter(g=>byCasting.has(g.casting_id)).map(g=>({
   id:g.id,castingId:g.casting_id,name:g.name,term:byCasting.get(g.casting_id)?.term||"",
   castingName:byCasting.get(g.casting_id)?.name||"",
   castingStatus:byCasting.get(g.casting_id)?.status||"draft",...(emailOptions?{archived:!!g.osc_deleted_at,publicationState:emailPublicationState(byCasting.get(g.casting_id),g,publicationMap.get(g.id))}:{})
  }))};
 }
 if(action==="casting-session-control"){
  if(!["admin","superadmin"].includes(actor.profile.role))err("Không có quyền quản lý phiên chấm.");
  const operation=String(b.operation||"");
  if(!["open","close","delete"].includes(operation)||b.confirm!==true)err("Hãy xác nhận thao tác.");
  if(operation==="delete"&&b.archivePublished!==true&&actor.profile.role!=="superadmin")throw Object.assign(Error("Chỉ Super Admin được xóa phiên chấm."),{code:"osc/gradesync-forbidden"});
  const {data,error}=operation==="delete"&&b.archivePublished===true?await db.rpc("osc_archive_published_session",{p_group:uid(b.groupId),p_name:String(b.confirmName||""),p_version:b.version??null,p_actor:by,p_actor_role:actor.profile.role}):operation==="delete"?await db.rpc("osc_superadmin_delete_session",{p_group:uid(b.groupId),p_name:String(b.confirmName||""),p_actor:by}):await db.rpc("osc_manage_scoring_session",{p_group:uid(b.groupId),p_action:operation,p_version:b.version??null,p_name:"",p_actor:by});
  if(error){
   const messages={GS_SESSION_NOT_PUBLISHED:"Phiên chưa đến thời điểm công bố kết quả.",GS_SESSION_PUBLICATION_SCHEDULED:"Phiên còn lịch gửi kết quả chưa đến giờ. Hãy kiểm tra lịch gửi.",GS_SESSION_INVALID:"Thao tác không hợp lệ.",GS_SESSION_NOT_FOUND:"Phiên không còn tồn tại.",GS_SESSION_CHANGED:"Phiên vừa thay đổi. Hãy làm mới dữ liệu.",GS_SESSION_NAME:"Tên xác nhận không khớp.",GS_SESSION_DELETE_PROTECTED:"Chỉ xóa phiên chưa mở hoặc đã đóng, chưa có điểm, biên bản hay kết quả duyệt.",GS_SESSION_FINAL:"Phiên đã duyệt hoặc công bố kết quả. Không thể mở lại.",GS_SESSION_AUTO:"Phiên mở tự động. Hãy chỉnh lịch mở/đóng.",GS_SESSION_EXPIRED:"Đã quá giờ khóa. Hãy điều chỉnh lịch trước khi mở."};
   const key=Object.keys(messages).find(k=>String(error.message||"").includes(k));err(messages[key]||"Không thể thay đổi phiên chấm ("+(error.code||"server")+").");
  }
  if(data?.ok!==true)err("Máy chủ chưa xác nhận thao tác.");return data;
 }
 if(action==="casting-account-list"){
  const [groups,graders,access,assignments,lockedJudges]=await Promise.all([
   readAll(db,"competition_groups",{},1000,"id,name"),
   readAll(db,"profiles",{role:"Grader"},1000,"id,name,code,status,extra_data"),
   readAll(db,"gs_google_grader_access",{},1000,"profile_id,email,enabled"),
   readAll(db,"grader_assignments",{},1500,"group_id,grader_id"),
   db.rpc("osc_locked_judge_ids")
  ]);
  const map=new Map(access.map(x=>[x.profile_id,x])),byGrader=new Map(),locked=new Set(check(lockedJudges).map(x=>x.grader_id));
  const activeGroupIds=new Set(groups.map(g=>g.id));
  for(const a of assignments){if(!activeGroupIds.has(a.group_id))continue;if(!byGrader.has(a.grader_id))byGrader.set(a.grader_id,[]);byGrader.get(a.grader_id).push(a.group_id)}
  return {ok:true,groups,graders:graders.map(g=>({id:g.id,name:g.name,code:g.code,status:g.extra_data?.oscArchivedAt?"Inactive":g.status,archived:!!g.extra_data?.oscArchivedAt,email:map.get(g.id)?.email||"",emailLocked:locked.has(g.id),googleEnabled:map.get(g.id)?.enabled===true,assignedGroups:byGrader.get(g.id)||[]}))};
 }
 if(action==="casting-list"){
  const [castings,groups,graders,access,assignments,criteriaGrants,counts,controls,lockedJudges,reviewSummary,publicationMeta]=await Promise.all([
   readAll(db,"gs_castings",{},1000),
   readAll(db,"competition_groups",{},1000),
   readAll(db,"profiles",{role:"Grader"},1000),
   readAll(db,"gs_google_grader_access",{},1000),
   readAll(db,"grader_assignments",{},1500),
   readAll(db,"gs_criterion_grants",{},1500),
   db.rpc("gs_session_counts"),db.rpc("osc_session_controls"),db.rpc("osc_locked_judge_ids"),db.rpc("osc_session_review_summary"),db.rpc("osc_session_publication_meta")
  ]);
  const map=new Map(access.map(x=>[x.profile_id,x])),byGrader=new Map(),locked=new Set(check(lockedJudges).map(x=>x.grader_id));
  const activeGroupIds=new Set(groups.map(g=>g.id)),activeCastingIds=new Set(groups.map(g=>g.casting_id));
  for(const a of assignments){
   if(!activeGroupIds.has(a.group_id))continue;
   if(!byGrader.has(a.grader_id))byGrader.set(a.grader_id,[]);
   byGrader.get(a.grader_id).push(a.group_id);
  }
  const reviewMap=new Map((check(reviewSummary)||[]).map(x=>[x.group_id,x]));const publicationMap=new Map(check(publicationMeta).map(x=>[x.group_id,x.publish_at]));
  const countMap=new Map((check(counts)||[]).map(x=>[x.group_id,x]));const controlsMap=new Map((check(controls)||[]).map(x=>[x.group_id,x]));
  return{ok:true,castings:castings.filter(c=>activeCastingIds.has(c.id)),criteriaGrants:criteriaGrants.filter(g=>activeGroupIds.has(g.group_id)).map(g=>({graderId:g.grader_id,groupId:g.group_id,criterion:g.criterion})),groups:groups.map(g=>({id:g.id,name:g.name,castingId:g.casting_id,sessionAt:g.extra_data?.sessionAt||null,blockGraderAfterPublish:g.extra_data?.blockGraderAfterPublish!==false,configVersion:g.extra_data?.configVersion||0,publicationAt:publicationMap.get(g.id)||null,eligibleCount:Number(reviewMap.get(g.id)?.eligible_count||0),approvedCount:Number(reviewMap.get(g.id)?.approved_count||0),accessState:publicationMap.has(g.id)?"closed":controlsMap.get(g.id)?.access_state,canOpen:!publicationMap.has(g.id)&&controlsMap.get(g.id)?.can_open===true,canDelete:actor.profile.role==="superadmin"||["admin"].includes(actor.profile.role)&&(publicationMap.has(g.id)?Date.parse(publicationMap.get(g.id))<=Date.now():castings.some(c=>c.id===g.casting_id&&["published","archived"].includes(c.status)&&(!c.publish_at||Date.parse(c.publish_at)<=Date.now()))),controlReason:controlsMap.get(g.id)?.reason||"",candidateCount:Number(countMap.get(g.id)?.candidate_count||0),judgeCount:Number(countMap.get(g.id)?.judge_count||0),verifiedCount:Number(countMap.get(g.id)?.verified_count||0),criteria:g.criteria,passScore:g.pass_score,openMode:g.open_mode,isOpen:g.is_open,startTime:g.extra_data?.startTime||g.open_at,endTime:g.extra_data?.endTime||g.close_at,attendanceEnabled:g.extra_data?.attendanceEnabled===true,extraFields:g.extra_data?.extraFields||[],sessionPolicy:g.extra_data?.gsCasting||null,roleLimits:g.extra_data?.gsRoleLimits||null,version:g.updated_at})),
   graders:graders.map(g=>({id:g.id,name:g.name,code:g.code,status:g.extra_data?.oscArchivedAt?"Inactive":g.status,archived:!!g.extra_data?.oscArchivedAt,
    email:map.get(g.id)?.email||"",emailLocked:locked.has(g.id),googleEnabled:map.get(g.id)?.enabled===true,
    assignedGroups:byGrader.get(g.id)||[]}))};
 }
 if(action==="casting-save"){
  const row={term:validTerm(b.term),name:safe(b.name,140),status:"draft",
    aggregate_method:["mean","weighted","trimmed"].includes(b.method)?b.method:"mean",
    pass_score:Number(b.passScore??5)};
  if(row.name.length<2||!Number.isFinite(row.pass_score)||row.pass_score<0||row.pass_score>10)err("Tên hoặc điểm đạt không hợp lệ.");
  if(b.weights&&typeof b.weights==="object"&&!Array.isArray(b.weights)){
   const weights=Object.entries(b.weights);if(weights.length>100)err("Quá nhiều trọng số.");
   if(weights.some(([k,v])=>!/^[A-Z0-9_-]{3,20}$/.test(k)||!Number.isFinite(Number(v))||Number(v)<=0||Number(v)>100))err("Trọng số BGK không hợp lệ.");
   row.grader_weights=Object.fromEntries(weights);
  }
  if(b.id){
   const previous=await byId(db,"gs_castings",b.id);
   if(previous.status==="published"||previous.status==="archived")err("Không được sửa quy chế casting đã công bố.");
   const previousReview=check(await db.from("gs_casting_decisions").select("candidate_id")
     .eq("casting_id",previous.id).limit(1));
   if(previousReview?.length)err("Đã có kết quả BCN duyệt. Không thể sửa quy chế sau khi duyệt; cần quy trình phiên bản mới.");
   const data=check(await db.from("gs_castings").update({...row,status:previous.status,updated_at:new Date().toISOString()}).eq("id",b.id).select("*").single());
   return{ok:true,casting:data};
  }
  const data=check(await db.from("gs_castings").insert(row).select("*").single());
  return{ok:true,casting:data};
 }
 if(action==="casting-create-session"||action==="casting-update-session"){
  const editing=action==="casting-update-session";
  const term=editing?null:validTerm(b.term),division=safe(b.division,70).toUpperCase();
  if(!editing&&!/^[\p{L}\p{N} _&./-]{2,70}$/u.test(division))err("Phân ban phải gồm 2–70 ký tự chữ, số hoặc dấu cách/gạch nối.");
  const groupName=editing?safe(b.name,120):term+"_"+division.replace(/\s+/g," ");
  if(groupName.length<2)err("Tên phiên cần ít nhất 2 ký tự.");
  const score=Number(b.passScore??5);
  if(!Number.isFinite(score)||score<0||score>10)err("Điểm đạt phải từ 0 đến 10.");
  const raw=Array.isArray(b.criteria)?b.criteria:[
   {name:"ĐÀI TỪ TIẾNG NÓI SÂN KHẤU",weight:30},
   {name:"NĂNG KHIẾU DIỄN XUẤT",weight:30},
   {name:"ỨNG BIẾN",weight:30},{name:"VẤN ĐÁP",weight:10}
  ];
  if(!raw.length||raw.length>20)err("Cần có từ 1 đến 20 tiêu chí chấm.");
  const criteria=raw.map(c=>({name:safe(c?.name,100),weight:Number(c?.weight)}));
  if(criteria.some(c=>!c.name||!Number.isFinite(c.weight)||c.weight<0||c.weight>100)||
   new Set(criteria.map(c=>c.name.toLowerCase())).size!==criteria.length||
   Math.abs(criteria.reduce((a,c)=>a+c.weight,0)-100)>0.01)
    err("Các tiêu chí phải khác tên và tổng trọng số phải bằng 100%.");
  // Cấu hình nhóm cũ được lưu kèm trong extra_data, không thay đổi cấu trúc bảng điểm.
  const mode=b.openMode==="auto"?"auto":"manual";
  const parseTime=(value)=>{
   if(value===null||value===undefined||value==="")return null;
   if(typeof value!=="string"||value.length>40||!Number.isFinite(Date.parse(value)))
    err("Ngày giờ mở hoặc khóa không hợp lệ.");
   return new Date(value).toISOString();
  };
  const start=parseTime(b.startAt),end=parseTime(b.endAt),sessionAt=parseTime(b.sessionAt);
  if(!sessionAt||typeof b.sessionAt!=="string"||!/(Z|[+-]\d{2}:\d{2})$/.test(b.sessionAt))err("Ngày giờ chấm bắt buộc và phải có múi giờ.");
  if(mode==="auto"&&(!start||!end))err("Nhóm tự động cần giờ mở và giờ khóa.");
  if(start&&end&&new Date(start)>=new Date(end))err("Giờ khóa phải sau giờ mở.");
  const extraFields=Array.isArray(b.extraFields)?b.extraFields:[];
  if(extraFields.length>20)err("Tối đa 20 trường phụ.");
  const extra=extraFields.map(x=>({name:safe(x?.name,80),showToGrader:x?.showToGrader===true}));
  if(extra.some(x=>!x.name)||new Set(extra.map(x=>x.name.toLowerCase())).size!==extra.length)
   err("Trường phụ trống hoặc bị trùng.");
  const sessionPolicy=b.sessionPolicy===undefined?undefined:normalizeSessionPolicy(b.sessionPolicy);
  const roleLimits=b.roleLimits===undefined?undefined:validateRoleLimits(b.roleLimits,sessionPolicy?.roles||[]);
  if(editing){
   const previous=await byId(db,"competition_groups",b.groupId);
   if(previous.updated_at!==(b.version??null))err("Phiên vừa thay đổi. Hãy mở lại để chỉnh sửa.");
   const unchanged=JSON.stringify((previous.criteria||[]).map(c=>[c.name,Number(c.weight)]))===
    JSON.stringify(criteria.map(c=>[c.name,c.weight]));
   const scheduleChanged=previous.open_mode!==mode||
    Date.parse(previous.open_at||0)!==Date.parse((mode==="auto"?start:null)||0)||
    Date.parse(previous.close_at||0)!==Date.parse(end||0);
   const patch={name:groupName,pass_score:score,open_mode:mode,open_at:mode==="auto"?start:null,
    close_at:end,updated_at:new Date().toISOString(),
    extra_data:{...previous.extra_data,extraFields:extra,attendanceEnabled:b.attendanceEnabled===true,blockGraderAfterPublish:true,
     startTime:start,endTime:end,sessionAt,...(sessionPolicy===undefined?{}:{gsCasting:sessionPolicy}),...(roleLimits===undefined?{}:{gsRoleLimits:roleLimits})}};
   if(!unchanged)patch.criteria=criteria;
   if(scheduleChanged&&mode==="auto"){
    patch.is_open=false;patch.extra_data.isManuallyOpened=false;
   }
   if(scheduleChanged&&previous.extra_data?.visibilityExplicitlySet!==true){
    patch.extra_data.publishAt=mode==="auto"?start:null;
    patch.extra_data.publishUntil=end;
   }
   const changed=await db.rpc("osc_revise_session",{p_group:previous.id,p_version:b.version??null,p_patch:patch,p_actor:by,p_confirm:b.confirmRevision===true});
   if(changed.error){
    const messages={GS_SESSION_CHANGED:"Phiên vừa thay đổi. Hãy tải lại.",GS_SESSION_FINAL:"Phiên đã công bố, không thể chỉnh sửa.",GS_REVISION_CONFIRM_REQUIRED:"Cần xác nhận tạo phiên bản điểm mới.",GS_SYNCED_DECISIONS:"Kết quả đã đồng bộ thành viên OSC; không thể sửa khi chưa xử lý liên kết.",GS_ASSIGNED_CRITERION_REMOVED:"Không thể xóa tiêu chí đã phân quyền cụ thể khi có lịch sử chấm.",GS_CRITERION_NO_GRADER:"Tiêu chí mới chưa có BGK đủ quyền.",GS_ROLE_CONFIG_HISTORY:"Không đổi cấu hình vai/ghi chú đã có dữ liệu chấm.",GS_ATTENDANCE_CONFIG_LOCKED:"Không đổi chế độ điểm danh sau khi có dữ liệu chấm.",GS_MAIL_IN_PROGRESS:"Email biên bản đang gửi, vui lòng thử lại."};
    const code=Object.keys(messages).find(k=>String(changed.error.message||"").includes(k));err(messages[code]||"Không lưu được cấu hình phiên ("+(changed.error.code||"server")+").");
   }
   const data=changed.data;if(!data?.ok)err("Máy chủ chưa xác nhận thay đổi.");
   const jobs=data.jobIds||[],mail=[];for(const id of jobs.slice(0,2)){try{mail.push(await deliverReceiptJob(db,id))}catch(e){mail.push({mailAccepted:false})}}
   return{...data,mailPending:jobs.length-mail.filter(x=>x.mailAccepted).length};
  }
  let casting,created=false;
  if(b.castingId){
   casting=await byId(db,"gs_castings",b.castingId);
   if(casting.term!==term)err("Không thể gắn phiên chấm vào casting khác học kỳ.");
   if(["published","archived"].includes(casting.status))err("Casting đã công bố, không được thêm phiên.");
  }else{
   const title=safe(b.castingName,140)||"Casting "+term+" · "+division;
   if(title.length<2)err("Tên casting quá ngắn.");
   casting=check(await db.from("gs_castings").insert({
    term,name:title,status:"draft",aggregate_method:"mean",pass_score:score
   }).select("*").single());
   created=true;
  }
  try{
   const duplicates=check(await db.from("competition_groups").select("id")
    .eq("casting_id",casting.id).eq("name",groupName).limit(1));
   if(duplicates.length)err("Phân ban này đã có một phiên chấm trong casting. Hãy nhập tên phân ban khác.");
   const group=check(await db.from("competition_groups").insert({
    name:groupName,casting_id:casting.id,criteria,pass_score:score,
    is_open:false,open_mode:mode,open_at:mode==="auto"?start:null,close_at:end,
    extra_data:{extraFields:extra,attendanceEnabled:b.attendanceEnabled===true,blockGraderAfterPublish:true,
     startTime:start,endTime:end,sessionAt,isManuallyOpened:false,visibleToGraders:true,
     publishEnabled:true,visibilityExplicitlySet:false,isPublished:false,...(sessionPolicy===undefined?{}:{gsCasting:sessionPolicy}),...(roleLimits===undefined?{}:{gsRoleLimits:roleLimits})}
   }).select("id,name,criteria,pass_score,is_open,casting_id").single());
   return{ok:true,casting,group};
  }catch(e){
   if(created)await db.from("gs_castings").delete().eq("id",casting.id);
   throw e;
  }
 }

 if(action==="casting-session-assignments"){
  const gid=uid(b.groupId),judges=Array.isArray(b.judges)?b.judges:null;
  if(!judges||judges.length>30||judges.some(j=>!UUID.test(String(j?.graderId||""))||!Array.isArray(j.criteria)||j.criteria.length<1||j.criteria.length>20||j.criteria.some(n=>typeof n!=="string"||n.length>100)))err("Danh sách BGK hoặc tiêu chí không hợp lệ.");
  const group=await byId(db,"competition_groups",gid),mode=String(b.inviteTiming||"now"),minutes={m30:30,h1:60,h3:180,d1:1440};
  if(mode!=="now"&&!Object.hasOwn(minutes,mode))err("Thời điểm gửi email không hợp lệ.");
  let sendAt=new Date();if(mode!=="now"){const at=Date.parse(group.extra_data?.sessionAt||"");if(!Number.isFinite(at))err("Hãy lưu ngày giờ chấm trước khi hẹn gửi.");sendAt=new Date(at-minutes[mode]*60000);if(sendAt.getTime()<=Date.now())err("Mốc gửi đã qua. Hãy chọn gửi ngay.");}
  if(sendAt.getTime()>Date.now()+29*86400000)err("Lịch gửi tối đa 29 ngày tới.");
  let saved=await db.rpc("osc_save_session_assignments",{p_group:gid,p_judges:judges,p_send_at:sendAt.toISOString(),p_actor:by});
  if(saved.error?.message?.includes("GS_INVITE_SCHEDULED")){
   await cancelRemovedInvites(db,gid,judges.map(j=>j.graderId));
   saved=await db.rpc("osc_save_session_assignments",{p_group:gid,p_judges:judges,p_send_at:sendAt.toISOString(),p_actor:by});
  }
  if(saved.error){const messages={GS_QUORUM_ROSTER_LOCKED:"Phiên đã có lịch sử điểm hoặc duyệt, không đổi hội đồng/tiêu chí.",GS_SESSION_FINAL:"Phiên đã công bố.",GS_GRADER_NOT_FOUND:"BGK chưa có email Google hoạt động.",GS_INVALID_CRITERIA:"Chọn tiêu chí hợp lệ cho từng BGK.",GS_INVITE_SCHEDULED:"Chưa hủy được lịch mời BGK."};const code=Object.keys(messages).find(k=>String(saved.error.message||"").includes(k));err(messages[code]||"Không lưu được phân công ("+(saved.error.code||"server")+").");}
  const jobIds=saved.data?.jobIds||[];const mail=jobIds.length?await retryInviteJobs(db,gid,jobIds):[];
  return {ok:true,assigned:judges.length,inviteJobs:jobIds.length,accepted:mail.filter(x=>x.status==="accepted").length,mailPending:jobIds.length-mail.filter(x=>x.status==="accepted").length};
 }
 if(action==="casting-session-invite-retry"){
  const gid=uid(b.groupId);await byId(db,"competition_groups",gid);
  const jobs=await retryInviteJobs(db,gid);
  return {ok:true,accepted:jobs.filter(j=>j.status==="accepted").length,processed:jobs.length};
 }
 if(action==="casting-cancel-review"){
  const ids=Array.isArray(b.candidateIds)?[...new Set(b.candidateIds)]:[];
  if(b.confirm!==true||!ids.length||ids.length>40||ids.some(x=>!UUID.test(x)))err("Chọn tối đa 40 hồ sơ và xác nhận hủy duyệt.");
  const result=await db.rpc("osc_cancel_review",{p_casting:uid(b.castingId),p_candidates:ids,p_actor:by});
  if(result.error){if(String(result.error.message).includes("GS_SESSION_FINAL"))err("Không hủy kết quả đã công bố.");err("Chỉ hủy hồ sơ đã duyệt, chưa công bố và chưa đồng bộ OSC.");}
  return {ok:true,cancelled:result.data};
 }
 if(action==="casting-assign-group"){
  const casting=await byId(db,"gs_castings",b.castingId);const group=await byId(db,"competition_groups",b.groupId);
  if(casting.status==="published"||casting.status==="archived")err("Casting đã công bố hoặc kết thúc.");
  if(group.casting_id&&group.casting_id!==casting.id)err("Nhóm thi đã thuộc casting khác, không thể tự chuyển học kỳ.");
  check(await db.from("competition_groups").update({casting_id:casting.id}).eq("id",group.id));
  return{ok:true};
 }
 if(action==="casting-grant-google"){
  const grader=await byId(db,"profiles",b.graderId);
  if(grader.role!=="Grader")err("Không thể cấp quyền Google cho tài khoản không phải BGK.");
  const email=String(b.email||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)err("Email Google không hợp lệ.");
  const existing=check(await db.from("gs_google_grader_access").select("profile_id,auth_user_id,email").eq("profile_id",grader.id).maybeSingle());
  if(existing?.auth_user_id&&existing.email!==email)err("BGK đã liên kết Google; cần thu hồi liên kết cũ trước khi thay email.");
  check(await db.from("gs_google_grader_access").upsert({profile_id:grader.id,email,enabled:b.enabled!==false}, {onConflict:"profile_id"}));
  return{ok:true};
 }
 if(action==="casting-grant-criteria")err("Chỉ cấp quyền tiêu chí trong thiết lập phiên chấm.");
 if(action==="casting-field"){
  const casting=await byId(db,"gs_castings",b.castingId);
  if(casting.status==="published"||casting.status==="archived")err("Không sửa trường dữ liệu đã công bố.");
  const key=String(b.key||"");if(!FIELD.test(key)||["__proto__","constructor","prototype"].includes(key))err("Mã trường không hợp lệ.");
  if(b.remove===true){check(await db.from("gs_candidate_fields").delete().eq("casting_id",casting.id).eq("field_key",key));return{ok:true}}
  const label=safe(b.label,100);
  if(!label||!["text","number","date","email","select"].includes(b.kind)||!["admin","judge","public"].includes(b.visibility))err("Cấu hình trường không hợp lệ.");
  const choices=Array.isArray(b.choices)?b.choices.map(x=>safe(x,100)).filter(Boolean).slice(0,30):[];
  check(await db.from("gs_candidate_fields").upsert({casting_id:casting.id,field_key:key,label,kind:b.kind,visibility:b.visibility,required:b.required===true,choices,sort_order:Number(b.sortOrder||0)}, {onConflict:"casting_id,field_key"}));
  return{ok:true};
 }
 if(action==="casting-add-members"){
  const casting=await byId(db,"gs_castings",b.castingId),
    group=await byId(db,"competition_groups",b.groupId);
  if(group.casting_id!==casting.id)err("Nhóm không thuộc casting đã chọn.");
  if(["published","archived"].includes(casting.status))err("Không thể nhập thí sinh sau công bố.");
  const members=Array.isArray(b.members)?b.members:[];
  if(!members.length||members.length>10)err("Mỗi lượt nhập tối đa 10 thành viên OSC.");
  const fields=await readAll(db,"gs_candidate_fields",{casting_id:casting.id},100);
  const unique=new Set(),created=[],skipped=[];
  for(const item of members){
   const mssv=String(item.mssv||"").trim().toUpperCase(),name=safe(item.name,120),
    email=String(item.email||"").trim().toLowerCase();
   if(!/^[A-Z0-9_-]{3,50}$/.test(mssv)||name.length<2||
      (email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)))
    err("Thông tin OSC không hợp lệ: MSSV, họ tên hoặc email.");
   if(unique.has(mssv))err("Danh sách có MSSV trùng.");unique.add(mssv);
   const exist=check(await db.from("gs_candidate_identity").select("candidate_id").eq("casting_id",casting.id)
     .eq("mssv",mssv).maybeSingle());
   if(exist){skipped.push(mssv);continue}
   const matches=check(await db.from("candidates").select("id").eq("group_id",group.id)
      .eq("code",mssv).limit(2));
   if(matches.length>1)err("MSSV trùng thí sinh: "+mssv);
   const custom={},privateFields={};
   const provided=item.fields&&typeof item.fields==="object"&&!Array.isArray(item.fields)?item.fields:{};
   for(const def of fields){
    if(!Object.prototype.hasOwnProperty.call(provided,def.field_key))continue;
    const value=safe(provided[def.field_key],300);
    if(def.visibility==="admin")privateFields[def.field_key]=value;
    else custom[def.field_key]=value;
   }
   const phone=safe(provided.phone??provided.sdt??provided.phoneNumber,50);
   if(phone){privateFields.phone=phone;delete custom.phone}
   let candidateId=matches[0]?.id||null,wasCreated=false;
   if(!candidateId){
    const row=check(await db.from("candidates").insert({
      group_id:group.id,code:mssv,name,custom_fields:custom,is_present:false
    }).select("id").single());
    candidateId=row.id;wasCreated=true;
   }
   try{
    check(await db.from("gs_candidate_identity").insert({
      candidate_id:candidateId,casting_id:casting.id,mssv,email:email||null,
      private_fields:privateFields,email_consent:false
    }));
    created.push({candidateId,mssv});
   }catch(e){
    if(wasCreated)await db.from("candidates").delete().eq("id",candidateId);
    throw e;
   }
  }
  return{ok:true,imported:created.length,skipped:skipped.length,rows:created,
    note:"Đã liên kết thí sinh OSC, chưa có điểm và chưa đồng bộ kết quả."};
 }
 if(action==="casting-grader-receipt"){
  const group=await byId(db,"competition_groups",b.groupId);
  const code=safe(b.graderCode,20).toUpperCase();
  if(!/^[A-Z0-9_-]{3,20}$/.test(code))err("Mã giám khảo không hợp lệ.");
  const graders=check(await db.from("profiles").select("id,name").eq("code",code).eq("role","Grader").limit(2));
  if(graders.length!==1)err("Không tìm thấy giám khảo.");
  const [row,grants]=await Promise.all([
   db.from("gs_grading_receipts").select("grader_name,verified_at,snapshot,snapshot_sha256,completeness,comparison_code")
    .eq("grader_id",graders[0].id).eq("group_id",group.id).maybeSingle(),
   db.from("gs_criterion_grants").select("criterion")
    .eq("grader_id",graders[0].id).eq("group_id",group.id)
  ]);
  const verified=check(row),allowed=check(grants);
  return{ok:true,allowedCriteria:allowed.map(x=>x.criterion),receipt:verified?{
   graderName:verified.grader_name,confirmedAt:verified.verified_at,sha256:verified.snapshot_sha256,comparisonCode:verified.comparison_code||null,
   completeness:verified.completeness,
   snapshot:Array.isArray(verified.snapshot)?verified.snapshot.map(item=>({
    proposedRoles:item.proposedRoles||[],note:item.note||"",
    candidateId:item.candidateId,scores:item.scores||{},
    total:item.total===null?null:item.total,revision:item.revision
   })):[]
  }:null};
 }
 if(action==="casting-receipt-list"){
  const group=await byId(db,"competition_groups",b.groupId);
  const [assigned,receipts,verifications,jobs,decisions,casting]=await Promise.all([readAll(db,"grader_assignments",{group_id:group.id},1000),db.from("gs_grading_receipts").select("grader_id,grader_name,verified_at,comparison_code").eq("group_id",group.id).limit(1000),db.from("grader_verifications").select("grader_id,is_verified,signed_at,grader_name,grader_code").eq("group_id",group.id).limit(1000),db.from("osc_receipt_mail_jobs").select("id,grader_id,kind,comparison_code,status,sent_at,created_at,pdf_sha256").eq("group_id",group.id).order("created_at",{ascending:false}).limit(1000),db.from("gs_casting_decisions").select("candidate_id,review_status,synced_at,candidates!inner(group_id)").eq("candidates.group_id",group.id).or("review_status.neq.pending,synced_at.not.is.null").limit(1),group.casting_id?db.from("gs_castings").select("status").eq("id",group.casting_id).maybeSingle():Promise.resolve({data:null,error:null})]);
  const rm=new Map((check(receipts)||[]).map(r=>[r.grader_id,r])),vm=new Map((check(verifications)||[]).map(r=>[r.grader_id,r]));
  const ids=[...new Set([...assigned.map(x=>x.grader_id),...rm.keys(),...vm.keys()])];
  const profiles=ids.length?check(await db.from("profiles").select("id,name,code").in("id",ids).limit(1000)):[];
  const pm=new Map(profiles.map(x=>[x.id,x])),mail=check(jobs),canReopen=!["approved","published","archived"].includes(check(casting)?.status)&&!check(decisions).length;
  return{ok:true,attendanceState:check(await db.rpc("osc_attendance_state",{p_group:group.id})),receipts:ids.map(id=>({graderId:id,graderName:rm.get(id)?.grader_name||vm.get(id)?.grader_name||pm.get(id)?.name||"BGK",graderCode:vm.get(id)?.grader_code||pm.get(id)?.code||"",confirmedAt:rm.get(id)?.verified_at||(vm.get(id)?.is_verified?vm.get(id)?.signed_at:null),confirmed:rm.has(id)||vm.get(id)?.is_verified===true,comparisonCode:rm.get(id)?.comparison_code||null,canReopen:canReopen&&!!rm.get(id)?.comparison_code,mailStatus:mail.find(j=>j.grader_id===id&&j.kind==="completion"&&j.comparison_code===rm.get(id)?.comparison_code)?.status||null,originalSha:mail.find(j=>j.grader_id===id&&j.kind==="completion"&&j.comparison_code===rm.get(id)?.comparison_code)?.pdf_sha256||null,history:mail.filter(j=>j.grader_id===id).map(j=>({id:j.id,kind:j.kind,code:j.comparison_code,status:j.status,createdAt:j.created_at,sentAt:j.sent_at}))}))};
 }
 if(action==="casting-candidate-roster"){
  if(b.groupId){
   // Only fetch the selected group's page and the identity records belonging
   // to those exact candidates; never scan all scores/terms in the sidebar.
   const group=await byId(db,"competition_groups",b.groupId);
   const casting=await byId(db,"gs_castings",group.casting_id);
   const offset=Number(b.offset||0),limit=Math.min(100,Math.max(10,Number(b.limit||60)));
   if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isSafeInteger(limit))
    err("Trang thí sinh không hợp lệ.");
   const query=await db.from("candidates").select("*",{count:"exact"})
    .eq("group_id",group.id).order("code").range(offset,offset+limit-1);
   const candidates=check(query)||[],ids=candidates.map(c=>c.id);
   const [identityQuery,fieldQuery,reviewQuery,lockQuery]=await Promise.all([
    ids.length?db.from("gs_candidate_identity").select("*").in("candidate_id",ids):
      Promise.resolve({data:[],error:null}),
    db.from("gs_candidate_fields").select("field_key,label,visibility,kind,choices,required")
     .eq("casting_id",casting.id).limit(100),
    ids.length?db.from("gs_casting_decisions").select("candidate_id,review_status,outcome")
     .eq("casting_id",casting.id).in("candidate_id",ids):
      Promise.resolve({data:[],error:null}),
    db.rpc("osc_candidate_roster_locked",{p_group:group.id})
   ]);
   const identities=new Map(check(identityQuery).map(row=>[row.candidate_id,row]));
   const decisions=new Map(check(reviewQuery).map(row=>[row.candidate_id,row]));
   const fields=check(fieldQuery),labels=new Map(fields.map(f=>[f.field_key,f.label]));
   const rows=candidates.map(c=>{
    const identity=identities.get(c.id),p=candidateProfile(c,identity),
     extra={...p.fields,...p.privateFields};
    const phone=String(extra.phone??extra.sdt??extra.phoneNumber??"");
    const extras=Object.entries(extra).filter(([k])=>!["mssv","email","phone","sdt","phoneNumber"].includes(k))
     .map(([k,value])=>({label:labels.get(k)||k,value}));
    return{id:c.id,code:c.code||"",name:c.name||"",mssv:p.mssv,email:p.email,
     phone,extras,fields:p.fields,privateFields:p.privateFields,registeredRoles:c.custom_fields?.gsRoleIds||[],
     groupId:group.id,groupName:group.name,castingId:casting.id,castingName:casting.name,
     term:casting.term,isPresent:c.is_present===true,emailConsent:identity?.email_consent===true,
     review:group.extra_data?.attendanceEnabled===true&&c.is_present!==true?"absent":decisions.get(c.id)?.review_status||"pending",
     outcome:group.extra_data?.attendanceEnabled===true&&c.is_present!==true?"absent":decisions.get(c.id)?.outcome||"pending",
     version:c.updated_at,identityVersion:identity?.updated_at||null,
     extraFieldNames:(group.extra_data?.extraFields||[]).map(f=>f.name)};
   });
   return{ok:true,rows,total:query.count??rows.length,offset,limit,
    group:{id:group.id,name:group.name,castingId:casting.id,castingName:casting.name,
     term:casting.term,status:casting.status,rosterLocked:check(lockQuery)===true,sessionPolicy:group.extra_data?.gsCasting||null},fields};
  }
  const [castings,groups,candidates,identities,definitions]=await Promise.all([
   readAll(db,"gs_castings",{},1000),
   readAll(db,"competition_groups",{},1000),
   readAll(db,"candidates",{},3000),
   readAll(db,"gs_candidate_identity",{},3000),
   readAll(db,"gs_candidate_fields",{},3000)
  ]);
  const terms=new Map(castings.map(c=>[c.id,c])),groupMap=new Map(groups.map(g=>[g.id,g]));
  const identityMap=new Map(identities.map(row=>[row.candidate_id,row]));
  const labels=new Map(definitions.map(field=>[field.casting_id+"|"+field.field_key,field.label]));
  const activeCandidates=candidates.filter(c=>groupMap.has(c.group_id));
  return{ok:true,total:activeCandidates.length,groups:groups.length,rows:activeCandidates.map(c=>{
   const group=groupMap.get(c.group_id)||{},casting=terms.get(group.casting_id)||{};
   const identity=identityMap.get(c.id);
   const profile=candidateProfile(c,identity);
   const fields={...profile.fields,...profile.privateFields};
   const phone=fields.phone??fields.sdt??fields.phoneNumber??fields["Số điện thoại"]??fields["Điện thoại"];
   const extras=Object.entries(fields)
    .filter(([key])=>!["mssv","email","phone","sdt","phoneNumber","Số điện thoại","Điện thoại","castingEmailConsent"].includes(key))
    .map(([key,value])=>({label:labels.get(group.casting_id+"|"+key)||key,value}));
   return{id:c.id,code:c.code||"",name:c.name||"",isPresent:c.is_present===true,
    mssv:profile.mssv,email:profile.email,phone:phone||"",extras,
    groupId:c.group_id,groupName:group.name||"Nhóm chưa xác định",
    extraFieldNames:(group.extra_data?.extraFields||[]).map(field=>field.name),
    castingId:group.casting_id||"",castingName:casting.name||"Chưa gắn casting",
    term:casting.term||"Chưa xác định"};
  }).sort((a,b)=>a.term.localeCompare(b.term)||a.groupName.localeCompare(b.groupName,"vi")||a.code.localeCompare(b.code,"vi"))};
 }
 if(action==="casting-candidate-list"){
  const casting=b.castingId?await byId(db,"gs_castings",b.castingId):null;
  const groupRows=b.groupId?[await byId(db,"competition_groups",b.groupId)]:
   casting?await readAll(db,"competition_groups",{casting_id:casting.id},1000):[];
  if(groupRows.some(group=>(group.casting_id||null)!==(casting?.id||null)))err("Nhóm không thuộc casting.");
  const ids=groupRows.map(g=>g.id);
  const [candidates,fields]=await Promise.all([
   ids.length?readAll(db,"candidates",{group_id:ids},3000):[],
   casting?readAll(db,"gs_candidate_fields",{casting_id:casting.id},1000):[]
  ]);
  const identities=[];
  for(let offset=0;offset<candidates.length;offset+=100){
   const ids=candidates.slice(offset,offset+100).map(c=>c.id);
   identities.push(...await readAll(db,"gs_candidate_identity",{candidate_id:ids},200));
  }
  const byIdentity=new Map(identities.map(i=>[i.candidate_id,i]));
  return{ok:true,casting:casting?{id:casting.id,term:casting.term,status:casting.status}:null,
   candidates:candidates.map(c=>({id:c.id,groupId:c.group_id,code:c.code,name:c.name,
      ...candidateProfile(c,byIdentity.get(c.id)),
      version:c.updated_at,identityVersion:byIdentity.get(c.id)?.updated_at||null,
      emailConsent:byIdentity.get(c.id)?.email_consent===true})),fields};
 }
 if(action==="casting-candidate-import"||action==="casting-candidate-delete"){
  if(!["admin","superadmin"].includes(actor.profile.role)||b.confirm!==true)err("Cần quyền Admin và xác nhận thao tác.");
  const group=await byId(db,"competition_groups",b.groupId),castingId=uid(b.castingId);
  if(group.casting_id!==castingId)err("Phiên không thuộc đợt tuyển.");
  const importing=action==="casting-candidate-import",raw=b.rows;
  if(!Array.isArray(raw)||!raw.length||raw.length>100)err("Chọn 1–100 hồ sơ mỗi lượt.");
  const defs=importing?await readAll(db,"gs_candidate_fields",{casting_id:castingId},100):[];
  const ready=[],failures=[],seen=new Set(),seenMssv=new Set();
  for(const row of raw){try{
   if(!row||typeof row!=="object"||Array.isArray(row))err("Dòng không hợp lệ.");
   if(importing){const prepared=prepareRosterImport(row,group,defs);if(seen.has(prepared.code)||prepared.mssv&&seenMssv.has(prepared.mssv))err("SBD hoặc MSSV trùng trong file.");seen.add(prepared.code);if(prepared.mssv)seenMssv.add(prepared.mssv);ready.push({...prepared,fillMissingRoles:b.fillMissingRoles===true});}
   else{const id=uid(row.id);if(seen.has(id)||!Number.isFinite(Date.parse(row.version))||row.identityVersion!==null&&!Number.isFinite(Date.parse(row.identityVersion)))err("Hồ sơ trùng hoặc phiên bản không hợp lệ.");seen.add(id);ready.push({id,code:safe(row.code,40),version:row.version,identityVersion:row.identityVersion});}
  }catch(e){failures.push({id:row?.id,code:safe(row?.code,40),reason:e.message});}}
  if(!ready.length)return{ok:true,updated:0,failures};
  const result=await db.rpc("osc_mutate_candidate_roster",{p_group:group.id,p_casting:castingId,p_version:group.updated_at,p_operation:importing?"import":"delete",p_rows:ready,p_actor:by});
  if(result.error)err(rosterMessage(result.error.message));
  return{ok:true,updated:result.data.updated||0,inserted:result.data.inserted||0,filled:result.data.filled||0,skipped:result.data.skipped||0,failures:[...failures,...(result.data.failures||[]).map(f=>({...f,reason:rosterMessage(f.reason)}))]};
 }
 if(action==="casting-candidate-add"){
  const casting=await byId(db,"gs_castings",b.castingId),
   group=await byId(db,"competition_groups",b.groupId);
  if(group.casting_id!==casting.id)err("Phiên chấm không thuộc đợt tuyển.");
  if(["published","archived"].includes(casting.status))
   err("Phiên đã công bố hoặc lưu trữ; không được thêm thí sinh.");
  const code=safe(b.code,40).toUpperCase(),name=safe(b.name,120),
   mssv=safe(b.mssv,50).toUpperCase(),email=String(b.email||"").trim().toLowerCase(),
   phone=safe(b.phone,40);
  if(!/^[A-Z0-9_-]{2,40}$/.test(code)||name.length<2||
   (mssv&&!/^[A-Z0-9_-]{3,50}$/.test(mssv))||
   (email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
   err("Họ tên, SBD, MSSV hoặc email không hợp lệ.");
  if(check(await db.from("candidates").select("id").eq("group_id",group.id).eq("code",code).limit(1)).length)
   err("Số báo danh đã tồn tại trong nhóm.");
  if(mssv&&check(await db.from("gs_candidate_identity").select("candidate_id")
   .eq("casting_id",casting.id).eq("mssv",mssv).limit(1)).length)
   err("MSSV đã tồn tại trong casting.");
  const fields=b.fields&&typeof b.fields==="object"&&!Array.isArray(b.fields)?b.fields:{};
  if(Object.keys(fields).length>40)err("Quá nhiều trường phụ.");
  const defs=await readAll(db,"gs_candidate_fields",{casting_id:casting.id},100);
  const allowed=new Map(defs.map(x=>[x.field_key,x])),custom={},privateFields={};
  if(phone)privateFields.phone=phone;
  for(const [key,value] of Object.entries(fields)){
   if(!FIELD.test(key)||!allowed.has(key))err("Trường dữ liệu không thuộc cấu hình: "+key);
   const def=allowed.get(key),val=safe(value,300);
   if(def.kind==="select"&&val&&Array.isArray(def.choices)&&def.choices.length&&!def.choices.includes(val))
    err("Giá trị chưa cấu hình: "+key);
   if(def.visibility==="admin")privateFields[key]=val;else custom[key]=val;
  }
  for(const def of defs){
   if(!def.required)continue;
   const v={name,mssv,email,phone,...privateFields,...custom}[def.field_key];
   if(!String(v??"").trim())err("Thiếu trường bắt buộc: "+def.label);
  }
  // Explicitly documented consent is required; never infer permission from email.
  const consent=b.emailConsent===true&&b.confirmConsent===true;
  if(group.extra_data?.gsCasting?.roles?.length)custom.gsRoleIds=registeredRoles(group.extra_data.gsCasting,b.registeredRoles??[]);
  else if(b.registeredRoles?.length)err("Phiên không casting theo vai.");
  const inserted=check(await db.from("candidates").insert({
   group_id:group.id,code,name,custom_fields:custom,is_present:false
  }).select("id").single());
  try{
   check(await db.from("gs_candidate_identity").insert({
    candidate_id:inserted.id,casting_id:casting.id,
    mssv:mssv||null,email:email||null,email_consent:consent,private_fields:privateFields
   }));
  }catch(e){
   await db.from("candidates").delete().eq("id",inserted.id);
   throw e;
  }
  return{ok:true,candidateId:inserted.id};
 }
 if(action==="casting-bulk-consent"){
  if(!["admin","superadmin"].includes(actor.profile.role))err("Không có quyền cập nhật đồng ý email.");
  const ids=Array.isArray(b.candidateIds)?[...new Set(b.candidateIds.map(uid))]:[];
  if(!ids.length||ids.length>100||typeof b.consent!=="boolean"||b.confirm!==true)err("Hãy xác nhận danh sách thí sinh và sự đồng ý.");
  return check(await db.rpc("osc_bulk_email_consent",{p_group:uid(b.groupId),p_ids:ids,p_consent:b.consent,p_actor:by}));
 }
 if(action==="casting-candidate-edit"){
  const candidate=await byId(db,"candidates",b.candidateId);
  const group=await byId(db,"competition_groups",candidate.group_id);
  const casting=group.casting_id?await byId(db,"gs_castings",group.casting_id):null;
  if((casting?.id||null)!==(b.castingId||null))err("Thí sinh không thuộc casting đã chọn.");
  if(["published","archived"].includes(casting?.status))err("Không sửa thí sinh khi kết quả đã công bố.");
  const custom=b.fields;
  if(!custom||typeof custom!=="object"||Array.isArray(custom))err("Thông tin thí sinh không hợp lệ.");
  const defs=casting?await readAll(db,"gs_candidate_fields",{casting_id:casting.id},1000):[];
  const allowed=new Map(defs.map(f=>[f.field_key,f]));
  const existingIdentity=check(await db.from("gs_candidate_identity").select("*").eq("candidate_id",candidate.id).maybeSingle());
  if(candidate.updated_at!==(b.version??null)||(existingIdentity?.updated_at||null)!==(b.identityVersion??null))
   err("Hồ sơ vừa thay đổi. Hãy mở lại để chỉnh sửa.");
  const patch={...(candidate.custom_fields||{})},privateFields={...(existingIdentity?.private_fields||{})};
  let mssv=existingIdentity?.mssv||patch.mssv||"",email=existingIdentity?.email||patch.email||null;
  let consent=existingIdentity?.email_consent===true;
  delete patch.mssv;delete patch.email;delete patch.castingEmailConsent;
  const name=safe(b.name,120);
  if(name.length<2)err("Họ tên cần ít nhất 2 ký tự.");
  const fields=Object.entries(custom);if(fields.length>70)err("Quá nhiều trường thông tin.");
  for(const [key,value] of fields){
   const legacy=(group.extra_data?.extraFields||[]).some(field=>field.name===key)||
    Object.hasOwn(candidate.extra_data?.extraData||{},key)||Object.hasOwn(patch,key)||Object.hasOwn(privateFields,key);
   if(["__proto__","constructor","prototype"].includes(key)|| key.length>100||
    !["mssv","email","phone","castingEmailConsent"].includes(key)&&!allowed.has(key)&&!legacy)
    err("Trường không có trong cấu hình: "+key);
   if(key==="castingEmailConsent"){if(typeof value!=="boolean")err("Đồng ý email phải là true/false.");consent=value;continue}
   if(key==="gsRoleIds")err("Hãy chỉnh vai diễn qua trường đăng ký riêng.");
   const str=String(value??"").normalize("NFC").trim().slice(0,300);
   if(key==="mssv"&&str&&!/^[A-Z0-9_-]{3,50}$/.test(str.toUpperCase()))err("MSSV không hợp lệ.");
   if(key==="email"&&str&&(str.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)))err("Email không hợp lệ.");
   const config=allowed.get(key);
   if(config?.kind==="number"&&str&&!Number.isFinite(Number(str)))err("Trường số không hợp lệ.");
   if(config?.kind==="date"&&str&&!/^\d{4}-\d{2}-\d{2}$/.test(str))err("Ngày tháng không hợp lệ.");
   if(config?.kind==="select"&&str&&Array.isArray(config.choices)&&config.choices.length&&!config.choices.includes(str))err("Giá trị chưa được cấu hình.");
   if(key==="mssv")mssv=str.toUpperCase();
   else if(key==="email")email=str.toLowerCase()||null;
   else if(key==="phone"){privateFields.phone=str;delete patch.phone}
   else if(config?.visibility==="admin"||(!config&&Object.hasOwn(privateFields,key))){privateFields[key]=str;delete patch[key]}
   else {patch[key]=str;delete privateFields[key]}
  }
  for(const def of defs)if(def.required&&String(({mssv,email,phone:privateFields.phone})[def.field_key]??(def.visibility==="admin"?privateFields:patch)[def.field_key]??"").trim()==="")err("Thiếu trường bắt buộc: "+def.label);
  if(b.registeredRoles!==undefined){
   if(group.extra_data?.gsCasting?.roles?.length)patch.gsRoleIds=registeredRoles(group.extra_data.gsCasting,b.registeredRoles);
   else if(b.registeredRoles?.length)err("Phiên không casting theo vai.");
  }
  const write=await db.rpc("osc_update_candidate_profile",{
   p_candidate:candidate.id,p_group:group.id,p_casting:casting?.id||null,
   p_updated:candidate.updated_at,p_identity_updated:existingIdentity?.updated_at||null,
   p_name:name,p_fields:patch,p_mssv:mssv||null,p_email:email,p_consent:consent,p_private:privateFields
  });
  if(write.error?.code==="23505")err("MSSV đã được dùng trong casting này.");
  if(write.error?.message?.includes("GS_CANDIDATE_CHANGED"))err("Hồ sơ vừa thay đổi. Hãy mở lại để chỉnh sửa.");
  if(write.error?.message?.includes("GS_CANDIDATE_PUBLISHED"))err("Kết quả đã công bố.");
  if(write.error?.message?.includes("GS_CANDIDATE_SYNCED"))err("Hồ sơ đã đồng bộ OSC. Cần đối soát trước khi đổi MSSV.");
  check(write);
  return{ok:true,id:candidate.id};
 }
 if(action==="casting-results"){if(b.emailResults===true){if(!["admin","superadmin"].includes(actor.profile.role))err("Không có quyền xem email kết quả.");return{ok:true,...await emailResults(db,b.castingId,b.groupId||null)}}return{ok:true,...await results(db,b.castingId)};}
 if(action==="casting-review"){
  const info=await results(db,b.castingId),decisions=Array.isArray(b.decisions)?b.decisions:[];
  if(info.casting.status==="published"||info.casting.status==="archived")err("Không thay đổi kết quả đã công bố.");
  if(!decisions.length||decisions.length>40)err("Mỗi lần duyệt tối đa 40 thí sinh.");
  const map=new Map(info.rows.map(x=>[x.id,x]));
  const failures=[],updated=[];const seen=new Set();
  for(const d of decisions){try{
   if(seen.has(d.candidateId))err("Hồ sơ được chọn trùng.");seen.add(d.candidateId);
   const s=map.get(d.candidateId);
   if(!s||s.publicationAt||s.scoreOutcome==="pending"||s.incomplete)err("Chỉ duyệt thí sinh có mặt, đủ bảng điểm khóa và chưa công bố.");
   if(!["approved","rejected","pending"].includes(d.review))err("Trạng thái duyệt không hợp lệ.");
   if(s.syncState==="synced"&&d.review!=="approved")err("Thí sinh đã đồng bộ OSC; không thể hủy duyệt mà chưa xử lý liên kết diễn viên.");
   const assigned=s.roleOptions.length?officialRoles({roles:s.roleOptions},d.assignedRoles):[];
   const effectiveScore=s.review==="approved"?s.score:s.liveScore;
   const effectiveScoreOutcome=effectiveScore>=Number(scoringPolicy(info.groups.find(g=>g.id===s.groupId),info.casting).pass_score)?"passed":"failed";
   const outcome=finalOutcome(s.review==="approved"?effectiveScoreOutcome:s.scoreOutcome,{roles:s.roleOptions},assigned);
   if(s.syncState==="synced"&&(outcome!=="passed"||JSON.stringify([...assigned].sort())!==JSON.stringify([...s.assignedRoles].sort())))err("Hồ sơ đã đồng bộ OSC; không thể thay đổi vai hoặc kết quả.");
   const row={casting_id:info.casting.id,candidate_id:s.id,outcome,score:effectiveScore,assigned_roles:assigned,
    review_status:d.review,reviewed_by:by,reviewed_at:new Date().toISOString()};
   const result=await db.from("gs_casting_decisions").upsert(row,{onConflict:"casting_id,candidate_id"});
   if(result.error){const m=String(result.error.message||"");const known={GS_ROLE_CAPACITY:"Vai diễn đã đủ số lượng.",GS_OFFICIAL_ROLE_LIMIT:"Vượt số vai chính thức tối đa.",GS_MAJORITY_REQUIRED:"Chưa đủ từ 50% BGK hợp lệ hoặc thiếu tiêu chí.",GS_ROLE_REQUIRES_PASS:"Chỉ phân vai cho thí sinh đạt điểm.",GS_CANDIDATE_ABSENT:"Thí sinh vắng mặt không thuộc diện xét duyệt."};const key=Object.keys(known).find(k=>m.includes(k));if(key)err(known[key]);check(result);}
   updated.push(row);
  }catch(e){failures.push({candidateId:d.candidateId,reason:e.message||"Không thể duyệt."});}}
  if(updated.length&&info.casting.status==="draft")check(await db.from("gs_castings").update({status:"review"}).eq("id",info.casting.id));
  return{ok:true,updated:updated.length,failures};
 }
 if(action==="casting-publish"){
  const c=await byId(db,"gs_castings",b.castingId);
  if(["published","archived"].includes(c.status))err("Phiên chấm đã hoàn tất.");
  const current=await results(db,c.id);
  if(!current.rows.some(x=>x.review==="approved"&&!x.incomplete))err("Chưa có kết quả được BCN duyệt để công bố.");
  if(current.rows.some(x=>x.incomplete||x.review!=="approved"))err("Còn thí sinh có mặt chưa đủ từ 50% BGK hoặc chưa được BCN duyệt.");
  const used=new Map();for(const row of current.rows.filter(x=>x.review==="approved")){if(row.assignedRoles.length>row.maxOfficialRoles)err("Vượt số vai chính thức của "+row.name);for(const role of row.assignedRoles){const key=row.groupId+"|"+role;const n=(used.get(key)||0)+1;used.set(key,n);if(n>Number(Object.hasOwn(row.roleCapacity,role)?row.roleCapacity[role]:1))err("Vượt số lượng vai "+role);}}
  const dt=b.publishAt?new Date(b.publishAt):new Date();
  if(Number.isNaN(dt.getTime()))err("Thời điểm công bố không hợp lệ.");
  if(b.publicFields&&(!Array.isArray(b.publicFields)||b.publicFields.length>20))err("Danh sách trường công khai không hợp lệ.");
  const safeFields=new Set(["code","name","score","outcome"]),allowed=["code","name","outcome"];
  for(const v of b.publicFields||[])if(safeFields.has(v))allowed.push(v);
  check(await db.from("gs_castings").update({status:"published",publish_at:dt.toISOString(),public_fields:[...new Set(allowed)],updated_at:new Date().toISOString()}).eq("id",c.id));
  return{ok:true,publishAt:dt.toISOString()};
 }
 if(action==="casting-sync-payload"){
  const result=await results(db,b.castingId);
  if(!["review","approved","published"].includes(result.casting.status))err("Chưa phê duyệt casting.");
  const items=result.rows.filter(x=>x.outcome==="passed"&&x.review==="approved"&&x.syncState!=="synced").slice(0,20);
  if(items.some(x=>!x.mssv||x.mssv.length<3||x.mssv.length>50||!/^[A-Z0-9_-]+$/.test(x.mssv)))err("Một số thí sinh chưa có MSSV hợp lệ.");
  return{ok:true,term:result.casting.term,castingId:result.casting.id,
   candidates:items.map(x=>({id:x.id,mssv:x.mssv,name:x.name,email:x.email}))};
 }
 if(action==="casting-sync-complete"){
  const info=await results(db,b.castingId),items=Array.isArray(b.items)?b.items:[];
  if(!items.length||items.length>20)err("Chỉ xác nhận tối đa 20 hồ sơ một lượt.");
  const byCandidate=new Map(info.rows.map(x=>[x.id,x]));
  for(const item of items){
   const row=byCandidate.get(item.candidateId),memberId=String(item.memberId||"");
   if(!row||row.outcome!=="passed"||row.review!=="approved"||!row.mssv||
    !/^[A-Za-z0-9_-]{4,180}$/.test(memberId))err("Không thể đánh dấu đồng bộ hồ sơ không hợp lệ.");
  }
  for(const item of items)check(await db.from("gs_casting_decisions")
   .update({synced_at:new Date().toISOString(),member_id:item.memberId})
   .eq("casting_id",info.casting.id).eq("candidate_id",item.candidateId).eq("review_status","approved"));
  return{ok:true,synced:items.length};
 }
 if(action==="casting-notice-history"){
  const c=await byId(db,"gs_castings",b.castingId);
  const offset=Number(b.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)err("Trang lịch sử không hợp lệ.");
  const rows=check(await db.from("gs_casting_notifications").select("id,event_type,recipient_email,status,created_at,sent_at")
   .eq("casting_id",c.id).order("created_at",{ascending:false}).order("id").range(offset,offset+50));
  return{ok:true,rows:rows.slice(0,50),hasMore:rows.length>50};
 }
 if(action==="casting-notice-retry"){
  const c=await byId(db,"gs_castings",b.castingId);
  const notice=check(await db.from("gs_casting_notifications").select("id,event_type,recipient_email,status")
   .eq("id",uid(b.noticeId)).eq("casting_id",c.id).single());
  if(notice.status==="queued")err("Email đã nằm trong hàng đợi.");
  return handleCastingAction("casting-notification-queue",{
   castingId:c.id,kind:notice.event_type,emails:[notice.recipient_email]
  },actor);
 }
 if(action==="casting-notice-batch"){
  const c=await byId(db,"gs_castings",b.castingId);
  const rows=check(await db.from("gs_casting_notifications")
    .select("id,event_type,recipient_email").eq("casting_id",c.id).eq("status","queued")
    .order("created_at",{ascending:true}).order("id").limit(20));
  return{ok:true,castingName:c.name,term:c.term,notifications:rows};
 }
 if(action==="casting-notice-ack"){
  const c=await byId(db,"gs_castings",b.castingId),items=Array.isArray(b.items)?b.items:[];
  if(!items.length||items.length>20||items.some(x=>!UUID.test(x.id)||!["sent","failed"].includes(x.status)))
   err("Dữ liệu thông báo không hợp lệ.");
  for(const item of items)check(await db.from("gs_casting_notifications").update({
    status:item.status,sent_at:item.status==="sent"?new Date().toISOString():null,
    last_error:item.status==="failed"?"Resend rejected":null
  }).eq("id",item.id).eq("casting_id",c.id).eq("status","queued"));
  return{ok:true,updated:items.length};
 }
 if(action==="casting-notification-queue"){
  const c=await byId(db,"gs_castings",b.castingId);
  let recipients=Array.isArray(b.emails)?[...new Set(b.emails.map(x=>String(x).trim().toLowerCase()))]:[];
  const kind=String(b.kind||"");
  if(!["invite","reminder","submission","publication"].includes(kind)||(!recipients.length&&b.allEligible!==true)||recipients.length>40||
    recipients.some(e=>e.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
    err("Danh sách người nhận không hợp lệ.");
  let eligible;
  if(kind==="publication"){
   if(c.status!=="published"||!c.publish_at||Date.parse(c.publish_at)>Date.now())err("Chưa đến thời điểm công bố.");
   const r=await results(db,c.id);
   eligible=new Set(r.rows.filter(x=>(!b.groupId||x.groupId===b.groupId)&&x.review==="approved"&&x.outcome!=="pending"&&x.emailConsent===true)
    .map(x=>x.email.trim().toLowerCase()).filter(Boolean));
  }else{
   const linked=(await readAll(db,"competition_groups",{casting_id:c.id},1000)).map(x=>x.id);
   if(!linked.length)err("Casting chưa gắn nhóm chấm.");
   const assigned=await readAll(db,"grader_assignments",{group_id:linked},1500);
   const access=await readAll(db,"gs_google_grader_access",{enabled:true},1000);
   const invited=new Set(assigned.map(x=>x.grader_id));
   eligible=new Set(access.filter(a=>invited.has(a.profile_id)).map(a=>a.email));
  }
  if(b.allEligible===true&&recipients.length===0)recipients=[...eligible];
  if(recipients.some(email=>!eligible.has(email)))err("Có email chưa được cấp quyền hoặc chưa đồng ý nhận thông báo.");
  if(!recipients.length)return{ok:true,queued:0};
  const queued=check(await db.rpc("osc_queue_casting_notices",{
   p_casting:c.id,p_kind:kind,p_recipients:recipients,p_new_only:b.allEligible===true
  }));
  return{ok:true,queued};

 }
 err("Tác vụ không được hỗ trợ.");
}
export {CAST_ACTIONS,handleCastingAction,scoreAggregate};
