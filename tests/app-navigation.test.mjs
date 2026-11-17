import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { appIntent } from "../navigation-intents.mjs";
import { browserIntent } from "../browser-intents.mjs";
import { findInstalledApp } from "../workbench-apps.mjs";
import { createNativeDesktop } from "../workbench-native.mjs";
import { createJarvisServer } from "../server.mjs";
import { createDiscordBridge } from "../discord-bridge.mjs";

const apps = [
  { name: "Calculator", id: "Windows.Calculator!App" },
  { name: "Google Chrome", id: "Chrome", target: "C:\\Apps\\chrome.exe" },
  { name: "Visual Studio Code", id: "VSCode", target: "C:\\Apps\\Code.exe" },
  { name: "Discord", id: "Discord", target: "C:\\Apps\\Discord.exe" },
];

test("natural app navigation understands opening, switching, and polite phrasing", () => {
  for (const request of [
    "Open Calculator",
    "Hey Jarvis, could you please launch Calculator?",
    "Navigate to Calculator",
    "Switch over to Calculator",
    "Focus on Calculator",
    "Bring Calculator to the front",
    "I want you to open Calculator on my computer",
    'Open "Calculator"',
  ]) {
    assert.equal(appIntent(request)?.app, "Calculator", request);
  }
  assert.equal(appIntent("Open the Discord app").explicit, true);
  assert.equal(appIntent("Open the Discord app on my laptop").explicit, true);
  assert.equal(browserIntent("Open the Discord app"), null);
  assert.equal(
    appIntent("Open Calculator and then open Chrome").type,
    "compound",
  );
  for (const request of [
    "Don't open Calculator",
    "How do I open Calculator?",
    "If I open Calculator what happens?",
    "Open my calendar",
    "Switch to the dashboard",
    "Start a timer",
    "Open the garage door",
    "Show the weather",
    "Open youtube.com",
    "Open YouTube in Chrome",
  ])
    assert.equal(appIntent(request), null, request);
});

test("explicit browser choices survive normalization without substituting a different browser", () => {
  for (const request of [
    "Open YouTube in Chrome",
    "Navigate to YouTube using Google Chrome",
    "Open Chrome to YouTube",
    "Open Chrome and go to YouTube",
  ]) {
    const intent = browserIntent(request);
    assert.equal(intent?.url, "https://www.youtube.com/", request);
    assert.equal(intent.engine, "chrome", request);
  }
  assert.equal(
    browserIntent("Open YouTube using Microsoft Edge").engine,
    "edge",
  );
  assert.equal(browserIntent("Go to github.com in Firefox").engine, "firefox");
  assert.equal(browserIntent("Switch to YouTube").type, "open");
});

test("installed app resolution uses actual entries and asks about duplicate names", () => {
  assert.equal(findInstalledApp(apps, "chrome").id, "Chrome");
  assert.equal(findInstalledApp(apps, "VS Code").id, "VSCode");
  assert.equal(
    findInstalledApp(apps, "Windows.Calculator!App").name,
    "Calculator",
  );
  assert.equal(findInstalledApp(apps, "C:\\Apps\\unknown.exe"), null);
  assert.equal(findInstalledApp(apps, "Calculator; shutdown /s"), null);
  const duplicates = [
    { name: "Editor", id: "one" },
    { name: "Editor", id: "two" },
  ];
  assert.throws(() => findInstalledApp(duplicates, "Editor"), /More than one/);
  assert.equal(findInstalledApp(duplicates, "two").id, "two");
});

test("native app launching gets its target only from Windows discovery and preserves real focus results", async () => {
  const payloads = [];
  const adapter = createNativeDesktop({
    platform: "win32",
    browserDirectory: "C:\\Jarvis\\browser-profiles",
    execute: async (_cmd, arguments_) => {
      const script = Buffer.from(arguments_.at(-1), "base64").toString(
        "utf16le",
      );
      assert(
        arguments_.at(-1).length < 10000,
        "bootstrap must fit the Windows command line",
      );
      const payload = JSON.parse(
        Buffer.from(script.match(/^\$Payload='([^']+)'/)[1], "base64"),
      );
      payloads.push(payload);
      const stdout = JSON.stringify(
        payload.action === "list_apps"
          ? { apps }
          : {
              outcome: "unverified",
              foreground: false,
              summary: "Windows did not bring the app to the front.",
            },
      );
      return { code: 0, stdout, output: stdout };
    },
  });
  const result = await adapter.run("open_app", {
    app: "chrome",
    appId: "evil",
    targetPath: "evil.exe",
    appName: "evil",
    action: "shutdown",
    protectedPid: 1,
  });
  assert.equal(result.foreground, false);
  assert.equal(result.outcome, "unverified");
  assert.equal(payloads[1].action, "open_app");
  assert.equal(payloads[1].appId, "Chrome");
  assert.equal(payloads[1].targetPath, "C:\\Apps\\chrome.exe");
  assert.equal(payloads[1].protectedPid, process.pid);
  await assert.rejects(
    adapter.run("open_app", { app: "made-up-app" }),
    /couldn’t find/,
  );
  assert.equal(payloads.filter((p) => p.action === "open_app").length, 1);
  const listed = await adapter.run("list_apps");
  assert.equal(
    listed.apps[1].target,
    undefined,
    "internal executable paths stay out of the public app list",
  );
  const controller = new AbortController();
  controller.abort(Error("Cancelled"));
  await assert.rejects(
    adapter.run("open_app", { app: "chrome" }, { signal: controller.signal }),
    /Cancelled/,
  );
  assert.equal(payloads.length, 2);
  await assert.rejects(
    adapter.focusBrowser("C:\\outside"),
    /managed browser profile/,
  );
});

