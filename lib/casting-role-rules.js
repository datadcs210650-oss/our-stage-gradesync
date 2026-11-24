// Role casting is opt-in per group; legacy sessions preserve their casting policy.
export function normalizeSessionPolicy(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Quy chế phiên không hợp lệ.");
 const roles=raw.roles??[];
 if(!Array.isArray(roles)||roles.length>40||roles.some(x=>typeof x!=="string"||!x.trim()||x.trim().length>100))throw Error("Danh sách vai không hợp lệ (tối đa 40 vai).");
 const names=roles.map(x=>x.trim().normalize("NFC"));
 if(new Set(names.map(x=>x.toLocaleLowerCase("vi"))).size!==names.length)throw Error("Tên vai diễn bị trùng.");
 const maxRegistered=names.length?Number(raw.maxRegistered):0,maxProposed=names.length?Number(raw.maxProposed):0;
 if(names.length&&(!Number.isInteger(maxRegistered)||maxRegistered<1||maxRegistered>names.length||!Number.isInteger(maxProposed)||maxProposed<1||maxProposed>maxRegistered))throw Error("Giới hạn vai diễn không hợp lệ.");
 const method=raw.method??"mean";
 if(!["mean","weighted","trimmed"].includes(method))throw Error("Phương pháp tổng hợp không hợp lệ.");
 const entries=Object.entries(raw.weights||{});
 if(entries.length>100||entries.some(([k,v])=>!/^[A-Z0-9_-]{3,20}$/.test(k)||!Number.isFinite(Number(v))||Number(v)<=0||Number(v)>100))throw Error("Trọng số giám khảo không hợp lệ.");
 return {roles:names,maxRegistered,maxProposed,notesEnabled:raw.notesEnabled===true,method,weights:Object.fromEntries(entries.map(([k,v])=>[k,Number(v)]))};
}
export function registeredRoles(policy,raw){
 if(!Array.isArray(raw)||new Set(raw).size!==raw.length||raw.length>(policy?.maxRegistered||0)||raw.some(x=>typeof x!=="string"||!policy?.roles?.includes(x)))throw Error("Vai đăng ký không thuộc phiên hoặc vượt giới hạn.");
 return raw;
}
export function officialRoles(policy,raw){
 if(!Array.isArray(raw)||new Set(raw).size!==raw.length||raw.some(x=>typeof x!=="string"||!policy?.roles?.includes(x)))throw Error("Vai chính thức không thuộc danh sách của phiên.");
 return raw;
}
export function finalOutcome(scoreOutcome,policy,assigned){
 if(scoreOutcome==="pending")return "pending";
 return policy?.roles?.length?(assigned?.length&&scoreOutcome==="passed"?"passed":"failed"):scoreOutcome;
}
export function scoringPolicy(group,casting){
 const p=group?.extra_data?.gsCasting;
 return p?{aggregate_method:p.method,grader_weights:p.weights,pass_score:group.pass_score}:casting;
}