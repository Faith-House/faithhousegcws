import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, stat, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const projectId = root => createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = child => child && child.exitCode === null && !child.killed;
async function portOpen(port) {
  return new Promise(resolve => { const socket = net.connect({host:'127.0.0.1',port}); const finish = value => { socket.destroy(); resolve(value); }; socket.setTimeout(700,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false)); });
}
export async function stopOwnedTree(child) {
  if (!alive(child)) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => { const stop = spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});stop.once('error',resolve);stop.once('exit',resolve); });
  } else child.kill('SIGTERM');
}

export function createSupervisor({ root = path.dirname(fileURLToPath(import.meta.url)), nodePath = process.execPath, ollamaPath = null, port = 3210, supervisorPort = 3212, pollMs = 10000, timeoutMs = 3000, startupGraceMs = 45000, failureLimit = 3, backoffMs = [2000,5000,10000,30000,60000], runtimeDirectory = path.join(root,'private','runtime'), serverFile = path.join(root,'server.mjs'), watch = true, ensureOllama = true } = {}) {
  const identity=projectId(root), stateFile=path.join(runtimeDirectory,'supervisor.json'), stopFile=path.join(runtimeDirectory,'stop.request');
  let child=null,ollamaChild=null,stopping=false,startedAt=0,nextStart=0,attempt=0,failures=0,ollamaRetry=0,writeChain=Promise.resolve(),slot;
  const state={app:'jarvis-supervisor',projectId:identity,pid:process.pid,startedAt:Date.now(),checkedAt:0,state:'starting',serverPid:null,serverOwned:false,starts:0,restarts:0,lastReason:null,ollama:'not checked'};
  async function log(type,code=null) {
    try { const file=path.join(runtimeDirectory,'recovery.log');try{if((await stat(file)).size>131072)await rename(file,file+'.previous').catch(()=>{});}catch{}await appendFile(file,JSON.stringify({at:Date.now(),type,...(code!==null?{code}: {})})+'\n',{mode:0o600}); } catch {}
  }
  function save() {
    const snapshot={...state,checkedAt:Date.now()};state.checkedAt=snapshot.checkedAt;
    writeChain=writeChain.then(async()=>{await writeFile(stateFile+'.tmp',JSON.stringify(snapshot,null,2)+'\n',{mode:0o600});await rename(stateFile+'.tmp',stateFile);}).catch(()=>{});
    return writeChain;
  }
  async function health() {
    try { const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(timeoutMs),redirect:'error'});const data=await r.json();return r.ok&&data.app==='jarvis-local-house'&&data.projectId===identity?data:null; }catch{return null;}
  }
  function spawnServer() {
    if(stopping||alive(child))return;
    startedAt=Date.now();state.starts++;if(state.starts>1)state.restarts++;state.state='starting';state.serverOwned=true;
    const args=[...(watch?['--watch']:[]),'--env-file-if-exists=.env.local',serverFile];
    const launched=spawn(nodePath,args,{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,JARVIS_PORT:String(port)}});child=launched;state.serverPid=launched.pid||null;
    void log(state.starts===1?'server-started':'server-restarted');
    const exited=code=>{if(child!==launched)return;child=null;state.serverPid=null;if(!stopping){state.state='recovering';state.lastReason='server exited';nextStart=Date.now()+backoffMs[Math.min(attempt++,backoffMs.length-1)];void log('server-exited',code);}void save();};
    launched.once('error',()=>exited('spawn-error'));launched.once('exit',exited);
  }
  async function maintainOllama() {
    if(!ensureOllama){state.ollama='not managed';return;}
    try {const r=await fetch('http://127.0.0.1:11434/api/version',{signal:AbortSignal.timeout(timeoutMs),redirect:'error'});const data=await r.json();if(r.ok&&typeof data.version==='string'){state.ollama='responding';return;}}catch{}
    state.ollama='unavailable';
    if(!ollamaPath||alive(ollamaChild)||Date.now()<ollamaRetry||await portOpen(11434))return;
    ollamaRetry=Date.now()+60000;state.ollama='starting';
    ollamaChild=spawn(ollamaPath,['serve'],{cwd:root,windowsHide:true,stdio:'ignore'});ollamaChild.once('error',()=>{state.ollama='start failed';});ollamaChild.once('exit',()=>{ollamaChild=null;});void log('ollama-start-requested');
  }
  async function tick() {
    await maintainOllama();const reply=await health();
    if(reply){failures=0;state.state='healthy';state.serverPid=reply.pid;state.serverOwned=Boolean(alive(child));if(Date.now()-startedAt>60000)attempt=0;await save();return;}
    if(alive(child)){
      if(Date.now()-startedAt<startupGraceMs){state.state='starting';await save();return;}
      failures++;state.state='checking';
      if(failures>=failureLimit){state.lastReason='health checks failed';await log('health-restart');const failed=child;child=null;await stopOwnedTree(failed);state.serverPid=null;failures=0;nextStart=Date.now()+backoffMs[Math.min(attempt++,backoffMs.length-1)];state.state='recovering';}
    }else if(await portOpen(port)){state.state='port conflict';state.serverOwned=false;state.serverPid=null;state.lastReason='An unverified or unhealthy process owns the server port; it was not stopped.';}
    else if(Date.now()>=nextStart){spawnServer();}
    await save();
  }
  async function run() {
    await mkdir(runtimeDirectory,{recursive:true});
    slot=http.createServer((request,response)=>{
      const host=request.headers.host;
      if(![`127.0.0.1:${supervisorPort}`,`localhost:${supervisorPort}`].includes(host)||request.method!=='GET'||request.url!=='/health'){response.writeHead(403);return response.end();}
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(state));
    });
    const claimed=await new Promise((resolve,reject)=>{slot.once('error',error=>error.code==='EADDRINUSE'?resolve(false):reject(error));slot.listen(supervisorPort,'127.0.0.1',()=>resolve(true));});
    if(!claimed){
      const r=await fetch(`http://127.0.0.1:${supervisorPort}/health`,{signal:AbortSignal.timeout(timeoutMs)}).catch(()=>null);const existing=await r?.json().catch(()=>null);
      if(existing?.app==='jarvis-supervisor'&&existing.projectId===identity)return {duplicate:true};
      throw Error('The supervisor port is occupied by another application.');
    }
    await log('supervisor-started');
    try {
      while(!stopping){if(await stat(stopFile).then(()=>true,()=>false)){stopping=true;break;}await tick();if(!stopping)await delay(pollMs);}
    }finally{await stopOwnedTree(child);state.state='stopped';state.serverOwned=false;state.serverPid=null;await save();await log('supervisor-stopped');await new Promise(resolve=>slot.close(resolve));ollamaChild?.unref();}
    return {duplicate:false};
  }
  return {run,stop:()=>{stopping=true;},state:()=>({...state})};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const root=path.dirname(fileURLToPath(import.meta.url));
  const options=JSON.parse((await readFile(path.join(root,'private','startup.json'),'utf8')).replace(/^\uFEFF/,''));
  const supervisor=createSupervisor({root,...options});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>supervisor.stop());
  supervisor.run().then(()=>process.exit(0)).catch(error=>{console.error('Jarvis supervisor could not start:',error.message);process.exit(1);});
}
