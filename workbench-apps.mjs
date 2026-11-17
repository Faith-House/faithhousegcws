import { problem } from "./workbench-data.mjs";

export const APP_ALIASES = {
  notepad: "Notepad",
  calculator: "Calculator",
  calc: "Calculator",
  explorer: "File Explorer",
  "file explorer": "File Explorer",
  edge: "Microsoft Edge",
  browser: "Microsoft Edge",
  chrome: "Google Chrome",
  "google chrome": "Google Chrome",
  firefox: "Firefox",
  discord: "Discord",
  spotify: "Spotify",
  "spotify music": "Spotify",
  word: "Word",
  excel: "Excel",
  powerpoint: "PowerPoint",
  outlook: "Outlook",
  "microsoft word": "Word",
  "microsoft excel": "Excel",
  "microsoft powerpoint": "PowerPoint",
  "microsoft outlook": "Outlook",
  "vs code": "Visual Studio Code",
  vscode: "Visual Studio Code",
  code: "Visual Studio Code",
  "visual studio code": "Visual Studio Code",
  obs: "OBS Studio",
  vlc: "VLC media player",
  teams: "Microsoft Teams",
};
const key = (name) =>
  name.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");

export function findInstalledApp(apps, name) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 160 ||
    /[\x00-\x1f]/.test(name)
  )
    throw problem("Give the installed app’s name.");
  const input = key(name),
    alias = key(APP_ALIASES[input] || name);
  const exact = apps.filter(
    (a) => key(a.id) === input || key(a.name) === input,
  );
  const matches = exact.length
    ? exact
    : apps.filter(
        (a) =>
          key(a.name) === alias ||
          key(a.name).replace(/^(?:microsoft|google) /, "") === alias,
      );
  const unique = [...new Map(matches.map((a) => [a.id, a])).values()];
  if (unique.length > 1)
    throw problem(
      "More than one installed app matches “" +
        name +
        "”. Choose its exact entry from the Computer app list.",
      409,
    );
  return unique[0] || null;
}
