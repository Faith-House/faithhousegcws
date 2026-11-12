import { renderWeather } from './weather-view.js';
import { renderSearchSources } from './search-sources.js';
// Keep the assistant usable if an older running server has not loaded new routes.
let renderAgenda = preview => {
  const card = document.getElementById('calendar-preview');
  if (card) { card.hidden = !preview; if (preview) document.getElementById('calendar-foot').textContent = 'Restart Jarvis to load the updated calendar layout.'; }
};
import('./agenda.js').then(module => { renderAgenda = module.renderAgenda; updateVisuals(); }).catch(() => {});
import { JarvisOrb } from './orb.js';
import { LocalSpeech } from './speech.js';
import { LocalMicrophone } from './microphone.js';
import { WakeWordListener } from './wakeword.js';
import { isStopReply, stripWakePhrase, wakeShouldPause } from './interruptions.js';

const $ = id => document.getElementById(id);
const orb = new JarvisOrb($('orb'));
const params = new URLSearchParams(location.search);
const displayOnly = location.pathname === '/display';
const roomSelect = $('room');
const validRooms = Array.from(roomSelect.options, option => option.value);
let room = validRooms.includes(params.get('room')) ? params.get('room') : 'bedroom-1';
let events;
let interactionTimer;
let busy = false;
let reconnectTimer;
let connectedOnce = false;
let submitting = false;
let lastSnapshot = { state: 'idle', requestId: null, answer: '', error: '' };
let ownedRequestId = null;
let spokenRequestId = null;
let voicesAvailable = false;
let microphoneAvailable = false;
let enumeratingMicrophones = false;
let microphoneLabelsLoaded = false;
let lastNotificationId = null;
let wakeAvailable = false;
let wakeTurn = false;
let wakeCaptureStarted = false;
let resumeWanted = false;
let wakeResumeTimer;
let wakeSyncQueued = false;
let roommateProfiles = [];
let selectedProfileId = '';
let globalSpeechMuted;
let speakerNotice = '';
let pendingSpeakerToken = null;
let profileRefresh;
let profilesInitialized = false;
let lastUIEvent = '';
let wakeInterrupted = false, interrupting = false, interruptError = '', interruptPromise = Promise.resolve(), pendingAsk = null, questionEpoch = 0;
const readSetting = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const saveSetting = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Preferences still work for this page. */ } };
let voiceEnabled = readSetting('jarvis.spokenReplies', 'on') !== 'off';
globalSpeechMuted = !voiceEnabled;
let voice = readSetting('jarvis.voice', '');
let interruptionsEnabled = readSetting('jarvis.interruptions', 'on') !== 'off';
const speech = new LocalSpeech($('speech-audio'), () => updateVisuals());
const microphone = new LocalMicrophone(() => {
  if (wakeTurn && microphone.state === 'recording' && !wakeCaptureStarted) {
    wakeCaptureStarted = true;
    $('wake-audio').currentTime = 0;
    void $('wake-audio').play().catch(() => {});
  }
  if (wakeTurn && wakeCaptureStarted && microphone.state === 'idle') { wakeTurn = false; resumeWanted = true; }
  updateVisuals();
  if (microphone.state === 'recording' && !microphoneLabelsLoaded) void loadMicrophones();
}, (text, result = {}) => {
  const automatic = wakeTurn && wake.enabled;
  const interrupted = wakeInterrupted; wakeInterrupted = false;
  wakeTurn = false;
  if (result.speaker) {
    applyProfile(result.speaker.status === 'matched' ? result.speaker.profileId : '', false);
    speakerNotice = result.speaker.status === 'matched' ? `Using ${result.speaker.name}’s profile` : 'Speaker unknown · using the shared profile';
  } else speakerNotice = '';
  const question = automatic ? stripWakePhrase(text) : text;
  if (automatic && isStopReply(question) && (interrupted || /^(?:stop|be quiet|quiet please)\b/i.test(question))) {
    pendingSpeakerToken = null; speech.stop(); $('question').value = ''; closeComposer(); resumeWanted = true; updateVisuals(); return;
  }
  $('question').value = question; $('question').dispatchEvent(new Event('input'));
  pendingSpeakerToken = result.speakerToken || null;
  if (automatic && question) void submitQuestion(question);
  else { $('question').focus(); updateVisuals(); }
});
const wake = new WakeWordListener(() => {
  updateVisuals();
  if (wake.state === 'error') { formError(wake.message); openComposer(); }
}, async capture => {
  if (!wake.enabled) return;
  if (!$('composer').hidden && $('question').value.trim()) { resumeWanted = true; wake.pause('Text draft open'); return; }
  resumeWanted = true; wakeTurn = true; wakeCaptureStarted = false;
  speech.stop(); formError(''); $('question').value = ''; openComposer();
  await interruptPromise;
  if (interruptError) { formError(interruptError); wakeTurn = false; resumeWanted = true; updateVisuals(); return; }
  void refreshProfiles();
  if (!wake.enabled) { wakeTurn = false; return; }
  await microphone.start(room, $('microphone-device').value, { noSpeechTimeoutMs: 8000, identifySpeaker: !$('identify-speaker').disabled && $('identify-speaker').checked, capture });
  if (microphone.state === 'idle') { wakeTurn = false; updateVisuals(); }
}, { handoff: true, isPlaybackActive: () => speech.state === 'playing', onDetected: () => {
  wakeInterrupted = busy || submitting || ['preparing', 'playing'].includes(speech.state);
  wakeTurn = true; resumeWanted = true; questionEpoch++;
  const requestId = lastSnapshot.requestId, targetRoom = room, accepting = pendingAsk;
  ownedRequestId = null; spokenRequestId = requestId; pendingSpeakerToken = null;
  speech.stop(); interruptError = '';
  if (!requestId && !accepting) { interruptPromise = Promise.resolve(); return; }
  interrupting = true;
  interruptPromise = (async () => {
    const acceptedId = accepting ? (await accepting).requestId : requestId;
    if (acceptedId) await post('/api/cancel', { room: targetRoom, requestId: acceptedId, interruption: true, profileId: selectedProfileId || null });
  })().catch(error => { interruptError = 'I stopped the voice, but could not stop the old request. ' + error.message; }).finally(() => { interrupting = false; updateVisuals(); });
} });
$('voice-enabled').checked = voiceEnabled;
$('allow-interruptions').checked = interruptionsEnabled;
roomSelect.value = room;

