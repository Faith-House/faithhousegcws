import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { screenTarget, websiteAddress } from './screen-target.mjs';
import { navigationRequest } from './navigation-intents.mjs';
const delay = ms => new Promise(r => setTimeout(r, ms));
const fail = message => Object.assign(new Error(message), { status: 400 });
export function createTvAutolaunch({ directory, pairing, receiver, visible, remote, navigate, canNavigate, now = Date.now, wait = delay, confirmMs = 7000, wakeMs = 12000 } = {}) {
  const file = path.join(directory,'tv-autolaunch.json');
  let config = { enabled:false, displayId:null, wake:false, mac:'', websitesOnScreens:false }, initialized, broken=false, chain=Promise.resolve();
  const pending = new Map(), attempts = new Map(), closing = new AbortController();
  async function initialize() {
    if(!initialized)initialized=(async()=>{try{const data=JSON.parse(await readFile(file,'utf8'));if(data.format!==1||typeof data.enabled!=='boolean'||typeof data.displayId!=='string'||typeof data.wake!=='boolean'||typeof data.mac!=='string'||(data.websitesOnScreens!==undefined&&typeof data.websitesOnScreens!=='boolean'))throw Error();config={...config,...data};}catch(error){if(error.code!=='ENOENT')broken=true;}})();
    return initialized;
  }
  async function status() {
    await initialize(); const info=await pairing.list(), target=info.devices.find(d=>d.id===config.displayId);
    return { ...config, configurationError:broken, target:target?{id:target.id,name:target.name,room:target.room}:null, receiver:receiver(), remote:await remote.status(), lastAttempt:target?attempts.get(target.room)||null:null };
  }
  function configure(input) {
    const task=chain.then(async()=>{
      await initialize(); if(broken)throw fail('The saved TV launch settings need attention. The original file was preserved.');
      if(!input||Object.keys(input).some(k=>!['enabled','displayId','wake','mac','websitesOnScreens'].includes(k))||typeof input.enabled!=='boolean'||typeof input.wake!=='boolean'||typeof input.mac!=='string'||typeof input.displayId!=='string'||(input.websitesOnScreens!==undefined&&typeof input.websitesOnScreens!=='boolean'))throw fail('Choose a paired TV and valid automatic launch settings.');
      const target=(await pairing.list()).devices.find(d=>d.id===input.displayId);if(!target)throw fail('Choose a currently paired display.');
      if(input.mac&&!/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(input.mac)||input.wake&&!input.mac)throw fail('Wake needs the TV’s valid network MAC address.');
      const next={format:1,enabled:input.enabled,displayId:target.id,wake:input.wake,mac:input.mac,websitesOnScreens:input.websitesOnScreens??config.websitesOnScreens};
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
    set('launching','Requesting the Samsung browser.');
    try {
      if(visible(target.id)){
        // Smart Hub can cover a page without changing its document visibility.
        await remote.focusBrowser?.(info.receiver.url,{signal});
        signal?.throwIfAborted();
        if(visible(target.id))return set('confirmed','The paired receiver reports that Jarvis is visible.');
      }
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
  async function enterAddress({signal}={}) {
    const info=await status();
    if(!info.receiver.enabled||!info.remote.configured||!remote.enterReceiverUrl)throw fail('Connect the Samsung remote and start the TV receiver first.');
    if(info.target&&pending.has(info.target.room))throw fail('Wait for the current TV launch to finish.');
    return remote.enterReceiverUrl(info.receiver.url,{signal});
  }
  async function websitePlan(context,address) {
    const url=websiteAddress(address),destination=screenTarget(context.question).destination;
    if(destination?.type==='device'){
      if(context.client?.kind==='browser'&&((destination.device==='phone'&&context.client.desktop)||(destination.device==='computer'&&!context.client.desktop)))throw fail('Ask from that device’s Jarvis page to open the website there.');
      return null;
    }
    const info=await status();
    const explicit=destination?.type==='display';
    if(!explicit&&(!info.websitesOnScreens||!context.client||navigationRequest(context.question)?.engine))return null;
    const devices=(await pairing.list()).devices.filter(d=>d.room===context.room);
    const normalized=value=>String(value).toLowerCase().replace(/\b(?:the|tv|television|screen|display)\b/g,'').replaceAll('-',' ').replace(/\s+/g,' ').trim();
    let target;
    if(destination?.name){
      const candidates=devices.filter(d=>normalized(d.name)===normalized(destination.name)||normalized(d.room)===normalized(destination.name));
      if(candidates.length!==1)throw fail('Choose a paired screen in this room by its name.');
      target=candidates[0];
    }else if(info.target?.room===context.room)target=devices.find(d=>d.id===info.target.id);
    else{
      const candidates=devices.filter(d=>visible(d.id));
      if(candidates.length>1)throw fail('More than one screen is showing Jarvis here. Say the screen’s name.');
      target=candidates[0];
    }
    if(!target){if(explicit)throw fail('No paired screen is available in this room.');return null;}
    return {label:`Open website on ${target.name}`,execute:async()=>{
      context.signal?.throwIfAborted();
      const fresh=await status(),current=(await pairing.list()).devices.find(d=>d.id===target.id&&d.room===context.room);
      if(!current||(!explicit&&!fresh.websitesOnScreens)||(target.id===info.target?.id&&fresh.target?.id!==target.id))throw fail('The screen assignment changed. Ask again using the current screen.');
      const previous=pending.get(context.room);if(previous)await previous;
      context.signal?.throwIfAborted();
      const native=target.id===fresh.target?.id&&fresh.remote.configured&&!navigationRequest(context.question)?.explicitBrowser&&remote.openWebsite?await remote.openWebsite(url.href,{signal:context.signal}):null;
      context.signal?.throwIfAborted();
      if(native?.supported)return{ok:true,outcome:native.confirmed?'confirmed':'unverified',summary:native.confirmed?`${native.app} is open on ${target.name}.`:`The ${native.app} launch was requested on ${target.name}, but the TV has not confirmed it is visible.`,url:url.href,outputTarget:{kind:'display',id:target.id,name:target.name}};
      if(target.id===fresh.target?.id&&!visible(target.id))await ensure(context.room,{force:true,signal:context.signal});
      if(!navigate||!visible(target.id))throw fail(`Open Jarvis on ${target.name} first so it can receive the website.`);
      if(canNavigate&&!canNavigate(target.id))throw fail(`Refresh the Jarvis page on ${target.name} once to load its website controls, then ask again.`);
      const sent=await navigate(target.id,url.href,{signal:context.signal});
      context.signal?.throwIfAborted();
      return{ok:true,outcome:'unverified',summary:sent.delivered?`Opening ${url.hostname} on ${target.name}. Use the TV’s Back button to return to Jarvis.`:`The website was sent to ${target.name}, but delivery could not be confirmed.`,url:url.href,outputTarget:{kind:'display',id:target.id,name:target.name}};
    }};
  }
  return {status,configure,ensure,enterAddress,websitePlan,pending:room=>pending.has(room),close:async()=>{closing.abort(Error('TV launcher closed'));await chain;await Promise.allSettled([...pending.values()]);}};
}
