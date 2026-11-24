/* Retry only verified PostgREST pre-execution authentication rejections. */
export function createRestRecoveryFetch(origin,{fetchImpl=globalThis.fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),delays=[300,900,1800]}={}){
 const allowedOrigin=new URL(origin).origin;
 return async function restRecoveryFetch(input,init){
  const url=new URL(typeof input==="string"||input instanceof URL?input:input.url);
  const method=String(init?.method||(input instanceof Request?input.method:"GET")).toUpperCase();
  const canRetry=url.origin===allowedOrigin&&url.pathname.startsWith("/rest/v1/")&&
   (!(input instanceof Request)||["GET","HEAD"].includes(method))&&
   (init?.body==null||typeof init.body==="string");
  const signal=init?.signal||(input instanceof Request?input.signal:undefined);
  for(let i=0;;i++){
   const response=await fetchImpl(input,init);
   if(!canRetry||response.status!==401||i>=delays.length||signal?.aborted)return response;
   let code;try{code=(await response.clone().json())?.code}catch{return response}
   if(code!=="PGRST303")return response;
   await wait(delays[i]);
   if(signal?.aborted)return response;
  }
 };
}
export function restRecoveryOptions(origin){
 return {auth:{persistSession:false,autoRefreshToken:false},global:{fetch:createRestRecoveryFetch(origin)}};
}
