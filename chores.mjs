import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT } from './voice-config.mjs';

const starters = ['Take out the trash', 'Take out the recycling', 'Wash the dishes', 'Wipe kitchen counters', 'Clean the stovetop', 'Vacuum shared spaces', 'Clean the bathroom', 'Mop the kitchen floor'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const validChoreDate = value => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value);
export function householdDate(instant, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return p.year + '-' + p.month + '-' + p.day;
}
const cleanTitle = title => {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 120 || /[\x00-\x1f\x7f]/.test(title)) throw fail('Give the chore a title of 1 to 120 characters.');
  return title.trim();
};
export function createChores({ directory = path.join(APP_ROOT, 'private'), profiles, now = Date.now, timeZone = process.env.JARVIS_TIMEZONE || 'America/Chicago', seed = true } = {}) {
  const file = path.join(directory, 'chores.json');
  let items = [], initialized, unavailable = false, chain = Promise.resolve();
  const serial = task => { const pending = chain.then(task); chain = pending.catch(() => {}); return pending; };
  const valid = item => item && typeof item.id === 'string' && item.id.length <= 80 && typeof item.title === 'string' && item.title === cleanTitle(item.title) && (item.assigneeId === null || typeof item.assigneeId === 'string') && validChoreDate(item.dueDate) && typeof item.done === 'boolean' && Number.isFinite(item.createdAt) && Number.isFinite(item.updatedAt) && (item.completedAt === null || Number.isFinite(item.completedAt)) && Number.isInteger(item.version) && item.version > 0;
  async function persist(next) { await mkdir(directory, { recursive: true }); await writeFile(file + '.tmp', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 }); await rename(file + '.tmp', file); items = next; }
  function initialize() {
    if (!initialized) initialized = (async () => {
      try { const data = JSON.parse(await readFile(file, 'utf8')); if (!Array.isArray(data) || data.length > 100 || !data.every(valid) || new Set(data.map(i => i.id)).size !== data.length) throw Error('Invalid chores'); items = data; }
      catch (error) {
        if (error.code !== 'ENOENT') { unavailable = true; return; }
        if (seed) { const stamp = now(); try { await persist(starters.map(title => ({ id: randomUUID(), title, assigneeId: null, dueDate: null, done: false, completedAt: null, createdAt: stamp, updatedAt: stamp, version: 1 }))); } catch { unavailable = true; } }
      }
    })();
    return initialized;
  }
  async function ready() { await initialize(); if (unavailable) throw fail('The saved chores file needs attention. No chores have been changed.', 503); }
  const people = async () => (await profiles.list()).profiles.map(({ id, name }) => ({ id, name }));
  async function assignee(id) { if (id !== null && !(await people()).some(p => p.id === id)) throw fail('Choose one of the current housemates or leave this chore unassigned.'); return id; }
  const snapshot = async () => { const today = householdDate(now(), timeZone); return { available: !unavailable, timeZone, today, profiles: await people(), chores: unavailable ? [] : items.map(i => ({ ...i, overdue: !i.done && Boolean(i.dueDate && i.dueDate < today) })).sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt - b.createdAt) }; };
  async function list() { await initialize(); await chain; return snapshot(); }
  const add = input => serial(async () => {
    await ready(); if (!input || Object.keys(input).some(k => !['title','assigneeId','dueDate'].includes(k))) throw fail('That chore contains unsupported fields.'); const title = cleanTitle(input.title), assigneeId = await assignee(input.assigneeId ?? null), dueDate = input.dueDate ?? null;
    if (!validChoreDate(dueDate)) throw fail('Choose a valid due date.');
    if (items.length >= 100) throw fail('The household list has reached its 100-chore limit.');
    if (items.some(i => !i.done && i.title.toLowerCase() === title.toLowerCase())) throw fail('An open chore already has that title. Update the existing chore instead.');
    const stamp = now(), item = { id: randomUUID(), title, assigneeId, dueDate, done: false, completedAt: null, createdAt: stamp, updatedAt: stamp, version: 1 };
    await persist([...items, item]); return { ...item };
  });
  const update = input => serial(async () => {
    await ready(); if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Choose a chore to update.'); const existing = items.find(i => i.id === input.id);
    if (!existing) throw fail('That chore is no longer on the list.', 404);
    if (!Number.isInteger(input.version) || input.version !== existing.version) throw fail('This chore changed in another screen. Refresh and try again.', 409);
    if (Object.keys(input).some(k => !['id', 'version', 'title', 'assigneeId', 'dueDate', 'done'].includes(k))) throw fail('That chore update contains unsupported fields.');
    const next = { ...existing };
    if (Object.hasOwn(input, 'title')) next.title = cleanTitle(input.title);
    if (Object.hasOwn(input, 'assigneeId')) next.assigneeId = await assignee(input.assigneeId);
    if (Object.hasOwn(input, 'dueDate')) { if (!validChoreDate(input.dueDate)) throw fail('Choose a valid due date.'); next.dueDate = input.dueDate; }
    if (Object.hasOwn(input, 'done')) { if (typeof input.done !== 'boolean') throw fail('Choose whether the chore is done.'); next.done = input.done; next.completedAt = next.done ? existing.completedAt ?? now() : null; }
    if (!next.done && items.some(i => i.id !== next.id && !i.done && i.title.toLowerCase() === next.title.toLowerCase())) throw fail('Another open chore already has that title.');
    next.updatedAt = now(); next.version++;
    await persist(items.map(i => i.id === next.id ? next : i)); return { ...next };
  });
  const revertedVersions = new Map();
  const revert = ({ before, after }) => serial(async () => {
    await ready();
    const current = items.find(i => i.id === after.id);
    if (!current || current.version !== (revertedVersions.get(after.id + ':' + after.version) ?? after.version)) throw fail('That chore has changed since your request. I left the newer changes in place.', 409);
    if (before && !valid(before)) throw fail('The original chore could not be restored.', 409);
    const restored = before ? { ...before, version: current.version + 1, updatedAt: now() } : null;
    await persist(restored ? items.map(i => i.id === current.id ? restored : i) : items.filter(i => i.id !== current.id));
    if (before) revertedVersions.set(before.id + ':' + before.version, restored.version);
    if (revertedVersions.size > 100) revertedVersions.delete(revertedVersions.keys().next().value);
    return { ok: true };
  });
  async function handle(question, profileId) {
    const q = question.trim().replace(/^(?:hey\s+)?jarvis[,\s:]*/i, '').replace(/^(?:please\s+)?(?:(?:can|could|would) you\s+)?/i, '').replace(/[?.!]+$/, '');
    if (/^(?:(?:show|list|read|check|open)(?: me)? (?:the |our |my )?(?:household )?(?:chores|chore list)|what (?:are |are on )?(?:the |our |my )?(?:chores|chore list))$/i.test(q)) {
      const info = await list(); if (!info.available) return { ok: false, summary: 'The saved chores file needs attention. Open Household chores to check it.' };
      if (/\bmy\b/i.test(q) && !profileId) return { needsInterpretation: true, summary: 'Choose your roommate profile first, or ask for the household chore list.' };
      const visible = info.chores.filter(i => !i.done && (!/\bmy\b/i.test(q) || i.assigneeId === profileId));
      return { ok: true, summary: visible.length ? visible.map(i => i.title + (i.assigneeId ? ', assigned to ' + (info.profiles.find(p => p.id === i.assigneeId)?.name || 'a former housemate') : ', unassigned') + (i.dueDate ? ', due ' + i.dueDate : '')).slice(0, 8).join('. ') + (visible.length > 8 ? '. More chores are on the household list.' : '.') : 'There are no open chores' + (/\bmy\b/i.test(q) ? ' assigned to this profile.' : '.') };
    }
    const addMatch = q.match(/^(?:add|create) (.+?) (?:to (?:the |our )?(?:household )?chore list|as a chore)$/i);
    if (addMatch) { const item = await add({ title: addMatch[1] }); return { ok: true, summary: 'Added ' + item.title + ' to the household chores. It is unassigned.', undo: () => revert({ before: null, after: item }) }; }
    const doneMatch = q.match(/^(?:mark|complete|finish) (?:the )?chore (.+?)(?: (?:as )?(?:done|complete|finished))?$/i);
    if (doneMatch) {
      const info = await list(), title = doneMatch[1].toLowerCase();
      if (!info.available) return { ok: false, summary: 'The saved chores file needs attention. No chore was changed.' };
      const found = info.chores.filter(i => i.title.toLowerCase() === title);
      if (found.length !== 1) return { needsInterpretation: true, summary: 'Which chore? Use its title from the household chore list.' };
      const item = await update({ id: found[0].id, version: found[0].version, done: true }); return { ok: true, summary: 'Marked ' + item.title + ' complete.', undo: () => revert({ before: found[0], after: item }) };
    }
    return null;
  }
  return { initialize, list, add, update, revert, handle, close: async () => { await initialized; await chain; } };
}
