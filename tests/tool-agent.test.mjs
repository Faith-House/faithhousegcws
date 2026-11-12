import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { createToolAgent, validateArguments, explicitDurations } from '../tool-agent.mjs';
import { createJarvisServer } from '../server.mjs';
import { createHouseTools } from '../house-tools.mjs';
const plan = (steps, more = false) => ({ status: 'execute', steps, question: '', continue: more });
const call = (tool, args = {}) => ({ tool, arguments: args });
const answer = data => ({ ok: true, json: async () => ({ message: { content: JSON.stringify(data) } }) });
const context = question => ({ room: 'bedroom-1', profileId: 'cooper', question, view: 'minimal', timeZone: 'America/Chicago' });
const parameter = { type: 'object', properties: { seconds: { type: 'integer', minimum: 1, maximum: 86400 } }, required: ['seconds'] };

test('device tool keeps the approved alias/operation limits and propagates unconfirmed results', async () => {
  const factory = createHouseTools({ homeAssistant: { status: async () => ({ configured: true, exposedDevices: [{ label: 'Desk lamp', aliases: ['desk lamp'], operations: ['brightness'] }] }), handle: async () => ({ ok: false, answer: 'Device did not confirm.' }) } });
  const tool = (await factory(context('Dim the desk lamp'))).find(tool => tool.name === 'control_device');
  assert.equal(validateArguments({ target: 'private lock', operation: 'turn_on' }, tool.parameters), false);
  assert.equal(tool.check({ target: 'desk lamp', operation: 'turn_off' }), false);
  assert.equal(validateArguments({ target: 'desk lamp', operation: 'brightness', percent: 150 }, tool.parameters), false);
  const result = await tool.execute({ target: 'desk lamp', operation: 'brightness', percent: 30 });
  assert.equal(result.ok, false); assert.match(result.summary, /did not confirm/);
});

test('model unit mistakes are corrected only from an explicit duration', async () => {
  assert.deepEqual(explicitDurations('in ten minutes'), [600]);
  assert.ok(explicitDurations('one hour and thirty minutes').includes(5400));
  let seconds;
  const agent = createToolAgent({ model: 'test', base: 'http://127.0.0.1', tools: async () => [{ name: 'start_timer', description: 'Timer', parameters: parameter, execute: async a => { seconds = a.seconds; return { ok: true, summary: 'Timer set.' }; } }], fetchImpl: async () => answer(plan([call('start_timer', { seconds: 2 })])) });
  await agent.run(context('Give me two minutes for tea')); assert.equal(seconds, 120);
  seconds = null;
  assert.equal((await agent.run(context('Start a countdown'))).clarification, true); assert.equal(seconds, null);
});

test('conditional changes must observe a read result before any write', async () => {
  let calls = 0, writes = 0;
  const agent = createToolAgent({ model: 'test', base: 'http://127.0.0.1', tools: async () => [
    { name: 'inspect', description: 'Read', readOnly: true, parameters: { properties: {} }, execute: async () => ({ ok: true, summary: 'Memory is low.', data: { needsChange: false } }) },
    { name: 'adjust', description: 'Write', parameters: { properties: {} }, execute: async () => { writes++; return { ok: true, summary: 'Changed.' }; } },
  ], fetchImpl: async () => answer(++calls === 1 ? plan([call('inspect'), call('adjust')]) : { status: 'chat', steps: [], question: '', continue: false }) });
  const result = await agent.run(context('Check and adjust it if needed'));
  assert.equal(writes, 0); assert.match(result.answer, /Memory is low/); assert.equal(calls, 2);
});

test('a whole batch is validated before side effects; unknown tools and arguments never run', async () => {
  let writes = 0, response = plan([call('start_timer', { seconds: 20 }), call('shell', { command: 'anything' })]);
  const agent = createToolAgent({ model: 'test', base: 'http://127.0.0.1', tools: async () => [{ name: 'start_timer', description: 'Timer', parameters: parameter, execute: async () => { writes++; return { ok: true, summary: 'Timer set.' }; } }], fetchImpl: async () => answer(response) });
  assert.equal((await agent.run(context('Set a timer and show controls'))).clarification, true); assert.equal(writes, 0);
  response = plan([call('start_timer', { seconds: 20, room: 'bedroom-2' })]);
  await agent.run(context('Set a timer')); assert.equal(writes, 0);
  assert.equal(validateArguments({ seconds: -20 }, parameter), false);
});

test('the planner can observe results then choose a different next action without repeating a write', async () => {
  let rounds = 0, reads = 0, writes = 0;
  const agent = createToolAgent({ model: 'test', base: 'http://127.0.0.1', tools: async () => [
    { name: 'inspect', description: 'Read status', parameters: { properties: {} }, execute: async () => { reads++; return { ok: true, summary: 'The room is dark.', data: { brightness: 0 } }; } },
    { name: 'adjust', description: 'Adjust', parameters: { properties: {} }, execute: async () => { writes++; return { ok: true, summary: 'Light adjusted.' }; } },
  ], fetchImpl: async (_url, options) => {
    rounds++; const request = JSON.parse(options.body);
    if (rounds === 2) assert.match(request.messages.at(-1).content, /brightness/);
    return answer(plan([call(rounds === 1 ? 'inspect' : 'adjust')], rounds === 1));
  } });
  const result = await agent.run(context('Check the room and adjust it'));
  assert.equal(reads, 1); assert.equal(writes, 1); assert.match(result.answer, /Light adjusted/);
});

