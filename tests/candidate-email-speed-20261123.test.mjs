import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.join(import.meta.dirname,"..");
const get=x=>fs.readFileSync(path.join(root,x),"utf8");

test("candidate list fetches one selected group and one page, never scans all semesters on entry",()=>{
 const backend=get("lib/casting-manager.js"),front=get("candidate-editor.js");
 assert.match(backend,/if\(action==="casting-group-options"\)/);
 assert.match(backend,/if\(action==="casting-candidate-add"\)/);
 assert.match(backend,/if\(action==="casting-candidate-roster"\)/);
 assert.match(backend,/if\(b\.groupId\)/);
 assert.match(backend,/\.eq\("group_id",group\.id\)\.order\("code"\)\.range\(offset,offset\+limit-1\)/);
 assert.match(backend,/\.in\("candidate_id",ids\)/);
 assert.match(front,/request\("casting-candidate-roster",\{groupId:gid,offset,limit:state\.limit\}\)/);
 assert.match(front,/legacy\.addEventListener\("toggle"/);
 assert.doesNotMatch(front,/await toolsMenu\(legacyArea\);\s*await loadPage\(\)/);
});

test("candidate data stays manager-only and consent cannot be inferred",()=>{
 const backend=get("lib/casting-manager.js"),front=get("candidate-editor.js");
 assert.match(backend,/const consent=b\.emailConsent===true&&b\.confirmConsent===true/);
 assert.match(front,/Chỉ đánh dấu khi đã có sự đồng ý thực tế/);
 assert.match(front,/casting-review/);
 assert.match(front,/row\.emailConsent===true|x\.emailConsent===true|x\.emailConsent/);
});

test("Email is a distinct lazy admin menu with no public lookup or timer-based sending",()=>{
 const email=get("casting-email-center.js"),hub=get("casting-hub.js"),consoleHtml=get("osc-console.html");
 assert.match(consoleHtml,/import "\.\/casting-email-center\.js"/);
 assert.match(email,/task:"dispatch"/);
 assert.match(email,/allEligible:all/);
 assert.match(email,/scheduledAt:at/);
 assert.match(email,/task:"cancel"/);
 assert.match(email,/legacy\.addEventListener\("toggle"/);
 assert.doesNotMatch(hub,/Lên lịch công bố/);
 assert.doesNotMatch(email,/ket-qua\.html/);
 assert.doesNotMatch(email,/setInterval/);
});

test("Candidate and Email handlers have valid JavaScript syntax",()=>{
 for(const file of ["candidate-editor.js","casting-email-center.js","casting-hub.js"]){
  assert.doesNotThrow(()=>new Function(get(file)),file);
 }
 const code=get("lib/casting-manager.js")
  .replace(/^import\s+[^;\n]+;\s*/gm,"")
  .replace(/^export\s+\{[^}]*\};?\s*$/gm,"");
 assert.doesNotThrow(()=>new Function(code));
});
