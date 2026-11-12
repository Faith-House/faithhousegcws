const $ = id => document.getElementById(id);
const labels = { get_weather: 'Read current weather and forecast', list_chores: 'Read household chores', add_chore: 'Add a household chore', update_chore: 'Update a household chore', set_chore_status: 'Complete or reopen a chore', assign_chore: 'Assign a household chore', clarification: 'Clarify the request', diagnose_connections: 'Diagnose connections', search_web: 'Search the internet', preview_calendar_demo: 'Show demo calendar', add_calendar_event: 'Add confirmed calendar event', draft_calendar_event: 'Prepare a calendar event', set_view: 'Dashboard / quiet view', get_time: 'Current time', get_date: 'Today’s date', start_timer: 'Start a timer', list_timers: 'Read active timers', cancel_timer: 'Cancel timers', create_reminder: 'Save a reminder', list_reminders: 'Read reminders', cancel_reminder: 'Clear a reminder', check_network: 'Check the computer’s network', get_system_status: 'Computer health', preview_calendar: 'Calendar preview', hide_calendar: 'Close calendar preview', list_devices: 'List shared devices', control_device: 'Control approved device' };
const statuses = { running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Interrupted', waiting: 'Needs details' };
let entries = [], request, epoch = 0, signature = '', busy = false;
const requestedRoom = new URLSearchParams(location.search).get('room');
if (Array.from($('tools-room').options).some(o => o.value === requestedRoom)) $('tools-room').value = requestedRoom;
function render() {
  for (const [status, id] of [['running', 'count-running'], ['completed', 'count-completed'], ['failed', 'count-failed']]) $(id).textContent = entries.filter(e => e.status === status).length;
  $('activity-count').textContent = entries.length + ' attempt' + (entries.length === 1 ? '' : 's');
  const filter = $('activity-filter').value, selected = entries.filter(e => filter === 'all' || e.status === filter).slice().reverse();
  const key = JSON.stringify([filter, selected]); if (key === signature) return; signature = key;
  $('tool-activity').replaceChildren(...selected.map(item => {
    const row = document.createElement('li'); row.className = 'activity-item'; row.dataset.status = item.status;
    const mark = document.createElement('span'); mark.className = 'activity-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = { running: '◌', completed: '✓', failed: '!', cancelled: '−', waiting: '?' }[item.status] || '·';
    const content = document.createElement('div'), heading = document.createElement('div'); heading.className = 'activity-heading';
    const title = document.createElement('h3'); title.textContent = labels[item.tool] || item.tool;
    const badge = document.createElement('span'); badge.className = 'activity-badge'; badge.textContent = statuses[item.status] || 'Unknown'; heading.append(title, badge);
    const meta = document.createElement('p'); meta.className = 'activity-meta';
    const duration = Number.isFinite(item.durationMs) ? item.durationMs < 1000 ? item.durationMs + ' ms' : (item.durationMs / 1000).toFixed(1) + ' s' : 'In progress';
    meta.textContent = new Date(item.startedAt).toLocaleTimeString() + ' · ' + (item.source === 'planner' ? 'AI-planned' : 'Direct command') + ' · ' + duration;
    const detail = document.createElement('p'); detail.className = 'activity-detail'; detail.textContent = { running: 'Waiting for the tool’s result.', completed: 'The tool returned its result.', failed: 'The tool did not confirm completion. Check Jarvis’s response or Connection diagnostics.', cancelled: 'This request was stopped. Earlier completed changes remain in place.', waiting: 'More details or an approved action are needed.' }[item.status] || '';
    content.append(heading, meta, detail); row.append(mark, content); return row;
  }));
  if (!selected.length) { const empty = document.createElement('li'); empty.className = 'activity-empty'; empty.textContent = entries.length ? 'No attempts match this filter.' : 'No tool activity yet in this room. Ask Jarvis to check the time or search the web.'; $('tool-activity').append(empty); }
}
async function refresh() {
  if (busy) return; busy = true; const version = epoch, room = $('tools-room').value;
  request = new AbortController();
  try {
    const response = await fetch('/api/activity?room=' + encodeURIComponent(room), { signal: AbortSignal.any([request.signal, AbortSignal.timeout(6000)]) });
    if (!response.ok) throw Error('Activity unavailable');
    const data = await response.json(); if (version !== epoch) return;
    entries = data.entries; render(); $('activity-updated').textContent = 'Updated ' + new Date(data.checkedAt).toLocaleTimeString(); $('tools-error').hidden = true; $('tool-activity').classList.remove('is-stale');
  } catch {
    if (version !== epoch) return;
    $('tools-error').textContent = 'Activity is disconnected. Previous entries may be out of date. Check that the Jarvis server is running, then refresh.'; $('tools-error').hidden = false; $('activity-updated').textContent = 'Disconnected'; $('tool-activity').classList.add('is-stale');
  } finally { if (version === epoch) busy = false; }
}
async function catalog() {
  try {
    const response = await fetch('/api/tools?room=' + encodeURIComponent($('tools-room').value), { signal: AbortSignal.timeout(8000) }); if (!response.ok) throw Error();
    const data = await response.json(); $('planner-model').textContent = data.model + ' · running on this computer';
    $('tools-list').replaceChildren(...data.tools.map(tool => { const row = document.createElement('div'), name = document.createElement('dt'), state = document.createElement('dd'); name.textContent = labels[tool.name] || tool.name; state.textContent = 'Available'; row.append(name, state); return row; }));
  } catch { $('planner-model').textContent = 'The tool catalog is unavailable. Check Connection diagnostics.'; }
}
$('tools-room').addEventListener('change', () => { epoch++; request?.abort(); busy = false; entries = []; signature = ''; render(); const url = new URL(location.href); url.searchParams.set('room', $('tools-room').value); history.replaceState(null, '', url); void refresh(); });
$('activity-filter').addEventListener('change', render);
$('activity-refresh').addEventListener('click', () => void refresh());
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
void refresh(); void catalog(); const interval = setInterval(() => { if (!document.hidden) void refresh(); }, 1500);
window.addEventListener('pagehide', () => { request?.abort(); clearInterval(interval); });