test("voice/text command route opens installed apps, respects browser choice, and surfaces failure without model claims", async () => {
  let modelCalls = 0,
    foreground = true;
  const calls = [];
  const model = http.createServer(async (req, res) => {
    for await (const _ of req) {
    }
    if (req.url === "/api/chat") modelCalls++;
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(
      JSON.stringify(
        req.url === "/api/tags"
          ? { models: [{ name: "navigation-test" }] }
          : { message: { content: "I opened it." }, done: true },
      ) + "\n",
    );
  });
  await new Promise((r) => model.listen(0, "127.0.0.1", r));
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-app-http-"));
  const app = createJarvisServer({
    model: "navigation-test",
    ollamaUrl: "http://127.0.0.1:" + model.address().port,
    displayBind: "",
    phoneBind: "",
    actionsOptions: { dataDirectory: directory },
    pairingOptions: { directory },
    speech: { listVoices: async () => ({ available: false }), close() {} },
    workbenchOptions: {
      desktop: () => ({
        status: () => ({ available: true, apps: apps.map((a) => a.name) }),
        resolveApp: async (name) => findInstalledApp(apps, name),
        run: async (operation, args) => {
          calls.push({ operation, ...args });
          if (args.app === "missing")
            throw Object.assign(Error("That app is not installed."), {
              status: 404,
            });
          return {
            outcome: foreground ? "confirmed" : "unverified",
            foreground,
            summary: foreground
              ? "Switched to Calculator. Its window is in front."
              : "Calculator is open, but Windows did not bring its window to the front.",
          };
        },
      }),
      browser: () => ({
        status: () => ({ sessions: [] }),
        close: async () => {},
        run: async (_profile, operation, args) => {
          calls.push({ profileId: _profile, operation, ...args });
          return {
            outcome: "confirmed",
            summary: "Opened the requested page in " + args.engine,
            url: args.url,
          };
        },
      }),
    },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port,
    bridge = createDiscordBridge({ baseUrl: () => base });
  const ask = (q) =>
    bridge.ask(
      "navigation-check",
      { room: "living-room", profileId: "cooper" },
      q,
    );
  try {
    await fetch(base + "/api/workbench/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        browserEnabled: true,
        desktopEnabled: true,
        requireApproval: false,
      }),
    });
    assert.match(
      (await ask("Switch to Calculator")).answer,
      /window is in front/,
    );
    assert.equal(calls[0].app, "Windows.Calculator!App");
    assert.match((await ask("Open YouTube in Chrome")).answer, /chrome/);
    assert.equal(calls[1].url, "https://www.youtube.com/");
    assert.equal(calls[1].engine, "chrome");
    await ask("Open Discord");
    assert.equal(
      calls[2].operation,
      "open_app",
      "an installed Discord app takes precedence over its website",
    );
    foreground = false;
    assert.match(
      (await ask("Bring Calculator to the front")).answer,
      /did not bring/,
    );
    assert.match((await ask("Open missing")).answer, /not installed/);
    for (const room of ["living-room", "bedroom-2"]) {
      const shared = await bridge.ask(
        "shared-navigation-check",
        { room, profileId: null },
        "Open YouTube in Chrome",
      );
      assert.equal(shared.resultKind, "workbench");
      assert.doesNotMatch(shared.answer, /choose.*profile/i);
      assert.equal(calls.at(-1).profileId, "shared--" + room);
    }
    const sharedApp = await bridge.ask(
      "shared-navigation-check",
      { room: "living-room", profileId: null },
      "Open Calculator",
    );
    assert.equal(sharedApp.resultKind, "workbench");
    assert.doesNotMatch(sharedApp.answer, /choose.*profile/i);
    assert.equal((await fetch(base + "/profile-selection.js")).status, 200);
    assert.equal(
      modelCalls,
      0,
      "the language model must not invent successful app actions",
    );
    const activity = await fetch(base + "/api/activity?room=living-room").then(
      (r) => r.json(),
    );
    assert(
      activity.entries.some(
        (a) => a.tool === "open_computer_app" && a.status === "unverified",
      ),
    );
    assert(
      activity.entries.some(
        (a) => a.tool === "open_computer_app" && a.status === "failed",
      ),
    );
  } finally {
    bridge.close();
    await app.shutdown();
    await new Promise((r) => model.close(r));
  }
});
