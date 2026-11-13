import { commonToolPlan } from '../common-tool-plan.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { createConversation, createUndoHistory, dateForRequest } from '../conversation.mjs';
import { createChores } from '../chores.mjs';
import { createJarvisServer } from '../server.mjs';
import { isCompoundToolRequest } from '../tool-agent.mjs';
const scope = (question = '', extra = {}) => ({ room: 'bedroom-1', profileId: 'cooper', question, ...extra });
const call = (tool, args = {}) => ({ tool, arguments: args });
const plan = (steps, more = false) => ({ steps, question: '', continue: more });

test('follow-ups preserve topic and place, isolate speakers/rooms, expire, and never replay a write', () => {
  let now = 1000; const c = createConversation({ now: () => now });
  c.remember(scope('Weather tomorrow in Austin'), { answer: 'Forecast', place: 'Austin' });
  assert.equal(c.prepare(scope('What about Saturday?')).question, 'What is the weather for saturday in Austin');
  assert.equal(c.prepare(scope('What about dinosaurs?')).question, 'What about dinosaurs?');
  assert.equal(c.prepare(scope('What about Saturday?', { profileId: 'wade' })).messages.length, 0);
  assert.equal(c.prepare(scope('What about Saturday?', { room: 'living-room' })).messages.length, 0);
  now += 300001; assert.equal(c.prepare(scope('What about Saturday?')).messages.length, 0);
  c.remember(scope('Add a chore'), { answer: 'Added.' });
  assert.equal(c.prepare(scope('What about Saturday?')).question, 'What about Saturday?');
  c.remember(scope('Show demo calendar'), { answer: 'Demo.' });
  assert.equal(c.prepare(scope('Make it a week view')).question, 'Show demo calendar for this week');
  assert.equal(dateForRequest('Saturday', { now: Date.parse('2026-11-12T18:00:00Z') }), '2026-11-14');
  c.clear(scope()); assert.equal(c.prepare(scope()).messages.length, 0);
});

test('undo reverses one request in reverse order, scopes history, retains conflicts and expires', async () => {
  let now = 0, steps = []; const u = createUndoHistory({ now: () => now });
  u.record(scope('', { requestId: 'a' }), { undo: async () => { steps.push(1); } });
  u.record(scope('', { requestId: 'a' }), { undo: async () => { steps.push(2); } });
  assert.equal((await u.undo(scope('', { profileId: 'wade' }))).ok, false);
  assert.equal((await u.undo(scope())).ok, true); assert.deepEqual(steps, [2, 1]);
  assert.equal((await u.undo(scope())).ok, false);
  u.record(scope('', { requestId: 'b' }), { undo: async () => { throw Object.assign(Error('Newer edit preserved.'), { status: 409 }); } });
  assert.match((await u.undo(scope())).summary, /Newer edit/);
  now += 600001; assert.equal((await u.undo(scope())).ok, false);
});

test('chore undo removes creations, restores exact fields, supports repeated edits and rejects another edit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-undo-'));
  const chores = createChores({ directory, seed: false, profiles: { list: async () => ({ profiles: [{ id: 'cooper', name: 'Cooper' }] }) } });
  try {
    const initial = await chores.add({ title: 'Test undo' });
    const assigned = await chores.update({ id: initial.id, version: initial.version, assigneeId: 'cooper' });
    await chores.revert({ before: initial, after: assigned });
    await chores.revert({ before: null, after: initial });
    assert.equal((await chores.list()).chores.length, 0);
    const other = await chores.add({ title: 'Do not overwrite me' });
    const done = await chores.update({ id: other.id, version: other.version, done: true });
    const edited = await chores.update({ id: other.id, version: done.version, dueDate: '2026-12-01' });
    await assert.rejects(chores.revert({ before: other, after: done }), /changed since/);
    assert.equal((await chores.list()).chores[0].dueDate, edited.dueDate);
  } finally { await chores.close(); }
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-conversation-'));
  const requests = [];
  const model = http.createServer(async (req, res) => {
    if (req.method === 'GET') return res.end(JSON.stringify({ models: [{ name: 'test' }] }));
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
    const q = body.messages.filter(m => m.role === 'user' && !m.content.startsWith('Completed tool results')).at(-1).content;
    let result;
    if (/User clarified:.*five minutes/i.test(q)) result = plan([call('create_reminder', { title: 'check the oven', seconds: 300 })]);
    else if (/remind.*oven/i.test(q)) result = { steps: [], question: 'When should I remind you to check the oven?', continue: false };
    else if (/two minutes.*add.*chore/i.test(q)) result = plan([call('start_timer', { seconds: 120, label: 'tea' }), call('add_chore', { title: 'Water the plant' }), call('set_view', { view: 'dashboard' })]);
    else if (/inspect|what did i ask/i.test(q)) { res.end(JSON.stringify({ message: { content: 'You asked about a timer.' }, done: true }) + '\n'); return; }
    else result = { steps: [], question: '', continue: false };
    res.end(JSON.stringify({ message: { content: JSON.stringify(result) } }));
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  const app = createJarvisServer({ model: 'test', ollamaUrl: 'http://127.0.0.1:' + model.address().port, displayBind: '', actionsOptions: { dataDirectory: directory }, pairingOptions: { directory }, speech: { listVoices: async () => ({ available: false }), close() {} } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => { await app.shutdown(); await new Promise(r => model.close(r)); });
  async function ask(question) {
    const abort = new AbortController();
    const events = await fetch(base + '/api/events?room=bedroom-1', { signal: abort.signal });
    const accepted = await fetch(base + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: 'bedroom-1', question }) });
    assert.equal(accepted.status, 202); const { requestId } = await accepted.json(); let buffer = '';
    try { for await (const chunk of events.body) {
      buffer += new TextDecoder().decode(chunk); let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!packet.startsWith('data: ')) continue;
        const s = JSON.parse(packet.slice(6)); if (s.requestId === requestId && ['ready', 'error'].includes(s.state)) { assert.equal(s.state, 'ready', s.error); return s; }
      }
    } } finally { abort.abort(); }
  }
  return { ask, requests, json: async endpoint => (await fetch(base + endpoint)).json() };
}

