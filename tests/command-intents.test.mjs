import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCommandInterpreter, validateIntent } from '../command-intents.mjs';
import { createJarvisServer } from '../server.mjs';

test('informal view requests choose the correct direction even when the model is offline', async () => {
  const interpreter = createCommandInterpreter({ model: 'offline', base: 'http://127.0.0.1:1', fetchImpl: () => { throw new Error('A routine view request should not need the model.'); } });
  for (const question of ['Could you get rid of the dashboard for me?', 'Can we lose all these panels and go back to the circles?', 'I only want the rings on screen', 'Switch it back to quiet mode', 'Would you put the dashboard away now']) assert.equal((await interpreter.interpret({ question, view: 'dashboard' })).question, 'Back to Jarvis', question);
  for (const question of ['I want all the controls on screen', 'Bring back the control room', 'Could you show the dashboard again?']) assert.equal((await interpreter.interpret({ question, view: 'minimal' })).question, 'Show the dashboard', question);
});

test('intent validation rejects invented tools, wrong tool families, invalid arguments, negation, and unapproved devices', () => {
  const validate = (plan, question) => validateIntent(plan, { question });
  assert.equal(validate({ action: 'shell', command: 'anything' }, 'close the dashboard'), null);
  assert.equal(validate({ action: 'toString' }, 'close the dashboard'), null);
  assert.equal(validate({ action: 'cancel_timer', label: 'dashboard' }, 'get rid of the dashboard'), null);
  assert.equal(validate({ action: 'show_dashboard' }, "Don't open the dashboard"), null);
  assert.equal(validate({ action: 'show_minimal' }, 'close the dashboard and start a timer'), null);
  for (const seconds of [0, -1, 86401, 1.5, '60']) assert.equal(validate({ action: 'set_timer', seconds }, 'give me one minute'), null);
  for (const question of ['start a timer', 'give me a few minutes', 'timer at five minutes past noon', 'set a timer for -5 minutes']) assert.equal(validate({ action: 'set_timer', seconds: 300 }, question), null);
  assert.deepEqual(validate({ action: 'set_timer', seconds: 90, label: 'pasta' }, 'give me a minute and a half for pasta'), { type: 'local', question: 'Set a timer for 90 seconds called pasta' });
  assert.equal(validate({ action: 'cancel_all_timers' }, 'stop my timer'), null);
  assert.equal(validate({ action: 'turn_on', target: 'kitchen light' }, 'brighten the kitchen light'), null);
  const devices = [{ aliases: ['kitchen light'], operations: ['brightness'] }];
  assert.equal(validateIntent({ action: 'brightness', target: 'kitchen light', percent: 150 }, { question: 'brighten the kitchen light', devices }), null);
  assert.deepEqual(validateIntent({ action: 'brightness', target: 'kitchen light', percent: 40 }, { question: 'make the kitchen light forty percent', devices }), { type: 'device', question: 'Set kitchen light to 40%' });
});

test('the interpreter uses local structured output, limits choices, and handles malformed output and service failure without execution', async () => {
  let calls = 0, response = { action: 'show_minimal' }, bad = false, fail = false;
  const interpreter = createCommandInterpreter({ model: 'test', base: 'http://127.0.0.1:11434', fetchImpl: async (url, options) => {
    calls++; assert.equal(url.hostname, '127.0.0.1');
    const body = JSON.parse(options.body); assert.equal(body.stream, false); assert.equal(body.think, false); assert.equal(body.options.temperature, 0);
    assert.equal(body.format.properties.action.enum.includes('cancel_timer'), false);
    assert.equal(body.messages.length, 2); assert.equal(body.messages.some(message => message.role === 'tool'), false);
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => ({ message: { content: bad ? '{' : JSON.stringify(response) } }) };
  } });
  assert.deepEqual(await interpreter.interpret({ question: 'Could you simplify the interface?' }), { type: 'local', question: 'Back to Jarvis' });
  for (const question of ["don't open the dashboard", 'how do I close the dashboard?', 'what is a timer?', 'What is your favorite color?']) assert.deepEqual(await interpreter.interpret({ question }), { type: 'none' });
  assert.equal(calls, 1);
  assert.deepEqual(await interpreter.interpret({ question: 'close the dashboard and start a timer' }), { type: 'clarify' }); assert.equal(calls, 1);
  response = { action: 'set_timer', seconds: 60 };
  assert.deepEqual(await interpreter.interpret({ question: 'simplify the interface' }), { type: 'clarify' });
  bad = true; assert.deepEqual(await interpreter.interpret({ question: 'simplify the interface' }), { type: 'unavailable' });
  fail = true; assert.deepEqual(await interpreter.interpret({ question: 'simplify the interface' }), { type: 'unavailable' });
});

test('natural-language actions execute real handlers and remain scoped to the requesting room without a TV', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-intent-test-'));
  const requests = [];
  const model = http.createServer(async (request, response) => {
    if (request.method === 'GET') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ models: [{ name: 'test' }] })); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
    const question = body.messages.at(-1).content;
    const plan = /controls/.test(question) ? { action: 'show_dashboard' } : /ninety/.test(question) ? { action: 'set_timer', seconds: 90, label: 'pasta' } : /pasta/.test(question) ? { action: 'cancel_timer', label: 'pasta' } : { action: 'show_minimal' };
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ message: { content: JSON.stringify(plan) }, done: true }));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const app = createJarvisServer({ model: 'test', ollamaUrl: `http://127.0.0.1:${model.address().port}`, actionsOptions: { dataDirectory: directory }, pairingOptions: { directory }, speech: { listVoices: async () => ({ available: true }), close() {} } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function ask(question, room = 'bedroom-1') {
    const abort = new AbortController(); const events = await fetch(base + `/api/events?room=${room}`, { signal: abort.signal });
    const response = await fetch(base + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, question, viewContext: 'dashboard' }) });
    assert.equal(response.status, 202); const { requestId } = await response.json(); let buffer = '';
    try {
      for await (const chunk of events.body) {
        buffer += new TextDecoder().decode(chunk); let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (!packet.startsWith('data: ')) continue;
          const state = JSON.parse(packet.slice(6)); if (state.requestId === requestId && ['ready', 'error'].includes(state.state)) return state;
        }
      }
    } finally { abort.abort(); }
    throw new Error('Missing result');
  }
  try {
    const shown = await ask('I want all the controls on screen'); assert.equal(shown.view, 'dashboard'); assert.equal(shown.resultKind, 'view');
    const hidden = await ask('could you get rid of this dashboard for me?'); assert.equal(hidden.view, 'minimal'); assert.equal(hidden.answer, 'Back to Jarvis.');
    assert.equal((await ask('Close the dashboard, please.')).view, 'minimal'); assert.equal(requests.length, 0, 'High-confidence view semantics work even without the model.');
    assert.equal((await ask('Give me ninety seconds for pasta')).resultKind, 'timer');
    let info = await (await fetch(base + '/api/dashboard')).json(); assert.equal(info.timers.timers.length, 1); assert.equal(info.timers.timers[0].label, 'pasta');
    await ask('get rid of the pasta timer', 'bedroom-2'); info = await (await fetch(base + '/api/dashboard')).json(); assert.equal(info.timers.timers.length, 1);
    await ask('get rid of the pasta timer'); info = await (await fetch(base + '/api/dashboard')).json(); assert.equal(info.timers.timers.length, 0);
    assert.equal(requests.every(request => request.format && request.stream === false), true, 'Tool results never go through a fabricated conversational execution reply.');
  } finally { await app.shutdown(); await new Promise(resolve => model.close(resolve)); }
});
