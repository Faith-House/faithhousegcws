import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {rootCertificates} from 'node:tls';
import {browserIntent} from '../browser-intents.mjs';
import {createJarvisServer} from '../server.mjs';
import {createDiscordBridge} from '../discord-bridge.mjs';
import {createSamsungLauncher} from '../samsung-launcher.mjs';
import {createDisplayServer} from '../display-server.mjs';
import {createDisplayPairing} from '../display-pairing.mjs';
import {createDisplayNavigator} from '../public/display-navigation.js';

test('screen destination phrasing keeps browser/app navigation, explicit device overrides and negations intact',()=>{
 for(const text of ['Open YouTube','Hey Jarvis, open YouTube on abc TV','Put on YouTube on the television','Play YouTube on abc','Open YouTube app on the TV'])assert.equal(browserIntent(text)?.url,'https://www.youtube.com/',text);
 assert.equal(browserIntent('Open YouTube on my computer').destination.device,'computer');
 assert.equal(browserIntent('Open YouTube on my phone').destination.device,'phone');
 assert.equal(browserIntent('Open Chrome on YouTube').engine,'chrome');
 assert.equal(browserIntent('Open the browser on YouTube').url,'https://www.youtube.com/');
 assert.equal(browserIntent('Open the browser on YouTube').destination,undefined);
 assert.equal(browserIntent("Don't open YouTube on the TV"),null);
});

