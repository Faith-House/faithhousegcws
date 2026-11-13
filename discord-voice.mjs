import { Readable } from 'node:stream';
import { pcmToWhisperWave,waveToDiscordPcm,discordWakeQuestion } from './discord-audio.mjs';
export async function createDiscordVoice({client,guildId,voiceChannelIds,members,bridge,onAnswer=()=>{},onState=()=>{},voiceSdk,OpusScript}={}){
 const sdk=voiceSdk||await import('@discordjs/voice');
 const Opus=OpusScript||(await import('opusscript')).default;
 let generation=0,connection=null,player=null,channelId=null,busy=false,currentUser=null,controller=null,closing=false;
 const captures=new Map();
 const report=(state,detail)=>onState({state,channelId,detail});
 async function leave(){generation++;closing=true;controller?.abort();player?.stop(true);for(const stream of captures.values())stream.destroy();captures.clear();connection?.destroy();connection=null;player=null;channelId=null;const user=currentUser;currentUser=null;if(user)await bridge.stop(user).catch(()=>{});busy=false;report('disconnected','Not connected to a voice channel.');}
 async function process(userId,pcm){
  if(closing||busy||!channelId)return;const currentGeneration=generation;busy=true;currentUser=userId;controller=new AbortController();const signal=controller.signal;
  try{
   const binding=members.find(m=>m.userId===userId);if(!binding)return;
   report('transcribing','Processing an approved user’s speech locally.');
   const text=await bridge.transcribe(binding,pcmToWhisperWave(pcm),{signal});
   const question=discordWakeQuestion(text);if(!question)return;
   report('answering','Jarvis is answering an approved voice request.');
   const result=await bridge.ask(userId,binding,question,{signal});onAnswer(userId,result);
   if(signal.aborted||!connection)return;
   report('preparing','Preparing the local spoken reply.');const wave=await bridge.speech(result,{signal});if(signal.aborted||!player)return;
   const raw=waveToDiscordPcm(wave);player.play(sdk.createAudioResource(Readable.from([raw]),{inputType:sdk.StreamType.Raw}));
   report('speaking','Jarvis is speaking in the voice channel.');
   await sdk.entersState(player,sdk.AudioPlayerStatus.Playing,5000);
   await sdk.entersState(player,sdk.AudioPlayerStatus.Idle,240000);
  }catch(error){if(!signal.aborted)report('error',error.status?error.message:'That voice request could not finish. Use /jarvis ask or try a shorter voice request.');}
  finally{if(currentGeneration!==generation)return;busy=false;currentUser=null;controller=null;if(connection&&!closing)report('listening','Say “Hey Jarvis” before your question. Only linked users are processed.');}
 }
 function capture(userId){
  if(closing||busy||captures.has(userId)||!members.some(m=>m.userId===userId)||!connection)return;
  const captureGeneration=generation;
  const input=connection.receiver.subscribe(userId,{end:{behavior:sdk.EndBehaviorType.AfterSilence,duration:1000}});captures.set(userId,input);
  const decoder=new Opus(48000,2,Opus.Application.VOIP),chunks=[];let length=0,discarded=false,finished=false;
  const limit=setTimeout(()=>{discarded=true;input.destroy();},20500);
  const clean=()=>{if(finished)return false;finished=true;clearTimeout(limit);captures.delete(userId);decoder.delete();return true;};
  input.on('data',packet=>{try{const decoded=Buffer.from(decoder.decode(packet));length+=decoded.length;if(length>48000*4*20){discarded=true;input.destroy();return;}chunks.push(decoded);}catch{discarded=true;input.destroy();}});
  input.once('end',()=>{if(!clean())return;if(!discarded&&length>=48000&&captureGeneration===generation)void process(userId,Buffer.concat(chunks,length));});
  input.once('error',()=>{discarded=true;clean();});input.once('close',()=>clean());
 }
 async function join(interaction){
  const guild=interaction.guild;
  const target=guild?.voiceStates.cache.get(interaction.user.id)?.channelId;
  if(interaction.guildId!==guildId||!target||!voiceChannelIds.includes(target))throw Object.assign(Error('Join one of the voice channels approved in Jarvis setup, then use /jarvis join.'),{status:400});
  if(channelId===target&&connection)return 'I’m already in your approved voice channel. Say “Hey Jarvis” before your question.';
  await leave();closing=false;channelId=target;
  connection=sdk.joinVoiceChannel({channelId:target,guildId,adapterCreator:guild.voiceAdapterCreator,selfDeaf:false,selfMute:false});
  connection.on('error',()=>{report('error','The Discord voice connection failed. Leave and rejoin the channel.');void leave();});
  connection.on(sdk.VoiceConnectionStatus.Disconnected,()=>{if(closing)return;Promise.race([sdk.entersState(connection,sdk.VoiceConnectionStatus.Signalling,5000),sdk.entersState(connection,sdk.VoiceConnectionStatus.Connecting,5000)]).catch(()=>void leave());});
  try{await sdk.entersState(connection,sdk.VoiceConnectionStatus.Ready,20000);player=sdk.createAudioPlayer();player.on('error',()=>report('error','Spoken playback failed. Use /jarvis last to read your latest reply.'));connection.subscribe(player);connection.receiver.speaking.on('start',capture);report('listening','Say “Hey Jarvis” before your question. Only linked users are processed.');return 'Joined your voice channel. Say “Hey Jarvis” followed by a question. Voice replies are audible to everyone in this channel. Use /jarvis last to read your latest answer privately, or /jarvis leave to disconnect.';}
  catch{await leave();throw Object.assign(Error('Discord voice did not become ready. Check Connect/Speak permissions and the network connection.'),{status:502});}
 }
 async function stop(userId){if(currentUser===userId){controller?.abort();player?.stop(true);}return bridge.stop(userId);}
 return{join,leave,stop,status:()=>({channelId,busy}),close:leave};
}
