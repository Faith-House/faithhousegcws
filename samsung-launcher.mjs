import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import dgram from 'node:dgram';
import WebSocket from 'ws';

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
export function createSamsungLauncher({ directory, fetchImpl = fetch, WebSocketImpl = WebSocket, sendWakeImpl = sendWake } = {}) {
  async function saved() {
    try {
      const config = JSON.parse(await readFile(path.join(directory, 'samsung-tv.json'), 'utf8'));
      const host = config.host || config.address;
      if (!privateIPv4(host) || typeof config.token !== 'string' || !config.token) throw Error();
      const certificate = await readFile(path.join(directory, 'samsung-tv-certificate.pem'), 'utf8');
      return { host, token: config.token, certificate, pinned: new X509Certificate(certificate) };
    } catch { throw fail('The Samsung’s approved local connection or pinned certificate is missing. Reconnect the TV first.'); }
  }
  async function status() {
    try { const config = await saved(); return { configured: true, host: config.host }; }
    catch { return { configured: false }; }
  }
  async function online({ signal } = {}) {
    const config = await saved();
    try { const result = await fetchImpl(`http://${config.host}:8001/api/v2/`, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000) }); return result.ok; }
    catch { signal?.throwIfAborted(); return false; }
  }
  async function launchBrowser(receiverUrl, { signal, legacy = false } = {}) {
    const url = new URL(receiverUrl);
    if (url.protocol !== 'http:' || !privateIPv4(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fail('Use the configured private Jarvis receiver address.');
    const config = await saved(); signal?.throwIfAborted();
    const params = new URLSearchParams({ name: Buffer.from('Jarvis').toString('base64'), token: config.token });
    await new Promise((resolve,reject) => {
      const socket = new WebSocketImpl(`wss://${config.host}:8002/api/v2/channels/samsung.remote.control?${params}`, {
        ca: config.certificate,
        checkServerIdentity: (_name, cert) => cert.fingerprint256 === config.pinned.fingerprint256 ? undefined : fail('The Samsung certificate changed. Reconnect it locally.'),
        handshakeTimeout: 4000, maxPayload: 1048576,
      });
      let finished = false, settle;
      const timer = setTimeout(() => finish(fail('The Samsung did not authorize the browser request.')), 6500);
      const abort = () => finish(signal.reason || Error('Cancelled'));
      function finish(error) {
        if (finished) return; finished = true; clearTimeout(timer); clearTimeout(settle); signal?.removeEventListener('abort',abort); socket.terminate();
        error ? reject(error) : resolve();
      }
      signal?.addEventListener('abort',abort,{once:true});
      socket.on('error',()=>finish(fail('The Samsung remote connection failed. Check its power, network and permission.')));
      socket.on('close',()=>{if(!finished)finish(fail('The Samsung closed the browser request.'));});
      socket.on('message',bytes=>{
        let data;try{data=JSON.parse(bytes.toString());}catch{return;}
        if(['ms.channel.unauthorized','ms.channel.timeOut'].includes(data.event))return finish(fail('The Samsung needs to authorize Jarvis again.'));
        if(data.event!=='ms.channel.connect'||settle)return;
        try { socket.send(JSON.stringify({method:'ms.channel.emit',params:{event:'ed.apps.launch',to:'host',data:{appId:legacy?'3202010022079':'org.tizen.browser',action_type:'NATIVE_LAUNCH',metaTag:url.href}}})); settle=setTimeout(()=>finish(),500); }
        catch { finish(fail('The Samsung browser command was not sent.')); }
      });
    });
    return { requested: true };
  }
  return { status, online, launchBrowser, wake: sendWakeImpl };
}
