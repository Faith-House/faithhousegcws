import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkbench } from "../workbench.mjs";
import { createNativeDesktop } from "../workbench-native.mjs";
import { createApprovals } from "../workbench-approvals.mjs";
import { runProcess } from "../workbench-files.mjs";
import { createWorkbenchStore } from "../workbench-data.mjs";
import { validateArguments } from "../tool-agent.mjs";
import http from "node:http";

async function directFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-direct-")),
    calls = [];
  const workbench = createWorkbench({
    directory,
    profiles: {
      get: async (id) => (id === "cooper" ? { id } : null),
      list: async () => ({ profiles: [{ id: "cooper", name: "Cooper" }] }),
    },
    rooms: ["bedroom-1"],
    systemHealth: { read: async () => ({}) },
    desktop: () => ({
      status: () => ({ available: true }),
      run: async (operation, args) => {
        calls.push({ kind: "desktop", operation, ...args });
        return {
          outcome: "unverified",
          summary: "Input sent; resulting app state not confirmed.",
        };
      },
    }),
    browser: () => ({
      status: () => ({ sessions: [] }),
      run: async (profileId, operation, args) => {
        calls.push({ kind: "browser", profileId, operation, ...args });
        return {
          outcome: "confirmed",
          summary: "Browser navigation completed.",
        };
      },
      close: async () => {},
    }),
    sendDiscord: async (input) => {
      calls.push({ kind: "discord", ...input });
      return { outcome: "confirmed", summary: "Mock message accepted." };
    },
  });
  return {
    directory,
    workbench,
    calls,
    dispatch: (action, args = {}) =>
      workbench.dispatch({
        profileId: "cooper",
        room: "bedroom-1",
        action,
        args,
      }),
  };
}

test("enabled controls still require one immutable approval before acting", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-workbench-"));
  const calls = [];
  const workbench = createWorkbench({
    directory,
    profiles: {
      get: async (id) => (id === "cooper" ? { id } : null),
      list: async () => ({ profiles: [{ id: "cooper", name: "Cooper" }] }),
    },
    rooms: ["bedroom-1"],
    base: new URL("http://127.0.0.1:11434"),
    model: "test",
    webSearch: {},
    systemHealth: { read: async () => ({}) },
    desktop: () => ({
      status: () => ({ available: true }),
      run: async (operation, args) => {
        calls.push({ operation, ...args });
        return { outcome: "confirmed", summary: "Mock application opened." };
      },
    }),
    browser: () => ({
      status: () => ({ sessions: [] }),
      close: async () => {},
    }),
  });
  const request = {
    profileId: "cooper",
    room: "bedroom-1",
    action: "desktop",
    args: { operation: "open_app", app: "notepad" },
  };
  try {
    await assert.rejects(
      workbench.dispatch(request),
      /Enable computer controls/,
    );
    await workbench.settings({ desktopEnabled: true, browserEnabled: true });
    const staged = await workbench.dispatch(request);
    request.args.app = "calculator";
    assert.equal(staged.outcome, "needs_approval");
    assert.equal(calls.length, 0);
    const executed = await workbench.approvals.resolve(staged.approvalId, true);
    assert.equal(executed.status, "confirmed");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].app, "notepad");
    await assert.rejects(
      workbench.approvals.resolve(staged.approvalId, true),
      /already used/,
    );
    assert.equal(calls.length, 1);
  } finally {
    await workbench.close();
  }
});

test("settings survive reopening the Workbench while pending approvals do not", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "jarvis-workbench-settings-"),
  );
  const options = {
    directory,
    profiles: { get: async () => ({}), list: async () => ({ profiles: [] }) },
    rooms: ["bedroom-1"],
    systemHealth: { read: async () => ({}) },
  };
  const first = createWorkbench(options);
  await first.settings({
    desktopEnabled: true,
    browserEnabled: true,
    requireApproval: false,
  });
  await first.close();
  const second = createWorkbench(options);
  try {
    const status = await second.status();
    assert.equal(status.settings.desktopEnabled, true);
    assert.equal(status.settings.browserEnabled, true);
    assert.equal(status.settings.requireApproval, false);
    assert.deepEqual(status.approvals, []);
  } finally {
    await second.close();
  }
});

test("desktop arguments cannot substitute a different action or protected process", async () => {
  let payload;
  const adapter = createNativeDesktop({
    platform: "win32",
    execute: async (_command, args) => {
      assert.equal(args.includes("-ExecutionPolicy"), false);
      const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
      const encoded = script.match(/^\$Payload='([A-Za-z0-9+/=]+)'/)[1];
      payload = JSON.parse(Buffer.from(encoded, "base64").toString());
      const stdout = JSON.stringify({ outcome: "confirmed", windows: [] });
      return {
        code: 0,
        stdout,
        stderr: "PowerShell startup progress",
        output: "PowerShell startup progress\n" + stdout,
      };
    },
  });
  await adapter.run("list_windows", { action: "shutdown", protectedPid: 1 });
  assert.equal(payload.action, "list_windows");
  assert.equal(payload.protectedPid, process.pid);
  await assert.rejects(
    adapter.run("open_app", { app: "powershell" }),
    /approved app aliases/,
  );
});

