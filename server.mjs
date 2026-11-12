import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createLocalSpeech } from './speech.mjs';
import { createLocalRecognition, decodeMicrophoneWave, MAX_AUDIO_BYTES } from './recognition.mjs';
import { createLocalActions } from './local-actions.mjs';
import { createHomeAssistant } from './home-assistant.mjs';
import { createDisplayPairing } from './display-pairing.mjs';
import { createDisplayServer } from './display-server.mjs';
import { createWakeWordService } from './wakeword.mjs';
import { createProfiles } from './profiles.mjs';
import { createSpeakerIdentification, checkSpeakerAudio } from './speaker-id.mjs';
import { createSpeakerTurns, profileReply, speakerPrompt } from './speaker-context.mjs';
import { isIP } from 'node:net';
import { createSystemHealth } from './system-health.mjs';
import { createCommandInterpreter, isCommandCandidate, commandClarification, directViewIntent } from './command-intents.mjs';
import { createGoogleCalendar, createCalendarDemo } from './google-calendar.mjs';
import { APP_ROOT } from './voice-config.mjs';
import { createReminders } from './reminders.mjs';
import { createToolAgent, isToolRequest, isCompoundToolRequest } from './tool-agent.mjs';
import { createHouseTools } from './house-tools.mjs';
import { streamReplySpeech } from './speech-stream.mjs';
import { readStartupStatus } from './startup-status.mjs';
import { projectId } from './supervisor.mjs';
import { createWeather, isWeatherRequest } from './weather.mjs';
import { createChores } from './chores.mjs';
import { createToolActivity, directToolName } from './tool-activity.mjs';
import { createDiagnostics, connectionChecks } from './diagnostics.mjs';
import { createWebSearch, isSearchRequest } from './web-search.mjs';

