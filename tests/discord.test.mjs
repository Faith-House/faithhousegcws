import {createDiscordText,createDiscordTextModel} from '../discord-text.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import OpusScript from 'opusscript';
import { createDiscordConfig } from '../discord-config.mjs';
import { createDiscordIntegration,discordReply } from '../discord-integration.mjs';
import { createDiscordVoice } from '../discord-voice.mjs';
import { createDiscordBridge } from '../discord-bridge.mjs';
import { pcmToWhisperWave,waveToDiscordPcm,discordWakeQuestion } from '../discord-audio.mjs';
import { createJarvisServer } from '../server.mjs';
const appId='111111111111111111',guildId='222222222222222222',userId='333333333333333333',channelId='444444444444444444';
const token='test'.repeat(15),members=[{userId,profileId:'cooper',room:'bedroom-1'}];
const profiles={list:async()=>({profiles:[{id:'cooper',name:'Cooper'}]}),get:async id=>id==='cooper'?{id,name:'Cooper'}:null};
const roomIds=['bedroom-1','bedroom-2'];
const dir=()=>mkdtemp(path.join(tmpdir(),'jarvis-discord-'));
const configuration={applicationId:appId,guildId,token,voiceChannelIds:[channelId],members};

test('Discord configuration persists credentials privately, redacts responses, validates identities and preserves damaged files',async()=>{
 const directory=await dir(),store=createDiscordConfig({directory,profiles,rooms:roomIds});
 await assert.rejects(store.configure({...configuration,token:'invalid'}),/Bot token/);
 const saved=await store.configure(configuration);assert.equal(saved.hasToken,true);assert.equal(saved.enabled,false);assert.equal(JSON.stringify(saved).includes(token),false);
 assert.equal(JSON.parse(await readFile(path.join(directory,'discord.json'),'utf8')).token,token);
 await store.configure({...configuration,token:''});assert.equal((await store.credentials()).token,token);
 await assert.rejects(store.configure({...configuration,members:[{...members[0],profileId:'unknown'}]}));
 await assert.rejects(store.configure({...configuration,members:[members[0],members[0]]}));
 await assert.rejects(store.configure({...configuration,guildId:'server name'}));
 await store.setEnabled(true);assert.equal((await store.status()).enabled,true);await store.close();
 const broken=await dir();await writeFile(path.join(broken,'discord.json'),'original broken file');const other=createDiscordConfig({directory:broken,profiles,rooms:roomIds});assert.equal((await other.status()).configurationError,true);await assert.rejects(other.configure(configuration));assert.equal(await readFile(path.join(broken,'discord.json'),'utf8'),'original broken file');
});

function sdkFixture({channelMissing=false,channelType=0,channelPermissions=true}={}){let client,registered;
 class Client extends EventEmitter{constructor(options){super();this.options=options;this.application={id:appId};this.user={id:appId,tag:'Jarvis test'};this.guilds={fetch:async id=>{assert.equal(id,guildId);return{channels:{fetch:async id=>{if(channelMissing)throw Error('Unknown channel');return{id,guildId,type:channelType,permissionsFor:()=>({has:()=>channelPermissions})};}},commands:{create:async command=>{registered=command;}}};}};}async login(){queueMicrotask(()=>this.emit('ready'));return token;}isReady(){return true;}destroy(){this.destroyed=true;}}
 const sdk={Client:class extends Client{constructor(options){super(options);client=this;}},GatewayIntentBits:{Guilds:1,GuildVoiceStates:128,GuildMessages:512,MessageContent:32768},Events:{ClientReady:'ready',InteractionCreate:'interaction',MessageCreate:'messageCreate',Error:'error',Invalidated:'invalidated'}};
 return{sdk,getClient:()=>client,command:()=>registered};
}
function interaction(command,{who=userId,guild=guildId,question='What time is it?'}={}){const calls=[];return{calls,isChatInputCommand:()=>true,commandName:'jarvis',guildId:guild,user:{id:who},options:{getSubcommand:()=>command,getString:()=>question},reply:async data=>{calls.push({kind:'reply',data});},deferReply:async data=>{calls.push({kind:'defer',data});},editReply:async data=>{calls.push({kind:'edit',data});}};}

