import {createClient} from "@supabase/supabase-js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERM=/^(FA|SU|SP)[0-9]{2}$/;
const FIELD=/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/;
const CAST_ACTIONS=new Set(["casting-list","casting-save","casting-assign-group","casting-grant-google","casting-grant-criteria","casting-field","casting-candidate-list","casting-candidate-edit","casting-results","casting-review","casting-publish","casting-sync-payload","casting-sync-complete","casting-notification-queue","casting-notice-batch","casting-notice-ack"]);
const client=()=>createClient(process.env.SUPABASE_URL||"https://nkpfzjhqtdjcfypkishv.supabase.co",process.env.SUPABASE_SECRET_KEY||"",{auth:{persistSession:false,autoRefreshToken:false}});
function err(message){throw Error(message)}
function safe(v,max=120){return String(v??"").trim().replace(/\s+/g," ").slice(0,max)}
function uid(v){if(typeof v!=="string"||!UUID.test(v))err("ID không hợp lệ.");return v}
function validTerm(v){const term=String(v||"").toUpperCase();if(!TERM.test(term))err("Học kỳ phải theo mẫu FA26, SU26 hoặc SP26.");return term}
function check(result){if(result.error)err("Không thể truy cập dữ liệu casting ("+(result.error.code||"server")+").");return result.data}
async function byId(db,table,id){return check(await db.from(table).select("*").eq("id",uid(id)).single())}
async function readAll(db,table,where,max=1500){
 const out=[];
 for(let off=0;off<max;off+=200){
  let q=db.from(table).select("*").range(off,off+199);
  for(const [k,v] of Object.entries(where||{}))q=Array.isArray(v)?q.in(k,v):q.eq(k,v);
  const data=check(await q);
  out.push(...(data||[]));if(!data||data.length<200)return out;
 }
 err("Dữ liệu vượt giới hạn an toàn. Hãy chia nhỏ theo học kỳ.");
}
function scoreAggregate(scores,config){
 const values=scores.map(s=>({score:Number(s.total_score),code:s.grader_code||""})).filter(s=>Number.isFinite(s.score)&&s.score>=0&&s.score<=100);
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
async function results(db,castingId){
 const c=await byId(db,"gs_castings",castingId);
 const groups=await readAll(db,"competition_groups",{casting_id:c.id},1000);
 if(!groups.length)return{casting:c,groups:[],rows:[]};
 const gids=groups.map(g=>g.id);
 const [candidates,scores,verifications,assignments,decisions,identities]=await Promise.all([
  readAll(db,"candidates",{group_id:gids}),
  readAll(db,"scores",{group_id:gids}),
  readAll(db,"grader_verifications",{group_id:gids}),
  readAll(db,"grader_assignments",{group_id:gids}),
  readAll(db,"gs_casting_decisions",{casting_id:c.id}),
  readAll(db,"gs_candidate_identity",{casting_id:c.id})
 ]);
 const valid=new Set(verifications.filter(v=>v.is_verified===true).map(v=>v.group_id+"|"+v.grader_id));
 const identityMap=new Map(identities.map(d=>[d.candidate_id,d]));
 const scoreMap=new Map(),decisionMap=new Map(decisions.map(d=>[d.candidate_id,d])),expected=new Map(),groupMap=new Map(groups.map(g=>[g.id,g]));
 for(const a of assignments)expected.set(a.group_id,(expected.get(a.group_id)||0)+1);
 for(const s of scores){if(!valid.has(s.group_id+"|"+s.grader_id))continue;const arr=scoreMap.get(s.candidate_id)||[];arr.push(s);scoreMap.set(s.candidate_id,arr)}
 const rows=candidates.map(p=>{
  const graded=scoreMap.get(p.id)||[],group=groupMap.get(p.group_id),score=scoreAggregate(graded,c);
  const missing=graded.some(s=>(group?.criteria||[]).some(x=>!Object.prototype.hasOwnProperty.call(s.scores||{},x.name)));
  const completed=graded.length>0&&!missing&&graded.length>=(expected.get(p.group_id)||1);
  const outcome=score===null||!completed?"pending":score>=Number(c.pass_score)?"passed":"failed";
  const review=decisionMap.get(p.id)||null,identity=identityMap.get(p.id)||null;
  return{id:p.id,groupId:p.group_id,groupName:group?.name||"",code:p.code,name:p.name,
    mssv:identity?.mssv||"",
    email:identity?.email||"",emailConsent:identity?.email_consent===true,
    fields:p.custom_fields||{},privateFields:identity?.private_fields||{},
    score,judges:graded.length,expectedJudges:expected.get(p.group_id)||0,
    incomplete:!completed,missing,outcome,review:review?.review_status||"pending",
    syncState:review?.synced_at?"synced":"not-synced",memberId:review?.member_id||null};
 });
 return{casting:c,groups,rows};
}
async function handleCastingAction(action,b,actor){
 if(!CAST_ACTIONS.has(action))err("Tác vụ casting không được phép.");
 const db=client(),by=actor.decoded.uid;
 if(action==="casting-list"){
  const [castings,groups,graders,access]=await Promise.all([
   readAll(db,"gs_castings",{},1000),
   readAll(db,"competition_groups",{},1000),
   readAll(db,"profiles",{role:"Grader"},1000),
   readAll(db,"gs_google_grader_access",{},1000)
  ]);
  const map=new Map(access.map(x=>[x.profile_id,x]));
  return{ok:true,castings,groups:groups.map(g=>({id:g.id,name:g.name,castingId:g.casting_id,criteria:g.criteria})),
   graders:graders.map(g=>({id:g.id,name:g.name,code:g.code,status:g.status,
    email:map.get(g.id)?.email||"",googleEnabled:map.get(g.id)?.enabled===true,
    assignedGroups:g.assigned_groups||[]}))};
 }
 if(action==="casting-save"){
  const row={term:validTerm(b.term),name:safe(b.name,140),status:"draft",
    aggregate_method:["mean","weighted","trimmed"].includes(b.method)?b.method:"mean",
    pass_score:Number(b.passScore??50)};
  if(row.name.length<2||!Number.isFinite(row.pass_score)||row.pass_score<0||row.pass_score>100)err("Tên hoặc điểm đạt không hợp lệ.");
  if(b.weights&&typeof b.weights==="object"&&!Array.isArray(b.weights)){
   const weights=Object.entries(b.weights);if(weights.length>100)err("Quá nhiều trọng số.");
   if(weights.some(([k,v])=>!/^[A-Z0-9_-]{3,20}$/.test(k)||!Number.isFinite(Number(v))||Number(v)<=0||Number(v)>100))err("Trọng số BGK không hợp lệ.");
   row.grader_weights=Object.fromEntries(weights);
  }
  if(b.id){
   const previous=await byId(db,"gs_castings",b.id);
   if(previous.status==="published"||previous.status==="archived")err("Không được sửa quy chế casting đã công bố.");
   const data=check(await db.from("gs_castings").update({...row,status:previous.status,updated_at:new Date().toISOString()}).eq("id",b.id).select("*").single());
   return{ok:true,casting:data};
  }
  const data=check(await db.from("gs_castings").insert(row).select("*").single());
  return{ok:true,casting:data};
 }
 if(action==="casting-assign-group"){
  const casting=await byId(db,"gs_castings",b.castingId);const group=await byId(db,"competition_groups",b.groupId);
  if(casting.status==="published"||casting.status==="archived")err("Casting đã công bố hoặc kết thúc.");
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
 if(action==="casting-grant-criteria"){
  const grader=await byId(db,"profiles",b.graderId),group=await byId(db,"competition_groups",b.groupId);
  if(grader.role!=="Grader")err("Chỉ phân quyền cho BGK.");
  const choices=(group.criteria||[]).map(c=>c.name);
  const names=Array.isArray(b.criteria)?[...new Set(b.criteria)]:[];
  if(names.length>30||names.some(n=>!choices.includes(n)))err("Tiêu chí chấm không nằm trong phiên.");
  // Empty selection grants every criterion; nonempty selection restricts score writes.
  check(await db.from("gs_criterion_grants").delete().eq("grader_id",grader.id).eq("group_id",group.id));
  if(names.length)check(await db.from("gs_criterion_grants").insert(names.map(criterion=>({grader_id:grader.id,group_id:group.id,criterion}))));
  return{ok:true};
 }
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
 if(action==="casting-candidate-list"){
  const casting=await byId(db,"gs_castings",b.castingId);
  const groupRows=await readAll(db,"competition_groups",{casting_id:casting.id},1000);
  const ids=groupRows.map(g=>g.id);
  const [candidates,fields,identities]=await Promise.all([
   ids.length?readAll(db,"candidates",{group_id:ids},1500):[],
   readAll(db,"gs_candidate_fields",{casting_id:casting.id},1000),
   readAll(db,"gs_candidate_identity",{casting_id:casting.id},1500)
  ]);
  const byIdentity=new Map(identities.map(i=>[i.candidate_id,i]));
  return{ok:true,casting:{id:casting.id,term:casting.term,status:casting.status},
   candidates:candidates.map(c=>({id:c.id,groupId:c.group_id,code:c.code,name:c.name,
      fields:c.custom_fields||{},privateFields:byIdentity.get(c.id)?.private_fields||{},
      mssv:byIdentity.get(c.id)?.mssv||"",email:byIdentity.get(c.id)?.email||"",
      emailConsent:byIdentity.get(c.id)?.email_consent===true})),fields};
 }
 if(action==="casting-candidate-edit"){
  const casting=await byId(db,"gs_castings",b.castingId);
  if(casting.status==="published"||casting.status==="archived")err("Không sửa thí sinh khi kết quả đã công bố.");
  const candidate=await byId(db,"candidates",b.candidateId);
  const group=await byId(db,"competition_groups",candidate.group_id);
  if(group.casting_id!==casting.id)err("Thí sinh không thuộc casting.");
  const custom=b.fields;
  if(!custom||typeof custom!=="object"||Array.isArray(custom))err("Thông tin thí sinh không hợp lệ.");
  const defs=await readAll(db,"gs_candidate_fields",{casting_id:casting.id},150);
  const allowed=new Map(defs.map(f=>[f.field_key,f]));
  const existingIdentity=check(await db.from("gs_candidate_identity").select("*").eq("candidate_id",candidate.id).maybeSingle());
  const patch={...(candidate.custom_fields||{})},privateFields={...(existingIdentity?.private_fields||{})};
  delete patch.mssv;delete patch.email;delete patch.castingEmailConsent;
  let mssv=existingIdentity?.mssv||"",email=existingIdentity?.email||null,consent=existingIdentity?.email_consent===true;
  const name=safe(b.name,120);
  if(name.length<2)err("Họ tên cần ít nhất 2 ký tự.");
  const fields=Object.entries(custom);if(fields.length>70)err("Quá nhiều trường thông tin.");
  for(const [key,value] of fields){
   if(!FIELD.test(key)||!["mssv","email","castingEmailConsent"].includes(key)&&!allowed.has(key))err("Trường không có trong cấu hình: "+key);
   if(key==="castingEmailConsent"){if(typeof value!=="boolean")err("Đồng ý email phải là true/false.");consent=value;continue}
   const str=String(value??"").normalize("NFC").trim().slice(0,300);
   if(key==="mssv"&&!/^[A-Z0-9_-]{3,50}$/.test(str.toUpperCase()))err("MSSV không hợp lệ.");
   if(key==="email"&&str&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str))err("Email không hợp lệ.");
   const config=allowed.get(key);
   if(config?.kind==="number"&&str&&!Number.isFinite(Number(str)))err("Trường số không hợp lệ.");
   if(config?.kind==="date"&&str&&!/^\d{4}-\d{2}-\d{2}$/.test(str))err("Ngày tháng không hợp lệ.");
   if(config?.kind==="select"&&str&&Array.isArray(config.choices)&&config.choices.length&&!config.choices.includes(str))err("Giá trị chưa được cấu hình.");
   if(key==="mssv")mssv=str.toUpperCase();
   else if(key==="email")email=str.toLowerCase()||null;
   else if(config?.visibility==="admin"){privateFields[key]=str;delete patch[key]}
   else {patch[key]=str;delete privateFields[key]}
  }
  if(!mssv)err("Bắt buộc nhập MSSV để đồng bộ thành viên OSC.");
  for(const def of defs)if(def.required&&String((def.visibility==="admin"?privateFields:patch)[def.field_key]??"").trim()==="")err("Thiếu trường bắt buộc: "+def.label);
  // A UNIQUE(casting_id, mssv) constraint handles concurrent duplicate checks.
  check(await db.from("gs_candidate_identity").upsert({candidate_id:candidate.id,casting_id:casting.id,
    mssv,email,email_consent:consent,private_fields:privateFields,updated_at:new Date().toISOString()},
    {onConflict:"candidate_id"}));
  check(await db.from("candidates").update({name,custom_fields:patch,updated_at:new Date().toISOString()}).eq("id",candidate.id));
  return{ok:true,id:candidate.id};
 }
 if(action==="casting-results")return{ok:true,...await results(db,b.castingId)};
 if(action==="casting-review"){
  const info=await results(db,b.castingId),decisions=Array.isArray(b.decisions)?b.decisions:[];
  if(info.casting.status==="published"||info.casting.status==="archived")err("Không thay đổi kết quả đã công bố.");
  if(!decisions.length||decisions.length>40)err("Mỗi lần duyệt tối đa 40 thí sinh.");
  const map=new Map(info.rows.map(x=>[x.id,x]));
  const updated=decisions.map(d=>{
   const s=map.get(d.candidateId);
   if(!s||s.outcome==="pending"||s.incomplete)err("Chỉ duyệt thí sinh PASSED đã đủ bảng điểm khóa.");
   if(!["approved","rejected","pending"].includes(d.review))err("Trạng thái duyệt không hợp lệ.");
   return{casting_id:info.casting.id,candidate_id:s.id,outcome:s.outcome,score:s.score,
    review_status:d.review,reviewed_by:by,reviewed_at:new Date().toISOString()};
  });
  check(await db.from("gs_casting_decisions").upsert(updated,{onConflict:"casting_id,candidate_id"}));
  if(info.casting.status==="draft")check(await db.from("gs_castings").update({status:"review"}).eq("id",info.casting.id));
  return{ok:true,updated:updated.length};
 }
 if(action==="casting-publish"){
  const c=await byId(db,"gs_castings",b.castingId);
  if(c.status==="archived")err("Casting đã lưu trữ.");
  const current=await results(db,c.id);
  if(!current.rows.some(x=>x.review==="approved"&&!x.incomplete))err("Chưa có kết quả PASSED được BCN duyệt để công bố.");
  const dt=b.publishAt?new Date(b.publishAt):new Date();
  if(Number.isNaN(dt.getTime()))err("Thời điểm công bố không hợp lệ.");
  if(b.publicFields&&(!Array.isArray(b.publicFields)||b.publicFields.length>20))err("Danh sách trường công khai không hợp lệ.");
  const safeFields=new Set(["code","name","score","outcome"]),allowed=["code","name"];
  for(const v of b.publicFields||[])if(safeFields.has(v))allowed.push(v);
  check(await db.from("gs_castings").update({status:"published",publish_at:dt.toISOString(),public_fields:[...new Set(allowed)],updated_at:new Date().toISOString()}).eq("id",c.id));
  return{ok:true,publishAt:dt.toISOString()};
 }
 if(action==="casting-sync-payload"){
  const result=await results(db,b.castingId);
  if(!["review","approved","published"].includes(result.casting.status))err("Chưa phê duyệt casting.");
  const items=result.rows.filter(x=>x.outcome==="passed"&&x.review==="approved"&&x.syncState!=="synced").slice(0,40);
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
 if(action==="casting-notice-batch"){
  const c=await byId(db,"gs_castings",b.castingId);
  const rows=check(await db.from("gs_casting_notifications")
    .select("id,event_type,recipient_email").eq("casting_id",c.id).eq("status","queued")
    .order("created_at",{ascending:true}).limit(20));
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
  const recipients=Array.isArray(b.emails)?[...new Set(b.emails.map(x=>String(x).trim().toLowerCase()))]:[];
  const kind=String(b.kind||"");
  if(!["invite","reminder","submission","publication"].includes(kind)||!recipients.length||recipients.length>40||
    recipients.some(e=>e.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
    err("Danh sách người nhận không hợp lệ.");
  let eligible;
  if(kind==="publication"){
   if(c.status!=="published"||!c.publish_at||Date.parse(c.publish_at)>Date.now())err("Chưa đến thời điểm công bố.");
   const r=await results(db,c.id);
   eligible=new Set(r.rows.filter(x=>x.review==="approved"&&x.outcome!=="pending"&&x.emailConsent===true)
    .map(x=>x.email.trim().toLowerCase()).filter(Boolean));
  }else{
   const linked=(await readAll(db,"competition_groups",{casting_id:c.id},1000)).map(x=>x.id);
   if(!linked.length)err("Casting chưa gắn nhóm chấm.");
   const assigned=await readAll(db,"grader_assignments",{group_id:linked},1500);
   const access=await readAll(db,"gs_google_grader_access",{enabled:true},1000);
   const invited=new Set(assigned.map(x=>x.grader_id));
   eligible=new Set(access.filter(a=>invited.has(a.profile_id)).map(a=>a.email));
  }
  if(recipients.some(email=>!eligible.has(email)))err("Có email chưa được cấp quyền hoặc chưa đồng ý nhận thông báo.");
  const rows=recipients.map(recipient_email=>({casting_id:c.id,event_type:kind,recipient_email,status:"queued"}));
  check(await db.from("gs_casting_notifications").insert(rows));
  return{ok:true,queued:rows.length,notice:"Đã đưa vào hàng chờ, chưa gửi email."};
 }
 err("Tác vụ không được hỗ trợ.");
}
export {CAST_ACTIONS,handleCastingAction,scoreAggregate};
