import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProfiles } from '../profiles.mjs';
import { chooseSpeaker, SPEAKER_MODEL, checkSpeakerAudio } from '../speaker-id.mjs';
import { createJarvisServer } from '../server.mjs';
const vector = index => Array.from({ length: 256 }, (_, i) => i === index ? 1 : 0);
const temp = () => mkdtemp(path.join(tmpdir(), 'jarvis-profiles-test-'));
function wave(frequency = 220) {
  const bytes = Buffer.alloc(44 + 4 * 16000 * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < (bytes.length - 44) / 2; i++) bytes.writeInt16LE(Math.round(Math.sin(i * frequency / 16000 * Math.PI * 2) * 6000), 44 + i * 2);
  return bytes;
}
test('four named profiles persist preferences, reject conflicts, and expose no voice vectors', async () => {
  const directory = await temp(); const profiles = createProfiles({ directory });
  assert.deepEqual((await profiles.list()).profiles.map(profile => profile.name), ['Wade', 'Grayson', 'Cooper', 'Seattle']);
  await profiles.update('cooper', { bedroom: 'bedroom-1', voice: 'am_michael', answerStyle: 'balanced', spokenReplies: false });
  await assert.rejects(profiles.update('wade', { bedroom: 'bedroom-1' }), error => error.status === 409);
  await assert.rejects(profiles.update('cooper', { authenticated: true }));
  await assert.rejects(profiles.update('cooper', { voice: 'not-a-voice' }));
  await assert.rejects(profiles.update('shared', { name: 'Guest' }));
  assert.equal((await createProfiles({ directory }).get('cooper')).voice, 'am_michael');
  assert.equal(JSON.stringify(await profiles.list()).includes('voiceprint'), false);
  assert.deepEqual(await readdir(directory), ['profiles.json']);
});
test('enrollment requires consent and three different consistent samples; templates stay local', async () => {
  const directory = await temp(); let clock = 1000; const profiles = createProfiles({ directory, now: () => clock });
  await assert.rejects(profiles.beginEnrollment({ profileId: 'wade', consent: false }));
  const { token } = await profiles.beginEnrollment({ profileId: 'wade', consent: true });
  await profiles.addSample(token, vector(0), 'first');
  assert.equal((await profiles.get('wade')).voiceEnrolled, false);
  await assert.rejects(profiles.addSample(token, vector(0), 'first'), /new sample/);
  await assert.rejects(profiles.addSample(token, vector(1), 'different-speaker'), /consistent/);
  await profiles.addSample(token, vector(0), 'second');
  const complete = await profiles.addSample(token, vector(0), 'third'); assert.equal(complete.complete, true);
  assert.equal((await profiles.identify(vector(0))).profileId, 'wade');
  assert.equal((await profiles.identify(vector(1))).status, 'unknown');
  assert.equal((await profiles.identify(vector(0))).authorized, false);
  assert.equal(JSON.stringify(await profiles.list()).includes('embedding'), false);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'profiles.json'))).profiles[0].voiceprint.embedding.length, 256);
  const duplicate = await profiles.beginEnrollment({ profileId: 'grayson', consent: true });
  await assert.rejects(profiles.addSample(duplicate.token, vector(0), 'not-grayson'), /already enrolled/);
  const cancelled = await profiles.beginEnrollment({ profileId: 'cooper', consent: true }); profiles.cancelEnrollment(cancelled.token);
  assert.throws(() => profiles.enrollment(cancelled.token));
  clock += 600001; assert.throws(() => profiles.enrollment(duplicate.token));
  await assert.rejects(profiles.removeVoice('wade', false)); await profiles.removeVoice('wade', true);
  assert.equal((await profiles.get('wade')).voiceEnrolled, false);
});
test('ambiguous speakers, clipping, silence, and corrupt stored profiles fail safely', async () => {
  const signature = { model: SPEAKER_MODEL, samples: 3, embedding: vector(0) };
  assert.equal(chooseSpeaker(vector(0), [{ id: 'a', name: 'A', voiceprint: signature }, { id: 'b', name: 'B', voiceprint: signature }]).reason, 'ambiguous');
  assert.throws(() => checkSpeakerAudio(new Float32Array(64000), true));
  assert.throws(() => checkSpeakerAudio(new Float32Array(64000).fill(1), true), /clipping/);
  const directory = await temp(); const filename = path.join(directory, 'profiles.json'); await writeFile(filename, 'broken');
  await assert.rejects(createProfiles({ directory }).list(), /not been overwritten/);
  assert.equal(await readFile(filename, 'utf8'), 'broken');
});
test('speaker API performs local enrollment and matching while protecting source files and action permissions', async () => {
  const directory = await temp(); let embedding = vector(0), embeds = 0, transcriptions = 0;
  const speakerId = { status: () => ({ available: true, localOnly: true }), close() {}, async embed() { embeds++; return { embedding }; } };
  const recognition = { status: () => ({ available: true }), close() {}, async transcribe() { transcriptions++; return { text: "Hey Jarvis, what's my name?", metrics: {} }; } };
  const app = createJarvisServer({ speakerId, recognition, actionsOptions: { dataDirectory: directory }, pairingOptions: { directory } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (endpoint, body, extra = {}) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const sample = (token, frequency) => fetch(base + '/api/profiles/enrollment/sample', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Jarvis-Enrollment': token }, body: wave(frequency) });
  async function ask(body) {
    const controller = new AbortController();
    const stream = await fetch(base + '/api/events?room=bedroom-1', { signal: controller.signal });
    const accepted = await (await post('/api/ask', { room: 'bedroom-1', ...body })).json();
    let buffer = '';
    try {
      for await (const chunk of stream.body) {
        buffer += new TextDecoder().decode(chunk); let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (!event.startsWith('data: ')) continue;
          const result = JSON.parse(event.slice(6));
          if (result.requestId === accepted.requestId && result.state === 'ready') return result;
        }
      }
    } finally { controller.abort(); }
    throw new Error('No answer was received');
  }
  try {
    assert.equal((await fetch(base + '/private/profiles.json')).status, 404);
    assert.equal((await post('/api/profiles/update', { id: 'wade', preferences: { role: 'admin' } })).status, 400);
    assert.equal((await post('/api/profiles/enrollment/start', { profileId: 'wade', consent: true }, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await post('/api/profiles/enrollment/start', { profileId: 'wade', consent: false })).status, 400);
    const setup = await (await post('/api/profiles/enrollment/start', { profileId: 'wade', consent: true })).json();
    assert.equal((await sample('invalid', 220)).status, 409);
    for (const frequency of [220, 330, 440]) assert.equal((await sample(setup.token, frequency)).status, 200);
    const profileList = await (await fetch(base + '/api/profiles')).json(); assert.equal(profileList.profiles[0].voiceEnrolled, true); assert.equal(JSON.stringify(profileList).includes('embedding'), false);
    const recognized = await fetch(base + '/api/transcribe?room=bedroom-1&identify=1', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wave() });
    const result = await recognized.json(); assert.equal(result.speaker.profileId, 'wade'); assert.equal(result.speaker.authorized, false); assert.equal(result.text, "Hey Jarvis, what's my name?");
    const named = await ask({ question: "What's my name?", profileId: 'cooper', speakerToken: result.speakerToken });
    assert.equal(named.answer, 'You’re Wade.'); assert.equal(named.profileId, 'wade');
    assert.match((await ask({ question: 'Do you have access to voice profiles?' })).answer, /learned Wade’s voice/);
    embedding = vector(1);
    const unknown = await fetch(base + '/api/transcribe?room=bedroom-1&identify=1', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wave() }); const unknownResult = await unknown.json(); assert.equal(unknownResult.speaker.status, 'unknown');
    const anonymous = await ask({ question: "What's my name?", profileId: 'wade', speakerToken: unknownResult.speakerToken });
    assert.equal(anonymous.profileId, null); assert.match(anonymous.answer, /not sure who’s speaking/);
    const before = embeds;
    const plain = await fetch(base + '/api/transcribe?room=bedroom-1', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wave() }); assert.equal((await plain.json()).speaker, undefined); assert.equal(embeds, before); assert.equal(transcriptions, 3);
  } finally { await app.shutdown(); }
});

