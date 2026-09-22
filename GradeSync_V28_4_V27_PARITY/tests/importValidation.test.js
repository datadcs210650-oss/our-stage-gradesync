import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImport} from '../src/utils/importValidation.js';

test('phát hiện trùng với dữ liệu cũ và trùng trong file',()=>{
  const rows=[{'Mã SBD':'A1','Họ tên':'Một'},{'Mã SBD':'A2','Họ tên':'Hai'},{'Mã SBD':'A2','Họ tên':'Ba'}];
  const r=validateImport(rows,['A1']);
  assert.match(r[0].errors.join(','),/tồn tại/);
  assert.equal(r[1].valid,true);
  assert.match(r[2].errors.join(','),/trùng trong file/);
});
