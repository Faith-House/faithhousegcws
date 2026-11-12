const element=(tag,className,text)=>{const el=document.createElement(tag);el.className=className;if(text!==undefined)el.textContent=text;return el;};
const rendered=new WeakMap();
export function renderWeather(root,data,range='week'){
 if(!root)return;root.hidden=!data;if(!data){rendered.delete(root);root.replaceChildren();return;}
 const key=JSON.stringify([data,range]);if(rendered.get(root)===key)return;rendered.set(root,key);root.replaceChildren();
 const temperature=value=>Number.isFinite(value)?Math.round(value)+data.temperatureUnit:'—';
 const header=element('header','weather-heading'),location=element('div','');location.append(element('p','weather-eyebrow','OPEN-METEO / '+(range==='current'?'CURRENT CONDITIONS':range==='tomorrow'?'TOMORROW':range==='today'?'TODAY':'SEVEN-DAY FORECAST')),element('h2','',data.location.label));header.append(location);root.append(header);
 if(range==='current'||range==='week'){
  const current=element('div','weather-current'),details=element('div','weather-current-detail');current.append(element('strong','weather-temperature',temperature(data.current.temperature)));details.append(element('p','weather-condition',data.current.condition),element('p','weather-small','Feels like '+temperature(data.current.feelsLike)+(Number.isFinite(data.current.wind)?' · Wind '+Math.round(data.current.wind)+' '+data.windUnit:'')));
  const time=new Intl.DateTimeFormat('en-US',{timeZone:data.location.timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(data.current.at));details.append(element('p','weather-small','Model-based conditions · '+time));current.append(details);root.append(current);
 }
 const days=range==='current'?[]:range==='tomorrow'?data.days.slice(1,2):range==='today'?data.days.slice(0,1):data.days;
 if(days.length){const grid=element('div','weather-days');for(const day of days){const card=element('article','weather-day'),date=new Date(day.date+'T12:00:00Z');card.append(element('h3','',new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(date)),element('p','weather-day-condition',day.condition),element('p','weather-highlow',temperature(day.high)+' / '+temperature(day.low)),element('p','weather-small',Number.isFinite(day.rainChance)?Math.round(day.rainChance)+'% precip. chance':'Precip. probability unavailable'));grid.append(card);}root.append(grid);}
 const foot=element('p','weather-source','Forecast data: '),link=element('a','','Open-Meteo');link.href='https://open-meteo.com/';link.target='_blank';link.rel='noopener noreferrer';foot.append(link,document.createTextNode(' · Location: GeoNames · Fetched '+new Intl.DateTimeFormat('en-US',{timeZone:data.location.timeZone,hour:'numeric',minute:'2-digit'}).format(new Date(data.fetchedAt))));root.append(foot);
}
