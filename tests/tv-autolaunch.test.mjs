import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTvAutolaunch } from '../tv-autolaunch.mjs';
import { createSamsungLauncher, wakePacket } from '../samsung-launcher.mjs';
import { createJarvisServer } from '../server.mjs';
const directory=()=>mkdtemp(path.join(tmpdir(),'jarvis-tv-launch-'));
async function fixture(){
 const dir=await directory();let stamp=0,shown=false,online=true,showOnLaunch=true,launches=0,wakes=0;
 const targets=[{id:'test-tv',name:'Test TV',room:'bedroom-1'}];
 const remote={status:async()=>({configured:true}),online:async()=>online,launchBrowser:async()=>{launches++;if(showOnLaunch)shown=true;},wake:async()=>{wakes++;online=true;}};
 const service=createTvAutolaunch({directory:dir,pairing:{list:async()=>({devices:targets})},receiver:()=>({enabled:true,url:'http://192.168.1.5:3211/'}),visible:()=>shown,remote,now:()=>stamp,wait:async ms=>{stamp+=ms;},confirmMs:500});
 const config={enabled:true,displayId:'test-tv',wake:false,mac:''};
 return{service,dir,targets,config,setOffline:()=>{online=false;},hide:()=>{shown=false;showOnLaunch=false;},counts:()=>({launches,wakes})};
}

test('automatic launch is opt-in, room scoped, and only confirmed by visible receiver presence',async()=>{
 const f=await fixture();assert.equal((await f.service.ensure('bedroom-1')).state,'disabled');
 await f.service.configure(f.config);assert.equal((await f.service.ensure('bedroom-2')).state,'disabled');assert.equal(f.counts().launches,0);
 assert.equal((await f.service.ensure('bedroom-1')).state,'confirmed');assert.equal(f.counts().launches,1);
 await f.service.ensure('bedroom-1');assert.equal(f.counts().launches,1);
 f.hide();assert.equal((await f.service.ensure('bedroom-1')).state,'unconfirmed');assert.equal(f.counts().launches,3);
 f.targets.length=0;assert.equal((await f.service.ensure('bedroom-1')).state,'disabled');await f.service.close();
});

test('wake is explicit and requires a MAC; disabled auto mode still allows a deliberate test',async()=>{
 const f=await fixture();await assert.rejects(f.service.configure({...f.config,wake:true}));
 await f.service.configure({...f.config,enabled:false});assert.equal((await f.service.ensure('bedroom-1')).state,'disabled');
 f.setOffline();assert.equal((await f.service.ensure('bedroom-1',{force:true})).state,'unavailable');assert.equal(f.counts().wakes,0);
 await f.service.configure({...f.config,wake:true,mac:'AA:BB:CC:DD:EE:FF'});
 assert.equal((await f.service.ensure('bedroom-1')).state,'confirmed');assert.equal(f.counts().wakes,1);await f.service.close();
});

test('corrupt launch settings stay intact and cancelled attempts do not report success',async()=>{
 const f=await fixture();await writeFile(path.join(f.dir,'tv-autolaunch.json'),'broken original');assert.equal((await f.service.status()).configurationError,true);
 await assert.rejects(f.service.configure(f.config));assert.equal(await readFile(path.join(f.dir,'tv-autolaunch.json'),'utf8'),'broken original');
 const other=await fixture();await other.service.configure(other.config);other.hide();const abort=new AbortController();abort.abort(Error('cancelled'));
 assert.equal((await other.service.ensure('bedroom-1',{signal:abort.signal})).state,'cancelled');await other.service.close();
});

