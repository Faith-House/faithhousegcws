import { randomUUID } from 'node:crypto';

export function createToolActivity({ now = Date.now, limit = 200 } = {}) {
  const entries = [], ended = new Set();
  function start(context, tool, source = 'direct') {
    if (context.requestId && ended.has(context.requestId)) return null;
    const entry = { id: randomUUID(), requestId: context.requestId || null, room: context.room, tool, source, status: 'running', startedAt: now(), finishedAt: null, durationMs: null };
    entries.push(entry);
    while (entries.length > limit) { const index = entries.findIndex(item => item.status !== 'running'); entries.splice(index < 0 ? 0 : index, 1); }
    return entry.id;
  }
  function finish(id, status = 'completed') {
    const item = entries.find(entry => entry.id === id);
    if (!item || item.status !== 'running') return;
    if (status === 'ignored') { entries.splice(entries.indexOf(item), 1); return; }
    item.status = status; item.finishedAt = now(); item.durationMs = Math.max(0, item.finishedAt - item.startedAt);
  }
  function event(context, tool, status) {
    if (context.requestId && ended.has(context.requestId)) return;
    if (status === 'running') return start(context, tool, 'planner');
    const existing = entries.findLast(entry => entry.room === context.room && entry.requestId === (context.requestId || null) && entry.tool === tool && entry.status === 'running');
    finish(existing?.id || start(context, tool, 'planner'), status);
  }
  function endRequest(requestId, status) { if (!requestId) return; for (const item of entries) if (item.requestId === requestId) finish(item.id, status); ended.add(requestId); if (ended.size > limit * 2) ended.delete(ended.values().next().value); }
  async function track(context, tool, task, classify = result => result?.ok === false ? 'failed' : result?.needsInterpretation ? 'waiting' : 'completed') {
    const id = start(context, tool);
    try { const result = await task(); finish(id, classify(result)); return result; }
    catch (error) { finish(id, context.signal?.aborted && context.signal.reason?.message === 'cancelled' ? 'cancelled' : 'failed'); throw error; }
  }
  return { start, finish, event, endRequest, track, list: room => entries.filter(item => item.room === room).map(item => ({ ...item })) };
}

export function directToolName(question) {
  const q = question.toLowerCase().replaceAll('’', "'").replace(/^(?:hey\s+)?jarvis[,\s:]*/, '').replace(/^(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/, '').trim();
  if (/\b(?:remind|reminder|reminders)\b/.test(q)) return /^(?:cancel|clear|remove|delete)/.test(q) ? 'cancel_reminder' : /^(?:list|show|read|what)/.test(q) ? 'list_reminders' : 'create_reminder';
  if (/\b(?:timer|timers|countdown)\b/.test(q)) return /^(?:cancel|stop|clear|remove)/.test(q) ? 'cancel_timer' : /^(?:list|show|read|what|how)/.test(q) ? 'list_timers' : 'start_timer';
  if (/\b(?:network|gateway|wi-?fi)\b/.test(q)) return 'check_network';
  if (/\b(?:time is it|current time|the time)\b/.test(q)) return 'get_time';
  if (/\b(?:date|what day|which day)\b/.test(q)) return 'get_date';
  return null;
}
