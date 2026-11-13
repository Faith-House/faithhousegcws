import { createDiscordText,createDiscordTextModel } from './discord-text.mjs';
import { createDiscordConfig } from './discord-config.mjs';
import { createDiscordVoice } from './discord-voice.mjs';
export const jarvisCommand={name:'jarvis',description:'Talk to your local household Jarvis',options:[{type:1,name:'ask',description:'Ask Jarvis or run a household command',options:[{type:3,name:'question',description:'Your request; switch to coding mode first for longer code inputs',required:true,max_length:6000}]},{type:1,name:'join',description:'Join your approved voice channel; say Hey Jarvis to ask'},{type:1,name:'leave',description:'Leave the current voice channel'},{type:1,name:'stop',description:'Stop your current Jarvis request or spoken reply'},{type:1,name:'last',description:'Read your latest Jarvis answer privately'},{type:1,name:'status',description:'Check the local Discord connection'}]};
export function discordReply(answer){const text=String(answer||'Done.');return text.length<=1900?{content:text,allowedMentions:{parse:[],repliedUser:false}}:{content:'Your Jarvis reply is attached.',files:[{attachment:Buffer.from(text),name:'jarvis-reply.txt'}],allowedMentions:{parse:[],repliedUser:false}};}
export function createDiscordIntegration({directory,profiles,rooms,bridge,loadSdk=()=>import('discord.js'),voiceFactory=createDiscordVoice,textDecide=createDiscordTextModel(),now=Date.now}={}){
 const store=createDiscordConfig({directory,profiles,rooms}),last=new Map();
 let client=null,voice=null,text=null,connecting=null,epoch=0,connectionState='off',detail='Discord is not connected.',voiceState={state:'disconnected',channelId:null,detail:'Not in a voice channel.'},lastError='',stopped=false;
 const remember=(userId,result)=>{last.set(userId,{...result,at:now()});if(last.size>12)last.delete(last.keys().next().value);};
 async function status(){const config=await store.status();const effectiveState=connectionState==='connected'&&client?.isReady&&!client.isReady()?'reconnecting':connectionState;const invite=config.applicationId&&config.guildId?'https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:config.applicationId,scope:'bot applications.commands',permissions:config.textChannelIds.length?'3247104':'3181568',guild_id:config.guildId,disable_guild_select:'true'}):null;return{...config,state:effectiveState,connected:effectiveState==='connected',detail,error:lastError,botName:client?.user?.tag||null,voice:voiceState,inviteUrl:invite};}
 async function handle(interaction){
  if(!interaction.isChatInputCommand()||interaction.commandName!=='jarvis')return;
  const config=await store.status(),binding=config.members.find(m=>m.userId===interaction.user.id);
  const privateReply={flags:64,allowedMentions:{parse:[],repliedUser:false}};
  if(connectionState!=='connected'||interaction.guildId!==config.guildId||!binding||!await profiles.get(binding.profileId)){await interaction.reply({...privateReply,content:'Your Discord account is not linked to Jarvis for this server. Ask the household owner to add it on the central computer.'});return;}
  await interaction.deferReply({flags:64});
  try{
   const command=interaction.options.getSubcommand();let answer;
   if(command==='ask'){const question=interaction.options.getString('question',true);const result=await bridge.ask(interaction.user.id,binding,question);remember(interaction.user.id,result);await interaction.editReply(discordReply(result.answer));return;}
   if(command==='join'){if(!voice)throw Object.assign(Error('Discord voice is not ready. Reconnect the bot from Jarvis setup.'),{status:409});answer=await voice.join(interaction);}
   else if(command==='leave'){await voice?.leave();answer='Jarvis left the voice channel.';}
   else if(command==='stop'){await(voice?.stop(interaction.user.id)||bridge.stop(interaction.user.id));answer='Stopped your running request or spoken reply, if one was active. Earlier completed actions remain in place.';}
   else if(command==='last'){const item=last.get(interaction.user.id);answer=item&&now()-item.at<300000?item.answer:'There is no recent reply for your Discord account. Use /jarvis ask first.';}
   else if(command==='status')answer='Jarvis is connected on the central computer. '+(voiceState.channelId?voiceState.detail:'Voice is disconnected. Join an approved channel and use /jarvis join.');
   else answer='Use /jarvis ask, join, leave, stop, last or status.';
   await interaction.editReply(discordReply(answer));
  }catch(error){await interaction.editReply(discordReply(error.status?error.message:'That Discord request could not finish. Check the local Discord setup page.')).catch(()=>{});}
 }
 async function disconnect({rememberDisabled=true}={}){epoch++;stopped=true;text?.close();text=null;await voice?.close().catch(()=>{});voice=null;client?.destroy();client=null;connectionState='off';detail='Discord is disconnected.';voiceState={state:'disconnected',channelId:null,detail:'Not in a voice channel.'};if(rememberDisabled){const info=await store.status();if(info.hasToken&&!info.configurationError)await store.setEnabled(false);}last.clear();}
 async function connect(){
  if(connecting)return connecting;if(connectionState==='connected')return status();
  connecting=(async()=>{const config=await store.credentials();const attempt=++epoch;stopped=false;connectionState='connecting';detail='Connecting to the Discord gateway.';lastError='';
   try{
    const sdk=await loadSdk();const candidate=client=new sdk.Client({intents:[sdk.GatewayIntentBits.Guilds,sdk.GatewayIntentBits.GuildVoiceStates,...(config.textChannelIds.length?[sdk.GatewayIntentBits.GuildMessages,sdk.GatewayIntentBits.MessageContent]:[])],allowedMentions:{parse:[],repliedUser:false}});
    candidate.on(sdk.Events.Error,()=>{lastError='Discord reported a connection error. Check the bot token, invite and network.';});
    candidate.on(sdk.Events.InteractionCreate,interaction=>{if(client===candidate&&connectionState==='connected')void handle(interaction).catch(()=>{});});
    candidate.on(sdk.Events.MessageCreate,message=>{if(client===candidate&&connectionState==='connected')void text?.handle(message).catch(()=>{});});
    const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Gateway timeout')),25000);timer.unref();candidate.once(sdk.Events.ClientReady,()=>{clearTimeout(timer);resolve();});candidate.once(sdk.Events.Invalidated,()=>{clearTimeout(timer);reject(Error('Discord session invalidated'));});});
    // Attach a rejection handler before login, which can fail immediately.
    void ready.catch(()=>{});await candidate.login(config.token);await ready;
    if(stopped||epoch!==attempt){candidate.destroy();return status();}
    if(candidate.application.id!==config.applicationId)throw Error('Wrong application');
    const guild=await candidate.guilds.fetch(config.guildId);
    await guild.commands.create(jarvisCommand);
    voice=await voiceFactory({client:candidate,guildId:config.guildId,voiceChannelIds:config.voiceChannelIds,members:config.members,bridge,onAnswer:remember,onState:state=>{voiceState=state;}});
    if(stopped||epoch!==attempt){await voice.close();voice=null;candidate.destroy();return status();}
    text=createDiscordText({guildId:config.guildId,channelIds:config.textChannelIds,members:config.members,profiles,bridge,decide:textDecide,botId:candidate.user.id,onAnswer:remember,now,isCurrent:()=>client===candidate&&connectionState==='connected',onError:message=>{lastError=message;}});
    await store.setEnabled(true);connectionState='connected';detail=config.textChannelIds.length?'Connected. Natural conversation is enabled in approved text channels.':'Connected. Slash commands are registered in the selected server.';return status();
   }catch{await disconnect({rememberDisabled:false});connectionState='error';detail='Discord connection could not finish.';lastError='Check the bot token, matching application ID, server invite and bot permissions. For natural text chat, enable Message Content Intent in Developer Portal / Bot, then reconnect.';return status();}
  })().finally(()=>{connecting=null;});return connecting;
 }
 async function configure(input){await store.configure(input);await disconnect({rememberDisabled:false});lastError='';return status();}
 async function start(){const config=await store.status();if(config.enabled)await connect();}
 async function close(){await disconnect({rememberDisabled:false});bridge.close();await connecting;await store.close();}
 return{status,configure,connect,disconnect:()=>disconnect(),start,close,handle};
}
