export default function handler(_req,res){res.setHeader("Cache-Control","no-store");return res.status(410).json({ok:false,error:"Chỉ cấp quyền Google qua NỀN TẢNG CHẤM ĐIỂM trong WebOSC."})}
