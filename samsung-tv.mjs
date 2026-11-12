import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { isIP } from 'node:net';
import { APP_ROOT } from './voice-config.mjs';

const filename = path.join(APP_ROOT, 'private', 'samsung-tv.json');
function localAddress(address) { return isIP(address) === 4 && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address); }
export async function readSamsungConfig() {
  try { const config = JSON.parse(await readFile(filename, 'utf8')); return localAddress(config.address) ? config : null; } catch { return null; }
}
export async function samsungRequest({ address, token = '', receiverUrl, pairOnly = false, timeoutMs = 45000 } = {}) {
  if (!localAddress(address)) throw new Error('Choose a private IPv4 address for the Samsung TV.');
  if (!pairOnly) {
    const url = new URL(receiverUrl);
    if (url.protocol !== 'http:' || !localAddress(url.hostname) || url.username || url.password) throw new Error('Use the local Jarvis TV receiver URL.');
  }
  const endpoint = new URL(`ws://${address}:8001/api/v2/channels/samsung.remote.control`);
  endpoint.searchParams.set('name', Buffer.from('Jarvis').toString('base64'));
  if (token) endpoint.searchParams.set('token', token);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    let finished = false;
    const timer = setTimeout(() => finish(new Error('The TV did not approve the connection. Check its permission prompt and retry.')), timeoutMs);
    function finish(error, result) {
      if (finished) return;
      finished = true; clearTimeout(timer); socket.close();
      if (error) reject(error); else resolve(result);
    }
    socket.addEventListener('message', async event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.event === 'ms.channel.unauthorized' || message.event === 'ms.channel.timeOut') return finish(new Error('The TV did not authorize Jarvis. Accept the request with the TV remote, then retry.'));
      if (message.event !== 'ms.channel.connect' || finished) return;
      try {
        const receivedToken = String(message.data?.token || token || '');
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, JSON.stringify({ address, token: receivedToken }, null, 2) + '\n', { mode: 0o600 });
        if (!pairOnly) socket.send(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { action_type: 'NATIVE_LAUNCH', appId: 'org.tizen.browser', metaTag: receiverUrl } } }));
        // This acknowledges the remote command only; the receiver connection confirms rendering.
        setTimeout(() => finish(null, { authorized: true, browserLaunchRequested: !pairOnly }), pairOnly ? 0 : 700);
      } catch { finish(new Error('The Samsung connection could not be saved or used.')); }
    });
    socket.addEventListener('error', () => finish(new Error('The Samsung remote connection is unavailable on port 8001.')));
    socket.addEventListener('close', () => { if (!finished) finish(new Error('The TV closed the remote connection before authorizing Jarvis.')); });
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const operation = process.argv[2];
  const config = await readSamsungConfig();
  if (!['pair', 'show'].includes(operation)) throw new Error('Use: node samsung-tv.mjs pair TV_IP, or node samsung-tv.mjs show RECEIVER_URL');
  const address = operation === 'pair' ? process.argv[3] : config?.address;
  try {
    console.log('Connecting to the Samsung TV. Accept Jarvis with the remote if it asks.');
    const result = await samsungRequest({ address, token: config?.address === address ? config.token : '', pairOnly: operation === 'pair', receiverUrl: operation === 'show' ? process.argv[3] : undefined });
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