const visualLevel = () => microphone.state === 'recording' ? microphone.level : speech.getLevel();
orb.setLevelSource(visualLevel);
const primeSpeechAnalysis = () => { if (voiceEnabled && !displayOnly) void speech.enableAnalysis(); };
document.addEventListener('pointerdown', primeSpeechAnalysis, { passive: true });
document.addEventListener('click', primeSpeechAnalysis, { passive: true });
document.addEventListener('keydown', primeSpeechAnalysis, { passive: true });
let visualRelayBusy = false, relayedVisualRoom = null;
async function relayVisual() {
  if (displayOnly || visualRelayBusy) return;
  const mode = microphone.state === 'recording' ? 'listening' : speech.state === 'playing' ? 'speaking' : null;
  if (!mode && !relayedVisualRoom) return;
  const targetRoom = relayedVisualRoom && relayedVisualRoom !== room ? relayedVisualRoom : room;
  const state = targetRoom === room ? mode : null;
  visualRelayBusy = true;
  try {
    const response = await fetch('/api/visual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: targetRoom, state, level: state ? visualLevel() : 0 }), signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error('Display animation unavailable');
    relayedVisualRoom = state ? room : null;
  } catch { /* Display animation never blocks a question or audio playback. */ }
  finally { visualRelayBusy = false; }
}
const visualRelayTimer = displayOnly ? null : setInterval(() => { void relayVisual(); }, 100);
document.body.classList.toggle('display-only', displayOnly);

function hideHint() { $('hint').classList.add('quiet'); }
setTimeout(hideHint, 9000);

function openComposer() {
  if (displayOnly) return;
  hideHint();
  $('composer').hidden = false;
  $('ask-button').setAttribute('aria-expanded', 'true');
  $('question').focus();
  void refreshProfiles();
  if (voicesAvailable && voiceEnabled) speech.warm({ voice });
}
function closeComposer() {
  microphone.cancel();
  $('composer').hidden = true;
  $('ask-button').setAttribute('aria-expanded', 'false');
}
function formError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = !message;
}
async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}

