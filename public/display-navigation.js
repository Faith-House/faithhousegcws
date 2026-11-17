export function createDisplayNavigator({ browser = globalThis.window, acknowledge, onError = () => {} } = {}) {
  const seen = new Set();
  async function apply(command, displayId) {
    if (!displayId || command?.displayId !== displayId || command.kind !== 'open_url' || typeof command.id !== 'string' || seen.has(command.id)) return false;
    let url;
    try { url = new URL(command.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false; }
    catch { return false; }
    seen.add(command.id);while(seen.size>64)seen.delete(seen.values().next().value);
    try {
      // The server accepts only this screen's live, unexpired command. Reconnects cannot replay it.
      if (!await acknowledge(command.id)) return false;
      browser.location.assign(url.href);
      return true;
    } catch { onError('The TV browser could not open that website.'); return false; }
  }
  return { apply };
}
