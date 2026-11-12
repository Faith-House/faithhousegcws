import { LocalSpeech } from './speech.js';
const $ = id => document.getElementById(id);
const labels = { ok: 'Checked', error: 'Needs attention', warning: 'Check connection', setup: 'Not set up', untested: 'Not verified', unknown: 'Unknown' };
let running = false, controller, voice;
const speech = new LocalSpeech($('diagnostic-audio'), () => {
  const active = ['preparing', 'playing'].includes(speech.state);
  $('test-speaker').disabled = active; $('stop-speaker').hidden = !active;
  $('speaker-result').textContent = speech.message || (speech.state === 'playing' ? 'The browser is playing a local voice sample. Can you hear it?' : speech.state === 'preparing' ? 'Preparing the local voice sample…' : 'If you heard the sample, the voice and speaker path worked. If not, check volume, output device and browser sound permission.');
});
async function run() {
  if (running) return;
  running = true; $('run-checks').disabled = true; $('checked-at').textContent = 'Checking…'; $('diagnostics-error').hidden = true;
  $('diagnostic-checks').classList.add('is-stale'); controller = new AbortController();
  try {
    const response = await fetch('/api/diagnostics/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]) });
    if (!response.ok) throw Error('The diagnostics request failed.');
    const report = await response.json();
    $('diagnostic-checks').replaceChildren(...report.items.map(item => {
      const card = document.createElement('section'); card.className = 'diagnostic-check'; card.dataset.status = item.status;
      const header = document.createElement('header'), title = document.createElement('h2'), badge = document.createElement('span');
      title.textContent = item.label; badge.className = 'diagnostic-badge'; badge.textContent = labels[item.status] || 'Unknown'; header.append(title, badge);
      const detail = document.createElement('p'); detail.textContent = item.detail; card.append(header, detail);
      if (item.fix) { const fix = document.createElement('p'); fix.className = 'fix'; fix.textContent = item.fix; card.append(fix); }
      if (['/setup','/weather'].includes(item.href)) { const link = document.createElement('a'); link.href = item.href; link.textContent = item.href === '/weather' ? 'Open Weather setup ↗' : 'Open House setup ↗'; card.append(link); }
      return card;
    }));
    $('report-title').textContent = report.issues ? `${report.issues} connection${report.issues === 1 ? '' : 's'} to check` : 'Checks complete';
    $('report-summary').textContent = report.summary; $('report-note').textContent = report.note;
    $('checked-at').textContent = 'Checked ' + new Date(report.checkedAt).toLocaleTimeString(); $('diagnostic-checks').classList.remove('is-stale');
  } catch {
    $('report-title').textContent = 'Could not complete diagnostics'; $('checked-at').textContent = 'Connection lost or request timed out';
    $('report-summary').textContent = 'Any previous results below are out of date.';
    $('diagnostics-error').textContent = 'Jarvis did not return a diagnostics report. Check that the local server is running; reopen the Jarvis desktop shortcut, then try again.'; $('diagnostics-error').hidden = false;
  } finally { running = false; $('run-checks').disabled = false; }
}
$('run-checks').addEventListener('click', run);
let micSequence = 0, stream, context, frame, timer;
function stopMic(message) {
  micSequence++; clearTimeout(timer); cancelAnimationFrame(frame);
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  void context?.close().catch(() => {}); context = null;
  $('test-microphone').disabled = false; $('stop-microphone').hidden = true; $('microphone-meter').value = 0;
  if (message) $('microphone-result').textContent = message;
}
$('test-microphone').addEventListener('click', async () => {
  stopMic(); const sequence = micSequence; let peak = 0;
  $('test-microphone').disabled = true; $('stop-microphone').hidden = false;
  $('microphone-result').textContent = 'Allow microphone access if prompted, then speak normally.';
  timer = setTimeout(() => stopMic('Microphone permission did not arrive. Check the browser’s microphone permission and try again.'), 15000);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Error('Microphone support is unavailable. Open Jarvis on localhost in Chrome or Edge.');
    const captured = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    if (sequence !== micSequence) { captured.getTracks().forEach(track => track.stop()); return; }
    stream = captured; clearTimeout(timer); context = new AudioContext(); await context.resume();
    if (sequence !== micSequence) return;
    const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
    const values = new Float32Array(analyser.fftSize);
    const sample = () => { if (sequence !== micSequence) return; analyser.getFloatTimeDomainData(values); const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length); peak = Math.max(peak, rms); $('microphone-meter').value = Math.min(1, rms * 8); frame = requestAnimationFrame(sample); };
    sample(); $('microphone-result').textContent = 'Listening for four seconds. Speak now. Nothing is uploaded or saved.';
    timer = setTimeout(() => stopMic(peak > .008 ? 'Microphone input was detected. This confirms audio input, not transcription accuracy or speaker identity.' : 'The microphone opened, but little or no sound was detected. Check the selected input, physical mute switch and microphone level.'), 4000);
  } catch (error) {
    if (sequence !== micSequence) return;
    stopMic(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow the microphone for Jarvis in browser settings.' : error.name === 'NotFoundError' ? 'No microphone was found. Connect a microphone and try again.' : error.message);
  }
});
$('stop-microphone').addEventListener('click', () => stopMic('Microphone test stopped.'));
$('test-speaker').addEventListener('click', async () => {
  $('test-speaker').disabled = true; $('speaker-result').textContent = 'Checking installed voices…';
  try {
    const response = await fetch('/api/voices', { signal: AbortSignal.timeout(8000) });
    const info = await response.json(); if (!response.ok || !info.available) throw Error('The local voice engine is unavailable. Check the Local voice diagnostic above.');
    voice = info.defaultVoice; await speech.speak({ room: 'bedroom-1', voice, test: true });
  } catch (error) { $('speaker-result').textContent = error.message; }
  finally { $('test-speaker').disabled = ['preparing', 'playing'].includes(speech.state); }
});
$('stop-speaker').addEventListener('click', () => speech.stop());
window.addEventListener('pagehide', () => { controller?.abort(); stopMic(); speech.destroy(); });
void run();
