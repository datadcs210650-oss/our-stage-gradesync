import {readFileSync} from "node:fs";
import {makeReportPdf,pdfFilename} from "../lib/osc-report-pdf.js";
import assert from "node:assert/strict";
import test from "node:test";
const font=readFileSync(new URL("../lib/pdf-fonts/Tinos-Regular.ttf",import.meta.url));
const base={title:"BIÊN BẢN CHẤM THI KẾT QUẢ",session:"FA26_TRUYỀN THÔNG VÀ SẢN XUẤT",judge:"GK_ĐỨC ĐẠT",kind:"individual",code:"57158541",confirmed:true,passScore:5,dateLine:"Cần Thơ, ngày 25 tháng 11 năm 2026",signTime:"01:43:23 - 25/11/2026",note:"Điểm theo bảng điểm đã khóa qua OTP.",orientation:"landscape",documentKey:"a".repeat(64),documentId:"d836b531-8c6b-4fed-97d0-1487147dc79a"};
for(const [name,count,cols,portrait,all,long] of [["one",1,2,false,false,false],["many",85,4,false,false,false],["long",35,12,false,false,true],["portrait",40,12,true,false,true],["aggregate",42,6,false,true,false],["boundary",20,4,false,false,false]])test(name,()=>{
 const columns=["STT","SBD","Họ tên thí sinh",...Array.from({length:cols},(_,i)=>"Tiêu chí "+(i+1)+" - "+(long?"Năng lực diễn xuất và khả năng phối hợp":"25%")),"Tổng","Kết quả"];
 const rows=Array.from({length:count},(_,i)=>[String(i+1),"SBD"+String(i+1).padStart(3,"0"),long?"Nguyễn Thị Hoàng Yến Trần Lê Phạm Nguyễn Bảo Châu Huyền My ".repeat(2):"Nguyễn Văn An "+(i+1),...Array.from({length:cols},()=>"8.5"),"8.5","ĐẠT"]);
 const model={...base,columns,rows,orientation:portrait?"portrait":"landscape",kind:all?"aggregate":"individual",judge:all?"HỘI ĐỒNG GIÁM KHẢO":base.judge,code:all?"":base.code,signTime:all?"BGK xác nhận: 3/5 (60%)":base.signTime};
 const out=makeReportPdf(model,font);assert.equal(out.bytes.subarray(0,5).toString(),"%PDF-");assert.equal(out.stats.filter(s=>s.signature).length,1);assert(out.stats.at(-1).signature);
 for(let i=1;i<=out.stats[0].panel.count;i++)assert.deepEqual(out.stats.filter(s=>s.panel.index===i).flatMap(s=>s.rows),Array.from({length:count},(_,j)=>j));
 if(name==="one")assert.equal(out.pages,1);
});
test("NTCD naming",()=>{assert.equal(pdfFilename("FA26_HOVINIGHT","GK_Đức Đạt","57158541","individual"),"NTCD_FA26_HOVINIGHT_GK_DUC DAT_57158541.pdf");assert.equal(pdfFilename("FA26_HOVINIGHT","GK_Đức Đạt","","individual"),"NTCD_FA26_HOVINIGHT_GK_DUC DAT_CHUA XAC NHAN.pdf");assert.equal(pdfFilename("FA26_HOVINIGHT","","","aggregate"),"NTCD_FA26_HOVINIGHT_HOI DONG GIAM KHAO.pdf")});
