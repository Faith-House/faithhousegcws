import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
const delay = ms => new Promise(r => setTimeout(r, ms));
const fail = message => Object.assign(new Error(message), { status: 400 });
export function createTvAutolaunch({ directory, pairing, receiver, visible, remote, now = Date.now, wait = delay, confirmMs = 7000, wakeMs = 12000 } = {}) {
  const file = path.join(directory,'tv-autolaunch.json');
  let config = { enabled:false, displayId:null, wake:false, mac:'' }, initialized, broken=false, chain=Promise.resolve();
  const pending = new Map(), attempts = new Map(), closing = new AbortController();
  async function initialize() {
    if(!initialized)initialized=(async()=>{try{const data=JSON.parse(await readFile(file,'utf8'));if(data.format!==1||typeof data.enabled!=='boolean'||typeof data.displayId!=='string'||typeof data.wake!=='boolean'||typeof data.mac!=='string')throw Error();config=data;}catch(error){if(error.code!=='ENOENT')broken=true;}})();
    return initialized;
  }
  async function status() {
    await initialize(); const info=await pairing.list(), target=info.devices.find(d=>d.id===config.displayId);
    return { ...config, configurationError:broken, target:target?{id:target.id,name:target.name,room:target.room}:null, receiver:receiver(), remote:await remote.status(), lastAttempt:target?attempts.get(target.room)||null:null };
  }
  function configure(input) {
    const task=chain.then(async()=>{
      await initialize(); if(broken)throw fail('The saved TV launch settings need attention. The original file was preserved.');
      if(!input||Object.keys(input).some(k=>!['enabled','displayId','wake','mac'].includes(k))||typeof input.enabled!=='boolean'||typeof input.wake!=='boolean'||typeof input.mac!=='string'||typeof input.displayId!=='string')throw fail('Choose a paired TV and valid automatic launch settings.');
      const target=(await pairing.list()).devices.find(d=>d.id===input.displayId);if(!target)throw fail('Choose a currently paired display.');
      if(input.mac&&!/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(input.mac)||input.wake&&!input.mac)throw fail('Wake needs the TV’s valid network MAC address.');
      const next={format:1,enabled:input.enabled,displayId:target.id,wake:input.wake,mac:input.mac};
      await mkdir(directory,{recursive:true});await writeFile(file+'.tmp',JSON.stringify(next,null,2)+'\n',{mode:0o600});await rename(file+'.tmp',file);config=next;return status();
    });chain=task.catch(()=>{});return task;
  }
  async function waitVisible(target,signal) {
    const end=now()+confirmMs;
    do { signal?.throwIfAborted();if(visible(target.id))return true;await wait(250); }while(now()<end);
    return false;
  }
  async function attempt(room,{force=false,signal}={}) {
    const info=await status(),target=info.target;
    if(broken||!target||target.room!==room||!config.enabled&&!force)return{ok:false,state:'disabled'};
    const set=(state,detail)=>{const result={ok:state==='confirmed',state,detail,at:now()};attempts.set(room,result);return result;};
    if(!info.receiver.enabled)return set('unavailable','The TV receiver is not listening on this computer’s configured network address.');
    if(visible(target.id))return set('confirmed','The paired receiver reports that Jarvis is visible.');
    set('launching','Requesting the Samsung browser.');
    try {
      if(!await remote.online({signal})){
        if(!config.wake)return set('unavailable','The TV is unavailable. Turn it on or configure Wake-on-LAN.');
        await remote.wake(config.mac);set('waking','Wake packet sent; waiting for the TV.');
        const end=now()+wakeMs;let awake=false;
        do {signal?.throwIfAborted();if(await remote.online({signal})){awake=true;break;}await wait(500);}while(now()<end);
        if(!awake)return set('unavailable','The TV did not answer after the wake request.');
      }
      await remote.launchBrowser(info.receiver.url,{signal});
      if(await waitVisible(target,signal))return set('confirmed','The paired receiver reports that Jarvis is visible.');
      await remote.launchBrowser(info.receiver.url,{signal,legacy:true});
      if(await waitVisible(target,signal))return set('confirmed','The paired receiver reports that Jarvis is visible.');
      return set('unconfirmed','Browser launch was requested, but Jarvis did not report being visible. The TV may still be on its browser home page.');
    }catch(error){return set(signal?.aborted?'cancelled':'failed',error.status?error.message:'The TV launch could not be confirmed.');}
  }
  function ensure(room,options={}) {
    if(pending.has(room))return pending.get(room);
    const combined = { ...options, signal: options.signal ? AbortSignal.any([options.signal, closing.signal]) : closing.signal };
    const promise=attempt(room,combined).finally(()=>pending.delete(room));pending.set(room,promise);return promise;
  }
  return {status,configure,ensure,pending:room=>pending.has(room),close:async()=>{closing.abort(Error('TV launcher closed'));await chain;await Promise.allSettled([...pending.values()]);}};
}