test('clarification accepts a short answer and remains scoped to its room and profile', async () => {
  let round = 0, seconds;
  const agent = createToolAgent({ model: 'test', base: 'http://127.0.0.1', tools: async () => [{ name: 'start_timer', description: 'Timer', parameters: parameter, execute: async a => { seconds = a.seconds; return { ok: true, summary: 'Timer set for five minutes.' }; } }], fetchImpl: async (_url, options) => {
    round++;
    if (round === 1) return answer({ status: 'clarify', steps: [], question: 'How long should the timer run?', continue: false });
    assert.match(JSON.parse(options.body).messages[1].content, /User clarified: five minutes/);
    return answer(plan([call('start_timer', { seconds: 300 })]));
  } });
  assert.equal((await agent.run(context('Start a timer'))).clarification, true);
  assert.equal(agent.hasPending({ ...context(''), room: 'bedroom-2' }), false);
  assert.equal(agent.hasPending({ ...context(''), profileId: 'wade' }), false);
  await agent.run(context('five minutes')); assert.equal(seconds, 300);
});

test('tool failure and duplicate plans stop subsequent writes; only handler results become success text', async () => {
  let writes = 0;
  const agent = createToolAgent({ model: 'test', base: 'http://127.0.0.1', tools: async () => [
    { name: 'fail', description: '', parameters: { properties: {} }, execute: async () => ({ ok: false, summary: 'Device did not confirm.' }) },
    { name: 'write', description: '', parameters: { properties: {} }, execute: async () => { writes++; return { ok: true, summary: 'Saved.' }; } },
  ], fetchImpl: async () => answer(plan([call('fail'), call('write')])) });
  assert.equal((await agent.run(context('Check and save'))).answer, 'Device did not confirm.'); assert.equal(writes, 0);
  const duplicate = createToolAgent({ model: 'test', base: 'http://127.0.0.1', tools: async () => [{ name: 'write', description: '', parameters: { properties: {} }, execute: async () => { writes++; return { ok: true, summary: 'Saved.' }; } }], fetchImpl: async () => answer(plan([call('write')], true)) });
  await duplicate.run(context('Save')); assert.equal(writes, 1);
});

test('the server runs a compound request and a clarification follow-up using real room timers', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-tools-'));
  const model = http.createServer(async (req, res) => {
    if (req.method === 'GET') { res.end(JSON.stringify({ models: [{ name: 'test' }] })); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks)), question = data.messages[1].content;
    const response = /User clarified/.test(question) ? plan([call('start_timer', { seconds: 300, label: 'study' })]) : /countdown/.test(question) ? { status: 'clarify', steps: [], question: 'How long should it run?', continue: false } : plan([call('start_timer', { seconds: 120, label: 'tea' }), call('set_view', { view: 'dashboard' })]);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message: { content: JSON.stringify(response) } }));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const app = createJarvisServer({ model: 'test', ollamaUrl: 'http://127.0.0.1:' + model.address().port, displayBind: '', actionsOptions: { dataDirectory: directory }, pairingOptions: { directory }, speech: { listVoices: async () => ({ available: false }), close() {} } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  async function ask(question) {
    const abort = new AbortController(), source = await fetch(base + '/api/events?room=bedroom-1', { signal: abort.signal });
    const accepted = await fetch(base + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: 'bedroom-1', question }) });
    assert.equal(accepted.status, 202); const { requestId } = await accepted.json(); let buffer = '';
    try { for await (const chunk of source.body) {
      buffer += new TextDecoder().decode(chunk); let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) { const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (!packet.startsWith('data: ')) continue; const state = JSON.parse(packet.slice(6)); if (state.requestId === requestId && ['ready', 'error'].includes(state.state)) return state; }
    } } finally { abort.abort(); }
  }
  try {
    const result = await ask('Give me two minutes for tea and then show the dashboard');
    assert.equal(result.view, 'dashboard'); assert.match(result.answer, /tea/);
    assert.equal(result.toolActivity.length, 2);
    const clarification = await ask('Start a countdown');
    assert.equal(clarification.resultKind, 'clarification');
    const cancelled = await fetch(base + '/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: 'bedroom-1', requestId: clarification.requestId, interruption: true }) });
    assert.equal(cancelled.status, 200);
    assert.match((await ask('five minutes')).answer, /5 minutes/);
    const stale = await fetch(base + '/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: 'bedroom-1', requestId: clarification.requestId, interruption: true }) });
    assert.equal((await stale.json()).stale, true);
    const tools = await (await fetch(base + '/api/tools?room=bedroom-1')).json();
    assert.equal((await fetch(base + '/tools')).status, 200);
    assert.equal((await fetch(base + '/tools.js')).status, 200);
    assert.ok(tools.tools.some(t => t.name === 'create_reminder'));
    assert.equal(tools.tools.some(t => t.name === 'control_device'), false);
    const info = await (await fetch(base + '/api/dashboard')).json();
    assert.equal(info.timers.timers.length, 2);
    assert.ok(info.timers.timers.every(t => t.room === 'bedroom-1'));
  } finally { await app.shutdown(); await new Promise(resolve => model.close(resolve)); }
});
