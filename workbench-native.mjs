import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { runProcess } from "./workbench-files.mjs";
import { problem } from "./workbench-data.mjs";
export const DESKTOP_ACTIONS = [
  "list_windows",
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
export const APP_ALIASES = {
  notepad: "notepad.exe",
  calculator: "calc.exe",
  explorer: "explorer.exe",
  edge: "msedge.exe",
};
export function createNativeDesktop({
  execute = runProcess,
  platform = process.platform,
} = {}) {
  async function run(action, args = {}, options = {}) {
    options.signal?.throwIfAborted();
    if (platform !== "win32")
      throw problem("This desktop adapter currently supports Windows.", 503);
    if (!DESKTOP_ACTIONS.includes(action))
      throw problem("Unknown desktop action.");
    if (action === "open_app" && !Object.hasOwn(APP_ALIASES, args.app))
      throw problem(
        "Choose one of the approved app aliases: " +
          Object.keys(APP_ALIASES).join(", "),
      );
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
    const payload = Buffer.from(
      JSON.stringify({
        ...args,
        action,
        app: action === "open_app" ? APP_ALIASES[args.app] : undefined,
        protectedPid: process.pid,
      }),
    ).toString("base64");
    const script = (
      await readFile(
        fileURLToPath(new URL("./workbench-native.ps1", import.meta.url)),
        "utf8",
      )
    ).replace(/^param\([^\n]*\)\s*\r?\n/, "");
    const encoded = Buffer.from(
      "$Payload='" + payload + "'\n" + script,
      "utf16le",
    ).toString("base64");
    const result = await execute(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { timeoutMs: 15000, maxOutput: 18 * 1024 * 1024, signal: options.signal },
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
  return {
    run,
    status: () => ({
      available: platform === "win32",
      apps: Object.keys(APP_ALIASES),
      actions: DESKTOP_ACTIONS,
    }),
  };
}
