const element = (tag, className, text) => {
  const el = document.createElement(tag); el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const rendered = new WeakMap();
const dateLabel = date => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(date + 'T12:00:00Z'));
function weatherArt(condition) {
  const art = element('div', 'weather-art'); art.setAttribute('aria-hidden', 'true');
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200'); svg.setAttribute('fill', 'none');
  const shape = (tag, attrs, parent = svg) => { const node = document.createElementNS(ns, tag); for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value); parent.append(node); return node; };
  const orbit = shape('g', { class: 'weather-orbit' });
  shape('circle', { cx: 100, cy: 100, r: 88, 'stroke-dasharray': '60 18 8 18' }, orbit);
  shape('circle', { cx: 100, cy: 100, r: 75, 'stroke-dasharray': '2 12' }, orbit);
  const icon = shape('g', { class: 'weather-icon' }), cloudy = /cloud|overcast|rain|drizzle|snow|thunder|fog/i.test(condition);
  if (!cloudy || /partly|mostly/i.test(condition)) {
    shape('circle', { cx: cloudy ? 77 : 100, cy: cloudy ? 74 : 100, r: 26 }, icon);
    for (let i = 0; i < 8; i++) { const angle = i * Math.PI / 4, x = cloudy ? 77 : 100, y = cloudy ? 74 : 100; shape('line', { x1: x + Math.cos(angle) * 36, y1: y + Math.sin(angle) * 36, x2: x + Math.cos(angle) * 46, y2: y + Math.sin(angle) * 46 }, icon); }
  }
  if (cloudy) shape('path', { d: 'M59 124 C36 122 36 91 59 89 C60 59 104 54 115 81 C144 72 168 98 150 119 C146 124 139 126 130 126 H59', class: 'weather-cloud' }, icon);
  if (/rain|drizzle/i.test(condition)) for (const x of [72, 100, 128]) shape('path', { d: `M${x} 139 l-7 15` }, icon);
  if (/snow/i.test(condition)) for (const x of [72, 100, 128]) { shape('path', { d: `M${x - 5} 146 h10 M${x} 141 v10` }, icon); }
  if (/thunder/i.test(condition)) shape('path', { d: 'M108 130 L91 149 H107 L96 169' }, icon);
  if (/fog/i.test(condition)) shape('path', { d: 'M55 141 H145 M68 154 H132' }, icon);
  art.append(svg); return art;
}
function source(data) {
  const foot = element('footer', 'weather-source'), link = element('a', '', 'Open-Meteo');
  link.href = 'https://open-meteo.com/'; link.target = '_blank'; link.rel = 'noopener noreferrer';
  foot.append(element('span', '', 'FORECAST DATA / '), link, element('span', '', ' · GeoNames location · Updated ' + new Intl.DateTimeFormat('en-US', { timeZone: data.location.timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(data.fetchedAt))));
  return foot;
}
function dailyReport(root, data, range) {
  const day = range === 'tomorrow' ? data.days[1] : range === 'day' ? data.days.find(day => day.date === data.selectedDate) : data.days[0];
  if (!day) { root.append(element('p', 'weather-small', 'This day is outside the available forecast.')); return; }
  const live = (range === 'current' || range === 'today' || day.date === data.today) && day.date === data.today;
  const condition = live ? data.current.condition : day.condition;
  const temperature = value => Number.isFinite(value) ? Math.round(value) + '°' : '—';
  const header = element('header', 'weather-heading weather-daily-heading'), heading = element('div', '');
  heading.append(element('p', 'weather-eyebrow', 'JARVIS / DAILY WEATHER'), element('h2', '', data.location.label), element('p', 'weather-report-date', (range === 'tomorrow' ? 'Tomorrow · ' : range === 'today' || range === 'current' ? 'Today · ' : '') + dateLabel(day.date)));
  header.append(heading);
  if (root.closest('.hud') && !document.body.classList.contains('tv-receiver')) {
    const close = element('button', 'weather-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close weather report');
    close.addEventListener('click', () => document.dispatchEvent(new CustomEvent('jarvis:close-weather'))); header.append(close);
  }
  const hero = element('div', 'weather-daily-hero'), reading = element('div', 'weather-daily-reading');
  reading.append(element('p', 'weather-reading-label', live ? 'CURRENT TEMPERATURE / ' + data.temperatureUnit : 'FORECAST HIGH / ' + data.temperatureUnit), element('strong', 'weather-daily-temperature', temperature(live ? data.current.temperature : day.high)), element('p', 'weather-daily-condition', condition));
  if (live && Number.isFinite(data.current.feelsLike)) reading.append(element('p', 'weather-feels-like', 'Feels like ' + temperature(data.current.feelsLike)));
  else reading.append(element('p', 'weather-feels-like', 'Daily outlook · Low ' + temperature(day.low)));
  hero.append(reading, weatherArt(condition));
  const metrics = element('div', 'weather-daily-metrics');
  const metric = (label, value, note) => { const card = element('article', 'weather-daily-metric'); card.append(element('p', 'weather-metric-label', label), element('strong', '', value), element('p', 'weather-small', note)); metrics.append(card); };
  metric('HIGH / LOW', temperature(day.high) + ' / ' + temperature(day.low), 'Daily forecast · ' + data.temperatureUnit);
  metric('PRECIPITATION', Number.isFinite(day.rainChance) ? Math.round(day.rainChance) + '%' : '—', 'Maximum daily probability');
  if (live) {
    metric('WIND', Number.isFinite(data.current.wind) ? Math.round(data.current.wind) + ' ' + data.windUnit : '—', 'Current model estimate');
    metric('HUMIDITY', Number.isFinite(data.current.humidity) ? Math.round(data.current.humidity) + '%' : '—', 'Current relative humidity');
  } else metric('CONDITIONS', day.condition, 'Forecast for ' + dateLabel(day.date));
  root.append(header, hero, metrics, source(data));
}
export function renderWeather(root, data, range = 'week') {
  if (!root) return;
  const daily = Boolean(data && range !== 'week');
  root.hidden = !data; root.dataset.layout = daily ? 'daily' : 'week'; root.dataset.range = range;
  if (root.closest('.hud')) document.body.classList.toggle('has-weather-daily', daily);
  if (!data) { rendered.delete(root); root.replaceChildren(); return; }
  const key = JSON.stringify([data, range]); if (rendered.get(root) === key) return; rendered.set(root, key); root.replaceChildren();
  if (daily) { dailyReport(root, data, range); return; }
  const temperature = value => Number.isFinite(value) ? Math.round(value) + data.temperatureUnit : '—';
  const header = element('header', 'weather-heading'), location = element('div', '');
  location.append(element('p', 'weather-eyebrow', 'OPEN-METEO / SEVEN-DAY FORECAST'), element('h2', '', data.location.label)); header.append(location); root.append(header);
  const current = element('div', 'weather-current'), details = element('div', 'weather-current-detail');
  current.append(element('strong', 'weather-temperature', temperature(data.current.temperature)));
  details.append(element('p', 'weather-condition', data.current.condition), element('p', 'weather-small', 'Feels like ' + temperature(data.current.feelsLike) + (Number.isFinite(data.current.wind) ? ' · Wind ' + Math.round(data.current.wind) + ' ' + data.windUnit : '')));
  const time = new Intl.DateTimeFormat('en-US', { timeZone: data.location.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(data.current.at));
  details.append(element('p', 'weather-small', 'Model-based conditions · ' + time)); current.append(details); root.append(current);
  const grid = element('div', 'weather-days');
  for (const day of data.days) {
    const card = element('article', 'weather-day');
    card.append(element('h3', '', new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(day.date + 'T12:00:00Z'))), element('p', 'weather-day-condition', day.condition), element('p', 'weather-highlow', temperature(day.high) + ' / ' + temperature(day.low)), element('p', 'weather-small', Number.isFinite(day.rainChance) ? Math.round(day.rainChance) + '% precip. chance' : 'Precip. probability unavailable')); grid.append(card);
  }
  root.append(grid, source(data));
}
