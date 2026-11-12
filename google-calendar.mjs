import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const dateText = value => value.year + '-' + String(value.month).padStart(2, '0') + '-' + String(value.day).padStart(2, '0');
const nonce = size => randomBytes(size).toString('base64url');
function equal(a, b) { a = Buffer.from(String(a || '')); b = Buffer.from(String(b || '')); return a.length === b.length && timingSafeEqual(a, b); }
function parts(date, zone) { return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)])); }
function addDays(text, amount) { const date = new Date(text + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function midnight(text, zone) { const [y,m,d] = text.split('-').map(Number), wall = Date.UTC(y,m-1,d); let result = wall; for (let i=0;i<2;i++) { const p=parts(new Date(result),zone); result += wall-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second); } return new Date(result).toISOString(); }
const checkedDate = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const date = new Date(value+'T00:00:00Z'); return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10) === value ? value : null; };

// Fictional display data only: this function never opens a Google connection.
export function createCalendarDemo({ range = 'day', timeZone = 'America/Chicago', now = Date.now() } = {}) {
  if (!['day', 'week'].includes(range)) throw Object.assign(new Error('Choose a day or week demo.'), { status: 400 });
  const today = dateText(parts(new Date(now), timeZone));
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
  const start = range === 'week' ? addDays(today, -((weekday + 6) % 7)) : today;
  const at = (date, hour, minute = 0) => {
    const [y, m, d] = date.split('-').map(Number), wall = Date.UTC(y, m - 1, d, hour, minute);
    let result = wall;
    for (let i = 0; i < 3; i++) { const p = parts(new Date(result), timeZone); result += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second); }
    return new Date(result).toISOString();
  };
  const sample = range === 'day'
    ? [[0, 9, 0, 'Morning lecture'], [0, 13, 30, 'Study group'], [0, 18, 0, 'Dinner with the house']]
    : [[0, 9, 0, 'Morning lecture'], [1, 13, 30, 'Study group'], [2, 16, 0, 'Gym with roommates'], [3, 10, 0, 'Project workshop'], [4, 18, 0, 'Dinner with the house'], [5, 14, 0, 'Grocery run'], [6, 19, 0, 'Plan the week']];
  return { demo: true, range, startDate: start, endDate: addDays(start, range === 'week' ? 7 : 1), timeZone, checkedAt: now,
    events: sample.map(([day, hour, minute, title], i) => ({ id: 'demo-' + i, title, start: at(addDays(start, day), hour, minute), end: at(addDays(start, day), hour + 1, minute), allDay: false })) };
}

