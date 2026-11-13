import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT } from './voice-config.mjs';
import { normalizeCommand } from './local-actions.mjs';

const MAX_DELAY = 30 * 86400000;
const fail = message => Object.assign(new Error(message), { status: 400 });
const components = (instant, zone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
const wallValue = p => Date.UTC(p.year, p.month - 1, p.day, p.hour || 0, p.minute || 0, p.second || 0);
const dateString = p => p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');

// Resolve the selected house time, rejecting nonexistent or repeated DST times.
export function reminderTime(local, timeZone = 'America/Chicago') {
  const match = typeof local === 'string' && local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw fail('Choose a date and time for the reminder.');
  const [, y, m, d, h, n] = match.map(Number);
  const wall = Date.UTC(y, m - 1, d, h, n);
  if (new Date(wall).toISOString().slice(0, 16) !== local) throw fail('That date or time is not valid.');
  const matches = new Set();
  for (const delta of [-36, 0, 36]) {
    const probe = wall + delta * 3600000;
    const candidate = wall - (wallValue(components(probe, timeZone)) - probe);
    if (wallValue(components(candidate, timeZone)) === wall) matches.add(candidate);
  }
  if (matches.size !== 1) throw fail('That time is skipped or repeated by a clock change. Choose another time.');
  return [...matches][0];
}

function duration(text) {
  const numbers = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, sixty: 60 };
  const pattern = /(\d+(?:\.\d+)?|[a-z]+)\s+(seconds?|minutes?|hours?|days?|weeks?)\b/g;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length || text.replace(pattern, '').replace(/\band\b|[\s,]/g, '')) return null;
  let total = 0;
  for (const [, count, unit] of matches) {
    const value = numbers[count] ?? Number(count);
    if (!Number.isFinite(value) || value <= 0) return null;
    total += value * ({ s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[unit[0]]);
  }
  return total >= 1000 && total <= MAX_DELAY ? Math.round(total) : null;
}

function parseSchedule(text, now, timeZone) {
  if (text.startsWith('in ')) {
    const delay = duration(text.slice(3));
    if (!delay) throw fail('Give a duration from one second to 30 days, such as “in twenty minutes.”');
    return now + delay;
  }
  const match = text.match(/^(?:(today|tomorrow)|on (\d{4}-\d{2}-\d{2}))? ?at (\d{1,2})(?::(\d{2}))? ?(am|pm)?$/);
  if (!match) throw fail('Tell me when: for example, “tomorrow at 7 PM” or “in twenty minutes.”');
  let hour = Number(match[3]), minute = Number(match[4] || 0);
  if (minute > 59 || hour > 23 || (match[5] && (hour < 1 || hour > 12))) throw fail('That time is not valid.');
  if (!match[5] && hour >= 1 && hour <= 12) throw fail('Please say AM or PM so I use the correct time.');
  if (match[5]) hour = hour % 12 + (match[5] === 'pm' ? 12 : 0);
  let date = match[2] || dateString(components(now, timeZone));
  if (match[1] === 'tomorrow') date = new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  const due = reminderTime(date + 'T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0'), timeZone);
  if (due <= now) throw fail('That time has already passed. Give a future date and time.');
  return due;
}

