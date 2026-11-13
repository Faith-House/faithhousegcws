# faithhousegcws

Jarvis — a local house assistant prototype

Updated November 13, 2026. This prototype provides a central computer dashboard, typed and spoken questions, local “Hey Jarvis” detection, real local Ollama answers, Peter and other local neural spoken replies, orange Jarvis rings, and a Google Calendar setup path. It uses one computer. Models and software are downloaded during setup; microphone processing, AI, speech, and HUD assets run locally afterward.

## Start

1. Double-click **Jarvis** on the Windows desktop. It starts the local server if needed and opens the Control room in a browser.
2. Keep Ollama running with qwen3:0.6b installed. If the shortcut reports a problem, double-click START.cmd in this folder to see the details.
3. Choose a room and select Talk to Jarvis, Type a question, or Hey Jarvis. Pressing Enter or clicking the rings also opens the question input.
5. Type a question and press Enter. The input closes, the real answer streams onto the HUD, and Jarvis reads it aloud after the voice is prepared.

This computer's software and models are installed. The desktop shortcut runs OPEN-JARVIS.ps1, which checks the local server identity, starts the installed recovery task when needed, and opens the browser. On a new computer, install Node.js 22 or later, run npm ci in this folder, then run SETUP-VOICE.cmd, SETUP-MICROPHONE.cmd, and SETUP-LISTENING.cmd once with internet access. Ollama and its conversation model are installed separately. Keep the computer awake while Jarvis is in use.

## Central dashboard and TV dashboard

The central computer opens the Control room at http://127.0.0.1:3210/. It shows measured processor, memory, and storage use, server uptime, this computer’s network checks, actual housemate profiles, room/screen pairings, saved active timers, and activity from the current browser session. Weather, Home Assistant, and phone connections are labeled unavailable until configured; no random metrics or sample appointments are used. Quiet view at /assistant retains the minimal full-screen assistant.

Say or type **“Show the dashboard”** or **“Pull up the dashboard on the TV.”** The central computer switches in place; a paired TV for the selected room follows while its Jarvis receiver is open. Say **“Back to Jarvis”** or **“Close the dashboard”** to restore the minimal view. The same canvas, speech player, and listening session continue without a page reload. A paired TV is not required for the computer's dashboard. The dashboard stays open between answers until dismissed; a server restart resets TVs to minimal mode. Without automatic TV launch enabled, a command does not wake a powered-off TV or switch away from another TV app/HDMI.

The TV receives only its assigned room’s timers, responses, and screen information, plus shared host readings and household names. It does not receive voice templates, other rooms’ activity, or central control access. If a shared calendar preview is requested, that room’s paired TV receives its event titles and times. The mode switch does not navigate the browser or change its address. Refresh the TV receiver once to load this update; the existing pairing remains valid.

## Automatic Samsung TV launch — physical test pending

Open **TV launch** in the question panel or visit /tv-launch. This new integration can connect questions in one paired display's room to the saved Samsung remote connection. It reuses the approved local token and pinned TLS certificate. Select the test display, save with automatic launch off, and use **Test opening Jarvis on the TV** when someone can see the screen. The setup supports the existing single Samsung test TV; additional TVs need their own approved remote connections before expanding this mapping.

The launcher requests the Tizen browser with the exact local receiver URL, then tries the known numeric Samsung Internet app ID if no receiver presence arrives. The paired receiver now reports foreground visibility. An open network connection alone is not treated as proof that Jarvis is visible. If the browser remains on its home page or needs pairing, the result stays unconfirmed. Physical appearance and navigation must be checked on the actual TV; this path has only been tested with simulated remote transport and paired receiver sessions so far.

After a successful physical test, enable automatic launch. Questions in the assigned room then request the TV in the background while the assistant answers. The answer remains available while launch is pending. Other rooms do not operate this TV. Wake-on-LAN is optional and requires the TV's MAC address and compatible enabled standby network wake; a wake packet does not prove the TV powered on. Previous TV apps/HDMI are not automatically restored, and this does not overlay Jarvis on a show.

Automatic launch and wake remain off by default. The user said the TV was not available for a launch test, so no browser, input or power commands were sent to the physical TV during this implementation. The saved remote token and pinned certificate are not exposed by the setup routes. The central control interface stays on localhost; the TV receiver retains only its room's read-only access plus its own presence heartbeat. Phone access is available separately through the paired HTTPS gateway described below.