function updateVisuals() {
  const snapshot = lastSnapshot;
  const speaking = speech.state === 'playing';
  const speechActive = ['playing', 'preparing'].includes(speech.state);
  const micActive = ['requesting', 'recording', 'transcribing'].includes(microphone.state);
  const visualState = micActive ? (microphone.state === 'transcribing' ? 'thinking' : 'listening') : speaking ? 'speaking' : snapshot.state;
  document.body.dataset.state = visualState;
  orb.setState(visualState);
  busy = ['thinking', 'answering'].includes(snapshot.state);
  $('send').disabled = busy || submitting || micActive;
  $('microphone').disabled = !microphoneAvailable || busy || submitting || ['requesting', 'transcribing'].includes(microphone.state);
  $('microphone').textContent = microphone.state === 'recording' ? 'Finish recording' : microphone.state === 'transcribing' ? 'Recognizing…' : 'Talk to Jarvis';
  $('microphone').setAttribute('aria-pressed', String(microphone.state === 'recording'));
  $('microphone-device').disabled = micActive || wake.enabled;
  $('wake-toggle').disabled = !wakeAvailable || micActive || submitting;
  $('wake-toggle').textContent = wake.enabled ? 'Turn off “Hey Jarvis”' : 'Enable “Hey Jarvis”';
  $('wake-toggle').setAttribute('aria-pressed', String(wake.enabled));
  $('listening-indicator').hidden = !wake.enabled || displayOnly;
  $('listening-indicator').classList.toggle('waiting', wake.state !== 'listening');
  $('listening-label').textContent = wakeTurn ? microphone.state === 'recording' ? 'Listening to your question' : interrupting ? 'Stopping the previous reply' : microphone.message : speechActive || busy ? interruptionsEnabled && wake.state === 'listening' ? 'Say “Hey Jarvis” to interrupt' : 'Replying · wake word paused' : wake.message;
  $('cancel-microphone').hidden = !micActive;
  $('microphone-notice').textContent = microphone.message;
  $('microphone-notice').hidden = !microphone.message;
  $('microphone-progress').hidden = microphone.state !== 'recording';
  $('microphone-level').value = microphone.level;
  $('microphone-time').textContent = `${Math.floor(microphone.elapsed || 0)} / 20s`;
  $('test-voice').disabled = !voicesAvailable || micActive;
  $('question').readOnly = micActive;
  $('profile').disabled = micActive || submitting;
  const text = snapshot.state === 'error' ? snapshot.error : snapshot.answer;
  const calendarData = snapshot.calendarPreview;
  document.body.classList.toggle('has-answer', Boolean(text));
  document.body.classList.toggle('has-calendar', Boolean(calendarData));
  const voiceMessage = speech.message || (speech.state === 'preparing' ? 'Preparing spoken reply…' : '');
  $('response').hidden = Boolean(calendarData || snapshot.weatherPreview) || !(text || voiceMessage);
  $('answer').textContent = text || '';
  $('answer').classList.toggle('long', (text || '').length > 160);
  if ($('weather-link')) $('weather-link').hidden = snapshot.resultKind !== 'weather';
  if ($('chores-link')) $('chores-link').hidden = snapshot.resultKind !== 'chores';
  if ($('activity-link')) { $('activity-link').hidden = snapshot.resultKind !== 'activity'; $('activity-link').href = '/activity?room=' + encodeURIComponent(room); }
  $('answer-note').hidden = !snapshot.truncated;
  $('answer-note').textContent = snapshot.truncated ? 'Ask a follow-up for more detail.' : '';
  $('voice-notice').textContent = voiceMessage;
  $('voice-notice').hidden = !voiceMessage;
  $('speaker-notice').textContent = speakerNotice;
  $('speaker-notice').hidden = !speakerNotice || snapshot.state === 'idle';
  document.body.classList.toggle('has-search', Boolean(snapshot.webSearch?.results?.length));
  document.body.classList.toggle('has-weather', Boolean(snapshot.weatherPreview));
  renderWeather($('weather-preview'), snapshot.weatherPreview, snapshot.weatherPreview?.range || 'current');
  renderSearchSources(snapshot.webSearch);
  renderAgenda(calendarData);
  $('status').textContent = micActive ? microphone.message : speaking ? 'Jarvis is speaking.' : speech.state === 'preparing' ? 'Preparing spoken reply.' : { idle: 'Jarvis is ready.', thinking: snapshot.resultKind === 'web-search' ? 'Searching the web.' : 'Jarvis is thinking.', answering: 'Jarvis is answering.', ready: 'Answer complete.', error: 'Jarvis needs attention.' }[snapshot.state] || '';
  $('stop-speech').hidden = !speechActive;
  $('mute-speech').hidden = !speechActive;
  $('hear-reply').hidden = !(!speechActive && voicesAvailable && ((speech.state === 'blocked' && speech.objectUrl) || (snapshot.state === 'ready' && snapshot.answer && voiceEnabled)));
  $('playback-controls').hidden = displayOnly || (!speechActive && $('hear-reply').hidden);
  if (snapshot.state !== 'idle') hideHint();
  if (!wakeSyncQueued) { wakeSyncQueued = true; queueMicrotask(() => { wakeSyncQueued = false; syncWake(); }); }
  const ui = { room, state: visualState, view: snapshot.view, resultKind: snapshot.resultKind, requestId: snapshot.requestId, microphoneState: microphone.state, microphoneReady: microphoneAvailable, wakeReady: wakeAvailable, wakeEnabled: wake.enabled, wakeState: wake.state, spokenReplies: voiceEnabled, voiceReady: voicesAvailable };
  const signature = JSON.stringify(ui);
  if (signature !== lastUIEvent) { lastUIEvent = signature; document.dispatchEvent(new CustomEvent('jarvis:ui', { detail: ui })); }
}

