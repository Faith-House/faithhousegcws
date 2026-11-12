import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeakerTurns, profileReply, speakerPrompt } from '../speaker-context.mjs';

test('speaker results bind to one question and room, expire, and never grant permission', () => {
  let clock = 1000;
  const turns = createSpeakerTurns({ now: () => clock, lifetimeMs: 500 });
  const data = { room: 'bedroom-1', text: 'Hey Jarvis, what’s my name?', speaker: { status: 'matched', profileId: 'wade', authorized: true } };
  const token = turns.issue(data);
  assert.equal(turns.consume({ token, room: 'bedroom-2', text: data.text }), null);
  assert.equal(turns.consume({ token, room: data.room, text: 'A different question' }), null);
  const match = turns.consume({ token, room: data.room, text: "What's my name?" });
  assert.equal(match.profileId, 'wade'); assert.equal(match.authorized, false);
  assert.equal(turns.consume({ token, room: data.room, text: data.text }), null);
  const expired = turns.issue(data); clock += 501;
  assert.equal(turns.consume({ token: expired, room: data.room, text: data.text }), null);
});

test('conversation context uses a fresh match naturally and describes actual enrollment', () => {
  const profile = { id: 'wade', name: 'Wade', answerStyle: 'concise', voiceEnrolled: true };
  const household = { profiles: [profile, { name: 'Cooper', voiceEnrolled: false }] };
  const speaker = { status: 'matched', profileId: 'wade' };
  for (const question of ["What's my name?", 'Who is speaking?', 'Do you know who I am?', 'Do you recognize my voice?']) {
    assert.equal(profileReply({ question, profile, speaker, household }), 'You’re Wade.');
  }
  assert.match(profileReply({ question: 'Do you have access to voice profiles?', household }), /learned Wade’s voice/);
  const prompt = speakerPrompt({ profile, speaker, household });
  assert.match(prompt, /matched this question's speaker to "Wade"/);
  assert.match(prompt, /Enrolled household voices: \["Wade"\]/);
  assert.match(speakerPrompt({ profile, household }), /manually chosen preference profile is not a voice match/);
  assert.match(profileReply({ question: 'Who am I?', profile, household }), /selected Wade/);
});
