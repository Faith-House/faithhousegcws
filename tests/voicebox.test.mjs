import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import {
  createVoiceboxSpeech,
  normalizeVoiceboxWave,
} from "../voicebox-speech.mjs";
import { pcmWave } from "../speech-stream.mjs";
import { createLocalSpeech } from "../speech.mjs";

test("Voicebox WAV conversion accepts engine rates and extra chunks but rejects invalid/compressed audio", () => {
  const source = pcmWave([Buffer.alloc(480 * 2)], 48000),
    converted = normalizeVoiceboxWave(source);
  assert.equal(converted.readUInt32LE(24), 24000);
  assert.equal(converted.readUInt16LE(22), 1);
  assert.equal(converted.length, 44 + 240 * 2);
  const junk = Buffer.concat([
    source.subarray(0, 12),
    Buffer.from("JUNK\x04\x00\x00\x00abcd", "binary"),
    source.subarray(12),
  ]);
  junk.writeUInt32LE(junk.length - 8, 4);
  assert.equal(normalizeVoiceboxWave(junk).length, converted.length);
  assert.throws(
    () => normalizeVoiceboxWave(Buffer.from("not audio")),
    /playable WAV/,
  );
  const compressed = Buffer.from(source);
  compressed.writeUInt16LE(85, 20);
  assert.throws(() => normalizeVoiceboxWave(compressed), /unsupported audio/);
  const truncated = source.subarray(0, source.length - 2);
  assert.throws(() => normalizeVoiceboxWave(truncated), /incomplete/);
});

async function fixture({
  configured = true,
  generating = false,
  silent = false,
  duration = 2,
  deletedProfile = false,
  onRequest,
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-voicebox-")),
    calls = [];
  let samples = configured ? 1 : 0,
    polls = 0;
  const settings = {
    profileId: "profile-jarvis",
    engine: "luxtts",
    enabled: configured,
  };
  if (configured)
    await writeFile(
      path.join(directory, "voicebox.json"),
      JSON.stringify(settings),
    );
  const voice = createVoiceboxSpeech({
    directory,
    pollMs: 1,
    fetchImpl: async (url, options) => {
      calls.push({
        path: url.pathname,
        method: options.method,
        json: options.headers ? JSON.parse(options.body) : null,
      });
      onRequest?.(url, options);
      const json = (data) =>
        new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
        });
      if (url.pathname === "/health")
        return json({ status: "healthy", gpu_type: null });
      if (url.pathname === "/profiles" && options.method === "POST")
        return json({ id: "profile-jarvis", name: "Jarvis", sample_count: 0 });
      if (url.pathname === "/profiles/profile-jarvis/samples" && options.method === "POST") {
        assert.equal(
          options.body.get("reference_text"),
          "A synthetic reference sample.",
        );
        samples++;
        return json({ id: "sample-one" });
      }
      if (url.pathname === "/profiles/profile-jarvis")
        return deletedProfile ? new Response(JSON.stringify({ detail: "Profile not found" }), { status: 404 }) : json({ id: "profile-jarvis", name: "Jarvis", sample_count: 0 });
      if (url.pathname === "/profiles/profile-jarvis/samples")
        return json(
          Array.from({ length: samples }, () => ({ id: "sample-one" })),
        );
      if (url.pathname === "/models/status")
        return json({
          models: [
            {
              model_name: "qwen-tts-0.6B",
              downloaded: true,
              loaded: true,
              downloading: false,
            },
            {
              model_name: "luxtts",
              downloaded: true,
              loaded: true,
              downloading: false,
            },
          ],
        });
      if (url.pathname === "/models/download")
        return json({ status: "downloading" });
      if (url.pathname === "/generate")
        return json({
          id: "job-jarvis",
          status: generating ? "generating" : "completed",
        });
      if (url.pathname === "/history/job-jarvis")
        return json({
          id: "job-jarvis",
          status: ++polls > 1 ? "completed" : "generating",
        });
      if (url.pathname === "/history/job-jarvis/export-audio") {
        const pcm = Buffer.alloc(48000 * 2 * duration);
        if (!silent) for (let offset = 0; offset < pcm.length; offset += 2) pcm.writeInt16LE(Math.round(Math.sin(offset * 0.04) * 3000), offset);
        return new Response(pcmWave([pcm], 48000), {
          headers: { "Content-Type": "audio/wav" },
        });
      }
      if (url.pathname === "/generate/job-jarvis/cancel")
        return json({ ok: true });
      throw Error("Unexpected request " + url.pathname);
    },
  });
  return { voice, directory, calls };
}

test("Voicebox polls its own generation and returns playable 24 kHz audio through the existing speech interface", async () => {
  const f = await fixture({ generating: true });
  try {
    const voices = await f.voice.listVoices();
    assert.equal(voices.defaultVoice, "voicebox_jarvis");
    assert.equal(voices.available, true);
    let streamed;
    const wave = await f.voice.synthesize({
      text: "The house is ready.",
      voice: "voicebox_jarvis",
      onChunk: (pcm, rate) => (streamed = { pcm, rate }),
    });
    assert.equal(wave.toString("ascii", 0, 4), "RIFF");
    assert.equal(streamed.rate, 24000);
    assert.equal(streamed.pcm.length, wave.length - 44);
    const request = f.calls.find((c) => c.path === "/generate").json;
    assert.equal(request.profile_id, "profile-jarvis");
    assert.equal(request.engine, "luxtts");
    assert.equal(request.personality, false);
    assert.equal(f.voice.lastMetrics.engine, "voicebox");
  } finally {
    f.voice.close();
  }
});