test('slash commands require the configured server and user, defer private replies and never request message-content intent',async()=>{
 const fixture=sdkFixture(),asked=[];let joins=0,leaves=0;
 const bridge={ask:async(...args)=>{asked.push(args);return{answer:'It is noon.',room:'bedroom-1',requestId:'request'};},stop:async()=>false,close(){}};
 const service=createDiscordIntegration({directory:await dir(),profiles,rooms:roomIds,bridge,loadSdk:async()=>fixture.sdk,voiceFactory:async()=>({join:async()=>{joins++;return'Joined.';},leave:async()=>{leaves++;},stop:async()=>false,close:async()=>{}})});
 await service.configure(configuration);assert.equal((await service.connect()).connected,true);assert.deepEqual(fixture.getClient().options.intents,[1,128]);assert.equal(fixture.command().name,'jarvis');
 const denied=interaction('ask',{who:'555555555555555555'});await service.handle(denied);assert.equal(asked.length,0);assert.equal(denied.calls[0].data.flags,64);
 const otherServer=interaction('join',{guild:'666666666666666666'});await service.handle(otherServer);assert.equal(joins,0);
 const allowed=interaction('ask');await service.handle(allowed);assert.equal(allowed.calls[0].kind,'defer');assert.equal(allowed.calls[0].data.flags,64);assert.equal(asked[0][1].profileId,'cooper');assert.equal(asked[0][1].room,'bedroom-1');assert.deepEqual(allowed.calls.at(-1).data.allowedMentions.parse,[]);
 const previous=interaction('last');await service.handle(previous);assert.equal(previous.calls.at(-1).data.content,'It is noon.');
 await service.handle(interaction('join'));assert.equal(joins,1);await service.handle(interaction('leave'));assert.equal(leaves,1);
 assert.equal(JSON.stringify(await service.status()).includes(token),false);await service.disconnect();assert.equal((await service.status()).enabled,false);await service.close();
});

test('long Discord answers are attached without generating mentions',()=>{
 const result=discordReply('@everyone '+ 'x'.repeat(2500));assert.equal(result.files[0].name,'jarvis-reply.txt');assert.equal(result.files[0].attachment.toString().startsWith('@everyone'),true);assert.deepEqual(result.allowedMentions.parse,[]);
 assert.equal(discordWakeQuestion('Hey Jarvis, what time is it?'),'what time is it?');assert.equal(discordWakeQuestion('I was telling Jarvis about it'),null);
});

test('Discord PCM conversion stays bounded and provides the exact local Whisper WAV and 48k stereo playback formats',()=>{
 const pcm=Buffer.alloc(48000*4);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(1000,i);
 const wave=pcmToWhisperWave(pcm);assert.equal(wave.readUInt32LE(24),16000);assert.equal(wave.readUInt16LE(22),1);assert.equal(wave.length,32044);assert.equal(wave.readInt16LE(44),1000);
 const play=waveToDiscordPcm(wave);assert.equal(play.length,48000*4);assert.equal(play.readInt16LE(0),1000);assert.equal(play.readInt16LE(2),1000);
 assert.throws(()=>pcmToWhisperWave(Buffer.alloc(21*48000*4)));assert.throws(()=>waveToDiscordPcm(Buffer.alloc(44)));
});

