import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp,readFile,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { createPhoneHandler } from '../phone-access.mjs';
import { createDisplayPairing } from '../display-pairing.mjs';
import { preparePhoneTls } from '../phone-tls.mjs';
import { createJarvisServer } from '../server.mjs';

test('phone pairing binds a profile, stores only token hashes and revokes independently from TV sessions',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jarvis-phone-pair-'));
 const phones=createDisplayPairing({rooms:['bedroom-1'],directory:path.join(dir,'phones'),includeProfile:true});
 const tvs=createDisplayPairing({rooms:['bedroom-1'],directory:path.join(dir,'tvs')});
 const code=await phones.start('bedroom-1','cooper'),paired=await phones.pair({code:code.code,name:'Test phone',address:'test'});
 assert.equal((await phones.authenticate(paired.token)).profileId,'cooper');assert.equal(await tvs.authenticate(paired.token),null);
 assert.equal((await readFile(path.join(dir,'phones','displays.json'),'utf8')).includes(paired.token),false);
 await assert.rejects(phones.pair({code:code.code,name:'Another phone',address:'test'}));
 await phones.revoke(paired.id);assert.equal(await phones.authenticate(paired.token),null);await phones.close();await tvs.close();
});

test('phone gateway enforces pairing, assigned room/profile, owned requests, origin and central settings boundaries',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jarvis-phone-gateway-')),calls=[];
 const states={'bedroom-1':{state:'idle',answer:'Room one'},'bedroom-2':{state:'idle',answer:'Other room private text'}},subscribers=new Map();
 let number=0,phone,gateway;
 const central=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);let data;
  if(req.url.startsWith('/api/transcribe'))data={text:'What time is it?'};
  else{const input=JSON.parse(bytes);calls.push({path:req.url,body:input});data=req.url==='/api/ask'?{requestId:'request-'+(++number)}:{ok:true};}
  if(req.url==='/api/speech'){res.writeHead(200,{'Content-Type':'audio/wav'});return res.end(Buffer.from('TEST WAVE'));}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
 });
 await new Promise(r=>central.listen(0,'127.0.0.1',r));
 const pairing=createDisplayPairing({rooms:['bedroom-1','bedroom-2'],directory:dir,includeProfile:true,onRevoke:id=>gateway.revoke(id)});
 gateway=createPhoneHandler({pairing,bindAddress:'127.0.0.1',port:()=>phone.address().port,centralUrl:()=>`http://127.0.0.1:${central.address().port}/`,snapshot:room=>states[room],subscribe:(room,response)=>{subscribers.set(room,response);return()=>subscribers.delete(room);},profiles:{get:async id=>id==='cooper'?{id,name:'Cooper'}:null},modelRoute:()=>({mode:'normal',maxInputChars:600})});
 phone=http.createServer(gateway.handler);await new Promise(r=>phone.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+phone.address().port;
 let cookie='';const post=(endpoint,data,headers={})=>fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(data)});
 const abort=new AbortController();let reader;
 try{
  assert.equal((await fetch(base+'/')).status,200);assert.equal((await post('/api/ask',{question:'Hello'})).status,401);
  const code=await pairing.start('bedroom-1','cooper');const paired=await post('/api/pair',{code:code.code,name:'Phone test'});assert.equal(paired.status,200);
  const setCookie=paired.headers.get('set-cookie');for(const attr of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(setCookie.includes(attr));cookie=setCookie.split(';')[0];
  const session=await(await fetch(base+'/api/session?room=bedroom-2',{headers:{Cookie:cookie}})).json();assert.equal(session.room,'bedroom-1');assert.equal(session.profile.name,'Cooper');assert.equal(JSON.stringify(session).includes('token'),false);
  assert.equal((await post('/api/ask',{question:'Time?',room:'bedroom-2'})).status,400);assert.equal((await post('/api/ask',{question:'Time?',profileId:'wade'})).status,400);
  assert.equal((await post('/api/ask',{question:'Hello'},{Origin:'https://outside.example'})).status,403);
  assert.equal((await post('/api/phones/revoke',{id:'anything'})).status,403);assert.equal((await post('/api/models',{codingModel:'anything'})).status,403);assert.equal((await fetch(base+'/api/profiles',{headers:{Cookie:cookie}})).status,403);
  const asked=await(await post('/api/ask',{question:'What time is it?'})).json();assert.equal(calls.at(-1).body.room,'bedroom-1');assert.equal(calls.at(-1).body.profileId,'cooper');
  assert.equal((await post('/api/cancel',{requestId:'somebody-else'})).status,403);assert.equal((await post('/api/speech',{requestId:'somebody-else'})).status,403);
  assert.equal((await post('/api/cancel',{requestId:asked.requestId})).status,200);assert.equal(calls.at(-1).body.room,'bedroom-1');
  const audio=await post('/api/speech',{requestId:asked.requestId});assert.equal(audio.headers.get('content-type'),'audio/wav');assert.equal(await audio.text(),'TEST WAVE');
  const stream=await fetch(base+'/api/events?room=bedroom-2',{headers:{Cookie:cookie},signal:abort.signal});reader=stream.body.getReader();const initial=new TextDecoder().decode((await reader.read()).value);assert.ok(initial.includes('Room one'));assert.equal(initial.includes('Other room private'),false);
  const id=(await pairing.list()).devices[0].id;await pairing.revoke(id);assert.equal((await fetch(base+'/api/session',{headers:{Cookie:cookie}})).status,401);
 }finally{abort.abort();await reader?.cancel().catch(()=>{});gateway.close();await pairing.close();await new Promise(r=>phone.close(r));await new Promise(r=>central.close(r));}
});

