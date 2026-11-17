import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import dgram from 'node:dgram';
import WebSocket from 'ws';
import { websiteAddress } from './screen-target.mjs';

const fail = message => Object.assign(new Error(message), { status: 409 });
export const privateIPv4 = address => isIP(address) === 4 && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address);
export function wakePacket(mac) {
  if (typeof mac !== 'string' || !/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(mac)) throw fail('Enter the TV’s valid network MAC address before enabling wake.');
  const bytes = Buffer.from(mac.replaceAll(':', ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 255), ...Array.from({ length: 16 }, () => bytes)]);
}
export async function sendWake(mac) {
  const packet = wakePacket(mac), socket = dgram.createSocket('udp4');
  try {
    await new Promise((resolve,reject) => { socket.once('error',reject); socket.bind(0,resolve); });
    socket.setBroadcast(true);
    await new Promise((resolve,reject) => socket.send(packet, 9, '255.255.255.255', error => error ? reject(error) : resolve()));
  } finally { socket.close(); }
}
export function createSamsungLauncher({ directory, fetchImpl = fetch, WebSocketImpl = WebSocket, sendWakeImpl = sendWake, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  async function saved() {
    try {
      const config = JSON.parse(await readFile(path.join(directory, 'samsung-tv.json'), 'utf8'));
      const host = config.host || config.address;
      if (!privateIPv4(host) || typeof config.token !== 'string' || !config.token) throw Error();
      const certificate = await readFile(path.join(directory, 'samsung-tv-certificate.pem'), 'utf8');
      const launchMethod = config.launchMethod || 'websocket';
      if (!['websocket', 'home-rest'].includes(launchMethod)) throw Error();
      return { host, token: config.token, certificate, pinned: new X509Certificate(certificate), launchMethod };
    } catch { throw fail('The Samsung’s approved local connection or pinned certificate is missing. Reconnect the TV first.'); }
  }
  async function status() {
    try { const config = await saved(); return { configured: true, host: config.host, launchMethod: config.launchMethod }; }
    catch { return { configured: false }; }
  }
  async function online({ signal } = {}) {
    const config = await saved();
    try { const result = await fetchImpl(`http://${config.host}:8001/api/v2/`, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000) }); return result.ok; }
    catch { signal?.throwIfAborted(); return false; }
  }
  async function sendRemote(config, command, { signal } = {}) {
    signal?.throwIfAborted();
    const params = new URLSearchParams({ name: Buffer.from('Jarvis').toString('base64'), token: config.token });
    await new Promise((resolve,reject) => {
      const socket = new WebSocketImpl(`wss://${config.host}:8002/api/v2/channels/samsung.remote.control?${params}`, {
        ca: config.certificate,
        checkServerIdentity: (_name, cert) => cert.fingerprint256 === config.pinned.fingerprint256 ? undefined : fail('The Samsung certificate changed. Reconnect it locally.'),
        handshakeTimeout: 4000, maxPayload: 1048576,
      });
      let finished = false, started = false, settle;
      const steps = [];
      const timer = setTimeout(() => finish(fail('The Samsung did not authorize the browser request.')), 6500);
      const abort = () => finish(signal.reason || Error('Cancelled'));
      function finish(error) {
        if (finished) return; finished = true; clearTimeout(timer); clearTimeout(settle); for (const step of steps) clearTimeout(step); signal?.removeEventListener('abort',abort); socket.terminate();
        error ? reject(error) : resolve();
      }
      signal?.addEventListener('abort',abort,{once:true});
      socket.on('error',()=>finish(fail('The Samsung remote connection failed. Check its power, network and permission.')));
      socket.on('close',()=>{if(!finished)finish(fail('The Samsung closed the browser request.'));});
      socket.on('message',bytes=>{
        let data;try{data=JSON.parse(bytes.toString());}catch{return;}
        if(['ms.channel.unauthorized','ms.channel.timeOut'].includes(data.event))return finish(fail('The Samsung needs to authorize Jarvis again.'));
        if(data.event==='ms.error')return finish(fail('The Samsung rejected that remote command.'));
        if(data.event!=='ms.channel.connect'||started)return;
        started = true;
        const commands = Array.isArray(command) ? command : [command];
        commands.forEach((packet,index)=>steps.push(setTimeout(()=>{
          if(finished)return;
          try { socket.send(JSON.stringify(packet)); if(index===commands.length-1)settle=setTimeout(()=>finish(),500); }
          catch { finish(fail('The Samsung browser command was not sent.')); }
        },index*450)));
      });
    });
  }
  async function launchBrowser(receiverUrl, { signal, legacy = false, foregroundOnly = false } = {}) {
    const url = new URL(receiverUrl);
    if (url.protocol !== 'http:' || !privateIPv4(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fail('Use the configured private Jarvis receiver address.');
    const config = await saved(); signal?.throwIfAborted();
    if (config.launchMethod === 'home-rest') {
      // This Samsung starts the browser in the background unless Smart Hub is opened first.
      if (!foregroundOnly) {
        await sendRemote(config, { method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: 'KEY_HOME', Option: 'false', TypeOfRemote: 'SendRemoteKey' } }, { signal });
        await wait(500); signal?.throwIfAborted();
      }
      const address = `http://${config.host}:8001/api/v2/applications/3202010022079`;
      const requestSignal = () => signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
      let response;
      try { response = await fetchImpl(address, { method: 'POST', redirect: 'error', signal: requestSignal() }); }
      catch { signal?.throwIfAborted(); throw fail('The Samsung browser could not be started.'); }
      if (!response.ok) throw fail('The Samsung rejected the browser launch.');
      const launched = await response.json().catch(() => null);
      if (launched === false || Number(launched?.code) >= 400) throw fail('The Samsung rejected the browser launch.');
      let browserVisible = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        signal?.throwIfAborted();
        const status = await fetchImpl(address, { redirect: 'error', signal: requestSignal() }).then(async r => r.ok ? r.json() : null).catch(() => null);
        if (status?.running === true && status.visible === true) { browserVisible = true; break; }
        await wait(350);
      }
      signal?.throwIfAborted();
      // Foreground browser status does not prove that its tab loaded the Jarvis receiver.
      return { requested: true, browserVisible, navigationConfirmed: false };
    }
    await sendRemote(config, {method:'ms.channel.emit',params:{event:'ed.apps.launch',to:'host',data:{appId:legacy?'3202010022079':'org.tizen.browser',action_type:'NATIVE_LAUNCH',metaTag:url.href}}}, { signal });
    return { requested: true };
  }
  async function focusBrowser(receiverUrl, options = {}) {
    const config = await saved();
    if (config.launchMethod !== 'home-rest') return { requested: false };
    return launchBrowser(receiverUrl, { ...options, foregroundOnly: true });
  }
  async function enterReceiverUrl(receiverUrl, { signal } = {}) {
    const url = new URL(receiverUrl);
    if (url.protocol !== 'http:' || !privateIPv4(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fail('Use the configured private Jarvis receiver address.');
    const config = await saved();
    await sendRemote(config, [
      {method:'ms.channel.emit',params:{event:'custom.remote.textReceived',to:'broadcast'}},
      {method:'ms.remote.control',params:{Cmd:Buffer.from(url.href).toString('base64'),DataOfCmd:'base64',TypeOfRemote:'SendInputString'}},
      {method:'ms.remote.control',params:{TypeOfRemote:'SendInputEnd'}},
      {method:'ms.remote.control',params:{Cmd:'Click',DataOfCmd:'KEY_ENTER',Option:'false',TypeOfRemote:'SendRemoteKey'}}
    ], { signal });
    return {requested:true,navigationConfirmed:false,detail:'The Jarvis address was sent to the TV. Pair the screen if prompted.'};
  }
  async function openWebsite(address, { signal } = {}) {
    const url = websiteAddress(address);
    if (!['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname) || url.pathname !== '/' || url.search || url.hash) return { supported: false };
    const config = await saved();
    const request = async (app, method = 'GET') => {
      signal?.throwIfAborted();
      try {
        const result = await fetchImpl(`http://${config.host}:8001/api/v2/applications/${app}`, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
        return { ok: result.ok, status: result.status, data: await result.json().catch(()=>null) };
      } catch { signal?.throwIfAborted();throw fail('The TV did not answer. Check its power and network connection.'); }
    };
    let app, current;
    for (const candidate of ['111299001912','9Ur5IzDKqV.TizenYouTube']) {
      const result = await request(candidate);
      if (result.ok && /^youtube$/i.test(result.data?.name || '')) { app = candidate; current = result.data; break; }
    }
    if (!app) return { supported: false };
    if (!current.visible) {
      await sendRemote(config,{method:'ms.remote.control',params:{Cmd:'Click',DataOfCmd:'KEY_HOME',Option:'false',TypeOfRemote:'SendRemoteKey'}},{signal});
      await wait(500);
    }
    const launched = await request(app,'POST');
    if (!launched.ok || launched.data === false || Number(launched.data?.code) >= 400) throw fail('The TV rejected the YouTube launch.');
    let confirmed = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await request(app);
      if (result.data?.running === true && result.data.visible === true) { confirmed = true; break; }
      await wait(350);
    }
    signal?.throwIfAborted();
    return { supported: true, confirmed, app: 'YouTube' };
  }
  return { status, online, launchBrowser, focusBrowser, enterReceiverUrl, openWebsite, wake: sendWakeImpl };
}