A changed computer LAN address requires updating the receiver address and may require pairing the TV browser once at the new address. Refresh a previously open receiver page once to load the presence reporting update. Receiver or navigation failures appear in the TV launch page and tool activity, rather than becoming a spoken success claim. Protocol references: [SamsungTVWS browser launcher](https://github.com/xchwarze/samsung-tv-ws-api/blob/master/samsungtvws/remote.py) and [Home Assistant Samsung wake guidance](https://www.home-assistant.io/integrations/samsungtv/#turn-on-action).

## Google Calendar preview

The quiet calendar uses a wide seven-column weekly layout, an expanded day timeline, a highlight for today, and event start/end times. Its orange glass panel matches the Jarvis rings. On narrow screens the week becomes a scrollable two-column layout. The display only appears on request; the full dashboard does not open.

Before connecting an account, open http://127.0.0.1:3210/assistant?calendarDemo=week or choose **Try calendar demo** on the dashboard. Switch between Today and This week using the preview buttons; close with × or “Close calendar preview.” You can also ask “Show the calendar demo for this week.” Demo events are fictional and never written to Google.

House setup at /setup can import a Google Desktop OAuth client file and start Google sign-in. Create a Google Cloud project, enable Google Calendar API, create a Desktop OAuth client, and use its downloaded JSON file. Jarvis stores the OAuth client and token locally. Ask “Show my calendar today” or “Show me this week” to display titles and times in the quiet rings view. The paired TV for the selected room receives the same preview. To add an event, state its exact title and time; Jarvis reads back a draft and waits for “confirm” before writing it.

This prototype currently connects one account’s primary calendar, so use a dedicated shared household Google account with no private events. Anyone using the shared assistant can ask to see it. Voice matching is not personal-calendar authorization. Private calendars, individual account switching, Apple Calendar, and personal-calendar privacy controls are not connected.

The home TV address is still configured for the home network. On the current different Wi-Fi, the central dashboard works on localhost and the saved screen is shown as paired, with its receiver unavailable. No new network or firewall access was opened.

## Local reminders

Open **Reminders** from the dashboard, or visit /reminders. Choose the room, enter a title and a future date/time in the displayed house time zone, and select **Set reminder**. The timeline shows upcoming and due items; **Done** or **Cancel** clears an item.

You can also say:

- “Remind me to check the oven in twenty minutes.”
- “Remind me tomorrow at 7 PM to take out the trash.”
- “Show my reminders.”
- “Cancel the reminder to take out the trash.”

Reminders are one-time alerts, up to 30 days ahead, saved in private/reminders.json. They are shared within a room. Jarvis must run for alerts to appear; keep a central browser open to hear the chime. Paired TVs show the chosen room’s visual alert. If the computer is off or asleep, overdue reminders appear after Jarvis starts again and remain until dismissed. No phone push notifications or recurring alarms are included. Ambiguous AM/PM and times skipped/repeated by daylight-saving changes require clarification.

## Natural-language commands and AI tools

Jarvis uses a local tool registry and planner for compound requests and unfamiliar phrasing. Try “Give me two minutes for tea and then show the dashboard” or “I need a nudge to check laundry in ten minutes.” If Jarvis asks how long a countdown should run, you can answer “five minutes.” Clarification stays in the same room/profile for two minutes. Open **Tools** on the dashboard for available actions and recent results.

Routine direct commands keep their fast handlers. More flexible requests use local Ollama to propose bounded tool calls. Arguments are checked before a batch executes; results come from the handlers. Conditional requests read actual data before changes. A failure stops later steps. The current small model can still misunderstand, so test each additional use case. No RAG pipeline is used.

See TOOLS.md for the tool catalog, execution limits, measured local examples, model settings, and current service limitations.

## Phone access

Phone access is implemented and a phone pairing was confirmed by the user. Run **SETUP-PHONE.cmd** on the central Windows computer once to prepare a local CA and server certificate for its current private Wi-Fi address. The helper needs OpenSSL (it uses the Git for Windows copy by default; set JARVIS_OPENSSL for another installed executable). It does not change Windows or phone certificate trust. Restart Jarvis after setup, then open **Phone access** at /phones on the computer.

The Phone access page shows the current certificate setup address, secure phone address and CA fingerprint. Open the setup address on the phone on the same trusted Wi-Fi, install/trust the public Jarvis CA certificate after comparing the fingerprint, then open secure Jarvis. On the computer, choose the phone's room/profile and create a one-use five-minute code. Pair the phone with that code; no voice recording is required. The user confirmed successful pairing on November 12. Physical phone microphone capture and spoken playback still need their own user check.

The phone interface supports typed requests, tap-to-record local transcription, local spoken replies and calendar/weather previews. Speech is transcribed on the central computer; check the transcript and send it. The orange Jarvis rings remain on the phone. Each phone's room/profile comes from pairing, not from fields it can override. It can stop or request audio only for its own latest request. Disconnect a phone on /phones or from the phone itself; sessions expire after 30 days. Central configuration, voice enrollment, model setup and raw profile data are not exposed to the phone gateway.

The certificate-only HTTP setup listener uses port 3214 and the HTTPS phone app uses port 3215 by default, bound to the configured private interface. The central app stays loopback-only. Raw phone tokens and TLS signing/private keys stay under private/ and must not be committed or distributed. No router forwarding, global certificate trust, firewall rule changes, cellular access or background phone wake-word listening were added. Keep the central computer awake. A changed LAN address requires re-running setup to renew the server certificate, restarting Jarvis and possibly pairing at the new address. See [Apple certificate trust](https://support.apple.com/en-us/102390), [Google certificate settings](https://support.google.com/pixelphone/answer/2844832?hl=en) and [browser microphone secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).

## Daily weather display

Daily weather reports for current conditions, today, tomorrow or a named day now occupy most of the quiet screen, with a large temperature, animated condition symbol, forecast date and a wide metrics row. Current conditions include available wind and humidity readings; future days show forecast high/low and precipitation without relabeling today's measurements. Weather requests switch to quiet view so the report is not confined to the dashboard card. The central computer and paired TV use the same renderer. Use the close button on the computer or say “Close weather.” Weekly forecasts retain their seven-day grid. Reduced-motion preferences stop the condition-symbol orbit animation.

## Normal mode and coding mode

Jarvis now has a separate, configurable local model slot for coding. Open **AI models** in the question panel, or visit http://127.0.0.1:3210/models. Install the chosen model in Ollama on the target computer, refresh the page, and save it as the coding model. The everyday model stays JARVIS_MODEL (currently qwen3:0.6b). A coding model has not been selected or downloaded automatically: the future Beelink's exact RAM/GPU specifications are still needed to choose the final model. Installing a larger model here does not prove it will run well on this current 8 GB computer.

Say “coding mode,” “switch to developer mode,” or “normal mode.” A switch checks that the second model is installed locally; a missing model leaves the current mode unchanged and explains the setup needed. Each room/profile has its own mode. Mode resets to normal on New conversation or server restart; the configured coding model persists locally in private/model-routing.json. Cloud-model tags and known remote-backed entries are not offered.

Coding answers use the second model, an 8,192-token context and up to 2,048 output tokens by default, a longer timeout, longer pasted inputs and a readable monospace answer layout. Set JARVIS_CODING_CONTEXT and JARVIS_CODING_OUTPUT before startup to tune the limits for the target computer. The input limit is bounded by the configured context. Short-lived conversation history is reused with a bounded budget. Switching does not preload the weights; the next coding answer may take longer while Ollama loads them. Normal answers and household tool planning retain the fast model.

Coding mode can write, explain, review and debug supplied code. It has no repository editor or terminal connected and does not claim to have changed files or run tests. Pasted code is kept out of household action routing; explicit short household commands still use existing tools. Use the existing spoken-reply controls if you prefer code answers silently on screen. See [Ollama chat API](https://docs.ollama.com/api/chat) for local model selection and runtime options.

## Follow-ups, multiple actions, clarification and undo

Conversation context includes both tool results and ordinary answers, scoped to the current room and roommate profile. It expires after five minutes without a completed turn and is cleared by Reset. This is short-lived local conversation context, not long-term memory. Try “What is the weather tomorrow?” followed by “What about Saturday?” or “Show the demo calendar” followed by “Make it a week view.” Weekday weather is limited to the provider’s seven-day forecast. Calendar previews support named weekdays and tomorrow; demo follow-ups stay fictional.

A single request can contain several actions: “Set a timer for two minutes and add water the plant as a chore and show the dashboard.” Recognized common clauses use a fast parser; unfamiliar phrasing goes to the local Ollama planner. All calls in a planned batch are validated before changes. Later steps stop if a handler fails, and the response reports the completed steps. Public web search remains a separate terminal request. The small local model can still ask for rephrasing when it cannot produce a valid plan.

Missing details produce a short question: “Remind me to check the oven” → “When should I remind you?” → “In five minutes.” Clarification lasts two minutes in the same room/profile. “Never mind” drops the pending request. A new unrelated request replaces it.

Say or type “Undo that” to reverse the most recent supported request in this room/profile, including its supported actions in reverse order. Supported changes are newly created chores, reminders and active timers; chore completion and assignment; and voice/typed dashboard or calendar-preview changes. Reading the clock or a list does not consume undo history. Chore undo refuses to overwrite a newer edit. Finished timers, removed reminders, unsupported device/calendar writes and changes made directly in other pages are not automatically reversible. Undo history lasts ten minutes, stays in memory, and clears on Reset or server restart. Tool activity records undo outcomes.

## Voice-reactive rings

A layered assembly of concentric orange rings replaces the original sphere: illuminated outer bands, counter-rotating light tiles, machined tracks, fine indexing marks, and a central aperture. Different layers rotate at independent speeds and alternate directions. Glow, radial filaments, expansion, and speed respond to the microphone's measured level while capturing a question and to Jarvis's actual spoken playback. Voice attacks launch fading outward wavefronts. The assembly stays large while listening or speaking without text, then makes room for a requested answer. It settles after audio ends; reduced-motion settings suppress rotation, expansion, and wavefronts.

The paired TV receives room-specific animation state and a numeric level, not an extra audio recording. Stale animation clears after 1.5 seconds. The TV still stays dark while idle and only displays requested answers. Refresh its Jarvis browser page once to load the new renderer; its existing pairing remains valid. The TV was off during this design update, so the new renderer's physical-TV appearance still needs checking.

## Hands-free listening

Press Enter, keep Spoken replies checked, and select Enable “Hey Jarvis”. Allow the microphone if prompted. Once the indicator says Listening for “Hey Jarvis”, say the wake phrase, wait for the short chime, then ask a question and pause. Jarvis transcribes and sends the question automatically, displays the answer, and reads it aloud. Allow voice interruptions is on by default: wake listening continues during replies, and buffered microphone audio preserves words immediately after the wake phrase.

Stop listening or Escape ends capture and detection. Listening starts off after refresh, navigation, room changes, or reopening the page. Keep the page open and the computer awake. One tab may own the wake listener at a time. Say “Hey Jarvis, stop” during a reply to end it, or “Hey Jarvis” followed by another question to replace it. Playback stops at wake detection. Turning Allow voice interruptions off restores pausing during answers and playback. Echo cancellation and a stricter playback detection gate reduce false triggers; actual speaker/microphone placement still needs testing. Use Stop speaking or Escape at any time.

Talk to Jarvis uses the original review-before-send microphone flow and turns hands-free mode off. An unfinished typed draft pauses wake detection so it cannot replace the draft. Microphone recordings are not saved. Wake processing averaged about 3.3 ms per 80-ms frame in synthetic tests; this does not establish real-room detection accuracy. See LISTENING.md for instructions, limits, and tuning.

## Roommate profiles and speaker recognition

Open http://127.0.0.1:3210/profiles for Wade, Grayson, Cooper, and Seattle. Each person chooses their bedroom, Jarvis voice, spoken replies, and answer length. Choose Set up voice on your own card, consent, and record three different sentences. Then use Test recognition with a new sentence. No actual roommate voice has been enrolled by the assistant.

After enrollment, refresh Jarvis and leave Recognize who is speaking enabled. A match from the question audio selects the person’s preferences; uncertain speakers use the shared profile. Matching stays local, raw recordings are discarded, and only the derived voice signature is saved under private/. Recognition does not authorize doors, private devices, or calendars. See PROFILES.md for details and limits.

## Spoken replies

Peter uses PCM streaming: audio begins as chunks arrive, and a finished first sentence can play while the AI generates the rest. Audio analysis and the rings follow actual playback. Stop, mute, request replacement, and microphone interruption cancel queued audio. A complete WAV is retained in browser memory for replay. Keep the browser’s audio permission enabled.

On this laptop, a warm 4.8-second sample produced its first chunk in 0.77 seconds and finished generation in 4.39 seconds. A live browser time answer delivered its first chunk at about 3.7 seconds versus 5.7 seconds for completion. Cold preload still took roughly 23 seconds; these measurements are examples, not a guarantee that every reply is instant.

- The selected default is **Peter · British**, also saved for Cooper’s profile. Kokoro voices George, Fable, Michael, Emma, and Heart remain selectable.
- Pocket TTS 4.0.1 is installed with Charles and Peter voice choices. After restarting Jarvis, they appear as **Charles · Pocket** and **Peter · British** in the same voice selector. Cooper chose Peter after the audition; other roommate preferences and voice enrollments were preserved.
- For another Windows computer, run SETUP-POCKET-VOICE.cmd with uv installed. It creates an isolated Python environment, installs CPU-only dependencies, and caches the pinned English model and two stock voice states. The runtime blocks network connections and uses only those cached files.
- In this laptop’s sample checks, Pocket took about 6–9 seconds for a four-second sample once loaded. A longer offline sample took about 34 seconds including cold startup; the next sample took about 5 seconds for 5.6 seconds of audio. Cold startup and memory use remain important limits on this 8 GB machine. Voice quality is for the user to judge from the generated samples.
- Press Enter to open the input panel. Select **Peter · British** and use Test voice to audition it. **Refresh voices** reloads the catalog. A stale server produces a clear update notice instead of silently hiding Peter.
- Uncheck Spoken replies to mute automatic narration. The setting is remembered in this browser.
- Stop speaking stops the audio without clearing the answer; Escape also stops playback. Hear reply replays the current answer.
- If the browser blocks automatic audio, select Hear reply once. The app reports blocked playback instead of pretending it played.
- Only the tab that submitted a question automatically speaks it. Other tabs showing the same room stay silent unless Hear reply is selected explicitly.
- Generating a natural voice takes more work than the earlier Windows voice. On the current laptop, the sample measured about 8–10 seconds to prepare about four seconds of speech. Text appears first. The final house computer still needs a voice/AI performance benchmark.
- Speech runs in a separate local process with remote model fetching disabled. The downloaded model and installed voice files are used locally, with no hosted speech API or per-reply service charge.
- Peter is preloaded when the voice panel initializes and remains loaded for five minutes between replies (JARVIS_VOICE_IDLE_MS can adjust this). Kokoro unloads after 90 seconds idle. Audio replies are held briefly in memory and are not written to a conversation-recording folder.

Press Escape once to close the input, or with the input closed to stop/dismiss the answer. Completed answers clear after enough time to read them. Open the input and choose New conversation to clear that room's conversation history.

The default model is deliberately small for the current laptop. It is a connection/prototype model; answer quality and action reliability do not establish readiness for the finished house system.

## Display-only mode and rooms

- Normal page: http://127.0.0.1:3210
- Clean display: http://127.0.0.1:3210/display?room=bedroom-1
- Room IDs: bedroom-1, bedroom-2, bedroom-3, bedroom-4, living-room.

The question input has a room selector. A display receives only events for its selected room. To test, open a normal page and a clean-display page on the same computer with the same room. Other rooms' displays should remain idle. Rooms are routing contexts, not authenticated personal identities.

The control page listens only on this computer's loopback address. A separate read-only, room-bound TV receiver is configured for the saved home address. The Samsung is paired as abc; the user confirmed a time answer appeared. Latest dashboard rendering and view-switch behavior still need the next physical Samsung check. See HOUSE-SETUP.md. Room microphone hardware remains to be connected.

## What works

- Voice-reactive concentric orange rings, counter-rotating bands, and reduced-motion support.
- Typed local conversations through Ollama; responses are not canned demo answers.
- Local Whisper microphone input, local openWakeWord detection, a chime, automatic question submission, and automatic return to wake listening after replies.
- Real time/date, named room timers saved across restarts, and on-request diagnostics for this computer’s connection to its gateway. Keep Jarvis open for timer alerts; this check does not verify internet access or whole-house Wi-Fi coverage.
- Local neural spoken replies, voice selection, mute, stop, replay, and a speaking animation state.
- Streamed answers, separate room histories, cancellation, reconnection, and short-lived response display.
- Visible errors if Ollama/model generation fails.
- Explicit unavailable-connection messages for common unconnected devices, calendars, calls, router monitoring and live weather. These avoid asking the tiny model to invent service results.
- One AI answer at a time to keep this initial laptop prototype light.

## What comes later

Room microphone units, automatic TV wake/app switching, Home Assistant devices, personal authentication, Google/iCloud accounts, router device monitoring, and telephone service remain to be connected. A Home Assistant bridge is prepared for explicitly approved shared lights and TVs; private devices and door controls remain blocked. See HOUSE-SETUP.md. A model response is not evidence that a home action occurred.

## Configuration

The server uses built-in Node.js features and requires Node 22 or later. Defaults:

- JARVIS_MODEL: qwen3:0.6b
- JARVIS_PORT: 3210
- JARVIS_OLLAMA_URL: http://127.0.0.1:11434 (a local HTTP endpoint only)
- JARVIS_SPEECH_VOICE: bm_george unless another installed neural preset is selected
- JARVIS_SPEECH_THREADS: 4 (maximum 4 for this prototype)
- JARVIS_VOICE_ENGINE: defaults to the neural voice; explicitly set windows to use the earlier offline Windows voice instead
- JARVIS_WAKE_THRESHOLD: 0.5; higher values make wake detection less sensitive
- JARVIS_TIMEZONE: the system time zone unless configured; this setup uses America/Chicago

START.cmd reads .env.local if present; .env.example documents optional settings. Keep .env.local, private/, and credentials out of source control and shared archives. For another downloaded model, set JARVIS_MODEL before starting. Runtime does not download models or use cloud fallbacks. Short conversation history and microphone buffers stay in memory. Timers and hashed TV pairings use private/. No runtime microphone recording is created.

Source: server.mjs contains the local application server; public/ contains the HUD and audio player; neural-speech.mjs and neural-speech-worker.mjs run the local voice. Model files live under models/kokoro. The model manifest records the downloaded revision and file hashes.

Ollama API reference: https://docs.ollama.com/api/chat

Neural voice implementation/model: https://github.com/hexgrad/kokoro/tree/main/kokoro.js and https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX (Apache-2.0).

Wake models: https://github.com/dscripka/openWakeWord. See MODEL-NOTICES.md for attribution and licenses. Run npm run check and npm test for listening checks, which require SETUP-LISTENING.cmd for real-model tests.

## Internet search

Ask “Search the web for NASA Artemis updates”, “Could you look up college packing lists?”, or “What is the latest NASA news?” Explicit lookups and common public current-information questions route to search. Other questions still use local tools or the local model. For a question that does not trigger search, say “look up” explicitly. Keep a search separate from requests to change household devices.

The default provider is DuckDuckGo’s public HTML search page; no search account, paid subscription or API key is configured. This is a best-effort HTML integration, not a guaranteed search API. Provider page changes, rate limits, challenges or internet outages can interrupt it. Jarvis reports failure instead of pretending it verified an answer. A dedicated provider API can replace it later.

The question is sent to DuckDuckGo over HTTPS. Calendar data, conversation history, voice recordings, profile templates and credentials are not attached. Results are title/link/snippet extracts: Jarvis does not open or read full source pages, crawl links or execute page scripts. Local Ollama summarizes these snippets, which may be stale or incomplete. The display labels this limitation and shows clickable source links; highlighted links are those cited by the local summary. Check original sources for exact figures, dates and important decisions.

Summarization runs without action tools. The search tool is terminal and cannot feed website instructions into a later house-control plan. Unusable or invalid model output falls back to source snippets. Stop/interruption cancels the pending request. Sources appear only with the answer, clear on a new question, and reach only the paired TV for that room. Search results are temporary and are not saved as long-term memory.

Set `JARVIS_WEB_SEARCH=off` in `.env.local` and restart Jarvis to disable outbound searches. `/api/search/status` reports configuration, not a guarantee that the provider is reachable. The saved feature ideas are in `FEATURE-BACKLOG.md`; Telegram and NAS memory remain deferred.

## Connection diagnostics

Open http://127.0.0.1:3210/diagnostics from the dashboard or House setup. Ask “Diagnose connections” or “Check all connections” for a spoken summary. The read-only diagnose_connections tool is also available to the local planner.

Checks cover the local server, Ollama and installed conversation model, voice files, Whisper, wake word and speaker models, central computer adapter/gateway, HTTPS internet access, live DuckDuckGo search, Home Assistant, calendar authorization and paired TV receiver streams. Checks run concurrently, individual checks time out, and results are cached for 15 seconds. Failures have concrete suggested fixes. Optional services that were never configured are labeled Not set up; saved calendar authorization is labeled Not verified until a real preview is requested. Model files being installed does not establish successful inference.

The page’s separate microphone test requests permission only on a button press, measures input locally for four seconds, and releases the microphone. It never uploads or saves audio. The speaker button generates a local voice sample; hearing it must be confirmed by the person using the device. These are tests of this browser’s default audio devices. Stop Hey Jarvis in the other tab first if the microphone is busy.

Internet diagnostics make an HTTPS request to example.com and a fixed example.com search on DuckDuckGo; no household data is attached. Checks never reboot hardware, change configuration, operate devices or add calendar events. A connected TV receiver means an active browser stream, not proof that the television picture is visible. The diagnostics page and API are central-computer only and are not exposed through the TV receiver. A failed report request leaves prior results visibly stale.

## Tool activity view

Open http://127.0.0.1:3210/activity from Tool activity in the dashboard or question controls. /tools opens the same page, with its tool catalog retained in an expandable section. Ask “Show tool activity” for a link beside the answer.

The room-scoped timeline updates every 1.5 seconds while visible. It shows tool name, direct/AI-planned source, start time, elapsed duration and running/completed/failed/interrupted/needs-details status. Filter by room or outcome. These are actual handler attempts rather than model-written success claims. Direct commands (including search, diagnostics, timers and reminders), agent calls and calendar preview/confirmation execution feed the log. Pure conversation is not logged. Available tools are listed separately from tools that actually ran.

Interrupted attempts cannot later turn into success due to a delayed completion. Timeouts are failures; stopping a request does not undo completed writes. A completed read means the tool returned its information, not that every connection it examined was healthy. Device results depend on the approved handler's confirmation, not proof of a physical change.

The server holds up to 200 attempts across rooms in RAM, with no prompt text, arguments, result contents, credentials or recordings. Restart clears the log. This adds no NAS or long-term memory. This central-computer page can switch room filters and is not personal authentication; paired TVs cannot read its API. If polling fails, the view marks old entries stale instead of presenting them as current.

## Household chores

Open http://127.0.0.1:3210/chores from the dashboard, question controls or House setup. The first use creates eight common starter chores, all unassigned with no deadlines. Choose Wade, Grayson, Cooper or Seattle, optionally set a date, and save. Mark done retains the chore in Completed; Reopen returns it to the open list. Filters cover person, unassigned, open, completed and overdue. Dates and overdue status use the house time zone.

Try “Show the household chores”, “Show my chores” with a selected profile, “Add buy dish soap to the chore list”, or “Mark chore Wash the dishes as done”. Flexible requests can use the local planner’s list_chores, add_chore, set_chore_status and assign_chore tools. Existing IDs and versions come from reading the list; assignments must name a housemate or use the selected profile for “me”. Adding without an assignment leaves it unassigned. Local commands still work without Ollama.

The shared list saves to private/chores.json on this computer and survives restart. It is not personal-calendar data or long-term AI memory. Everyone with access to the central assistant may change chores; voice matching does not establish authorization. API writes use version checks to reject stale edits rather than overwrite another screen’s update. Corrupt storage is preserved and editing fails closed. There are no automatic reminders, recurring tasks or automatic roommate rotations in this first version. UI changes appear in tool activity under Living room; spoken changes use the current room. No task titles or assignments are copied into that activity log. The TV receiver cannot read or change the chores API.

## Open-Meteo weather

Open http://127.0.0.1:3210/weather, search for your city with a state/country or postal code, select the correct match, choose Fahrenheit/mph or Celsius/km/h, and save. No location is inferred from time zone, IP address or GPS. The home city and units save locally in private/weather.json; damaged configuration is preserved and cannot be overwritten through setup. The shared dashboard and paired TV dashboard show the current temperature and city after successful retrieval.

Ask “What’s the weather?”, “Will it rain tomorrow?”, “Do I need an umbrella?” or “Show the forecast for this week”. Current, today, tomorrow and rolling seven-day forecasts use Open-Meteo directly without AI inference or web-search snippets. A quiet weather card appears only on request and can appear on the paired TV. “Close weather” hides it. Explicit city requests do not change the saved home location; ambiguous city matches require a city and state/country. Requests for named weekdays or later dates currently ask you to choose current/today/tomorrow/seven days rather than guess.

Provider data is cached for ten minutes, with provider timestamps and attribution. Errors, incomplete/stale observations and unknown values do not become zero-valued or invented weather. Forecasts are date-aware in the selected city’s time zone, and units are validated. Local voice and AI remain local, but city-level coordinates and forecast requests go to Open-Meteo; no household conversations or calendar data are attached. Current conditions are model-based estimates. This implementation does not provide official severe-weather alerts or an hourly night forecast. The public service is used for this personal noncommercial setup, without an API key; redistribution or commercial service should review the provider’s terms.

The get_weather tool is read-only, appears in Tool activity, and is checked by Connection diagnostics once a home city is selected. The TV receiver cannot access location configuration APIs; it receives only requested weather answers and the shared dashboard forecast. Provider documentation: https://open-meteo.com/en/docs and https://open-meteo.com/en/docs/geocoding-api.

## Windows startup and recovery

INSTALL-STARTUP.ps1 installs a task for this Windows user at sign-in, with limited privileges and no stored password. RUN-JARVIS.ps1 runs the supervisor. Task Scheduler restarts a failed supervisor after one minute. A loopback single-instance slot prevents duplicate supervisors, and the task ignores duplicate launches. This is user sign-in startup, not a service that starts before login. No automatic login, firewall, power plan or execution-policy changes are made.

The Node supervisor checks a lightweight /api/health endpoint, independent of Ollama inference. It restarts its own crashed server with bounded backoff. After the startup grace period, three failed checks trigger a restart of its owned server process tree. It never kills an unverified or externally launched process. A conflicting application on the port produces a warning rather than being stopped. Existing Ollama instances are left alone; if Ollama is absent and its configured executable is available, the supervisor requests ollama serve. It does not download models or kill an unresponsive external Ollama instance.

Startup runs in the background without opening browser windows. The desktop Jarvis shortcut opens the dashboard and starts supervision when installed. Microphone permission and Enable Hey Jarvis remain browser-controlled; automatic startup does not silently start recording. Windows must be signed in and awake for the assistant to listen. Browser tabs reconnect after a server restart; in-flight answers and the RAM-only tool log are lost, while saved chores, reminders, profiles, weather and pairings persist.

Configuration is private/startup.json. The supervisor writes bounded technical recovery events and a current status file under private/runtime; it does not log prompts, transcripts or credentials. Connection diagnostics includes Startup and recovery; /api/startup verifies the supervisor is responding. Its configuration record does not independently verify that someone has not manually disabled the Windows task. Check Windows Task Scheduler for the task's current enabled state.

Run STOP-JARVIS.ps1 to stop the supervised session cleanly, or STOP-JARVIS.ps1 -DisableStartup to also disable sign-in startup. To enable it again, run INSTALL-STARTUP.ps1 -StartNow. An intentionally stopped task exits successfully and is not restarted merely because the session was stopped. Existing Ollama is left running. START.cmd remains a foreground developer launcher; do not run a separate development server on the production port while supervision is active.

Startup validation on November 11, 2026: a project-specific current-user startup task was registered with an enabled logon trigger, limited privileges, IgnoreNew, no execution time limit and one-minute task restart policy. The task is running. The live server was handed to the supervisor, then its owned process tree was intentionally crashed; it restarted successfully. Eight chores, four profiles, saved weather settings and Peter’s selection were verified afterward. A Windows reboot/sign-out was not performed. The 77-test suite and isolated crash, hang, duplicate-instance and foreign-port checks passed. The initial occupied watchdog port was left alone and a free local port selected. No execution-policy setting was changed.

## Repository contents

This repository contains application source, UI assets, setup scripts and synthetic test fixtures. Downloaded AI/voice models, installed dependencies, household records, credentials, runtime logs, and local validation notes are excluded. Copy `.env.example` to `.env.local` to configure a new installation. Existing household installations should keep their private directory and .env.local intact when updating the code. A source checkout is not a ready-to-run offline bundle; follow the installation steps above to install dependencies and download models.

## Complete installed backup

The [private full Windows backup release](https://github.com/Faith-House/faithhousegcws/releases/tag/windows-backup-2026-11-12) contains software/models/dependencies, Windows runtimes, the active Ollama model, and a separate household-data snapshot including enrolled voice templates. Download all assets and follow BACKUP-README.md. These large installed files are release attachments, not ordinary Git files. Active credentials remain excluded; reconnect authorized services locally. The household-data archive is private house data and should stay inside authorized backups.
