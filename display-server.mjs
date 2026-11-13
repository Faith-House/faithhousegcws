import http from 'node:http';
import { readFile } from 'node:fs/promises';
const publicRoot = new URL('./public/', import.meta.url);
const publicAssets = new Map([
  ['/', ['display.html', 'text/html; charset=utf-8']],
  ['/display', ['display.html', 'text/html; charset=utf-8']],
  ['/display.js', ['display.js', 'text/javascript; charset=utf-8']],
  ['/orb.js', ['orb.js', 'text/javascript; charset=utf-8']],
  ['/hud.css', ['hud.css', 'text/css; charset=utf-8']],
  ['/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
  ['/search-sources.js', ['search-sources.js', 'text/javascript; charset=utf-8']],
  ['/weather-view.js', ['weather-view.js', 'text/javascript; charset=utf-8']],
  ['/weather.css', ['weather.css', 'text/css; charset=utf-8']],
  ['/agenda.js', ['agenda.js', 'text/javascript; charset=utf-8']],
  ['/calendar.css', ['calendar.css', 'text/css; charset=utf-8']],
  ['/tv-dashboard.js', ['tv-dashboard.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const json = (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
export function createDisplayServer({ pairing, bindAddress, snapshot, subscribe, dashboard, allowedHosts = [] } = {}) {
  const streams = new Map(), presence = new Map();
  const hosts = new Set([bindAddress, '127.0.0.1', 'localhost', ...allowedHosts]);
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'microphone=(), camera=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = new URL(`http://${request.headers.host || ''}`);
      if (!hosts.has(host.hostname) || Number(host.port) !== server.address().port) return json(response, 403, { error: 'Use the configured local TV receiver address.' });
      if (request.headers.origin && request.headers.origin !== host.origin) return json(response, 403, { error: 'Use the Jarvis TV receiver page.' });
      const url = new URL(request.url, host);
      if (request.method === 'GET' && publicAssets.has(url.pathname)) {
        const [file, mime] = publicAssets.get(url.pathname);
        response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
        return response.end(await readFile(new URL(file, publicRoot)));
      }
      if (request.method === 'POST' && url.pathname === '/api/pair') {
        if (request.headers['content-type'] !== 'application/json') return json(response, 415, { error: 'Use the TV pairing form.' });
        const chunks = []; let length = 0;
        for await (const chunk of request) { length += chunk.length; if (length > 2048) return json(response, 413, { error: 'Pairing request is too large.' }); chunks.push(chunk); }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return json(response, 400, { error: 'Enter the pairing code and display name.' }); }
        const session = await pairing.pair({ code: body?.code, name: body?.name, address: request.socket.remoteAddress || '' });
        response.setHeader('Set-Cookie', `jarvis_display=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
        return json(response, 200, { room: session.room, name: session.name });
      }
      const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('jarvis_display='))?.slice('jarvis_display='.length);
      const session = await pairing.authenticate(token);
      if (!session) return json(response, 401, { error: 'Pair this display from the central computer.' });
      if (request.method === 'POST' && url.pathname === '/api/presence') {
        if (request.headers['content-type'] !== 'application/json') return json(response, 415, { error: 'Use the paired receiver page.' });
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 512) return json(response, 413, { error: 'Presence update is too large.' }); chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return json(response, 400, { error: 'Invalid presence update.' }); }
        if (!body || Object.keys(body).some(key => key !== 'visible') || typeof body.visible !== 'boolean') return json(response, 400, { error: 'Invalid presence update.' });
        presence.set(session.id, { visible: body.visible, at: Date.now() });
        return json(response, 200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/display-session') return json(response, 200, session);
      if (request.method === 'GET' && url.pathname === '/api/dashboard') {
        if (snapshot(session.room).view !== 'dashboard' || !dashboard) return json(response, 403, { error: 'Ask Jarvis to show the dashboard for this room.' });
        return json(response, 200, await dashboard(session.room));
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        if (!streams.has(session.id)) streams.set(session.id, new Set());
        const deviceStreams = streams.get(session.id);
        if (deviceStreams.size >= 3) return json(response, 429, { error: 'Close extra copies of this TV receiver.' });
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        deviceStreams.add(response);
        const unwatch = subscribe(session.room, response);
        response.write(`data: ${JSON.stringify(snapshot(session.room))}\n\n`);
        const heartbeat = setInterval(async () => {
          if (!await pairing.authenticate(token)) { response.write('event: revoked\ndata: {}\n\n'); response.end(); }
          else if (!response.destroyed) response.write(': keep-alive\n\n');
        }, 15000); heartbeat.unref();
        response.on('close', () => { clearInterval(heartbeat); unwatch(); deviceStreams.delete(response); if (!deviceStreams.size) streams.delete(session.id); });
        return;
      }
      return json(response, 403, { error: 'This paired display can only receive its assigned room’s HUD.' });
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'The display receiver could not finish this request.' });
      else response.end();
    }
  });
  function revoke(id) { presence.delete(id); for (const response of streams.get(id) || []) { response.write('event: revoked\ndata: {}\n\n'); response.end(); } streams.delete(id); }
  async function close() { for (const id of streams.keys()) revoke(id); if (server.listening) await new Promise(resolve => server.close(resolve)); }
  const connectedIds = () => [...streams].filter(([, clients]) => [...clients].some(client => !client.destroyed)).map(([id]) => id);
  const isVisible = id => { const seen = presence.get(id); return Boolean(seen?.visible && Date.now() - seen.at < 12000 && [...(streams.get(id) || [])].some(client => !client.destroyed)); };
  return { server, revoke, close, connectedIds, isVisible };
}
