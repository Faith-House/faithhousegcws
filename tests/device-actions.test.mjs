import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { clientDevice, websiteNavigation } from "../device-actions.mjs";
import { createDeviceNavigator } from "../public/device-navigation.js";
import { createJarvisServer } from "../server.mjs";
import { createDiscordBridge } from "../discord-bridge.mjs";

test("device descriptors reject malformed client data instead of falling back to server control", () => {
  assert.equal(clientDevice(undefined), null);
  assert.throws(() => clientDevice({ kind: "browser", id: "x" }), /identifier/);
  assert.throws(() => clientDevice({ kind: "other" }), /identifier/);
  const client = clientDevice({
    kind: "browser",
    id: "phone-tab-1234",
    desktop: false,
  });
  const result = websiteNavigation(client, "https://www.youtube.com/");
  assert.equal(result.outcome, "unverified");
  assert.equal(result.deviceAction.clientId, client.id);
  assert.match(result.summary, /Opening.*device/);
  assert.doesNotMatch(result.summary, /Opened/);
  assert.throws(() => websiteNavigation(client, "javascript:alert(1)"), /HTTP/);
  assert.throws(
    () => websiteNavigation(client, "https://user:secret@example.com/"),
    /embedded/,
  );
  assert.equal(
    websiteNavigation({ kind: "discord" }, "https://youtube.com/").deviceAction,
    undefined,
  );
});

function fixture({ popup = true } = {}) {
  const destinations = [],
    tabs = [];
  const browser = {
    crypto: { randomUUID: () => "this-browser-tab" },
    location: {
      hostname: "localhost",
      assign: (url) => destinations.push(url),
    },
    open: () => {
      if (!popup) return null;
      const tab = {
        opener: {},
        location: { replace: (url) => destinations.push(url) },
      };
      tabs.push(tab);
      return tab;
    },
  };
  const navigator = createDeviceNavigator({ browser });
  const state = {
    state: "ready",
    requestId: "own-request",
    deviceActions: [
      {
        id: "action-one",
        kind: "open_url",
        clientId: navigator.client.id,
        url: "https://www.youtube.com/",
      },
    ],
  };
  return { navigator, state, destinations, tabs };
}

test("only the requesting tab executes its ready response and reconnects never replay navigation", () => {
  const f = fixture();
  assert.equal(
    f.navigator.apply({ ...f.state, state: "thinking" }, "own-request"),
    false,
  );
  assert.equal(f.navigator.apply(f.state, "someone-else"), false);
  assert.equal(
    f.navigator.apply(
      {
        ...f.state,
        deviceActions: [
          { ...f.state.deviceActions[0], clientId: "another-tab" },
        ],
      },
      "own-request",
    ),
    false,
  );
  assert.equal(f.navigator.apply(f.state, "own-request"), true);
  assert.equal(f.tabs[0].opener, null);
  assert.deepEqual(f.destinations, ["https://www.youtube.com/"]);
  assert.equal(f.navigator.apply(f.state, "own-request"), false);
  assert.equal(f.destinations.length, 1);
});

test("voice requests use the current tab when the browser blocks a new tab", () => {
  const f = fixture({ popup: false });
  assert.equal(f.navigator.apply(f.state, "own-request"), true);
  assert.deepEqual(f.destinations, ["https://www.youtube.com/"]);
  assert.equal(f.tabs.length, 0);
});

test("client navigation refuses non-web URLs even in a forged response", () => {
  const f = fixture();
  assert.equal(
    f.navigator.apply(
      {
        ...f.state,
        deviceActions: [
          { ...f.state.deviceActions[0], url: "file:///private" },
        ],
      },
      "own-request",
    ),
    false,
  );
  assert.equal(f.destinations.length, 0);
});

test("assistant returns navigation to the requesting device without starting the server browser; Discord gets a link", async () => {
  let nativeCalls = 0,
    modelCalls = 0;
  const model = http.createServer(async (req, res) => {
    for await (const _ of req) {
    }
    if (req.url === "/api/chat") modelCalls++;
    res.setHeader("Content-Type", "application/x-ndjson");
    res.end(JSON.stringify({ models: [{ name: "test" }] }) + "\n");
  });
  await new Promise((r) => model.listen(0, "127.0.0.1", r));
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-client-nav-"));
  const app = createJarvisServer({
    model: "test",
    ollamaUrl: "http://127.0.0.1:" + model.address().port,
    displayBind: "",
    phoneBind: "",
    actionsOptions: { dataDirectory: directory },
    pairingOptions: { directory },
    speech: { listVoices: async () => ({ available: false }), close() {} },
    workbenchOptions: {
      desktop: () => ({
        status: () => ({ available: true }),
        resolveApp: async () => {
          nativeCalls++;
          return null;
        },
        run: async () => {
          nativeCalls++;
          throw Error("Server desktop must not run");
        },
      }),
      browser: () => ({
        status: () => ({ sessions: [] }),
        close: async () => {},
        run: async () => {
          nativeCalls++;
          throw Error("Server browser must not run");
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
      body: JSON.stringify({
        browserEnabled: true,
        desktopEnabled: true,
        requireApproval: false,
      }),
    });
    for (const id of ["phone-browser-1", "computer-browser-2"]) {
      const result = await bridge.ask(
        id,
        {
          room: "living-room",
          profileId: null,
          client: { kind: "browser", id, desktop: false },
        },
        "Open YouTube",
      );
      assert.equal(result.resultKind, "workbench");
      assert.equal(result.deviceActions[0].clientId, id);
      assert.equal(result.deviceActions[0].url, "https://www.youtube.com/");
      assert.doesNotMatch(result.answer, /Opened/);
    }
    const discord = await bridge.ask(
      "discord-test",
      { room: "living-room", profileId: null, client: { kind: "discord" } },
      "Open YouTube",
    );
    assert.equal(discord.deviceActions.length, 0);
    assert.match(discord.answer, /Discord cannot.*https/);
    const appReply = await bridge.ask(
      "phone-native",
      {
        room: "living-room",
        profileId: null,
        client: { kind: "browser", id: "phone-browser-1", desktop: false },
      },
      "Open Calculator",
    );
    assert.match(appReply.answer, /needs a local Jarvis computer connection/);
    assert.equal(nativeCalls, 0);
    assert.equal(modelCalls, 0);
  } finally {
    bridge.close();
    await app.shutdown();
    await new Promise((r) => model.close(r));
  }
});
