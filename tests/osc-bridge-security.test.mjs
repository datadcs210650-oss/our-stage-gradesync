import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { _test } from "../api/osc-bridge.js";
const source=fs.readFileSync(new URL("../api/osc-bridge.js",import.meta.url),"utf8");
test("OSC is the sole gateway for GradeSync privileged admin operations",()=>{
 assert.match(source,/requireOscManager\(req\)/);
 assert.match(source,/https:\/\/admin\.ourstage\.io\.vn\/api\/gradesync/);
 assert.match(source,/body:JSON\.stringify\(\{action:"verify"\}\)/);
 assert.match(source,/actor\.role/);
 assert.doesNotMatch(source,/Firebase_PRIVATE_KEY|OSC_OTP_SECRET|require\("firebase-admin"\)/);
});
test("secret Supabase key is server-owned and never forwarded to browser",()=>{
 assert.match(source,/process\.env\.SUPABASE_SECRET_KEY/);
 assert.match(source,/apikey/);
 assert.match(source,/Authorization:"Bearer "\+key\(\)/);
 assert.doesNotMatch(source,/res\.end\(key\(\)\)|return.*SUPABASE_SECRET_KEY/);
});
test("judge codes, UUIDs and allowed admin actions are validated",()=>{
 assert.equal(_test.CODE.test("BGK01"),true);
 assert.equal(_test.CODE.test("bgk01"),false);
 assert.equal(_test.CODE.test("A"),false);
 assert.equal(_test.ID.test("550e8400-e29b-41d4-a716-446655440000"),true);
 assert.equal(_test.ID.test("not-an-id"),false);
 assert.equal(_test.ALLOWED_ACTIONS.has("create-grader"),true);
 assert.equal(_test.ALLOWED_ACTIONS.has("delete-all"),false);
});
test("judge is never promoted to GradeSync Admin and belongs to assigned groups",()=>{
 assert.match(source,/role:"Grader"/);
 assert.match(source,/assigned_groups:groupIds/);
 assert.match(source,/allowed_menus:\["grading_table"\]/);
 assert.match(source,/ban_duration:active\?"none":"876000h"/);
});
test("candidate and group management is scoped and audited",()=>{
 assert.match(source,/validateCriteria/);
 assert.match(source,/Math\.abs\(out\.reduce/);
 assert.match(source,/group_id:"eq\."\+group/);
 assert.match(source,/markAttendance\(actor,body\)/);
 assert.match(source,/await audit\(actor/);
});