export function createReminders({ rooms, directory = path.join(APP_ROOT, 'private'), timeZone = process.env.JARVIS_TIMEZONE || 'America/Chicago', now = Date.now, onChange = () => {} } = {}) {
  const file = path.join(directory, 'reminders.json');
  let items = [], initialized, interval, closed = false, unavailable = false, chain = Promise.resolve();
  const serial = fn => { const promise = chain.then(fn); chain = promise.catch(() => {}); return promise; };
  const valid = item => item && typeof item.id === 'string' && rooms.includes(item.room) && typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 160 && Number.isFinite(item.dueAt) && Number.isFinite(item.createdAt);
  const snapshot = () => ({ available: !unavailable, timeZone, now: now(), reminders: unavailable ? [] : items.map(item => ({ ...item, due: item.dueAt <= now() })).sort((a, b) => a.dueAt - b.dueAt) });
  const notify = () => { if (!closed) onChange(snapshot()); };
  async function initialize() {
    if (!initialized) initialized = (async () => {
      try { const data = JSON.parse(await readFile(file, 'utf8')); if (!Array.isArray(data) || data.length > 100 || !data.every(valid)) throw new Error('Invalid reminders'); items = data; }
      catch (error) { if (error.code !== 'ENOENT') unavailable = true; }
      if (!closed) { interval = setInterval(notify, 1000); interval.unref(); notify(); }
    })();
    return initialized;
  }
  async function persist(next) {
    await mkdir(directory, { recursive: true });
    const temporary = file + '.tmp';
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, file);
    items = next; notify();
  }
  function requireRoom(room) { if (!rooms.includes(room)) throw fail('Choose a valid room.'); }
  async function ready() { await initialize(); if (unavailable) throw Object.assign(new Error('The saved reminders need attention. No reminders have been changed.'), { status: 503 }); }
  const add = input => serial(async () => {
    await ready(); requireRoom(input.room);
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const dueAt = input.localTime ? reminderTime(input.localTime, timeZone) : input.dueAt;
    if (!title || title.length > 160 || /[\x00-\x1f\x7f]/.test(title)) throw fail('Give the reminder a short title, up to 160 characters.');
    if (!Number.isFinite(dueAt) || dueAt <= now() || dueAt - now() > MAX_DELAY) throw fail('Choose a future time within the next 30 days.');
    if (items.filter(item => item.room === input.room).length >= 20) throw fail('This room already has 20 reminders. Clear one before adding another.');
    const item = { id: randomUUID(), room: input.room, title, dueAt, createdAt: now() };
    await persist([...items, item]); return item;
  });
  const remove = (room, ids) => serial(async () => {
    await ready(); requireRoom(room);
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) throw fail('Choose a reminder to clear.');
    const next = items.filter(item => item.room !== room || !ids.includes(item.id));
    if (next.length === items.length) throw fail('That reminder is no longer in this room.');
    await persist(next); return snapshot();
  });
  const list = async room => { await initialize(); await chain; if (room) requireRoom(room); const result = snapshot(); if (room) result.reminders = result.reminders.filter(item => item.room === room); return result; };
  const describe = item => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(item.dueAt));
  async function handle({ room, question }) {
    const text = normalizeCommand(question).replace(/^i(?:'d| would) like you to |^i (?:want|need) you to /, '');
    if (/^(?:show|list|read|check)(?: me)? (?:my |the |our )?(?:active )?reminders$|^what (?:are my reminders|reminders do i have)$/.test(text)) {
      const info = await list(room);
      return { kind: 'reminder', ok: info.available, answer: !info.available ? 'The saved reminders need attention.' : !info.reminders.length ? 'There are no reminders in this room.' : info.reminders.map(item => item.title + ' — ' + (item.due ? 'due now' : describe(item))).join('. ') };
    }
    if (/^(?:cancel|delete|remove|clear) (?:my |the |our )?reminder(?: (?:to|called|named))? (.+)$/.test(text)) {
      const title = text.match(/^.*?reminder(?: (?:to|called|named))? (.+)$/)[1];
      const info = await list(room), matches = info.reminders.filter(item => item.title.toLowerCase() === title);
      if (matches.length !== 1) return { kind: 'reminder', ok: false, answer: matches.length ? 'There are several reminders with that title. Choose one on the Reminders page.' : 'I could not find that reminder in this room.' };
      await remove(room, [matches[0].id]); return { kind: 'reminder', ok: true, answer: 'Reminder cancelled: ' + matches[0].title + '.' };
    }
    const prefix = /^(?:remind me|(?:set|create|add) (?:a )?reminder(?: for me)?)\b/;
    if (!prefix.test(text)) return null;
    const body = text.replace(prefix, '').trim();
    const after = body.match(/^to (.+?) ((?:in |(?:(?:today|tomorrow|on \d{4}-\d{2}-\d{2}) )?at ).+)$/);
    const before = body.match(/^((?:in |(?:(?:today|tomorrow|on \d{4}-\d{2}-\d{2}) )?at ).+?) to (.+)$/);
    if (!after && !before) return { kind: 'reminder', needsInterpretation: true, answer: 'What should I remind you about, and when? For example: “Remind me to take out the trash tomorrow at 7 PM.”' };
    try {
      const title = after ? after[1] : before[2], schedule = after ? after[2] : before[1];
      const item = await add({ room, title, dueAt: parseSchedule(schedule, now(), timeZone) });
      return { kind: 'reminder', answer: 'I’ll remind this room to ' + item.title + ' on ' + describe(item) + '. Keep Jarvis running for the alert.', reminder: item, undo: () => remove(room, [item.id]) };
    } catch (error) { return { kind: 'reminder', needsInterpretation: error.status === 400, answer: error.status ? error.message : 'I could not save the reminder. It has not been set.' }; }
  }
  async function close() { closed = true; clearInterval(interval); await initialized; await chain; }
  return { initialize, add, remove, list, handle, close, tick: notify };
}
