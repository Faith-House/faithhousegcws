import { LocalMicrophone } from './microphone.js';
const $ = id => document.getElementById(id);
let profiles = [], voices = [], prompts = [], modelReady = false;
let mode, selectedProfile, token, sampleCount = 0, completed = false, starting = false, devicesLoading = false;
let deviceLabelsLoaded = false;
async function api(path, body) {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The profile request could not finish.');
  return result;
}
function error(message) { $('profiles-error').textContent = message; $('profiles-error').hidden = !message; }
function notifyProfilesChanged() { try { localStorage.setItem('jarvis.profilesUpdated', String(Date.now())); } catch { /* Jarvis also refreshes before each voice question. */ } }
function element(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
function field(label, input) { const wrap = element('label', '', 'profile-field'); wrap.append(element('span', label), input); return wrap; }
function options(items, value, label) {
  const select = document.createElement('select'); select.setAttribute('aria-label', label);
  for (const [id, name] of items) select.add(new Option(name, id)); select.value = value; return select;
}
async function load() {
  try {
    const [household, speech] = await Promise.all([api('/api/profiles'), api('/api/voices')]);
    profiles = household.profiles; prompts = household.prompts; voices = speech.voices;
    modelReady = household.speakerModel.available;
    const count = profiles.filter(profile => profile.voiceEnrolled).length;
    $('speaker-model-status').textContent = modelReady ? `Local recognition ready · ${count} of 4 voices enrolled` : 'Run SETUP-SPEAKER-ID.cmd to install local voice recognition.';
    $('test-speaker').disabled = !modelReady || !count;
    render();
  } catch (problem) { error(problem.message); }
}
function render() {
  $('profile-grid').replaceChildren(...profiles.map(profile => {
    const card = element('article', '', 'profile-card'); card.setAttribute('aria-label', `${profile.name} profile`);
    const heading = element('div', '', 'profile-card-heading');
    heading.append(element('div', profile.name[0], 'profile-avatar'));
    const identity = element('div'); identity.append(element('h2', profile.name), element('span', profile.voiceEnrolled ? 'Voice enrolled · 3 samples' : 'Voice not enrolled', `profile-voice-badge${profile.voiceEnrolled ? ' enrolled' : ''}`)); heading.append(identity);
    const use = element('a', 'Use profile', 'profile-use-link'); use.href = `/?profile=${encodeURIComponent(profile.id)}`; heading.append(use); card.append(heading);
    const form = document.createElement('form'); form.setAttribute('aria-label', `${profile.name} preferences`);
    const name = document.createElement('input'); name.value = profile.name; name.maxLength = 40; name.required = true; name.setAttribute('aria-label', `${profile.name} display name`);
    const room = options([['', 'Unassigned'], ...[1, 2, 3, 4].map(number => [`bedroom-${number}`, `Bedroom ${number}`])], profile.bedroom || '', `${profile.name} bedroom`);
    const voice = options(voices.map(item => [item.name, item.label || item.name]), profile.voice, `${profile.name} Jarvis voice`);
    const style = options([['concise', 'Short answers'], ['balanced', 'Balanced answers'], ['detailed', 'More detail']], profile.answerStyle, `${profile.name} answer length`);
    const spoken = document.createElement('input'); spoken.type = 'checkbox'; spoken.checked = profile.spokenReplies; spoken.setAttribute('aria-label', `${profile.name} spoken replies`);
    const toggle = element('label', '', 'profile-spoken-toggle'); toggle.append(spoken, document.createTextNode('Spoken replies'));
    form.append(field('Display name', name), field('Bedroom', room), field('Jarvis voice', voice), field('Answer length', style), toggle);
    const save = element('button', 'Save preferences'); save.type = 'submit';
    const note = element('span', '', 'profile-save-note'); note.setAttribute('role', 'status');
    const saveRow = element('div', '', 'profile-save-row'); saveRow.append(save, note); form.append(saveRow);
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true; note.textContent = '';
      try {
        await api('/api/profiles/update', { id: profile.id, preferences: { name: name.value.trim(), bedroom: room.value || null, voice: voice.value, answerStyle: style.value, spokenReplies: spoken.checked } });
        profile.name = name.value.trim(); profile.bedroom = room.value || null; profile.voice = voice.value; profile.answerStyle = style.value; profile.spokenReplies = spoken.checked;
        note.textContent = 'Saved'; error('');
        notifyProfilesChanged();
      } catch (problem) { note.textContent = problem.message; }
      finally { save.disabled = false; }
    });
    card.append(form);
    const actions = element('div', '', 'profile-voice-actions');
    const enroll = element('button', profile.voiceEnrolled ? 'Re-record voice' : 'Set up voice'); enroll.type = 'button'; enroll.disabled = !modelReady; enroll.setAttribute('aria-label', `Set up ${profile.name}'s voice`);
    enroll.addEventListener('click', () => openDialog('enroll', profile)); actions.append(enroll);
    if (profile.voiceEnrolled) {
      const remove = element('button', 'Remove voice', 'profile-remove-voice'); remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!confirm(`Remove ${profile.name}'s saved voice signature? They will need to enroll again.`)) return;
        try { await api('/api/profiles/voice/remove', { id: profile.id, confirmed: true }); notifyProfilesChanged(); await load(); } catch (problem) { error(problem.message); }
      }); actions.append(remove);
    }
    card.append(actions); return card;
  }));
}
const recorder = new LocalMicrophone(() => {
  const recording = recorder.state === 'recording';
  const busy = ['requesting', 'recording', 'transcribing'].includes(recorder.state) || starting;
  $('record-voice').disabled = completed || starting || ['requesting', 'transcribing'].includes(recorder.state) || (mode === 'enroll' && !$('voice-consent').checked);
  $('record-voice').textContent = recording ? 'Finish recording' : recorder.state === 'transcribing' ? 'Processing locally…' : mode === 'test' ? 'Record test' : `Record sample ${sampleCount + 1}`;
  $('record-voice').hidden = completed;
  $('voice-consent').disabled = busy || Boolean(token);
  $('enrollment-device').disabled = busy;
  $('cancel-voice-recording').hidden = !busy;
  $('enrollment-meter-wrap').hidden = !recording;
  $('enrollment-meter').value = recorder.level;
  $('enrollment-time').textContent = `${Math.floor(recorder.elapsed || 0)} / 20s`;
  if (recorder.state !== 'idle') $('voice-dialog-notice').textContent = recording ? 'Recording · read the sentence, then pause' : recorder.state === 'requesting' ? 'Opening microphone…' : 'Building a voice signature locally…';
  else if (recorder.message && recorder.message !== 'Check what I heard, then send.') $('voice-dialog-notice').textContent = recorder.message;
  if (recording && !deviceLabelsLoaded) void loadDevices();
}, (_text, result) => {
  if (mode === 'enroll') {
    sampleCount = result.samples; completed = result.complete;
    $('voice-sample-step').textContent = completed ? 'Voice setup complete' : `${sampleCount} of 3 samples saved for this setup`;
    $('voice-dialog-notice').textContent = completed ? `${selectedProfile.name}'s voice signature is saved locally. Use Test recognition with a new sentence to check it.` : 'Sample accepted. Read the next sentence and record again.';
    if (completed) { token = null; $('voice-prompt').hidden = true; notifyProfilesChanged(); void load(); }
    else $('voice-prompt').textContent = result.prompt;
  } else {
    $('voice-dialog-notice').textContent = result.speaker.status === 'matched' ? `Likely ${result.speaker.name}. This match selects preferences; it does not verify access.` : 'Unknown speaker. Try a longer sentence in a quiet room, or check the enrolled samples.';
  }
});
async function loadDevices() {
  if (devicesLoading || !navigator.mediaDevices?.enumerateDevices) return;
  devicesLoading = true;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'audioinput' && item.deviceId && !['default', 'communications'].includes(item.deviceId));
    deviceLabelsLoaded = devices.some(item => item.label);
    const previous = $('enrollment-device').value;
    $('enrollment-device').replaceChildren(new Option('Default microphone', ''), ...devices.map((item, index) => new Option(item.label || `Microphone ${index + 1}`, item.deviceId)));
    if (devices.some(item => item.deviceId === previous)) $('enrollment-device').value = previous;
  } catch { /* Default microphone remains available. */ }
  finally { devicesLoading = false; }
}
function openDialog(nextMode, profile = null) {
  mode = nextMode; selectedProfile = profile; token = null; sampleCount = 0; completed = false; starting = false;
  recorder.cancel();
  $('voice-dialog-title').textContent = mode === 'enroll' ? `${profile.name}'s voice` : 'Who is speaking?';
  $('voice-dialog-intro').textContent = mode === 'enroll' ? 'Record three different sentences in your normal voice. Stay near the same microphone and keep the room quiet.' : 'Record a new sentence in your normal voice. Jarvis will compare it with enrolled roommates.';
  $('voice-consent-label').hidden = mode !== 'enroll'; $('voice-consent').checked = false; $('voice-consent').disabled = false;
  $('voice-consent-text').textContent = profile ? `I am ${profile.name}, and I agree to save my voice signature on this computer for profile matching.` : '';
  $('voice-sample-step').textContent = mode === 'enroll' ? 'Sample 1 of 3' : 'Test with at least three seconds of speech';
  $('voice-prompt').hidden = false; $('voice-prompt').textContent = mode === 'enroll' ? prompts[0] : 'Jarvis, I am testing my voice profile. Please listen to how I naturally speak and tell me which profile matches.';
  $('voice-dialog-notice').textContent = '';
  $('record-voice').hidden = false; $('record-voice').disabled = mode === 'enroll'; $('record-voice').textContent = mode === 'enroll' ? 'Record sample 1' : 'Record test';
  $('voice-dialog').showModal(); void loadDevices();
}
function cleanupDialog() {
  recorder.cancel();
  if (token) { void fetch('/api/profiles/enrollment/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), keepalive: true }).catch(() => {}); token = null; }
}
$('voice-consent').addEventListener('change', () => { $('record-voice').disabled = !$('voice-consent').checked; });
$('record-voice').addEventListener('click', async () => {
  if (recorder.state === 'recording') { void recorder.finish(); return; }
  if (starting) return;
  starting = true; $('record-voice').disabled = true;
  try {
    if (mode === 'enroll' && !token) {
      const result = await api('/api/profiles/enrollment/start', { profileId: selectedProfile.id, consent: $('voice-consent').checked, replace: selectedProfile.voiceEnrolled }); token = result.token;
    }
    if (!$('voice-dialog').open) { cleanupDialog(); return; }
    await recorder.start('bedroom-1', $('enrollment-device').value, { processAudio: async (wave, signal) => {
      const response = await fetch(mode === 'enroll' ? '/api/profiles/enrollment/sample' : '/api/profiles/voice/test', { method: 'POST', headers: { 'Content-Type': 'audio/wav', ...(mode === 'enroll' ? { 'X-Jarvis-Enrollment': token } : {}) }, body: wave, signal });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Voice processing failed.'); return result;
    } });
  } catch (problem) { $('voice-dialog-notice').textContent = problem.message; }
  finally { starting = false; $('record-voice').disabled = completed || (mode === 'enroll' && !$('voice-consent').checked) || ['requesting', 'transcribing'].includes(recorder.state); }
});
$('cancel-voice-recording').addEventListener('click', () => { recorder.cancel(); $('voice-dialog-notice').textContent = 'Recording cancelled. No sample was added.'; });
$('close-voice-dialog').addEventListener('click', () => $('voice-dialog').close());
$('voice-dialog').addEventListener('close', cleanupDialog);
$('test-speaker').addEventListener('click', () => openDialog('test'));
window.addEventListener('pagehide', cleanupDialog);
void load();
