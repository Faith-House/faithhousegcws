const $ = id => document.getElementById(id);
const element = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; };
const room = $('room'), params = new URLSearchParams(location.search);
if ([...room.options].some(option => option.value === params.get('room'))) room.value = params.get('room');
let zone = 'America/Chicago', refreshing = false, stopped = false, listSignature = '', saving = false;
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
async function api(url, body) {
  const response = await fetch(url, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The reminder could not be saved.');
  return data;
}
function wallInput(instant) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
}
async function refresh() {
  if (refreshing || stopped) return;
  refreshing = true; const requestedRoom = room.value;
  try {
    const info = await api('/api/reminders?room=' + encodeURIComponent(requestedRoom));
    if (requestedRoom !== room.value) return;
    zone = info.timeZone; $('zone-label').textContent = zone.split('/').at(-1).replaceAll('_', ' ') + ' TIME';
    $('time-help').textContent = 'House time: ' + zone.replaceAll('_', ' ') + ' · Within the next 30 days';
    $('save-reminder').disabled = !info.available || saving;
    if (!info.available) throw new Error('The saved reminders need attention. Adding and clearing are paused.');
    if (!$('when').value) $('when').value = wallInput(info.now + 15 * 60000);
    $('upcoming-count').textContent = info.reminders.filter(item => !item.due).length;
    $('due-count').textContent = info.reminders.filter(item => item.due).length;
    const signature = requestedRoom + JSON.stringify(info.reminders);
    if (signature === listSignature) return; listSignature = signature;
    const rows = info.reminders.map(item => {
      const row = element('article', 'reminder-row' + (item.due ? ' is-due' : ''));
      const date = element('div', 'reminder-date'), instant = new Date(item.dueAt);
      date.append(element('span', '', new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short' }).format(instant)), element('strong', '', new Intl.DateTimeFormat('en-US', { timeZone: zone, day: 'numeric' }).format(instant)));
      const detail = element('div', 'reminder-detail');
      detail.append(element('h3', '', item.title), element('p', '', (item.due ? 'DUE · ' : '') + new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(instant)));
      const clear = element('button', '', item.due ? 'Done' : 'Cancel'); clear.type = 'button'; clear.setAttribute('aria-label', (item.due ? 'Complete ' : 'Cancel ') + item.title);
      clear.addEventListener('click', async () => {
        clear.disabled = true;
        try { await api('/api/reminders/clear', { room: requestedRoom, id: item.id }); listSignature = ''; await refresh(); notice(item.due ? 'Reminder completed.' : 'Reminder cancelled.'); }
        catch (error) { notice(error.message); clear.disabled = false; }
      });
      row.append(date, detail, clear); return row;
    });
    if (!rows.length) {
      const empty = element('div', 'empty-state');
      empty.append(element('div', 'empty-orbit'), element('h3', '', 'A little breathing room.'), element('p', '', 'Nothing to remember here yet. Add a reminder or ask Jarvis to hold the thought.'));
      rows.push(empty);
    }
    $('reminder-list').replaceChildren(...rows);
  } catch (error) { notice(error.message); $('save-reminder').disabled = true; }
  finally { refreshing = false; }
}
$('reminder-form').addEventListener('submit', async event => {
  event.preventDefault(); saving = true; $('save-reminder').disabled = true; notice('');
  try {
    await api('/api/reminders', { room: room.value, title: $('title').value.trim(), localTime: $('when').value });
    $('title').value = ''; listSignature = ''; notice('Saved. Jarvis will alert the selected room when it is due.');
  } catch (error) { notice(error.message); }
  finally { saving = false; await refresh(); }
});
room.addEventListener('change', () => { listSignature = ''; const url = new URL(location.href); url.searchParams.set('room', room.value); history.replaceState(null, '', url); void refresh(); });
void refresh();
const poll = setInterval(() => void refresh(), 3000);
window.addEventListener('pagehide', () => { stopped = true; clearInterval(poll); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
