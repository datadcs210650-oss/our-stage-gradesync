import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import bridge from "../api/osc-bridge.js";

const file=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const admin=file("osc-console.html");
const candidates=file("candidate-editor.js");
const casting=file("casting-hub.js");
const migration=file("supabase/migrations/20261123163000_protect_admin_session_and_candidate_updates.sql");

test("roster shows private contacts and extra fields without clipping rows in a group",()=>{
 for(const column of ["MSSV","Email","Điện thoại","Trường phụ","Hồ sơ"])assert.match(candidates,new RegExp(">"+column+"<"));
 assert.match(candidates,/const shown=visible;/);
 assert.match(candidates,/candidateId:item.id,name:name.value,fields,version:item.version/);
});

test("email is a separate OSC page with queue history and explicit resend",()=>{
 assert.match(admin,/\["casting_email","Email"/);
 const review=casting.slice(casting.indexOf("async function loadCastingHub"),casting.indexOf("async function loadCastingEmail"));
 assert.doesNotMatch(review,/casting-(notification|notice|send)/);
 for(const action of ["casting-notice-history","casting-notice-retry","casting-send-notifications"])
  assert.ok(casting.slice(casting.indexOf("async function loadCastingEmail")).includes(action));
});

test("GrandSync bridge rejects requests without an OSC token for private actions",async()=>{
 for(const action of ["casting-candidate-roster","casting-update-session","casting-notice-history","casting-notice-retry"]){
  let payload;
  const res={setHeader(){},end(body){payload=JSON.parse(body)}};
  await bridge({method:"POST",headers:{},body:{action}},res);
  assert.equal(res.statusCode,403);
  assert.equal(payload.ok,false);
 }
});

test("session guard and private profile RPC protect persisted scoring and credentials",()=>{
 assert.match(migration,/exists\(select 1 from public\.scores where group_id=old\.id\)/);
 assert.match(migration,/before insert or update on public\.scores/);
 assert.match(migration,/from public, anon, authenticated/);
 assert.match(migration,/p_identity_updated/);
 assert.doesNotMatch(migration,/\bdelete from public\.scores\b/i);
});