function stopHandsFree() {
  clearTimeout(wakeResumeTimer); wakeResumeTimer = null;
  resumeWanted = false; wakeTurn = false;
  wake.disable();
}
function syncWake() {
  if (!wake.enabled) return;
  const draftOpen = !$('composer').hidden && Boolean($('question').value.trim()) && !wakeTurn;
  const occupied = wakeShouldPause({ micState: microphone.state, submitting, draftOpen, busy, speechState: speech.state, interruptions: interruptionsEnabled });
  if (occupied) {
    clearTimeout(wakeResumeTimer); wakeResumeTimer = null;
    if (['starting', 'listening'].includes(wake.state)) { resumeWanted = true; wake.pause(draftOpen ? 'Text draft open' : 'Waiting for the current question'); }
    return;
  }
  const voiceExpected = lastSnapshot.state === 'ready' && voiceEnabled && voicesAvailable && lastSnapshot.requestId === ownedRequestId && lastSnapshot.requestId !== spokenRequestId;
  if (!resumeWanted || wakeTurn || (voiceExpected && !interruptionsEnabled) || wakeResumeTimer || ['starting', 'listening'].includes(wake.state)) return;
  wakeResumeTimer = setTimeout(() => {
    wakeResumeTimer = null;
    if (!wake.enabled || wakeTurn || wakeShouldPause({ micState: microphone.state, submitting, draftOpen: !$('composer').hidden && Boolean($('question').value.trim()), busy, speechState: speech.state, interruptions: interruptionsEnabled })) return;
    resumeWanted = false; void wake.resume();
  }, 900);
}