test('roommate conversation contexts remain separate and profile selection cannot enable door access', async () => {
  const directory = await temp(), calls = [];
  const ollama = http.createServer(async (request, response) => {
    let data = ''; for await (const chunk of request) data += chunk;
    calls.push(JSON.parse(data)); response.setHeader('Content-Type', 'application/x-ndjson'); response.end(JSON.stringify({ message: { content: 'A short test reply.' }, done: true }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const app = createJarvisServer({ ollamaUrl: `http://127.0.0.1:${ollama.address().port}`, actionsOptions: { dataDirectory: directory }, pairingOptions: { directory } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (endpoint, body) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function ask(question, profileId) {
    const controller = new AbortController();
    const stream = await fetch(base + '/api/events?room=bedroom-1', { signal: controller.signal });
    const response = await post('/api/ask', { room: 'bedroom-1', question, profileId }); assert.equal(response.status, 202); const accepted = await response.json();
    let buffer = '';
    try {
      for await (const chunk of stream.body) {
        buffer += new TextDecoder().decode(chunk); let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (!event.startsWith('data: ')) continue;
          const result = JSON.parse(event.slice(6));
          if (result.requestId === accepted.requestId && result.state === 'ready') return result;
        }
      }
    } finally { controller.abort(); }
    throw new Error('No answer was received');
  }
  try {
    await ask('Wade first question', 'wade'); await ask('Grayson first question', 'grayson'); await ask('Wade follow up', 'wade');
    assert.equal(calls[0].messages.length, 2); assert.equal(calls[1].messages.length, 2); assert.equal(calls[2].messages.length, 4);
    assert.match(calls[2].messages.at(-1).content, /^Answer this current question: Wade follow up$/);
    assert.match(calls[2].messages[0].content, /profile names belong to the people you assist, never to you/);
    assert.equal(calls[2].messages.some(message => /Grayson first/.test(message.content)), false);
    await post('/api/reset', { room: 'bedroom-1', profileId: 'wade' });
    await ask('Wade after reset', 'wade'); assert.equal(calls[3].messages.length, 2);
    await ask('Grayson follow up', 'grayson'); assert.equal(calls[4].messages.length, 4);
    const before = calls.length;
    assert.match((await ask('Unlock the front door', 'wade')).answer, /not been enabled/);
    assert.equal(calls.length, before);
    assert.match((await ask('Who am I?', 'cooper')).answer, /selected Cooper/);
  } finally { await app.shutdown(); await new Promise(resolve => ollama.close(resolve)); }
});