test('voice joins only an approved channel and processes only linked users with an explicit Jarvis wake phrase',async()=>{
 let connection,player,transcribed=0,asked=0,spoken=0,received=0;
 class Connection extends EventEmitter{constructor(){super();this.receiver={speaking:new EventEmitter(),subscribe:id=>{received++;const stream=new PassThrough();this.stream=stream;return stream;}};}destroy(){this.destroyed=true;}subscribe(){}}
 const sdk={EndBehaviorType:{AfterSilence:2},StreamType:{Raw:'raw'},VoiceConnectionStatus:{Disconnected:'disconnected',Signalling:'signalling',Connecting:'connecting',Ready:'ready'},AudioPlayerStatus:{Playing:'playing',Idle:'idle'},joinVoiceChannel:()=>connection=new Connection(),createAudioPlayer:()=>{player=new EventEmitter();player.stop=()=>{};player.play=()=>{};return player;},createAudioResource:(input,options)=>{assert.equal(options.inputType,'raw');return{input};},entersState:async()=>{}};
 const bridge={transcribe:async(_binding,wave)=>{transcribed++;assert.equal(wave.readUInt32LE(24),16000);return'Hey Jarvis, what time is it?';},ask:async()=>{asked++;return{answer:'Noon',room:'bedroom-1',requestId:'voice'};},speech:async()=>{spoken++;return pcmToWhisperWave(Buffer.alloc(48000*4));},stop:async()=>false};
 const voice=await createDiscordVoice({client:{},guildId,voiceChannelIds:[channelId],members,bridge,voiceSdk:sdk,OpusScript});
 const guild={voiceStates:{cache:new Map([[userId,{channelId}]])},voiceAdapterCreator:()=>{}};
 await assert.rejects(voice.join({guildId:'999999999999999999',guild,user:{id:userId}}));
 await voice.join({guildId,guild,user:{id:userId}});
 connection.receiver.speaking.emit('start','777777777777777777');assert.equal(received,0);
 connection.receiver.speaking.emit('start',userId);assert.equal(received,1);
 const codec=new OpusScript(48000,2,OpusScript.Application.VOIP);const packet=codec.encode(Buffer.alloc(3840),960);
 for(let i=0;i<16;i++)connection.stream.write(packet);connection.stream.end();codec.delete();
 for(let i=0;i<100&&spoken===0;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(transcribed,1);assert.equal(asked,1);assert.equal(spoken,1);await voice.close();assert.equal(voice.status().channelId,null);
});

test('Discord bridge observes the real local request result and cannot cancel a different user’s request',async()=>{
 const directory=await dir(),app=createJarvisServer({displayBind:'',phoneBind:'',actionsOptions:{dataDirectory:directory},pairingOptions:{directory},speech:{listVoices:async()=>({available:false}),close(){}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const bridge=createDiscordBridge({baseUrl:()=>base});
 try{const result=await bridge.ask(userId,{room:'bedroom-1',profileId:null},'What time is it?');assert.match(result.answer,/It is/);assert.equal(result.room,'bedroom-1');assert.equal(await bridge.stop('different-user'),false);
  assert.equal((await fetch(base+'/discord')).status,200);assert.equal((await fetch(base+'/discord.js')).status,200);assert.equal((await fetch(base+'/api/discord')).status,200);
  const blocked=await fetch(base+'/api/discord',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://outside.example'},body:JSON.stringify(configuration)});assert.equal(blocked.status,403);
 }finally{bridge.close();await app.shutdown();}
});


let messageSequence=0;
function chatMessage(content,options={}){
 const replies=[];
 return {id:String(++messageSequence),content,guildId,channelId,author:{id:userId,bot:false},mentions:{users:new Map()},reply:async payload=>{replies.push(payload);return{id:'reply-'+messageSequence};},replies,...options};
}
function textFixture(options={}){
 const calls=[],asked=[];let time=1000000;
 const service=createDiscordText({guildId,channelIds:[channelId],members,profiles,botId:appId,now:()=>time,
  bridge:{ask:async(...args)=>{asked.push(args);return{answer:'Action confirmed.',room:'bedroom-1'};}},
  decide:async request=>{calls.push(request);return{respond:true,toolRequest:false,answer:'Let’s talk.'};},...options});
 return {service,calls,asked,tick:ms=>{time+=ms;}};
}

test('natural conversation is channel/user scoped, follows replies, and ignores bots, duplicates and banter',async()=>{
 const {service,calls,asked}=textFixture();
 const hello=chatMessage('Hey Jarvis, how are you?');await service.handle(hello);await service.handle(hello);
 assert.equal(hello.replies.length,1);assert.equal(calls[0].directed,true);assert.deepEqual(hello.replies[0].allowedMentions.parse,[]);
 const follow=chatMessage('What should we cook?');await service.handle(follow);assert.equal(calls[1].directed,true);assert.equal(calls[1].history.some(m=>m.speaker==='Jarvis'),true);
 await service.handle(chatMessage('thanks'));await service.handle(chatMessage('Jarvis hello',{author:{id:userId,bot:true}}));
 await service.handle(chatMessage('Jarvis hello',{channelId:'999999999999999999'}));
 await service.handle(chatMessage('Jarvis hello',{author:{id:'999999999999999999'}}));
 await service.handle(chatMessage('Jarvis hello',{guildId:'999999999999999999'}));
 assert.equal(calls.length,2);assert.equal(asked.length,0);service.close();
});

test('AI can join useful open questions but ambient messages never execute tools and replies are throttled',async()=>{
 let decisions=0,actions=0,time=1000000;
 const service=createDiscordText({guildId,channelIds:[channelId],members,profiles,botId:appId,now:()=>time,
  bridge:{ask:async()=>{actions++;}},decide:async()=>{decisions++;return{respond:true,toolRequest:true,answer:'I can explain that.'};}});
 await service.handle(chatMessage('lol that was wild'));assert.equal(decisions,0);
 const question=chatMessage('Does anyone know how rainbows form?');await service.handle(question);assert.equal(question.replies.length,1);assert.equal(actions,0);
 // Another linked speaker gets no implicit engagement and cannot bypass the ambient cooldown.
 time+=100000;const mentionOthers=chatMessage('Can you help me?',{mentions:{users:new Map([['777777777777777777',{id:'777777777777777777'}]])}});
 await service.handle(mentionOthers);assert.equal(mentionOthers.replies.length,0);assert.equal(decisions,1);
 service.close();
});

test('natural household requests reuse real tool bridge only when addressed to Jarvis',async()=>{
 const {service,asked}=textFixture();
 const command=chatMessage('Hey Jarvis, add take out the trash to the chore list');await service.handle(command);
 assert.equal(asked.length,1);assert.equal(asked[0][0],userId);assert.equal(asked[0][1].profileId,'cooper');assert.match(asked[0][2],/^add take/);assert.equal(command.replies[0].content,'Action confirmed.');
 service.close();
});

test('pending channel replies are aborted on disconnect and history expires',async()=>{
 let release,started;const began=new Promise(r=>started=r);
 const fixture=textFixture({decide:async request=>{started();await new Promise(r=>release=r);assert.equal(request.signal.aborted,true);return{respond:true,toolRequest:false,answer:'Too late'};}});
 const message=chatMessage('Jarvis hello');const pending=fixture.service.handle(message);await began;fixture.service.close();release();await pending;assert.equal(message.replies.length,0);
 const normal=textFixture();await normal.service.handle(chatMessage('Jarvis hello'));normal.tick(301000);
 const later=chatMessage('What should we eat?');await normal.service.handle(later);assert.equal(normal.calls[1].directed,false);assert.deepEqual(normal.calls[1].history,[]);normal.service.close();
});

test('old Discord configuration migrates without enabling channel reading; opted-in channels request the required intents',async()=>{
 const directory=await dir();await writeFile(path.join(directory,'discord.json'),JSON.stringify({format:1,enabled:false,...configuration}));
 const store=createDiscordConfig({directory,profiles,rooms:roomIds});assert.deepEqual((await store.status()).textChannelIds,[]);
 await store.configure({...configuration,textChannelIds:[channelId]});await store.configure({...configuration,token:''});assert.deepEqual((await store.status()).textChannelIds,[channelId]);
 await assert.rejects(store.configure({...configuration,textChannelIds:['invalid']}),/text channels/);await store.close();
 const fixture=sdkFixture(),service=createDiscordIntegration({directory:await dir(),profiles,rooms:roomIds,bridge:{close(){}},loadSdk:async()=>fixture.sdk,voiceFactory:async()=>({close:async()=>{}})});
 await service.configure({...configuration,textChannelIds:[channelId]});await service.connect();assert.deepEqual(fixture.getClient().options.intents,[1,128,512,32768]);await service.close();
});

test('channel model uses bounded local structured output and never grants tools to an ambient decision',async()=>{
 let body;
 const decide=createDiscordTextModel({fetchImpl:async(url,options)=>{assert.equal(url.hostname,'127.0.0.1');body=JSON.parse(options.body);return{ok:true,json:async()=>({message:{content:JSON.stringify({respond:true,toolRequest:true,answer:'Hello'})}})};}});
 const result=await decide({history:[],message:{text:'Question?'},directed:false,signal:new AbortController().signal});
 assert.equal(result.toolRequest,false);assert.equal(body.stream,false);assert.equal(body.format.type,'object');assert.equal(body.options.num_ctx,4096);
});

test('ambient cooldown limits unsolicited replies while direct requests bypass it',async()=>{
 let time=1000000,count=0;const secondUser='777777777777777777';
 const service=createDiscordText({guildId,channelIds:[channelId],members:[...members,{...members[0],userId:secondUser}],profiles,botId:appId,now:()=>time,bridge:{},decide:async()=>{count++;return{respond:true,toolRequest:false,answer:'Useful answer'};}});
 await service.handle(chatMessage('Why is the sky blue?'));assert.equal(count,1);
 time+=11000;const ambient=chatMessage('Why are sunsets red?',{author:{id:secondUser}});await service.handle(ambient);assert.equal(count,1);assert.equal(ambient.replies.length,0);
 const directed=chatMessage('Jarvis, why are sunsets red?',{author:{id:secondUser}});await service.handle(directed);assert.equal(count,2);assert.equal(directed.replies.length,1);service.close();
});

test('channel context does not leak into another approved channel',async()=>{
 const secondChannel='888888888888888888',fixture=textFixture({channelIds:[channelId,secondChannel]});
 await fixture.service.handle(chatMessage('Jarvis, we are discussing chicken'));await fixture.service.handle(chatMessage('Jarvis, hello',{channelId:secondChannel}));
 assert.deepEqual(fixture.calls[1].history,[]);fixture.service.close();
});

test('direct conversation uses ordinary local chat with history instead of a silence classifier',async()=>{
 let body;
 const decide=createDiscordTextModel({fetchImpl:async(url,options)=>{body=JSON.parse(options.body);return{ok:true,json:async()=>({message:{content:'Try chicken fried rice.'}})};}});
 const result=await decide({history:[{speaker:'cooper',text:'Any dinner ideas?'},{speaker:'Jarvis',text:'What ingredients do you have?'}],message:{speaker:'cooper',text:'Chicken and rice'},directed:true,signal:new AbortController().signal});
 assert.equal(result.respond,true);assert.equal(result.toolRequest,false);assert.equal(result.answer,'Try chicken fried rice.');assert.equal(body.format,undefined);assert.equal(body.messages.at(-1).content,'Chicken and rice');assert.equal(body.messages[2].role,'assistant');
});

test('Discord connection rejects missing channels, categories and missing reply permissions with useful errors',async()=>{
 for(const [options,expected] of [[{channelMissing:true},/could not be found/],[{channelType:4},/regular text/],[{channelPermissions:false},/Read Message History/]]){
  const fixture=sdkFixture(options),service=createDiscordIntegration({directory:await dir(),profiles,rooms:roomIds,bridge:{close(){}},loadSdk:async()=>fixture.sdk,voiceFactory:async()=>({close:async()=>{}})});
  await service.configure({...configuration,textChannelIds:[channelId]});const status=await service.connect();
  assert.equal(status.connected,false);assert.match(status.error,expected);assert.equal(fixture.command(),undefined);await service.close();
 }
});
