import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { APP_ROOT, NEURAL_VOICES, DEFAULT_NEURAL_VOICE } from './voice-config.mjs';
import { SPEAKER_MODEL, cosine, chooseSpeaker } from './speaker-id.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const PROFILE_NAMES = ['Wade', 'Grayson', 'Cooper', 'Seattle'];
export const ENROLLMENT_PROMPTS = [
  'Jarvis, this is my natural speaking voice. I am setting up my profile so you can recognize me at home.',
  'In the morning I might ask about my plans, turn on a light, or set a timer while I get ready.',
  'When I speak from another room, please listen to the sound of my voice and use the right preferences.',
];
const validEmbedding = vector => Array.isArray(vector) && vector.length === 256 && vector.every(Number.isFinite) && Math.abs(vector.reduce((sum, value) => sum + value * value, 0) - 1) < .02;
export const meanEmbedding = vectors => {
  const mean = new Array(256).fill(0);
  for (const vector of vectors) for (let i = 0; i < 256; i++) mean[i] += vector[i] / vectors.length;
  const norm = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0));
  if (norm < 1e-8) throw fail('The voice samples could not be combined. Record again.', 422);
  return mean.map(value => value / norm);
};
export function createProfiles({ directory = path.join(APP_ROOT, 'private'), now = Date.now } = {}) {
  const file = path.join(directory, 'profiles.json');
  let data, initialization, operations = Promise.resolve(), pending = new Map();
  const serialize = callback => { const result = operations.then(callback); operations = result.catch(() => {}); return result; };
  const publicProfile = ({ voiceprint, ...profile }) => ({ ...profile, voiceEnrolled: Boolean(voiceprint?.model === SPEAKER_MODEL), voiceSamples: voiceprint?.model === SPEAKER_MODEL ? voiceprint.samples : 0, voiceUpdatedAt: voiceprint?.updatedAt || null });
  async function commit(next) {
    await mkdir(directory, { recursive: true });
    await writeFile(file + '.tmp', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await rename(file + '.tmp', file); data = next;
  }
  async function initialize() {
    if (!initialization) initialization = (async () => {
      try {
        const stored = JSON.parse(await readFile(file, 'utf8'));
        const ids = new Set(); const bedrooms = new Set();
        if (stored.version !== 1 || !Array.isArray(stored.profiles) || stored.profiles.length !== 4 || stored.profiles.some(profile => {
          if (!/^[a-z][a-z0-9-]{0,39}$/.test(profile.id) || ids.has(profile.id) || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 40 || !NEURAL_VOICES.some(voice => voice.name === profile.voice) || typeof profile.spokenReplies !== 'boolean' || !['concise', 'balanced', 'detailed'].includes(profile.answerStyle) || (profile.bedroom !== null && (!/^bedroom-[1-4]$/.test(profile.bedroom) || bedrooms.has(profile.bedroom))) || (profile.voiceprint && (profile.voiceprint.model !== SPEAKER_MODEL || profile.voiceprint.samples !== 3 || !validEmbedding(profile.voiceprint.embedding)))) return true;
          ids.add(profile.id); if (profile.bedroom) bedrooms.add(profile.bedroom); return false;
        })) throw new Error('Invalid profiles file');
        data = stored;
      } catch (error) {
        if (error.code !== 'ENOENT') throw fail('The saved profile file needs attention. It has not been overwritten.', 503);
        await commit({ version: 1, profiles: PROFILE_NAMES.map(name => ({ id: name.toLowerCase(), name, bedroom: null, voice: DEFAULT_NEURAL_VOICE, spokenReplies: true, answerStyle: 'concise', voiceprint: null })) });
      }
    })();
    return initialization;
  }
  async function list() { await initialize(); return { profiles: data.profiles.map(publicProfile), voiceIdentificationIsAuthentication: false, prompts: ENROLLMENT_PROMPTS }; }
  async function get(id) {
    if (id === undefined || id === null || id === '' || id === 'shared') return null;
    await initialize(); const profile = data.profiles.find(item => item.id === id);
    if (!profile) throw fail('Choose one of the four roommate profiles.');
    return publicProfile(profile);
  }
  const update = (id, body) => serialize(async () => {
    await initialize(); if (!await get(id)) throw fail('Choose a roommate profile.');
    if (!body || Object.keys(body).some(key => !['name', 'bedroom', 'voice', 'spokenReplies', 'answerStyle'].includes(key))) throw fail('Only profile preferences can be changed here.');
    if (body.name !== undefined && (typeof body.name !== 'string' || !/^[\p{L}\p{N} .'-]{1,40}$/u.test(body.name) || !body.name.trim())) throw fail('Use a name with 1 to 40 letters or numbers.');
    if (body.bedroom !== undefined && body.bedroom !== null && !/^bedroom-[1-4]$/.test(body.bedroom)) throw fail('Choose a bedroom or leave it unassigned.');
    if (body.bedroom && data.profiles.some(profile => profile.id !== id && profile.bedroom === body.bedroom)) throw fail('That bedroom is already assigned to another roommate.', 409);
    if (body.voice !== undefined && !NEURAL_VOICES.some(voice => voice.name === body.voice)) throw fail('Choose an installed voice.');
    if (body.spokenReplies !== undefined && typeof body.spokenReplies !== 'boolean') throw fail('Choose whether spoken replies are on.');
    if (body.answerStyle !== undefined && !['concise', 'balanced', 'detailed'].includes(body.answerStyle)) throw fail('Choose an answer length.');
    const next = { ...data, profiles: data.profiles.map(profile => profile.id === id ? { ...profile, ...body, ...(body.name ? { name: body.name.trim() } : {}) } : profile) };
    await commit(next); return publicProfile(data.profiles.find(profile => profile.id === id));
  });
  function prune() { for (const [token, enrollment] of pending) if (enrollment.expiresAt < now()) pending.delete(token); }
  const maintenance = setInterval(prune, 60000); maintenance.unref();
  async function beginEnrollment({ profileId, consent, replace = false }) {
    await initialize(); const profile = await get(profileId);
    if (!profile || consent !== true) throw fail('The person enrolling must consent to storing their own local voice signature.');
    if (profile.voiceEnrolled && replace !== true) throw fail('Confirm re-recording before replacing an enrolled voice.', 409);
    prune(); for (const [token, enrollment] of pending) if (enrollment.profileId === profileId) pending.delete(token);
    const token = randomBytes(24).toString('base64url');
    pending.set(token, { profileId, embeddings: [], digests: new Set(), expiresAt: now() + 600000 });
    return { token, profileId, samples: 0, required: 3, expiresAt: now() + 600000, prompt: ENROLLMENT_PROMPTS[0] };
  }
  function enrollment(token) { prune(); const current = pending.get(token); if (!current) throw fail('Voice setup expired or was cancelled. Start again.', 409); return current; }
  const addSample = (token, embedding, digest) => serialize(async () => {
    await initialize(); const current = enrollment(token);
    if (!validEmbedding(embedding)) throw fail('That recording did not produce a usable voice signature.', 422);
    if (current.digests.has(digest)) throw fail('Record a new sample for each sentence.', 422);
    if (current.embeddings.length && cosine(meanEmbedding(current.embeddings), embedding) < .55) throw fail('These samples do not sound consistent. Use the same speaker and microphone, then try again.', 422);
    const others = data.profiles.filter(profile => profile.id !== current.profileId && profile.voiceprint);
    if (chooseSpeaker(embedding, others, { threshold: .85, margin: .1 }).profileId) throw fail('This sounds close to an already enrolled voice. Check the chosen profile and record again.', 422);
    const vectors = [...current.embeddings, embedding];
    if (vectors.length === 3) {
      const next = { ...data, profiles: data.profiles.map(profile => profile.id === current.profileId ? { ...profile, voiceprint: { model: SPEAKER_MODEL, embedding: meanEmbedding(vectors), samples: 3, updatedAt: new Date(now()).toISOString() } } : profile) };
      await commit(next); pending.delete(token);
      return { complete: true, samples: 3, profile: publicProfile(data.profiles.find(profile => profile.id === current.profileId)) };
    }
    current.embeddings = vectors; current.digests.add(digest); current.expiresAt = now() + 600000;
    return { complete: false, samples: vectors.length, required: 3, prompt: ENROLLMENT_PROMPTS[vectors.length] };
  });
  const removeVoice = (id, confirmed) => serialize(async () => {
    await initialize(); if (!await get(id)) throw fail('Choose a roommate profile.'); if (confirmed !== true) throw fail('Confirm removal of the saved voice signature.');
    await commit({ ...data, profiles: data.profiles.map(profile => profile.id === id ? { ...profile, voiceprint: null } : profile) });
    for (const [token, current] of pending) if (current.profileId === id) pending.delete(token);
    return { ok: true };
  });
  async function identify(embedding) { await initialize(); return chooseSpeaker(embedding, data.profiles); }
  async function hasVoices() { await initialize(); return data.profiles.some(profile => profile.voiceprint?.model === SPEAKER_MODEL); }
  return { initialize, list, get, update, beginEnrollment, enrollment, addSample, removeVoice, identify, hasVoices, cancelEnrollment: token => pending.delete(token), close: async () => { clearInterval(maintenance); await operations; await initialization?.catch(() => {}); } };
}