test('Samsung launcher pins TLS, keeps tokens out of status, sends only the configured URL and builds a valid wake packet',async()=>{
 const dir=await directory(),sent=[];let options;
 await writeFile(path.join(dir,'samsung-tv.json'),JSON.stringify({host:'192.168.1.20',token:'fake-test-token'}));
 await writeFile(path.join(dir,'samsung-tv-certificate.pem'),rootCertificates[0]);
 class Socket extends EventEmitter{constructor(_url,opts){super();options=opts;queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({event:'ms.channel.connect'}))));}send(data){sent.push(JSON.parse(data));}terminate(){}}
 const remote=createSamsungLauncher({directory:dir,WebSocketImpl:Socket});
 assert.equal(JSON.stringify(await remote.status()).includes('fake-test-token'),false);
 await remote.launchBrowser('http://192.168.1.5:3211/');assert.equal(sent[0].params.data.appId,'org.tizen.browser');assert.equal(sent[0].params.data.metaTag,'http://192.168.1.5:3211/');
 assert.ok(options.ca);assert.equal(options.checkServerIdentity('ignored',{fingerprint256:new X509Certificate(rootCertificates[0]).fingerprint256}),undefined);assert.ok(options.checkServerIdentity('ignored',{fingerprint256:'different'}) instanceof Error);
 await assert.rejects(remote.launchBrowser('https://example.com/'));assert.equal(sent.length,1);
 const packet=wakePacket('AA:BB:CC:DD:EE:FF');assert.equal(packet.length,102);assert.ok(packet.subarray(0,6).equals(Buffer.alloc(6,255)));assert.equal(packet.subarray(6,12).toString('hex'),'aabbccddeeff');assert.throws(()=>wakePacket('invalid'));
});

test('paired receiver reports presence without receiving control privileges, and settings reject cross-origin writes',async()=>{
 const dir=await directory();let launches=0;
 const app=createJarvisServer({displayBind:'127.0.0.1',actionsOptions:{dataDirectory:dir},pairingOptions:{directory:dir},speech:{listVoices:async()=>({available:false}),close(){}},tvLaunchOptions:{remote:{status:async()=>({configured:true}),online:async()=>true,launchBrowser:async()=>{launches++;}},confirmMs:50}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));await new Promise(r=>app.displayServer.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port,tv='http://127.0.0.1:'+app.displayServer.address().port;
 const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const abort=new AbortController();let reader;
 try{
  assert.equal((await fetch(base+'/tv-launch')).status,200);
  assert.equal((await post(base+'/api/tv-launch',{}, {Origin:'https://outside.example'})).status,403);
  assert.equal((await post(tv+'/api/presence',{visible:true})).status,401);
  const start=await(await post(base+'/api/pairing/start',{room:'bedroom-1'})).json();
  const paired=await post(tv+'/api/pair',{code:start.code,name:'Test receiver'}),cookie=paired.headers.get('set-cookie').split(';')[0];
  const list=await(await fetch(base+'/api/displays')).json();const id=list.devices[0].id;
  const stream=await fetch(tv+'/api/events',{headers:{Cookie:cookie},signal:abort.signal});reader=stream.body.getReader();await reader.read();
  assert.equal((await post(tv+'/api/presence',{visible:true},{Cookie:cookie})).status,200);
  assert.equal((await post(tv+'/api/presence',{visible:true,room:'bedroom-2'},{Cookie:cookie})).status,400);
  assert.equal((await post(tv+'/api/ask',{question:'anything'},{Cookie:cookie})).status,403);
  await post(base+'/api/tv-launch',{enabled:false,displayId:id,wake:false,mac:''});
  assert.equal((await(await post(base+'/api/tv-launch/test',{})).json()).state,'confirmed');assert.equal(launches,0);
  await post(tv+'/api/presence',{visible:false},{Cookie:cookie});
  await post(base+'/api/tv-launch',{enabled:true,displayId:id,wake:false,mac:''});
  assert.equal((await post(base+'/api/ask',{room:'bedroom-1',question:'What time is it?'})).status,202);
  for(let i=0;i<60;i++){const result=await(await fetch(base+'/api/tv-launch')).json();if(result.lastAttempt?.state==='unconfirmed')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal((await(await fetch(base+'/api/tv-launch')).json()).lastAttempt.state,'unconfirmed');assert.equal(launches,2);
  assert.equal((await post(base+'/api/ask',{room:'bedroom-2',question:'What time is it?'})).status,202);await new Promise(r=>setTimeout(r,60));assert.equal(launches,2);
  await post(base+'/api/displays/revoke',{id});assert.equal((await post(tv+'/api/presence',{visible:true},{Cookie:cookie})).status,401);
 }finally{abort.abort();await reader?.cancel().catch(()=>{});await app.shutdown();}
});