export const ROOMS = ['bedroom-1', 'bedroom-2', 'bedroom-3', 'bedroom-4', 'living-room'];
const publicRoot = new URL('./public/', import.meta.url);
const assets = new Map([
  ['/', ['dashboard.html', 'text/html; charset=utf-8']],
  ['/dashboard', ['dashboard.html', 'text/html; charset=utf-8']],
  ['/dashboard.js', ['dashboard.js', 'text/javascript; charset=utf-8']],
  ['/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
  ['/agenda.js', ['agenda.js', 'text/javascript; charset=utf-8']],
  ['/calendar.css', ['calendar.css', 'text/css; charset=utf-8']],
  ['/assistant', ['dashboard.html', 'text/html; charset=utf-8']],
  ['/display', ['index.html', 'text/html; charset=utf-8']],
  ['/diagnostics', ['diagnostics.html', 'text/html; charset=utf-8']],
  ['/diagnostics.js', ['diagnostics.js', 'text/javascript; charset=utf-8']],
  ['/diagnostics.css', ['diagnostics.css', 'text/css; charset=utf-8']],
  ['/setup', ['setup.html', 'text/html; charset=utf-8']],
  ['/setup.js', ['setup.js', 'text/javascript; charset=utf-8']],
  ['/reminders', ['reminders.html', 'text/html; charset=utf-8']],
  ['/reminders.js', ['reminders.js', 'text/javascript; charset=utf-8']],
  ['/reminders.css', ['reminders.css', 'text/css; charset=utf-8']],
  ['/weather', ['weather.html', 'text/html; charset=utf-8']],
  ['/weather.js', ['weather.js', 'text/javascript; charset=utf-8']],
  ['/weather-view.js', ['weather-view.js', 'text/javascript; charset=utf-8']],
  ['/weather.css', ['weather.css', 'text/css; charset=utf-8']],
  ['/chores', ['chores.html', 'text/html; charset=utf-8']],
  ['/chores.js', ['chores.js', 'text/javascript; charset=utf-8']],
  ['/chores.css', ['chores.css', 'text/css; charset=utf-8']],
  ['/activity', ['tools.html', 'text/html; charset=utf-8']],
  ['/activity.css', ['activity.css', 'text/css; charset=utf-8']],
  ['/tools', ['tools.html', 'text/html; charset=utf-8']],
  ['/tools.js', ['tools.js', 'text/javascript; charset=utf-8']],
  ['/profiles', ['profiles.html', 'text/html; charset=utf-8']],
  ['/profiles.js', ['profiles.js', 'text/javascript; charset=utf-8']],
  ['/hud.css', ['hud.css', 'text/css; charset=utf-8']],
  ['/hud.js', ['hud.js', 'text/javascript; charset=utf-8']],
  ['/orb.js', ['orb.js', 'text/javascript; charset=utf-8']],
  ['/speech.js', ['speech.js', 'text/javascript; charset=utf-8']],
  ['/microphone.js', ['microphone.js', 'text/javascript; charset=utf-8']],
  ['/microphone-worklet.js', ['microphone-worklet.js', 'text/javascript; charset=utf-8']],
  ['/wakeword.js', ['wakeword.js', 'text/javascript; charset=utf-8']],
  ['/interruptions.js', ['interruptions.js', 'text/javascript; charset=utf-8']],
  ['/search-sources.js', ['search-sources.js', 'text/javascript; charset=utf-8']],
  ['/wake-chime.wav', ['wake-chime.wav', 'audio/wav']],
  ['/timer-chime.wav', ['timer-chime.wav', 'audio/wav']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const systemPrompt = 'You are Jarvis, the local household assistant. Your name is Jarvis; profile names belong to the people you assist, never to you. Answer the current question directly. Use earlier conversation only when relevant and keep follow-ups consistent. Do not repeat an earlier greeting or answer when the topic changes. Speak naturally in one to three short sentences of plain text, without Markdown or emoji unless requested. For a casual preference question, you may make a conversational choice without claiming human feelings. Use supplied speaker matches and profile preferences; never invent recognition or personal information. Public internet search is available through the search_web tool, with snippet-based local summaries and visible sources. Only claim a web lookup when real search results were supplied. Devices, router monitoring, phone calls and dedicated live data feeds are not connected. Never pretend to carry out an unavailable action.';

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw Object.assign(new Error('Please send a JSON request.'), { status: 415 });
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16384) throw Object.assign(new Error('That request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('That request could not be read.'), { status: 400 }); }
}

function requireRoom(room) {
  if (!ROOMS.includes(room)) throw Object.assign(new Error('Choose a valid room.'), { status: 400 });
  return room;
}

function initialState(view = 'minimal', calendarPreview = null, calendarDraft = null) { return { state: 'idle', view, requestId: null, answer: '', error: '', truncated: false, notification: null, calendarPreview, calendarDraft, webSearch: null, weatherPreview: null }; }

function unavailableConnection(question) {
  const text = question.toLowerCase().replaceAll('’', "'");
  const command = text.replace(/^(?:hey\s+)?jarvis[,\s:]*/, '').replace(/^(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/, '');
  if (/\b(weather|forecast|temperature outside)\b/.test(text) && (/\b(today|tomorrow|tonight|now|current|currently|outside|week|weekend|next)\b/.test(text) || /^(?:what(?:'s| is) (?:the )?|show (?:me )?(?:the )?|tell me (?:the )?)?(?:weather|forecast)[? .!]*$/.test(text))) {
    return "I don't have a live weather service connected yet, so I can't give you a real forecast.";
  }
  if (/\b(?:my|our)\s+(?:(?:first|next|last|upcoming)\s+)?(?:calendar|schedule|agenda|class(?:es)?|appointment(?:s)?|meeting(?:s)?)\b/.test(text) || /^(?:add|create|schedule|move|cancel|delete|show|check)\b.*\b(calendar|appointment|meeting|event|class)\b/.test(command)) {
    return "Google Calendar needs to be connected in House setup before I can read or change it.";
  }
  if (/^(?:turn|switch|dim|brighten|lock|unlock|open|close|mute|unmute|pause|play|change|set)\b.*\b(light(?:s)?|lamp(?:s)?|tv|television|door|lock|volume|channel|movie|music|brightness)\b/.test(command)) {
    return "The home controls aren't connected yet, so I can't change your devices.";
  }
  if (/^(?:call|dial|answer|pick up|hang up)\b/.test(command) || /\b(?:my|our|any) (?:missed|incoming|recent) calls\b/.test(text)) {
    return "The phone system isn't connected yet, so I can't make or answer calls.";
  }
  if (/\b(?:my|our) (?:wi-?fi|network|router|internet)\b/.test(text) || /\b(?:is|check|monitor) (?:the )?(?:wi-?fi|network|internet) (?:working|down|up|connected|slow)\b/.test(text)) {
    return "Router-level device monitoring isn't connected yet. I can check the central computer's network connection if you ask for network status.";
  }
  if (/^(?:remind me|set (?:a |an )?(?:timer|alarm|reminder)|start (?:a )?timer|wake me)\b/.test(command)) {
    return "I can set a room timer or a one-time reminder. Tell me what to remind you about and a future time, such as tomorrow at 7 PM. Wake-up alarms are not set up.";
  }
  if (/\b(?:current|latest|today's|breaking|live) (?:news|score|scores|stock price|stock prices)\b/.test(text)) {
    return "I don't have a live information feed connected yet.";
  }
  return null;
}

export function createJarvisServer({ model = process.env.JARVIS_MODEL || 'qwen3:0.6b', ollamaUrl = process.env.JARVIS_OLLAMA_URL || 'http://127.0.0.1:11434', requestTimeoutMs = 60000, speech = createLocalSpeech(), recognition = createLocalRecognition(), actionsOptions = {}, homeAssistant = createHomeAssistant(), displayBind = process.env.JARVIS_DISPLAY_BIND || '', pairingOptions = {}, wakeword = createWakeWordService(), profiles = createProfiles({ directory: actionsOptions.dataDirectory }), speakerId = createSpeakerIdentification(), webSearch = createWebSearch({ model, ollamaUrl }), diagnosticsOptions = {}, weatherOptions = {} } = {}) {
  const state = new Map(ROOMS.map(room => [room, initialState()]));
  const history = new Map(ROOMS.map(room => [room, []]));
  const clients = new Map(ROOMS.map(room => [room, new Set()]));
  const expiryTimers = new Map();
  const speechCache = new Map();
  const speechControllers = new Map(ROOMS.map(room => [room, new Set()]));
  let active = null;
  let recognitionActive = null;
  void profiles.initialize().catch(() => {});
  const historyKey = (room, profileId) => `${room}:${profileId || 'shared'}`;
  const speakerTurns = createSpeakerTurns();
  const systemHealth = createSystemHealth();
  const calendar = createGoogleCalendar({ dataDirectory: actionsOptions.dataDirectory || `${APP_ROOT}/private` });
  const weather = createWeather({ directory: actionsOptions.dataDirectory, ...weatherOptions });
  const chores = createChores({ directory: actionsOptions.dataDirectory, profiles, timeZone: actionsOptions.timeZone || process.env.JARVIS_TIMEZONE || 'America/Chicago', now: actionsOptions.now });
  const calendarDrafts = new Map();
  let reminderSnapshot = { reminders: [] };
  function syncReminderAlerts(info = reminderSnapshot) {
    reminderSnapshot = info;
    for (const room of ROOMS) {
      const current = state.get(room).notification;
      if (current && current.kind !== 'reminder') continue;
      const due = info.reminders.filter(item => item.room === room && item.due);
      const id = due.length ? 'reminder:' + due[0].id : null;
      const message = due.length ? 'Reminder: ' + due[0].title + (due.length > 1 ? ' · ' + (due.length - 1) + ' more waiting' : '') : '';
      if ((current?.id || null) === id && (!id || current.message === message)) continue;
      const notification = id ? { id, kind: 'reminder', createdAt: Date.now(), reminderIds: [due[0].id], message } : null;
      state.set(room, { ...state.get(room), notification }); publish(room);
    }
  }
  const reminders = createReminders({ rooms: ROOMS, directory: actionsOptions.dataDirectory, timeZone: actionsOptions.timeZone || process.env.JARVIS_TIMEZONE || 'America/Chicago', now: actionsOptions.now, onChange: syncReminderAlerts });
  void reminders.initialize();
  let displayServer;
  if (displayBind && (isIP(displayBind) !== 4 || !/^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(displayBind))) throw new Error('Choose a specific private IPv4 address for the TV receiver.');
  const pairing = createDisplayPairing({ ...pairingOptions, rooms: ROOMS, onRevoke: id => displayServer?.revoke(id) });
  if (displayBind) displayServer = createDisplayServer({ pairing, bindAddress: displayBind, snapshot: room => state.get(room), dashboard: room => buildDashboard(room), subscribe: (room, response) => { clients.get(room).add(response); return () => clients.get(room).delete(response); } });
  const actions = createLocalActions({ ...actionsOptions, rooms: ROOMS, onTimer: timer => {
    const notification = { id: timer.id, createdAt: Date.now(), message: `${timer.label ? `Your ${timer.label} timer` : 'Your timer'} ${timer.overdue ? 'finished while Jarvis was away' : 'is finished'}.`, kind: 'timer' };
    state.set(timer.room, { ...state.get(timer.room), notification });
    publish(timer.room);
  } });
  void actions.initialize();
  const base = new URL(ollamaUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') {
    throw new Error('This prototype expects Ollama on this computer at an http://localhost address.');
  }
  const commandInterpreter = createCommandInterpreter({ model, base });
  const diagnostics = createDiagnostics({ ...diagnosticsOptions, checks: diagnosticsOptions.checks || connectionChecks({ checkModel, speech, recognition, wakeword, speakerId, homeAssistant, calendar, pairing, webSearch, weather, network: actions.network, displayStatus: () => ({ enabled: Boolean(displayServer?.server.listening), connectedIds: displayServer?.connectedIds() || [] }) }) });
  const activity = createToolActivity();
  const toolAgent = createToolAgent({ onActivity: activity.event, model: process.env.JARVIS_TOOL_MODEL || model, base, tools: createHouseTools({ actions, reminders, calendar, homeAssistant, systemHealth, webSearch, diagnostics, chores, weather, draftCalendarEvent: (room, event) => calendarDrafts.set(room, { ...event, expiresAt: Date.now() + 120000 }) }) });
  const toolContext = (room, profileId, question = '', view = 'minimal', signal) => ({ room, profileId: profileId || null, question, view, signal, timeZone: process.env.JARVIS_TIMEZONE || 'America/Chicago' });

  let modelCheck, modelCache;
  async function checkModel() {
    if (modelCache && Date.now() - modelCache.checkedAt < 3000) return modelCache;
    if (modelCheck) return modelCheck;
    modelCheck = (async () => {
      let available = false, modelInstalled = false;
      try {
        const upstream = await fetch(new URL('/api/tags', base), { signal: AbortSignal.timeout(3000) });
        const tags = await upstream.json(); available = upstream.ok;
        modelInstalled = Array.isArray(tags.models) && tags.models.some(item => item.name === model || item.model === model);
      } catch { /* Keep the dashboard available when the model service is down. */ }
      modelCache = { available, modelInstalled, model, checkedAt: Date.now() };
      return modelCache;
    })().finally(() => { modelCheck = null; });
    return modelCheck;
  }

  async function weatherSnapshot() {
    const status = await weather.status();
    if (!status.configured || status.configurationError) return { ...status, data: null, error: status.configurationError ? 'Weather configuration needs attention.' : '' };
    try { const data = await weather.read(); return { ...await weather.status(), data, error: '' }; }
    catch { return { ...status, connected: false, data: null, error: 'Weather is temporarily unavailable. Check Connection diagnostics.' }; }
  }
  async function buildDashboard(onlyRoom = null) {
    const results = await Promise.allSettled([checkModel(), systemHealth.read(), profiles.list(), pairing.list(), actions.listTimers(), homeAssistant.status({ checkConnection: true }), speech.listVoices(), calendar.status(), weatherSnapshot()]);
    const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
    const registry = value(3), connected = new Set(displayServer?.connectedIds() || []);
    const info = {
      checkedAt: Date.now(), timeZone: process.env.JARVIS_TIMEZONE || 'America/Chicago', ai: value(0), system: value(1), profiles: value(2)?.profiles || null,
      displays: registry ? { enabled: Boolean(displayServer?.server.listening), configurationError: registry.configurationError, devices: registry.devices.map(device => ({ id: device.id, name: device.name, room: device.room, receiving: connected.has(device.id) })) } : null,
      weather: value(8), timers: value(4), homeAssistant: value(5), speech: { available: Boolean(value(6)?.available) }, microphone: recognition.status(), listening: wakeword.status().listening,
      rooms: ROOMS.map(id => ({ id, state: state.get(id).state, view: state.get(id).view })), services: { calendar: Boolean(value(7)?.connected), weather: Boolean(value(8)?.connected), phone: false }, calendar: value(7) ? { configured: value(7).configured, connected: value(7).connected } : null,
    };
    if (!onlyRoom) return info;
    // A paired TV gets this room's read-only overview, never the central control data.
    const network = actions.network.peek?.();
    return {
      checkedAt: info.checkedAt, timeZone: info.timeZone, ai: info.ai, system: info.system, speech: info.speech, services: info.services, weather: info.weather,
      profiles: info.profiles?.map(profile => ({ name: profile.name })) || null,
      rooms: info.rooms.filter(room => room.id === onlyRoom),
      displays: info.displays ? { enabled: info.displays.enabled, devices: info.displays.devices.filter(device => device.room === onlyRoom).map(({ name, room, receiving }) => ({ name, room, receiving })) } : null,
      timers: info.timers ? { available: info.timers.available, timers: info.timers.timers.filter(timer => timer.room === onlyRoom) } : null,
      homeAssistant: info.homeAssistant ? { configured: info.homeAssistant.configured, connected: info.homeAssistant.connected } : null,
      network: network ? { checkedAt: network.checkedAt, connected: network.connected, adapter: network.adapter, gatewayResponds: network.gatewayResponds, gatewayLatencyMs: network.gatewayLatencyMs, downloadKbps: network.downloadKbps, uploadKbps: network.uploadKbps } : null,
    };
  }

  function publish(room) {
    const message = `data: ${JSON.stringify(state.get(room))}\n\n`;
    for (const client of clients.get(room)) {
      if (!client.destroyed) client.write(message);
    }
  }

  function publishVisual(room, visual) {
    const message = `event: visual\ndata: ${JSON.stringify(visual)}\n\n`;
    for (const client of clients.get(room)) if (!client.destroyed && client.writableLength < 32768) client.write(message);
  }

  function invalidateSpeech(room) {
    for (const controller of speechControllers.get(room)) controller.abort(new Error('Speech cancelled.'));
    speechControllers.get(room).clear();
    for (const [key, entry] of speechCache) if (entry.room === room) speechCache.delete(key);
  }

  function scheduleExpiry(room, requestId, delay) {
    clearTimeout(expiryTimers.get(room));
    const expiry = setTimeout(() => {
      if (state.get(room).requestId === requestId) { invalidateSpeech(room); state.set(room, { ...initialState(state.get(room).view, state.get(room).calendarPreview, state.get(room).calendarDraft), notification: state.get(room).notification }); publish(room); }
    }, delay);
    expiry.unref();
    expiryTimers.set(room, expiry);
  }

  function update(room, patch) {
    state.set(room, { ...state.get(room), ...patch });
    publish(room);
    if (['ready', 'error'].includes(patch.state)) {
      const requestId = state.get(room).requestId;
      const delay = patch.state === 'error' ? 30000 : Math.max(22000, Math.min(60000, (patch.answer || '').length * 90));
      scheduleExpiry(room, requestId, delay);
    }
  }

  function cancel(room, resetHistory = false, profileId = null, preservePending = false) {
    if (!preservePending || resetHistory) { toolAgent.clear(toolContext(room, profileId)); calendarDrafts.delete(room); }
    if (recognitionActive?.room === room) recognitionActive.controller.abort();
    invalidateSpeech(room);
    clearTimeout(expiryTimers.get(room));
    expiryTimers.delete(room);
    if (active?.room === room) {
      activity.endRequest(active.requestId, 'cancelled');
      active.controller.abort(new Error('cancelled'));
      active = null;
    }
    if (resetHistory) history.set(historyKey(room, profileId), []);
    state.set(room, { ...initialState(state.get(room).view, preservePending ? state.get(room).calendarPreview : null, preservePending ? state.get(room).calendarDraft : null), notification: state.get(room).notification });
    publish(room);
  }

  async function generate(room, question, requestId, controller, profile, speaker, viewContext) {
    const timer = setTimeout(() => controller.abort(new Error('timeout')), requestTimeoutMs);
    timer.unref();
    const stillCurrent = () => state.get(room).requestId === requestId;
    const activityContext = { room, requestId, signal: controller.signal };
    const tracked = (tool, task, classify) => activity.track(activityContext, tool, task, classify);
    try {
      const household = await profiles.list();
      const identityReply = profileReply({ question, profile, speaker, household, modelAvailable: speakerId.status().available });
      if (!stillCurrent()) return;
      if (identityReply) { update(room, { state: 'ready', answer: identityReply }); return; }
      if (/\b(?:diagnos(?:e|is|tics)|troubleshoot|check (?:all |my |the )?connections|connection (?:health|check))\b/i.test(question) && !/\b(?:don't|do not|never)\b/i.test(question)) {
        const report = await tracked('diagnose_connections', () => diagnostics.run());
        if (!stillCurrent()) return;
        update(room, { state: 'ready', answer: report.summary + ' Open Connection diagnostics for the detailed checks and browser audio tests.', resultKind: 'diagnostics' }); return;
      }
      if (/\b(?:show|open|view|pull up)\b.*\btool activity\b/i.test(question)) { update(room, { state: 'ready', answer: 'Here is the tool activity view. Open it to see running actions and their outcomes.', resultKind: 'activity' }); return; }
      if (/\bchores?\b/i.test(question) && !/\b(?:don't|do not|never|not done|haven't|didn't)\b/i.test(question)) {
        const direct = await tracked(/\b(?:add|create)\b/i.test(question) ? 'add_chore' : /\b(?:mark|complete|finish)\b/i.test(question) ? 'set_chore_status' : 'list_chores', () => chores.handle(question, profile?.id), r => !r ? 'ignored' : r.needsInterpretation ? 'waiting' : r.ok === false ? 'failed' : 'completed');
        if (direct) {
          update(room, { state: 'ready', answer: direct.summary, resultKind: 'chores' }); return;
        }
      }
      if (/\b(?:close|hide|dismiss)\b.*\bweather\b/i.test(question)) { update(room, { state: 'ready', answer: 'Weather preview closed.', weatherPreview: null, resultKind: 'weather' }); return; }
      if (isWeatherRequest(question)) {
        const result = await tracked('get_weather', () => weather.answer(question, { signal: controller.signal }));
        if (!stillCurrent()) return;
        update(room, { state: 'ready', answer: result.summary, ...(result.patch || {}), resultKind: 'weather' }); return;
      }
      if (isSearchRequest(question)) {
        update(room, { state: 'thinking', resultKind: 'web-search', calendarPreview: null });
        const result = await tracked('search_web', () => webSearch.answer(question, { signal: controller.signal }));
        if (!stillCurrent()) return;
        controller.signal.throwIfAborted();
        update(room, { state: 'ready', answer: result.summary, ...(result.patch || {}), resultKind: 'web-search', toolActivity: [{ tool: 'search_web', status: result.ok ? 'completed' : 'failed' }] }); return;
      }
      if (/\b(?:what (?:tools|actions) (?:can|do) you|what can you (?:do|control)|(?:your|available) capabilities)\b/i.test(question)) {
        const home = await homeAssistant.status();
        update(room, { state: 'ready', resultKind: 'tool-agent', answer: 'I can switch screen views, run room timers and reminders, manage shared household chores, read current weather and forecasts, show calendar previews, and check this computer and its network. I can search the internet for public information with source links, combine tasks, and ask for missing details. ' + (home.configured && home.exposedDevices.length ? 'I can also control the approved shared Home Assistant devices.' : 'Shared device controls need Home Assistant connected first.') }); return;
      }
      const context = { ...toolContext(room, profile?.id, question, viewContext || state.get(room).view, controller.signal), requestId };
      const compound = isCompoundToolRequest(question);
      const useAgentFirst = compound || toolAgent.hasPending(context);
      const directView = !useAgentFirst && directViewIntent(question, context.view);
      if (directView) {
        await tracked('set_view', async () => ({ ok: true }));
        update(room, { state: 'ready', view: directView.action === 'show_dashboard' ? 'dashboard' : 'minimal', answer: directView.action === 'show_dashboard' ? 'Here’s the dashboard.' : 'Back to Jarvis.', resultKind: 'view' }); return;
      }
      const acceptTools = result => {
        if (!result.handled || !stillCurrent()) return false;
        update(room, { state: 'ready', answer: result.answer, ...(result.patch || {}), resultKind: result.patch?.view ? 'view' : result.clarification ? 'clarification' : 'tool-agent', toolActivity: result.activity || [] }); return true;
      };
      if (useAgentFirst) {
        const result = await toolAgent.run(context);
        if (acceptTools(result)) return;
        if (compound) { update(room, { state: 'ready', answer: 'I could not confidently plan every step, so I have not started them. Could you split that request into individual tasks?', resultKind: 'clarification' }); return; }
      }
      if (/\b(?:demo|sample|example)\b/i.test(question) && /\b(?:calendar|schedule)\b/i.test(question) && !/\b(?:don't|do not|never|add|create|delete)\b/i.test(question)) {
        await tracked('preview_calendar_demo', async () => ({ ok: true }));
        const range = /\bweek(?:ly)?\b/i.test(question) ? 'week' : 'day';
        calendarDrafts.delete(room);
        update(room, { state: 'ready', view: 'minimal', answer: 'Here is a sample calendar. These are fictional events.', resultKind: 'calendar-demo', calendarDraft: null, calendarPreview: createCalendarDemo({ range, timeZone: process.env.JARVIS_TIMEZONE || 'America/Chicago' }) }); return;
      }
      const pendingCalendar = calendarDrafts.get(room);
      const reply = question.toLowerCase().trim().replace(/[?.!]+$/, '');
      if (pendingCalendar && pendingCalendar.expiresAt <= Date.now()) {
        calendarDrafts.delete(room); update(room, { state: 'ready', answer: 'That event confirmation expired. Please ask me to add it again.', resultKind: 'calendar-event', calendarDraft: null }); return;
      }
      if (pendingCalendar && /^(?:yes|confirm|confirm it|add it|yes add it|go ahead|do it|that's right)$/.test(reply)) {
        try {
          const event = await tracked('add_calendar_event', () => calendar.addEvent({ ...pendingCalendar, timeZone: process.env.JARVIS_TIMEZONE || 'America/Chicago' }));
          calendarDrafts.delete(room);
          update(room, { state: 'ready', answer: 'Added ' + event.title + ' to your Google Calendar.', resultKind: 'calendar-event', calendarPreview: null, calendarDraft: null }); return;
        } catch (error) {
          calendarDrafts.delete(room);
          update(room, { state: 'ready', answer: error.status === 401 ? error.message : 'I could not add the event. It was not confirmed as saved.', resultKind: 'calendar-event', calendarDraft: null }); return;
        }
      }
      if (pendingCalendar && /^(?:no|cancel|never mind|forget it|don't add it)$/.test(reply)) {
        calendarDrafts.delete(room); update(room, { state: 'ready', answer: 'Okay, I did not add the event.', resultKind: 'calendar-event', calendarDraft: null }); return;
      }
      const runLocal = async () => await reminders.handle({ room, question }) || await actions.handle({ room, question });
      const directTool = directToolName(question);
      let local = directTool ? await tracked(directTool, runLocal, r => !r ? 'ignored' : r.needsInterpretation ? 'waiting' : r.ok === false || (directTool === 'start_timer' && !r.timer) || (directTool === 'cancel_timer' && !r.ok) || (directTool === 'create_reminder' && !r.reminder) ? 'failed' : 'completed') : await runLocal();
      let device = null;
      if (!local) {
        const control = /^(?:(?:please|hey jarvis)[, ]+)?(?:turn|switch|dim|brighten|pause|play|resume|mute|unmute|lock|unlock|open|close|set)\b/i.test(question) && /\b(?:lights?|lamps?|tv|television|doors?|locks?|brightness|volume)\b/i.test(question);
        const action = () => homeAssistant.handle({ room, question, signal: controller.signal });
        device = control ? await tracked('control_device', action, r => r?.needsInterpretation || !r ? 'waiting' : r.ok === true ? 'completed' : 'failed') : await action();
      }
      if (device?.needsInterpretation) device = null;
      if ((!local || local.needsInterpretation) && !device && !useAgentFirst && (isToolRequest(question) || isCommandCandidate(question))) {
        const result = await toolAgent.run(context);
        if (acceptTools(result)) return;
      }
      if ((!local || local.needsInterpretation) && !device && isCommandCandidate(question)) {
        const home = await homeAssistant.status();
        const intent = await commandInterpreter.interpret({ question, view: viewContext || state.get(room).view, devices: home.configured ? home.exposedDevices : [], timeZone: process.env.JARVIS_TIMEZONE || 'America/Chicago', now: Date.now(), signal: controller.signal });
        if (!stillCurrent()) return;
        controller.signal.throwIfAborted();
        if (intent.type === 'local') local = await tracked(directToolName(intent.question) || 'local_action', () => actions.handle({ room, question: intent.question }), r => !r ? 'ignored' : r.needsInterpretation ? 'waiting' : r.ok === false ? 'failed' : 'completed');
        else if (intent.type === 'device') device = await tracked('control_device', () => homeAssistant.handle({ room, question: intent.question, signal: controller.signal }), r => r?.ok === true ? 'completed' : 'failed');
        else if (intent.type === 'disconnected') { update(room, { state: 'ready', answer: "The home controls aren't connected yet. Home Assistant and an approved device list are needed first.", resultKind: 'device' }); return; }
        else if (intent.type === 'calendar-preview') local = { answer: intent.range === 'week' ? 'Here’s your calendar for this week.' : 'Here’s your calendar for today.', kind: 'calendar-preview', range: intent.range };
        else if (intent.type === 'calendar-clear') { await tracked('hide_calendar', async () => ({ ok: true })); update(room, { state: 'ready', answer: 'Calendar preview closed.', resultKind: 'calendar-preview', calendarPreview: null, calendarDraft: null }); calendarDrafts.delete(room); return; }
        else if (intent.type === 'calendar-add') {
          if (!(await calendar.status()).connected) { await tracked('draft_calendar_event', async () => ({ ok: false })); update(room, { state: 'ready', answer: 'Google Calendar is not connected yet. Open House setup to connect it.', resultKind: 'calendar-event' }); return; }
          calendarDrafts.set(room, { title: intent.title, start: intent.start, end: intent.end, expiresAt: Date.now() + 120000 });
          const zone = process.env.JARVIS_TIMEZONE || 'America/Chicago';
          const start = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(intent.start));
          const end = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(intent.end));
          update(room, { state: 'ready', answer: 'Add “' + intent.title + '” on ' + start + ' to ' + end + '? Say “confirm” to add it, or “cancel” to discard.', resultKind: 'calendar-confirmation', calendarDraft: intent }); return;
        }
        else if (intent.type === 'clarify' || intent.type === 'unavailable') {
          update(room, { state: 'ready', answer: intent.type === 'unavailable' ? 'The local command interpreter is unavailable. No action was taken. You can still use the direct controls.' : commandClarification(question), resultKind: 'clarification' }); return;
        }
      }
      if (!stillCurrent()) return;
      if (local) {
        if (local.kind === 'calendar-preview') {
          if (local.clearCalendar) { await tracked('hide_calendar', async () => ({ ok: true })); update(room, { state: 'ready', answer: local.answer, resultKind: local.kind, calendarPreview: null, calendarDraft: null }); calendarDrafts.delete(room); return; }
          if (!(await calendar.status()).connected) { await tracked('preview_calendar', async () => ({ ok: false })); update(room, { state: 'ready', answer: 'Google Calendar is not connected yet. Open House setup to connect it.', resultKind: local.kind }); return; }
          try {
            const preview = await tracked('preview_calendar', () => calendar.preview({ range: local.range, timeZone: process.env.JARVIS_TIMEZONE || 'America/Chicago' }));
            update(room, { state: 'ready', answer: local.answer, resultKind: local.kind, calendarPreview: preview, calendarDraft: null }); calendarDrafts.delete(room); return;
          } catch (error) {
            update(room, { state: 'ready', answer: error.status === 401 ? error.message : 'I could not load Google Calendar just now. Please try again.', resultKind: local.kind }); return;
          }
        }
        if (local.kind === 'view') {
          update(room, { view: local.view, state: 'ready', answer: local.answer, resultKind: 'view' }); return;
        }
        update(room, { state: 'ready', answer: local.answer, resultKind: local.kind, ...(local.kind === 'reminder' ? { calendarPreview: null } : {}) }); return;
      }
      if (device) { update(room, { state: 'ready', answer: device.answer, resultKind: device.kind }); return; }
      const unavailable = unavailableConnection(question);
      if (unavailable) {
        update(room, { state: 'ready', answer: unavailable });
        return;
      }
      const key = historyKey(room, profile?.id);
      const messages = (history.get(key) || []).slice(-4).map(message => ({ ...message, content: message.content.slice(0, 350) }));
      const preference = speakerPrompt({ profile, speaker, household });
      const upstream = await fetch(new URL('/api/chat', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt + preference }, ...messages, { role: 'user', content: `Answer this current question: ${question}` }],
          stream: true,
          think: false,
          keep_alive: '5m',
          options: { num_ctx: 2048, num_predict: profile?.answerStyle === 'detailed' ? 300 : 180, temperature: 0.7, repeat_penalty: 1.1, repeat_last_n: 256 },
        }),
      });
      if (!upstream.ok) {
        const error = new Error(upstream.status === 404 ? `The model ${model} is missing. Open Ollama and download it, then try again.` : 'Ollama could not answer. Try a shorter question or check the Ollama app.');
        throw error;
      }
      let buffer = '';
      let answer = '';
      let completed = false;
      let truncated = false;
      const decoder = new TextDecoder();
      function acceptLine(line) {
        if (!line.trim()) return;
        const item = JSON.parse(line);
        if (item.error) throw new Error('Ollama could not finish this answer. Check the Ollama app and try again.');
        if (item.message?.content) {
          answer += item.message.content;
          if (stillCurrent()) update(room, { state: 'answering', answer });
        }
        if (item.done) { completed = true; truncated = item.done_reason === 'length'; }
      }
      for await (const chunk of upstream.body) {
        if (!stillCurrent()) return;
        buffer += decoder.decode(chunk, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          acceptLine(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 1);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) acceptLine(buffer);
      if (!stillCurrent()) return;
      if (!completed || !answer.trim()) throw new Error('The answer ended early. Please try again.');
      history.set(key, [...(history.get(key) || []), { role: 'user', content: question }, { role: 'assistant', content: answer.trim() }].slice(-4));
      update(room, { state: 'ready', answer: answer.trim(), truncated });
    } catch (error) {
      if (!stillCurrent()) return;
      if (controller.signal.aborted && controller.signal.reason?.message === 'cancelled') {
        cancel(room);
      } else {
        const message = controller.signal.aborted ? 'That answer took too long. Try a shorter question.' : error instanceof TypeError ? 'I cannot reach Ollama. Open the Ollama app, then try again.' : error.message;
        update(room, { state: 'error', answer: '', error: message });
      }
    } finally {
      activity.endRequest(requestId, controller.signal.aborted && controller.signal.reason?.message === 'cancelled' ? 'cancelled' : 'failed');
      clearTimeout(timer);
      if (active?.requestId === requestId) active = null;
    }
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const address = server.address();
      const host = new URL(`http://${request.headers.host || ''}`);
      if (!['127.0.0.1', 'localhost'].includes(host.hostname) || Number(host.port) !== address.port) {
        return json(response, 403, { error: 'This prototype is available only on this computer.' });
      }
      const origin = request.headers.origin;
      if (origin && origin !== host.origin) return json(response, 403, { error: 'Please use the Jarvis page on this computer.' });
      const url = new URL(request.url, host.origin);
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [filename, mime] = assets.get(url.pathname);
        const file = await readFile(new URL(filename, publicRoot));
        response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
        return response.end(file);
      }
      if (request.method === 'GET' && url.pathname === '/api/startup') return json(response, 200, await readStartupStatus());
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { app: 'jarvis-local-house', projectId: projectId(APP_ROOT), pid: process.pid, uptimeSeconds: Math.floor(process.uptime()) });
      if (request.method === 'GET' && url.pathname === '/api/status') {
        return json(response, 200, { ...await checkModel(), rooms: ROOMS, busy: Boolean(active || recognitionActive), microphone: recognition.status(), prototype: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/dashboard') {
        return json(response, 200, await buildDashboard());
      }
      if (request.method === 'GET' && url.pathname === '/api/calendar/status') return json(response, 200, await calendar.status());
      if (request.method === 'GET' && url.pathname === '/api/weather') return json(response, 200, await weatherSnapshot());
      if (request.method === 'GET' && url.pathname === '/api/weather/locations') return json(response, 200, { locations: await weather.search(url.searchParams.get('q')) });
      if (request.method === 'POST' && url.pathname === '/api/weather/location') { await weather.configure(await readJson(request)); return json(response, 200, await weatherSnapshot()); }
      if (request.method === 'GET' && url.pathname === '/api/chores') return json(response, 200, await chores.list());
      if (request.method === 'POST' && ['/api/chores', '/api/chores/update'].includes(url.pathname)) {
        const body = await readJson(request);
        const context = { room: 'living-room', requestId: randomUUID() };
        const result = await activity.track(context, url.pathname === '/api/chores' ? 'add_chore' : 'update_chore', () => url.pathname === '/api/chores' ? chores.add(body) : chores.update(body));
        return json(response, url.pathname === '/api/chores' ? 201 : 200, result);
      }
      if (request.method === 'GET' && url.pathname === '/api/activity') { const room = requireRoom(url.searchParams.get('room')); return json(response, 200, { room, checkedAt: Date.now(), entries: activity.list(room) }); }
      if (request.method === 'GET' && url.pathname === '/api/tools') {
        const room = requireRoom(url.searchParams.get('room') || 'bedroom-1');
        return json(response, 200, { model: process.env.JARVIS_TOOL_MODEL || model, tools: await toolAgent.catalog(toolContext(room)), activity: toolAgent.activity(room) });
      }
      if (request.method === 'GET' && url.pathname === '/api/reminders') return json(response, 200, await reminders.list(requireRoom(url.searchParams.get('room'))));
      if (request.method === 'POST' && url.pathname === '/api/reminders') {
        const body = await readJson(request);
        return json(response, 201, await reminders.add({ room: requireRoom(body?.room), title: body.title, localTime: body.localTime }));
      }
      if (request.method === 'POST' && url.pathname === '/api/reminders/clear') {
        const body = await readJson(request);
        return json(response, 200, await reminders.remove(requireRoom(body?.room), [body.id]));
      }
      if (request.method === 'POST' && url.pathname === '/api/calendar/demo') {
        const body = await readJson(request), room = requireRoom(body?.room);
        if (active || recognitionActive) return json(response, 409, { error: 'Wait for the current question to finish, then open the demo.' });
        const preview = createCalendarDemo({ range: body.range || 'day', timeZone: process.env.JARVIS_TIMEZONE || 'America/Chicago' });
        invalidateSpeech(room); calendarDrafts.delete(room); clearTimeout(expiryTimers.get(room));
        state.set(room, { ...initialState('minimal', preview), state: 'ready', requestId: randomUUID(), resultKind: 'calendar-demo', notification: state.get(room).notification });
        publish(room);
        return json(response, 200, state.get(room));
      }
      if (request.method === 'POST' && url.pathname === '/api/calendar/credentials') {
        const body = await readJson(request);
        return json(response, 200, await calendar.saveDesktopClient(body?.credentials));
      }
      if (request.method === 'POST' && url.pathname === '/api/calendar/connect') return json(response, 200, await calendar.beginConnect());
      if (request.method === 'GET' && url.pathname === '/api/calendar/preview') {
        const status = await calendar.status();
        if (!status.connected) return json(response, 409, { error: 'Connect Google Calendar in House setup first.' });
        return json(response, 200, await calendar.preview({ range: url.searchParams.get('range') || 'day', date: url.searchParams.get('date'), timeZone: process.env.JARVIS_TIMEZONE || 'America/Chicago' }));
      }
      if (request.method === 'GET' && url.pathname === '/api/microphone') return json(response, 200, recognition.status());
      if (request.method === 'POST' && url.pathname === '/api/visual') {
        const body = await readJson(request), room = requireRoom(body?.room);
        if (![null, 'listening', 'speaking'].includes(body.state) || !Number.isFinite(body.level) || body.level < 0 || body.level > 1) return json(response, 400, { error: 'Use a valid room audio level.' });
        publishVisual(room, { state: body.state, level: body.state ? body.level : 0 });
        return json(response, 200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/profiles') return json(response, 200, { ...await profiles.list(), speakerModel: speakerId.status() });
      if (request.method === 'POST' && url.pathname === '/api/profiles/update') {
        const body = await readJson(request);
        return json(response, 200, { profile: await profiles.update(body?.id, body?.preferences) });
      }
      if (request.method === 'POST' && url.pathname === '/api/profiles/enrollment/start') {
        const body = await readJson(request);
        if (wakeword.status().listening) return json(response, 409, { error: 'Stop Hey Jarvis listening in the other Jarvis tab before setting up voices.' });
        if (!speakerId.status().available) return json(response, 503, { error: 'Run SETUP-SPEAKER-ID.cmd first.' });
        return json(response, 200, await profiles.beginEnrollment(body || {}));
      }
      if (request.method === 'POST' && url.pathname === '/api/profiles/enrollment/cancel') {
        const body = await readJson(request); profiles.cancelEnrollment(body?.token);
        return json(response, 200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/profiles/voice/remove') {
        const body = await readJson(request); return json(response, 200, await profiles.removeVoice(body?.id, body?.confirmed));
      }
      if (request.method === 'POST' && ['/api/profiles/enrollment/sample', '/api/profiles/voice/test'].includes(url.pathname)) {
        if (wakeword.status().listening) return json(response, 409, { error: 'Stop Hey Jarvis listening in the other Jarvis tab before recording a voice test.' });
        if (request.headers['content-type'] !== 'audio/wav') return json(response, 415, { error: 'Record voice audio using the profile setup.' });
        const token = request.headers['x-jarvis-enrollment'];
        const enrolling = url.pathname.endsWith('/sample');
        if (enrolling) profiles.enrollment(token);
        if (active || recognitionActive) return json(response, 409, { error: 'Wait for the current Jarvis question before recording a voice profile.' });
        if (Number(request.headers['content-length']) > MAX_AUDIO_BYTES) return json(response, 413, { error: 'Record up to 20 seconds.' });
        const controller = new AbortController(); const job = { room: null, controller }; recognitionActive = job;
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        try {
          const parts = []; let length = 0;
          for await (const part of request) { length += part.length; if (length > MAX_AUDIO_BYTES) throw Object.assign(new Error('Record up to 20 seconds.'), { status: 413 }); parts.push(part); }
          const wave = Buffer.concat(parts), audio = decodeMicrophoneWave(wave);
          if (audio.length < (enrolling ? 48000 : 24000)) return json(response, 422, { error: enrolling ? 'Read the sentence naturally for at least three seconds.' : 'Use at least 1.5 seconds of clear speech.' });
          checkSpeakerAudio(audio, enrolling);
          speech.close?.(); recognition.close?.();
          const result = await speakerId.embed({ audio, signal: controller.signal });
          if (controller.signal.aborted || response.destroyed) return;
          const reply = enrolling ? await profiles.addSample(token, result.embedding, createHash('sha256').update(wave).digest('hex')) : { speaker: await profiles.identify(result.embedding) };
          return json(response, 200, { ...reply, localOnly: true });
        } finally { if (recognitionActive === job) recognitionActive = null; speakerId.close?.(); }
      }
      if (request.method === 'POST' && url.pathname === '/api/diagnostics/run') { await readJson(request); return json(response, 200, await diagnostics.run()); }
      if (request.method === 'GET' && url.pathname === '/api/search/status') return json(response, 200, webSearch.status());
      if (request.method === 'GET' && url.pathname === '/api/listen/status') return json(response, 200, wakeword.status());
      if (request.method === 'POST' && url.pathname === '/api/listen/start') {
        const body = await readJson(request);
        const room = requireRoom(body?.room);
        const info = await wakeword.start(room);
        if (response.destroyed) { wakeword.stop(info.token); return; }
        return json(response, 200, info);
      }
      if (request.method === 'POST' && url.pathname === '/api/listen/stop') {
        const body = await readJson(request);
        if (typeof body?.token !== 'string' || !/^[a-zA-Z0-9_-]{32}$/.test(body.token)) return json(response, 400, { error: 'Use a valid listening session.' });
        wakeword.stop(body.token);
        return json(response, 200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/listen/frame') {
        const token = request.headers['x-jarvis-listening'];
        if (!wakeword.authorize(token)) return json(response, 409, { error: 'This listening session has ended. Enable Hey Jarvis again.' });
        if (request.headers['content-type'] !== 'application/octet-stream') return json(response, 415, { error: 'Send a PCM microphone frame.' });
        if (request.headers['content-length'] && Number(request.headers['content-length']) !== 2560) return json(response, 400, { error: 'Send one 80-millisecond PCM frame.' });
        const chunks = []; let length = 0;
        for await (const chunk of request) { length += chunk.length; if (length > 2560) return json(response, 413, { error: 'Audio frame is too large.' }); chunks.push(chunk); }
        return json(response, 200, await wakeword.predict(token, Buffer.concat(chunks)));
      }
      if (request.method === 'GET' && url.pathname === '/api/network') return json(response, 200, await actions.network.check());
      if (request.method === 'GET' && url.pathname === '/api/house-status') return json(response, 200, { homeAssistant: await homeAssistant.status({ checkConnection: true }), microphone: recognition.status(), calendars: await calendar.status(), phone: { configured: false }, personalAuthentication: false });
      if (request.method === 'GET' && url.pathname === '/api/displays') return json(response, 200, { ...await pairing.list(), enabled: Boolean(displayServer?.server.listening), receiverUrl: displayServer?.server.listening ? `http://${displayBind}:${displayServer.server.address().port}` : null });
      if (request.method === 'POST' && url.pathname === '/api/pairing/start') {
        const body = await readJson(request);
        if (!displayServer?.server.listening) return json(response, 409, { error: 'Enable the TV receiver in the local setup file before pairing a TV. See HOUSE-SETUP.md.' });
        return json(response, 200, await pairing.start(requireRoom(body?.room)));
      }
      if (request.method === 'POST' && url.pathname === '/api/displays/revoke') {
        const body = await readJson(request);
        if (typeof body.id !== 'string' || body.id.length > 60) return json(response, 400, { error: 'Choose a paired display.' });
        await pairing.revoke(body.id);
        return json(response, 200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/dismiss-alert') {
        const body = await readJson(request);
        const room = requireRoom(body?.room);
        if (state.get(room).notification?.id === body.id) {
          if (state.get(room).notification.kind === 'reminder') {
            await reminders.remove(room, state.get(room).notification.reminderIds);
            return json(response, 200, { ok: true });
          }
          state.set(room, { ...state.get(room), notification: null }); publish(room);
          syncReminderAlerts();
        }
        return json(response, 200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/transcribe') {
        const room = requireRoom(url.searchParams.get('room'));
        if (request.headers['content-type'] !== 'audio/wav') return json(response, 415, { error: 'Please record microphone audio in Jarvis.' });
        if (active || recognitionActive) return json(response, 409, { error: 'Jarvis is busy. Wait for the current question, then try again.' });
        if (Number(request.headers['content-length']) > MAX_AUDIO_BYTES) return json(response, 413, { error: 'Recordings can be up to 20 seconds.' });
        const controller = new AbortController();
        const job = { room, controller };
        recognitionActive = job;
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        try {
          const chunks = []; let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > MAX_AUDIO_BYTES) throw Object.assign(new Error('Recordings can be up to 20 seconds.'), { status: 413 });
            chunks.push(chunk);
          }
          const audio = decodeMicrophoneWave(Buffer.concat(chunks));
          // Release the voice model before loading recognition on smaller computers.
          speech.close?.();
          const result = await recognition.transcribe({ audio, signal: controller.signal });
          recognition.close?.();
          let speaker;
          if (url.searchParams.get('identify') === '1') {
            speaker = { status: 'unknown', profileId: null, name: null, reason: 'no-enrollments', authorized: false };
            if (await profiles.hasVoices()) {
              if (audio.length < 24000) speaker.reason = 'short-audio';
              else if (!speakerId.status().available) speaker.reason = 'model-unavailable';
              else {
                try { checkSpeakerAudio(audio); const signature = await speakerId.embed({ audio, signal: controller.signal }); speaker = await profiles.identify(signature.embedding); }
                catch (error) { if (controller.signal.aborted) throw error; speaker.reason = 'processing-unavailable'; }
              }
            }
          }
          if (!controller.signal.aborted && !response.destroyed) json(response, 200, { text: result.text, localOnly: true, metrics: result.metrics, ...(speaker ? { speaker, speakerToken: speakerTurns.issue({ room, text: result.text, speaker }) } : {}) });
        } finally {
          if (recognitionActive === job) recognitionActive = null;
          recognition.close?.();
          speakerId.close?.();
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/voices') {
        return json(response, 200, await speech.listVoices());
      }
      if (request.method === 'POST' && url.pathname === '/api/speech-warmup') {
        const body = await readJson(request), info = await speech.listVoices();
        if (typeof body.voice !== 'string' || !info.voices.some(v => v.name === body.voice)) return json(response, 400, { error: 'Choose an installed voice.' });
        void Promise.resolve(speech.warmup?.({ voice: body.voice })).catch(() => {});
        return json(response, 202, { warming: true });
      }
      if (request.method === 'POST' && ['/api/speech', '/api/speech-test', '/api/speech-stream'].includes(url.pathname)) {
        const body = await readJson(request);
        const room = requireRoom(body?.room);
        if (recognitionActive) return json(response, 409, { error: 'Finish the microphone recording before playing a voice.' });
        if (body.voice !== undefined && (typeof body.voice !== 'string' || body.voice.length > 160)) {
          return json(response, 400, { error: 'Choose an installed local voice.' });
        }
        const isTest = url.pathname === '/api/speech-test';
        const isStreaming = url.pathname === '/api/speech-stream';
        const current = state.get(room);
        if (!isTest && (typeof body.requestId !== 'string' || current.requestId !== body.requestId || !(isStreaming ? ['answering', 'ready'] : ['ready']).includes(current.state))) {
          return json(response, 409, { error: 'That answer has already been cleared. Ask another question.' });
        }
        const info = await speech.listVoices();
        if (!info.available) return json(response, 503, { error: 'No local voice is available on this computer.' });
        const preference = isTest ? null : await profiles.get(current.profileId);
        const voice = body.voice || preference?.voice || info.defaultVoice;
        if (!info.voices.some(item => item.name === voice)) return json(response, 400, { error: 'Choose an installed local voice.' });
        const requestId = isTest ? 'voice-test' : body.requestId;
        if (!isTest) scheduleExpiry(room, requestId, 90000);
        const key = JSON.stringify([room, requestId, voice]);
        const controller = new AbortController();
        speechControllers.get(room).add(controller);
        response.on('close', () => { if (!response.writableEnded) controller.abort(new Error('Speech cancelled.')); });
        try {
          if (isStreaming) {
            const timeout = setTimeout(() => controller.abort(new Error('Speech stream timed out.')), 180000); timeout.unref();
            try {
              await streamReplySpeech({ response, requestId, voice, speech, snapshot: () => state.get(room), signal: controller.signal, keepAlive: (delay = 180000) => scheduleExpiry(room, requestId, delay), cache: audio => { speechCache.set(key, { room, audio }); while (speechCache.size > 4) speechCache.delete(speechCache.keys().next().value); } });
            } finally { clearTimeout(timeout); }
            return;
          }
          let audio = speechCache.get(key)?.audio;
          if (!audio) {
            const text = isTest ? "Hello. I'm Jarvis. I'm ready whenever you need me." : current.answer;
            audio = await speech.synthesize({ text, voice, signal: controller.signal });
            if (controller.signal.aborted || (!isTest && (state.get(room).requestId !== requestId || state.get(room).state !== 'ready'))) {
              return json(response, 409, { error: 'That answer has already been cleared. Ask another question.' });
            }
            speechCache.set(key, { room, audio });
            while (speechCache.size > 4) speechCache.delete(speechCache.keys().next().value);
          }
          if (response.destroyed) return;
          if (!isTest) scheduleExpiry(room, requestId, Math.max(22000, Math.min(120000, audio.length / 32000 * 1000 + 12000)));
          response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store', 'X-Jarvis-Voice': encodeURIComponent(voice) });
          response.end(audio);
        } catch (error) {
          if (controller.signal.aborted) {
            if (!response.destroyed) json(response, 409, { error: 'That spoken reply was stopped.' });
          } else { throw error; }
        } finally {
          speechControllers.get(room).delete(controller);
          if (controller.signal.aborted && !isTest && state.get(room).requestId === requestId) scheduleExpiry(room, requestId, 22000);
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        const room = requireRoom(url.searchParams.get('room'));
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        response.write(`data: ${JSON.stringify(state.get(room))}\n\n`);
        clients.get(room).add(response);
        const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': keep-alive\n\n'); }, 15000);
        heartbeat.unref();
        response.on('close', () => { clearInterval(heartbeat); clients.get(room).delete(response); });
        return;
      }
      if (request.method === 'POST' && ['/api/ask', '/api/cancel', '/api/reset'].includes(url.pathname)) {
        const body = await readJson(request);
        const room = requireRoom(body?.room);
        let profile = await profiles.get(body?.profileId);
        if (url.pathname !== '/api/ask') {
          if (body.requestId !== undefined && (typeof body.requestId !== 'string' || body.requestId.length > 100)) return json(response, 400, { error: 'Use a valid request to stop.' });
          if (url.pathname === '/api/cancel' && body.requestId && state.get(room).requestId !== body.requestId) return json(response, 200, { ok: true, stale: true });
          cancel(room, url.pathname === '/api/reset', profile?.id, body.interruption === true && url.pathname === '/api/cancel');
          return json(response, 200, { ok: true });
        }
        if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 600) {
          return json(response, 400, { error: 'Ask a question using 1 to 600 characters.' });
        }
        if (active || recognitionActive) return json(response, 409, { error: 'Jarvis is already answering or recognizing speech. Wait a moment, or stop the current question.' });
        let speaker = speakerTurns.consume({ token: body.speakerToken, room, text: body.question });
        if (speaker?.status === 'matched') {
          profile = await profiles.get(speaker.profileId);
          if (!profile?.voiceEnrolled) { profile = null; speaker = { status: 'unknown', profileId: null, reason: 'no-enrollments', authorized: false }; }
        } else if (speaker?.status === 'unknown') profile = null;
        const requestId = randomUUID();
        const controller = new AbortController();
        invalidateSpeech(room);
        clearTimeout(expiryTimers.get(room));
        expiryTimers.delete(room);
        active = { room, requestId, controller };
        state.set(room, { ...initialState(state.get(room).view, state.get(room).calendarPreview, state.get(room).calendarDraft), state: 'thinking', requestId, profileId: profile?.id || null, notification: state.get(room).notification });
        publish(room);
        json(response, 202, { requestId });
        void generate(room, body.question.trim(), requestId, controller, profile, speaker, ['minimal', 'dashboard'].includes(body.viewContext) ? body.viewContext : null);
        return;
      }
      json(response, 404, { error: 'That page was not found.' });
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'Jarvis hit a problem. Please try again.' });
      else response.end();
    }
  });

  async function shutdown() {
    speakerTurns.close();
    speakerId.close?.();
    await profiles.close();
    wakeword.close();
    await actions.close();
    await reminders.close();
    await chores.close();
    await calendar.close();
    await displayServer?.close();
    await pairing.close();
    recognitionActive?.controller.abort();
    recognition.close?.();
    active?.controller.abort(new Error('cancelled'));
    for (const timer of expiryTimers.values()) clearTimeout(timer);
    for (const room of ROOMS) invalidateSpeech(room);
    speech.close?.();
    for (const roomClients of clients.values()) for (const client of roomClients) client.end();
    await new Promise(resolve => server.close(resolve));
  }
  return { server, displayServer: displayServer?.server, shutdown };
}

if (process.argv[1] && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.JARVIS_PORT || 3210);
  const app = createJarvisServer();
  app.server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Jarvis may already be running; open http://127.0.0.1:${port}` : error.message);
    process.exitCode = 1;
  });
  app.server.listen(port, '127.0.0.1', () => {
    console.log(`Jarvis is ready: http://127.0.0.1:${port}`);
    console.log('Press Enter on the page to ask a question. Press Escape to dismiss.');
    console.log('Local microphone recognition and neural spoken replies are ready. Connect Google Calendar in House setup when ready.');
  });
  if (app.displayServer) {
    const displayPort = Number(process.env.JARVIS_DISPLAY_PORT || 3211);
    app.displayServer.on('error', error => console.error(error.code === 'EADDRINUSE' ? 'The TV receiver port is already in use. Check House setup.' : 'The TV receiver could not bind to the configured local address.'));
    app.displayServer.listen(displayPort, process.env.JARVIS_DISPLAY_BIND, () => console.log(`Room-bound TV receiver: http://${process.env.JARVIS_DISPLAY_BIND}:${displayPort}`));
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.shutdown(); process.exit(0); });
}
