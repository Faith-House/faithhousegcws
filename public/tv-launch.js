const $=id=>document.getElementById(id);
let info,testing=false;
async function json(url,body){const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const result=await response.json();if(!response.ok)throw Error(result.error||'The TV setup request failed.');return result;}
async function load(){
 try{
  const [settings,displays]=await Promise.all([json('/api/tv-launch'),json('/api/displays')]);info=settings;
  $('tv-readiness').textContent=settings.configurationError?'Saved launch settings need attention.':settings.remote.configured?'Samsung’s approved local remote connection is saved.':'Reconnect the Samsung remote and its certificate first.';
  $('receiver-readiness').textContent=settings.receiver.enabled?'The local TV receiver is running.':'The local TV receiver is not listening. Check the computer’s current network address in House setup before testing.';
  $('target-display').replaceChildren(new Option('Choose a display…',''),...displays.devices.map(d=>new Option(d.name+' · '+d.room.replaceAll('-',' '),d.id)));
  $('target-display').value=settings.displayId||'';$('automatic-tv').checked=settings.enabled;$('wake-tv').checked=settings.wake;$('tv-mac').value=settings.mac||'';
  $('save-tv-launch').disabled=settings.configurationError;
  $('test-tv-launch').disabled=testing||!settings.target||!settings.receiver.enabled||!settings.remote.configured;
  if(settings.lastAttempt)$('tv-launch-result').textContent=settings.lastAttempt.detail;
 }catch(error){$('tv-launch-message').textContent=error.message;}
}
$('tv-launch-form').addEventListener('submit',async event=>{
 event.preventDefault();$('save-tv-launch').disabled=true;
 try{await json('/api/tv-launch',{enabled:$('automatic-tv').checked,displayId:$('target-display').value,wake:$('wake-tv').checked,mac:$('tv-mac').value.trim()});await load();$('tv-launch-message').textContent=info.enabled?'Saved. Questions in the selected room will request this Samsung display.':'Saved. Automatic launch is off; use Test when you can see the TV.';}
 catch(error){$('tv-launch-message').textContent=error.message;}
 finally{$('save-tv-launch').disabled=info?.configurationError||false;}
});
$('test-tv-launch').addEventListener('click',async()=>{
 testing=true;$('test-tv-launch').disabled=true;$('tv-launch-result').textContent='Requesting the TV browser and waiting for the receiver…';
 try{const result=await json('/api/tv-launch/test',{});$('tv-launch-result').textContent=result.detail||'No launch was attempted.';}
 catch(error){$('tv-launch-result').textContent=error.message;}
 finally{testing=false;await load();}
});
void load();
