import { JarvisOrb } from "./orb.js";
const $ = (id) => document.getElementById(id),
  sections = [
    "Overview",
    "Files",
    "Browser",
    "Computer",
    "Vision",
    "Coding",
    "Tasks",
    "Routines",
    "Memory",
    "Messages",
    "Actions",
    "Settings",
  ];
const params = new URLSearchParams(location.search);
let refreshEpoch = 0;
let current =
    sections.find((name) => name.toLowerCase() === location.hash.slice(1)) ||
    "Overview",
  snapshot,
  profileId =
    params.get("profileId") ||
    localStorage.getItem("jarvis.profile") ||
    localStorage.getItem("jarvis-workbench-profile") ||
    "cooper",
  room =
    params.get("room") ||
    localStorage.getItem("jarvis-workbench-room") ||
    "bedroom-1",
  folder = "",
  orb,
  camera;
const node = (tag, content, className) => {
  const el = document.createElement(tag);
  if (content !== undefined) el.textContent = content;
  if (className) el.className = className;
  return el;
};
const button = (label, handler, className) => {
  const el = node("button", label, className);
  el.type = "button";
  el.addEventListener("click", () => guard(handler));
  return el;
};
function executionCopy(review, immediate) {
  return snapshot.settings.requireApproval === false ? immediate : review;
}
function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
  $("notice").classList.toggle("error", error);
}
async function guard(fn) {
  try {
    await fn();
  } catch (error) {
    notice(error.message, true);
  }
}
async function api(url, body) {
  const response = await fetch(
    url,
    body === undefined
      ? { signal: AbortSignal.timeout(15000) }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(100000),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error || "That action could not finish.");
  return result;
}
async function action(action, args = {}) {
  const result = await api("/api/workbench/action", {
    profileId,
    room,
    action,
    args,
  });
  showResult(result);
  await refresh(false);
  if (result.approvalId) {
    current = "Actions";
    render();
  }
  return result;
}
const fileUrl = (file, preview = false) =>
  "/api/workbench/file?" +
  new URLSearchParams({
    profileId,
    file,
    ...(preview ? { preview: "1" } : {}),
  });
