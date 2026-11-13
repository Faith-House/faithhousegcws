import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createModelRouter, modelModeIntent } from '../model-routing.mjs';
import { createJarvisServer } from '../server.mjs';
const tags = { models: [{ name: 'fast:test', size: 500 }, { name: 'coder:test', size: 5000 }, { name: 'other-cloud', remote_host: 'https://cloud.example' }] };
const scope = { room: 'bedroom-1', profileId: 'cooper' };

test('model modes accept natural switch commands but never commands embedded in code or negations',()=>{
 for(const q of ['Coding mode','Hey Jarvis, switch to coding mode','Please enter developer mode.']) assert.equal(modelModeIntent(q),'coding');
 for(const q of ['Normal mode','Exit coding mode','Go back to fast mode']) assert.equal(modelModeIntent(q),'normal');
 assert.equal(modelModeIntent('Do not switch to coding mode'),null);
 assert.equal(modelModeIntent('Write a function that prints coding mode'),null);
});

test('coding selection is installed/local only, persists, stays scoped and never downloads or silently falls back',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-model-router-')), calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url:String(url),method:options?.method});return Response.json(tags);};
 const router=createModelRouter({directory,base:'http://127.0.0.1:11434',fastModel:'fast:test',fetchImpl});
 assert.equal((await router.switchMode(scope,'coding')).ok,false);assert.equal(router.route(scope).mode,'normal');
 await assert.rejects(router.configure({codingModel:'other-cloud'}));
 await assert.rejects(router.configure({codingModel:'fast:test'}));
 await assert.rejects(router.configure({codingModel:'not-installed'}));
 await router.configure({codingModel:'coder:test'});
 assert.equal((await router.switchMode(scope,'coding')).ok,true);assert.equal(router.route(scope).model,'coder:test');
 assert.equal(router.route({...scope,profileId:'wade'}).mode,'normal');assert.equal(router.route({...scope,room:'living-room'}).mode,'normal');
 const restored=createModelRouter({directory,base:'http://127.0.0.1:11434',fastModel:'fast:test',fetchImpl});await restored.initialize();
 assert.equal((await restored.catalog()).codingModel,'coder:test');assert.equal(restored.route(scope).mode,'normal');
 assert.ok(calls.every(c=>c.url.endsWith('/api/tags')&&!c.method));
 await router.switchMode(scope,'normal');assert.equal(router.route(scope).model,'fast:test');
 await router.switchMode(scope,'coding');router.clear(scope);assert.equal(router.route(scope).mode,'normal');
});

test('invalid saved settings stay preserved and unavailable models cannot activate coding mode',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-model-invalid-'));
 await writeFile(path.join(directory,'model-routing.json'),'broken original');
 const router=createModelRouter({directory,base:'http://127.0.0.1:11434',fastModel:'fast:test',fetchImpl:async()=>Response.json(tags)});
 assert.equal((await router.catalog()).configurationError,true);await assert.rejects(router.configure({codingModel:'coder:test'}));
 assert.equal(await readFile(path.join(directory,'model-routing.json'),'utf8'),'broken original');
 const missing=createModelRouter({directory:await mkdtemp(path.join(tmpdir(),'jarvis-model-missing-')),base:'http://127.0.0.1:11434',fastModel:'fast:test',codingModel:'missing:test',fetchImpl:async()=>Response.json(tags)});
 assert.equal((await missing.switchMode(scope,'coding')).ok,false);assert.equal(missing.route(scope).mode,'normal');
});

test('server switches actual generation targets, keeps code out of house tools, allows longer inputs only in coding mode, and resets',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-model-server-')),requests=[];
 const model=http.createServer(async(req,res)=>{
  if(req.method==='GET')return res.end(JSON.stringify(tags));
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));requests.push(body);
  res.end(JSON.stringify({message:{content:body.model==='coder:test'?'```js\nconst result = 42;\n```':'Fast answer.'},done:true})+'\n');
 });
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 const app=createJarvisServer({model:'fast:test',codingModel:'coder:test',ollamaUrl:'http://127.0.0.1:'+model.address().port,displayBind:'',actionsOptions:{dataDirectory:directory},pairingOptions:{directory},speech:{listVoices:async()=>({available:false}),close(){}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const post=(endpoint,body,headers={})=>fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 async function ask(question){
  const abort=new AbortController(),events=await fetch(base+'/api/events?room=bedroom-1',{signal:abort.signal});
  const accepted=await post('/api/ask',{room:'bedroom-1',question});assert.equal(accepted.status,202);const {requestId}=await accepted.json();let buffer='';
  try{for await(const chunk of events.body){buffer+=new TextDecoder().decode(chunk);let end;while((end=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,end);buffer=buffer.slice(end+2);if(!packet.startsWith('data: '))continue;const s=JSON.parse(packet.slice(6));if(s.requestId===requestId&&['ready','error'].includes(s.state)){assert.equal(s.state,'ready',s.error);return s;}}}}finally{abort.abort();}
 }
 try{
  assert.equal((await fetch(base+'/models')).status,200);assert.equal((await fetch(base+'/models.js')).status,200);
  assert.equal((await post('/api/models',{codingModel:'coder:test'},{Origin:'https://other.example'})).status,403);
  assert.equal((await post('/api/models',{codingModel:'coder:test'})).status,200);
  assert.equal((await post('/api/ask',{room:'bedroom-1',question:'x'.repeat(1000)})).status,400);
  const switchResult=await ask('Coding mode');assert.equal(switchResult.modelMode,'coding');assert.equal(requests.length,0);
  const code=await ask('Write JavaScript that prints "add a chore and start a timer".\n'+ '// code context\n'.repeat(70));
  assert.equal(code.modelName,'coder:test');assert.equal(requests.at(-1).model,'coder:test');assert.equal(requests.at(-1).options.num_ctx,8192);
  assert.equal(requests.at(-1).options.num_predict,2048);assert.match(requests.at(-1).messages[0].content,/do not have a filesystem editor/);
  assert.equal((await(await fetch(base+'/api/dashboard')).json()).timers.timers.length,0);
  await ask('Normal mode');await ask('Explain recursion');assert.equal(requests.at(-1).model,'fast:test');assert.equal(requests.at(-1).options.num_ctx,2048);
  await ask('Coding mode');await post('/api/reset',{room:'bedroom-1'});
  const state=await(await fetch(base+'/api/models?room=bedroom-1')).json();assert.equal(state.active.mode,'normal');
 }finally{await app.shutdown();await new Promise(r=>model.close(r));}
});
