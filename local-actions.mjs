import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT } from './voice-config.mjs';
import { createNetworkHealth, describeNetwork } from './network-health.mjs';

export function normalizeCommand(question) {
  return question.toLowerCase().replaceAll('’', "'").trim().replace(/[?!.]+$/, '').replace(/^(?:hey\s+)?jarvis[,\s:]*/, '').replace(/^(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/, '').replace(/,?\s+please$/, '').trim();
}
const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, sixty: 60 };
export function timerDuration(text) {
  if (/(?:^|\s)[+-]\s*\d/.test(text)) return null;
  const input = text.trim().replace(/forty[- ]five/g, 'fortyfive').replace(/-/g, ' ');
  const parts = [...input.matchAll(/(\d+(?:\.\d+)?|[a-z]+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)];
  if (!parts.length || input.replace(/(\d+(?:\.\d+)?|[a-z]+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g, '').replace(/\band\b|\s|,/g, '')) return null;
  let seconds = 0;
  for (const part of parts) {
    const number = words[part[1]] ?? Number(part[1]);
    if (!Number.isFinite(number) || number <= 0) return null;
    seconds += number * (/^h/.test(part[2]) ? 3600 : /^m/.test(part[2]) ? 60 : 1);
  }
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 86400 ? Math.round(seconds) : null;
}
export function describeDuration(seconds) {
  seconds = Math.max(1, Math.ceil(seconds));
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${seconds} seconds`;
}

export function createLocalActions({ rooms, onTimer = () => {}, dataDirectory = path.join(APP_ROOT, 'private'), timeZone = process.env.JARVIS_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone, network = createNetworkHealth(), now = Date.now } = {}) {
  const timerFile = path.join(dataDirectory, 'timers.json');
  let timers = [];
  let interval;
  let saving = Promise.resolve();
  let initialization;
  let closed = false;
  let ticking = false;
  let storageError = false;
  let operations = Promise.resolve();
  const serialize = operation => { const result = operations.then(operation); operations = result.catch(() => {}); return result; };
  const validTimer = timer => timer && typeof timer.id === 'string' && rooms.includes(timer.room) && typeof timer.label === 'string' && timer.label.length <= 60 && Number.isFinite(timer.endsAt) && Number.isFinite(timer.createdAt);
  function save() {
    const contents = JSON.stringify(timers, null, 2) + '\n';
    const operation = saving.catch(() => {}).then(async () => {
      await mkdir(dataDirectory, { recursive: true });
      const temporary = timerFile + '.tmp';
      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, timerFile);
    });
    saving = operation;
    return operation;
  }
  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        const stored = JSON.parse(await readFile(timerFile, 'utf8'));
        if (!Array.isArray(stored) || stored.length > 40 || !stored.every(validTimer)) throw new Error('Invalid timer data');
        timers = stored;
      } catch (error) { if (error.code !== 'ENOENT') storageError = true; }
      if (!closed) { interval = setInterval(() => { void tick(); }, 500); interval.unref(); }
    })();
    return initialization;
  }
  async function tick() {
    if (closed || ticking || storageError) return;
    ticking = true;
    try {
      await serialize(async () => {
        const due = timers.filter(timer => timer.endsAt <= now());
        if (!due.length) return;
        const previous = timers;
        timers = timers.filter(timer => timer.endsAt > now());
        try {
          await save();
          if (!closed) for (const timer of due) onTimer({ ...timer, overdue: now() - timer.endsAt > 60000 });
        } catch { timers = previous; }
      });
    }
    finally { ticking = false; }
  }
  async function handleInternal({ room, question }) {
    const command = normalizeCommand(question);
    const date = new Date(now());
    if (/^(?:show|open|display|pull up|bring up|switch to)(?: me)?(?: the| my| our)?(?: jarvis| house| home| central)? dashboard(?: (?:on|for) (?:the |my |this )?(?:tv|television|screen))?$/.test(command)) {
      return { answer: 'Here’s the dashboard.', kind: 'view', view: 'dashboard' };
    }
    if (/^(?:(?:go |switch |return )?back to (?:jarvis|the rings|the minimal view)|return to jarvis|(?:close|hide|dismiss)(?: the)? dashboard|(?:show|switch to|go to|enable)(?: the)? (?:rings|minimal view|quiet (?:mode|view)))$/.test(command)) {
      return { answer: 'Back to Jarvis.', kind: 'view', view: 'minimal' };
    }
    if (/^(?:(?:show|open|display|pull up|bring up|read) (?:me )?(?:my |the )?(?:calendar|schedule|day|week)(?: (?:for )?(?:today|the day|this week|the week))?|what(?:'s| is) on (?:my |the )?(?:calendar|schedule)(?: (?:for )?(?:today|this week))?|what (?:do i have|is happening) (?:going on )?(?:today|this week)|my (?:calendar|schedule) (?:today|this week))$/.test(command)) {
      const week = /\b(?:week|weekly|this week)\b/.test(command);
      return { answer: week ? 'Here’s your calendar for this week.' : 'Here’s your calendar for today.', kind: 'calendar-preview', range: week ? 'week' : 'day' };
    }
    if (/^(?:(?:close|hide|dismiss)(?: my| the)? (?:calendar|schedule|preview)|(?:clear|close) calendar preview|back to (?:the )?rings)$/.test(command)) {
      return { answer: 'Calendar preview closed.', kind: 'calendar-preview', clearCalendar: true };
    }
    if (/^(?:what(?:'s| is) your name|who are you|tell me your name|what (?:do i|should i) call you)$/.test(command)) {
      return { answer: 'I’m Jarvis, your local household assistant.', kind: 'assistant' };
    }
    if (/^(?:what time is it|what(?:'s| is) (?:the )?(?:current )?time|tell me (?:the )?time|show (?:me )?(?:the )?time)$/.test(command)) {
      return { answer: `It is ${new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date)}.`, kind: 'time' };
    }
    if (/^(?:what(?:'s| is) (?:the )?(?:date|day)(?: is it)?(?: today)?|what day is (?:it|today)|tell me (?:the )?(?:date|day)|(?:show )?(?:today's|the) date)$/.test(command)) {
      return { answer: `Today is ${new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date)}.`, kind: 'date' };
    }
    if (/^(?:(?:how|is) (?:is )?(?:my|our|the) (?:wi-?fi|network|internet)(?: (?:working|doing|connection|status|connected|down|up))?|check (?:my|our|the)?\s*(?:wi-?fi|network|internet)(?: connection| status)?|(?:wi-?fi|network|internet) status)$/.test(command)) {
      return { answer: describeNetwork(await network.check()), kind: 'network' };
    }
    if (/^(?:set|start|create)\b.*\btimer\b/.test(command)) {
      await initialize();
      if (storageError) return { ok: false, answer: 'The saved timer file needs attention. I cannot safely save a timer until it is repaired.', kind: 'timer' };
      const match = command.match(/^(?:set|start|create) (?:a |an )?timer (?:for )?(.+?)(?: (?:called|named) (.+))?$/) || command.match(/^(?:set|start|create) (?:a |an )?(.+?) timer(?: (?:called|named) (.+))?$/);
      const duration = match && timerDuration(match[1]);
      if (!duration) return { answer: 'How long should the timer run? Timers can be 1 second to 24 hours.', kind: 'timer', needsInterpretation: true };
      if (timers.filter(timer => timer.room === room).length >= 8) return { answer: 'This room already has eight timers. Cancel one before adding another.', kind: 'timer' };
      const timer = { id: randomUUID(), room, label: match[2]?.trim().slice(0, 60) || '', createdAt: now(), endsAt: now() + duration * 1000 };
      timers.push(timer);
      try { await save(); } catch { timers = timers.filter(item => item.id !== timer.id); return { answer: 'I could not save the timer, so it has not been set.', kind: 'timer' }; }
      return { answer: `${timer.label ? `Your ${timer.label} timer` : 'Your timer'} is set for ${describeDuration(duration)}. Keep Jarvis open for the alert.`, kind: 'timer', timer, undo: () => cancelCreated(timer) };
    }
    if (/^(?:(?:show|list|check) (?:my |our |the )?(?:active )?timers|how much time is left(?: on (?:my |the )?timer)?|(?:my )?timers|timer status)$/.test(command)) {
      await initialize();
      if (storageError) return { ok: false, answer: 'The saved timer file could not be read. I cannot give a reliable timer list.', kind: 'timer' };
      const current = timers.filter(timer => timer.room === room && timer.endsAt > now());
      return { answer: current.length ? current.map((timer, i) => `${timer.label || `Timer ${i + 1}`}: ${describeDuration((timer.endsAt - now()) / 1000)} left.`).join(' ') : 'There are no active timers in this room.', kind: 'timer' };
    }
    if (/^(?:cancel|stop|delete) (?:my |our |the |all )?(?:timers|timer)(?: (?:called|named) (.+))?$/.test(command)) {
      await initialize();
      if (storageError) return { ok: false, answer: 'The saved timer file needs attention. I cannot safely change it.', kind: 'timer' };
      const label = command.match(/(?:called|named) (.+)$/)?.[1];
      const matching = timers.filter(timer => timer.room === room && (!label || timer.label === label));
      if (!matching.length) return { answer: 'There is no matching timer in this room.', kind: 'timer' };
      if (!label && matching.length > 1 && !/\ball\b|\btimers\b/.test(command)) return { answer: 'There is more than one timer. Say “cancel all timers” or name the timer to cancel.', kind: 'timer' };
      const before = timers;
      timers = timers.filter(timer => !matching.includes(timer));
      try { await save(); } catch { timers = before; return { answer: 'I could not save that change. The timers have not been cancelled.', kind: 'timer' }; }
      return { answer: `${matching.length === 1 ? 'Timer' : `${matching.length} timers`} cancelled in this room.`, kind: 'timer', ok: true };
    }
    return null;
  }
  const cancelCreated = timer => serialize(async () => {
    await initialize();
    if (storageError) throw Object.assign(new Error('The saved timer file needs attention.'), { status: 503 });
    const found = timers.find(t => t.id === timer.id && t.room === timer.room && t.endsAt === timer.endsAt && t.endsAt > now());
    if (!found) throw Object.assign(new Error('That timer has already finished or been cancelled.'), { status: 409 });
    const before = timers; timers = timers.filter(t => t.id !== timer.id);
    try { await save(); } catch (error) { timers = before; throw error; }
    return { ok: true };
  });
  const handle = input => serialize(() => handleInternal(input));
  async function close() { closed = true; clearInterval(interval); await operations; await saving.catch(() => {}); }
  const listTimers = () => serialize(async () => {
    await initialize();
    return { available: !storageError, timers: storageError ? [] : timers.filter(timer => timer.endsAt > now()).map(timer => ({ ...timer })) };
  });
  return { handle, initialize, close, tick, network, listTimers };
}
