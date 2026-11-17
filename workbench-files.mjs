import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  lstat,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { problem, text, owner } from "./workbench-data.mjs";
import { inspectArchive } from "./workbench-archives.mjs";
export const MAX_FILE = 12 * 1024 * 1024;
export function runProcess(
  command,
  args,
  { cwd, input, timeoutMs = 30000, signal, maxOutput = 120000 } = {},
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let out = "",
      stdout = "",
      stderr = "",
      size = 0,
      settled = false;
    function stop() {
      if (child.pid && process.platform === "win32") {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
      } else child.kill();
    }
    const abort = () => {
      stop();
      finish(problem("The process was stopped.", 409));
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      stop();
      finish(problem("The process exceeded its time limit.", 504));
    }, timeoutMs);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(result);
    }
    child.on("error", (error) =>
      finish(
        problem(
          error.code === "ENOENT"
            ? "The required local program is not installed."
            : error.message,
          503,
        ),
      ),
    );
    const collect = (stream) => (chunk) => {
      size += chunk.length;
      if (size > maxOutput) {
        stop();
        finish(problem("The process output exceeded its limit."));
      } else {
        const value = chunk.toString();
        out += value;
        if (stream === "stdout") stdout += value;
        else stderr += value;
      }
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("close", (code) =>
      finish(null, { code, output: out, stdout, stderr }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input || "");
  });
}
export function createWorkspace({ directory }) {
  const history = new Map(),
    trash = new Map(),
    loaded = new Map(),
    queues = new Map();
  const root = (p) => path.resolve(directory, "workspaces", owner(p));
  async function ensureDirectory(base) {
    let cursor = path.parse(base).root;
    for (const part of base.slice(cursor.length).split(path.sep)) {
      cursor = path.join(cursor, part);
      try {
        if ((await lstat(cursor)).isSymbolicLink())
          throw problem("Linked workspace roots are not allowed.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await mkdir(cursor).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
        if ((await lstat(cursor)).isSymbolicLink())
          throw problem("Linked workspace roots are not allowed.");
      }
    }
    return base;
  }
  const ensureRoot = (p) => ensureDirectory(root(p));
  const indexPath = (p) =>
    path.resolve(directory, "file-history", owner(p), "index.json");
  function loadHistory(p) {
    owner(p);
    if (!loaded.has(p))
      loaded.set(
        p,
        (async () => {
          await ensureDirectory(path.dirname(indexPath(p)));
          try {
            if ((await lstat(indexPath(p))).isSymbolicLink()) throw Error();
            const info = await stat(indexPath(p));
            if (info.size > 4 * 1024 * 1024) throw Error();
            const data = JSON.parse(await readFile(indexPath(p), "utf8"));
            if (
              data.format !== 1 ||
              !Array.isArray(data.changes) ||
              !Array.isArray(data.trash)
            )
              throw Error();
            for (const entry of [...data.changes, ...data.trash])
              if (
                !/^[a-f0-9-]{36}$/.test(entry.id) ||
                entry.profile !== p ||
                typeof entry.file !== "string" ||
                entry.file.length > 240
              )
                throw Error();
            for (const entry of data.changes)
              history.set(entry.id, {
                ...entry,
                backup: path.join(directory, "file-history", p, entry.id),
              });
            for (const entry of data.trash) trash.set(entry.id, entry);
          } catch (error) {
            if (error.code !== "ENOENT")
              throw problem(
                "The file recovery index needs attention. Its original contents were preserved.",
                503,
              );
          }
        })(),
      );
    return loaded.get(p);
  }
  async function persistHistory(p) {
    const data = {
      format: 1,
      changes: [...history.entries()]
        .filter(([, e]) => e.profile === p)
        .map(([id, { backup, ...entry }]) => ({ id, ...entry })),
      trash: [...trash.values()].filter((e) => e.profile === p),
    };
    const target = indexPath(p),
      temp = target + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    await rename(temp, target);
  }
  function serialize(p, fn) {
    owner(p);
    const result = (queues.get(p) || Promise.resolve())
      .catch(() => {})
      .then(fn);
    queues.set(p, result);
    result
      .finally(() => {
        if (queues.get(p) === result) queues.delete(p);
      })
      .catch(() => {});
    return result;
  }
  async function resolve(p, relative, { missing = false } = {}) {
    text(relative, 240);
    if (
      path.isAbsolute(relative) ||
      relative.includes("\\") ||
      relative
        .split("/")
        .some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            part.toLowerCase().startsWith(".jarvis") ||
            /[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ) ||
      /[<>:"|?*\x00-\x1f]/.test(relative)
    )
      throw problem("Use a relative path inside this profile’s workspace.");
    const base = root(p),
      target = path.resolve(base, relative);
    if (!target.startsWith(base + path.sep))
      throw problem("That path leaves the workspace.");
    await ensureRoot(p);
    let current = base;
    for (const part of relative.split("/")) {
      current = path.join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw problem(
            "Linked files and folders are not allowed in this workspace.",
          );
      } catch (error) {
        if (error.code === "ENOENT" && missing) continue;
        throw error;
      }
    }
    return target;
  }
  async function list(p, folder = "") {
    const base = folder ? await resolve(p, folder) : await ensureRoot(p);
    return (await readdir(base, { withFileTypes: true }))
      .filter((e) => !e.isSymbolicLink() && !e.name.startsWith(".jarvis"))
      .slice(0, 300)
      .map((e) => ({
        name: e.name,
        path: (folder ? folder + "/" : "") + e.name,
        directory: e.isDirectory(),
      }));
  }
  async function bytes(p, file) {
    const target = await resolve(p, file),
      info = await stat(target);
    if (!info.isFile() || info.size > MAX_FILE)
      throw problem("Choose a file under 12 MB.");
    return readFile(target);
  }
  async function atomicWrite(target, data, id = randomUUID()) {
    const temp = path.join(path.dirname(target), ".jarvis-" + id + ".tmp");
    await writeFile(temp, data, { mode: 0o600, flag: "wx" });
    await rename(temp, target);
  }
  async function save(p, file, data) {
    await loadHistory(p);
    if (!Buffer.isBuffer(data)) data = Buffer.from(data);
    if (data.length > MAX_FILE) throw problem("Files must be under 12 MB.");
    const target = await resolve(p, file, { missing: true });
    await mkdir(path.dirname(target), { recursive: true });
    let previous = null;
    try {
      previous = await bytes(p, file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const id = randomUUID(),
      backup = path.join(directory, "file-history", owner(p), id);
    if (previous)
      await writeFile(backup, previous, { mode: 0o600, flag: "wx" });
    history.set(id, {
      profile: p,
      file,
      backup,
      existed: previous !== null,
      hash: createHash("sha256").update(data).digest("hex"),
      createdAt: Date.now(),
    });
    await persistHistory(p);
    await atomicWrite(target, data, id);
    return { file, bytes: data.length, undoId: id };
  }
  async function undo(p, id) {
    await loadHistory(p);
    const entry = history.get(id);
    if (!entry || entry.profile !== p)
      throw problem("That file undo is unavailable.", 404);
    let current;
    try {
      current = await bytes(p, entry.file);
    } catch (error) {
      if (error.code === "ENOENT")
        throw problem(
          "That file no longer exists at its saved name. Restore it from trash first.",
          409,
        );
      throw error;
    }
    if (createHash("sha256").update(current).digest("hex") !== entry.hash)
      throw problem(
        "The file changed after that action. The newer version was preserved.",
        409,
      );
    if (entry.movedFrom) {
      try {
        await resolve(p, entry.movedFrom);
        throw problem(
          "The original name is now in use. Both files were preserved.",
          409,
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await save(p, entry.movedFrom, current);
    }
    const target = await resolve(p, entry.file);
    if (entry.existed) await atomicWrite(target, await readFile(entry.backup));
    else await rm(target);
    history.delete(id);
    await persistHistory(p);
    return { file: entry.file };
  }
  async function move(p, from, to) {
    const source = await bytes(p, from);
    try {
      await resolve(p, to);
      throw problem(
        "The destination already exists. Choose another name.",
        409,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const saved = await save(p, to, source);
    const removed = await remove(p, from);
    history.get(saved.undoId).movedFrom = from;
    await persistHistory(p);
    return { ...saved, from, to, trashId: removed.trashId };
  }
  async function remove(p, file) {
    await loadHistory(p);
    const data = await bytes(p, file),
      id = randomUUID(),
      backup = path.join(directory, "trash", owner(p), id);
    await ensureDirectory(path.dirname(backup));
    await writeFile(backup, data, { mode: 0o600, flag: "wx" });
    trash.set(id, { id, profile: p, file, createdAt: Date.now() });
    await persistHistory(p);
    await rm(await resolve(p, file));
    return { file, trashId: id };
  }
  async function restore(p, id, file) {
    await loadHistory(p);
    if (!/^[a-f0-9-]{36}$/.test(id)) throw problem("Invalid trash entry.");
    file = file || trash.get(id)?.file;
    if (!file) throw problem("Choose the restore file name.");
    const data = await readFile(path.join(directory, "trash", owner(p), id));
    try {
      await resolve(p, file);
      throw problem("The restore destination already exists.", 409);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const result = await save(p, file, data);
    const entry = trash.get(id);
    if (entry) entry.restoredAt = Date.now();
    await persistHistory(p);
    return result;
  }
  async function fileHistory(p) {
    await loadHistory(p);
    return {
      changes: [...history.entries()]
        .filter(([, e]) => e.profile === p)
        .slice(-100)
        .reverse()
        .map(([id, { file, movedFrom, createdAt }]) => ({
          id,
          file,
          movedFrom,
          createdAt,
        })),
      trash: [...trash.values()]
        .filter((e) => e.profile === p && !e.restoredAt)
        .slice(-100)
        .reverse()
        .map(({ id, file, createdAt }) => ({ id, file, createdAt })),
    };
  }
  async function extract(p, file) {
    const data = await bytes(p, file),
      ext = path.extname(file).toLowerCase();
    let content;
    if ([".docx", ".xlsx"].includes(ext)) await inspectArchive(data);
    if (ext === ".pdf") {
      const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdf.getDocument({
        data: new Uint8Array(data),
        useSystemFonts: true,
        isEvalSupported: false,
      }).promise;
      try {
        const pages = [];
        for (let i = 1; i <= Math.min(doc.numPages, 150); i++) {
          const page = await doc.getPage(i);
          pages.push(
            (await page.getTextContent()).items
              .map((item) => item.str)
              .join(" "),
          );
        }
        content = pages.join("\n\n");
      } finally {
        await doc.destroy();
      }
    } else if (ext === ".docx") {
      const mammoth = await import("mammoth");
      content = (await mammoth.default.extractRawText({ buffer: data })).value;
    } else if (ext === ".xlsx") {
      const Excel = (await import("exceljs")).default,
        book = new Excel.Workbook();
      await book.xlsx.load(data);
      content = book.worksheets
        .map(
          (sheet) =>
            "Sheet: " +
            sheet.name +
            "\n" +
            sheet
              .getSheetValues()
              .slice(1, 1001)
              .map((row) => JSON.stringify(row || []))
              .join("\n"),
        )
        .join("\n\n");
    } else if (
      /\.(?:txt|md|csv|tsv|json|js|mjs|ts|tsx|jsx|py|html|css|xml|yaml|yml|log)$/i.test(
        file,
      )
    ) {
      content = data.toString("utf8");
      if (ext === ".json")
        try {
          JSON.parse(content);
        } catch {
          throw problem("That file does not contain valid JSON.", 422);
        }
    } else
      throw problem(
        "Text extraction supports PDF, DOCX, XLSX, text, CSV, JSON and source files. Images use the vision action; media uses the media tools.",
      );
    return {
      file,
      text: content.slice(0, 120000),
      truncated: content.length > 120000,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  }
  async function media(p, file, action, { start = 0, seconds = 30 } = {}) {
    await bytes(p, file);
    if (!/\.(?:mp4|webm|mov|mkv|avi|mp3|wav|flac|ogg|m4a)$/i.test(file))
      throw problem(
        "Choose a supported audio or video file; playlists and external file references are unsupported.",
      );
    const source = await resolve(p, file);
    if (
      !Number.isFinite(start) ||
      start < 0 ||
      !Number.isFinite(seconds) ||
      seconds < 1 ||
      seconds > 600
    )
      throw problem("Use a media segment of 1–600 seconds.");
    const suffix =
      action === "frame"
        ? ".jpg"
        : action === "audio"
          ? ".wav"
          : path.extname(file);
    if (!["frame", "audio", "trim"].includes(action))
      throw problem("Choose frame, audio or trim.");
    const output = "media/" + randomUUID() + suffix,
      target = await resolve(p, output, { missing: true });
    await mkdir(path.dirname(target), { recursive: true });
    const args = [
      "-protocol_whitelist",
      "file,pipe",
      "-nostdin",
      "-y",
      "-ss",
      String(start),
      "-i",
      source,
      ...(action === "frame"
        ? ["-frames:v", "1"]
        : action === "audio"
          ? ["-t", String(seconds), "-vn", "-ac", "1", "-ar", "16000"]
          : ["-t", String(seconds), "-c", "copy"]),
      "-fs",
      String(MAX_FILE + 65536),
      target,
    ];
    const result = await runProcess("ffmpeg", args, { timeoutMs: 60000 });
    if (result.code !== 0) {
      await rm(target, { force: true });
      throw problem("FFmpeg could not process that file.", 422);
    }
    const size = (await stat(target)).size;
    if (size > MAX_FILE) {
      await rm(target);
      throw problem(
        "The processed file exceeds 12 MB. Choose a shorter clip or smaller source.",
        413,
      );
    }
    return { file: output, bytes: size };
  }
  return {
    root,
    resolve,
    list,
    bytes,
    save: (p, file, data) => {
      const snapshot = Buffer.isBuffer(data) ? Buffer.from(data) : data;
      return serialize(p, () => save(p, file, snapshot));
    },
    undo: (p, id) => serialize(p, () => undo(p, id)),
    move: (p, from, to) => serialize(p, () => move(p, from, to)),
    remove: (p, file) => serialize(p, () => remove(p, file)),
    restore: (p, id, file) => serialize(p, () => restore(p, id, file)),
    history: fileHistory,
    extract,
    media,
    close: () => Promise.allSettled([...queues.values()]),
  };
}
