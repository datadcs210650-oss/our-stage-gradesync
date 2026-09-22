const state={
  user:null,
  groups:new Map(),
  candidates:new Map(),
  scores:new Map(),
  verifications:new Map(),
  presence:new Map(),
  graders:new Map(),
  system:{emergencyLock:false,reason:''},
  selectedGroupId:null,
  selectedCandidateId:null,
  unsubs:[],
  pending:0
};
const listeners=new Set();
export const store={
  get:()=>state,
  set(patch,type='state'){Object.assign(state,patch);listeners.forEach(fn=>fn(state,type));},
  emit(type='state'){listeners.forEach(fn=>fn(state,type));},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
  clearListeners(){state.unsubs.splice(0).forEach(u=>{try{u();}catch{}})},
  addUnsub(u){if(typeof u==='function')state.unsubs.push(u)}
};