test('a compound request reaches all handlers and undo reverses the full request after a read', async t => {
  assert.equal(isCompoundToolRequest('Set a timer and add a chore'), true);
  assert.equal(isCompoundToolRequest('Show calendar, add a chore, and switch to quiet mode'), true);
  assert.equal(isCompoundToolRequest('Remind me to buy milk and bread in ten minutes'), false);
  const f = await fixture(t);
  const answer = await f.ask('Give me two minutes for tea and add Water the plant as a chore and show the dashboard');
  assert.equal(answer.view, 'dashboard'); assert.equal(answer.toolActivity.length, 3);
  assert.equal((await f.json('/api/dashboard')).timers.timers.length, 1);
  assert.ok((await f.json('/api/chores')).chores.some(c => c.title === 'Water the plant'));
  await f.ask('What time is it?');
  const undone = await f.ask('Undo that'); assert.match(undone.answer, /Undid 3 actions/); assert.equal(undone.view, 'minimal');
  assert.equal((await f.json('/api/dashboard')).timers.timers.length, 0);
  assert.equal((await f.json('/api/chores')).chores.some(c => c.title === 'Water the plant'), false);
  const activity = await f.json('/api/activity?room=bedroom-1'); assert.ok(activity.entries.some(e => e.tool === 'undo_action' && e.status === 'completed'));
});

test('short clarification replies save one reminder and undo removes it; tool turns reach chat history', async t => {
  const f = await fixture(t);
  assert.equal((await f.ask('Remind me to check the oven')).resultKind, 'clarification');
  assert.match((await f.ask('In five minutes')).answer, /Reminder saved/);
  const reminders = await f.json('/api/reminders?room=bedroom-1'); assert.equal(reminders.reminders.length, 1);
  assert.match((await f.ask('Undo that')).answer, /Undid/);
  assert.equal((await f.json('/api/reminders?room=bedroom-1')).reminders.length, 0);
  await f.ask('What time is it?');
  await f.ask('What did I ask you?');
  assert.ok(f.requests.at(-1).messages.some(m => m.role === 'assistant' && /It is/.test(m.content)));
});

test('demo calendar follow-ups change dates and ranges without linking a real calendar', async t => {
  const f = await fixture(t);
  const first = await f.ask('Show the demo calendar'); assert.equal(first.calendarPreview.demo, true);
  const next = await f.ask('What about tomorrow?'); assert.equal(next.calendarPreview.startDate, dateForRequest('tomorrow')); assert.equal(next.calendarPreview.demo, true);
  const week = await f.ask('Make it a week view'); assert.equal(week.calendarPreview.range, 'week'); assert.equal(week.calendarPreview.demo, true);
});


test('common plans keep all clauses, preserve separate durations and do not swallow an unfamiliar command', () => {
 const p=commonToolPlan('Set a timer for two minutes and remind me to check the oven in five minutes and show the dashboard');
 assert.equal(p.steps.length,3);assert.equal(p.steps[0].arguments.seconds,120);assert.equal(p.steps[1].arguments.seconds,300);
 assert.equal(commonToolPlan('Set a timer for two minutes and turn off the lamp'),null);
 assert.equal(commonToolPlan('Remind me to buy milk and bread in ten minutes').steps[0].arguments.title,'buy milk and bread');
 assert.match(commonToolPlan('Remind me to check the oven').question,/When/);
 assert.equal(commonToolPlan('Remind me to check the oven',{clarification:'In five minutes'}).steps[0].arguments.seconds,300);
 assert.equal(commonToolPlan('Show demo calendar today and remind me to check the oven in five minutes').steps[0].arguments.query,'show demo calendar today');
 assert.equal(commonToolPlan('Do not start a timer and show the dashboard'),null);
});
