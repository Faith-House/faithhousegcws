import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { privateIPv4 } from './samsung-launcher.mjs';
const publicRoot=new URL('./public/',import.meta.url);
const assets=new Map([['/',['phone.html','text/html; charset=utf-8']],['/phone.js',['phone.js','text/javascript; charset=utf-8']],['/phone.css',['phone.css','text/css; charset=utf-8']],['/orb.js',['orb.js','text/javascript; charset=utf-8']],['/microphone.js',['microphone.js','text/javascript; charset=utf-8']],['/microphone-worklet.js',['microphone-worklet.js','text/javascript; charset=utf-8']],['/agenda.js',['agenda.js','text/javascript; charset=utf-8']],['/weather-view.js',['weather-view.js','text/javascript; charset=utf-8']],['/weather.css',['weather.css','text/css; charset=utf-8']],['/calendar.css',['calendar.css','text/css; charset=utf-8']],['/favicon.svg',['favicon.svg','image/svg+xml']]]);
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req,limit=131072){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>limit)throw Object.assign(Error('That request is too large.'),{status:413});chunks.push(c);}return Buffer.concat(chunks);}
async function jsonBody(req){if(req.headers['content-type']!=='application/json')throw Object.assign(Error('Use the phone app.'),{status:415});try{return JSON.parse((await body(req)).toString());}catch(error){if(error.status)throw error;throw Object.assign(Error('Enter a valid phone request.'),{status:400});}}
const allowed=(input,keys)=>input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>keys.includes(k));
export function createPhoneHandler({ pairing,bindAddress,port,centralUrl,snapshot,subscribe,profiles,modelRoute }={}){
 const streams=new Map(),owned=new Map(),controllers=new Map();
 const revoke=id=>{for(const res of streams.get(id)||[]){res.write('event: revoked\ndata: {}\n\n');res.end();}streams.delete(id);owned.delete(id);for(const [controller,owner]of controllers)if(owner===id)controller.abort();};
 async function proxy(req,res,endpoint,options={},owner){
  const controller=new AbortController();controllers.set(controller,owner);res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{const result=await fetch(new URL(endpoint,centralUrl()),{...options,signal:controller.signal,redirect:'error'});
   res.writeHead(result.status,{'Content-Type':result.headers.get('content-type')||'application/json','Cache-Control':'no-store'});
   if(result.body)for await(const chunk of result.body){if(res.destroyed)break;res.write(chunk);}res.end();
  }finally{controllers.delete(controller);}
 }
 const handler=async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), geolocation=(), microphone=(self)');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   const host=new URL('https://'+(req.headers.host||''));
   if(![bindAddress,'127.0.0.1','localhost'].includes(host.hostname)||Number(host.port)!==Number(typeof port==='function'?port():port))return json(res,403,{error:'Use the configured Jarvis phone address.'});
   if(req.headers.origin&&req.headers.origin!==host.origin)return json(res,403,{error:'Use the paired Jarvis phone page.'});
   const url=new URL(req.url,host);
   if(req.method==='GET'&&assets.has(url.pathname)){const [file,mime]=assets.get(url.pathname);res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});return res.end(await readFile(new URL(file,publicRoot)));}
   if(req.method==='POST'&&url.pathname==='/api/pair'){
    const input=await jsonBody(req);if(!allowed(input,['code','name']))return json(res,400,{error:'Enter a pairing code and phone name.'});
    const session=await pairing.pair({...input,address:req.socket.remoteAddress||''});
    res.setHeader('Set-Cookie',`__Host-jarvis_phone=${session.token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
    return json(res,200,{room:session.room,name:session.name});
   }
   const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-jarvis_phone='))?.slice('__Host-jarvis_phone='.length);
   const session=await pairing.authenticate(token);if(!session)return json(res,401,{error:'Pair this phone from the central computer.'});
   const profile=await profiles.get(session.profileId);if(session.profileId&&!profile)return json(res,401,{error:'This phone’s assigned profile no longer exists. Pair it again.'});
   if(req.method==='GET'&&url.pathname==='/api/session')return json(res,200,{name:session.name,room:session.room,profile:profile?{id:profile.id,name:profile.name}:null,active:modelRoute({room:session.room,profileId:session.profileId})});
   if(req.method==='POST'&&url.pathname==='/api/logout'){await pairing.revoke(session.id);res.setHeader('Set-Cookie','__Host-jarvis_phone=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
   if(req.method==='GET'&&url.pathname==='/api/events'){
    if(!streams.has(session.id))streams.set(session.id,new Set());const current=streams.get(session.id);if(current.size>=3)return json(res,429,{error:'Close extra copies of Jarvis on this phone.'});
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store',Connection:'keep-alive'});current.add(res);const remove=subscribe(session.room,res);res.write(`data: ${JSON.stringify(snapshot(session.room))}\n\n`);
    const timer=setInterval(async()=>{if(!await pairing.authenticate(token))return revoke(session.id);if(!res.destroyed)res.write(': keep-alive\n\n');},15000);timer.unref();res.on('close',()=>{clearInterval(timer);remove();current.delete(res);if(!current.size)streams.delete(session.id);});return;
   }
   if(req.method==='POST'&&url.pathname==='/api/ask'){
    const input=await jsonBody(req);if(!allowed(input,['question','viewContext']))return json(res,400,{error:'This phone uses its assigned room and profile.'});
    const reply=await fetch(new URL('/api/ask',centralUrl()),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,room:session.room,profileId:session.profileId||undefined}),signal:AbortSignal.timeout(5000)});const data=await reply.json();if(reply.ok)owned.set(session.id,data.requestId);return json(res,reply.status,data);
   }
   if(req.method==='POST'&&['/api/cancel','/api/speech'].includes(url.pathname)){
    const input=await jsonBody(req);if(!allowed(input,url.pathname==='/api/cancel'?['requestId']:['requestId','voice'])||typeof input.requestId!=='string'||owned.get(session.id)!==input.requestId)return json(res,403,{error:'This phone can only operate its own latest request.'});
    return proxy(req,res,url.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,room:session.room})},session.id);
   }
   if(req.method==='POST'&&url.pathname==='/api/transcribe'){
    if(req.headers['content-type']!=='audio/wav')return json(res,415,{error:'Record audio using Jarvis.'});
    const wave=await body(req,640044);return proxy(req,res,'/api/transcribe?room='+encodeURIComponent(session.room),{method:'POST',headers:{'Content-Type':'audio/wav'},body:wave},session.id);
   }
   return json(res,403,{error:'This phone can ask Jarvis in its assigned room. Central settings are available only on the computer.'});
  }catch(error){if(!res.headersSent)json(res,error.status||502,{error:error.status?error.message.replace(/\bTV\b|\bdisplay\b/g,'phone'):'The phone connection could not finish that request.'});else res.end();}
 };
 return{handler,revoke,close:()=>{for(const id of streams.keys())revoke(id);for(const c of controllers.keys())c.abort();}};
}
export async function createPhoneAccess({directory,bindAddress,port=3215,setupPort=3214,...options}={}){
 if(!privateIPv4(bindAddress))throw Error('Phone access needs a specific private LAN address.');
 for(const p of [port,setupPort])if(!Number.isInteger(p)||p<1024||p>65535)throw Error('Choose valid phone ports.');
 if(port===setupPort)throw Error('Phone setup and secure access need different ports.');
 const tlsDirectory=path.join(directory,'phone-access','tls');
 const [key,cert]=await Promise.all([readFile(path.join(tlsDirectory,'server.key')),readFile(path.join(tlsDirectory,'server.pem'))]);
 let server;
 const gateway=createPhoneHandler({...options,bindAddress,port:()=>server.address()?.port||port});
 server=https.createServer({key,cert},gateway.handler);
 const url=`https://${bindAddress}:${port}/`;
 const bootstrap=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'");res.setHeader('Cache-Control','no-store');
  try{
   const host=new URL('http://'+(req.headers.host||''));if(host.hostname!==bindAddress||Number(host.port)!==setupPort||req.method!=='GET'){res.writeHead(403);return res.end();}
   if(req.url==='/jarvis-local-ca.cer'){res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="Jarvis-Local-Phone-CA.cer"'});return res.end(await readFile(path.join(tlsDirectory,'jarvis-local-ca.cer')));}
   if(req.url!=='/'){res.writeHead(404);return res.end();}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jarvis phone connection</title><h1>Connect this phone</h1><p>One-time setup: download the Jarvis local certificate, install and trust it on your phone, then open secure Jarvis. Compare its fingerprint with the Phone access page on the central computer before trusting it.</p><p><a href="/jarvis-local-ca.cer">Download Jarvis local certificate</a></p><p><a href="'+url+'">Open secure Jarvis</a></p><p>After certificate setup, generate a phone pairing code on the central computer. This setup page cannot control Jarvis. Keep access on your trusted home network.</p></html>');
  }catch{res.writeHead(503);res.end('The phone setup certificate is unavailable.');}
 });
 return{server,bootstrap,revoke:gateway.revoke,url,setupUrl:`http://${bindAddress}:${setupPort}/`,close:async()=>{gateway.close();await Promise.all([server,bootstrap].filter(s=>s.listening).map(s=>new Promise(r=>{s.close(r);s.closeIdleConnections?.();})));}};
}
