import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
export const problem = (message, status = 400) =>
  Object.assign(Error(message), { status });
export const text = (value, max = 2000) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw problem("Enter valid text of up to " + max + " characters.");
  return value.trim();
};
export const owner = (value) => {
  if (
    typeof value !== "string" ||
    !value ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(value)
  )
    throw problem("Choose a roommate profile first.");
  return value;
};
export function createWorkbenchStore(directory) {
  const file = path.join(directory, "workbench.json");
  let data,
    loading,
    broken = false,
    chain = Promise.resolve();
  const empty = () => ({
    format: 1,
    settings: {
      desktopEnabled: false,
      browserEnabled: false,
      requireApproval: true,
      visionModel: "",
      visualStyle: "rings",
      quietStart: "23:00",
      quietEnd: "07:00",
      timeZone: "America/Chicago",
    },
    memory: [],
    tasks: [],
    routines: [],
  });
  async function initialize() {
    return (loading ??= (async () => {
      try {
        data = JSON.parse(await readFile(file, "utf8"));
        if (
          data.format !== 1 ||
          !data.settings ||
          !["memory", "tasks", "routines"].every((k) => Array.isArray(data[k]))
        )
          throw Error();
      } catch (error) {
        data = empty();
        if (error.code !== "ENOENT") broken = true;
      }
    })());
  }
  async function read() {
    await initialize();
    const copy = structuredClone(data);
    copy.settings = { ...empty().settings, ...copy.settings };
    return { ...copy, configurationError: broken };
  }
  function update(fn) {
    const task = chain.then(async () => {
      await initialize();
      if (broken)
        throw problem(
          "The workbench data file needs attention. Its original contents were preserved.",
          503,
        );
      const next = structuredClone(data),
        result = await fn(next);
      await mkdir(directory, { recursive: true });
      await writeFile(file + ".tmp", JSON.stringify(next, null, 2) + "\n", {
        mode: 0o600,
      });
      await rename(file + ".tmp", file);
      data = next;
      return structuredClone(result);
    });
    chain = task.catch(() => {});
    return task;
  }
  return { read, update, close: () => chain };
}
