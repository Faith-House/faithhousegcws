const $ = (id) => document.getElementById(id);
let busy = false;
async function api(url, post = false, body = {}) {
  const response = await fetch(
    url,
    post
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(330000),
        }
      : { cache: "no-store" },
  );
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error || "Voicebox could not finish that step.");
  return data;
}
async function refresh() {
  const info = await api("/api/voicebox");
  $("status").textContent = info.connected
    ? info.enabled
      ? "Jarvis voice is active"
      : "Voicebox is connected"
    : "Open Voicebox to connect";
  $("detail").textContent =
    info.detail ||
    (info.profile
      ? `${info.profile.name} · ${info.profile.samples} reference sample${info.profile.samples === 1 ? "" : "s"} · ${info.engine}`
      : "The local service is ready for the Jarvis reference.");
  $("prepare").disabled = busy || !info.connected;
  $("activate").disabled = busy || !info.connected || !info.configured || !info.referenceReady || (info.model && !info.model.downloaded);
  if (info.model?.downloading) $("detail").textContent += " · voice model downloading";
  for (const key of ["conciseSpeech", "cacheEnabled", "keepWarm"]) {
    $(key).checked = info.performance?.[key] !== false;
    $(key).disabled = busy || !info.configured;
  }
  const cache = info.performance?.cache;
  $("cache-status").textContent = cache?.unavailable ? "Saved audio is unavailable. New replies still work." : `${cache?.entries || 0} saved phrases · ${((cache?.bytes || 0) / 1048576).toFixed(1)} MB on this computer`;
  if (info.enabled && !$("preview").src) {
    $("preview").src = "/api/voicebox/preview";
    $("preview").hidden = false;
  }
  return info;
}
async function run(endpoint) {
  if (busy) return;
  busy = true;
  $("prepare").disabled = $("activate").disabled = true;
  $("message").textContent =
    endpoint === "prepare"
      ? "Importing the reference and preparing the local model…"
      : "Generating a real Jarvis voice preview…";
  try {
    const info = await api("/api/voicebox/" + endpoint, true);
    $("message").textContent =
      info.detail ||
      (info.enabled
        ? "The preview succeeded. Jarvis now uses the Voicebox voice."
        : "Reference is ready. Wait for the model download, then test the voice.");
    if (info.enabled) {
      $("preview").src = "/api/voicebox/preview?time=" + Date.now();
      $("preview").hidden = false;
      localStorage.setItem("jarvis.voice", info.voice || "voicebox_jarvis");
      localStorage.setItem("jarvis.profilesUpdated", String(Date.now()));
    }
  } catch (error) {
    $("message").textContent = error.message;
  } finally {
    busy = false;
    await refresh().catch(() => {});
  }
}
$("refresh").onclick = () =>
  refresh().catch((error) => {
    $("message").textContent = error.message;
  });
$("prepare").onclick = () => run("prepare");
$("activate").onclick = () => run("activate");
for (const key of ["conciseSpeech", "cacheEnabled", "keepWarm"]) $(key).onchange = async () => {
  try { await api("/api/voicebox/settings", true, { [key]: $(key).checked }); await refresh(); }
  catch (error) { $("message").textContent = error.message; await refresh().catch(() => {}); }
};
$("clear-cache").onclick = async () => {
  try { await api("/api/voicebox/cache/clear", true); await refresh(); }
  catch (error) { $("message").textContent = error.message; }
};
void refresh().catch((error) => {
  $("message").textContent = error.message;
});