test("program diagnostics do not corrupt structured standard output", async () => {
  const result = await runProcess(process.execPath, [
    "-e",
    'process.stderr.write("diagnostic");process.stdout.write(JSON.stringify({ok:true}));',
  ]);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true });
  assert.equal(result.stderr, "diagnostic");
});

test("expired and declined approvals never execute the proposed action", async () => {
  let time = 0,
    calls = 0;
  const approvals = createApprovals({ now: () => time });
  const request = () =>
    approvals.request({
      profileId: "cooper",
      room: "bedroom-1",
      title: "Test",
      detail: {},
      run: async () => {
        calls++;
        return { outcome: "confirmed" };
      },
    });
  const expired = request();
  time = 300001;
  await assert.rejects(approvals.resolve(expired.approvalId, true), /expired/);
  const declined = request();
  assert.equal(
    (await approvals.resolve(declined.approvalId, false)).status,
    "cancelled",
  );
  assert.equal(calls, 0);
});

test("direct mode runs desktop, browser and requested messaging without creating approvals", async () => {
  const f = await directFixture();
  try {
    await f.workbench.settings({
      desktopEnabled: true,
      browserEnabled: true,
      requireApproval: false,
    });
    const desktop = await f.dispatch("desktop", {
      operation: "open_app",
      app: "notepad",
    });
    assert.equal(desktop.outcome, "unverified");
    assert.equal(desktop.approvalId, undefined);
    const browser = await f.dispatch("browser", {
      operation: "open",
      url: "https://example.com",
    });
    const message = await f.dispatch("discord.send", {
      channelId: "123",
      message: "Test fixture only",
      profileId: "wade",
      room: "other-room",
    });
    assert.equal(browser.outcome, "confirmed");
    assert.equal(message.outcome, "confirmed");
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[2].profileId, "cooper");
    assert.equal(f.calls[2].room, "bedroom-1");
    const history = (await f.workbench.status("cooper")).approvals;
    assert.equal(history.length, 3);
    assert(
      history.every(
        (item) => item.mode === "direct" && item.status !== "needs_approval",
      ),
    );
    await assert.rejects(
      f.workbench.approvals.resolve(desktop.executionId, true),
      /already used/,
    );
    assert.equal(f.calls.length, 3);
  } finally {
    await f.workbench.close();
  }
});

test("switching to direct execution cancels old queued work instead of replaying it", async () => {
  const f = await directFixture();
  try {
    await f.workbench.settings({ desktopEnabled: true });
    const old = await f.dispatch("desktop", {
      operation: "open_app",
      app: "notepad",
    });
    await f.workbench.settings({ requireApproval: false });
    assert.equal(f.calls.length, 0);
    await assert.rejects(
      f.workbench.approvals.resolve(old.approvalId, true),
      /already used/,
    );
    const fresh = await f.dispatch("desktop", {
      operation: "open_app",
      app: "calculator",
    });
    assert.equal(fresh.outcome, "unverified");
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].app, "calculator");
    await f.workbench.settings({ requireApproval: true });
    assert.equal(
      (await f.dispatch("desktop", { operation: "open_app", app: "notepad" }))
        .outcome,
      "needs_approval",
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.workbench.close();
  }
});

test("direct code execution returns real process output without an approval round trip", async () => {
  const f = await directFixture();
  try {
    await f.workbench.settings({ requireApproval: false });
    await f.workbench.workspace.save(
      "cooper",
      "check.mjs",
      'console.log("direct-mode-ok");',
    );
    const result = await f.dispatch("code.run", { file: "check.mjs" });
    assert.equal(result.outcome, "confirmed");
    assert.equal(result.code, 0);
    assert.match(result.stdout, /direct-mode-ok/);
    assert.equal(result.approvalId, undefined);
    assert.equal(
      (await f.workbench.status("cooper")).approvals[0].mode,
      "direct",
    );
  } finally {
    await f.workbench.close();
  }
});

test("direct execution preserves workspace path checks and newer code files", async () => {
  const f = await directFixture();
  try {
    await f.workbench.workspace.save(
      "cooper",
      "project.mjs",
      'console.log("newer version");',
    );
    await f.workbench.workspace.save(
      "cooper",
      "tasks/test/proposal/project.mjs",
      'console.log("proposal");',
    );
    const persisted = createWorkbenchStore(f.directory);
    await persisted.update((data) =>
      data.tasks.push({
        id: "test",
        profileId: "cooper",
        room: "bedroom-1",
        kind: "code",
        status: "completed",
        changes: [
          {
            path: "project.mjs",
            proposalFile: "tasks/test/proposal/project.mjs",
            expectedHash: "older-version-hash",
          },
        ],
      }),
    );
    await persisted.close();
    await f.workbench.settings({ requireApproval: false });
    await assert.rejects(
      f.dispatch("code.run", { file: "../outside.mjs" }),
      /relative path/,
    );
    const result = await f.dispatch("code.apply", { id: "test" });
    assert.equal(result.outcome, "failed");
    assert.equal(result.ok, false);
    assert.match(result.summary, /destination changed/);
    assert.equal(
      (await f.workbench.workspace.bytes("cooper", "project.mjs")).toString(),
      'console.log("newer version");',
    );
  } finally {
    await f.workbench.close();
  }
});