function showResult(result) {
  $("result-panel").hidden = false;
  $("result-summary").textContent =
    result.summary || result.result?.summary || result.status || "Updated.";
  const { summary, ...detail } = result;
  $("result-detail").textContent = JSON.stringify(detail, null, 2);
  $("result-media").replaceChildren();
  if (result.file) preview(result.file, $("result-media"));
}
function preview(file, parent) {
  const extension = file.split(".").pop().toLowerCase();
  let el;
  if (["png", "jpeg", "jpg", "webp"].includes(extension)) {
    el = node("img");
    el.src = fileUrl(file, true);
    el.alt = file;
    el.className = "preview-image";
  } else if (["mp4", "webm", "mp3", "wav", "ogg"].includes(extension)) {
    el = node(["mp4", "webm"].includes(extension) ? "video" : "audio");
    el.controls = true;
    el.preload = "metadata";
    el.src = fileUrl(file, true);
  }
  if (el) parent.append(el);
  const a = node("a", "Download " + file);
  a.href = fileUrl(file);
  a.download = "";
  parent.append(node("p")).append(a);
}
function card(title, copy, parent = $("content")) {
  const el = node("section", undefined, "card");
  el.append(node("h2", title));
  if (copy) el.append(node("p", copy));
  parent.append(el);
  return el;
}
function field(form, name, label, type = "text", value = "", options) {
  const holder = node("label", label);
  let input;
  if (options) {
    input = node("select");
    for (const option of options) {
      const [value, label] = Array.isArray(option) ? option : [option, option];
      const el = node("option", label);
      el.value = value;
      input.append(el);
    }
  } else input = node(type === "textarea" ? "textarea" : "input");
  if (!options && type !== "textarea") input.type = type;
  input.name = name;
  if (type === "checkbox") input.checked = Boolean(value);
  else input.value = value;
  holder.append(input);
  form.append(holder);
  return input;
}
function form(parent, title, description, fields, submit, onSubmit) {
  const panel = title ? card(title, description, parent) : parent,
    el = node("form");
  panel.append(el);
  for (const f of fields) field(el, ...f);
  const send = node("button", submit, "primary");
  send.type = "submit";
  el.append(send);
  el.addEventListener("submit", (event) => {
    event.preventDefault();
    void guard(async () => {
      send.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(el));
        for (const input of el.querySelectorAll("input[type=checkbox]"))
          data[input.name] = input.checked;
        await onSubmit(data, el);
      } finally {
        send.disabled = false;
      }
    });
  });
  return el;
}
function grid() {
  const el = node("div", undefined, "grid");
  $("content").append(el);
  return el;
}
function list(parent, items, renderRow) {
  if (!items.length) {
    parent.append(node("p", "Nothing here yet.", "empty"));
    return;
  }
  for (const item of items) renderRow(item, parent);
}
function row(parent, title, detail, badge) {
  const el = node("div", undefined, "row"),
    left = node("div");
  left.append(node("h3", title));
  if (detail) left.append(node("p", detail, "small muted"));
  el.append(left);
  if (badge) el.append(node("span", badge, "badge"));
  parent.append(el);
  return left;
}
function syncScopeUrl() {
  const url = new URL(location.href);
  url.searchParams.set("profileId", profileId);
  url.searchParams.set("room", room);
  url.hash = current.toLowerCase();
  history.replaceState(null, "", url);
}
async function refresh(draw = true) {
  const epoch = ++refreshEpoch;
  if (!snapshot) {
    const initial = await api("/api/workbench");
    if (epoch !== refreshEpoch) return;
    if (!initial.profiles.some((p) => p.id === profileId))
      profileId = initial.profiles[0]?.id || "";
    if (!initial.rooms.includes(room)) room = initial.rooms[0] || "bedroom-1";
  }
  const requestedProfile = profileId,
    info = await api(
      "/api/workbench?" + new URLSearchParams({ profileId: requestedProfile }),
    );
  if (epoch !== refreshEpoch || requestedProfile !== profileId) return;
  snapshot = info;
  const rosterKey = snapshot.profiles.map((p) => p.id + ":" + p.name).join("|");
  if ($("profile").dataset.roster !== rosterKey) {
    $("profile").replaceChildren(
      ...snapshot.profiles.map((p) => {
        const e = node("option", p.name);
        e.value = p.id;
        return e;
      }),
    );
    $("profile").dataset.roster = rosterKey;
  }
  $("profile").value = profileId;
  const roomKey = snapshot.rooms.join("|");
  if ($("room").dataset.roster !== roomKey) {
    $("room").replaceChildren(
      ...snapshot.rooms.map((r) => {
        const e = node("option", r.replaceAll("-", " "));
        e.value = r;
        return e;
      }),
    );
    $("room").dataset.roster = roomKey;
  }
  $("room").value = room;
  syncScopeUrl();
  if (snapshot.configurationError)
    notice(
      "The saved Workbench data needs attention. Its contents have been preserved.",
      true,
    );
  if (draw) render();
}
function render() {
  orb?.destroy();
  orb = null;
  stopCamera();
  $("content").replaceChildren();
  $("page-title").textContent = current;
  for (const button of $("navigation").children)
    button.classList.toggle("active", button.dataset.page === current);
  const renderers = {
    Overview: overview,
    Files: files,
    Browser: browser,
    Computer: computer,
    Vision: vision,
    Coding: coding,
    Tasks: tasks,
    Routines: routines,
    Memory: memory,
    Messages: messages,
    Actions: approvals,
    Settings: settings,
  };
  renderers[current]();
}
function overview() {
  const hero = card(
    "A little more capable. A lot more useful.",
    executionCopy(
      "Give Jarvis a task, keep an eye on its progress, and review commands before they run.",
      "Give Jarvis a task. Commands run immediately, with their results recorded in Actions.",
    ),
  );
  hero.classList.add("hero");
  const text = node("div");
  while (hero.firstChild) text.append(hero.firstChild);
  text.prepend(node("p", "YOUR LOCAL ASSISTANT, EXPANDED", "kicker"));
  hero.append(text);
  const canvas = node("canvas");
  hero.append(canvas);
  orb = new JarvisOrb(canvas);
  orb.setStyle?.(snapshot.settings.visualStyle);
  orb.setState("idle");
  const metrics = node("div", undefined, "metrics");
  $("content").append(metrics);
  const memory = snapshot.health.memory;
  for (const [value, label] of [
    [
      snapshot.health.cpuPercent === null
        ? "—"
        : snapshot.health.cpuPercent + "%",
      "Measured CPU load",
    ],
    [
      (memory.usedBytes / 2 ** 30).toFixed(1) +
        " / " +
        (memory.totalBytes / 2 ** 30).toFixed(1) +
        " GB",
      "Memory in use",
    ],
    [
      snapshot.tasks.filter((t) => ["running", "queued"].includes(t.status))
        .length,
      "Active background tasks",
    ],
  ]) {
    const el = node("div", undefined, "metric");
    el.append(node("strong", value), node("span", label));
    metrics.append(el);
  }
  const g = grid(),
    cap = card(
      "Capability check",
      "Availability reflects the current setup.",
      g,
    );
  for (const [name, detail] of [
    [
      "Computer controls",
      snapshot.settings.desktopEnabled
        ? executionCopy(
            "Enabled · review required",
            "Enabled · runs immediately",
          )
        : "Off · enable in Settings",
    ],
    [
      "Managed browser",
      snapshot.settings.browserEnabled
        ? "Enabled · separate profile sessions"
        : "Off · enable in Settings",
    ],
    [
      "Vision",
      snapshot.settings.visionModel || "Choose an installed vision model",
    ],
    ["Research & coding", "Local model · saved reports · one task at a time"],
    [
      "Discord",
      snapshot.discord?.connected
        ? executionCopy(
            "Connected · reviewed outbound messages",
            "Connected · direct messaging",
          )
        : "Not connected",
    ],
    [
      "House services",
      "Calendar, TV, phones and devices keep their existing setup",
    ],
  ])
    row(cap, name, null, detail);
  const recent = card(
    "Pick up where you left off",
    "Tasks survive restarts; interrupted work waits for you to resume.",
    g,
  );
  list(recent, snapshot.tasks.slice(0, 4), (t, p) =>
    row(p, t.goal, t.stage, t.status),
  );
  recent.append(
    button("View all tasks", () => {
      current = "Tasks";
      render();
    }),
  );
}
function files() {
  const g = grid(),
    panel = card(
      "Your workspace",
      "Files stay inside the selected housemate’s workspace. Maximum upload: 12 MB.",
      g,
    );
  const toolbar = node("div", undefined, "actions");
  toolbar.append(
    button("Root", () => {
      folder = "";
      return loadFiles(panel);
    }),
    button("Parent folder", () => {
      folder = folder.split("/").slice(0, -1).join("/");
      return loadFiles(panel);
    }),
  );
  panel.append(toolbar);
  const path = node("p", folder || "Workspace root", "small muted");
  path.id = "folder-label";
  panel.append(path);
  const listing = node("div", undefined, "list");
  listing.id = "file-list";
  panel.append(listing);
  const upload = node("input");
  upload.type = "file";
  upload.setAttribute("aria-label", "Choose a file to upload");
  upload.addEventListener("change", () =>
    guard(async () => {
      const file = upload.files[0];
      if (!file) return;
      if (file.size > 12 * 1024 * 1024)
        throw Error("Choose a file under 12 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 16384)
        binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      await action("files.upload", {
        file: (folder ? folder + "/" : "") + file.name,
        base64: btoa(binary),
      });
      await loadFiles(panel);
    }),
  );
  panel.append(node("p", "Upload a file"), upload);
  void guard(() => loadFiles(panel));
  form(
    g,
    "Create or edit text",
    "Saving replaces this workspace file. The result includes an undo ID.",
    [
      ["file", "Relative file name", "text", "notes.txt"],
      ["content", "Text", "textarea", ""],
    ],
    "Save file",
    (data) => action("files.save", data),
  );
  form(
    g,
    "File actions",
    "Read and preview a file before moving, processing or removing it.",
    [
      ["file", "Workspace file", "text", ""],
      [
        "operation",
        "Action",
        "select",
        "read",
        [
          "read",
          "move",
          "delete",
          "image",
          "archive",
          "frame",
          "audio",
          "trim",
        ],
      ],
      ["to", "New file name (move)", "text", ""],
      ["width", "Image width", "number", "1280"],
      ["start", "Media start (seconds)", "number", "0"],
      ["seconds", "Media duration (seconds)", "number", "30"],
    ],
    "Run file action",
    async (data) => {
      const { operation, ...args } = data;
      for (const k of ["width", "start", "seconds"]) args[k] = Number(args[k]);
      await action(
        ["frame", "audio", "trim"].includes(operation)
          ? "files.media"
          : "files." + operation,
        { ...args, operation },
      );
      await loadFiles(panel);
    },
  );
  form(
    g,
    "Recover a file change",
    "Use the undo or trash ID shown in the action result. Recovery refuses to overwrite a newer file.",
    [
      ["operation", "Recovery", "select", "undo", ["undo", "restore"]],
      ["id", "Undo / trash ID"],
      ["file", "Restore file name (trash only)"],
    ],
    "Recover",
    (data) => action("files." + data.operation, data),
  );
  const recovery = card(
    "Recent changes & trash",
    "Recovery history survives a Jarvis restart. Undo preserves newer edits; restoring a deleted file refuses to replace an existing file.",
    g,
  );
  const loadRecovery = async () => {
    const result = await api("/api/workbench/action", {
      profileId,
      room,
      action: "files.history",
      args: {},
    });
    recovery.replaceChildren(
      node("h2", "Recent changes & trash"),
      button("Refresh", loadRecovery),
    );
    recovery.append(node("h3", "Deleted files"));
    list(recovery, result.trash, (entry, parent) => {
      const item = row(
        parent,
        entry.file,
        new Date(entry.createdAt).toLocaleString(),
        "TRASH",
      );
      item.append(
        button("Restore", async () => {
          await action("files.restore", { id: entry.id, file: entry.file });
          await loadRecovery();
          await loadFiles(panel);
        }),
      );
    });
    recovery.append(node("h3", "Recent file changes"));
    list(recovery, result.changes.slice(0, 15), (entry, parent) => {
      const item = row(
        parent,
        entry.file,
        (entry.movedFrom ? "Moved from " + entry.movedFrom + " · " : "") +
          new Date(entry.createdAt).toLocaleString(),
      );
      item.append(
        button("Undo", async () => {
          await action("files.undo", { id: entry.id });
          await loadRecovery();
          await loadFiles(panel);
        }),
      );
    });
  };
  void guard(loadRecovery);
}
async function loadFiles(panel) {
  const list = panel.querySelector("#file-list");
  if (!list) return;
  const result = await api("/api/workbench/action", {
    profileId,
    room,
    action: "files.list",
    args: { folder },
  });
  if (!list.isConnected) return;
  list.replaceChildren();
  panel.querySelector("#folder-label").textContent = folder || "Workspace root";
  for (const file of result.files) {
    const r = row(
      list,
      (file.directory ? "▱ " : "") + file.name,
      null,
      file.directory ? "FOLDER" : "FILE",
    );
    if (file.directory)
      r.append(
        button("Open", () => {
          folder = file.path;
          return loadFiles(panel);
        }),
      );
    else {
      const actions = node("div", undefined, "actions");
      actions.append(
        button("Read", () => action("files.read", { file: file.path })),
        button("Preview", () => {
          showResult({ summary: file.path, file: file.path });
        }),
      );
      const link = node("a", "Download");
      link.href = fileUrl(file.path);
      actions.append(link);
      r.append(actions);
    }
  }
  if (!result.files.length)
    list.append(node("p", "This folder is empty.", "empty"));
}
function browser() {
  const g = grid();
  form(
    g,
    "Managed browser",
    executionCopy(
      "Jarvis uses separate Edge or Chrome profiles on this computer. Opening pages and sending input require review.",
      "Jarvis uses separate Edge or Chrome profiles on this computer. Pages open and come forward automatically.",
    ),
    [
      [
        "operation",
        "Action",
        "select",
        "open",
        [
          "open",
          "read",
          "screenshot",
          "click",
          "type",
          "press",
          "back",
          "forward",
          "close",
        ],
      ],
      ["url", "Page address", "url", "https://example.com"],
      [
        "engine",
        "Browser for opening a page",
        "select",
        "",
        [
          ["", "Last used (Edge initially)"],
          ["edge", "Microsoft Edge"],
          ["chrome", "Google Chrome"],
        ],
      ],
      ["label", "Exact button / field label"],
      [
        "role",
        "Button role",
        "select",
        "button",
        ["button", "link", "menuitem", "tab"],
      ],
      ["value", "Text to enter", "textarea", ""],
      [
        "key",
        "Key",
        "select",
        "Enter",
        [
          "Enter",
          "Escape",
          "Tab",
          "ArrowDown",
          "ArrowUp",
          "PageDown",
          "PageUp",
        ],
      ],
    ],
    "Run browser action",
    (data) => action("browser", data),
  );
  const info = card(
    "Separate sessions",
    "This does not control your usual browser tabs or inherit their sign-ins.",
    g,
  );
  list(info, snapshot.browser.sessions, (p, el) => row(el, p, null, "OPEN"));
}
function computer() {
  const g = grid();
  const controls = form(
    g,
    "Computer controls",
    executionCopy(
      "Choose the target window’s process ID from the window list before sending input. Actions wait for local review.",
      "Choose the target window’s process ID from the window list before sending input. Commands execute immediately.",
    ),
    [
      [
        "operation",
        "Action",
        "select",
        "list_windows",
        snapshot.desktop.actions,
      ],
      [
        "app",
        "Installed application",
        "select",
        snapshot.desktop.appDetails?.find((a) => a.name === "Notepad")?.id ||
          snapshot.desktop.apps?.[0] ||
          "",
        snapshot.desktop.appDetails?.map(({ name, id }) => [id, name]) ||
          snapshot.desktop.apps ||
          [],
      ],
      ["pid", "Target process ID", "number", ""],
      ["text", "Text to type", "textarea", ""],
      [
        "key",
        "Shortcut",
        "select",
        "copy",
        [
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
        ],
      ],
      ["percent", "Volume / brightness %", "number", "50"],
      ["muted", "Mute audio", "checkbox", true],
      ["x", "Click X", "number", "0"],
      ["y", "Click Y", "number", "0"],
      ["amount", "Scroll notches", "number", "-2"],
    ],
    "Run computer action",
    (data) => {
      for (const k of ["pid", "percent", "x", "y", "amount"])
        data[k] = Number(data[k]);
      return action("desktop", data);
    },
  );
  card(
    "Visible outcomes",
    "Say “Open Word” or “Switch to Calculator.” Jarvis finds the installed app and reuses its window when possible. It checks that the window is in front. Mouse and keyboard input is reported as delivered; the application’s final result may still need inspection. Shutdown and restart are delayed 60 seconds and can be cancelled.",
    g,
  );
  const picker = card(
      "Choose an open window",
      "Select a window to fill in its target automatically.",
      g,
    ),
    windowList = node("div");
  picker.append(
    button("Read open windows", async () => {
      const result = await api("/api/workbench/action", {
        profileId,
        room,
        action: "desktop",
        args: { operation: "list_windows" },
      });
      windowList.replaceChildren();
      list(windowList, result.windows || [], (window, parent) => {
        const item = row(parent, window.title || window.app, window.app);
        item.append(
          button("Use this window", () => {
            controls.elements.namedItem("pid").value = window.pid;
            notice(
              "Selected " +
                (window.title || window.app) +
                ". Choose the action above.",
            );
          }),
        );
      });
    }),
    windowList,
  );
}
function stopCamera() {
  camera?.getTracks().forEach((t) => t.stop());
  camera = null;
}
function vision() {
  const g = grid();
  form(
    g,
    "Ask about an image",
    "Vision stays local. Select an installed vision model in Settings; no model is downloaded automatically. Upload an image in Files, or capture one here.",
    [
      ["file", "Image file", "text", ""],
      ["question", "Question", "textarea", "Describe what you see."],
    ],
    "Analyze locally",
    (data) => action("vision", data),
  );
  const panel = card(
      "Capture from your webcam",
      "The camera stays off until you open it. Nothing is streamed to a cloud service.",
      g,
    ),
    video = node("video", undefined, "camera");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  panel.append(video);
  const actions = node("div", undefined, "actions");
  actions.append(
    button("Open camera", async () => {
      stopCamera();
      camera = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      video.srcObject = camera;
      await video.play();
    }),
    button("Save frame", async () => {
      if (!camera || !video.videoWidth) throw Error("Open the camera first.");
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const result = await action("files.upload", {
        file: "captures/camera-" + Date.now() + ".jpg",
        base64: canvas.toDataURL("image/jpeg", 0.8).split(",")[1],
      });
      stopCamera();
      video.srcObject = null;
      notice("Saved " + result.file + ". Use that file for image analysis.");
    }),
    button("Turn off", () => {
      stopCamera();
      video.srcObject = null;
    }),
  );
  panel.append(
    actions,
    button("Request desktop capture", () =>
      action("desktop", { operation: "screenshot" }),
    ),
  );
}
function coding() {
  const g = grid();
  form(
    g,
    "Propose a coding change",
    "Jarvis creates draft files in your workspace. Use Apply proposal when you want them written to your project.",
    [
      ["goal", "What should the code do?", "textarea", ""],
      ["files", "Input file paths (comma-separated)"],
      ["minutes", "Time budget (minutes)", "number", "5"],
    ],
    "Start coding task",
    (data) =>
      action("tasks.start", {
        kind: "code",
        goal: data.goal,
        files: data.files
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        minutes: Number(data.minutes),
      }),
  );
  form(
    g,
    "Check or run a file",
    executionCopy(
      "Static checks parse syntax. Running a program requires review and uses your account’s computer permissions.",
      "Static checks parse syntax. Run executes the chosen file immediately with your account’s computer permissions.",
    ),
    [
      ["file", "Workspace code file"],
      ["operation", "Action", "select", "check", ["check", "run"]],
    ],
    "Request",
    (data) => action("code." + data.operation, { file: data.file }),
  );
  const panel = card(
    "Ready for review",
    executionCopy(
      "Review the proposed files, then request approval to apply them.",
      "Inspect the proposed files or apply them directly.",
    ),
  );
  list(
    panel,
    snapshot.tasks.filter((t) => t.kind === "code" && t.changes?.length),
    (t, p) => {
      const r = row(p, t.goal, t.stage, t.status);
      r.append(
        button("Review files", () => reviewCode(t)),
        button("Apply proposal", () => action("code.apply", { id: t.id })),
      );
    },
  );
}
async function reviewCode(task) {
  $("review-panel").hidden = false;
  $("proposal-files").replaceChildren();
  for (const change of task.changes) {
    const section = node("section");
    section.append(node("h3", change.path));
    const columns = node("div", undefined, "review-columns");
    let before = "New file";
    try {
      const r = await api("/api/workbench/action", {
        profileId,
        room,
        action: "files.read",
        args: { file: change.path },
      });
      before = r.text;
    } catch {}
    const after = await api("/api/workbench/action", {
      profileId,
      room,
      action: "files.read",
      args: { file: change.proposalFile },
    });
    for (const [label, content] of [
      ["Current file", before],
      ["Proposed file", after.text],
    ]) {
      const el = node("div");
      el.append(node("p", label, "small muted"), node("pre", content));
      columns.append(el);
    }
    section.append(
      columns,
      button("Check proposal syntax", () =>
        action("code.check", { file: change.proposalFile }),
      ),
    );
    $("proposal-files").append(section);
  }
  $("review-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}
function tasks() {
  form(
    $("content"),
    "Start a background task",
    "One task runs at a time to limit load. Research reads public pages; summaries use workspace documents. Notes steer the next stage rather than rewriting completed work.",
    [
      [
        "kind",
        "Task type",
        "select",
        "research",
        ["research", "summarize", "code"],
      ],
      ["goal", "Goal", "textarea", ""],
      ["files", "Input file paths (comma-separated)"],
      ["minutes", "Time budget (minutes)", "number", "5"],
    ],
    "Start task",
    (data) =>
      action("tasks.start", {
        ...data,
        files: data.files
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        minutes: Number(data.minutes),
      }),
  );
  const panel = card(
    "Saved progress",
    "Interrupted tasks pause after a restart. Resume explicitly to continue.",
  );
  list(panel, snapshot.tasks, (t, p) => {
    const r = row(
        p,
        t.goal,
        t.stage + (t.error ? " · " + t.error : ""),
        t.status,
      ),
      a = node("div", undefined, "actions");
    if (t.reportFile)
      a.append(
        button("Read report", () =>
          action("files.read", { file: t.reportFile }),
        ),
      );
    if (["failed", "paused"].includes(t.status))
      a.append(
        button("Resume", () =>
          action("tasks.change", { id: t.id, operation: "resume" }),
        ),
      );
    if (["running", "queued", "paused"].includes(t.status))
      a.append(
        button("Refine task", () => {
          if (r.querySelector("form")) return;
          form(
            r,
            "",
            "",
            [["note", "What should Jarvis change?", "textarea", ""]],
            "Save refinement",
            async (data, element) => {
              await action("tasks.change", {
                id: t.id,
                operation: "steer",
                note: data.note,
              });
              element.remove();
            },
          );
        }),
      );
    if (["running", "queued", "paused"].includes(t.status))
      a.append(
        button("Finish early", () =>
          action("tasks.change", { id: t.id, operation: "finish" }),
        ),
      );
    if (["running", "queued", "paused"].includes(t.status))
      a.append(
        button(
          "Cancel",
          () => action("tasks.change", { id: t.id, operation: "cancel" }),
          "danger",
        ),
      );
    if (t.changes?.length) a.append(button("Review code", () => reviewCode(t)));
    r.append(a);
  });
  form(
    $("content"),
    "Steer an active task",
    "Add a short refinement for the selected task. A model request already in progress may finish before it sees the note.",
    [
      ["id", "Task ID"],
      ["note", "Refinement", "textarea", ""],
    ],
    "Save refinement",
    (data) => action("tasks.change", { ...data, operation: "steer" }),
  );
}
function routines() {
  const g = grid();
  form(
    g,
    "Schedule a routine",
    "Times use the selected time zone. Quiet routines wait until quiet hours end. Missed recurring runs are dispatched once, not replayed in a burst.",
    [
      ["title", "Routine name"],
      [
        "kind",
        "Routine type",
        "select",
        "say",
        ["say", "research", "command", "briefing"],
      ],
      ["instruction", "Message / research goal / command", "textarea", ""],
      [
        "mode",
        "Schedule",
        "select",
        "daily",
        [
          "once",
          "interval",
          "daily",
          "weekdays",
          "weekly",
          "monthly",
          "startup",
          "idle",
        ],
      ],
      ["time", "Time", "time", "08:00"],
      ["at", "One-time date", "datetime-local", ""],
      ["minutes", "Interval / idle minutes", "number", "60"],
      ["weekday", "Weekday (0 Sunday – 6 Saturday)", "number", "1"],
      ["day", "Day of month", "number", "1"],
      ["timeZone", "Time zone", "text", snapshot.settings.timeZone],
      ["quiet", "Respect quiet hours", "checkbox", true],
    ],
    "Save routine",
    (data) => {
      const schedule = { mode: data.mode };
      if (data.mode === "once") schedule.at = new Date(data.at).toISOString();
      if (["interval", "idle"].includes(data.mode))
        schedule.minutes = Number(data.minutes);
      if (["daily", "weekdays", "weekly", "monthly"].includes(data.mode))
        schedule.time = data.time;
      if (data.mode === "weekly") schedule.weekday = Number(data.weekday);
      if (data.mode === "monthly") schedule.day = Number(data.day);
      return action("routines.add", {
        title: data.title,
        kind: data.kind,
        instruction: data.instruction,
        timeZone: data.timeZone,
        quiet: data.quiet,
        schedule,
      });
    },
  );
  const panel = card(
    "Your routines",
    executionCopy(
      "Protected actions still need review at execution time.",
      "Routine commands follow the current execution setting.",
    ),
    g,
  );
  list(panel, snapshot.routines, (r, p) => {
    const el = row(
      p,
      r.title,
      (r.nextAt
        ? new Date(r.nextAt).toLocaleString(undefined, {
            timeZone: r.timeZone,
          }) + " · "
        : "") +
        r.timeZone +
        (r.lastOutcome ? " · " + r.lastOutcome : ""),
      r.enabled ? "ENABLED" : "PAUSED",
    );
    el.append(
      button(r.enabled ? "Pause" : "Enable", () =>
        action("routines.change", {
          id: r.id,
          operation: r.enabled ? "disable" : "enable",
        }),
      ),
      button(
        "Remove",
        () => action("routines.change", { id: r.id, operation: "delete" }),
        "danger",
      ),
    );
  });
}
function memory() {
  const g = grid();
  form(
    g,
    "Remember something",
    "Facts are saved only when explicitly requested. Each profile has its own facts; voice identification alone is not a secure login.",
    [["fact", "Fact to remember", "textarea", ""]],
    "Save fact",
    (data) => action("memory", { action: "save", ...data }),
  );
  const panel = card(
    "Saved facts",
    "Deleted facts can be restored. This folder can move to a NAS later.",
    g,
  );
  list(panel, snapshot.memory, (m, p) => {
    const r = row(
      p,
      m.fact,
      new Date(m.createdAt).toLocaleDateString(),
      m.deletedAt ? "DELETED" : "SAVED",
    );
    r.append(
      button(m.deletedAt ? "Restore" : "Forget", () =>
        action("memory", {
          action: m.deletedAt ? "restore" : "delete",
          id: m.id,
        }),
      ),
    );
  });
}
function messages() {
  form(
    $("content"),
    "Send a Discord message",
    executionCopy(
      "Only configured Discord channels can be used. Review the destination and message in Actions before sending.",
      "Messages send immediately to the selected configured Discord channel.",
    ),
    [
      [
        "channelId",
        "Approved text channel",
        "select",
        snapshot.discord?.channels?.[0] || "",
        (snapshot.discord?.channels || []).map((id) => [
          id,
          snapshot.discord.channelLabels?.[id]
            ? "#" + snapshot.discord.channelLabels[id]
            : id,
        ]),
      ],
      ["message", "Message", "textarea", ""],
    ],
    executionCopy("Prepare for review", "Send message"),
    (data) => action("discord.send", data),
  );
}
function approvals() {
  const panel = card(
    "Action history",
    executionCopy(
      "Review queued commands or inspect past results. Approvals expire after five minutes and are never replayed after a restart.",
      "Commands execute immediately. See their destinations, outcomes and output here. Nothing is replayed after a restart.",
    ),
  );
  list(panel, snapshot.approvals, (a, p) => {
    const el = row(
      p,
      a.title,
      new Date(a.createdAt).toLocaleTimeString(),
      a.status,
    );
    el.append(node("pre", JSON.stringify(a.detail, null, 2)));
    if (a.status === "needs_approval") {
      const buttons = node("div", undefined, "actions");
      buttons.append(
        button(
          "Approve & execute",
          async () => {
            showResult(
              await api("/api/workbench/approve", { id: a.id, allow: true }),
            );
            await refresh();
          },
          "primary",
        ),
        button(
          "Cancel",
          async () => {
            await api("/api/workbench/approve", { id: a.id, allow: false });
            await refresh();
          },
          "danger",
        ),
      );
      el.append(buttons);
    } else if (a.result) {
      el.append(node("p", a.result.summary || a.status));
      if (a.result.file) preview(a.result.file, el);
      if (a.result.output) el.append(node("pre", a.result.output));
    }
  });
}
function settings() {
  const g = grid();
  form(
    g,
    "Permissions & appearance",
    "Choose the available controls and whether commands should wait for review or run immediately.",
    [
      [
        "desktopEnabled",
        "Enable computer controls",
        "checkbox",
        snapshot.settings.desktopEnabled,
      ],
      [
        "browserEnabled",
        "Enable managed browser",
        "checkbox",
        snapshot.settings.browserEnabled,
      ],
      [
        "requireApproval",
        "Ask before running commands",
        "checkbox",
        snapshot.settings.requireApproval !== false,
      ],
      [
        "visualStyle",
        "Assistant visual",
        "select",
        snapshot.settings.visualStyle,
        ["rings", "reactor", "avatar"],
      ],
      ["quietStart", "Quiet hours begin", "time", snapshot.settings.quietStart],
      ["quietEnd", "Quiet hours end", "time", snapshot.settings.quietEnd],
      ["timeZone", "Time zone", "text", snapshot.settings.timeZone],
    ],
    "Save settings",
    async (data) => {
      showResult(await api("/api/workbench/settings", data));
      await refresh();
    },
  );
  const panel = card(
      "Local vision model",
      "Vision is optional and may be slow on this laptop. Only already installed models with verified image support appear here. No downloads.",
      g,
    ),
    load = button("Find installed models", async () => {
      load.disabled = true;
      try {
        const result = await api("/api/workbench/models");
        const models = result.models.filter((m) => m.vision);
        form(
          panel,
          "",
          "",
          [
            [
              "visionModel",
              "Vision model",
              "select",
              snapshot.settings.visionModel,
              [["", "Disabled"], ...models.map((m) => [m.name, m.name])],
            ],
          ],
          "Save vision choice",
          async (data) => {
            showResult(await api("/api/workbench/settings", data));
            await refresh(false);
          },
        );
        load.remove();
        if (!models.length)
          panel.append(
            node("p", "No installed model reported vision support."),
          );
      } finally {
        load.disabled = false;
      }
    });
  panel.append(load);
}
for (const [i, label] of sections.entries()) {
  const el = button(label, () => {
    current = label;
    notice("");
    syncScopeUrl();
    render();
  });
  el.prepend(node("span", String(i + 1).padStart(2, "0")));
  el.dataset.page = label;
  $("navigation").append(el);
}
$("profile").addEventListener("change", () =>
  guard(async () => {
    profileId = $("profile").value;
    folder = "";
    localStorage.setItem("jarvis-workbench-profile", profileId);
    localStorage.setItem("jarvis.profile", profileId);
    $("result-panel").hidden = true;
    $("review-panel").hidden = true;
    await refresh();
  }),
);
$("room").addEventListener("change", () => {
  room = $("room").value;
  localStorage.setItem("jarvis-workbench-room", room);
  syncScopeUrl();
});
$("dismiss-result").addEventListener("click", () => {
  $("result-panel").hidden = true;
});
$("close-review").addEventListener("click", () => {
  $("review-panel").hidden = true;
});
let refreshing = false;
setInterval(() => {
  if (document.hidden || refreshing) return;
  refreshing = true;
  void refresh(false)
    .then(() => {
      if (
        ["Tasks", "Actions", "Overview"].includes(current) &&
        !$("content").contains(document.activeElement)
      )
        render();
    })
    .catch(() => notice("Connection interrupted. Retrying…", true))
    .finally(() => {
      refreshing = false;
    });
}, 10000);
window.addEventListener("pagehide", () => {
  stopCamera();
  orb?.destroy();
});
void guard(() => refresh());