function speakCurrent(force = false) {
  const snapshot = lastSnapshot;
  const early = voice.startsWith('pocket_') && snapshot.state === 'answering' && snapshot.answer?.length >= 25 && /[.!?]\s/.test(snapshot.answer);
  if (displayOnly || microphone.state !== 'idle' || !voiceEnabled || !voicesAvailable || !(snapshot.state === 'ready' || early) || !snapshot.answer) return;
  if (!force && (snapshot.requestId !== ownedRequestId || snapshot.requestId === spokenRequestId)) return;
  spokenRequestId = snapshot.requestId;
  void speech.speak({ room, requestId: snapshot.requestId, voice });
}

function render(snapshot) {
  const changed = lastSnapshot.requestId !== snapshot.requestId;
  lastSnapshot = snapshot;
  const notification = snapshot.notification;
  $('timer-alert').hidden = !notification;
  $('timer-message').textContent = notification?.message || '';
  if (notification && notification.id !== lastNotificationId && !displayOnly) {
    lastNotificationId = notification.id;
    if (readSetting(`jarvis.timerAlert.${room}`, '') !== notification.id) {
      saveSetting(`jarvis.timerAlert.${room}`, notification.id);
      $('timer-sound').hidden = true;
      $('timer-audio').currentTime = 0;
      void $('timer-audio').play().catch(() => { if (lastSnapshot.notification?.id === notification.id) $('timer-sound').hidden = false; });
    }
  }
  if (changed || ['idle', 'thinking', 'error'].includes(snapshot.state)) {
    if (speech.state !== 'idle' || speech.objectUrl) speech.stop();
  }
  updateVisuals();
  speakCurrent();
}

async function loadVoices() {
  try {
    const response = await fetch('/api/voices');
    if (!response.ok) throw new Error('The local voice engine is unavailable.');
    const info = await response.json();
    voicesAvailable = info.available && Array.isArray(info.voices) && info.voices.length > 0;
    if (!voicesAvailable) throw new Error('No local voice is installed on this computer.');
    const previousDefault = readSetting('jarvis.voice.defaultSeen', '');
    if (previousDefault !== info.defaultVoice && (!voice || voice === 'bm_george')) {
      voice = info.defaultVoice;
      saveSetting('jarvis.voice', voice);
    }
    saveSetting('jarvis.voice.defaultSeen', info.defaultVoice);
    if (!info.voices.some(item => item.name === voice)) voice = info.defaultVoice;
    $('voice').replaceChildren(...info.voices.map(item => {
      const option = document.createElement('option');
      option.value = item.name;
      option.textContent = item.label || item.name.replace(/^Microsoft /, '');
      return option;
    }));
    $('voice').value = voice;
    $('voice').disabled = false;
    $('test-voice').disabled = false;
    $('voice-enabled').disabled = false;
    const updatePending = info.engine === 'kokoro-local' || (info.engine === 'local-neural' && !info.voices.some(item => item.name === 'pocket_peter'));
    $('voice-availability').hidden = !updatePending;
    $('voice-availability').textContent = updatePending ? 'Peter needs the updated server. Restart Jarvis, then use Refresh voices.' : '';
    if (selectedProfileId) applyProfile(selectedProfileId, false);
    if (voiceEnabled && !updatePending) speech.warm({ voice });
    updateVisuals();
    speakCurrent();
  } catch (error) {
    voicesAvailable = false;
    voiceEnabled = false;
    $('voice-enabled').checked = false;
    $('voice-enabled').disabled = true;
    $('voice').replaceChildren(new Option('Voice unavailable', ''));
    $('voice-availability').textContent = `${error.message} Text answers still work.`;
    $('voice-availability').hidden = false;
    updateVisuals();
  }
}

