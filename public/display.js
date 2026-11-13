import { renderWeather } from './weather-view.js';
import { renderSearchSources } from './search-sources.js';
let renderAgenda = preview => {
  const card = document.getElementById('calendar-preview');
  if (card) { card.hidden = !preview; if (preview) document.getElementById('calendar-foot').textContent = 'Restart Jarvis to load the updated calendar layout.'; }
};
import('./agenda.js').then(module => { renderAgenda = module.renderAgenda; render(lastSnapshot); }).catch(() => {});
import { JarvisOrb } from './orb.js';
import { RoomDashboard } from './tv-dashboard.js';
const $ = id => document.getElementById(id);
const orb = new JarvisOrb($('orb'));
const dashboard = new RoomDashboard({ hud: $('hud'), onUnauthorized: () => showPairing('Pair this display again from House setup.') });
let presenceTimer;
let events, reconnectTimer, closed = false, sessionCheck, visualExpiry;
let lastSnapshot = { state: 'idle' }, voiceVisual = null;
orb.setLevelSource(() => voiceVisual?.level || 0);
function showPairing(message = '') {
  clearInterval(presenceTimer);
  dashboard.setView(false);
  clearTimeout(visualExpiry); voiceVisual = null;
  events?.close(); clearTimeout(reconnectTimer); clearTimeout(sessionCheck);
  $('pairing').hidden = false; $('visual').hidden = true; $('response').hidden = true; $('timer-alert').hidden = true; $('connection').hidden = true;
  $('pair-error').textContent = message; $('pair-error').hidden = !message;
}
function render(snapshot) {
  lastSnapshot = snapshot;
  dashboard.setView(snapshot.view === 'dashboard');
  const state = voiceVisual?.state || snapshot.state;
  document.body.dataset.state = state;
  orb.setState(state);
  $('visual').hidden = !dashboard.active && state === 'idle' && !snapshot.calendarPreview && !snapshot.weatherPreview;
  const answer = voiceVisual?.state === 'listening' ? '' : snapshot.state === 'error' ? snapshot.error : snapshot.answer;
  document.body.classList.toggle('has-answer', Boolean(answer));
  document.body.classList.toggle('has-calendar', Boolean(snapshot.calendarPreview));
  $('response').hidden = !answer || Boolean(snapshot.calendarPreview || snapshot.weatherPreview);
  $('answer').textContent = answer || '';
  $('answer').classList.toggle('long', (answer || '').length > 160);
  document.body.classList.toggle('has-search', Boolean(snapshot.webSearch?.results?.length));
  document.body.classList.toggle('has-weather', Boolean(snapshot.weatherPreview));
  renderWeather($('weather-preview'), snapshot.weatherPreview, snapshot.weatherPreview?.range || 'current');
  renderSearchSources(snapshot.webSearch);
  renderAgenda(snapshot.calendarPreview);
  $('timer-alert').hidden = !snapshot.notification;
  $('timer-message').textContent = snapshot.notification?.message || '';
  dashboard.updateState(state);
}
async function reportPresence() {
  if (closed || !$('pairing').hidden) return;
  try { await fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible: document.visibilityState === 'visible' }), signal: AbortSignal.timeout(2000) }); } catch { /* Next heartbeat retries. */ }
}
document.addEventListener('visibilitychange', () => void reportPresence());
function connect() {
  if (closed) return;
  $('pairing').hidden = true;
  clearInterval(presenceTimer); void reportPresence(); presenceTimer = setInterval(() => void reportPresence(), 5000);
  events?.close();
  events = new EventSource('/api/events');
  events.onopen = () => { clearTimeout(reconnectTimer); $('connection').hidden = true; };
  events.onmessage = event => { try { render(JSON.parse(event.data)); } catch { $('connection').hidden = false; } };
  events.addEventListener('visual', event => {
    try {
      const visual = JSON.parse(event.data);
      if (![null, 'listening', 'speaking'].includes(visual.state) || !Number.isFinite(visual.level)) return;
      voiceVisual = visual.state ? { state: visual.state, level: Math.max(0, Math.min(1, visual.level)) } : null;
      clearTimeout(visualExpiry);
      if (voiceVisual) visualExpiry = setTimeout(() => { voiceVisual = null; render(lastSnapshot); }, 1500);
      render(lastSnapshot);
    } catch { /* Ignore an incomplete animation update. */ }
  });
  events.addEventListener('revoked', () => showPairing('This display was unpaired. Create a new code to reconnect.'));
  events.onerror = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { $('connection').hidden = false; }, 1500);
    clearTimeout(sessionCheck); sessionCheck = setTimeout(() => { void checkSession(false); }, 3000);
  };
}
async function checkSession(start = true) {
  try {
    const response = await fetch('/api/display-session');
    if (response.status === 401) return showPairing();
    if (!response.ok) throw new Error('Receiver unavailable');
    if (start) connect();
  } catch { if (closed) return; $('connection').hidden = false; sessionCheck = setTimeout(() => { void checkSession(start); }, 5000); }
}
$('pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    const response = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('pair-code').value, name: $('display-name').value.trim() }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Pairing failed.');
    $('pair-code').value = ''; connect();
  } catch (error) { $('pair-error').textContent = error.message; $('pair-error').hidden = false; }
  finally { button.disabled = false; }
});
void checkSession();
window.addEventListener('pagehide', () => { if ($('pairing').hidden) void fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible: false }), keepalive: true }).catch(() => {}); closed = true; clearInterval(presenceTimer); dashboard.destroy(); events?.close(); clearTimeout(reconnectTimer); clearTimeout(sessionCheck); clearTimeout(visualExpiry); orb.destroy(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
