import crypto from "node:crypto";
export async function sendScoringMail({kind,to,code="",groupName,name=""}){
 const secret=process.env.GRADESYNC_OTP_RELAY_SECRET||"";
 if(secret.length<32)throw Error("Chưa cấu hình kênh email xác thực.");
 const payload={action:"gradesync-otp-relay",to,code,kind,groupName:String(groupName||"").slice(0,120),name:String(name||"").slice(0,100),nonce:crypto.randomUUID()};
 const body=JSON.stringify(payload),ts=String(Date.now()),signature=crypto.createHmac("sha256",secret).update(ts+"\n"+body).digest("hex");
 const response=await fetch("https://admin.ourstage.io.vn/api/gradesync",{method:"POST",redirect:"error",signal:AbortSignal.timeout(12000),headers:{"Content-Type":"application/json","X-OSC-Timestamp":ts,"X-OSC-Signature":signature},body});
 const result=await response.json().catch(()=>({}));
 if(!response.ok||result.ok!==true)throw Error(result.error||"Dịch vụ email chưa tiếp nhận yêu cầu.");
 return true;
}
