import { readStartupStatus } from './startup-status.mjs';
const row = (id, label, status, detail, fix = '', href = '') => ({ id, label, status, detail, fix, href });
async function bounded(check, timeoutMs) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(check), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

export function createDiagnostics({ checks, now = Date.now, timeoutMs = 10000, cacheMs = 15000 } = {}) {
  let pending, cached;
  async function run() {
    if (pending) return pending;
    if (cached && now() - cached.checkedAt < cacheMs) return cached;
    pending = (async () => {
      const items = await Promise.all(checks.map(async check => {
        try { return await bounded(check.run, timeoutMs); }
        catch { return row(check.id, check.label, 'unknown', 'This check did not finish or could not read its status.', 'Try again. If this persists, reopen Jarvis and inspect its server window.'); }
      }));
      const issues = items.filter(item => ['error', 'warning', 'unknown'].includes(item.status));
      const setup = items.filter(item => item.status === 'setup');
      cached = { checkedAt: now(), items, issues: issues.length, setup: setup.length, summary: issues.length ? 'Connections needing attention: ' + issues.map(item => item.label).join(', ') + '. ' + issues[0].detail + (issues[0].fix ? ' ' + issues[0].fix : '') : 'The checked connections are responding or their local files are installed. Browser microphone and speaker tests still need to be run on this device.', note: setup.length ? setup.map(item => item.label).join(', ') + ' still need setup; these are not counted as broken connections.' : '' };
      return cached;
    })().finally(() => { pending = null; });
    return pending;
  }
  return { run, peek: () => cached };
}

