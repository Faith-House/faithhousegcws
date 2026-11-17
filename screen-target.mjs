export function screenTarget(question) {
  if (typeof question !== 'string') return { question, destination: null };
  const match = question.match(/\s+on\s+(?!.*\son\s)(?:(?:the|my|our|this|that)\s+)?([a-z0-9][a-z0-9 -]{0,60})[?!.]*$/i);
  if (!match) return { question, destination: null };
  const before=question.slice(0,match.index).trim();
  if (/\b(?:focus|navigate|go|switch|chrome|edge|firefox)(?: browser)?$/i.test(before)) return { question, destination: null };
  if (/\b(?:open|launch|start|navigate to|go to)\s+(?:(?:the|my|a|managed|web)\s+)*browser$/i.test(before)) return { question, destination: null };
  const name = match[1].trim().toLowerCase();
  if (/^(?:(?:google|microsoft) )?(?:chrome|edge|firefox|safari|browser|website)$/.test(name)) return { question, destination: null };
  let destination;
  if (/^(?:phone|iphone|android)$/.test(name)) destination = { type: 'device', device: 'phone' };
  else if (/^(?:computer|laptop|desktop|pc)$/.test(name)) destination = { type: 'device', device: 'computer' };
  else if (/^(?:device|here)$/.test(name)) destination = { type: 'device', device: 'self' };
  else if (/^(?:tv|television|screen|display)$/.test(name)) destination = { type: 'display' };
  else destination = { type: 'display', name: name.replace(/\s+(?:tv|television|screen|display)$/, '') };
  return { question: before, destination };
}

export function websiteAddress(value) {
  const fail = () => Object.assign(new Error('Use an HTTP or HTTPS website address without embedded login details.'), { status: 400 });
  if (typeof value !== 'string' || value.length > 2000 || /[\x00-\x1f]/.test(value)) throw fail();
  let url;try { url = new URL(value); } catch { throw fail(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail();
  return url;
}
