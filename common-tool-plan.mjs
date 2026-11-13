import { normalizeCommand, timerDuration } from './local-actions.mjs';
import { directViewIntent } from './command-intents.mjs';

// Common phrases take the same validated tool path as AI plans. If any clause
// is unfamiliar, leave the whole request to the local model instead of dropping it.
export function commonToolPlan(question, { view = 'minimal', clarification = '' } = {}) {
  const q = normalizeCommand(question);
  const clauses = q.split(/(?:,?\s*\b(?:and(?: then| also)?|then|also)\s+|;\s*)(?=(?:(?:please|can you|could you)\s+)?(?:show|open|close|hide|switch|go|bring|start|set|create|add|remind|tell|check)\b)/i);
  if (clauses.length > 4 || /\b(?:don't|do not|never|if|unless|instead)\b/.test(q)) return null;
  const steps = [];
  const execute = (tool, args = {}) => steps.push({ tool, arguments: args });
  const ask = question => ({ steps: [], question, continue: false });
  for (const raw of clauses) {
    const text = normalizeCommand(raw);
    const visual = directViewIntent(text, view);
    if (visual) { execute('set_view', { view: visual.action === 'show_dashboard' ? 'dashboard' : 'minimal' }); continue; }
    if (/^(?:set|start|create) (?:a |an )?(?:timer|countdown)(?: for .+)?$/.test(text)) {
      const durationText = text.match(/^(?:set|start|create) (?:a |an )?(?:timer|countdown)(?: for (.+))?$/)?.[1];
      const parts = durationText?.match(/^(.+?)(?: (?:called|named|for) (.+))?$/);
      const seconds = timerDuration(parts?.[1] || (clauses.length === 1 ? normalizeCommand(clarification).replace(/^(?:in|for) /, '') : ''));
      if (!seconds) return durationText ? null : ask('How long should the timer run?');
      execute('start_timer', { seconds, ...(parts?.[2] ? { label: parts[2] } : {}) }); continue;
    }
    const reminder = text.match(/^(?:remind me to|(?:set|create|add) (?:a )?reminder to) (.+)$/);
    if (reminder) {
      const parsed = reminder[1].match(/^(.+?) in (.+)$/);
      const title = parsed?.[1] || reminder[1];
      if (/\b(?:at|tomorrow|today|on \d{4}-\d{2}-\d{2})\b/.test(title)) return null;
      const seconds = timerDuration(parsed?.[2] || (clauses.length === 1 ? normalizeCommand(clarification).replace(/^(?:in|for) /, '') : ''));
      if (!seconds) return parsed ? null : ask('When should I remind you to ' + title + '?');
      execute('create_reminder', { title, seconds }); continue;
    }
    const chore = text.match(/^(?:add|create) (.+?) (?:as a chore|to (?:the |our )?(?:household )?chore list)$/);
    if (chore) { execute('add_chore', { title: chore[1] }); continue; }
    if (/^(?:show|open|display|pull up)(?: me)? (?:the |my )?(?:demo |sample )?calendar(?: (?:for )?(?:today|tomorrow|this week|the week))?$/.test(text)) {
      execute('preview_calendar', { ...(clauses.length > 1 ? { query: raw } : {}), range: /\bweek\b/.test(text) ? 'week' : 'day', ...(/\b(?:demo|sample)\b/.test(text) ? { demo: true } : {}) }); continue;
    }
    if (/^(?:close|hide|dismiss)(?: the| my)? calendar(?: preview)?$/.test(text)) { execute('hide_calendar'); continue; }
    if (/^(?:what time is it|tell me the time|show the time)$/.test(text)) { execute('get_time'); continue; }
    if (/^(?:show|list)(?: my| the)? timers$/.test(text)) { execute('list_timers'); continue; }
    return null;
  }
  return { steps, question: '', continue: false };
}
