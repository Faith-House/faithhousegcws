import path from "node:path";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { APP_ROOT, VOICEBOX_VOICES } from "./voice-config.mjs";
import { pcmWave } from "./speech-stream.mjs";
const fail = (message, status = 503) =>
  Object.assign(new Error(message), { status });
export const VOICEBOX_VOICE = VOICEBOX_VOICES[0];
const DEFAULT_ENGINE = "qwen";
const modelName = (engine) => engine === "qwen" ? "qwen-tts-0.6B" : "luxtts";

// Voicebox engines output several WAV rates/layouts. The HUD streams mono 24 kHz PCM.
export function normalizeVoiceboxWave(wave) {
  if (
    wave.length < 44 ||
    wave.length > 16 * 1024 * 1024 ||
    wave.toString("ascii", 0, 4) !== "RIFF" ||
    wave.toString("ascii", 8, 12) !== "WAVE"
  )
    throw fail("Voicebox did not return a playable WAV file.");
  let format, audio;
  for (let offset = 12; offset + 8 <= wave.length; ) {
    const name = wave.toString("ascii", offset, offset + 4),
      size = wave.readUInt32LE(offset + 4),
      start = offset + 8;
    if (size > wave.length - start)
      throw fail("Voicebox returned an incomplete WAV file.");
    if (name === "fmt " && size >= 16)
      format = {
        code: wave.readUInt16LE(start),
        channels: wave.readUInt16LE(start + 2),
        rate: wave.readUInt32LE(start + 4),
        bits: wave.readUInt16LE(start + 14),
      };
    if (name === "data") audio = wave.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (
    !format ||
    !audio ||
    ![1, 2].includes(format.channels) ||
    format.rate < 8000 ||
    format.rate > 96000 ||
    !(
      (format.code === 1 && [16, 24, 32].includes(format.bits)) ||
      (format.code === 3 && format.bits === 32)
    )
  )
    throw fail("Voicebox returned an unsupported audio format.");
  const bytes = format.bits / 8,
    stride = bytes * format.channels,
    frames = Math.floor(audio.length / stride);
  if (!frames || frames * stride !== audio.length)
    throw fail("Voicebox returned incomplete audio samples.");
  const count = Math.floor((frames * 24000) / format.rate);
  if (count < 1 || count * 2 > 8 * 1024 * 1024)
    throw fail("That Voicebox reply is too long.");
  const sample = (frame) => {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel++) {
      const offset = Math.min(frames - 1, frame) * stride + channel * bytes;
      const value =
        format.code === 3
          ? audio.readFloatLE(offset)
          : audio.readIntLE(offset, bytes) / 2 ** (format.bits - 1);
      if (!Number.isFinite(value))
        throw fail("Voicebox returned invalid audio samples.");
      sum += value;
    }
    return sum / format.channels;
  };
  const pcm = Buffer.alloc(count * 2),
    ratio = format.rate / 24000;
  for (let i = 0; i < count; i++) {
    const at = i * ratio;
    let value;
    if (ratio >= 1) {
      const end = Math.min(frames, at + ratio);
      let weighted = 0;
      for (let j = Math.floor(at); j < Math.ceil(end); j++)
        weighted += sample(j) * (Math.min(j + 1, end) - Math.max(j, at));
      value = weighted / (end - at);
    } else {
      const left = Math.floor(at),
        weight = at - left;
      value = sample(left) * (1 - weight) + sample(left + 1) * weight;
    }
    pcm.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(value * 32767))),
      i * 2,
    );
  }
  return pcmWave([pcm]);
}

