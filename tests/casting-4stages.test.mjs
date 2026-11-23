import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>fs.readFileSync(path.join(dir,p),"utf8");
test("casting tables isolate private identities and restrict Google enrollment",()=>{
 const sql=read("supabase/migrations/20261122173000_casting_foundation_google_access.sql");
 const privacy=read("supabase/migrations/20261122183000_candidate_private_identity.sql");
 assert.match(sql,/gs_claim_google_grader/);
 assert.match(sql,/auth\.identities/);
 assert.match(sql,/email_confirmed_at/);
 assert.match(privacy,/gs_candidate_identity/);
 assert.match(privacy,/enable row level security/);
 assert.match(privacy,/revoke all on public\.gs_candidate_identity/);
});
test("OTP requires server-side signed request, immutable receipt, and unique confirmation",()=>{
 const script=read("api/grader-confirm.js");
 const migration=read("supabase/migrations/20261122180000_grading_otp_receipts.sql");
 assert.match(script,/GRADESYNC_OTP_SECRET/);
 assert.match(script,/gradesync-otp-relay/);
 assert.match(script,/auth\.getUser/);
 assert.match(script,/provider==="google"/);
 assert.match(migration,/gs_grading_receipts/);
 assert.match(migration,/failed_attempts>=5/);
 assert.match(migration,/revoke all on function public\.gs_finalize_grading_otp/);
});
test("casting aggregate is deterministic for mean, weighted, and trimmed",()=>{
 const src=read("lib/casting-manager.js"),a=src.indexOf("function scoreAggregate("),b=src.indexOf("async function results(",a);
 assert.ok(a>=0&&b>a);
 const aggregate=new Function(src.slice(a,b)+"\nreturn scoreAggregate;")();
 const s=[{total_score:2,grader_code:"A"},{total_score:6,grader_code:"B"},{total_score:8,grader_code:"C"},{total_score:10,grader_code:"D"}];
 assert.equal(aggregate(s,{aggregate_method:"mean"}),6.5);
 assert.equal(aggregate(s,{aggregate_method:"trimmed"}),7);
 assert.equal(aggregate(s,{aggregate_method:"weighted",grader_weights:{A:1,B:1,C:1,D:3}}),7.67);
});
test("candidate results require approval, publishing and private email match",()=>{
 const src=read("api/casting-public.js");
 assert.match(src,/gs_candidate_identity/);
 assert.match(src,/exactEmail/);
 assert.match(src,/status!=="published"/);
 assert.match(src,/review_status!=="approved"/);
 assert.doesNotMatch(src,/select\("id,code,name,custom_fields"\)/);
});
test("GradeSync admin navigation includes native OSC semester casting",()=>{
 const c=read("osc-console.html");
 assert.match(c,/casting_hub/);
 assert.match(c,/candidate-editor\.js/);
 assert.match(c,/live-grid-layout\.js/);
});
