const $ = id => document.getElementById(id);
async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The setup request could not finish.');
  return result;
}
function error(message) { $('setup-error').textContent = message; $('setup-error').hidden = !message; }
let codeTimer;
async function loadDisplays() {
  const info = await api('/api/displays');
  $('receiver-status').textContent = info.enabled ? `Open ${info.receiverUrl} on the TV, then enter a code created here.` : 'TV receiver is off. Configure the central computer’s local address using HOUSE-SETUP.md, then restart Jarvis.';
  $('create-code').disabled = !info.enabled || info.configurationError;
  $('paired-displays').replaceChildren(...info.devices.map(device => {
    const row = document.createElement('li');
    const label = document.createElement('span'); label.textContent = `${device.name} · ${device.room.replaceAll('-', ' ')}`;
    const remove = document.createElement('button'); remove.textContent = 'Unpair'; remove.type = 'button';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try { await api('/api/displays/revoke', { id: device.id }); await loadDisplays(); }
      catch (problem) { error(problem.message); remove.disabled = false; }
    });
    row.append(label, remove); return row;
  }));
  $('pairing-notice').hidden = !info.configurationError;
  $('pairing-notice').textContent = 'The saved display configuration needs attention. No new pairing can be created.';
}
async function load() {
  const results = await Promise.allSettled([api('/api/status'), api('/api/house-status'), api('/api/voices'), loadDisplays(), api('/api/calendar/status')]);
  const [status, house, voices, , calendar] = results;
  $('ai-status').textContent = status.status === 'fulfilled' && status.value.available && status.value.modelInstalled ? `${status.value.model} · ready locally` : 'Open Ollama and check the installed model';
  $('mic-status').textContent = house.status === 'fulfilled' && house.value.microphone.available ? 'Whisper · ready locally' : 'Run microphone setup';
  $('voice-status').textContent = voices.status === 'fulfilled' && voices.value.available ? 'Neural voices · ready locally' : 'Run voice setup';
  if (house.status === 'fulfilled') {
    const ha = house.value.homeAssistant;
    $('ha-status').textContent = ha.configurationError ? 'Connection or device file needs attention' : !ha.configured ? 'Connection setup needed' : ha.connected ? 'Connected locally' : 'Configured · currently unavailable';
    $('approved-devices').replaceChildren(...ha.exposedDevices.map(device => { const item = document.createElement('li'); item.textContent = `${device.label} · say “${device.aliases[0]}”`; return item; }));
  } else $('ha-status').textContent = 'Could not check connection';
  if (calendar.status === 'fulfilled') {
    const info = calendar.value;
    $('calendar-status').textContent = info.connected ? 'Connected · local authorization' : info.configured ? 'OAuth client ready · not connected' : 'Desktop OAuth file needed';
    $('connect-google').disabled = !info.configured || info.connected;
    $('connect-google').textContent = info.connected ? 'Google Calendar connected' : 'Connect Google Calendar';
    if (info.connected) $('calendar-notice').textContent = 'Connected. Try “Show my calendar today” or “Show me this week.”';
  } else $('calendar-status').textContent = 'Could not check connection';
  if (results.some(result => result.status === 'rejected')) error('Some setup checks could not finish. Check that Jarvis is running, then refresh.');
}
$('pairing-form').addEventListener('submit', async event => {
  event.preventDefault(); error(''); $('create-code').disabled = true;
  try {
    const result = await api('/api/pairing/start', { room: $('pair-room').value });
    $('pair-code-result').hidden = false; $('code-number').textContent = result.code;
    $('code-detail').textContent = 'Enter this on the TV within five minutes. Each code works once.';
    clearTimeout(codeTimer); codeTimer = setTimeout(() => { $('pair-code-result').hidden = true; }, Math.max(0, result.expiresAt - Date.now()));
  } catch (problem) { error(problem.message); }
  finally { $('create-code').disabled = false; }
});
$('check-network').addEventListener('click', async () => {
  const button = $('check-network'); button.disabled = true; $('network-status').textContent = 'Checking the central computer…';
  try {
    const info = await api('/api/network');
    $('network-status').textContent = info.connected === false ? 'No active connection was found.' : info.connected !== true ? info.detail : `Connected${info.adapter ? ` through ${info.adapter}` : ''}. ${info.gatewayResponds ? `Gateway answered${Number.isFinite(info.gatewayLatencyMs) ? ` in ${info.gatewayLatencyMs} ms` : ''}.` : 'Gateway did not answer a ping; it may block ping.'} Internet access and room coverage have not been verified.`;
  } catch (problem) { $('network-status').textContent = problem.message; }
  finally { button.disabled = false; }
});
async function importCalendarClient() {
  const file = $('calendar-client-file').files?.[0];
  if (!file) { $('calendar-notice').textContent = 'Choose the JSON file downloaded from your Google Desktop OAuth client.'; $('calendar-notice').hidden = false; return; }
  if (file.size > 16384) { $('calendar-notice').textContent = 'That file is larger than expected for an OAuth client.'; $('calendar-notice').hidden = false; return; }
  const button = $('save-google-client'); button.disabled = true;
  try {
    const credentials = JSON.parse(await file.text());
    const info = await api('/api/calendar/credentials', { credentials });
    $('calendar-status').textContent = info.connected ? 'Connected · local authorization' : 'OAuth client ready · not connected';
    $('connect-google').disabled = false; $('calendar-notice').textContent = 'OAuth client saved on this computer. Select Connect Google Calendar to choose and authorize your account.'; $('calendar-notice').hidden = false;
  } catch (problem) { $('calendar-notice').textContent = problem instanceof SyntaxError ? 'That file is not valid JSON.' : problem.message; $('calendar-notice').hidden = false; }
  finally { button.disabled = false; }
}
$('save-google-client').addEventListener('click', () => void importCalendarClient());
$('connect-google').addEventListener('click', async () => {
  const button = $('connect-google'); button.disabled = true; $('calendar-notice').hidden = true;
  try {
    const result = await api('/api/calendar/connect', {});
    location.assign(result.authorizationUrl);
  } catch (problem) { $('calendar-notice').textContent = problem.message; $('calendar-notice').hidden = false; button.disabled = false; }
});
window.addEventListener('focus', () => { void api('/api/calendar/status').then(info => { $('calendar-status').textContent = info.connected ? 'Connected · local authorization' : info.configured ? 'OAuth client ready · not connected' : 'Desktop OAuth file needed'; $('connect-google').disabled = !info.configured || info.connected; }); });
void load();
window.addEventListener('pagehide', () => clearTimeout(codeTimer));

api('/api/weather').then(info => { $('weather-setup-status').textContent = info.data ? 'Open-Meteo connected for ' + info.location.label + '.' : info.location ? 'Saved city: ' + info.location.label + '. Forecast currently unavailable.' : 'Choose a home city for current conditions and seven-day forecasts.'; }).catch(() => { $('weather-setup-status').textContent = 'Could not check weather. Open Weather setup to retry.'; });
