import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkbenchStore } from "../workbench-data.mjs";
import { createWorkspace } from "../workbench-files.mjs";
import {
  createJobs,
  nextRoutine,
  validateSchedule,
} from "../workbench-jobs.mjs";
async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-jobs-")),
    store = createWorkbenchStore(directory),
    workspace = createWorkspace({ directory });
  const jobs = createJobs({
    store,
    workspace,
    research: async () => ({ report: "Fixture research" }),
    modelCall: async () => "Fixture summary",
    tickMs: 50,
    ...options,
  });
  return {
    store,
    workspace,
    jobs,
    close: async () => {
      await jobs.close();
      await workspace.close();
      await store.close();
    },
  };
}
async function until(check) {
  for (let i = 0; i < 200; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Task check timed out");
}
const taskInput = {
  profileId: "cooper",
  room: "bedroom-1",
  kind: "research",
  goal: "Fixture public research",
  minutes: 1,
};
const blockedResearch = async (task, checkpoint, signal) => {
  await checkpoint(
    {
      sources: [{ id: 1, title: "Fixture source", url: "https://example.com" }],
      findings: [
        {
          sourceId: 1,
          claim: "Saved fixture finding",
          quote: "This exact fixture quote is long enough.",
        },
      ],
    },
    "Read fixture source",
  );
  await new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
  });
};

test("background reports persist and public status does not expose internal source text", async () => {
  const f = await fixture();
  try {
    await f.jobs.start();
    const task = await f.jobs.startTask(taskInput);
    const done = await until(async () => {
      const t = (await f.store.read()).tasks.find((t) => t.id === task.id);
      return t.status === "completed" && t;
    });
    assert.equal(
      (await f.workspace.bytes("cooper", done.reportFile)).toString(),
      "Fixture research",
    );
    assert.equal(f.jobs.publicTask(done).work, undefined);
  } finally {
    await f.close();
  }
});

test("finish early saves only checkpointed progress in a clearly partial report", async () => {
  const f = await fixture({ research: blockedResearch });
  try {
    await f.jobs.start();
    const task = await f.jobs.startTask(taskInput);
    await until(
      async () =>
        (await f.store.read()).tasks[0].stage === "Read fixture source",
    );
    await f.jobs.change(task.id, "cooper", "finish");
    const done = await until(async () => {
      const t = (await f.store.read()).tasks[0];
      return t.status === "completed" && t;
    });
    assert.equal(done.partial, true);
    const report = (
      await f.workspace.bytes("cooper", done.reportFile)
    ).toString();
    assert.match(report, /Stopped early at your request/);
    assert.match(report, /Saved fixture finding/);
    assert.match(report, /https:\/\/example.com/);
  } finally {
    await f.close();
  }
});

test("budget exhaustion pauses the task and does not pretend it completed", async () => {
  const f = await fixture({ research: blockedResearch, budgetMs: () => 60 });
  try {
    await f.jobs.start();
    await f.jobs.startTask(taskInput);
    const stopped = await until(async () => {
      const t = (await f.store.read()).tasks[0];
      return t.status === "paused" && t;
    });
    assert.match(stopped.stage, /Budget reached/);
    assert.equal(stopped.reportFile, undefined);
    assert.equal(stopped.work.findings.length, 1);
  } finally {
    await f.close();
  }
});

test("cancelling running work keeps it cancelled and refuses another profile", async () => {
  const f = await fixture({ research: blockedResearch });
  try {
    await f.jobs.start();
    const task = await f.jobs.startTask(taskInput);
    await until(
      async () =>
        (await f.store.read()).tasks[0].stage === "Read fixture source",
    );
    await assert.rejects(f.jobs.change(task.id, "wade", "cancel"), /not found/);
    await f.jobs.change(task.id, "cooper", "cancel");
    await f.jobs.close();
    assert.equal((await f.store.read()).tasks[0].status, "cancelled");
  } finally {
    await f.close();
  }
});

test("restarting pauses interrupted jobs and disables an interrupted startup action", async () => {
  let actions = 0;
  const f = await fixture({
    runCommand: async () => {
      actions++;
      return { answer: "Fixture action" };
    },
  });
  try {
    await f.store.update((data) => {
      data.tasks.push({
        ...taskInput,
        id: "interrupted",
        status: "running",
        work: {},
      });
      data.routines.push({
        id: "startup",
        profileId: "cooper",
        room: "bedroom-1",
        kind: "command",
        instruction: "Fixture action",
        schedule: { mode: "startup" },
        enabled: true,
        lastOutcome: "dispatching",
      });
    });
    await f.jobs.start();
    await f.jobs.tick();
    const data = await f.store.read();
    assert.equal(data.tasks[0].status, "paused");
    assert.equal(data.routines[0].enabled, false);
    assert.match(data.routines[0].lastOutcome, /unverified/);
    assert.equal(actions, 0);
  } finally {
    await f.close();
  }
});

