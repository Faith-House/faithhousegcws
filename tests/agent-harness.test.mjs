import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentHarness} from '../agent-harness.mjs';
import {createJarvisServer} from '../server.mjs';
import {createDiscordBridge} from '../discord-bridge.mjs';

const identity={requestId:'test',sessionKey:'room:bedroom-1:cooper'};

test('LangGraph routes handled actions to completion without generating a speculative answer',async()=>{
 const harness=createAgentHarness(),calls=[];
 const report=await harness.run(identity,{prepare:()=>calls.push('context'),route:()=> 'actions',actions:()=>{calls.push('tool');return true;},conversation:()=>calls.push('model'),complete:()=>calls.push('commit')});
 assert.deepEqual(calls,['context','tool','commit']);assert.deepEqual(report.steps,['prepare','route','actions','complete']);assert.equal(report.status,'completed');
 assert.equal(harness.status().engine,'LangGraph.js');assert.equal(harness.status().checkpointing,false);
});

test('unhandled actions fall back to conversation; conversation-only and ignored turns do not run actions',async()=>{
 const harness=createAgentHarness(),calls=[];
 await harness.run(identity,{route:()=> 'actions',actions:()=>false,conversation:()=>calls.push('answer'),complete:()=>calls.push('commit')});
 assert.deepEqual(calls,['answer','commit']);calls.length=0;
 await harness.run(identity,{route:()=> 'conversation',actions:()=>calls.push('bad'),conversation:()=>calls.push('answer')});assert.deepEqual(calls,['answer']);calls.length=0;
 const ignored=await harness.run(identity,{route:()=> 'ignore',actions:()=>calls.push('bad'),conversation:()=>calls.push('bad'),complete:()=>calls.push('bad')});assert.deepEqual(calls,[]);assert.deepEqual(ignored.steps,['prepare','route']);
});

test('failed side effects are not retried and cannot fall through to a fabricated completion',async()=>{
 const harness=createAgentHarness();let writes=0,answered=0;
 await assert.rejects(harness.run(identity,{route:()=> 'actions',actions:()=>{writes++;throw Error('Device did not confirm');},conversation:()=>answered++,complete:()=>answered++}),/Device did not confirm/);
 assert.equal(writes,1);assert.equal(answered,0);assert.equal(harness.status().recent.at(-1).status,'failed');
});

test('cancellation between routing and execution prevents tools and completion',async()=>{
 const harness=createAgentHarness(),controller=new AbortController();let writes=0;
 await assert.rejects(harness.run(identity,{route:()=>{controller.abort(Error('cancelled'));return 'actions';},actions:()=>writes++,complete:()=>writes++},{signal:controller.signal}),/cancelled/);
 assert.equal(writes,0);assert.equal(harness.status().recent.at(-1).status,'cancelled');
});

test('replaced requests and unknown routes stop before actions',async()=>{
 const harness=createAgentHarness();let writes=0;
 await assert.rejects(harness.run(identity,{isCurrent:()=>false,actions:()=>writes++}),/replaced/);
 await assert.rejects(harness.run(identity,{route:()=> 'shell',actions:()=>writes++}),/Unknown agent route/);assert.equal(writes,0);
});

test('simultaneous scopes keep handlers and graph state separate; reports contain no conversation text',async()=>{
 const harness=createAgentHarness(),events=[];
 await Promise.all(['cooper','wade'].map(user=>harness.run({requestId:user,sessionKey:user},{prepare:async()=>{await new Promise(r=>setTimeout(r,4));},route:()=> 'conversation',conversation:()=>events.push(user),complete:()=>events.push(user+':done')})));
 assert.equal(events.filter(e=>e==='cooper').length,1);assert.equal(events.filter(e=>e==='wade').length,1);
 assert.equal(harness.status().recent.length,2);assert.equal(JSON.stringify(harness.status()).includes('handlers'),false);
});

test('real HTTP requests route through LangGraph for tools and streamed model replies',async()=>{
 const fake=http.createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.end(JSON.stringify({message:{content:'I would choose the rice bowl.'},done:true})+'\n');});
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-graph-'));
 const app=createJarvisServer({ollamaUrl:'http://127.0.0.1:'+fake.address().port,displayBind:'',phoneBind:'',actionsOptions:{dataDirectory:directory},pairingOptions:{directory},speech:{listVoices:async()=>({available:false}),close(){}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port,bridge=createDiscordBridge({baseUrl:()=>base});
 try{
  const clock=await bridge.ask('test',{room:'bedroom-1',profileId:null},'What time is it?');assert.match(clock.answer,/It is/);
  const chat=await bridge.ask('test',{room:'bedroom-2',profileId:null},'Give me three dinner ideas and tell me which is easiest.');assert.equal(chat.answer,'I would choose the rice bowl.');
  let status;
  for(let i=0;i<100;i++){status=await(await fetch(base+'/api/harness')).json();if(status.recent.length===2&&status.recent.every(r=>r.status==='completed'))break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(status.engine,'LangGraph.js');assert.deepEqual(status.recent[0].steps,['prepare','route','actions','complete']);assert.deepEqual(status.recent[1].steps,['prepare','route','actions','conversation','complete']);
  assert.notEqual(status.recent[0].sessionKey,status.recent[1].sessionKey);
 }finally{bridge.close();await app.shutdown();await new Promise(r=>fake.close(r));}
});
