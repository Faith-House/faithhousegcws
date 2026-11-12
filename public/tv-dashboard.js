const $ = id => document.getElementById(id);
const element = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const roomName = id => id === 'living-room' ? 'Living room' : `Bedroom ${id.split('-').at(-1)}`;
const gb = value => `${(value / 1073741824).toFixed(1)} GB`;

export class RoomDashboard {
  constructor({ hud, onUnauthorized }) {
    this.hud = hud; this.onUnauthorized = onUnauthorized; this.active = false; this.timeZone = 'America/Chicago'; this.offset = 0; this.generation = 0;
  }
  setView(show) {
    if (show === this.active) return;
    this.generation++;
    this.active = show;
    document.documentElement.classList.toggle('dashboard-document', show);
    document.body.classList.toggle('dashboard-layout', show); document.body.classList.toggle('tv-dashboard-view', show);
    $('tv-dashboard').hidden = !show; $('minimal-stage').hidden = show;
    (show ? $('tv-core-slot') : $('minimal-stage')).append(this.hud);
    window.scrollTo(0, 0);
    clearInterval(this.polling); clearInterval(this.clock);
    if (show) {
      $('tv-dashboard-updated').textContent = 'Refreshing local status';
      void this.refresh(); this.polling = setInterval(() => { if (!document.hidden) void this.refresh(); }, 5000);
      this.clock = setInterval(() => this.tick(), 1000);
    } else {
      this.controller?.abort(); this.data = null;
      $('dashboard-timers').replaceChildren(element('p', 'Checking timers…', 'card-copy'));
      $('tv-screen-info').replaceChildren();
    }
  }
  updateState(state) {
    if (!this.active) return;
    $('tv-reactor-state').lastChild.nodeValue = { listening: 'Listening', thinking: 'Thinking', answering: 'Answering', speaking: 'Speaking', error: 'Needs attention' }[state] || 'Dashboard';
    $('tv-mode-caption').textContent = state === 'listening' ? 'Listening to your question…' : 'Say “Back to Jarvis” to close the dashboard.';
  }
  async refresh() {
    if (!this.active || this.pending) return;
    this.pending = true; const generation = this.generation, controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/dashboard', { cache: 'no-store', signal: controller.signal });
      if (!this.active || generation !== this.generation) return;
      if (response.status === 401) { this.onUnauthorized(); return; }
      if (response.status === 403) { this.setView(false); return; }
      if (!response.ok) throw new Error('Status unavailable');
      const info = await response.json(); if (!this.active || generation !== this.generation) return;
      this.data = info; this.offset = info.checkedAt - Date.now();
      try { new Intl.DateTimeFormat('en', { timeZone: info.timeZone }).format(); this.timeZone = info.timeZone; } catch { /* Keep a valid local timezone. */ }
      const ready = Boolean(info.ai?.available && info.ai?.modelInstalled);
      $('overall-status').lastElementChild.textContent = ready ? 'Local AI ready · Read only' : 'Local AI needs attention';
      $('overall-status').classList.toggle('warning', !ready); $('ai-dot').className = `status-dot${ready ? '' : ' muted'}`;
      $('ai-label').textContent = ready ? `${info.ai.model} · local` : 'AI unavailable'; $('voice-label').textContent = info.speech.available ? 'Neural voice · local' : 'Voice unavailable';
      const metric = (id, value, detail) => {
        $(id + '-value').textContent = Number.isFinite(value) ? `${value}%` : '—'; $(id + '-detail').textContent = detail;
        $(id + '-bar').style.width = `${Number.isFinite(value) ? value : 0}%`; $(id + '-bar').classList.toggle('warning', value >= 85);
      };
      const percent = (used, total) => total > 0 ? Math.max(0, Math.min(100, Math.round(used / total * 100))) : null;
      const host = info.system;
      metric('cpu', host?.cpuPercent, 'Measured on the central computer');
      metric('memory', host ? percent(host.memory.usedBytes, host.memory.totalBytes) : null, host ? `${gb(host.memory.usedBytes)} of ${gb(host.memory.totalBytes)} in use` : 'Memory reading unavailable');
      metric('storage', host?.storage ? percent(host.storage.usedBytes, host.storage.totalBytes) : null, host?.storage ? `${gb(host.storage.freeBytes)} free` : 'Storage reading unavailable');
      const network = info.network, fresh = network && info.checkedAt - network.checkedAt < 120000;
      $('network-value').textContent = !fresh ? 'Not checked recently' : network.connected ? network.adapter || 'Connected' : 'Not connected';
      $('network-dot').className = `status-dot${fresh && network.connected ? '' : ' muted'}`;
      $('network-detail').textContent = !fresh ? 'Network readings come from the central computer’s latest check.' : network.gatewayResponds ? `Gateway answered${Number.isFinite(network.gatewayLatencyMs) ? ` in ${network.gatewayLatencyMs} ms` : ''}.` : 'The gateway did not answer a ping.';
      for (const [id, value] of [['network-down', network?.downloadKbps], ['network-up', network?.uploadKbps]]) $(id).textContent = fresh && Number.isFinite(value) ? value >= 1000 ? `${(value / 1000).toFixed(1)} Mb/s` : `${value} Kb/s` : '—';
      const profiles = info.profiles;
      $('dashboard-housemates').replaceChildren(...(profiles ? profiles.map(profile => { const row = element('div', undefined, 'housemate'); row.append(element('span', profile.name[0], 'housemate-avatar'), element('strong', profile.name)); return row; }) : [element('p', 'Housemate status unavailable.', 'card-copy')]));
      const room = info.rooms[0]?.id;
      $('tv-room-label').textContent = room ? `${roomName(room).toUpperCase()} · READ ONLY` : 'READ ONLY';
      $('tv-screen-info').replaceChildren(...(info.displays?.devices || []).map(screen => { const row = element('div', undefined, 'housemate'), label = element('div'); label.append(element('strong', screen.name), element('small', `${roomName(screen.room)} · ${screen.receiving ? 'receiving' : 'paired'}`)); row.append(element('span', '', `status-dot${screen.receiving ? '' : ' muted'}`), label); return row; }));
      $('ha-label').textContent = info.homeAssistant?.connected ? 'Connected' : 'Not connected';
      $('calendar-state').textContent = info.services.calendar ? 'Connected' : 'Not connected';
      $('weather-state').textContent = info.weather?.data ? Math.round(info.weather.data.current.temperature) + info.weather.data.temperatureUnit + ' · ' + info.weather.data.location.name : info.weather?.configured ? 'Temporarily unavailable' : 'No weather feed connected';
      $('weather-state').title = info.weather?.data ? info.weather.data.current.condition + ' · Open-Meteo' : info.weather?.error || 'Choose your city on the Weather page.';
      $('phone-state').textContent = info.services.phone ? 'Connected' : 'Not connected';
      $('tv-dashboard-updated').textContent = `Checked ${new Intl.DateTimeFormat('en-US', { timeZone: this.timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(info.checkedAt))}`;
      this.tick();
    } catch { if (this.active) $('tv-dashboard-updated').textContent = 'Waiting for the central computer…'; }
    finally { clearTimeout(timeout); this.pending = false; if (this.active && generation !== this.generation) void this.refresh(); }
  }
  tick() {
    if (!this.active || !this.data) return;
    const now = new Date(Date.now() + this.offset);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: this.timeZone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(now);
    const part = name => parts.find(item => item.type === name)?.value || '';
    $('dashboard-clock').textContent = `${part('hour')}:${part('minute')}`; $('dashboard-seconds').textContent = part('second'); $('dashboard-period').textContent = part('dayPeriod');
    $('dashboard-date').textContent = new Intl.DateTimeFormat('en-US', { timeZone: this.timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
    $('clock-zone').textContent = this.timeZone.split('/').at(-1).replaceAll('_', ' ').toUpperCase();
    const host = this.data.system;
    if (host) { const sec = host.uptimeSeconds + Math.max(0, Math.floor((now.getTime() - host.checkedAt) / 1000)); $('dashboard-uptime').textContent = [Math.floor(sec / 3600), Math.floor(sec % 3600 / 60), sec % 60].map(value => String(value).padStart(2, '0')).join(':'); }
    const timers = this.data.timers;
    const running = timers?.timers.filter(timer => timer.endsAt > now.getTime()) || [];
    $('dashboard-timers').replaceChildren(...(!timers?.available ? [element('p', 'Timer status unavailable.', 'card-copy')] : !running.length ? [element('p', 'No active timers in this room.', 'card-copy')] : running.map(timer => { const row = element('div', undefined, 'timer-entry'), label = element('div'); label.append(element('strong', timer.label || 'Timer')); const seconds = Math.max(0, Math.ceil((timer.endsAt - now.getTime()) / 1000)); row.append(label, element('time', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`)); return row; })));
  }
  destroy() { clearInterval(this.polling); clearInterval(this.clock); this.controller?.abort(); }
}