test("task history pruning preserves old active work instead of losing its checkpoint", async () => {
  const f = await fixture();
  try {
    await f.store.update((data) => {
      data.tasks.push({
        ...taskInput,
        id: "keep-active",
        status: "paused",
        work: { important: "saved" },
      });
      for (let i = 0; i < 99; i++)
        data.tasks.push({ id: "done-" + i, status: "completed" });
    });
    await f.jobs.startTask(taskInput);
    const data = await f.store.read();
    assert.equal(data.tasks.length, 100);
    assert.deepEqual(data.tasks.find((t) => t.id === "keep-active").work, {
      important: "saved",
    });
  } finally {
    await f.close();
  }
});

test("daily scheduling follows the house timezone across daylight-saving changes", () => {
  const r = {
    schedule: validateSchedule({ mode: "daily", time: "08:00" }),
    timeZone: "America/Chicago",
  };
  assert.equal(
    new Date(nextRoutine(r, Date.parse("2026-03-07T15:00:00Z"))).toISOString(),
    "2026-03-08T13:00:00.000Z",
  );
  assert.throws(
    () => validateSchedule({ mode: "interval", minutes: 0 }),
    /5 minutes/,
  );
});

test("quiet routines wait and a one-time dispatch happens once", async () => {
  let clock = Date.parse("2026-11-17T05:30:00Z");
  const notices = [];
  const f = await fixture({
    now: () => clock,
    notify: (note) => notices.push(note),
  });
  try {
    await f.jobs.addRoutine({
      profileId: "cooper",
      room: "bedroom-1",
      kind: "say",
      title: "Fixture message",
      instruction: "Saved message",
      quiet: true,
      timeZone: "America/Chicago",
      schedule: { mode: "once", at: new Date(clock + 1000).toISOString() },
    });
    await f.jobs.start();
    clock += 2000;
    await f.jobs.tick();
    assert.equal(notices.length, 0);
    clock = Date.parse("2026-11-17T13:30:00Z");
    await f.jobs.tick();
    await until(() => notices.length === 1);
    await f.jobs.tick();
    assert.equal(notices.length, 1);
    assert.equal((await f.store.read()).routines[0].enabled, false);
  } finally {
    await f.close();
  }
});

test("idle routines use the last interaction and do not fire again immediately", async () => {
  let clock = 1000000;
  const notices = [],
    f = await fixture({ now: () => clock, notify: (n) => notices.push(n) });
  try {
    await f.jobs.addRoutine({
      profileId: "cooper",
      room: "bedroom-1",
      kind: "say",
      title: "Idle fixture",
      instruction: "Idle message",
      schedule: { mode: "idle", minutes: 5 },
    });
    await f.jobs.start();
    clock += 240000;
    f.jobs.interact();
    clock += 120000;
    await f.jobs.tick();
    assert.equal(notices.length, 0);
    clock += 180001;
    await f.jobs.tick();
    await until(() => notices.length === 1);
    await f.jobs.tick();
    assert.equal(notices.length, 1);
  } finally {
    await f.close();
  }
});

test("code task produces a complete draft and never applies it to the input file", async () => {
  const f = await fixture({
    modelCall: async () =>
      JSON.stringify({
        summary: "Fixture change",
        files: [{ path: "project.mjs", content: 'console.log("proposed");' }],
      }),
  });
  try {
    await f.workspace.save("cooper", "project.mjs", 'console.log("original");');
    await f.jobs.start();
    await f.jobs.startTask({
      ...taskInput,
      kind: "code",
      files: ["project.mjs"],
      goal: "Fixture code change",
    });
    const task = await until(async () => {
      const t = (await f.store.read()).tasks[0];
      return t.status === "completed" && t;
    });
    assert.equal(
      (await f.workspace.bytes("cooper", "project.mjs")).toString(),
      'console.log("original");',
    );
    assert.equal(
      (
        await f.workspace.bytes("cooper", task.changes[0].proposalFile)
      ).toString(),
      'console.log("proposed");',
    );
    assert.match(task.changes[0].expectedHash, /^[a-f0-9]{64}$/);
  } finally {
    await f.close();
  }
});