test('phone TLS signs the server for its LAN address and supports a verified HTTPS client without changing global trust',async t=>{
 const openssl='C:/Program Files/Git/usr/bin/openssl.exe';if(!await access(openssl).then(()=>true,()=>false)){t.skip('OpenSSL is required for the phone certificate setup test.');return;}
 const dir=await mkdtemp(path.join(tmpdir(),'jarvis-phone-tls-'));
 const first=await preparePhoneTls({directory:dir,address:'192.168.1.20',openssl});
 const ca=new X509Certificate(await readFile(path.join(dir,'ca.pem'))),leaf=new X509Certificate(await readFile(path.join(dir,'server.pem')));
 assert.equal(ca.ca,true);assert.equal(leaf.ca,false);assert.equal(leaf.checkIP('192.168.1.20'),'192.168.1.20');assert.equal(leaf.verify(ca.publicKey),true);
 const second=await preparePhoneTls({directory:dir,address:'192.168.1.20',openssl});assert.equal(first.caFingerprint,second.caFingerprint);
 const server=https.createServer({key:await readFile(path.join(dir,'server.key')),cert:await readFile(path.join(dir,'server.pem'))},(_req,res)=>res.end('secure phone transport'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const text=await new Promise((resolve,reject)=>{https.get({hostname:'127.0.0.1',port:server.address().port,ca:ca.toString()},response=>{let text='';response.on('data',c=>{text+=c;});response.on('end',()=>resolve(text));}).on('error',reject);});assert.equal(text,'secure phone transport');}finally{await new Promise(r=>server.close(r));}
 await assert.rejects(preparePhoneTls({directory:dir,address:'8.8.8.8',openssl}));
});

test('central phone settings stay on localhost, do not grant a phone pairing while disabled, and serve setup resources',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jarvis-phone-settings-'));const app=createJarvisServer({displayBind:'',phoneBind:'',actionsOptions:{dataDirectory:dir},pairingOptions:{directory:dir},speech:{listVoices:async()=>({available:false}),close(){}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{
  assert.equal((await fetch(base+'/phones')).status,200);assert.equal((await fetch(base+'/phones.js')).status,200);
  assert.equal((await(await fetch(base+'/api/phones')).json()).enabled,false);
  const post=(headers)=>fetch(base+'/api/phones/pairing',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({room:'bedroom-1',profileId:null})});
  assert.equal((await post({})).status,409);assert.equal((await post({Origin:'https://outside.example'})).status,403);
 }finally{await app.shutdown();}
});
