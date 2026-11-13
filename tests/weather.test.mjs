import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWeather,weatherIntent,isWeatherRequest } from '../weather.mjs';
import { createJarvisServer } from '../server.mjs';
const city={id:4887398,name:'Chicago',admin1:'Illinois',country:'United States',latitude:41.85,longitude:-87.65,timezone:'America/Chicago'};
async function fixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-weather-'));let stamp=Date.parse('2026-11-11T18:00:00Z'),fail=false,forecasts=0,missing=false;
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const u=new URL(url);calls.push(u.href);options?.signal?.throwIfAborted();if(fail)throw Error('Network failed');
  if(u.pathname==='/v1/search')return Response.json({results:u.searchParams.get('name')==='Paris'?[city,{...city,id:1,name:'Paris'}]:[city]});
  if(u.pathname==='/v1/get')return Response.json(city);
  forecasts++;const imperial=u.searchParams.get('temperature_unit')==='fahrenheit';
  const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
  const start=Date.parse(localDate+'T06:00:00Z')/1000;
  return Response.json({current_units:{temperature_2m:imperial?'°F':'°C'},current:{time:stamp/1000,temperature_2m:missing?null:imperial?50:10,apparent_temperature:48,weather_code:2,wind_speed_10m:6,relative_humidity_2m:60},daily:{time:Array.from({length:7},(_,i)=>start+i*86400),weather_code:[2,61,3,0,0,0,0],temperature_2m_max:[55,58,60,61,62,63,64],temperature_2m_min:[40,42,43,44,45,46,47],precipitation_probability_max:[0,80,null,0,0,0,0]}});
 };
 const weather=createWeather({directory,fetchImpl,now:()=>stamp});
 return{weather,directory,fetchImpl,calls,setNow:n=>{stamp=n;},setFail:()=>{fail=true;},setMissing:()=>{missing=true;},count:()=>forecasts};
}
test('weather intent distinguishes current, tomorrow, week and explicit cities',()=>{
 assert.deepEqual(weatherIntent('Forecast for tomorrow in Chicago'),{range:'tomorrow',place:'Chicago'});
 assert.deepEqual(weatherIntent('Show the weather for this week'),{range:'week',place:null});
 assert.equal(isWeatherRequest('Will it rain tomorrow?'),true);assert.equal(isWeatherRequest('Do I need an umbrella?'),true);
 assert.equal(isWeatherRequest('Explain how weather models work'),false);
});
test('no location is guessed; saved city and units persist without an API key',async()=>{
 const f=await fixture();assert.equal((await f.weather.status()).configured,false);
 assert.equal((await f.weather.answer('What is the weather?')).ok,false);assert.equal(f.calls.length,0);
 await f.weather.configure({locationId:city.id,units:'metric'});
 const restored=createWeather({directory:f.directory,fetchImpl:f.fetchImpl});assert.equal((await restored.status()).location.name,'Chicago');assert.equal((await restored.status()).units,'metric');
 const data=await f.weather.read();assert.equal(data.temperatureUnit,'°C');assert.equal(data.current.temperature,10);
 assert.ok(f.calls.every(url=>!url.includes('apikey')));
});
test('current, day and seven-day answers use provider data and cache bounded requests',async()=>{
 const f=await fixture();await f.weather.configure({locationId:city.id});
 const current=await f.weather.answer('What is the weather?');assert.match(current.summary,/50°F/);assert.equal(current.patch.weatherPreview.range,'current');
 const tomorrow=await f.weather.answer('Will it rain tomorrow?');assert.match(tomorrow.summary,/58°F/);assert.match(tomorrow.summary,/80%/);
 const week=await f.weather.answer('Forecast for this week');assert.equal(week.patch.weatherPreview.days.length,7);assert.equal(f.count(),1);
 assert.equal((await f.weather.read()).days[0].rainChance,0);assert.equal((await f.weather.read()).days[2].rainChance,null);
 f.setNow(Date.parse('2026-11-11T18:11:00Z'));await f.weather.read();assert.equal(f.count(),2);
});
test('outages, missing measurements and ambiguous cities never become fabricated weather',async()=>{
 const f=await fixture();await f.weather.configure({locationId:city.id});
 const ambiguous=await f.weather.answer('Weather in Paris');assert.equal(ambiguous.ok,false);assert.match(ambiguous.summary,/Which location/);
 f.setMissing();assert.equal((await f.weather.answer('Weather now')).ok,false);
 const outage=await fixture();await outage.weather.configure({locationId:city.id});await outage.weather.read();outage.setNow(Date.parse('2026-11-11T18:11:00Z'));outage.setFail();
 assert.equal((await outage.weather.answer('Weather now')).ok,false);assert.equal((await outage.weather.status()).connected,false);
});
test('corrupt configuration is preserved and cancellation is propagated',async()=>{
 const f=await fixture();await writeFile(path.join(f.directory,'weather.json'),'broken original');const broken=createWeather({directory:f.directory,fetchImpl:f.fetchImpl});assert.equal((await broken.status()).configurationError,true);await assert.rejects(broken.configure({locationId:city.id}));assert.equal(await readFile(path.join(f.directory,'weather.json'),'utf8'),'broken original');
 const other=await fixture();await other.weather.configure({locationId:city.id});const controller=new AbortController();controller.abort(Error('cancelled'));await assert.rejects(other.weather.answer('Weather now',{signal:controller.signal}),/cancelled/);
});
test('server routes weather before internet search and restricts location writes to same origin',async()=>{
 const f=await fixture();let searches=0;
 const app=createJarvisServer({displayBind:'',actionsOptions:{dataDirectory:f.directory},pairingOptions:{directory:f.directory},weatherOptions:{fetchImpl:f.fetchImpl,now:()=>Date.parse('2026-11-11T18:00:00Z')},webSearch:{status:()=>({enabled:true}),answer:async()=>{searches++;return{ok:false};}},speech:{listVoices:async()=>({available:false}),close(){}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const post=(url,body,headers)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/weather')).status,200);assert.equal((await fetch(base+'/api/weather')).status,200);
  assert.equal((await post('/api/weather/location',{locationId:city.id},{Origin:'https://other.example'})).status,403);
  assert.equal((await post('/api/weather/location',{locationId:city.id})).status,200);
  const controller=new AbortController(),events=await fetch(base+'/api/events?room=living-room',{signal:controller.signal});const accepted=await(await post('/api/ask',{room:'living-room',question:'What is the weather tomorrow?'})).json();let buffer='',answer;
  try{outer:for await(const chunk of events.body){buffer+=new TextDecoder().decode(chunk);let at;while((at=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,at);buffer=buffer.slice(at+2);if(!packet.startsWith('data: '))continue;const s=JSON.parse(packet.slice(6));if(s.requestId===accepted.requestId&&['ready','error'].includes(s.state)){answer=s;break outer;}}}}finally{controller.abort();}
  assert.equal(answer.resultKind,'weather');assert.equal(answer.weatherPreview.range,'tomorrow');assert.equal(searches,0);
  const activity=await(await fetch(base+'/api/activity?room=living-room')).json();assert.ok(activity.entries.some(e=>e.tool==='get_weather'&&e.status==='completed'));
 }finally{await app.shutdown();}
});


test('named weekdays select the measured forecast day and reject dates beyond the provider window',async()=>{
 const f=await fixture();await f.weather.configure({locationId:city.id});
 const saturday=await f.weather.answer('Weather for Saturday in Chicago');
 assert.equal(saturday.ok,true);assert.match(saturday.summary,/Saturday/);assert.match(saturday.summary,/61°F/);
 assert.equal(saturday.patch.weatherPreview.selectedDate,'2026-11-14');assert.equal(saturday.patch.weatherPreview.range,'day');
 assert.equal((await f.weather.answer('Weather for 2026-12-01')).ok,false);
});