export function connectionChecks({ checkModel, speech, recognition, wakeword, speakerId, homeAssistant, calendar, pairing, displayStatus, webSearch, weather, network, fetchImpl = fetch }) {
  const checks = [];
  const add = (id, label, run) => checks.push({ id, label, run });
  add('server', 'Jarvis server', () => row('server', 'Jarvis server', 'ok', 'The local server answered this diagnostics request.'));
  add('startup', 'Startup and recovery', async () => {
    const s=await readStartupStatus();
    return row('startup','Startup and recovery',s.configurationError?'error':!s.configured?'setup':s.responding&&s.state==='healthy'?'ok':'warning',s.configurationError?'Startup configuration needs attention.':!s.configured?'Automatic startup is not configured.':s.responding?'The recovery supervisor is responding. Server state: '+s.state+'.':'Startup configuration exists, but its supervisor is not responding.',!s.configured?'Run INSTALL-STARTUP.ps1 to configure current-user startup.':!s.responding?'Start the Jarvis task in Windows Task Scheduler or run RUN-JARVIS.ps1.':'Starts at Windows sign-in. Browser microphone permission is separate.');
  });
  add('ai', 'Local AI', async () => {
    const s = await checkModel();
    return row('ai', 'Local AI', s.available && s.modelInstalled ? 'ok' : 'error', !s.available ? 'Ollama is not responding.' : !s.modelInstalled ? 'The selected conversation model is not installed.' : 'Ollama responded and the selected model is installed. Answer generation was not tested.', !s.available ? 'Open Ollama, then run diagnostics again.' : !s.modelInstalled ? 'Install the model selected in Jarvis configuration: ' + s.model : '');
  });
  add('speech', 'Local voice', async () => {
    const s = await speech.listVoices();
    const found = s.available && s.voices?.length;
    return row('speech', 'Local voice', found ? 'ok' : 'error', found ? 'Voice files are installed. Use Test speaker below to check generation and this browser’s playback.' : 'No usable local voice was found.', found ? '' : 'Run SETUP-POCKET-VOICE.cmd for Peter, or SETUP-VOICE.cmd for Kokoro.');
  });
  for (const [id, label, service, command] of [['recognition', 'Speech recognition', recognition, 'SETUP-MICROPHONE.cmd'], ['wake', 'Hey Jarvis detector', wakeword, 'SETUP-LISTENING.cmd'], ['speaker', 'Speaker identification', speakerId, 'SETUP-SPEAKER-ID.cmd']]) {
    add(id, label, () => { const s = service.status(); return row(id, label, s.available ? 'ok' : id === 'speaker' ? 'setup' : 'error', s.available ? 'Local model files are installed.' + (id === 'wake' ? s.listening ? ' A browser currently owns the listener.' : ' Wake listening is off; enable it in Jarvis when needed.' : '') : 'Local model files are missing or unavailable.', s.available ? '' : 'Run ' + command + '.'); });
  }
  add('network', 'Computer network', async () => {
    const s = await network.check();
    return row('network', 'Computer network', s.connected === true ? s.gatewayResponds === false ? 'warning' : 'ok' : s.connected === false ? 'error' : 'unknown', s.connected === true ? s.gatewayResponds === false ? 'An adapter is connected, but the gateway did not answer a ping.' : 'A network adapter is connected. This does not measure whole-house Wi-Fi coverage.' : s.connected === false ? 'No active network adapter was found.' : 'Network adapter status could not be read.', s.connected === true && s.gatewayResponds === false ? 'The router may block ping. Check the separate internet test before treating this as an outage.' : s.connected !== true ? 'Check Wi-Fi or Ethernet on the central computer.' : '');
  });
  add('internet', 'Internet HTTPS', async () => {
    try {
      const response = await fetchImpl('https://example.com/', { signal: AbortSignal.timeout(6000), redirect: 'error' });
      await response.body?.cancel();
      return row('internet', 'Internet HTTPS', response.ok ? 'ok' : 'warning', response.ok ? 'An HTTPS request to example.com succeeded. Other services can still fail independently.' : 'The test website answered with an unexpected status.', response.ok ? '' : 'Try another website manually; check for a captive portal or service filtering.');
    } catch { return row('internet', 'Internet HTTPS', 'error', 'The HTTPS test could not reach example.com.', 'Check internet access, DNS, VPN settings, or a Wi-Fi sign-in page.'); }
  });
  add('search', 'Internet search', async () => {
    if (!webSearch.status().enabled) return row('search', 'Internet search', 'setup', 'Search is disabled in Jarvis configuration.', 'Set JARVIS_WEB_SEARCH=on in .env.local and restart Jarvis to enable it.');
    const result = await webSearch.probe();
    return row('search', 'Internet search', result.ok ? 'ok' : 'warning', result.ok ? 'DuckDuckGo returned usable search snippets. AI summarization was not tested.' : 'The search provider did not return usable results.', result.ok ? '' : 'If HTTPS works, the provider may be blocking requests or showing a challenge. Wait and retry.');
  });
  add('weather', 'Weather service', async () => {
    const s = weather ? await weather.status() : { configured: false };
    if (!s.configured || s.configurationError) return row('weather', 'Weather service', s.configurationError ? 'error' : 'setup', s.configurationError ? 'Saved weather settings need attention.' : 'No home weather location is selected.', 'Choose your city on the Weather page.', '/weather');
    try { await weather.read(); return row('weather', 'Weather service', 'ok', 'Open-Meteo forecast data is available for ' + s.location.label + '.', 'Current conditions are model-based; official weather alerts are not connected.'); }
    catch { return row('weather', 'Weather service', 'warning', 'The forecast provider could not return current data.', 'Check internet access and retry. The provider may be temporarily unavailable.', '/weather'); }
  });
  add('home', 'Home Assistant', async () => {
    const s = await homeAssistant.status({ checkConnection: true });
    return row('home', 'Home Assistant', s.configurationError ? 'error' : !s.configured ? 'setup' : s.connected ? 'ok' : 'error', s.configurationError ? 'The shared-device configuration needs attention.' : !s.configured ? 'Home Assistant is not configured yet.' : s.connected ? 'Home Assistant answered the connection check. Individual devices were not operated.' : 'Configured, but Home Assistant could not be reached or authenticated.', !s.configured ? 'Connect Home Assistant in House setup when ready.' : !s.connected ? 'Check the Home Assistant address, server power, network and access token locally.' : '', '/setup');
  });
  add('calendar', 'Google Calendar', async () => {
    const s = await calendar.status();
    return row('calendar', 'Google Calendar', s.connected ? 'untested' : 'setup', s.connected ? 'Authorization is saved. This check does not verify Google accepted it; request a real calendar preview to test.' : 'Google Calendar is not connected; demo calendars still work.', s.connected ? 'Ask “Show my calendar today”. Reconnect in House setup if Google rejects the request.' : 'Connect a shared household Google account in House setup when ready.', '/setup');
  });
  add('tv', 'TV display connections', async () => {
    const s = await pairing.list(), receiver = displayStatus();
    if (s.configurationError) return row('tv', 'TV display connections', 'error', 'Saved screen pairing data could not be read.', 'Inspect the pairing configuration before pairing again.', '/setup');
    if (!s.devices.length) return row('tv', 'TV display connections', 'setup', 'No TV screens are paired.', 'Pair a screen in House setup.', '/setup');
    const connected = s.devices.filter(d => receiver.connectedIds.includes(d.id));
    return row('tv', 'TV display connections', !receiver.enabled || connected.length !== s.devices.length ? 'warning' : 'ok', connected.length + ' of ' + s.devices.length + ' paired screens have an active receiver connection.' + (!receiver.enabled ? ' The TV receiver server is not listening.' : ''), !receiver.enabled ? 'Connect the central computer to the configured home network, check the receiver address in local configuration, and restart Jarvis. Then reopen the TV receiver page. A disconnected receiver does not prove the TV is powered off.' : connected.length !== s.devices.length ? 'Turn on the TV and reopen its paired Jarvis receiver page on the home network. A disconnected receiver does not prove the TV is powered off.' : 'This checks the browser connection, not screen visibility or TV remote control.', '/setup');
  });
  return checks;
}
