// Automatic conversation narration is brief; action outcomes and requested full reads stay complete.
export function conciseNarration(snapshot, { enabled = false, full = false } = {}) {
  return enabled && !full && !snapshot.resultKind && snapshot.modelMode !== 'coding' && !snapshot.error && !snapshot.calendarDraft
    && !/\b(?:read|say|speak)\b.{0,40}\b(?:all|full|entire|everything|word for word)\b/i.test(snapshot.question || '');
}
export function firstSpokenSentence(text, final = false) {
  // Keep decimals, initials and common abbreviations attached to their sentence.
  const endings = [...text.matchAll(/[.!?]["')\]]*(?=\s|$)/g)];
  for (const boundary of endings) {
    const end = boundary.index + boundary[0].length;
    const candidate = text.slice(0, end);
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|St|e\.g|i\.e)\.$/i.test(candidate.trim()) || /\b[A-Z]\.$/.test(candidate.trim())) continue;
    // A terminal period is not a boundary while tokens are still arriving.
    if (!final && end === text.length) continue;
    if (/^(?:sure|certainly|of course|okay|alright)[.!]?$/i.test(candidate.trim()) && (!final || text.slice(end).trim())) continue;
    return { text: candidate.trim(), consumed: end, complete: true };
  }
  if (final && text.trim()) return { text: text.trim(), consumed: text.length, complete: true };
  return null;
}
export function spokenReplyText(snapshot, { concise = false, full = false } = {}) {
  const text = snapshot.answer || '';
  return conciseNarration(snapshot, { enabled: concise, full }) ? firstSpokenSentence(text, true)?.text || text : text;
}
