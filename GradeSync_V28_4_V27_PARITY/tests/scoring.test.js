import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedTotal,validateScoreSheet,mean,stddev,councilAverage,histogram } from '../src/utils/scoring.js';

test('weightedTotal tính đúng trọng số',()=>{
  const criteria=[{name:'A',weight:30},{name:'B',weight:70}];
  assert.equal(weightedTotal(criteria,{A:80,B:90}),87);
});

test('validateScoreSheet phát hiện tiêu chí thiếu',()=>{
  const v=validateScoreSheet([{name:'A'},{name:'B'}],{scores:{A:50}});
  assert.equal(v.ok,false);assert.deepEqual(v.missing,['B']);
});

test('mean/stddev/councilAverage',()=>{
  assert.equal(mean([10,20,30]),20);
  assert.ok(Math.abs(stddev([10,20,30])-8.1649)<0.01);
  assert.equal(councilAverage([{totalScore:70},{totalScore:80}]),75);
});

test('histogram phân nhóm 0-100',()=>{
  const h=histogram([0,9,10,99],10);
  assert.equal(h[0].count,2);assert.equal(h[1].count,1);assert.equal(h[9].count,1);
});
