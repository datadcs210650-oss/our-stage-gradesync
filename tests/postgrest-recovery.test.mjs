import test from "node:test";
import assert from "node:assert/strict";
import {createRestRecoveryFetch} from "../lib/supabase-rest-recovery.js";
const origin="https://example.supabase.co",url=origin+"/rest/v1/rpc/osc_grading_documents";
const response=(status,code)=>new Response(JSON.stringify({code}),{status});
test("recovers pre-execution authentication rejection",async()=>{
 let calls=0;const run=createRestRecoveryFetch(origin,{wait:async()=>{},fetchImpl:async()=>++calls===1?response(401,"PGRST303"):response(200,"ok")});
 assert.equal((await run(url,{method:"POST",body:"{}"})).status,200);assert.equal(calls,2);
});
test("does not repeat other errors or external requests",async()=>{
 for(const [status,code,path] of [[500,"PGRST303",url],[401,"PGRST301",url],[403,"PGRST303",url],[401,"PGRST303",origin+"/auth/v1/user"],[401,"PGRST303","https://other.example/rest/v1/x"]]){
  let calls=0;const run=createRestRecoveryFetch(origin,{wait:async()=>{},fetchImpl:async()=>{calls++;return response(status,code)}});await run(path);assert.equal(calls,1);
 }
});
test("bounded attempts, no retry on unknown write outcome",async()=>{
 let calls=0;const run=createRestRecoveryFetch(origin,{wait:async()=>{},fetchImpl:async()=>{calls++;return response(401,"PGRST303")}});
 assert.equal((await run(url)).status,401);assert.equal(calls,4);
 let network=0;const fail=createRestRecoveryFetch(origin,{fetchImpl:async()=>{network++;throw Error("network")}});
 await assert.rejects(()=>fail(url,{method:"POST",body:"{}"}));assert.equal(network,1);
});