import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { browserIntent } from "../browser-intents.mjs";
import { createManagedBrowser } from "../workbench-browser.mjs";
import { createJarvisServer } from "../server.mjs";
import { createDiscordBridge } from "../discord-bridge.mjs";

test("natural website requests resolve names and domains without the language model", () => {
  for (const text of [
    "Open YouTube",
    "Hey Jarvis, open YouTube in a browser",
    "Can you please open YouTube?",
    "go to youtube",
    "take me to YouTube",
    "pull up the YouTube website",
    "I want you to open YouTube",
    "Open browser at https://www.youtube.com/",
    "open youtube.com",
  ]) {
    const intent = browserIntent(text);
    assert.equal(intent?.type, "open", text);
    assert.equal(
      new URL(intent.url).hostname.replace(/^www\./, ""),
      "youtube.com",
      text,
    );
  }
  assert.equal(
    browserIntent("Open github.com/openai").url,
    "https://github.com/openai",
  );
  assert.equal(
    browserIntent("Open https://example.com/?a=1&b=2").url,
    "https://example.com/?a=1&b=2",
  );
});

test("browser routing rejects negations and explanations and keeps compound requests intact", () => {
  for (const text of [
    "Don't open YouTube",
    "Never open YouTube",
    "How do I open YouTube?",
    "Explain how to open youtube",
    "Show the dashboard",
    "Show my calendar",
    "Open notepad",
  ])
    assert.equal(browserIntent(text), null, text);
  assert.equal(browserIntent("Open a browser").type, "clarify");
  assert.equal(browserIntent("Open something in a browser").type, "clarify");
  assert.equal(browserIntent("Open file:///private/test.html").type, "clarify");
  assert.equal(
    browserIntent("Open https://user:password@example.com").type,
    "clarify",
  );
  assert.equal(
    browserIntent("Open YouTube and show the dashboard").type,
    "compound",
  );
});

function fakeBrowser({ status = 200, redirect, error } = {}) {
  let current = "about:blank",
    launches = 0,
    fronts = 0;
  const page = {
    goto: async (url) => {
      if (error) throw error;
      current = redirect || url;
      return { status: () => status };
    },
    url: () => current,
    title: async () => "Fixture page",
    bringToFront: async () => {
      fronts++;
    },
    setDefaultTimeout() {},
    locator: () => ({ innerText: async () => "Fixture content" }),
    isClosed: () => false,
  };
  return {
    browser: createManagedBrowser({
      directory: tmpdir(),
      launch: async () => {
        launches++;
        return { pages: () => [page], on() {}, close: async () => {} };
      },
    }),
    counts: () => ({ launches, fronts }),
  };
}

test("managed browser navigation confirms real URL and brings the page forward", async () => {
  const f = fakeBrowser();
  try {
    const result = await f.browser.run("cooper", "open", {
      url: "https://youtube.com/",
    });
    assert.equal(result.outcome, "confirmed");
    assert.equal(result.url, "https://youtube.com/");
    assert.match(result.summary, /Opened/);
    assert.deepEqual(f.counts(), { launches: 1, fronts: 1 });
    assert.equal(
      (await f.browser.run("cooper", "read")).text,
      "Fixture content",
    );
  } finally {
    await f.browser.close();
  }
});

test("HTTP errors, failed navigation and unexpected redirects cannot become success claims", async () => {
  const f = fakeBrowser({ status: 403 }),
    r = fakeBrowser({ redirect: "https://other.example/" }),
    e = fakeBrowser({ error: Error("net::ERR_NAME_NOT_RESOLVED") });
  try {
    const blocked = await f.browser.run("cooper", "open", {
      url: "https://youtube.com/",
    });
    assert.equal(blocked.outcome, "failed");
    assert.equal(blocked.ok, false);
    assert.match(blocked.summary, /HTTP 403/);
    const redirect = await r.browser.run("cooper", "open", {
      url: "https://youtube.com/",
    });
    assert.equal(redirect.outcome, "unverified");
    await assert.rejects(
      e.browser.run("cooper", "open", { url: "https://youtube.com/" }),
      /No successful result was confirmed/,
    );
  } finally {
    await Promise.all([
      f.browser.close(),
      r.browser.close(),
      e.browser.close(),
    ]);
  }
});

test("invalid requests and reading a missing browser do not launch Edge", async () => {
  const f = fakeBrowser();
  try {
    await assert.rejects(
      f.browser.run("cooper", "read"),
      /Open a managed browser/,
    );
    await assert.rejects(
      f.browser.run("cooper", "open", { url: "file:///tmp/test" }),
      /HTTP or HTTPS/,
    );
    assert.equal(f.counts().launches, 0);
  } finally {
    await f.browser.close();
  }
});

