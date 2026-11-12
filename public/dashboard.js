import './hud.js';

const $ = id => document.getElementById(id);
const roomName = id => id === 'living-room' ? 'Living room' : `Bedroom ${id.split('-').at(-1)}`;
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
let data, refreshing = false, networkBusy = false, timeZone = 'America/Chicago', serverOffset = 0, previousReady, profilesKey = '', previousWake;
let seenAnswers = new Set(); const activity = [], roomRows = new Map();
const core = $('hud'), coreParent = core.parentElement, coreNext = core.nextElementSibling;
const askButton = $('ask-button'), askParent = askButton.parentElement, askNext = askButton.nextElementSibling;
const floatingControls = ['playback-controls', 'listening-indicator'].map(id => { const element = $(id); return { element, parent: element.parentElement, next: element.nextElementSibling }; });
let lastViewCommand;
function setCentralView(view) {
  const dashboard = view === 'dashboard';
  document.body.classList.toggle('dashboard-layout', dashboard);
  document.documentElement.classList.toggle('dashboard-document', dashboard);
  document.body.dataset.view = view;
  document.querySelector('.dashboard-shell').hidden = !dashboard;
  $('central-minimal-stage').hidden = dashboard;
  $('control-view').hidden = dashboard;
  if (dashboard) { coreParent.insertBefore(core, coreNext); askParent.insertBefore(askButton, askNext); }
  else { $('central-minimal-stage').append(core); document.body.append(askButton); }
  for (const item of floatingControls) {
    if (dashboard) item.parent.insertBefore(item.element, item.next?.parentElement === item.parent ? item.next : null);
    else document.body.append(item.element);
  }
  document.title = dashboard ? 'Jarvis · Control room' : 'Jarvis';
  const url = new URL(location.href); url.pathname = dashboard ? '/dashboard' : '/assistant';
  history.replaceState(null, '', url);
}
setCentralView(location.pathname === '/assistant' ? 'minimal' : 'dashboard');
async function api(path) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  const info = await response.json(); if (!response.ok) throw new Error(info.error || 'Status unavailable'); return info;
}
const gb = bytes => Number.isFinite(bytes) ? `${(bytes / 1073741824).toFixed(1)} GB` : '—';
const percent = (used, total) => Number.isFinite(used) && total > 0 ? Math.max(0, Math.min(100, Math.round(used / total * 100))) : null;
function metric(id, value, detail) {
  $(id + '-value').textContent = Number.isFinite(value) ? `${value}%` : '—';
  $(id + '-bar').style.width = `${Number.isFinite(value) ? value : 0}%`;
  $(id + '-bar').classList.toggle('warning', Number.isFinite(value) && value >= 85);
  $(id + '-detail').textContent = detail;
}
function addActivity(message) {
  activity.unshift({ message, at: new Date(Date.now() + serverOffset) }); activity.splice(4);
  $('dashboard-activity').replaceChildren(...activity.map(item => {
    const row = node('li', undefined, 'activity-entry'); row.append(node('span', '', 'status-dot'), node('span', item.message));
    row.append(node('time', new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(item.at))); return row;
  }));
}
function selectedRoom() { return $('room').value; }
function syncRoomSelection() {
  const room = selectedRoom(); $('dashboard-room').value = room; $('quiet-view').href = `/assistant?room=${encodeURIComponent(room)}`; $('control-view').href = `/dashboard?room=${encodeURIComponent(room)}`;
  for (const [id, row] of roomRows) { row.button.classList.toggle('selected', id === room); row.button.setAttribute('aria-pressed', String(id === room)); }
}
function chooseRoom(room) {
  if (room === selectedRoom()) return;
  $('room').value = room; $('room').dispatchEvent(new Event('change', { bubbles: true })); syncRoomSelection();
}
function renderRooms() {
  if (!data?.rooms) return;
  if (!roomRows.size) $('dashboard-rooms').replaceChildren();
  for (const room of data.rooms) {
    let row = roomRows.get(room.id);
    if (!row) {
      const button = node('button', undefined, 'room-row'); button.type = 'button'; button.setAttribute('aria-label', `Use ${roomName(room.id)}`);
      const label = node('span'), name = node('strong', roomName(room.id)), subtitle = node('small', ''); label.append(name, subtitle);
      const dot = node('span', '', 'status-dot muted'); dot.setAttribute('aria-hidden', 'true');
      button.append(node('span', room.id === 'living-room' ? 'L' : room.id.split('-').at(-1), 'room-number'), label, dot);
      button.addEventListener('click', () => chooseRoom(room.id)); $('dashboard-rooms').append(button);
      row = { button, subtitle, dot }; roomRows.set(room.id, row);
    }
    const screens = data.displays?.devices.filter(device => device.room === room.id) || [];
    const receiving = screens.some(screen => screen.receiving);
    row.subtitle.textContent = screens.length ? screens.map(screen => screen.name).join(', ') + (receiving ? ' · receiving' : ' · paired') : 'No screen paired';
    row.dot.className = `status-dot${receiving ? '' : ' muted'}`;
  }
  const count = data.displays?.devices.length;
  $('display-caption').textContent = data.displays === null ? 'Screen status unavailable' : data.displays.configurationError ? 'Screen setup needs attention' : count ? `${count} saved screen${count === 1 ? '' : 's'} · ${data.displays.enabled ? 'receiving means its browser is connected' : 'screen receiver unavailable on this network'}` : 'Pair a screen to send its room’s answers.';
  syncRoomSelection();
}
function renderProfiles() {
  const key = JSON.stringify(data?.profiles); if (key === profilesKey) return; profilesKey = key;
  if (!data?.profiles) { $('dashboard-housemates').replaceChildren(node('p', 'Profile status is unavailable.', 'card-copy')); return; }
  $('dashboard-housemates').replaceChildren(...data.profiles.map(profile => {
    const row = node('div', undefined, 'housemate'), description = node('div');
    description.append(node('strong', profile.name), node('small', profile.bedroom ? roomName(profile.bedroom) : 'Room unassigned'));
    const status = node('span', profile.voiceEnrolled ? 'Voice ready' : 'Voice not set', profile.voiceEnrolled ? 'voice-ready small-label' : 'small-label');
    row.append(node('span', profile.name[0], 'housemate-avatar'), description, status); return row;
  }));
}
function renderTimers() {
  if (!data?.timers) { $('dashboard-timers').replaceChildren(node('p', 'Timer status is unavailable.', 'card-copy')); return; }
  if (!data.timers.available) { $('dashboard-timers').replaceChildren(node('p', 'The saved timers need attention.', 'card-copy')); return; }
  const timers = data.timers.timers.filter(timer => timer.endsAt > Date.now() + serverOffset).sort((a, b) => a.endsAt - b.endsAt);
  if (!timers.length) { $('dashboard-timers').replaceChildren(node('p', 'Nothing counting down. Set a timer when you need one.', 'card-copy')); return; }
  $('dashboard-timers').replaceChildren(...timers.map(timer => {
    const row = node('div', undefined, 'timer-entry'), label = node('div'); label.append(node('strong', timer.label || 'Timer'), node('small', roomName(timer.room)));
    const remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now() - serverOffset) / 1000));
    const clock = remaining >= 3600 ? `${Math.floor(remaining / 3600)}h ${Math.floor(remaining % 3600 / 60)}m` : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    row.append(label, node('time', clock)); return row;
  }));
}
function tickClock() {
  const now = new Date(Date.now() + serverOffset);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value || '';
  $('dashboard-clock').textContent = `${get('hour')}:${get('minute')}`; $('dashboard-seconds').textContent = get('second'); $('dashboard-period').textContent = get('dayPeriod');
  $('dashboard-date').textContent = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  $('clock-zone').textContent = timeZone.split('/').at(-1).replaceAll('_', ' ').toUpperCase();
  if (data?.system) {
    const seconds = data.system.uptimeSeconds + Math.max(0, Math.floor((now.getTime() - data.system.checkedAt) / 1000));
    $('dashboard-uptime').textContent = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  }
  if (data) renderTimers();
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    data = await api('/api/dashboard'); serverOffset = data.checkedAt - Date.now();
    try { new Intl.DateTimeFormat('en-US', { timeZone: data.timeZone }).format(); timeZone = data.timeZone; } catch { /* Use the configured default if a timezone is invalid. */ }
    const ready = Boolean(data.ai?.available && data.ai?.modelInstalled);
    $('overall-status').classList.toggle('warning', !ready); $('overall-status').lastElementChild.textContent = ready ? 'Local AI ready' : 'AI needs attention';
    $('overall-status').firstElementChild.className = `status-dot${ready ? '' : ' warning'}`;
    $('ai-dot').className = `status-dot${ready ? '' : ' muted'}`; $('ai-label').textContent = ready ? `${data.ai.model} · on this computer` : 'Local AI unavailable';
    $('voice-label').textContent = data.speech.available ? 'Neural voice · local' : 'Voice unavailable';
    if (previousReady !== ready) { addActivity(ready ? 'Connected to local AI' : 'Local AI needs attention'); previousReady = ready; }
    const host = data.system;
    metric('cpu', host?.cpuPercent, Number.isFinite(host?.cpuPercent) ? 'Measured across this computer’s processors' : 'Waiting for the next processor sample');
    metric('memory', host ? percent(host.memory.usedBytes, host.memory.totalBytes) : null, host ? `${gb(host.memory.usedBytes)} of ${gb(host.memory.totalBytes)} in use` : 'Memory reading unavailable');
    metric('storage', host?.storage ? percent(host.storage.usedBytes, host.storage.totalBytes) : null, host?.storage ? `${gb(host.storage.freeBytes)} free of ${gb(host.storage.totalBytes)}` : 'Storage reading unavailable');
    const ha = data.homeAssistant; $('ha-label').textContent = !ha ? 'Unavailable' : ha.configurationError ? 'Needs attention' : !ha.configured ? 'Not connected' : ha.connected ? 'Connected' : 'Unavailable';
    $('calendar-state').textContent = data.services.calendar ? 'Connected' : 'Not connected';
    $('weather-state').textContent = data.weather?.data ? Math.round(data.weather.data.current.temperature) + data.weather.data.temperatureUnit + ' · ' + data.weather.data.location.name : data.weather?.configured ? 'Temporarily unavailable' : 'No weather feed connected';
      $('weather-state').title = data.weather?.data ? data.weather.data.current.condition + ' · Open-Meteo' : data.weather?.error || 'Choose your city on the Weather page.';
    $('phone-state').textContent = data.services.phone ? 'Connected' : 'Not connected';
    $('door-state').textContent = ha?.locksEnabled ? 'Configured' : 'Not enabled';
    renderProfiles(); renderRooms(); renderTimers(); tickClock();
    $('dashboard-updated').textContent = `Status checked ${new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(data.checkedAt))}`;
  } catch {
    $('overall-status').classList.add('warning'); $('overall-status').lastElementChild.textContent = 'Connection interrupted';
    $('overall-status').firstElementChild.className = 'status-dot warning'; $('dashboard-updated').textContent = 'Could not refresh. Showing the last readings.';
  } finally { refreshing = false; }
}
async function checkNetwork() {
  if (networkBusy) return; networkBusy = true; $('network-refresh').disabled = true;
  try {
    const info = await api('/api/network');
    $('network-value').textContent = info.connected === true ? info.adapter || 'Connected' : info.connected === false ? 'Not connected' : 'Check unavailable';
    $('network-dot').className = `status-dot${info.connected === true ? '' : ' warning'}`;
    $('network-detail').textContent = info.connected === true ? info.gatewayResponds ? `Gateway answered${Number.isFinite(info.gatewayLatencyMs) ? ` in ${info.gatewayLatencyMs} ms` : ''}.` : 'Gateway did not answer; it may block ping.' : info.detail || 'No active network connection found.';
    const rate = value => Number.isFinite(value) ? value >= 1000 ? `${(value / 1000).toFixed(1)} Mb/s` : `${value} Kb/s` : '—';
    $('network-down').textContent = rate(info.downloadKbps); $('network-up').textContent = rate(info.uploadKbps);
  } catch { $('network-value').textContent = 'Check unavailable'; $('network-detail').textContent = 'Try checking again in a moment.'; $('network-dot').className = 'status-dot warning'; }
  finally { networkBusy = false; $('network-refresh').disabled = false; }
}
function syncAssistant(ui = {}) {
  if (['view', 'calendar-demo'].includes(ui.resultKind) && ui.requestId && ui.requestId !== lastViewCommand && ['dashboard', 'minimal'].includes(ui.view)) { lastViewCommand = ui.requestId; setCentralView(ui.view); }
  const nativeTalk = $('microphone'), nativeListen = $('wake-toggle');
  $('dashboard-talk').disabled = nativeTalk.disabled; $('dashboard-talk').lastChild.nodeValue = nativeTalk.textContent;
  $('dashboard-listen').disabled = nativeListen.disabled;
  const enabled = ui.wakeEnabled ?? nativeListen.getAttribute('aria-pressed') === 'true';
  $('dashboard-listen').lastChild.nodeValue = enabled ? 'Stop listening' : 'Hey Jarvis'; $('dashboard-listen').classList.toggle('is-listening', enabled); $('dashboard-listen').setAttribute('aria-pressed', String(enabled));
  const state = ui.state || document.body.dataset.state;
  const label = { idle: enabled ? 'Standby' : 'Ready', listening: 'Listening', thinking: 'Thinking', answering: 'Answering', speaking: 'Speaking', ready: 'Ready', error: 'Needs attention' }[state] || 'Ready';
  $('reactor-status').lastChild.nodeValue = label;
  $('assistant-caption').textContent = state === 'listening' ? 'I’m listening. Speak naturally, then pause.' : ['thinking', 'answering'].includes(state) ? 'One moment. Putting that together.' : state === 'speaking' ? 'Speaking through this computer.' : state === 'error' ? 'Check the message above and try again.' : enabled ? ui.wakeState === 'listening' ? 'Say “Hey Jarvis,” wait for the chime, then ask.' : 'Preparing the microphone for “Hey Jarvis.”' : 'Choose a room. I’m ready when you are.';
  if (ui.state === 'ready' && ui.requestId && !seenAnswers.has(ui.requestId)) { seenAnswers.add(ui.requestId); if (seenAnswers.size > 50) seenAnswers = new Set([ui.requestId]); addActivity(`Answer ready in ${roomName(ui.room)}`); }
  if (previousWake !== undefined && previousWake !== enabled) addActivity(enabled ? `Hey Jarvis enabled in ${roomName(selectedRoom())}` : 'Hey Jarvis listening stopped'); previousWake = enabled;
  syncRoomSelection();
}
$('dashboard-room').addEventListener('change', () => chooseRoom($('dashboard-room').value));
$('quiet-view').addEventListener('click', event => { event.preventDefault(); setCentralView('minimal'); });
$('control-view').addEventListener('click', event => { event.preventDefault(); setCentralView('dashboard'); });
$('room').addEventListener('change', syncRoomSelection);
$('dashboard-talk').addEventListener('click', () => { $('ask-button').click(); $('microphone').click(); });
$('dashboard-listen').addEventListener('click', () => $('wake-toggle').click());
$('network-refresh').addEventListener('click', checkNetwork);
$('timer-draft').addEventListener('click', () => { $('ask-button').click(); $('question').value = 'Set a timer for five minutes called pasta'; $('question').dispatchEvent(new Event('input')); $('question').focus(); });
document.addEventListener('jarvis:ui', event => syncAssistant(event.detail));
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
const polling = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
const networkPolling = setInterval(() => { if (!document.hidden) void checkNetwork(); }, 60000);
const clock = setInterval(tickClock, 1000);
window.addEventListener('pagehide', () => { clearInterval(polling); clearInterval(networkPolling); clearInterval(clock); });
syncAssistant(); tickClock(); void refresh(); void checkNetwork();
