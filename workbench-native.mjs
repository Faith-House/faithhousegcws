import { fileURLToPath } from "node:url";
import path from "node:path";
import { runProcess } from "./workbench-files.mjs";
import { problem } from "./workbench-data.mjs";
import { findInstalledApp } from "./workbench-apps.mjs";
export { APP_ALIASES } from "./workbench-apps.mjs";
export const DESKTOP_ACTIONS = [
  "list_windows",
  "list_apps",
  "get_audio",
  "open_app",
  "close_app",
  "focus",
  "type",
  "hotkey",
  "click",
  "scroll",
  "volume",
  "mute",
  "brightness",
  "shutdown",
  "restart",
  "cancel_shutdown",
  "screenshot",
];
export function createNativeDesktop({
  execute = runProcess,
  platform = process.platform,
  browserDirectory,
  now = Date.now,
} = {}) {
  let catalog,
    scanned = 0,
    scanning;
  async function invoke(action, args = {}, options = {}) {
    options.signal?.throwIfAborted();
    const payload = Buffer.from(
      JSON.stringify({ ...args, action, protectedPid: process.pid }),
    ).toString("base64");
    // A short bootstrap avoids Windows’ command-line size limit; the script path is fixed by this module.
    const scriptPath = Buffer.from(
      fileURLToPath(new URL("./workbench-native.ps1", import.meta.url)),
      "utf8",
    ).toString("base64");
    const script =
      "$Payload='" +
      payload +
      "'\n& ([ScriptBlock]::Create([IO.File]::ReadAllText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" +
      scriptPath +
      "'))))) -Payload $Payload";
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const result = await execute(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { timeoutMs: 20000, maxOutput: 18 * 1024 * 1024, signal: options.signal },
    );
    if (result.code !== 0)
      throw problem(
        "Windows could not complete the action: " + result.output.slice(-300),
        502,
      );
    try {
      return JSON.parse(
        (result.stdout ?? result.output).replace(/^\uFEFF/, "").trim(),
      );
    } catch {
      throw problem(
        "Windows returned an unreadable result. Completion was not confirmed.",
        502,
      );
    }
  }
  async function installedApps({ refresh = false, signal } = {}) {
    signal?.throwIfAborted();
    if (platform !== "win32") return [];
    if (catalog && !refresh && now() - scanned < 60000) return catalog;
    // Shared discovery is read-only. A cancelled caller must not cancel another caller’s lookup.
    if (!scanning)
      scanning = invoke("list_apps")
        .then((result) => {
          if (!Array.isArray(result.apps))
            throw problem(
              "Windows could not read its installed app list.",
              502,
            );
          catalog = result.apps
            .filter(
              (a) => typeof a.name === "string" && typeof a.id === "string",
            )
            .slice(0, 1000);
          scanned = now();
          return catalog;
        })
        .finally(() => {
          scanning = null;
        });
    const apps = await scanning;
    signal?.throwIfAborted();
    return apps;
  }
  async function resolveApp(name, options = {}) {
    return findInstalledApp(await installedApps(options), name);
  }
  async function run(action, args = {}, options = {}) {
    options.signal?.throwIfAborted();
    if (platform !== "win32")
      throw problem("This desktop adapter currently supports Windows.", 503);
    if (!DESKTOP_ACTIONS.includes(action))
      throw problem("Unknown desktop action.");
    if (action === "list_apps")
      return {
        outcome: "confirmed",
        summary: "Read the installed Windows apps.",
        apps: (await installedApps(options)).map(({ name, id }) => ({
          name,
          id,
        })),
      };
    let selected;
    if (action === "open_app") {
      selected = await resolveApp(args.app, options);
      if (!selected)
        throw problem(
          "I couldn’t find “" +
            args.app +
            "” in the installed Windows apps. Give its full Start menu name, or a website address.",
          404,
        );
    }
    if (
      ["focus", "close_app", "type", "hotkey", "click", "scroll"].includes(
        action,
      ) &&
      (!Number.isInteger(args.pid) || args.pid <= 0 || args.pid === process.pid)
    )
      throw problem(
        "Choose the target window’s process ID from the window list.",
      );
    if (
      action === "type" &&
      (typeof args.text !== "string" || args.text.length > 4000)
    )
      throw problem("Type at most 4,000 characters.");
    if (
      action === "hotkey" &&
      ![
        "copy",
        "paste",
        "select_all",
        "enter",
        "escape",
        "tab",
        "save",
        "undo",
        "find",
        "next_tab",
        "previous_tab",
      ].includes(args.key)
    )
      throw problem("Choose a supported keyboard shortcut.");
    if (
      action === "click" &&
      (!Number.isFinite(args.x) ||
        !Number.isFinite(args.y) ||
        args.x < 0 ||
        args.y < 0 ||
        args.x > 20000 ||
        args.y > 20000)
    )
      throw problem("Choose valid screen coordinates.");
    if (
      action === "scroll" &&
      (!Number.isInteger(args.amount) || Math.abs(args.amount) > 10)
    )
      throw problem("Scroll at most ten wheel notches.");
    if (
      ["volume", "brightness"].includes(action) &&
      (!Number.isInteger(args.percent) ||
        args.percent < 0 ||
        args.percent > 100)
    )
      throw problem("Choose a percentage from 0 to 100.");
    if (action === "mute" && typeof args.muted !== "boolean")
      throw problem("Choose mute or unmute.");
    // Never accept an executable, launch arguments, or an app ID supplied outside OS discovery.
    const { app, appId, targetPath, appName, profileDirectory, ...input } =
      args;
    return invoke(
      action,
      {
        ...input,
        ...(selected
          ? {
              appId: selected.id,
              appName: selected.name,
              targetPath: selected.target,
            }
          : {}),
      },
      options,
    );
  }
  return {
    run,
    resolveApp,
    async focusBrowser(folder, options = {}) {
      if (platform !== "win32")
        return { outcome: "unverified", foreground: false };
      if (
        !browserDirectory ||
        path.dirname(path.resolve(folder)).toLowerCase() !==
          path.resolve(browserDirectory).toLowerCase()
      )
        throw problem("Choose a managed browser profile.");
      return invoke(
        "focus_browser",
        { profileDirectory: path.resolve(folder) },
        options,
      );
    },
    status: async () => ({
      available: platform === "win32",
      apps: (await installedApps()).map((a) => a.name),
      appDetails: (await installedApps()).map(({ name, id }) => ({ name, id })),
      actions: DESKTOP_ACTIONS,
    }),
  };
}
