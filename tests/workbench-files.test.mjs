import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Excel from "exceljs";
import JSZip from "jszip";
import { createWorkspace } from "../workbench-files.mjs";
import { inspectArchive } from "../workbench-archives.mjs";
const fixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-files-"));
  return { directory, workspace: createWorkspace({ directory }) };
};

test("file versions and safe undo survive restarting the workspace", async () => {
  const f = await fixture();
  await f.workspace.save("cooper", "notes.txt", "first");
  const change = await f.workspace.save("cooper", "notes.txt", "second");
  await f.workspace.close();
  const restarted = createWorkspace({ directory: f.directory });
  const history = await restarted.history("cooper");
  assert.equal(history.changes[0].id, change.undoId);
  await restarted.undo("cooper", change.undoId);
  assert.equal(
    (await restarted.bytes("cooper", "notes.txt")).toString(),
    "first",
  );
  await restarted.close();
});

test("trash recovery survives restart and refuses to overwrite a newer file", async () => {
  const f = await fixture();
  await f.workspace.save("cooper", "notes.txt", "original");
  const removed = await f.workspace.remove("cooper", "notes.txt");
  await f.workspace.close();
  const restarted = createWorkspace({ directory: f.directory });
  assert.equal(
    (await restarted.history("cooper")).trash[0].id,
    removed.trashId,
  );
  await restarted.save("cooper", "notes.txt", "new");
  await assert.rejects(
    restarted.restore("cooper", removed.trashId),
    /already exists/,
  );
  assert.equal(
    (await restarted.bytes("cooper", "notes.txt")).toString(),
    "new",
  );
  await restarted.restore("cooper", removed.trashId, "restored.txt");
  assert.equal(
    (await restarted.bytes("cooper", "restored.txt")).toString(),
    "original",
  );
  assert.equal((await restarted.history("cooper")).trash.length, 0);
});

test("concurrent writes are serialized and preserve the previous complete version", async () => {
  const f = await fixture();
  const changes = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      f.workspace.save("cooper", "same.txt", String(i)),
    ),
  );
  assert.equal(
    (await f.workspace.bytes("cooper", "same.txt")).toString(),
    "11",
  );
  await f.workspace.undo("cooper", changes.at(-1).undoId);
  assert.equal(
    (await f.workspace.bytes("cooper", "same.txt")).toString(),
    "10",
  );
  await assert.rejects(
    f.workspace.undo("cooper", changes[0].undoId),
    /newer version was preserved/,
  );
});

test("a moved file can be undone after restart without losing its original name", async () => {
  const f = await fixture();
  await f.workspace.save("cooper", "before.txt", "keep me");
  const moved = await f.workspace.move(
    "cooper",
    "before.txt",
    "folder/after.txt",
  );
  const restarted = createWorkspace({ directory: f.directory });
  await restarted.undo("cooper", moved.undoId);
  assert.equal(
    (await restarted.bytes("cooper", "before.txt")).toString(),
    "keep me",
  );
  await assert.rejects(restarted.bytes("cooper", "folder/after.txt"), {
    code: "ENOENT",
  });
});

test("one profile cannot undo or restore another profile’s files", async () => {
  const f = await fixture();
  const saved = await f.workspace.save(
    "cooper",
    "private.txt",
    "private fixture",
  );
  const removed = await f.workspace.remove("cooper", "private.txt");
  await assert.rejects(f.workspace.undo("wade", saved.undoId), /unavailable/);
  await assert.rejects(
    f.workspace.restore("wade", removed.trashId, "other.txt"),
    { code: "ENOENT" },
  );
  assert.deepEqual((await f.workspace.history("wade")).trash, []);
});

test("workspace paths reject traversal, reserved devices and directory links", async () => {
  const f = await fixture();
  for (const name of [
    "../outside.txt",
    "C:/outside.txt",
    "folder/../../outside",
    "CON.txt",
    "nested/NUL",
    "file.txt:secret",
    "trailing.",
    "folder/.JARVIS-data",
  ])
    await assert.rejects(
      f.workspace.save("cooper", name, "no"),
      /relative path/,
    );
  const outside = await mkdtemp(path.join(tmpdir(), "jarvis-outside-"));
  await mkdir(path.join(f.directory, "workspaces"), { recursive: true });
  await symlink(
    outside,
    path.join(f.directory, "workspaces", "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    f.workspace.save("linked", "file.txt", "no"),
    /Linked workspace roots/,
  );
});

test("a damaged recovery index is preserved and blocks further writes", async () => {
  const f = await fixture(),
    folder = path.join(f.directory, "file-history", "cooper");
  await mkdir(folder, { recursive: true });
  const index = path.join(folder, "index.json");
  await writeFile(index, "damaged fixture");
  await assert.rejects(
    f.workspace.save("cooper", "new.txt", "no"),
    /recovery index needs attention/,
  );
  assert.equal(await readFile(index, "utf8"), "damaged fixture");
});

test("document extraction reads a real spreadsheet and reports the exact input hash", async () => {
  const f = await fixture(),
    book = new Excel.Workbook();
  book.addWorksheet("Household").addRows([
    ["Task", "Owner"],
    ["Dishes", "Cooper"],
  ]);
  const data = Buffer.from(await book.xlsx.writeBuffer());
  await f.workspace.save("cooper", "chores.xlsx", data);
  const extracted = await f.workspace.extract("cooper", "chores.xlsx");
  assert.match(extracted.text, /Dishes/);
  assert.match(extracted.text, /Cooper/);
  assert.equal(
    extracted.sha256,
    createHash("sha256").update(data).digest("hex"),
  );
});

test("compressed documents cannot expand beyond their allowed limits", async () => {
  const zip = new JSZip();
  zip.file("large.txt", "a".repeat(20000));
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  assert(bytes.length < 1000);
  await assert.rejects(
    inspectArchive(bytes, { maxEntry: 1000 }),
    /expands beyond/,
  );
  const many = new JSZip();
  for (let i = 0; i < 4; i++) many.file("item-" + i + ".txt", "test");
  await assert.rejects(
    inspectArchive(await many.generateAsync({ type: "nodebuffer" }), {
      maxEntries: 2,
    }),
    /expands beyond/,
  );
});