export function createVoiceboxSpeech({
  directory = path.join(APP_ROOT, "private"),
  baseUrl = process.env.JARVIS_VOICEBOX_URL || "http://127.0.0.1:17493/",
  fetchImpl = fetch,
  timeoutMs = 300000,
  pollMs = 500,
} = {}) {
  const base = new URL(baseUrl),
    configFile = path.join(directory, "voicebox.json"),
    controllers = new Set();
  if (
    !["http:", "https:"].includes(base.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw fail("Voicebox must use a local loopback service address.", 400);
  let lastMetrics;
  async function config() {
    try {
      return JSON.parse(await readFile(configFile, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw fail("The local Voicebox settings could not be read.");
    }
  }
  async function save(value) {
    await mkdir(directory, { recursive: true });
    await writeFile(
      configFile + ".tmp",
      JSON.stringify(value, null, 2) + "\n",
      { mode: 0o600 },
    );
    await rename(configFile + ".tmp", configFile);
  }
  async function api(endpoint, { method = "GET", json, body, signal } = {}) {
    let response;
    try {
      response = await fetchImpl(new URL(endpoint, base), {
        method,
        redirect: "error",
        signal: signal || AbortSignal.timeout(5000),
        ...(json
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(json),
            }
          : body
            ? { body }
            : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw fail("Open Voicebox on this computer, then try again.");
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw fail(
        "Voicebox: " +
          (typeof error.detail === "string"
            ? error.detail.slice(0, 300)
            : "the local request could not finish."),
        response.status === 404 ? 404 : 503,
      );
    }
    return response;
  }
  async function status() {
    const settings = await config();
    try {
      const health = await (await api("health")).json();
      let profile,
        samples = [],
        model;
      if (settings?.profileId) {
        try {
          profile = await (await api("profiles/" + encodeURIComponent(settings.profileId))).json();
          samples = await (await api("profiles/" + encodeURIComponent(settings.profileId) + "/samples")).json();
        } catch (error) {
          if (error.status !== 404) throw error;
        }
        const registry = await (await api("models/status")).json();
        model = registry.models?.find(
          (item) => item.model_name === modelName(settings.engine || DEFAULT_ENGINE),
        );
      }
      const sampleCount = Array.isArray(samples) ? samples.length : 0;
      return {
        connected: true,
        url: base.href,
        configured: Boolean(profile),
        enabled: settings?.enabled === true && Boolean(profile),
        referenceReady: sampleCount > 0,
        engine: settings?.engine || DEFAULT_ENGINE,
        model: model
          ? {
              downloaded: model.downloaded,
              downloading: model.downloading,
              loaded: model.loaded,
            }
          : null,
        profile: profile
          ? { id: profile.id, name: profile.name, samples: sampleCount }
          : null,
        health: { status: health.status, device: health.gpu_type || "CPU" },
      };
    } catch {
      return {
        connected: false,
        url: base.href,
        configured: Boolean(settings?.profileId),
        enabled: settings?.enabled === true,
        referenceReady: false,
        detail: "Open Voicebox on this computer, then refresh this page.",
      };
    }
  }
  async function listVoices() {
    const settings = await config();
    if (!settings?.enabled || !settings.profileId)
      return { available: false, voices: [] };
    const info = await status();
    const available = info.connected && info.referenceReady && info.model?.downloaded === true;
    return {
      available,
      voices: available ? [VOICEBOX_VOICE] : [],
      defaultVoice: VOICEBOX_VOICE.name,
      localOnly: true,
    };
  }
  async function generate(settings, { text, signal, onChunk } = {}) {
    if (typeof text !== "string" || !text.trim() || text.length > 2400)
      throw fail("Keep the spoken reply under 2,400 characters.", 400);
    if (
      !settings?.profileId ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(settings.profileId)
    )
      throw fail("Finish the Jarvis voice setup first.");
    const controller = new AbortController();
    controllers.add(controller);
    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(timeoutMs),
      ...(signal ? [signal] : []),
    ]);
    let generationId;
    const began = Date.now();
    try {
      const job = await (
        await api("generate", {
          method: "POST",
          json: {
            profile_id: settings.profileId,
            text,
            language: "en",
            engine: settings.engine || DEFAULT_ENGINE,
            model_size: "0.6B",
            personality: false,
          },
          signal: combined,
        })
      ).json();
      if (typeof job.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(job.id))
        throw fail("Voicebox returned an invalid generation identifier.");
      generationId = job.id;
      let progress = job;
      while (progress.status !== "completed") {
        combined.throwIfAborted();
        if (["failed", "cancelled", "error"].includes(progress.status))
          throw fail(
            "Voicebox could not generate the reply: " +
              String(progress.error || progress.status).slice(0, 300),
          );
        await new Promise((resolve, reject) => {
          const done = () => {
            combined.removeEventListener("abort", abort);
            resolve();
          };
          const timer = setTimeout(done, pollMs);
          const abort = () => {
            clearTimeout(timer);
            reject(combined.reason);
          };
          combined.addEventListener("abort", abort, { once: true });
          if (combined.aborted) abort();
        });
        progress = await (
          await api("history/" + generationId, { signal: combined })
        ).json();
      }
      const response = await api(
        "history/" + generationId + "/export-audio?format=wav",
        { signal: combined },
      );
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 16 * 1024 * 1024)
          throw fail("That Voicebox reply is too long.");
        chunks.push(Buffer.from(chunk));
      }
      const wave = normalizeVoiceboxWave(Buffer.concat(chunks));
      combined.throwIfAborted();
      lastMetrics = {
        totalMs: Date.now() - began,
        engine: "voicebox",
        model: settings.engine || DEFAULT_ENGINE,
        sampleRate: 24000,
      };
      onChunk?.(wave.subarray(44), 24000);
      return wave;
    } catch (error) {
      if (combined.aborted && generationId)
        await api("generate/" + generationId + "/cancel", {
          method: "POST",
          signal: AbortSignal.timeout(1500),
        }).catch(() => {});
      if (signal?.aborted) throw signal.reason;
      if (combined.aborted)
        throw fail(
          "Voicebox took too long to prepare that reply. Try a shorter answer.",
        );
      throw error;
    } finally {
      controllers.delete(controller);
    }
  }
  async function prepare() {
    await api("health");
    const file = path.join(
      directory,
      "voicebox",
      "reference",
      "jarvis-reference.wav",
    );
    const metadata = JSON.parse(
      await readFile(
        path.join(directory, "voicebox", "reference", "reference.json"),
        "utf8",
      ),
    );
    const reference = await readFile(file);
    if (
      reference.length > 12 * 1024 * 1024 ||
      !metadata.text ||
      metadata.text.length > 1000
    )
      throw fail("The Jarvis voice reference is not ready.");
    let settings = await config(),
      profile;
    if (settings?.profileId) {
      try {
        profile = await (await api("profiles/" + encodeURIComponent(settings.profileId))).json();
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    const engine = settings?.engine || DEFAULT_ENGINE;
    if (!profile)
      profile = await (
        await api("profiles", {
          method: "POST",
          json: {
            name: "Jarvis · Faith House",
            description:
              "Local Jarvis assistant. Reference: " + metadata.source,
            language: "en",
            voice_type: "cloned",
            default_engine: engine,
          },
        })
      ).json();
    const samples = await (
      await api("profiles/" + encodeURIComponent(profile.id) + "/samples")
    ).json();
    if (!Array.isArray(samples))
      throw fail("Voicebox returned an unreadable sample list.");
    if (!samples.length) {
      const form = new FormData();
      form.set(
        "file",
        new Blob([reference], { type: "audio/wav" }),
        "jarvis-reference.wav",
      );
      form.set("reference_text", metadata.text);
      await api("profiles/" + encodeURIComponent(profile.id) + "/samples", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30000),
      });
    }
    settings = {
      profileId: profile.id,
      engine,
      enabled: settings?.enabled === true && settings?.profileId === profile.id,
      referenceSource: metadata.source,
    };
    await save(settings);
    await api("models/download", {
      method: "POST",
      json: { model_name: modelName(engine) },
      signal: AbortSignal.timeout(15000),
    });
    return {
      ...(await status()),
      detail:
        "Reference imported. Voicebox is preparing the local voice model. Use Test and use when it is ready.",
    };
  }
  async function activate({ signal } = {}) {
    const settings = await config();
    const wave = await generate(settings, {
      text: "Good evening. The house systems are ready. How can I help?",
      signal,
    });
    const frames = (wave.length - 44) / 2;
    let energy = 0;
    for (let offset = 44; offset < wave.length; offset += 2) energy += (wave.readInt16LE(offset) / 32768) ** 2;
    if (frames < 24000 * 2 || frames > 24000 * 30 || Math.sqrt(energy / frames) < 0.0001) throw fail("Voicebox returned a silent or incomplete preview. The new voice has not been selected.");
    await mkdir(path.join(directory, "voicebox"), { recursive: true });
    await writeFile(path.join(directory, "voicebox", "preview.wav"), wave);
    await save({ ...settings, enabled: true });
    return {
      ...(await status()),
      voice: VOICEBOX_VOICE.name,
      metrics: lastMetrics,
    };
  }
  return {
    status,
    prepare,
    activate,
    listVoices,
    warmup: async () => listVoices(),
    synthesize: async (options) => generate(await config(), options),
    close() {
      for (const c of controllers) c.abort(Error("Voice preparation stopped."));
      controllers.clear();
    },
    get lastMetrics() {
      return lastMetrics;
    },
  };
}
