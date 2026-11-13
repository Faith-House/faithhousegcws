const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export function createDiscordBridge({baseUrl,fetchImpl=fetch,timeoutMs=200000}={}){
 const active=new Map();
 async function ask(userId,binding,question,{signal}={}){
  if(active.has(userId))throw fail('You already have a Jarvis request running. Use /jarvis stop first.');
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)]);
  const job={controller,binding,requestId:null};active.set(userId,job);
  try{
   const events=await fetchImpl(new URL('/api/events?room='+encodeURIComponent(binding.room),baseUrl()),{signal:combined});if(!events.ok)throw fail('Jarvis could not open this room’s response stream.',502);
   const accepted=await fetchImpl(new URL('/api/ask',baseUrl()),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:binding.room,profileId:binding.profileId,question}),signal:combined});
   const reply=await accepted.json();if(!accepted.ok)throw fail(reply.error||'Jarvis could not accept that request.',accepted.status);
   job.requestId=reply.requestId;let buffer='',decoder=new TextDecoder();
   for await(const chunk of events.body){buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>262144)throw fail('The reply stream was too large.',502);let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);if(!packet.startsWith('data: '))continue;const state=JSON.parse(packet.slice(6));if(state.requestId!==job.requestId)continue;if(state.state==='error')throw fail(state.error||'Jarvis could not answer.',502);if(state.state==='ready')return{answer:state.answer||'Done.',room:binding.room,requestId:state.requestId,profileId:binding.profileId};}
   }
   throw fail('Jarvis stopped before returning a reply.',502);
  }finally{controller.abort();if(active.get(userId)===job)active.delete(userId);}
 }
 async function stop(userId){const job=active.get(userId);if(!job)return false;try{if(job.requestId)await fetchImpl(new URL('/api/cancel',baseUrl()),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:job.binding.room,profileId:job.binding.profileId,requestId:job.requestId}),signal:AbortSignal.timeout(3000)});}finally{job.controller.abort(Error('Stopped by Discord user'));}return true;}
 async function transcribe(binding,wave,{signal}={}){const response=await fetchImpl(new URL('/api/transcribe?room='+encodeURIComponent(binding.room),baseUrl()),{method:'POST',headers:{'Content-Type':'audio/wav'},body:wave,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});const result=await response.json();if(!response.ok)throw fail(result.error||'Local recognition could not transcribe that audio.',response.status);return result.text||'';}
 async function speech(result,{signal}={}){const response=await fetchImpl(new URL('/api/speech',baseUrl()),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:result.room,requestId:result.requestId}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(150000)]):AbortSignal.timeout(150000)});if(!response.ok)throw fail('Jarvis could not prepare the local spoken reply.',response.status);const chunks=[];let n=0;for await(const chunk of response.body){n+=chunk.length;if(n>8*1024*1024)throw fail('The spoken reply was too large.');chunks.push(chunk);}return Buffer.concat(chunks);}
 return{ask,stop,transcribe,speech,close:()=>{for(const job of active.values())job.controller.abort();active.clear();}};
}
