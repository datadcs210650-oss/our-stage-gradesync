// Legacy Firebase-based grader management is retired.
// All administrative changes must be authenticated through OSC Management.
export default function handler(_req,res){
 res.setHeader("Cache-Control","no-store");
 return res.status(410).json({ok:false,error:"Quản trị GrandeSync đã chuyển sang OSC Management."});
}