export function createGoogleCalendar({ dataDirectory, fetchImpl = fetch, now = Date.now } = {}) {
  const clientFile=path.join(dataDirectory,'google-oauth-client.json'), tokenFile=path.join(dataDirectory,'google-calendar-tokens.json');
  let clientCache, tokenCache, flow, saving=Promise.resolve();
  async function client() {
    if (clientCache !== undefined) return clientCache;
    try { const value=JSON.parse(await readFile(clientFile,'utf8')); clientCache=typeof value.client_id==='string' && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(value.client_id) && typeof value.client_secret==='string' ? value : null; }
    catch { clientCache=null; }
    return clientCache;
  }
  async function tokens() {
    if (tokenCache !== undefined) return tokenCache;
    try { const value=JSON.parse(await readFile(tokenFile,'utf8')); tokenCache=typeof value.refresh_token==='string' ? value : null; }
    catch { tokenCache=null; }
    return tokenCache;
  }
  async function saveTokens(value) {
    saving=saving.catch(()=>{}).then(async()=>{ await mkdir(dataDirectory,{recursive:true,mode:0o700}); const temp=tokenFile+'.tmp'; await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600}); await rename(temp,tokenFile); });
    await saving; tokenCache=value;
  }
  async function status() { const [c,t]=await Promise.all([client(),tokens()]); return {configured:Boolean(c),connected:Boolean(t?.refresh_token),connecting:Boolean(flow && flow.expiresAt>now()),needsSetup:!c}; }
  async function saveDesktopClient(source) {
    if (typeof source==='string') { try { source=JSON.parse(source); } catch { throw Object.assign(new Error('That is not a valid Google OAuth JSON file.'),{status:400}); } }
    const v=source?.installed;
    if (!v || typeof v.client_id!=='string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(v.client_id) || typeof v.client_secret!=='string' || (v.auth_uri && v.auth_uri!==AUTH) || (v.token_uri && v.token_uri!==TOKEN)) throw Object.assign(new Error('Choose the JSON file for a Google Desktop OAuth client.'),{status:400});
    await mkdir(dataDirectory,{recursive:true,mode:0o700}); const temp=clientFile+'.tmp'; await writeFile(temp,JSON.stringify({client_id:v.client_id,client_secret:v.client_secret})+'\n',{mode:0o600}); await rename(temp,clientFile); clientCache=null; tokenCache=undefined; return status();
  }
  function closeFlow(target) { if (!target || flow!==target) return; flow=null; clearTimeout(target.timer); try { target.server.close(); } catch {} }
  async function beginConnect() {
    const c=await client(); if (!c) throw Object.assign(new Error('Add the Google Desktop OAuth JSON file in House setup first.'),{status:409});
    if (flow) closeFlow(flow);
    const state=nonce(32), verifier=nonce(48), challenge=createHash('sha256').update(verifier).digest('base64url');
    const pending={state,verifier,expiresAt:now()+300000};
    pending.server=createServer(async(req,res)=>{
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method!=='GET'||url.pathname!=='/oauth/google/callback'){res.writeHead(404);return res.end('Not found.');}
      if(pending.expiresAt<now()||!equal(url.searchParams.get('state'),state)){res.writeHead(400);return res.end('Google sign-in expired or could not be verified. Return to Jarvis and try again.');}
      if(url.searchParams.has('error')){res.writeHead(400);res.end('Google Calendar was not connected. Return to Jarvis.');closeFlow(pending);return;}
      const code=url.searchParams.get('code');
      try {
        if(!code||code.length>4096)throw new Error();
        const response=await fetchImpl(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:c.client_id,client_secret:c.client_secret,redirect_uri:pending.redirect,grant_type:'authorization_code',code_verifier:verifier}),signal:AbortSignal.timeout(15000)});
        const grant=await response.json(); const previous=await tokens();
        if(!response.ok||(!grant.refresh_token&&!previous?.refresh_token))throw new Error();
        await saveTokens({access_token:grant.access_token,refresh_token:grant.refresh_token||previous.refresh_token,expires_at:now()+Number(grant.expires_in||3600)*1000});
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><meta charset=\"utf-8\"><title>Jarvis Calendar</title><body style=\"font:18px Segoe UI;background:#090805;color:#f1dcc5;padding:10vh\"><h1>Google Calendar is connected to Jarvis.</h1><p>Return to Jarvis to see your preview.</p></body>');
      } catch { res.writeHead(502,{'Content-Type':'text/plain'});res.end('Jarvis could not finish connecting Calendar. Return to House setup and try again.'); }
      finally { closeFlow(pending); }
    });
    await new Promise((resolve,reject)=>{pending.server.once('error',reject);pending.server.listen(0,'127.0.0.1',resolve);});
    pending.redirect='http://127.0.0.1:'+pending.server.address().port+'/oauth/google/callback';
    pending.timer=setTimeout(()=>closeFlow(pending),300000);pending.timer.unref();flow=pending;
    const auth=new URL(AUTH);
    for(const [key,value] of Object.entries({client_id:c.client_id,redirect_uri:pending.redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}))auth.searchParams.set(key,value);
    return {authorizationUrl:auth.href,expiresAt:pending.expiresAt};
  }
  async function accessToken() {
    const [c,t]=await Promise.all([client(),tokens()]);
    if(!c||!t?.refresh_token)throw Object.assign(new Error('Connect Google Calendar in House setup first.'),{status:409});
    if(t.access_token&&t.expires_at>now()+60000)return t.access_token;
    const response=await fetchImpl(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret,refresh_token:t.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(12000)});
    const grant=await response.json();if(!response.ok||typeof grant.access_token!=='string')throw Object.assign(new Error('Google Calendar authorization expired. Reconnect it in House setup.'),{status:401});
    await saveTokens({...t,access_token:grant.access_token,expires_at:now()+Number(grant.expires_in||3600)*1000});return grant.access_token;
  }
  async function request(pathname,query={},body) {
    const url=new URL(API+pathname);for(const [key,value] of Object.entries(query))if(value!==undefined)url.searchParams.set(key,String(value));
    const response=await fetchImpl(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await accessToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok)throw Object.assign(new Error(response.status===401?'Google Calendar authorization expired. Reconnect it in House setup.':'Google Calendar could not complete that request.'),{status:response.status===401?401:502});return data;
  }
  async function preview({range='day',date,timeZone='America/Chicago'}={}) {
    if(!['day','week'].includes(range))throw Object.assign(new Error('Choose a day or week preview.'),{status:400});
    let start=checkedDate(date)||dateText(parts(new Date(now()),timeZone));
    if(range==='week'){const [y,m,d]=start.split('-').map(Number),dow=new Date(Date.UTC(y,m-1,d)).getUTCDay();start=addDays(start,-((dow+6)%7));}
    const end=addDays(start,range==='week'?7:1),data=await request('/calendars/primary/events',{timeMin:midnight(start,timeZone),timeMax:midnight(end,timeZone),singleEvents:true,orderBy:'startTime',maxResults:50,fields:'items(id,summary,start,end,status)'});
    const events=(data.items||[]).filter(x=>x.status!=='cancelled').slice(0,50).map(x=>({id:typeof x.id==='string'?x.id.slice(0,256):'',title:typeof x.summary==='string'&&x.summary.trim()?x.summary.trim().slice(0,140):'Busy',start:x.start?.dateTime||x.start?.date||null,end:x.end?.dateTime||x.end?.date||null,allDay:Boolean(x.start?.date&&!x.start?.dateTime)}));
    return {range,startDate:start,endDate:end,timeZone,events,checkedAt:now()};
  }
  async function addEvent({title,start,end,timeZone='America/Chicago'}={}) {
    const a=new Date(start),b=new Date(end);
    if(typeof title!=='string'||!title.trim()||title.trim().length>120||!Number.isFinite(a.valueOf())||!Number.isFinite(b.valueOf())||b<=a||a<=now()||b-a>43200000||a-now()>31622400000)throw Object.assign(new Error('The event needs a clear title, future start time, and end time. Nothing was added.'),{status:400});
    const event=await request('/calendars/primary/events',{}, {summary:title.trim(),start:{dateTime:a.toISOString(),timeZone},end:{dateTime:b.toISOString(),timeZone}});
    return {id:event.id,title:event.summary||title.trim(),start:event.start?.dateTime||a.toISOString(),end:event.end?.dateTime||b.toISOString()};
  }
  async function close(){if(flow)closeFlow(flow);await saving.catch(()=>{});}
  return {status,saveDesktopClient,beginConnect,preview,addEvent,close};
}
