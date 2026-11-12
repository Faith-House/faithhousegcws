import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT } from './voice-config.mjs';
import { normalizeCommand } from './local-actions.mjs';

const allowedOperations = { light: ['turn_on', 'turn_off', 'brightness', 'status'], media_player: ['turn_on', 'turn_off', 'media_pause', 'media_play', 'volume_mute', 'status'] };
function privateEndpoint(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(host) || /^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host) || host.endsWith('.local');
    if (!local || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url;
  } catch { return null; }
}
function validateDevices(value) {
  if (!Array.isArray(value) || value.length > 80) throw new Error('Invalid device list.');
  const aliases = new Set();
  return value.map(device => {
    const domain = device.entityId?.split('.')[0];
    if (!allowedOperations[domain] || !/^(light|media_player)\.[a-z0-9_]+$/.test(device.entityId) || !Array.isArray(device.aliases) || !device.aliases.length || typeof device.label !== 'string' || !device.label.trim() || device.label.length > 70 || !Array.isArray(device.operations) || device.operations.some(operation => !allowedOperations[domain].includes(operation)) || !['shared', 'private'].includes(device.access)) throw new Error('Invalid device entry.');
    for (const alias of device.aliases) {
      if (typeof alias !== 'string' || !/^[a-z0-9][a-z0-9 -]{0,59}$/.test(alias) || aliases.has(alias)) throw new Error('Device aliases must be unique simple lowercase names.');
      aliases.add(alias);
    }
    return { entityId: device.entityId, domain, aliases: device.aliases, label: device.label, operations: device.operations, access: device.access };
  });
}

export function createHomeAssistant({ url = process.env.JARVIS_HA_URL || '', token = process.env.JARVIS_HA_TOKEN || '', devicesPath = path.join(APP_ROOT, 'private', 'devices.json'), devices: suppliedDevices, fetchImpl = fetch, timeoutMs = 6000, verifyDelayMs = 350 } = {}) {
  const base = privateEndpoint(url);
  let devicesPromise;
  async function devices() {
    if (!devicesPromise) devicesPromise = (async () => {
      try { return { devices: validateDevices(suppliedDevices ?? JSON.parse(await readFile(devicesPath, 'utf8'))), error: false }; }
      catch (error) { return { devices: [], error: error.code !== 'ENOENT' }; }
    })();
    return devicesPromise;
  }
  const configured = () => Boolean(base && token);
  async function request(endpoint, { method = 'GET', body, signal } = {}) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(new URL(endpoint, base), { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error('Home Assistant request failed.');
    return response.json();
  }
  async function status({ checkConnection = false } = {}) {
    const list = await devices();
    let connected = false;
    if (configured() && checkConnection) { try { await request('/api/'); connected = true; } catch { /* Credentials and errors remain server-side. */ } }
    return { configured: configured(), connected, checked: checkConnection && configured(), configurationError: Boolean(url && !base) || list.error, exposedDevices: list.devices.filter(device => device.access === 'shared').map(device => ({ label: device.label, aliases: device.aliases, operations: device.operations })), privateDeviceCount: list.devices.filter(device => device.access === 'private').length, locksEnabled: false };
  }
  async function handle({ question, signal }) {
    const command = normalizeCommand(question).replace(/ percent\b/g, '%');
    // Personal identity is not established by a microphone's room.
    if (/^(?:unlock|lock|open|close)\b.*\b(?:door|lock|garage)\b/.test(command)) return { answer: 'Door controls need authenticated personal access and have not been enabled. Use the lock or its trusted app for now.', kind: 'device' };
    let match, target, operation, argument;
    if ((match = command.match(/^(?:turn|switch) (on|off) (?:the )?(.+)$/))) { operation = match[1] === 'on' ? 'turn_on' : 'turn_off'; target = match[2]; }
    else if ((match = command.match(/^(?:turn|switch) (?:the )?(.+?) (on|off)$/))) { operation = match[2] === 'on' ? 'turn_on' : 'turn_off'; target = match[1]; }
    else if ((match = command.match(/^(?:dim|set) (?:the )?(.+?) (?:to )?(\d{1,3})\s*%$/))) { operation = 'brightness'; target = match[1]; argument = Number(match[2]); }
    else if ((match = command.match(/^(pause|resume|mute|unmute) (?:the )?(.+)$/))) { operation = { pause: 'media_pause', resume: 'media_play', mute: 'volume_mute', unmute: 'volume_mute' }[match[1]]; argument = match[1] === 'mute'; target = match[2]; }
    else if ((match = command.match(/^(?:check|show) (?:the )?(.+?) status$/))) { operation = 'status'; target = match[1]; }
    else return null;
    const list = await devices();
    const device = list.devices.find(item => item.aliases.includes(target));
    if (!device) {
      // Never let an unmatched device command become a claimed model action.
      if (list.error) return { answer: 'The device configuration needs attention. No device action was sent.', kind: 'device' };
      return { needsInterpretation: configured(), answer: configured() ? 'I could not match an approved device name. Use one of the names in House setup.' : "The home controls aren't connected yet. Home Assistant and an approved device list are needed first.", kind: 'device' };
    }
    if (device.access !== 'shared') return { answer: 'That is a private device. Personal authentication is required before I can control it.', kind: 'device' };
    if (!configured()) return { answer: "The home controls aren't connected yet. Add the local Home Assistant connection in the setup files first.", kind: 'device' };
    if (!device.operations.includes(operation) || (operation === 'brightness' && (!Number.isInteger(argument) || argument < 0 || argument > 100))) return { answer: 'That action is not approved for this device. No command was sent.', kind: 'device' };
    try {
      if (signal?.aborted) return { answer: 'The device request was cancelled before sending.', kind: 'device' };
      if (operation === 'status') {
        const observed = await request(`/api/states/${device.entityId}`, { signal });
        return { ok: true, answer: `${device.label} reports ${String(observed.state || 'unknown').slice(0, 40)}.`, kind: 'device' };
      }
      const service = operation === 'brightness' ? 'turn_on' : operation;
      const body = { entity_id: device.entityId, ...(operation === 'brightness' ? { brightness_pct: argument } : {}), ...(operation === 'volume_mute' ? { is_volume_muted: argument } : {}) };
      await request(`/api/services/${device.domain}/${service}`, { method: 'POST', body, signal });
      if (verifyDelayMs) await new Promise(resolve => setTimeout(resolve, verifyDelayMs));
      const observed = await request(`/api/states/${device.entityId}`, { signal });
      const verified = operation === 'turn_on' ? !['off', 'unknown', 'unavailable'].includes(observed.state) : operation === 'turn_off' ? observed.state === 'off' : operation === 'brightness' ? observed.state === 'on' && Math.abs((observed.attributes?.brightness ?? -999) / 255 * 100 - argument) <= 3 : operation === 'volume_mute' ? observed.attributes?.is_volume_muted === argument : operation === 'media_pause' ? observed.state === 'paused' : operation === 'media_play' ? observed.state === 'playing' : false;
      return { ok: verified, answer: verified ? `${device.label}: ${operation === 'brightness' ? `brightness is ${argument}%` : operation === 'volume_mute' ? argument ? 'muted' : 'unmuted' : operation.replace('turn_', '').replace('media_', '')}. Home Assistant confirmed the reported state.` : `The request was sent to ${device.label}, but its reported state has not confirmed the change.`, kind: 'device' };
    } catch {
      return { answer: 'I could not confirm the device action with Home Assistant. Check the device before trying again.', kind: 'device' };
    }
  }
  return { status, handle };
}
