import { createCalendarDemo } from './google-calendar.mjs';
import { isSearchRequest } from './web-search.mjs';
import { validateIntent } from './command-intents.mjs';
const str = (maxLength = 160) => ({ type: 'string', minLength: 1, maxLength });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const choice = values => ({ type: 'string', enum: values });
const params = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ok = (summary, data, patch) => ({ ok: true, summary, ...(data ? { data } : {}), ...(patch ? { patch } : {}) });

export function createHouseTools({ actions, reminders, calendar, homeAssistant, systemHealth, webSearch, diagnostics, chores, weather, draftCalendarEvent = () => {} } = {}) {
  return async context => {
    const local = async question => {
      const result = await actions.handle({ room: context.room, question });
      if (result?.kind === 'timer' && /^(?:Set|Cancel)/.test(question) && !result.timer && result.ok !== true) return { ok: false, summary: result.answer };
      return result && !result.needsInterpretation ? ok(result.answer) : { ok: false, summary: result?.answer || 'That local tool could not complete the request.' };
    };
    const home = await homeAssistant.status();
    const tools = [
      { name: 'set_view', description: 'Show household control dashboard or quiet Jarvis rings. Does not mute speech.', parameters: params({ view: choice(['dashboard', 'minimal']) }, ['view']), check: (a, q) => /\b(?:dashboard|controls|control room|panels?|rings?|quiet|screen|interface|clutter|minimal|close it|hide it|go back|bring it back)\b/i.test(q), execute: async a => ok(a.view === 'dashboard' ? 'Here’s the dashboard.' : 'Back to Jarvis.', null, { view: a.view }) },
      { name: 'get_time', description: 'Read the real current time.', parameters: params(), execute: () => local('What time is it?') },
      { name: 'get_date', description: 'Read today’s real day and date.', parameters: params(), execute: () => local('What is the date?') },
      { name: 'start_timer', description: 'Start a room countdown. Requires a duration explicitly supplied by the user; convert it to seconds.', parameters: params({ seconds: integer(1, 86400), label: str(60) }, ['seconds']), check: (a, q) => /\b(?:seconds?|minutes?|hours?)\b/i.test(q) && !/\b(?:few|some|tomorrow|tonight)\b|(?:^|\s)[+-]\s*\d/i.test(q), execute: a => local('Set a timer for ' + a.seconds + ' seconds' + (a.label ? ' called ' + a.label : '')) },
      { name: 'list_timers', description: 'Read active timers in the current room.', parameters: params(), execute: () => local('List timers') },
      { name: 'cancel_timer', description: 'Cancel a named timer or the only timer. all=true requires explicit user request to cancel all timers.', parameters: params({ label: str(60), all: { type: 'boolean' } }), check: (a, q) => !a.all || /\b(?:all|every)\b/i.test(q), execute: a => local(a.all ? 'Cancel all timers' : 'Cancel timer' + (a.label ? ' called ' + a.label.toLowerCase() : '')) },
      { name: 'create_reminder', description: 'Save a one-time reminder in this room. User supplies title and time. Use either seconds (delay) or localTime (YYYY-MM-DDTHH:mm in house timezone). Clarify missing or ambiguous AM/PM.', parameters: params({ title: str(), seconds: integer(1, 2592000), localTime: str(16) }, ['title']), check: (a, q) => Boolean(a.seconds) !== Boolean(a.localTime) && /\b(?:in|at|tomorrow|today|minutes?|seconds?|hours?|days?)\b/i.test(q) && (!a.localTime || !/\bat (?:[1-9]|1[0-2])(?::\d{2})?(?!\d)/i.test(q) || /\b(?:am|pm|morning|evening|afternoon|noon|midnight)\b/i.test(q)), execute: async a => {
        const item = await reminders.add({ room: context.room, title: a.title, ...(a.localTime ? { localTime: a.localTime } : { dueAt: Date.now() + a.seconds * 1000 }) });
        return ok('Reminder saved: ' + item.title + ', ' + new Intl.DateTimeFormat('en-US', { timeZone: context.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.dueAt)) + '. Keep Jarvis running for the alert.', { id: item.id, title: item.title, dueAt: item.dueAt });
      } },
      { name: 'list_reminders', description: 'Read reminders in the current room; provides IDs needed to cancel one.', parameters: params(), execute: async () => {
        const info = await reminders.list(context.room);
        return info.available ? ok(info.reminders.length ? info.reminders.map(item => item.title + ': ' + (item.due ? 'due now' : new Intl.DateTimeFormat('en-US', { timeZone: context.timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.dueAt)))).join('. ') : 'There are no reminders in this room.', { reminders: info.reminders }) : { ok: false, summary: 'The saved reminders need attention.' };
      } },
      { name: 'cancel_reminder', description: 'Clear one reminder in this room. First use list_reminders to get its real ID; never invent an ID.', parameters: params({ id: str(80) }, ['id']), execute: async a => { await reminders.remove(context.room, [a.id]); return ok('That reminder was cleared.'); } },
      { name: 'check_network', description: 'Check the central computer’s gateway connection. This does not list router devices or measure whole-house Wi-Fi.', parameters: params(), execute: () => local('Network status') },
      { name: 'get_system_status', description: 'Read measured CPU, memory and storage for the central computer.', parameters: params(), execute: async () => {
        const info = await systemHealth.read(), memory = Math.round(info.memory.usedBytes / info.memory.totalBytes * 100);
        return ok('Central computer: ' + (info.cpuPercent === null ? 'CPU is still being measured' : 'CPU ' + info.cpuPercent + '%') + ', memory ' + memory + '% used.', info);
      } },
      { name: 'preview_calendar', description: 'Show day/week calendar beside the rings. demo=true shows fictional samples only when the user requests a demo; real preview needs Google connection.', parameters: params({ range: choice(['day', 'week']), demo: { type: 'boolean' } }, ['range']), check: (a, q) => !a.demo || /\b(?:demo|sample|example)\b/i.test(q), execute: async a => {
        if (!a.demo && !(await calendar.status()).connected) return { ok: false, summary: 'Google Calendar is not connected. You can request a demo calendar instead.' };
        const preview = a.demo ? createCalendarDemo({ range: a.range, timeZone: context.timeZone }) : await calendar.preview({ range: a.range, timeZone: context.timeZone });
        return ok(a.demo ? 'Here’s the demo calendar with fictional events.' : 'Here’s your calendar preview.', null, { calendarPreview: preview, view: 'minimal' });
      } },
      { name: 'hide_calendar', description: 'Close only the calendar preview and keep the quiet rings.', parameters: params(), execute: async () => ok('Calendar preview closed.', null, { calendarPreview: null, view: 'minimal' }) },
      { name: 'draft_calendar_event', description: 'Prepare a Google Calendar event for user confirmation. Requires title and exact ISO start/end with timezone offset supplied from clear user details. Never adds it directly.', parameters: params({ title: str(120), start: str(40), end: str(40) }, ['title', 'start', 'end']), check: (a, q) => Boolean(validateIntent({ action: 'add_calendar_event', ...a }, { question: q, timeZone: context.timeZone })), execute: async a => {
        if (!(await calendar.status()).connected) return { ok: false, summary: 'Connect Google Calendar in House setup first.' };
        draftCalendarEvent(context.room, a);
        const time = new Intl.DateTimeFormat('en-US', { timeZone: context.timeZone, dateStyle: 'medium', timeStyle: 'short' });
        return ok('Add “' + a.title + '” from ' + time.format(new Date(a.start)) + ' to ' + time.format(new Date(a.end)) + '? Say “confirm” to add it, or “cancel” to discard.', null, { calendarDraft: a, calendarPreview: null });
      } },
      { name: 'list_devices', description: 'Read currently configured shared device aliases and approved operations.', parameters: params(), execute: async () => ok(home.configured ? home.exposedDevices.length ? 'Approved shared devices: ' + home.exposedDevices.map(d => d.label).join(', ') + '.' : 'No shared devices have been approved yet.' : 'Home Assistant is not connected yet.', { configured: home.configured, devices: home.exposedDevices }) },
    ];
    if (weather) tools.push({ name: 'get_weather', description: 'Read Open-Meteo current weather, today/tomorrow or seven-day forecast for the saved home city or a city explicitly requested. Does not use search snippets; no location is guessed.', terminal: true, parameters: params(), execute: () => weather.answer(context.question, { signal: context.signal }) });
    if (chores) {
      const roster = (await chores.list()).profiles;
      const assigned = (a, q) => !a.assigneeId || roster.some(p => p.id === a.assigneeId && (q.toLowerCase().includes(p.name.toLowerCase()) || a.assigneeId === context.profileId && /\bme\b/i.test(q)));
      tools.push(
        { name: 'list_chores', description: 'Read the shared household chore list with actual IDs, titles, assignments, due dates and completion state. Read before updating a chore; do not invent IDs.', parameters: params(), execute: async () => { const info = await chores.list(); return info.available ? ok(info.chores.filter(i => !i.done).slice(0, 8).map(i => i.title + (i.assigneeId ? ', assigned to ' + (info.profiles.find(p => p.id === i.assigneeId)?.name || 'a former housemate') : ', unassigned')).join('. ') || 'There are no open household chores.', { chores: info.chores, profiles: info.profiles, today: info.today }) : { ok: false, summary: 'The saved chores file needs attention.' }; } },
        { name: 'add_chore', description: 'Add a household chore. Title required. Assignment optional; use only a housemate explicitly named by the user, or selected profile for me. No guessed assignments/deadlines.', parameters: params({ title: str(120), assigneeId: choice(roster.map(p => p.id)), dueDate: str(10) }, ['title']), check: (a,q) => /\b(?:add|create|put|new|need)\b/i.test(q) && assigned(a,q) && (!a.dueDate || /\b(?:today|tomorrow|\d{4}-\d{2}-\d{2})\b/i.test(q)), execute: async a => { const item = await chores.add(a); return ok('Added ' + item.title + ' to the household chores.'); } },
        { name: 'set_chore_status', description: 'Mark an existing chore done or reopen it. First read list_chores for its real ID and version. Never claim completion unless the user explicitly says they finished it or asks to mark it done.', parameters: params({ id: str(80), version: integer(1, 1000000), done: { type: 'boolean' } }, ['id','version','done']), check: (a,q) => a.done ? /\b(?:done|did|finished|complete|completed|mark|cleaned|washed|took out)\b/i.test(q) && !/\b(?:not done|haven.t|didn.t|don.t|do not)\b/i.test(q) : /\b(?:reopen|undo)\b|\bmark\b.*\bnot done\b/i.test(q), execute: async a => { const item = await chores.update(a); return ok(item.title + (item.done ? ' marked complete.' : ' reopened.')); } },
        { name: 'assign_chore', description: 'Assign a chore to an explicitly named housemate or to the selected profile for me. First read list_chores for the actual ID and version.', parameters: params({ id: str(80), version: integer(1,1000000), assigneeId: choice(roster.map(p => p.id)) }, ['id','version','assigneeId']), check: (a,q) => assigned(a,q) && /\b(?:assign|give|take|put|responsible)\b/i.test(q), execute: async a => { const item = await chores.update(a); return ok('Assigned ' + item.title + ' to ' + roster.find(p => p.id === item.assigneeId).name + '.'); } }
      );
    }
    if (diagnostics) tools.push({ name: 'diagnose_connections', description: 'Check Jarvis AI, local voice models, network, internet, search, TV receiver and configured services. Read-only; does not operate devices or change settings.', parameters: params(), execute: async () => { const report = await diagnostics.run(); return ok(report.summary, { checkedAt: report.checkedAt, issues: report.issues }); } });
    if (webSearch?.status().enabled) tools.push({
      name: 'search_web', description: 'Search public internet information and show sources. Returns snippet-based local summary; no full-page reading. Standalone terminal action, never combine with household changes.', terminal: true,
      parameters: params({ query: str(600) }, ['query']), check: (_a, q) => isSearchRequest(q),
      execute: (_a) => webSearch.answer(context.question, { signal: context.signal }),
    });
    if (home.configured && home.exposedDevices.length) tools.push({
      name: 'control_device', description: 'Control only a listed shared device. Available aliases and operations: ' + JSON.stringify(home.exposedDevices),
      parameters: params({ target: choice(home.exposedDevices.flatMap(d => d.aliases)), operation: choice(['turn_on', 'turn_off', 'brightness', 'media_pause', 'media_play', 'mute', 'unmute', 'status']), percent: integer(0, 100) }, ['target', 'operation']),
      check: a => {
        const device = home.exposedDevices.find(d => d.aliases.includes(a.target));
        return Boolean(device?.operations.includes(['mute', 'unmute'].includes(a.operation) ? 'volume_mute' : a.operation)) && (a.operation !== 'brightness' || Number.isInteger(a.percent));
      },
      execute: async a => {
        const commands = { turn_on: 'Turn on ', turn_off: 'Turn off ', media_pause: 'Pause ', media_play: 'Resume ', mute: 'Mute ', unmute: 'Unmute ', status: 'Check ' };
        const question = a.operation === 'brightness' ? 'Set ' + a.target + ' to ' + a.percent + '%' : commands[a.operation] + a.target + (a.operation === 'status' ? ' status' : '');
        const result = await homeAssistant.handle({ room: context.room, question, signal: context.signal });
        return { ok: result?.ok === true, summary: result?.answer || 'No device action was confirmed.' };
      },
    });
    const reads = new Set(['get_time', 'get_date', 'list_timers', 'list_reminders', 'check_network', 'get_system_status', 'list_devices', 'search_web', 'diagnose_connections', 'list_chores', 'get_weather']);
    return tools.map(tool => ({ ...tool, readOnly: reads.has(tool.name) }));
  };
}
