import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const bridge=file("lib/casting-manager.js");
const adminPages=file("osc-casting-admin-pages.js");
const candidateUi=file("candidate-editor.js");
const judgeUi=file("grader-google-ui.js");
const confirmApi=file("api/grader-confirm.js");
const adminConsole=file("osc-console.html");
const judgePage=file("index.html");

test("casting group creation restores the legacy settings but requires a semester-bound casting",()=>{
 assert.match(adminPages,/collectCriteria\(\)/);
 assert.match(adminPages,/collectExtras\(\)/);
 assert.match(adminPages,/attendanceEnabled:attendance\.checked/);
 assert.match(adminPages,/castingId:destination\.value/);
 assert.match(adminPages,/Tổng trọng số các tiêu chí phải bằng 100%/);
 assert.match(bridge,/casting-create-session/);
 assert.match(bridge,/validTerm\(b\.term\)/);
 assert.match(bridge,/casting_id:casting\.id,criteria,pass_score:score/);
 assert.match(bridge,/extra_data:\{extraFields:extra,attendanceEnabled/);
 assert.match(bridge,/startTime:start,endTime:end/);
});
test("admin sees all real candidates independently of a chosen casting",()=>{
 assert.match(bridge,/"casting-candidate-roster"/);
 assert.match(bridge,/readAll\(db,"candidates",\{\},3000\)/);
 assert.match(bridge,/castingName:casting\.name/);
 assert.match(candidateUi,/Danh sách thí sinh toàn hệ thống/);
 assert.match(candidateUi,/api\("casting-candidate-roster"\)/);
 assert.match(candidateUi,/Tất cả học kỳ và nhóm/);
 assert.match(candidateUi,/Chưa có thí sinh/);
});
test("judge cannot request, preview or download confirmed score receipts",()=>{
 assert.match(confirmApi,/if\(body\.action==="receipt"\)throw fail\("Giám khảo không có quyền tải hoặc xuất bảng điểm\.",403\)/);
 assert.doesNotMatch(judgeUi,/window\.gsExportConfirmedPdf\s*=/);
 assert.doesNotMatch(judgeUi,/await exportPdf\(/);
 assert.doesNotMatch(judgeUi,/Bạn có muốn tải biên bản PDF/);
 for(const fn of ["exportLogsPDF","openExcelConfigModalLive","executeExcelExport","openPDFConfigModalLive","executePDFExport"]){
  assert.match(judgePage,new RegExp('window\\.'+fn+' = async function\\('));
 }
 assert.equal((judgePage.match(/Chỉ BCN quản trị được tải hoặc xuất dữ liệu chấm điểm\./g)||[]).length,5);
});
test("only OSC admin bridge receives receipt metadata for authenticating the PDF seal",()=>{
 assert.match(bridge,/"casting-grader-receipt"/);
 assert.match(bridge,/gs_grading_receipts/);
 assert.match(bridge,/snapshot_sha256/);
 assert.match(bridge,/snapshot:Array\.isArray\(verified\.snapshot\)/);
 assert.match(adminConsole,/const authoritativeScores=receipt\?receipt\.snapshot/);
 assert.match(adminConsole,/Bản chốt bất biến khi xác nhận OTP/);
 assert.match(adminConsole,/window\.oscGradingCall\("casting-grader-receipt"/);
 assert.match(adminConsole,/ĐÃ XÁC NHẬN BẢNG ĐIỂM/);
 assert.match(adminConsole,/Dấu xác nhận nội bộ OSC/);
 assert.match(adminConsole,/CHƯA CHẤM/);
 assert.match(adminConsole,/CHƯA ĐỦ/);
});
