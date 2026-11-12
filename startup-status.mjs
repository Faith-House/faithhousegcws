import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT } from './voice-config.mjs';
import { projectId } from './supervisor.mjs';
export async function readStartupStatus({ root = APP_ROOT, fetchImpl = fetch } = {}) {
  let settings;
  try { settings=JSON.parse((await readFile(path.join(root,'private','startup.json'),'utf8')).replace(/^\uFEFF/,'')); }
  catch(error){return {configured:false,configurationError:error.code!=='ENOENT',responding:false};}
  if(settings.projectId!==projectId(root)||!Number.isInteger(settings.supervisorPort)||settings.supervisorPort<1024||settings.supervisorPort>65535)return {configured:false,configurationError:true,responding:false};
  const result={configured:true,responding:false,startupMode:'Windows sign-in',taskName:settings.taskName};
  try{
    const response=await fetchImpl(`http://127.0.0.1:${settings.supervisorPort}/health`,{signal:AbortSignal.timeout(1500),redirect:'error'});
    const state=await response.json();
    if(!response.ok||state.app!=='jarvis-supervisor'||state.projectId!==projectId(root))return result;
    return {...result,responding:true,state:state.state,serverOwned:state.serverOwned,starts:state.starts,restarts:state.restarts,checkedAt:state.checkedAt,ollama:state.ollama};
  }catch{return result;}
}