test("Voicebox setup imports the prepared local sample and switches on only after a real audio result", async () => {
  const f = await fixture({ configured: false });
  try {
    assert.equal((await f.voice.listVoices()).available, false);
    const reference = path.join(f.directory, "voicebox", "reference");
    await mkdir(reference, { recursive: true });
    await writeFile(
      path.join(reference, "jarvis-reference.wav"),
      pcmWave([Buffer.alloc(4800)]),
    );
    await writeFile(
      path.join(reference, "reference.json"),
      JSON.stringify({
        source: "https://example.com/reference",
        text: "A synthetic reference sample.",
      }),
    );
    const prepared = await f.voice.prepare();
    assert.equal(prepared.configured, true);
    assert.equal(prepared.enabled, false);
    assert.equal(prepared.referenceReady, true);
    assert.deepEqual(f.calls.find((c) => c.path === "/models/download").json, {
      model_name: "qwen-tts-0.6B",
    });
    assert.equal((await f.voice.listVoices()).available, false);
    const active = await f.voice.activate();
    assert.equal(active.enabled, true);
    assert.equal(active.voice, "voicebox_jarvis");
    const preview = await readFile(
      path.join(f.directory, "voicebox", "preview.wav"),
    );
    assert.equal(preview.readUInt32LE(24), 24000);
    assert.equal((await f.voice.listVoices()).available, true);
  } finally {
    f.voice.close();
  }
});

test("silent and clipped Voicebox previews do not replace the current voice", async () => {
  for (const options of [{ silent: true }, { duration: 0.5 }]) {
    const f = await fixture(options);
    try {
      const configFile = path.join(f.directory, "voicebox.json");
      await writeFile(configFile, JSON.stringify({ profileId: "profile-jarvis", engine: "luxtts", enabled: false }));
      await assert.rejects(f.voice.activate(), /silent or incomplete preview/);
      assert.equal(JSON.parse(await readFile(configFile, "utf8")).enabled, false);
      assert.equal((await f.voice.listVoices()).available, false);
    } finally { f.voice.close(); }
  }
});

test("a deleted Voicebox profile leaves its service connected so setup can repair it", async () => {
  const f = await fixture({ deletedProfile: true });
  try {
    const info = await f.voice.status();
    assert.equal(info.connected, true);
    assert.equal(info.configured, false);
    assert.equal(info.enabled, false);
    assert.equal((await f.voice.listVoices()).available, false);
  } finally { f.voice.close(); }
});

test("cancelling Voicebox cancels only this generation and never emits late audio", async () => {
  const controller = new AbortController();
  const f = await fixture({
    generating: true,
    onRequest: (url) => {
      if (url.pathname === "/history/job-jarvis")
        controller.abort(Error("Stopped by user"));
    },
  });
  try {
    await assert.rejects(
      f.voice.synthesize({
        text: "Stop this reply.",
        signal: controller.signal,
        onChunk: () => assert.fail("No late audio may play"),
      }),
      /Stopped by user/,
    );
    assert(f.calls.some((c) => c.path === "/generate/job-jarvis/cancel"));
  } finally {
    f.voice.close();
  }
});

test("Voicebox cannot send speech to a remote service and an absent service stays unavailable", async () => {
  assert.throws(
    () => createVoiceboxSpeech({ baseUrl: "https://external.example/" }),
    /local loopback/,
  );
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-voicebox-off-"));
  await writeFile(
    path.join(directory, "voicebox.json"),
    JSON.stringify({ enabled: true, profileId: "profile-jarvis" }),
  );
  const voice = createVoiceboxSpeech({
    directory,
    fetchImpl: async () => {
      throw Error("ECONNREFUSED");
    },
  });
  try {
    assert.equal((await voice.listVoices()).available, false);
    assert.match((await voice.status()).detail, /Open Voicebox/);
  } finally {
    voice.close();
  }
});

test("local speech routes the Voicebox voice to its provider while retaining Peter", async () => {
  const called = [];
  const fake = (name, voices) => ({
    listVoices: async () => ({
      available: true,
      voices: voices.map((name) => ({ name })),
      defaultVoice: voices[0],
    }),
    synthesize: async () => {
      called.push(name);
      return pcmWave([Buffer.alloc(48)]);
    },
    close() {},
    warmup: async () => {},
  });
  const speech = createLocalSpeech({
    kokoro: fake("kokoro", ["bm_george"]),
    pocket: fake("pocket", ["pocket_peter"]),
    voicebox: fake("voicebox", ["voicebox_jarvis"]),
  });
  try {
    const info = await speech.listVoices();
    assert.equal(info.defaultVoice, "voicebox_jarvis");
    assert(info.streamingVoices.includes("voicebox_jarvis"));
    await speech.synthesize({ text: "Hello", voice: "voicebox_jarvis" });
    await speech.synthesize({ text: "Hello", voice: "pocket_peter" });
    assert.deepEqual(called, ["voicebox", "pocket"]);
  } finally {
    speech.close();
  }
});
