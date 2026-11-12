const rendered = new WeakMap();
const node = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; };
const dayKey = (instant, timeZone) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return p.year + '-' + p.month + '-' + p.day;
};
export function renderAgenda(preview) {
  const card = document.getElementById('calendar-preview');
  if (!card) return;
  card.hidden = !preview;
  if (!preview) { rendered.delete(card); return; }
  const key = JSON.stringify(preview);
  if (rendered.get(card) === key) return;
  rendered.set(card, key);
  const $ = id => document.getElementById(id);
  const zone = preview.timeZone || 'America/Chicago';
  const week = preview.range === 'week';
  card.dataset.range = week ? 'week' : 'day';
  card.classList.toggle('is-demo', Boolean(preview.demo));
  $('calendar-period').textContent = (preview.demo ? 'DEMO / ' : '') + (week ? 'YOUR WEEK' : 'YOUR DAY');
  const plainDate = text => new Date(text + 'T12:00:00Z');
  const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' });
  const start = plainDate(preview.startDate), end = new Date(plainDate(preview.endDate).valueOf() - 86400000);
  $('calendar-title').textContent = dateFormat.format(start) + (week ? ' — ' + dateFormat.format(end) : '');
  const controls = $('calendar-demo-controls');
  if (controls) controls.hidden = !preview.demo;
  for (const button of card.querySelectorAll('[data-calendar-demo]')) button.setAttribute('aria-pressed', String(button.dataset.calendarDemo === preview.range));
  const validEvents = (preview.events || []).filter(item => item.start && (item.allDay || Number.isFinite(Date.parse(item.start))));
  const today = dayKey(Date.now(), zone), columns = [];
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  for (let i = 0; i < (week ? 7 : 1); i++) {
    const date = new Date(start.valueOf() + i * 86400000), iso = date.toISOString().slice(0, 10);
    const column = node('section', 'agenda-day' + (iso === today ? ' is-today' : ''));
    const heading = node('header', 'agenda-day-heading');
    heading.append(node('span', 'agenda-weekday', new Intl.DateTimeFormat('en-US', { weekday: week ? 'short' : 'long', timeZone: 'UTC' }).format(date)), node('strong', 'agenda-date', String(date.getUTCDate())));
    if (iso === today) heading.append(node('span', 'agenda-today', 'TODAY'));
    column.append(heading);
    const events = validEvents.filter(item => {
      const first = item.allDay ? item.start : dayKey(item.start, zone);
      const last = item.allDay ? item.end || item.start : item.end ? dayKey(Date.parse(item.end) - 1, zone) : first;
      return first <= iso && (item.allDay && item.end ? iso < last : iso <= last);
    });
    for (const item of events) {
      const row = node('article', 'agenda-event');
      const timing = item.allDay ? 'ALL DAY' : time.format(new Date(item.start));
      row.append(node('time', 'agenda-time', timing), node('h4', 'agenda-event-title', item.title || 'Busy'));
      if (!item.allDay && item.end && Number.isFinite(Date.parse(item.end))) row.append(node('span', 'agenda-end', 'Until ' + time.format(new Date(item.end))));
      column.append(row);
    }
    if (!events.length) column.append(node('p', 'agenda-free', 'Open space'));
    columns.push(column);
  }
  $('calendar-events').classList.add('agenda-grid');
  $('calendar-events').replaceChildren(...columns);
  const count = validEvents.length;
  $('calendar-foot').textContent = (preview.demo ? 'DEMO · Fictional events' : 'Shared household calendar') + '  /  ' + count + ' event' + (count === 1 ? '' : 's') + '  /  ' + zone.split('/').at(-1).replaceAll('_', ' ');
}
