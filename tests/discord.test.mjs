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

function sdkFixture(){let client,registered;
 class Client extends EventEmitter{constructor(options){super();this.options=options;this.application={id:appId};this.user={tag:'Jarvis test'};this.guilds={fetch:async id=>{assert.equal(id,guildId);return{commands:{create:async command=>{registered=command;}}};}};}async login(){queueMicrotask(()=>this.emit('ready'));return token;}isReady(){return true;}destroy(){this.destroyed=true;}}
 const sdk={Client:class extends Client{constructor(options){super(options);client=this;}},GatewayIntentBits:{Guilds:1,GuildVoiceStates:128},Events:{ClientReady:'ready',InteractionCreate:'interaction',Error:'error',Invalidated:'invalidated'}};
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
