import test from "node:test";
import assert from "node:assert/strict";
import {buildGradingReport,lookupScan,verifyGradingPdf} from "../lib/osc-pdf-service.js";
const group={id:"g",casting_id:"c",name:"FA26_TEST",criteria:[{name:"Kỹ năng",weight:100}],pass_score:5,extra_data:{attendanceEnabled:true,gsCasting:{roles:["Vai chính"]}}};
const candidates=[{id:"a",code:"A",name:"QA A",is_present:true},{id:"b",code:"B",name:"QA B",is_present:true},{id:"z",code:"Z",name:"QA absent",is_present:false}];
const at="2026-11-26T00:00:00Z";
const a={candidate_id:"a",review_status:"approved",score:8.18,outcome:"failed",reviewed_at:at,assigned_roles:[]};
const b={candidate_id:"b",review_status:"approved",score:6.1,outcome:"passed",reviewed_at:at,assigned_roles:["Vai chính"]};
async function report({decisions=[a,b],status="review",ready=true,allAbsent=false,enabled=true,raw=[{candidate_id:"a",grader_id:"j",scores:{"Kỹ năng":9}}],...filters}={}){
 const roster=candidates.map(x=>({...x,is_present:allAbsent?false:x.is_present}));const present=roster.filter(x=>!enabled||x.is_present);
 const helpers={byId:async()=>({...group,extra_data:{...group.extra_data,attendanceEnabled:enabled}}),readAll:async()=>roster.slice(),check:r=>r.data,attendanceState:async()=>({enabled,locked:true,assigned:2,submitted:1}),results:async(db,c,g)=>{assert.equal(g,group.id);return {casting:{status},rows:present.map(x=>({id:x.id,groupId:"g",score:9,incomplete:!ready})),reportData:{scores:raw,decisions,quorum:[{candidate_id:"a",valid_ids:["j"]}]}}}};
 return buildGradingReport({}, {groupId:"g",graderCode:"ALL",tabular:true,...filters},helpers);
}
test("official scores and outcome override live averages; retain approved roles and attendance",async()=>{
 const r=await report();
 assert.equal(r.reviewSummary.stage,"approved");
 assert.equal(r.model.confirmed,true);assert.equal(r.model.code,"");
 assert.equal(r.model.rows[0].at(-2),"8.18");assert.equal(r.model.rows[0].at(-1),"KHÔNG ĐẠT");
 assert.equal(r.model.rows[1].at(-3),"Vai chính");assert.equal(r.model.rows[0][3],"Có mặt");assert.equal(r.model.rows[2].at(-1),"VẮNG MẶT");assert.equal(r.model.rows[2].at(-2),"-");assert.equal(r.reviewSummary.total,2);assert.equal(r.reviewSummary.registered,3);assert.equal(r.reviewSummary.approved,2);assert.equal(r.reviewSummary.attendanceLocked,true);
 assert.deepEqual((await report({resultFilter:"PASS"})).model.rows.map(x=>x[1]),["B"]);
 assert.deepEqual((await report({attendanceFilter:"PRESENT"})).model.rows.map(x=>x[1]),["A","B"]);assert.deepEqual((await report({attendanceFilter:"ABSENT"})).model.rows.map(x=>x[1]),["Z"]);
});
test("review states reflect authoritative decisions, not selection or partial approvals",async()=>{
 for(const [input,stage] of [[{status:"published"},"published"],[{decisions:[a]},"partial"],[{decisions:[]},"pending-review"],[{decisions:[],ready:false},"insufficient"],[{decisions:[],ready:false,raw:[]},"grading"]])
  assert.equal((await report(input)).reviewSummary.stage,stage);
 assert.equal((await report({decisions:[a]})).model.confirmed,false);
 assert.equal((await report({allAbsent:true})).model.confirmed,false);
 assert.equal((await report({enabled:false})).reviewSummary.total,3);
 assert.equal((await report({enabled:false})).model.confirmed,false);
});
const id="d836b531-8c6b-4fed-97d0-1487147dc79a",sha="a".repeat(64),cmp="12345678";
const issue={group_id:"g",grader_id:"j",kind:"individual",comparison_code:cmp,receipt_hash:sha,receipt_at:at,sha256:sha,document_id:id,pdf_base64:"JVBERi0xLjQ="};
const receipt={snapshot_sha256:sha,verified_at:at,comparison_code:cmp,confirmation_method:"email-otp"};
function db(state="active",row=issue,rec=receipt){return {async rpc(){return {data:state}},from(name){return {select(){return this},eq(){return this},order(){return this},limit(){return Promise.resolve({data:[row]})},maybeSingle(){return Promise.resolve({data:name==="gs_grading_receipts"?rec:row})}}}}}
test("scan lookup is never verification; old, mismatching, expired records remain distinguishable",async()=>{
 for(const [d,args,want] of [[db(),{documentId:id,comparisonCode:cmp},"manual-required"],[db("superseded"),{documentId:id,comparisonCode:cmp},"superseded"],[db(),{documentId:id,comparisonCode:"87654321"},"not-found"],[db(),{comparisonCode:cmp},"manual-required"],[db(),{documentId:"bad"},"invalid"],[db("active",issue,null),{documentId:id,comparisonCode:cmp},"superseded"]]){
  const result=await lookupScan(d,args);
  assert.equal(result.status,want);assert.equal(result.verified,false);assert.deepEqual(Object.keys(result).sort(),["ok","status","verified"]);
 }
 assert.equal((await verifyGradingPdf(db(),{sha256:sha,comparisonCode:cmp})).verified,true);
});
