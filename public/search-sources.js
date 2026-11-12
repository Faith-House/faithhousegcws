let previous = '';
export function renderSearchSources(search) {
  const root = document.getElementById('search-sources');
  if (!root) return;
  const key = JSON.stringify(search || null);
  if (key === previous) return;
  previous = key; root.replaceChildren(); root.hidden = !search?.results?.length;
  if (root.hidden) return;
  const label = document.createElement('p'); label.className = 'search-caption';
  const stamp = new Date(search.searchedAt);
  label.textContent = `${search.provider || 'Web'} search · ${search.summaryMode === 'local-ai' ? 'Local summary of search snippets' : 'Search snippets · AI summary unavailable'}${Number.isFinite(stamp.valueOf()) ? ' · ' + stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}`;
  const list = document.createElement('div'); list.className = 'search-links';
  for (const result of search.results.slice(0, 5)) {
    let url; try { url = new URL(result.url); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
    const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = `${result.id}. ${result.title}`; link.title = url.hostname + ' — ' + result.snippet;
    link.classList.toggle('cited', search.sourceIds?.includes(result.id)); list.append(link);
  }
  root.append(label, list);
}
