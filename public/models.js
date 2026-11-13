const $ = id => document.getElementById(id);
let info;
function detail() { const item = info?.models.find(m => m.name === $('coding-model').value); $('model-details').textContent = item ? [item.parameters, item.quantization, Number.isFinite(item.bytes) ? (item.bytes / 1e9).toFixed(2) + ' GB on disk' : ''].filter(Boolean).join(' · ') : ''; }
async function load() {
  try {
    const response = await fetch('/api/models', { cache: 'no-store' }); if (!response.ok) throw Error('Model settings are unavailable.'); info = await response.json();
    $('fast-model').textContent = info.fastModel + ' · local Ollama';
    $('coding-status').textContent = info.configurationError ? 'The saved model settings need attention.' : info.codingConfigured ? info.codingModel + (info.codingInstalled ? ' · installed' : ' · not installed on this computer') : 'Choose a second model after it is installed on the target computer.';
    const choices = info.models.filter(m => m.name !== info.fastModel);
    $('coding-model').replaceChildren(new Option('Choose an installed local model…', ''), ...choices.map(m => new Option(m.name, m.name)));
    if (choices.some(m => m.name === info.codingModel)) $('coding-model').value = info.codingModel;
    $('coding-model').disabled = !info.available || info.configurationError || !choices.length;
    $('save-model').disabled = $('coding-model').disabled;
    if (!info.available) $('model-message').textContent = 'Ollama is unavailable. Start it, then refresh.';
    detail();
  } catch (error) { $('model-message').textContent = error.message; }
}
$('coding-model').addEventListener('change', detail);
$('refresh-models').addEventListener('click', () => { $('model-message').textContent = ''; void load(); });
$('model-form').addEventListener('submit', async event => {
  event.preventDefault(); $('save-model').disabled = true;
  try {
    const response = await fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codingModel: $('coding-model').value }) });
    const data = await response.json(); if (!response.ok) throw Error(data.error || 'Could not save the coding model.');
    await load(); $('model-message').textContent = 'Saved. Say “coding mode” in Jarvis to use this model.';
  } catch (error) { $('model-message').textContent = error.message; }
  finally { $('save-model').disabled = $('coding-model').disabled; }
});
void load();
