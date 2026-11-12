import { createHash, randomBytes } from 'node:crypto';

function transcriptKey(text) {
  return createHash('sha256').update(text.trim().toLowerCase().replaceAll('’', "'").replace(/^(?:(?:hey|okay|ok)[,\s]+)?jarvis[,.!:\s]*/, '').replace(/\s+/g, ' ')).digest('hex');
}
// A short-lived reference binds a local voice result to this question, never to permissions.
export function createSpeakerTurns({ now = Date.now, lifetimeMs = 120000 } = {}) {
  const turns = new Map();
  function prune() { for (const [token, turn] of turns) if (turn.expiresAt <= now()) turns.delete(token); }
  function issue({ room, text, speaker }) {
    prune();
    const token = randomBytes(24).toString('base64url');
    turns.set(token, { room, text: transcriptKey(text), speaker: { status: speaker.status, profileId: speaker.profileId || null, reason: speaker.reason || null, authorized: false }, expiresAt: now() + lifetimeMs });
    while (turns.size > 100) turns.delete(turns.keys().next().value);
    return token;
  }
  function consume({ token, room, text }) {
    prune(); const turn = turns.get(token);
    if (!turn || turn.room !== room || turn.text !== transcriptKey(text)) return null;
    turns.delete(token); return turn.speaker;
  }
  return { issue, consume, close: () => turns.clear() };
}

export function profileReply({ question, profile, speaker, household, modelAvailable = true }) {
  const text = question.toLowerCase().replaceAll('’', "'").replace(/^(?:(?:hey|okay|ok)[,\s]+)?jarvis[,.!:\s]*/, '').trim().replace(/[?!.]+$/, '');
  const identity = /^(?:who am i|what(?:'s| is) my name|tell me my name|who(?:'s| is) (?:speaking|talking)(?: (?:right )?now| to you)?|who are you talking to|do you (?:recognize (?:me|my voice)|know (?:who i am|my name|who(?:'s| is) speaking))|can you (?:recognize (?:me|my voice)|tell (?:me )?who(?:'s| is) speaking))$/;
  if (identity.test(text)) {
    if (speaker?.status === 'matched' && profile) return `You’re ${profile.name}.`;
    if (speaker?.status === 'unknown') {
      if (speaker.reason === 'short-audio') return 'Say a little more so I can recognize your voice.';
      if (speaker.reason === 'no-enrollments') return 'I haven’t learned your voice yet. Record your three samples in Profiles first.';
      if (['model-unavailable', 'processing-unavailable'].includes(speaker.reason)) return 'Voice recognition is temporarily unavailable. Your saved profiles are still here.';
      return 'I’m not sure who’s speaking yet. Try a longer sentence in your normal voice.';
    }
    return profile ? `You’ve selected ${profile.name}. Ask me by voice and I’ll try to recognize you.` : 'Ask me by voice and I’ll try to recognize you.';
  }
  const capabilities = /\b(?:voice profiles?|voice recognition|speaker recognition)\b/.test(text) && /\b(?:can|do|have|access|use|recognize|identify)\b/.test(text);
  if (capabilities) {
    const enrolled = household.profiles.filter(item => item.voiceEnrolled).map(item => item.name);
    if (!modelAvailable) return 'Your voice profiles are saved, but the local recognition model is unavailable right now.';
    if (!enrolled.length) return 'Yes, I can recognize voices locally once each person records their three setup samples.';
    const names = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(enrolled);
    return `Yes. I’ve learned ${names}${enrolled.length === 1 ? '’s voice' : '’s voices'} and can use voice recognition automatically when you speak.`;
  }
  return null;
}

export function speakerPrompt({ profile, speaker, household }) {
  const enrolled = household.profiles.filter(item => item.voiceEnrolled).map(item => item.name);
  const current = speaker?.status === 'matched' && profile ? `The local voice recognizer matched this question's speaker to ${JSON.stringify(profile.name)}. You know who is speaking for this conversation. Use their name naturally when appropriate, not on every reply.` : speaker?.status === 'unknown' ? 'The local recognizer did not identify this speaker. Do not invent a name or claim that voice profiles are inaccessible.' : 'This message has no fresh voice identification. A manually chosen preference profile is not a voice match.';
  const preference = profile ? ` Preference profile: ${JSON.stringify(profile.name)}. ${profile.answerStyle === 'detailed' ? 'Use three to six clear sentences when useful.' : profile.answerStyle === 'balanced' ? 'Use one to three clear sentences.' : 'Prefer one short sentence.'}` : '';
  return ` Local voice recognition is installed. Enrolled household voices: ${JSON.stringify(enrolled)}. These names are people, not your name; you are Jarvis. ${current}${preference} Voice matching never authorizes private data or door actions. Keep internal profile details out of normal replies unless asked.`;
}
