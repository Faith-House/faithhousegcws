import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import path from 'node:path';
const fail=(text,status=400)=>Object.assign(new Error(text),{status});
export const discordId=value=>typeof value==='string'&&/^\d{17,22}$/.test(value);
export function createDiscordConfig({directory,profiles,rooms}={}){
 const file=path.join(directory,'discord.json');
 let data={format:1,enabled:false,applicationId:'',guildId:'',token:'',voiceChannelIds:[],members:[]},initialized,broken=false,chain=Promise.resolve();
 const validToken=t=>typeof t==='string'&&t.length>=30&&t.length<=300&&/^[A-Za-z0-9_.-]+$/.test(t);
 const structural=value=>value&&value.format===1&&typeof value.enabled==='boolean'&&discordId(value.applicationId)&&discordId(value.guildId)&&validToken(value.token)&&Array.isArray(value.voiceChannelIds)&&value.voiceChannelIds.length<=20&&value.voiceChannelIds.every(discordId)&&Array.isArray(value.members)&&value.members.length>0&&value.members.length<=12&&value.members.every(m=>m&&Object.keys(m).every(k=>['userId','profileId','room'].includes(k))&&discordId(m.userId)&&typeof m.profileId==='string'&&m.profileId.length<=80&&rooms.includes(m.room))&&new Set(value.members.map(m=>m.userId)).size===value.members.length;
 async function initialize(){if(!initialized)initialized=(async()=>{try{const value=JSON.parse(await readFile(file,'utf8'));if(!structural(value))throw Error();data=value;}catch(error){if(error.code!=='ENOENT')broken=true;}})();return initialized;}
 const publicConfig=()=>({enabled:data.enabled,applicationId:data.applicationId,guildId:data.guildId,hasToken:Boolean(data.token),voiceChannelIds:[...data.voiceChannelIds],members:data.members.map(m=>({...m})),configurationError:broken});
 async function status(){await initialize();return publicConfig();}
 async function save(next){await mkdir(directory,{recursive:true});await writeFile(file+'.tmp',JSON.stringify(next,null,2)+'\n',{mode:0o600});await rename(file+'.tmp',file);data=next;}
 function configure(input){const task=chain.then(async()=>{
  await initialize();if(broken)throw fail('The saved Discord configuration needs attention. The original file was preserved.',503);
  if(!input||Object.keys(input).some(k=>!['applicationId','guildId','token','voiceChannelIds','members'].includes(k)))throw fail('Use the Discord setup fields.');
  const token=input.token?.trim()?input.token.trim().replace(/^Bot /,''):data.token;
  const next={format:1,enabled:false,applicationId:input.applicationId,guildId:input.guildId,token,voiceChannelIds:input.voiceChannelIds,members:input.members};
  if(!structural(next))throw fail('Enter the application ID, server ID, bot token and at least one linked Discord user. IDs must be copied from Discord, not usernames.');
  const people=(await profiles.list()).profiles;
  if(next.members.some(m=>!people.some(p=>p.id===m.profileId)))throw fail('Link each Discord user to a current roommate profile.');
  await save(next);return publicConfig();
 });chain=task.catch(()=>{});return task;}
 function setEnabled(enabled){const task=chain.then(async()=>{await initialize();if(broken||!structural(data))throw fail('Save the Discord setup before connecting.');await save({...data,enabled});});chain=task.catch(()=>{});return task;}
 return{initialize,status,configure,setEnabled,credentials:async()=>{await initialize();if(broken||!structural(data))throw fail('Finish Discord setup first.');return structuredClone(data);},close:async()=>{await initialized;await chain;}};
}
