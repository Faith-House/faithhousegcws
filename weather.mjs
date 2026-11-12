import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT } from './voice-config.mjs';
import { householdDate } from './chores.mjs';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const codes = { 0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Heavy freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy rain showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms with hail', 99: 'Thunderstorms with heavy hail' };
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const rounded = value => value === null ? 'unavailable' : Math.round(value);
export function isWeatherRequest(text) {
  return /\b(?:weather|forecast|raining|rain (?:today|tomorrow|tonight|this week)|snow (?:today|tomorrow|tonight)|(?:hot|cold|warm|cool) is it outside|temperature outside|outside temperature|need (?:an? |my )?umbrella|hot outside|cold outside)\b/i.test(text) && !/\b(?:search|look up|google)\b.*\b(?:apis?|services?|models?|apps?|websites?)\b/i.test(text) && !/^(?:explain|how (?:does|do|can)|what is (?:a |the )?weather (?:service|model))\b/i.test(text.trim()) && !/\b(?:don't|do not|never)\b/i.test(text);
}
export function weatherIntent(question) {
  const range = /\b(?:week|7 days|seven days)\b/i.test(question) ? 'week' : /\btomorrow\b/i.test(question) ? 'tomorrow' : /\b(?:today|tonight|umbrella)\b/i.test(question) ? 'today' : 'current';
  const place = (question.match(/\bin\s+(.+?)[?.!]*$/i) || question.match(/\bfor\s+(.+?)[?.!]*$/i))?.[1]?.replace(/\s+(?:today|tomorrow|tonight|this week|right now)$/i, '').trim();
  return { range, place: place && !/^(?:today|tomorrow|tonight|this week|the week|7 days|seven days|next 7 days|here|my area|our area)$/i.test(place) ? place : null };
}
export function createWeather({ directory = path.join(APP_ROOT, 'private'), fetchImpl = fetch, now = Date.now, cacheMs = 600000, timeoutMs = 8000 } = {}) {
  let config = null, initialized, broken = false, cached, pending, retryAfter = 0, chain = Promise.resolve();
  const file = path.join(directory, 'weather.json');
  function validLocation(v) { try { return Number.isInteger(v.id) && typeof v.name === 'string' && v.name.length > 0 && v.name.length <= 120 && typeof v.label === 'string' && v.label.length <= 300 && typeof v.timeZone === 'string' && number(v.latitude) !== null && Math.abs(v.latitude) <= 90 && number(v.longitude) !== null && Math.abs(v.longitude) <= 180 && Boolean(new Intl.DateTimeFormat('en', { timeZone: v.timeZone })); } catch { return false; } }
  function initialize() {
    if (!initialized) initialized = (async () => { try { const data = JSON.parse(await readFile(file, 'utf8')); if (!validLocation(data.location) || !['imperial','metric'].includes(data.units)) throw Error(); config = data; } catch (error) { if (error.code !== 'ENOENT') broken = true; } })();
    return initialized;
  }
  async function json(url, signal) {
    const response = await fetchImpl(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    if (!response.ok) { await response.body?.cancel(); throw fail('The weather provider is unavailable. Try again shortly.', 502); }
    const chunks = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.length; if (length > 512000) throw fail('The weather response was too large.', 502); chunks.push(chunk); }
    let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('The weather provider returned an unreadable response.', 502); }
    if (data.error) throw fail('The weather provider could not complete the request.', 502);
    return data;
  }
  function location(raw) {
    const value = { id: raw.id, name: raw.name, label: [raw.name, raw.admin1, raw.country].filter(Boolean).join(', '), latitude: raw.latitude, longitude: raw.longitude, timeZone: raw.timezone };
    if (!validLocation(value)) throw fail('That location did not have valid weather coordinates.', 502); return value;
  }
  async function search(query, signal) {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120 || /[\x00-\x1f\x7f]/.test(query)) throw fail('Enter a city with its state/country, or a postal code.');
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search'); url.searchParams.set('name', query.trim()); url.searchParams.set('count', '5'); url.searchParams.set('language','en');
    const data = await json(url, signal); return (data.results || []).map(location);
  }
  async function configure(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Select a matching city and weather units.');
    const { locationId, units = 'imperial' } = input;
    const task = chain.then(async () => {
      await initialize(); if (broken) throw fail('The saved weather configuration needs attention. The original file has been preserved.',503);
      if (!Number.isInteger(locationId) || locationId <= 0 || !['imperial','metric'].includes(units)) throw fail('Select a matching city and valid weather units.');
      const url = new URL('https://geocoding-api.open-meteo.com/v1/get'); url.searchParams.set('id',locationId);
      const next = { location: location(await json(url)), units };
      await mkdir(directory,{recursive:true}); await writeFile(file+'.tmp',JSON.stringify(next,null,2)+'\n',{mode:0o600}); await rename(file+'.tmp',file);
      config=next;cached=null;retryAfter=0;return status();
    }); chain=task.catch(()=>{}); return task;
  }
  async function status() { await initialize(); const fresh = cached && now()-cached.fetchedAt < cacheMs && cached.location.id === config?.location.id && cached.units === config?.units && cached.today === householdDate(now(),config.location.timeZone); return { configured: Boolean(config), configurationError: broken, provider: 'Open-Meteo', location: config?.location || null, units: config?.units || 'imperial', connected: Boolean(fresh), fetchedAt: fresh ? cached.fetchedAt : null }; }
  async function read({ signal, place = null } = {}) {
    await initialize(); let selected = config;
    if (place) { let matches = await search(place,signal); if (place.includes(',')) { const exact = matches.filter(m => m.name.toLowerCase() === place.split(',')[0].trim().toLowerCase()); if (exact.length === 1) matches = exact; } if (matches.length !== 1) throw fail(matches.length ? 'Which location? Try a city and state or country, such as “weather in '+ matches[0].label +'”.' : 'I could not find that weather location. Try a city and state or country.'); selected = { location: matches[0], units: config?.units || 'imperial' }; }
    if (!selected || broken) throw fail(broken ? 'The saved weather configuration needs attention.' : 'Set your home city on the Weather page first, or ask for weather in a specific city.',409);
    const key = selected.location.id + ':' + selected.units;
    const today = householdDate(now(), selected.location.timeZone);
    if (cached?.key === key && cached.today === today && now()-cached.fetchedAt < cacheMs) return { ...cached };
    if (pending?.key === key && !signal) return pending.promise;
    if (!place && now()<retryAfter) throw fail('The weather provider could not be reached recently. Try again in a minute.',502);
    const task = (async () => {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      for (const [name,value] of Object.entries({ latitude:selected.location.latitude,longitude:selected.location.longitude,timezone:selected.location.timeZone,current:'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',forecast_days:7,timeformat:'unixtime',temperature_unit:selected.units==='imperial'?'fahrenheit':'celsius',wind_speed_unit:selected.units==='imperial'?'mph':'kmh' })) url.searchParams.set(name,value);
      const data = await json(url,signal), current=data.current, daily=data.daily;
      if (!current || data.current_units?.temperature_2m !== (selected.units==='imperial'?'°F':'°C') || number(current.time)===null || Math.abs(now()/1000-current.time)>10800 || number(current.temperature_2m)===null || !Array.isArray(daily?.time) || daily.time.length<2) throw fail('The weather provider returned incomplete or outdated data.',502);
      const days=daily.time.slice(0,7).map((time,i)=>({date:householdDate(time*1000,selected.location.timeZone),condition:codes[daily.weather_code?.[i]]||'Conditions unavailable',high:number(daily.temperature_2m_max?.[i]),low:number(daily.temperature_2m_min?.[i]),rainChance:number(daily.precipitation_probability_max?.[i])}));
      if (days[0].date !== today || new Set(days.map(d=>d.date)).size !== days.length) throw fail('The provider returned an outdated forecast.',502);
      const result={key,today,provider:'Open-Meteo',sourceUrl:'https://open-meteo.com/',fetchedAt:now(),location:selected.location,units:selected.units,temperatureUnit:selected.units==='imperial'?'°F':'°C',windUnit:selected.units==='imperial'?'mph':'km/h',current:{at:current.time*1000,temperature:current.temperature_2m,feelsLike:number(current.apparent_temperature),humidity:number(current.relative_humidity_2m),wind:number(current.wind_speed_10m),condition:codes[current.weather_code]||'Conditions unavailable'},days};
      if (config?.location.id===selected.location.id && config?.units===selected.units) cached=result;
      return result;
    })();
    if (!signal) pending={key,promise:task};
    try { return await task; } catch(error) { if (!place && !signal?.aborted) retryAfter=now()+60000; if (signal?.aborted) throw signal.reason; throw error.status?error:fail('I could not reach the weather service. Check the internet connection and try again.',502); }
    finally { if(pending?.promise===task)pending=null; }
  }
  async function answer(question,{signal}={}) {
    const intent=weatherIntent(question);
    const temperature=(value,unit)=>value===null?'unavailable':Math.round(value)+unit;
    if (/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|next week|next month)\b/i.test(question)) return {ok:false,summary:'I can show current weather, today, tomorrow, or the next seven days. Which would you like?'};
    try {
      const data=await read({signal,place:intent.place}), degree=data.temperatureUnit, day=data.days[intent.range==='tomorrow'?1:0];
      let summary;
      if(intent.range==='current') summary=`In ${data.location.label}, it is ${rounded(data.current.temperature)}${degree} with ${data.current.condition.toLowerCase()}.`+(data.current.feelsLike!==null?` It feels like ${rounded(data.current.feelsLike)}${degree}.`:'')+(data.current.wind!==null?` Wind is ${rounded(data.current.wind)} ${data.windUnit}.`:'');
      else if(intent.range==='week') summary=`Here is the seven-day forecast for ${data.location.label}. `+data.days.slice(0,3).map(d=>`${new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(d.date+'T12:00:00Z'))}: ${d.condition.toLowerCase()}, high ${temperature(d.high,degree)} and low ${temperature(d.low,degree)}.`).join(' ');
      else summary=`${intent.range==='tomorrow'?'Tomorrow':'Today'} in ${data.location.label}: ${day.condition.toLowerCase()}, high ${temperature(day.high,degree)} and low ${temperature(day.low,degree)}.`+(day.rainChance!==null?` The maximum daily precipitation probability is ${rounded(day.rainChance)}%.`:'');
      return {ok:true,summary,patch:{calendarPreview:null,weatherPreview:{...data,range:intent.range}}};
    } catch(error) { if(signal?.aborted)throw signal.reason;return {ok:false,summary:error.status?error.message:'I could not retrieve a weather forecast. Please try again.'}; }
  }
  return {initialize,status,search,configure,read,answer};
}