test('assistant website tools use the room screen, avoid local windows, honor overrides and never steal focus back from YouTube',async()=>{
 let tvOpens=0,localCalls=0,focuses=0,modelCalls=0,confirm=true;
 const model=http.createServer(async(req,res)=>{for await(const _ of req){}if(req.url==='/api/chat')modelCalls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:[{name:'test'}]}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-screen-tools-'));
 const app=createJarvisServer({model:'test',ollamaUrl:`http://127.0.0.1:${model.address().port}`,displayBind:'127.0.0.1',phoneBind:'',actionsOptions:{dataDirectory:directory},pairingOptions:{directory},speech:{listVoices:async()=>({available:false}),close(){}},
  workbenchOptions:{desktop:()=>({status:()=>({available:true}),run:async()=>{localCalls++;throw Error('No local window should open');}}),browser:()=>({status:()=>({sessions:[]}),close:async()=>{},run:async()=>{localCalls++;throw Error('No local browser should open');}})},
  tvLaunchOptions:{remote:{status:async()=>({configured:true}),online:async()=>true,focusBrowser:async()=>{focuses++;},launchBrowser:async()=>{focuses++;},openWebsite:async url=>{assert.equal(url,'https://www.youtube.com/');tvOpens++;return{supported:true,confirmed:confirm,app:'YouTube'};}}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));await new Promise(r=>app.displayServer.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${app.server.address().port}`,screen=`http://127.0.0.1:${app.displayServer.address().port}`;
 const post=(host,p,body)=>fetch(host+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const bridge=createDiscordBridge({baseUrl:()=>base});
 try{
  const code=await(await post(base,'/api/pairing/start',{room:'living-room'})).json();await post(screen,'/api/pair',{code:code.code,name:'abc'});
  const devices=await fetch(base+'/api/displays').then(r=>r.json());
  await post(base,'/api/tv-launch',{enabled:true,displayId:devices.devices[0].id,wake:false,mac:'',websitesOnScreens:true});
  await post(base,'/api/workbench/settings',{browserEnabled:true,desktopEnabled:true,requireApproval:false});
  const binding={room:'living-room',profileId:null,client:{kind:'browser',id:'asking-computer-123',desktop:true}};
  for(const question of ['Open YouTube','Open YouTube on abc TV','Open YouTube app','Play YouTube']){
   const result=await bridge.ask('test',binding,question);assert.match(result.answer,/YouTube is open on abc/);assert.equal(result.deviceActions.length,0);
  }
  assert.equal(tvOpens,4);assert.equal(focuses,0,'automatic HUD launch must not take focus back from media');
  const local=await bridge.ask('test',binding,'Open YouTube on this computer');assert.equal(local.deviceActions[0].clientId,binding.client.id);assert.equal(tvOpens,4);
  const otherRoom=await bridge.ask('test',{...binding,room:'bedroom-2'},'Open YouTube');assert.equal(otherRoom.deviceActions.length,1);assert.equal(tvOpens,4);
  const wrongScreen=await bridge.ask('test',{...binding,room:'bedroom-2'},'Open YouTube on abc');assert.equal(wrongScreen.deviceActions.length,0);assert.equal(tvOpens,4);
  confirm=false;const unverified=await bridge.ask('test',binding,'Open YouTube');assert.match(unverified.answer,/not confirmed|has not confirmed/);assert.doesNotMatch(unverified.answer,/is open on/);
  assert.equal(localCalls,0);assert.equal(modelCalls,0);
 }finally{bridge.close();await app.shutdown();await new Promise(r=>model.close(r));}
});

test('Samsung launches the installed YouTube app and checks foreground state without substituting a different requested page',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-youtube-native-')),sent=[],requests=[];let launched=false;
 await writeFile(path.join(directory,'samsung-tv.json'),JSON.stringify({host:'192.168.1.20',token:'test-token',launchMethod:'home-rest'}));await writeFile(path.join(directory,'samsung-tv-certificate.pem'),rootCertificates[0]);
 class Socket extends EventEmitter{constructor(){super();queueMicrotask(()=>this.emit('message',Buffer.from('{"event":"ms.channel.connect"}')));}send(bytes){sent.push(JSON.parse(bytes));}terminate(){}}
 const remote=createSamsungLauncher({directory,WebSocketImpl:Socket,wait:async()=>{},fetchImpl:async(url,options)=>{requests.push({url,method:options.method});if(options.method==='POST'){launched=true;return new Response('true');}return new Response(JSON.stringify({id:'111299001912',name:'YouTube',running:launched,visible:launched}));}});
 assert.equal((await remote.openWebsite('https://www.youtube.com/')).confirmed,true);assert.equal(sent[0].params.DataOfCmd,'KEY_HOME');assert.ok(requests.some(r=>r.method==='POST'&&r.url.endsWith('/111299001912')));
 const count=requests.length;
 for(const url of ['https://youtube.com/watch?v=example','https://youtube.com/?search_query=music','https://youtube.com/#specific-content'])assert.equal((await remote.openWebsite(url)).supported,false);
 assert.equal(requests.length,count);
});

test('paired screens acknowledge only their own live commands and stale navigation cannot replay',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-screen-nav-')),pairing=createDisplayPairing({directory,rooms:['living-room']});
 const service=createDisplayServer({pairing,bindAddress:'127.0.0.1',snapshot:()=>({state:'idle'}),subscribe:()=>()=>{}});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${service.server.address().port}`,controllers=[],readers=[];
 const pair=async name=>{const code=await pairing.start('living-room');return pairing.pair({code:code.code,name,address:'test'});};
 const ack=(token,id)=>fetch(base+'/api/navigation/ack',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'jarvis_display='+token},body:JSON.stringify({id})});
 try{
  const a=await pair('A'),b=await pair('B');
  for(const session of [a,b]){const controller=new AbortController();controllers.push(controller);const stream=await fetch(base+'/api/events',{headers:{Cookie:'jarvis_display='+session.token},signal:controller.signal});const reader=stream.body.getReader();readers.push(reader);await reader.read();}
  const command=service.navigate(a.id,'https://www.google.com/');
  const packet=Buffer.from((await readers[0].read()).value).toString();assert.ok(packet.startsWith('event: navigate'));
  const data=JSON.parse(packet.split('data: ')[1].trim());
  assert.equal((await ack(b.token,data.id)).status,409);assert.equal((await ack(a.token,data.id)).status,200);assert.equal((await command).delivered,true);assert.equal((await ack(a.token,data.id)).status,409);
  const timeout=service.navigate(a.id,'https://example.com/',{timeoutMs:50});const expired=JSON.parse(Buffer.from((await readers[0].read()).value).toString().split('data: ')[1].trim());assert.equal((await timeout).delivered,false);assert.equal((await ack(a.token,expired.id)).status,409);
 }finally{for(const c of controllers)c.abort();for(const r of readers)await r.cancel().catch(()=>{});await service.close();await pairing.close();}
});

test('the screen browser refuses foreign or dangerous navigation and waits for the server acknowledgement',async()=>{
 const urls=[];let accepted=true;const navigator=createDisplayNavigator({browser:{location:{assign:url=>urls.push(url)}},acknowledge:async()=>accepted});
 const command={id:'first',displayId:'abc',kind:'open_url',url:'https://youtube.com/'};
 assert.equal(await navigator.apply(command,'other'),false);assert.equal(await navigator.apply({...command,url:'javascript:alert(1)'},'abc'),false);
 assert.equal(await navigator.apply(command,'abc'),true);assert.equal(await navigator.apply(command,'abc'),false);assert.equal(urls.length,1);
 accepted=false;assert.equal(await navigator.apply({...command,id:'expired'},'abc'),false);assert.equal(urls.length,1);
});
