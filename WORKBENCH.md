# Jarvis Workbench

Open **Workbench** from the control dashboard, or visit [the local Workbench](http://127.0.0.1:3210/workbench). The dashboard link carries the selected room and roommate into a separate tab. Jarvis can keep listening in its original tab.

## Commands that use real tools

- “Open YouTube in a browser.”
- “Could you open github.com?”
- “Open YouTube in Chrome.”
- “Switch to Calculator.”
- “Bring Notepad to the front.”
- “Open Microsoft Word.”
- “Show my installed apps.”
- “Set computer volume to 40 percent.”
- “What is my computer volume?”
- “Take a screenshot.”
- “Remember that I prefer short explanations.”
- “What do you remember about me?”
- “List my workspace files.”
- “Research three affordable desk options.”
- “Create a code proposal for a Python study timer.”
- “Show my background tasks.”
- “Set a daily routine to tell me the weather at 8 AM.”

With **TV launch → Open websites on the room’s screen by default** enabled, website requests from the dashboard, quiet view, paired phone or linked Discord account use that room’s paired screen. This installation routes Living Room to **abc**. **“Open YouTube”** uses the Samsung’s installed YouTube app, with foreground state checked on the TV. The user physically confirmed it opened. **“On this computer”** or **“on my phone”** overrides the screen when asked from that device. Named screens must belong to the request’s room; ambiguous names require clarification. Specifying Chrome or Edge without a TV destination also keeps the request on the originating device.

Other websites and specific YouTube URLs navigate the paired receiver in its current tab; use the TV’s Back button to return to Jarvis. Refresh the TV’s Jarvis page once to load this update. The receiver accepts only live commands for its own pairing, with a single-use acknowledgement; reconnecting cannot replay navigation. Acknowledgement confirms delivery, not the external page’s final load. The response says “Opening.” Only opening the native YouTube homepage is supported as an app launch; video selection/playback is separate.

Without screen routing or a matching room screen, websites open on the device making the request. Jarvis tries a new browser tab; if the browser blocks it, the current tab navigates instead. Use Back to return to Jarvis in that case; microphone listening stops when its page is left. Only the requesting tab receives the action, and reconnecting does not replay it. This uses the current browser rather than launching a different installed browser. Discord returns a website link when no screen is selected.

The Workbench browser controls and local scheduled routines still use the central computer’s managed Edge or Chrome session. There, browser choice, URL/title checks and foreground verification apply. A loaded page whose window could not be focused remains unverified. The web app cannot inspect, click or type into an unrelated browser tab; those operations need a browser companion rather than silently using the central computer.

App requests use Windows’ installed Start menu entries, including packaged apps such as Calculator and Notepad. Jarvis accepts familiar aliases such as “Chrome,” “Word” and “VS Code,” reuses a matching open window when possible, restores it if minimized and verifies foreground focus. For names shared by an app and website, an installed app takes precedence; “in a browser” forces the website and “app” forces the installed app. Duplicate or missing entries need a more specific name. The Computer page lists actual installed entries; portable programs without a Windows app entry need to be registered first. Model-generated executable paths and launch arguments are not accepted.

Windows app controls need the local Jarvis connection on the central computer. A paired phone or a browser on another computer can navigate websites, but cannot launch or control native apps without a device companion. Those requests report the missing connection and do not operate the central computer. Discord cannot launch apps on its members’ devices. The Samsung YouTube launcher and bringing its paired receiver forward use the approved TV connection. Other wording can use the local planner, which validates its arguments before executing tools.

Opening apps, listing installed apps and navigating websites work with **Shared profile**. Shared browsing uses a separate session for each room and never borrows a roommate’s browser profile. Personal files, saved memory, research/code tasks, routines, desktop screenshots and other desktop input still require a selected roommate. The shared tool catalog contains only app launch/listing and browser navigation/read/input tools; shared browser screenshots are excluded.

The dashboard’s **Using** menu shows the active profile. A deliberate profile selection is saved on this browser and reused when a voice is not identified. A fresh recognized voice selects that roommate for the voice turn; a subsequent unknown voice does not inherit the last person recognized. Typed requests return to the deliberate selection, or Shared if none was chosen. Profile selection also carries between the dashboard and Workbench. Discord commands use the profile and room linked to the Discord account. A voice match and a manually selected preference profile are not secure identity checks.

## Direct execution and action history

**Settings → Ask before running commands** controls the Workbench review step. With it off, supported commands execute immediately. Computer and managed-browser access have separate enable switches. The household owner requested direct execution for this installation.

**Actions** shows destinations, actual results, output and failures. A delivered mouse click or keypress can remain unverified until the application’s resulting state is checked. Changing execution mode cancels old queued approvals rather than replaying them. The action log is bounded and clears on restart. Calendar-event confirmation is a separate existing flow.

## Files and recovery

Each profile has a managed workspace under `private/workspaces/<profile>/`. Uploads are limited to 12 MB. File actions operate inside that workspace and reject path traversal, linked folders and Windows device names.

Files supports text/source editing, PDF/DOCX/XLSX text extraction, image conversion, bounded ZIP extraction and supported audio/video processing through FFmpeg. Compressed document sizes are checked before parsing. Media playlists and external references are not accepted.

**Recent changes & trash** lists recoverable versions and deleted files. Recovery metadata and backups survive a server restart. Undo refuses to overwrite a later edit, and restoring trash refuses to replace a file that already exists. Concurrent writes to one profile are serialized. No permanent-delete control is provided.

Managed workspace files are separate from arbitrary folders on the computer. An uploaded project is a copy. Running a program uses the Windows account’s permissions; it is not an operating-system sandbox.

## Coding and background work

Research, summaries and code proposals run one at a time with saved progress and a 1–30 minute task budget. Ordinary direct commands do not require a model-planning call. Model-based conversation can still wait when Ollama is busy.

- **Cancel** stops active work and retains its saved status.
- **Refine task** adds instructions for the next stage. A model call already underway may finish before seeing them.
- **Finish early** saves a clearly labeled partial report containing checkpointed progress.
- Interrupted and budget-limited tasks pause until explicitly resumed.

Code tasks write draft files under their task folder. **Review files** compares current and proposed content. **Apply proposal** writes the selected draft only if its original input files still match. It does not run code. **Check** parses JavaScript/Python syntax or validates JSON; it is not a behavior test. **Run** executes a chosen managed JavaScript or Python file with bounded time and output.

Cancelling an active request aborts local model calls and owned code processes where supported. Earlier completed side effects are not automatically reversed. Work already accepted by an external service may still have occurred.

## Public research

Research searches public sources and reads bounded pages. It blocks local/private destinations, rechecks redirects, and pins the connection to the DNS address it validated. Page text is untrusted data and has no action tools. Exact source-text matches support quoted excerpts; that verifies attribution, not the truth of every model-written claim. Reports list their sources and coverage gaps. Missing or blocked sources are reported rather than replaced by invented evidence.

## Browser, computer and vision

The managed browser uses separate Edge or Chrome profiles for each roommate. It does not inherit ordinary browser tabs or sign-ins. Navigation, page reading, exact-label clicks, field input, supported keys and screenshots are available. Downloads are disabled in this managed session. At most two managed browser sessions may run at once on this laptop. Closing the active browser selects the profile’s other open managed browser, if available.

Computer controls include installed app launch/switching, window selection, supported input, audio readback, volume/mute, supported display brightness, screenshots and delayed power commands. App discovery is read-only and cached for up to a minute. Browser focus identifies the managed profile’s actual processes rather than selecting an unrelated browser window. The window picker fills the target automatically. Input to protected processes is refused; coordinates must belong to the chosen process. Some external monitors do not expose brightness control.

Vision runs through a selected installed Ollama vision model. Upload an image, capture an explicitly requested desktop screenshot, or open the webcam and save a frame. Camera permission is still controlled by the browser. Images stay local. On this laptop vision can take substantially longer than text conversation; a successful small-image check does not establish accuracy for every screenshot or document.

The default rings remain available. Reactor and avatar variants can be selected in Settings. The avatar’s mouth follows audio amplitude, not phoneme-level lip synchronization.

## Routines, memory and Discord

Routines support one-time, interval, daily, weekday, weekly, monthly, startup and idle schedules. Clock schedules use an IANA time zone. Respecting quiet hours can defer a due routine. Interrupted startup commands are disabled until re-enabled so an uncertain external action is not blindly repeated.

Memory stores only explicitly saved profile facts. Forgetting a fact is reversible in the Memory section. These records are separate from short-lived conversation history and LangGraph state. Research does not automatically receive saved household facts.

Messages sends only to configured Discord channels for linked profiles. With direct execution on, Send posts the supplied message immediately. Mention notifications are disabled. Discord accepting a message does not prove anyone read it. No test messages are posted to household channels by the automated tests.

## Startup and network changes

Existing configured phone/TV listeners recover a changed Wi-Fi address on startup when one suitable private address is clear. Virtual and ambiguous interfaces are not silently selected. Phone certificate renewal preserves the existing local CA; a missing CA requires setup rather than silently replacing trusted identity. A changed address may still require opening the new URL and pairing a browser again. This does not open firewall ports or configure a new service that was previously off.

For closed-lid operation, Windows must remain awake, powered and online. This laptop’s plugged-in lid/sleep settings were changed at the owner’s request; the previous values are saved under `private/runtime/closed-lid-original-power.json`. Battery settings were preserved. This cannot guarantee an uninterrupted Codex work session or reserve a usage allowance.

Calendar accounts, Home Assistant devices, real room microphones and telephone service still need their respective setup steps. Automatic browser launch and native YouTube were physically verified on the Samsung test TV; standby wake and additional TVs need their own tests. Workbench does not make those connections by itself.
