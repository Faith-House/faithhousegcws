// The local model proposes one known action. Only validated parameters reach
// existing handlers; model prose is never an execution result or a command.
import { normalizeCommand } from './local-actions.mjs';
const actionGroups = { view: ['show_dashboard', 'show_minimal'], timer: ['set_timer', 'list_timers', 'cancel_timer', 'cancel_all_timers'], clock: ['get_time', 'get_date'], network: ['check_network'], calendar: ['show_calendar_day', 'show_calendar_week', 'hide_calendar', 'add_calendar_event'] };
const deviceActions = { turn_on: 'turn on', turn_off: 'turn off', brightness: 'set', media_pause: 'pause', media_play: 'resume', mute: 'mute', unmute: 'unmute', device_status: 'check' };
const candidates = /\b(?:dashboard|controls|panels?|circles|control (?:panel|room)|quiet|rings?|minimal|screen|interface|clutter|timers?|countdowns?|seconds?|minutes?|hours?|time|date|day|week|calendar|schedule|agenda|appointment|event|wi-?fi|network|internet|lights?|lamps?|tv|television|brightness|mute|unmute)\b|^(?:please )?(?:get rid of|put away|go back|bring back|close it|hide it|clear this|open it)\b/i;
export const isCommandCandidate = question => candidates.test(question);
const guarded = question => /\b(?:don't|do not|never|not to|shouldn't|wouldn't)\b|^(?:if|how (?:do|can|would|to)|what (?:does|would|is a)|explain|describe|imagine|suppose)\b/i.test(question.replaceAll('’', "'").trim());
const requestLike = question => /^(?:(?:can|could|would|will)\s+(?:we|you)\s+)?(?:i\s+(?:want|need|would like)|let'?s|show|open|close|hide|switch|go|bring|take|put|get|lose|remove|ditch|make|give|start|stop|cancel|set|check)\b/i.test(normalizeCommand(question));
const cleanLabel = label => typeof label === 'string' && label.length <= 60 && !/[\x00-\x1f\x7f]/.test(label);
function domains(question) {
  const text = normalizeCommand(question), result = [];
  if (/\b(?:calendar|schedule|agenda|appointment|event)\b|\bmy (?:day|week)\b|\bthis week\b/i.test(text)) { result.push('calendar'); return result; }
  if (/\b(?:dashboard|controls|panels?|circles|control (?:panel|room)|quiet|rings?|minimal|screen|interface|clutter)\b|^(?:get rid of (?:it|this)|put (?:it|this) away|go back|bring (?:it|this) back|close it|hide it|clear this|open it)\b/i.test(text)) result.push('view');
  if (/\b(?:timers?|countdowns?|seconds?|minutes?|hours?)\b/i.test(text)) result.push('timer');
  if (/\b(?:wi-?fi|network|internet)\b/i.test(text)) result.push('network');
  if (!result.includes('timer') && /\b(?:time|date|day)\b/i.test(text)) result.push('clock');
  if (!result.includes('view') && /\b(?:lights?|lamps?|tv|television|brightness|mute|unmute)\b/i.test(text)) result.push('device');
  return result;
}
// High-confidence view semantics keep routine screen controls dependable even
// when a very small model picks the opposite direction. Wording stays flexible.
function viewIntent(question, view) {
  const text = normalizeCommand(question);
  if (!requestLike(question) && !/\b(?:i (?:only |just )?want|i(?:'d| would) like|can we|could we)\b/.test(text)) return null;
  const dashboard = /\b(?:dashboard|controls|control room|panels?|clutter)\b/.test(text);
  const minimal = /\b(?:rings?|circles|quiet|minimal|just jarvis)\b/.test(text);
  const hide = /\b(?:close|hide|dismiss|remove|lose|ditch|collapse|declutter|shut|turn off|get rid of|put\b.{0,30}\baway)\b/.test(text);
  const show = /\b(?:show|open|expand|display|pull up|bring up|bring back|go back to|return to|switch|see|want|like|prefer|use)\b/.test(text);
  if (minimal && (show || hide)) return { action: hide && !dashboard ? 'show_dashboard' : 'show_minimal' };
  if (dashboard && hide) return { action: 'show_minimal' };
  if (dashboard && show) return { action: 'show_dashboard' };
  if (/^(?:close it|hide it|clear this|get rid of (?:it|this)|put (?:it|this) away)$/.test(text) && view === 'dashboard') return { action: 'show_minimal' };
  return null;
}

export function directViewIntent(question, view) {
  return !guarded(question) && domains(question).length === 1 && domains(question)[0] === 'view' ? viewIntent(question, view) : null;
}

export function validateIntent(plan, { question, devices = [], now = Date.now(), timeZone = 'America/Chicago' } = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).some(key => !['action', 'seconds', 'label', 'target', 'percent', 'title', 'start', 'end'].includes(key))) return null;
  const groups = domains(question);
  if (!['none', 'clarify'].includes(plan.action) && (groups.length !== 1 || !(groups[0] === 'device' ? Object.keys(deviceActions) : actionGroups[groups[0]] || []).includes(plan.action))) return null;
  if (guarded(question) && !['none', 'clarify'].includes(plan.action)) return null;
  const simple = { show_dashboard: 'Show the dashboard', show_minimal: 'Back to Jarvis', get_time: 'What time is it?', get_date: 'What is the date?', check_network: 'Network status', list_timers: 'List timers' };
  if (plan.action === 'none') return { type: 'none' };
  if (plan.action === 'clarify') return { type: 'clarify' };
  if (plan.action === 'show_calendar_day') return { type: 'calendar-preview', range: 'day' };
  if (plan.action === 'show_calendar_week') return { type: 'calendar-preview', range: 'week' };
  if (plan.action === 'hide_calendar') return { type: 'calendar-clear' };
  if (plan.action === 'add_calendar_event') {
    const start = new Date(plan.start), end = new Date(plan.end);
    if (typeof plan.title !== 'string' || !plan.title.trim() || plan.title.length > 120 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(plan.start) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(plan.end) || !Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || start <= now || end <= start || end - start > 43200000 || start - now > 366 * 86400000 || !/\b(?:add|put|schedule|create|book)\b.*\b(?:calendar|event|meeting|class|appointment)\b/i.test(question)) return null;
    return { type: 'calendar-add', title: plan.title.trim(), start: start.toISOString(), end: end.toISOString(), timeZone };
  }
  if (Object.hasOwn(simple, plan.action)) return { type: 'local', question: simple[plan.action] };
  if (plan.action === 'set_timer') {
    // Never invent a duration for an unspecified timer or an absolute alarm.
    if (!Number.isInteger(plan.seconds) || plan.seconds < 1 || plan.seconds > 86400 || !cleanLabel(plan.label ?? '') || !/\b(?:seconds?|minutes?|hours?)\b/i.test(question) || /\b(?:few|some|at|tomorrow|tonight|o'clock)\b|(?:^|\s)[+-]\s*\d/i.test(question)) return null;
    return { type: 'local', question: `Set a timer for ${plan.seconds} seconds${plan.label ? ` called ${plan.label}` : ''}` };
  }
  if (plan.action === 'cancel_timer') {
    if (!cleanLabel(plan.label ?? '')) return null;
    return { type: 'local', question: `Cancel timer${plan.label ? ` called ${plan.label.toLowerCase()}` : ''}` };
  }
  if (plan.action === 'cancel_all_timers') {
    if (!/\b(?:all|every|timers|countdowns)\b/i.test(question)) return null;
    return { type: 'local', question: 'Cancel all timers' };
  }
  const device = devices.find(item => item.aliases.includes(plan.target));
  const operation = ['mute', 'unmute'].includes(plan.action) ? 'volume_mute' : plan.action === 'device_status' ? 'status' : plan.action;
  if (!Object.hasOwn(deviceActions, plan.action) || !device?.operations.includes(operation)) return null;
  if (plan.action === 'brightness' && (!Number.isInteger(plan.percent) || plan.percent < 0 || plan.percent > 100)) return null;
  return { type: 'device', question: plan.action === 'brightness' ? `Set ${plan.target} to ${plan.percent}%` : plan.action === 'device_status' ? `Check ${plan.target} status` : `${deviceActions[plan.action]} ${plan.target}` };
}

export function createCommandInterpreter({ model, base, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  return {
    async interpret({ question, view = 'minimal', devices = [], timeZone = 'America/Chicago', now = Date.now(), signal }) {
      if (!isCommandCandidate(question) || guarded(question)) return { type: 'none' };
      const groups = domains(question);
      if (groups.length > 1) return { type: 'clarify' };
      const group = groups[0];
      if (!group) return { type: 'none' };
      const viewPlan = group === 'view' && viewIntent(question, view);
      if (viewPlan) return validateIntent(viewPlan, { question, devices }) || { type: 'clarify' };
      if (group === 'calendar') {
        const text = normalizeCommand(question);
        const action = /\b(?:hide|close|dismiss|clear)\b.*\b(?:calendar|schedule|preview)\b/.test(text) ? 'hide_calendar'
          : /\b(?:add|create|schedule|book|put)\b.*\b(?:calendar|event|meeting|class|appointment)\b/.test(text) ? null
          : /\b(?:week|weekly)\b/.test(text) ? 'show_calendar_week'
          : /\b(?:calendar|schedule|agenda)\b/.test(text) && /\b(?:show|open|display|pull up|bring up|read|what(?:'s| is)|check|see|view|on|my)\b/.test(text) ? 'show_calendar_day'
          : /\bmy (?:day|week)\b/.test(text) ? /\bweek\b/.test(text) ? 'show_calendar_week' : 'show_calendar_day'
          : null;
        if (action) return { type: action === 'hide_calendar' ? 'calendar-clear' : 'calendar-preview', ...(action !== 'hide_calendar' ? { range: action.endsWith('_week') ? 'week' : 'day' } : {}) };
      }
      if (group === 'device' && !devices.length) return { type: 'disconnected' };
      const schema = { type: 'object', properties: {
        action: { type: 'string', enum: ['none', 'clarify', ...(group === 'device' ? Object.keys(deviceActions) : actionGroups[group])] },
        ...(group === 'timer' ? { seconds: { type: 'integer' }, label: { type: 'string' } } : {}),
        ...(group === 'device' ? { target: { type: 'string', enum: devices.flatMap(device => device.aliases) }, percent: { type: 'integer' } } : {}),
        ...(group === 'calendar' ? { title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } } : {}),
      }, required: ['action'], additionalProperties: false };
      const examples = {
        view: `"Get this dashboard out of the way" => {"action":"show_minimal"}
"I'd like to see the house control panel" => {"action":"show_dashboard"}
"Bring back the control room" => {"action":"show_dashboard"}
"Go back to just the rings" => {"action":"show_minimal"}
"Switch it back to quiet mode" => {"action":"show_minimal"}
"Close it" when current view is dashboard => {"action":"show_minimal"}
"How does the dashboard work?" => {"action":"none"}`,
        timer: `"Give me a minute and a half for pasta" => {"action":"set_timer","seconds":90,"label":"pasta"}
"Start a countdown" => {"action":"clarify"}
"How long until my timers finish?" => {"action":"list_timers"}
"Get rid of the pasta timer" => {"action":"cancel_timer","label":"pasta"}
"Stop every timer" => {"action":"cancel_all_timers"}`,
        network: `"Is the internet acting up?" => {"action":"check_network"}
"Explain how the internet works" => {"action":"none"}`,
        clock: `"Have you got the time?" => {"action":"get_time"}
"Which day are we on?" => {"action":"get_date"}`,
        device: `Only match a listed device and approved operation. Missing or ambiguous device uses clarify.`,
        calendar: `"Could you put my biology study session on my calendar tomorrow from 3 to 4 PM?" => {"action":"add_calendar_event","title":"Biology study session","start":"<exact future ISO time with offset>","end":"<exact future ISO time with offset>"}
If the date or time is ambiguous, choose clarify.`,
      };
      const definitions = {
        view: 'This application CAN switch its screen. show_dashboard: open/expand/bring back the house controls, control room, dashboard, information panels. show_minimal: close/hide/remove/lose/dismiss/ditch/put away the dashboard or panels, remove clutter, quiet mode, return to just Jarvis or the rings/circles. Choose the requested DESTINATION. The word "back" alone does not mean minimal. Quiet mode does not mute audio or stop listening.',
        timer: 'This application CAN set, list, and cancel room timers. set_timer needs an explicit duration, converted to seconds from 1 to 86400. label is optional. list_timers reads remaining time. cancel_timer removes a named timer, or the only active timer. cancel_all_timers requires a request for all timers. Missing duration uses clarify. Never guess amounts or create an alarm/calendar event.',
        clock: 'get_time reads the current clock. get_date reads today’s day and date.',
        network: 'check_network checks this computer’s live connection. It cannot list router devices.',
        calendar: 'show_calendar_day displays only today’s event titles and times in the quiet Jarvis view, leaving the rings on screen. show_calendar_week shows this week. hide_calendar clears the preview. add_calendar_event creates a draft only. Local current time: ' + new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(now)) + '. For an added event require a concise title and exact ISO 8601 start/end times in the local offset. If the title, date, start, end, or time zone is missing or unclear, choose clarify. Never invent a date, duration, attendee, alarm, or place. The app will ask the user to confirm the exact event before adding it.',
        device: `Only these shared devices exist: ${JSON.stringify(devices)}. Use their exact target alias and approved operation.`,
      };
      const prompt = `Classify the user's intended action. The application will execute it; you are NOT being asked whether you can do it. Return JSON only, never a refusal, explanation, or execution claim.
${definitions[group]}
Polite questions and indirect requests ARE commands: "could you", "can you", "can we", "I want", "I'd like", "for me" do not change the intent. Choose an action for a request to change the screen or use a tool. Use none only for ordinary conversation or explanations of how/why a feature works. Use clarify if the desired action is unclear.
Current view: ${view}.
Examples:
${examples[group]}
Schema: ${JSON.stringify(schema)}`;
      try {
        const response = await fetchImpl(new URL('/api/chat', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs), body: JSON.stringify({ model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: normalizeCommand(question) }], format: schema, stream: false, think: false, keep_alive: '5m', options: { num_ctx: 2048, num_predict: 140, temperature: 0 } }) });
        if (!response.ok) return { type: 'unavailable' };
        const output = await response.json();
        if (output.done_reason === 'length' || typeof output.message?.content !== 'string' || output.message.content.length > 2048) return { type: 'clarify' };
        const intent = validateIntent(JSON.parse(output.message.content), { question, devices, now, timeZone }) || { type: 'clarify' };
        return intent.type === 'none' && requestLike(question) ? { type: 'clarify' } : intent;
      } catch {
        if (signal?.aborted) throw signal.reason;
        return { type: 'unavailable' };
      }
    },
  };
}

export function commandClarification(question) {
  if (/\b(?:dashboard|control panel|quiet|rings?|screen|minimal|clutter)\b/i.test(question)) return 'Would you like the control dashboard or the quiet rings view?';
  if (/\b(?:timer|countdown|minutes?|seconds?|hours?)\b/i.test(question)) return 'Should I set a timer, list your timers, or cancel one? Tell me the duration for a new timer or the name of the timer to cancel.';
  if (/\b(?:calendar|schedule|agenda|appointment|event|meeting|class)\b/i.test(question)) return 'Should I show today, show this week, or add an event? For a new event, tell me its title, date, start time, and end time.';
  return 'Which action would you like me to take?';
}
