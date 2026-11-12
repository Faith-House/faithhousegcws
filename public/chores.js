const $ = id => document.getElementById(id);
const node = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; };
let info, loading = false, mutation = false, signature = '', roster = '';
const say = text => { $('chores-notice').textContent = text; $('chores-notice').hidden = !text; };
async function api(url, body) {
 const response = await fetch(url, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) });
 const data = await response.json(); if (!response.ok) throw Error(data.error || 'The chore could not be saved.'); return data;
}
function people(select, blank = 'Unassigned') { const value = select.value; select.replaceChildren(new Option(blank, ''), ...info.profiles.map(p => new Option(p.name, p.id))); if ([...select.options].some(o => o.value === value)) select.value = value; }
function render(force = false) {
 if (!info) return;
 const tasks = info.chores, owner = $('person-filter').value, state = $('state-filter').value;
 $('open-count').textContent = tasks.filter(t => !t.done).length; $('done-count').textContent = tasks.filter(t => t.done).length; $('overdue-count').textContent = tasks.filter(t => t.overdue).length;
 $('house-date').textContent = info.today + ' · ' + info.timeZone.replaceAll('_', ' ');
 const next = JSON.stringify([tasks, info.today, owner, state]); if (!force && (signature === next || $('chore-list').contains(document.activeElement))) return; signature = next;
 const selected = tasks.filter(t => (owner === 'all' || owner === 'unassigned' && !t.assigneeId || t.assigneeId === owner) && (state === 'all' || state === 'open' && !t.done || state === 'done' && t.done || state === 'overdue' && t.overdue));
 $('chore-list').replaceChildren(...selected.map(item => {
  const row = node('article', 'chore-row' + (item.done ? ' is-done' : '') + (item.overdue ? ' is-overdue' : '')); row.dataset.id = item.id;
  const title = node('h3', '', item.title), meta = node('p', 'chore-meta', (item.overdue ? 'OVERDUE · ' : item.done ? 'DONE · ' : '') + (info.profiles.find(p => p.id === item.assigneeId)?.name || (item.assigneeId ? 'Former housemate' : 'Unassigned')) + (item.dueDate ? ' · Due ' + item.dueDate : ' · No due date'));
  const edit = node('div', 'chore-editor'), personLabel = node('label', '', 'Assigned to'), person = node('select', ''), dateLabel = node('label', '', 'Due date'), date = node('input', '');
  people(person); person.value = item.assigneeId || ''; date.type = 'date'; date.value = item.dueDate || ''; personLabel.append(person); dateLabel.append(date); edit.append(personLabel, dateLabel);
  const actions = node('div', 'chore-actions'), save = node('button', '', 'Save changes'), done = node('button', 'complete', item.done ? 'Reopen' : 'Mark done'); save.type = done.type = 'button';
  done.setAttribute('aria-label', (item.done ? 'Reopen ' : 'Complete ') + item.title); save.setAttribute('aria-label', 'Save changes for ' + item.title);
  async function update(completion) {
   if (mutation) return; mutation = true; save.disabled = done.disabled = true;
   try { await api('/api/chores/update', { id: item.id, version: item.version, assigneeId: person.value || null, dueDate: date.value || null, ...(typeof completion === 'boolean' ? { done: completion } : {}) }); say(typeof completion === 'boolean' ? completion ? 'Chore completed.' : 'Chore reopened.' : 'Assignment and due date saved.'); }
   catch (error) { say(error.message); }
   finally { mutation = false; signature = ''; await refresh(true); save.disabled = done.disabled = false; }
  }
  save.addEventListener('click', () => void update()); done.addEventListener('click', () => void update(!item.done)); actions.append(save, done); row.append(title, meta, edit, actions); return row;
 }));
 if (!selected.length) $('chore-list').append(node('p', 'chore-empty', 'Nothing in this view. Choose another filter or add a chore.'));
}
async function refresh(force = false) {
 if (loading) return; loading = true;
 try {
  const data = await api('/api/chores'); if (!data.available) throw Error('The saved chores file needs attention. Editing is paused; the original file has been preserved.'); info = data;
  const key = JSON.stringify(info.profiles);
  if (key !== roster) { roster = key; people($('chore-person')); const selected = $('person-filter').value; $('person-filter').replaceChildren(new Option('Everyone', 'all'), new Option('Unassigned', 'unassigned'), ...info.profiles.map(p => new Option(p.name, p.id))); if ([...$('person-filter').options].some(o => o.value === selected)) $('person-filter').value = selected; }
  render(force || !$('chores-error').hidden); $('add-chore').disabled = mutation; $('chores-error').hidden = true; $('chore-list').classList.remove('chores-stale');
 } catch (error) { $('chores-error').textContent = error.message + ' Any previous results may be out of date. Refresh after checking the server.'; $('chores-error').hidden = false; $('add-chore').disabled = true; $('chore-list').classList.add('chores-stale'); for (const button of $('chore-list').querySelectorAll('button')) button.disabled = true; }
 finally { loading = false; }
}
$('chore-form').addEventListener('submit', async event => {
 event.preventDefault(); if (mutation) return; mutation = true; $('add-chore').disabled = true;
 try { await api('/api/chores', { title: $('chore-title').value.trim(), assigneeId: $('chore-person').value || null, dueDate: $('chore-date').value || null }); $('chore-title').value = ''; say('Chore added to the household list.'); }
 catch (error) { say(error.message); }
 finally { mutation = false; signature = ''; await refresh(true); }
});
$('person-filter').addEventListener('change', () => render(true)); $('state-filter').addEventListener('change', () => render(true)); $('refresh-chores').addEventListener('click', () => void refresh(true));
void refresh(); const poll = setInterval(() => { if (!document.hidden && !mutation) void refresh(); }, 4000);
window.addEventListener('pagehide', () => clearInterval(poll));