test("failed direct actions are logged once and never reported as completed", async () => {
  const approvals = createApprovals();
  let calls = 0;
  const result = await approvals.execute({
    profileId: "cooper",
    room: "bedroom-1",
    title: "Failing fixture",
    detail: {},
    run: async () => {
      calls++;
      throw Object.assign(Error("The target is unavailable."), { status: 409 });
    },
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.ok, false);
  assert.equal(result.summary, "The target is unavailable.");
  assert.equal(calls, 1);
  assert.equal(approvals.list()[0].status, "failed");
});

test("stopping a running code request cancels its owned process and records interruption", async () => {
  const f = await directFixture();
  try {
    await f.workbench.settings({ requireApproval: false });
    await f.workbench.workspace.save(
      "cooper",
      "wait.mjs",
      "setInterval(()=>{},1000);",
    );
    const controller = new AbortController();
    const running = f.workbench.dispatch({
      profileId: "cooper",
      room: "bedroom-1",
      action: "code.run",
      args: { file: "wait.mjs" },
      signal: controller.signal,
    });
    const timer = setTimeout(
      () => controller.abort(Error("Stopped by user")),
      100,
    );
    try {
      const result = await running;
      assert.equal(result.outcome, "cancelled");
      assert.equal(result.ok, false);
      assert.match(result.summary, /command stopped/);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await f.workbench.close();
  }
});

test("the file writing tool accepts multiline content and returns a real scoped undo", async () => {
  const f = await directFixture();
  try {
    const tools = await f.workbench.tools({
        profileId: "cooper",
        room: "bedroom-1",
      }),
      write = tools.find((t) => t.name === "write_workspace_file");
    const args = { file: "notes.txt", content: "First line\nSecond line" };
    assert.equal(validateArguments(args, write.parameters), true);
    const result = await write.execute(args);
    assert.equal(
      (await f.workbench.workspace.bytes("cooper", "notes.txt")).toString(),
      args.content,
    );
    assert.equal(typeof result.undo, "function");
    await result.undo();
    await assert.rejects(f.workbench.workspace.bytes("cooper", "notes.txt"), {
      code: "ENOENT",
    });
  } finally {
    await f.workbench.close();
  }
});

test("routine tools require a real schedule and keep the room/profile selected by the server", async () => {
  const f = await directFixture();
  try {
    const tools = await f.workbench.tools({
        profileId: "cooper",
        room: "bedroom-1",
        timeZone: "America/Chicago",
      }),
      schedule = tools.find((t) => t.name === "schedule_routine");
    assert.equal(schedule.check({}, "Create a daily routine at 8 AM"), true);
    assert.equal(schedule.check({}, "Explain a good daily routine"), false);
    await assert.rejects(
      schedule.execute({
        title: "Missing time",
        instruction: "Fixture",
        kind: "say",
        scheduleMode: "daily",
      }),
      /HH:mm/,
    );
    const result = await schedule.execute({
      title: "Fixture morning",
      instruction: "Fixture message",
      kind: "say",
      scheduleMode: "daily",
      time: "08:00",
    });
    assert.equal(result.routine.profileId, "cooper");
    assert.equal(result.routine.room, "bedroom-1");
    assert.equal(result.routine.timeZone, "America/Chicago");
    assert(result.routine.nextAt > Date.now());
  } finally {
    await f.workbench.close();
  }
});

test("vision selection never offers cloud-backed Ollama entries", async () => {
  const service = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/tags") {
      response.end(
        JSON.stringify({
          models: [
            { name: "local-vision", size: 1 },
            { name: "remote-vision", remote_host: "https://remote.example" },
            { name: "vision:cloud" },
            { name: "hidden-remote" },
          ],
        }),
      );
    } else {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      response.end(
        JSON.stringify({
          capabilities: ["vision"],
          ...(body.model === "hidden-remote"
            ? { remote_model: "upstream" }
            : {}),
        }),
      );
    }
  });
  await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-local-vision-"));
  const workbench = createWorkbench({
    directory,
    base: new URL("http://127.0.0.1:" + service.address().port),
  });
  try {
    assert.deepEqual(
      (await workbench.installedVision()).map((m) => m.name),
      ["local-vision"],
    );
    await assert.rejects(
      workbench.settings({ visionModel: "remote-vision" }),
      /installed model with verified vision/,
    );
  } finally {
    await workbench.close();
    await new Promise((resolve) => service.close(resolve));
  }
});