test("simultaneous commands for one profile share a single serialized browser session", async () => {
  const f = fakeBrowser();
  try {
    const results = await Promise.all(
      ["https://first.example/", "https://second.example/"].map((url) =>
        f.browser.run("cooper", "open", { url }),
      ),
    );
    assert.equal(f.counts().launches, 1);
    assert.deepEqual(
      results.map((r) => r.url),
      ["https://first.example/", "https://second.example/"],
    );
  } finally {
    await f.browser.close();
  }
});

test("a cancelled queued browser request cannot open a new page", async () => {
  const f = fakeBrowser(),
    controller = new AbortController();
  controller.abort(Error("Stopped by user"));
  try {
    await assert.rejects(
      f.browser.run(
        "cooper",
        "open",
        { url: "https://example.com/" },
        { signal: controller.signal },
      ),
      /Stopped by user/,
    );
    assert.equal(f.counts().launches, 0);
  } finally {
    await f.browser.close();
  }
});

test("closing an HTTP command request cancels the active computer adapter call", async () => {
  let began, observed;
  const starting = new Promise((resolve) => {
    began = resolve;
  });
  const directory = await mkdtemp(
    path.join(tmpdir(), "jarvis-request-cancel-"),
  );
  const app = createJarvisServer({
    displayBind: "",
    phoneBind: "",
    actionsOptions: { dataDirectory: directory },
    pairingOptions: { directory },
    speech: { listVoices: async () => ({ available: false }), close() {} },
    workbenchOptions: {
      desktop: () => ({
        status: () => ({ available: true }),
        run: async (_operation, _args, { signal }) => {
          observed = signal;
          began();
          return new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        },
      }),
    },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    await fetch(base + "/api/workbench/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desktopEnabled: true, requireApproval: false }),
    });
    const controller = new AbortController();
    const pending = fetch(base + "/api/workbench/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: "cooper",
        room: "bedroom-1",
        action: "desktop",
        args: { operation: "open_app", app: "notepad" },
      }),
      signal: controller.signal,
    });
    await starting;
    controller.abort();
    await assert.rejects(pending);
    for (let i = 0; i < 100 && !observed.aborted; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(observed.aborted, true);
  } finally {
    await app.shutdown();
  }
});

test("real assistant requests execute browser tools and never fall back to a fictional model action", async () => {
  let modelCalls = 0,
    fail = false;
  const opened = [];
  const model = http.createServer(async (req, res) => {
    for await (const _ of req) {
    }
    if (req.url === "/api/chat") modelCalls++;
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end(
      JSON.stringify(
        req.url === "/api/tags"
          ? { models: [{ name: "browser-test" }] }
          : { message: { content: "I opened it." }, done: true },
      ) + "\n",
    );
  });
  await new Promise((r) => model.listen(0, "127.0.0.1", r));
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-browser-http-"));
  const app = createJarvisServer({
    model: "browser-test",
    ollamaUrl: "http://127.0.0.1:" + model.address().port,
    displayBind: "",
    phoneBind: "",
    actionsOptions: { dataDirectory: directory },
    pairingOptions: { directory },
    speech: { listVoices: async () => ({ available: false }), close() {} },
    workbenchOptions: {
      browser: () => ({
        status: () => ({ sessions: [] }),
        close: async () => {},
        run: async (profileId, operation, args) => {
          if (fail)
            throw Object.assign(Error("The browser could not launch."), {
              status: 503,
            });
          opened.push({ profileId, operation, ...args });
          return {
            outcome: "confirmed",
            summary: "Opened YouTube in the managed Edge browser.",
            url: args.url,
          };
        },
      }),
    },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port,
    bridge = createDiscordBridge({ baseUrl: () => base });
  try {
    await fetch(base + "/api/workbench/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserEnabled: true, requireApproval: false }),
    });
    const result = await bridge.ask(
      "test",
      { room: "living-room", profileId: "cooper" },
      "Open YouTube in a browser",
    );
    assert.match(result.answer, /Opened YouTube/);
    assert.equal(result.resultKind, "workbench");
    assert.equal(opened.length, 1);
    assert.equal(opened[0].profileId, "cooper");
    assert.equal(opened[0].url, "https://www.youtube.com/");
    assert.equal(modelCalls, 0);
    const activity = await fetch(base + "/api/activity?room=living-room").then(
      (r) => r.json(),
    );
    assert(
      activity.entries.some(
        (e) =>
          e.tool === "open_managed_browser" &&
          e.status === "completed" &&
          e.durationMs !== null,
      ),
    );
    fail = true;
    const failed = await bridge.ask(
      "test",
      { room: "living-room", profileId: "cooper" },
      "Can you open YouTube?",
    );
    assert.match(failed.answer, /could not launch/);
    assert.equal(modelCalls, 0);
    const state = await fetch(base + "/api/workbench?profileId=cooper").then(
      (r) => r.json(),
    );
    assert.deepEqual(
      state.approvals.map((a) => a.status),
      ["failed", "confirmed"],
    );
  } finally {
    bridge.close();
    await app.shutdown();
    await new Promise((r) => model.close(r));
  }
});