function connect() {
  events?.close();
  connectedOnce = false;
  clearTimeout(reconnectTimer);
  events = new EventSource(`/api/events?room=${encodeURIComponent(room)}`);
  reconnectTimer = setTimeout(() => { if (!connectedOnce) $('connection').hidden = false; }, 2000);
  events.onopen = () => { connectedOnce = true; clearTimeout(reconnectTimer); $('connection').hidden = true; };
  events.onmessage = event => {
    try { render(JSON.parse(event.data)); }
    catch (error) { console.error('Jarvis display update failed:', error.message); $('connection').textContent = 'Reconnecting to Jarvis…'; $('connection').hidden = false; }
  };
  events.onerror = () => { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => { $('connection').hidden = false; }, 1200); };
}
connect();
void loadVoices();
function applyProfile(id, persist = true) {
  const profile = roommateProfiles.find(item => item.id === id);
  selectedProfileId = profile?.id || '';
  $('profile').value = selectedProfileId;
  if (persist) saveSetting('jarvis.profile', selectedProfileId);
  voice = profile?.voice || readSetting('jarvis.voice', 'bm_george');
  voiceEnabled = !globalSpeechMuted && (profile?.spokenReplies ?? true);
  $('voice-enabled').checked = voiceEnabled;
  if (Array.from($('voice').options).some(option => option.value === voice)) $('voice').value = voice;
  updateVisuals();
}
async function refreshProfiles() {
  if (displayOnly) return;
  if (profileRefresh) return profileRefresh;
  profileRefresh = (async () => {
    try {
    const response = await fetch('/api/profiles', { cache: 'no-store' });
    if (!response.ok) throw new Error('Profile setup unavailable');
    const info = await response.json(); roommateProfiles = info.profiles;
    $('profile').replaceChildren(new Option('Shared profile', ''), ...roommateProfiles.map(profile => new Option(profile.name, profile.id)));
    const enabled = info.speakerModel.available && roommateProfiles.some(profile => profile.voiceEnrolled);
    $('identify-speaker').disabled = !enabled;
    $('identify-speaker').checked = readSetting('jarvis.identifySpeaker', 'on') !== 'off';
    $('speaker-availability').textContent = enabled ? 'Local voice matching' : 'Set up voices in Profiles';
    if (!profilesInitialized) {
      profilesInitialized = true;
      applyProfile(params.has('profile') ? params.get('profile') : readSetting('jarvis.profile', ''));
    } else $('profile').value = selectedProfileId;
    updateVisuals();
  } catch { $('speaker-availability').textContent = 'Profile setup unavailable'; }
  })().finally(() => { profileRefresh = null; });
  return profileRefresh;
}
if (!displayOnly) void refreshProfiles();
window.addEventListener('focus', () => { void refreshProfiles(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshProfiles(); });
window.addEventListener('storage', event => { if (event.key === 'jarvis.profilesUpdated') void refreshProfiles(); });
$('identify-speaker').addEventListener('change', () => saveSetting('jarvis.identifySpeaker', $('identify-speaker').checked ? 'on' : 'off'));
$('profile').addEventListener('change', () => {
  stopHandsFree(); microphone.cancel(); speech.stop(); ownedRequestId = null; speakerNotice = '';
  pendingSpeakerToken = null;
  applyProfile($('profile').value);
});
if (!displayOnly) void (async () => {
  try {
    const response = await fetch('/api/microphone');
    const info = await response.json();
    microphoneAvailable = Boolean(response.ok && info.available && navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode && window.isSecureContext);
    if (!microphoneAvailable) { microphone.message = info.available ? 'Open localhost in a browser with microphone support to talk.' : 'Run SETUP-MICROPHONE.cmd to install local recognition.'; }
    updateVisuals();
    await loadMicrophones();
  } catch { microphone.message = 'Microphone setup is unavailable. Text questions still work.'; updateVisuals(); }
})();
if (!displayOnly) void (async () => {
  try {
    const response = await fetch('/api/listen/status');
    const info = await response.json();
    wakeAvailable = Boolean(response.ok && info.available && navigator.mediaDevices?.getUserMedia && window.isSecureContext);
    if (!info.available) $('wake-help').textContent = 'Run SETUP-LISTENING.cmd once to install local wake-word detection.';
    updateVisuals();
  } catch { $('wake-help').textContent = 'The local wake-word service is unavailable. Talk to Jarvis still works.'; }
})();

async function loadMicrophones() {
  if (enumeratingMicrophones || !navigator.mediaDevices?.enumerateDevices) return;
  enumeratingMicrophones = true;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications');
    const previous = $('microphone-device').value;
    $('microphone-device').replaceChildren(new Option('Default microphone', ''), ...devices.map((device, i) => new Option(device.label || `Microphone ${i + 1}`, device.deviceId)));
    if (devices.some(device => device.deviceId === previous)) $('microphone-device').value = previous;
    microphoneLabelsLoaded = devices.some(device => device.label);
  } catch { /* The default microphone still works without device enumeration. */ }
  finally { enumeratingMicrophones = false; }
}
navigator.mediaDevices?.addEventListener('devicechange', () => { microphoneLabelsLoaded = false; void loadMicrophones(); });
$('microphone').addEventListener('click', async () => {
  stopHandsFree();
  speech.stop(); formError('');
  if (microphone.state === 'recording') void microphone.finish();
  else {
    pendingSpeakerToken = null;
    await refreshProfiles();
    void microphone.start(room, $('microphone-device').value, { identifySpeaker: !$('identify-speaker').disabled && $('identify-speaker').checked });
  }
});
$('cancel-microphone').addEventListener('click', () => { microphone.cancel(); wakeTurn = false; updateVisuals(); });
$('wake-toggle').addEventListener('click', () => {
  if (wake.enabled) { stopHandsFree(); return; }
  microphone.cancel(); speech.stop(); formError(''); hideHint();
  resumeWanted = false;
  void wake.enable(room, $('microphone-device').value);
  $('wake-audio').currentTime = 0;
  void $('wake-audio').play().catch(() => {});
  closeComposer();
});
$('stop-listening').addEventListener('click', () => { stopHandsFree(); microphone.cancel(); });
$('dismiss-timer').addEventListener('click', () => {
  $('timer-audio').pause();
  void post('/api/dismiss-alert', { room, id: lastSnapshot.notification?.id }).catch(error => { formError(error.message); openComposer(); });
});
$('timer-sound').addEventListener('click', () => { $('timer-audio').currentTime = 0; void $('timer-audio').play().then(() => { $('timer-sound').hidden = true; }).catch(() => {}); });

