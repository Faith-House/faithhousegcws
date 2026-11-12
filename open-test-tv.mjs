import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import WebSocket from 'ws';

// Reuse the TV's already approved local connection. Never print its token.
try {
  const saved = JSON.parse(await readFile(new URL('./private/samsung-tv.json', import.meta.url), 'utf8'));
  const host = saved.host;
  if (!/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) || !saved.token) throw new Error('Pair the Samsung with Jarvis first.');
  const certificate = await readFile(new URL('./private/samsung-tv-certificate.pem', import.meta.url), 'utf8');
  const pinned = new X509Certificate(certificate);
  const displayHost = process.env.JARVIS_DISPLAY_BIND;
  if (!/^192\.168\.\d{1,3}\.\d{1,3}$/.test(displayHost || '')) throw new Error('Check the TV receiver address in .env.local.');
  const displayPort = Number(process.env.JARVIS_DISPLAY_PORT || 3211);
  if (!Number.isInteger(displayPort) || displayPort < 1 || displayPort > 65535) throw new Error('Check the TV receiver port.');
  const url = `http://${displayHost}:${displayPort}/`;
  const appId = '3202010022079';
  const launched = await fetch(`http://${host}:8001/api/v2/applications/${appId}`, { method: 'POST', signal: AbortSignal.timeout(5000) });
  if (!launched.ok) throw new Error('The TV did not accept the browser launch. Check that it is on and connected.');
  await new Promise((resolve, reject) => {
    const params = new URLSearchParams({ name: Buffer.from('Jarvis').toString('base64'), token: String(saved.token) });
    const socket = new WebSocket(`wss://${host}:8002/api/v2/channels/samsung.remote.control?${params}`, {
      ca: certificate,
      checkServerIdentity: (_name, cert) => cert.fingerprint256 === pinned.fingerprint256 ? undefined : new Error('The Samsung certificate changed; reconnect the TV.'),
      handshakeTimeout: 5000, maxPayload: 1024 * 1024,
    });
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('The Samsung connection timed out.')); }, 10000);
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('message', bytes => {
      let packet; try { packet = JSON.parse(bytes.toString()); } catch { return; }
      if (packet.event === 'ms.channel.connect') {
        socket.send(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { appId, action_type: 'NATIVE_LAUNCH', metaTag: url } } }));
        setTimeout(() => { clearTimeout(timer); socket.close(); resolve(); }, 1000);
      } else if (['ms.channel.unauthorized', 'ms.channel.timeOut'].includes(packet.event)) {
        clearTimeout(timer); socket.close(); reject(new Error('The Samsung needs to authorize Jarvis again.'));
      }
    });
  });
  console.log(`Requested the Samsung browser. If it opens its home page, enter ${url} in its address bar.`);
  console.log('Keep Jarvis running on the central computer. This launcher does not wake a powered-off TV.');
} catch (error) { console.error(`Could not open the test TV: ${error.message}`); process.exitCode = 1; }
