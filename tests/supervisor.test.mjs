import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,writeFile,readFile,unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSupervisor,projectId } from '../supervisor.mjs';

async function freePort(){const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function until(check,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,70));}throw Error('Timed out waiting for supervisor state');}
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'jarvis-supervisor-test-')),port=await freePort(),supervisorPort=await freePort();
 const serverFile=path.join(root,'fixture.mjs'),runtimeDirectory=path.join(root,'runtime'),hangFile=path.join(root,'hang');
 await writeFile(serverFile,`import http from 'node:http';import {existsSync} from 'node:fs';const server=http.createServer((req,res)=>{if(existsSync(${JSON.stringify(hangFile)}))return;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'jarvis-local-house',projectId:${JSON.stringify(projectId(root))},pid:process.pid}));});server.listen(Number(process.env.JARVIS_PORT),'127.0.0.1');`);
 const options={root,port,supervisorPort,serverFile,runtimeDirectory,pollMs:100,timeoutMs:250,startupGraceMs:900,failureLimit:2,backoffMs:[70,150],watch:false,ensureOllama:false};
 return{root,port,supervisorPort,hangFile,runtimeDirectory,options};
}
test('owned server crashes recover, duplicate supervisors do not duplicate servers, and stop releases the child',async()=>{
 const f=await fixture(),supervisor=createSupervisor(f.options),running=supervisor.run();
 try{
  await until(()=>supervisor.state().state==='healthy');const original=supervisor.state().serverPid;
  const duplicate=await createSupervisor(f.options).run();assert.equal(duplicate.duplicate,true);
  assert.equal(supervisor.state().starts,1);
  process.kill(original,'SIGKILL');
  await until(()=>supervisor.state().state==='healthy'&&supervisor.state().serverPid!==original);
  assert.ok(supervisor.state().restarts>=1);
  const pid=supervisor.state().serverPid;await writeFile(path.join(f.runtimeDirectory,'stop.request'),'stop');await running;
  await until(()=>{try{process.kill(pid,0);return false;}catch{return true;}});
  const state=JSON.parse(await readFile(path.join(f.runtimeDirectory,'supervisor.json'),'utf8'));assert.equal(state.state,'stopped');
 }finally{supervisor.stop();await running;}
});
test('unresponsive owned servers are restarted after repeated failed lightweight checks',async()=>{
 const f=await fixture(),supervisor=createSupervisor(f.options),running=supervisor.run();
 try{
  await until(()=>supervisor.state().state==='healthy');const original=supervisor.state().serverPid;await writeFile(f.hangFile,'hang');
  await until(()=>supervisor.state().starts>=2);await unlink(f.hangFile);
  await until(()=>supervisor.state().state==='healthy'&&supervisor.state().serverPid!==original);
  assert.match(await readFile(path.join(f.runtimeDirectory,'recovery.log'),'utf8'),/health-restart/);
 }finally{supervisor.stop();await running;}
});
test('another application on the server port is never stopped or replaced',async()=>{
 const f=await fixture();let requests=0;const foreign=http.createServer((_req,res)=>{requests++;res.end(JSON.stringify({app:'unrelated'}));});await new Promise(r=>foreign.listen(f.port,'127.0.0.1',r));
 const supervisor=createSupervisor(f.options),running=supervisor.run();
 try{await until(()=>supervisor.state().state==='port conflict');assert.equal(supervisor.state().starts,0);assert.equal(foreign.listening,true);assert.ok(requests>0);}
 finally{supervisor.stop();await running;await new Promise(r=>foreign.close(r));}
});
