import { normalizeCommand } from './local-actions.mjs';

const keyFor = c => JSON.stringify([c.room, c.profileId || 'shared']);
export function dateForRequest(question, { now = Date.now(), timeZone = 'America/Chicago' } = {}) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const today = parts.year + '-' + parts.month + '-' + parts.day;
  const explicit = question.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (explicit) { if (!Number.isFinite(Date.parse(explicit)) || new Date(explicit + 'T12:00:00Z').toISOString().slice(0, 10) !== explicit) throw Object.assign(new Error('That date is not valid. Please give a calendar date again.'), { status: 400 }); return explicit; }
  const names = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const name = question.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)?.[1];
  let offset = /\btomorrow\b/i.test(question) ? 1 : /\bnext week\b/i.test(question) ? 7 : 0;
  if (name) { offset = (names.indexOf(name) - new Date(today + 'T12:00:00Z').getUTCDay() + 7) % 7; if (/\bnext\b/i.test(question) && offset === 0) offset = 7; }
  return new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
}
export const isUndoRequest = text => /^(?:undo(?: (?:that|it|(?:the )?last (?:action|thing|request|change)))?|take that back|revert (?:that|the last (?:action|request)))$/.test(normalizeCommand(text));
export function createConversation({ now = Date.now, ttlMs = 300000 } = {}) {
  const sessions = new Map();
  function get(c) { const s = sessions.get(keyFor(c)); if (s && now() - s.at < ttlMs) return s; sessions.delete(keyFor(c)); return null; }
  function prepare(c) {
    const previous = get(c), q = normalizeCommand(c.question);
    let question = c.question;
    // Resolve reference-only follow-ups, never replay a previous instruction.
    const suffix = q.match(/^(?:and |but )?(?:what|how) about (.+)$/)?.[1];
    if (previous && suffix && /^(?:(?:in|for|on) |today|tomorrow|tonight|this week|next week|the week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})/i.test(suffix) && !/\b(?:add|create|delete|remove|assign|turn|set|start|cancel|mark)\b/.test(suffix)) {
      if (previous.topic === 'weather') question = 'What is the weather ' + (/^(?:in|for|on)\b/.test(suffix) ? suffix : 'for ' + suffix) + (previous.place && !/^in\b/.test(suffix) ? ' in ' + previous.place : '');
      if (previous.topic === 'calendar') question = 'Show ' + (previous.demo ? 'demo ' : '') + 'calendar for ' + suffix;
    }
    if (previous?.topic === 'calendar' && /^(?:show|make) (?:it|that) (?:the |a )?(day|week|weekly)(?: view)?$/.test(q)) question = 'Show ' + (previous.demo ? 'demo ' : '') + 'calendar for ' + (/week/.test(q) ? 'this week' : 'today');
    return { question, messages: previous?.messages || [], previous };
  }
  function remember(c, { question = c.question, answer, kind, clarification = false, place = null } = {}) {
    const previous = get(c);
    const topic = /\b(?:weather|forecast|umbrella)\b/i.test(question) ? 'weather' : /\b(?:calendar|schedule|agenda)\b/i.test(question) ? 'calendar' : /\bchore/i.test(question) ? 'chores' : null;
    sessions.set(keyFor(c), { at: now(), topic, place, demo: topic === 'calendar' && /\b(?:demo|sample|example)\b/i.test(question), clarification: clarification || kind === 'clarification', question,
      messages: [...(previous?.messages || []), { role: 'user', content: c.question.slice(0, c.mode === 'coding' ? 24000 : 600) }, { role: 'assistant', content: String(answer || '').slice(0, c.mode === 'coding' ? 24000 : 1000) }].slice(-8) });
  }
  return { prepare, remember, clear: c => sessions.delete(keyFor(c)) };
}

// Undo is short-lived and scoped to the speaker/room. Callbacks are created by
// successful handlers, never supplied by the model or stored as executable text.
export function createUndoHistory({ now = Date.now, ttlMs = 600000 } = {}) {
  const stacks = new Map();
  function record(c, result) {
    if (typeof result?.undo !== 'function' && !result?.undoUnsupported) return;
    const key = keyFor(c), stack = stacks.get(key) || [];
    let group = stack.at(-1);
    if (!group || group.requestId !== c.requestId) { group = { requestId: c.requestId, at: now(), entries: [] }; stack.push(group); }
    group.entries.push({ undo: result.undo || (async () => { throw Object.assign(new Error('The last request includes an action that cannot be undone automatically.'), { status: 409 }); }) }); group.at = now();
    stacks.set(key, stack.slice(-10));
  }
  async function undo(c) {
    const stack = stacks.get(keyFor(c)) || [];
    while (stack.length && now() - stack.at(-1).at >= ttlMs) stack.pop();
    const group = stack.at(-1);
    if (!group) return { ok: false, summary: 'There is no recent supported action to undo for this profile in this room.' };
    let count = 0; const patch = {};
    while (group.entries.length) {
      c.signal?.throwIfAborted();
      try { const result = await group.entries.at(-1).undo(); Object.assign(patch, result?.patch || {}); group.entries.pop(); count++; }
      catch (error) { return { ok: false, summary: (count ? `Undid ${count} step${count === 1 ? '' : 's'}. ` : '') + (error.status ? error.message : 'I could not undo that change. It may have changed since your request.'), patch }; }
    }
    stack.pop();
    return { ok: true, summary: count === 1 ? 'Undid that action.' : `Undid ${count} actions from your last request.`, patch };
  }
  return { record, undo, clear: c => stacks.delete(keyFor(c)) };
}