$('ask-button').addEventListener('click', openComposer);
$('visual').addEventListener('click', openComposer);
$('close-composer').addEventListener('click', closeComposer);
$('question').addEventListener('input', () => { pendingSpeakerToken = null; $('question').style.height = 'auto'; $('question').style.height = Math.min($('question').scrollHeight, 90) + 'px'; updateVisuals(); });
$('question').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('question-form').requestSubmit();
  }
});
async function submitQuestion(question) {
  if (interrupting) await interruptPromise;
  if (!question || busy || submitting || microphone.state !== 'idle') { formError('Wait for the current question, then send again.'); updateVisuals(); return; }
  microphone.cancel();
  speech.stop();
  if (voiceEnabled) speech.warm({ voice });
  formError('');
  submitting = true;
  const epoch = questionEpoch;
  $('send').disabled = true;
  try {
    const accepting = post('/api/ask', { room, question, viewContext: document.body.dataset.view, profileId: selectedProfileId || null, speakerToken: pendingSpeakerToken });
    pendingAsk = accepting;
    const accepted = await accepting;
    if (epoch !== questionEpoch) return;
    pendingSpeakerToken = null;
    ownedRequestId = accepted.requestId;
    spokenRequestId = null;
    $('question').value = '';
    $('question').style.height = 'auto';
    closeComposer();
    speakCurrent();
  } catch (error) { formError(error.message); openComposer(); }
  finally { pendingAsk = null; submitting = false; updateVisuals(); }
}
$('question-form').addEventListener('submit', async event => {
  event.preventDefault();
  await submitQuestion($('question').value.trim());
});
$('reset').addEventListener('click', async () => {
  microphone.cancel();
  speech.stop();
  ownedRequestId = null;
  try { await post('/api/reset', { room, profileId: selectedProfileId || null }); formError(''); $('question').value = ''; $('question').focus(); }
  catch (error) { formError(error.message); }
});
if ($('calendar-close')) $('calendar-close').addEventListener('click', () => void submitQuestion('Close calendar preview'));
async function showCalendarDemo(range) {
  speech.stop(); ownedRequestId = null;
  try { render(await post('/api/calendar/demo', { room, range })); }
  catch (error) { formError(error.message); openComposer(); }
}
for (const button of document.querySelectorAll('[data-calendar-demo]')) button.addEventListener('click', () => void showCalendarDemo(button.dataset.calendarDemo));
if (['day', 'week'].includes(params.get('calendarDemo'))) {
  void showCalendarDemo(params.get('calendarDemo'));
  const url = new URL(location.href); url.searchParams.delete('calendarDemo'); history.replaceState(null, '', url);
}
roomSelect.addEventListener('change', () => {
  pendingSpeakerToken = null;
  stopHandsFree();
  microphone.cancel();
  speech.stop();
  ownedRequestId = null;
  spokenRequestId = null;
  room = roomSelect.value;
  const url = new URL(location.href);
  url.searchParams.set('room', room);
  history.replaceState(null, '', url);
  render({ state: 'idle', answer: '', error: '' });
  formError('');
  connect();
});
document.addEventListener('keydown', async event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    stopHandsFree();
    speech.stop();
    microphone.cancel();
    if (!$('composer').hidden) closeComposer();
    else {
      try { await post('/api/cancel', { room }); }
      catch { formError('Unable to clear the answer. Check that Jarvis is running.'); openComposer(); }
    }
  } else if (event.key === 'Enter' && $('composer').hidden && !['BUTTON', 'A', 'SELECT'].includes(document.activeElement?.tagName)) {
    event.preventDefault(); openComposer();
  }
});
document.addEventListener('pointermove', () => {
  document.body.classList.add('interacting');
  clearTimeout(interactionTimer);
  interactionTimer = setTimeout(() => document.body.classList.remove('interacting'), 2400);
}, { passive: true });
$('voice-enabled').addEventListener('change', () => {
  voiceEnabled = $('voice-enabled').checked;
  globalSpeechMuted = !voiceEnabled;
  saveSetting('jarvis.spokenReplies', voiceEnabled ? 'on' : 'off');
  if (!voiceEnabled) speech.stop();
  updateVisuals();
});
$('allow-interruptions').addEventListener('change', () => {
  interruptionsEnabled = $('allow-interruptions').checked;
  saveSetting('jarvis.interruptions', interruptionsEnabled ? 'on' : 'off');
  resumeWanted = wake.enabled; updateVisuals();
});
$('voice').addEventListener('change', () => {
  speech.stop();
  voice = $('voice').value;
  saveSetting('jarvis.voice', voice);
  if (voiceEnabled) speech.warm({ voice });
});
if ($('refresh-voices')) $('refresh-voices').addEventListener('click', () => void loadVoices());
$('test-voice').addEventListener('click', () => { void speech.speak({ room, voice, test: true }); });
$('hear-reply').addEventListener('click', () => {
  if (speech.objectUrl) { speech.audio.currentTime = 0; void speech.playPrepared(); }
  else speakCurrent(true);
});
$('stop-speech').addEventListener('click', () => speech.stop());
$('mute-speech').addEventListener('click', () => {
  voiceEnabled = false;
  globalSpeechMuted = true;
  $('voice-enabled').checked = false;
  saveSetting('jarvis.spokenReplies', 'off');
  speech.stop();
});
window.addEventListener('pagehide', () => {
  clearInterval(visualRelayTimer);
  if (relayedVisualRoom) navigator.sendBeacon('/api/visual', new Blob([JSON.stringify({ room: relayedVisualRoom, state: null, level: 0 })], { type: 'application/json' }));
  stopHandsFree(); $('wake-audio').pause(); $('timer-audio').pause(); microphone.cancel(); speech.destroy(); events?.close(); orb.destroy(); clearTimeout(reconnectTimer);
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
