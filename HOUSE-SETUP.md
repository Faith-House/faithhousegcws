# House connections — next phase

The local microphone, wake word, AI, and spoken replies are ready. The Samsung test TV has authorized Jarvis and is paired as abc. The user confirmed that the orange orb and time answer appeared on the physical TV. Google Calendar connection setup is available in House setup, but no account has been connected. Home Assistant and a telephone provider are not connected.

## Home Assistant

Install it on the chosen host, then add one light and the Samsung TV. The official [Windows installation](https://www.home-assistant.io/installation/windows/) uses a VM with at least 2 GB RAM and 2 virtual CPUs. The current 8 GB laptop had little free memory during development, so that VM was not installed alongside the speech stack.

When Home Assistant is running:

1. Create the local account and integrate a device in Home Assistant. Keep credentials and tokens out of chat.
2. Put its local address and token in .env.local using JARVIS_HA_URL and JARVIS_HA_TOKEN from .env.example.
3. Copy devices.example.json to private/devices.json. Replace example entity IDs/names with real ones. Approve only operations that all users of this shared assistant may perform.
4. Restart START.cmd and open House setup to check the connection and names.
5. Test one reversible light command and verify the physical result.

The bridge calls approved [Home Assistant actions](https://contributors.home-assistant.io/core/internals/rest-api/) and reads the state afterward. It reports unconfirmed changes honestly. Device commands are parsed outside the language model. Private devices and doors remain blocked until personal authentication is implemented.

## Samsung TV display

The central computer now uses the Control room dashboard at http://127.0.0.1:3210/. The TV still starts in the minimal display. With the TV receiver open and its room selected on the computer, ask “Show the dashboard” to display a read-only room overview and “Back to Jarvis” to close it. Refresh the TV page once for this update. This switches views inside Jarvis. The /tv-launch setup requests the approved Samsung browser for questions in its assigned room; automatic launch is enabled after the physical test described below, and optional wake remains off.

A Samsung QN65QN85CDFXZA was used for a hardware test. Its encrypted remote connection succeeded after approval on the television. Actual IP addresses, the approved token and pinned TV certificate are saved only under private/. Do not share that folder.

The TV's Browser application ID is 3202010022079. This Samsung needs a Home key request before its REST browser launch when another app covers it; a REST launch alone can leave it in the background. The verified sequence is saved as `launchMethod: "home-rest"` in the private Samsung settings. The Home key uses the approved encrypted connection and pinned certificate; the REST request stays on the saved TV's private address. If the receiver already reports visible, the launcher first checks the Browser app's foreground state. It preserves a foreground browser's current tab and activates it only when covered. It distinguishes a foreground browser from a connected Jarvis receiver. OPEN-TEST-TV.cmd is an older manual helper, separate from the `/tv-launch` integration.

The receiver uses the local IPv4 address configured in .env.local, on port 3211. For example, http://192.168.1.100:3211/ is an example receiver URL; replace it with the computer's actual LAN address. It serves only the room display and pairing interface; central controls remain loopback-only on port 3210. On November 17, 2026, the test TV was re-paired as **abc** for **Living Room**, and its obsolete Bedroom 1 pairing was revoked. The user confirmed both the rings/time display and an automatic return from Samsung Home without manually reopening the browser.

Automatic launch is enabled for Living Room. Keep Jarvis running and this computer awake. Questions assigned to Living Room can bring the paired page back on the TV; other room channels do not trigger it. Wake-on-LAN remains off and untested, so the TV must already be on. Restoring the previous app/input is not implemented. A fresh browser session or a changed receiver address can require the one-time address/pairing setup again.

If Internet opens its home/search page instead of the Jarvis rings, open the TV browser's **Settings → Home page/Start page → Custom page**, enter the receiver address shown at `/tv-launch` with `http://`, and save. This setting was saved and physically confirmed on the test TV on November 17. Afterward, a time question restored the paired receiver from Samsung Home, and a foreground check left its current tab open. The preference lives on the TV; configure it again for another TV or a changed receiver address. Opening the Browser app alone is not proof that Jarvis loaded.

**Open websites on the room’s screen by default** is enabled for this test TV. Ask **“Open YouTube”** in Living Room or **“Open YouTube on abc TV”** to launch the installed Samsung YouTube app. On November 17, the TV reported it visible and the user confirmed YouTube appeared; the central computer did not open a local window. Explicit **“on this computer”** or **“on my phone”** uses the requesting device instead. Only screens in the request’s assigned room can be selected. New installations leave screen website routing disabled until configured.

Refresh the paired Jarvis page once before opening other websites or specific video links on the TV. Those requests navigate that browser tab; use **Back** on the remote to return to Jarvis. The browser handoff was verified in an isolated paired browser, and final external-page loading remains unverified. Native YouTube keeps the Jarvis page in the background so normal questions can bring it back. This opens the app’s homepage; it does not choose or start a video.

To enter the receiver address without typing it, select the TV browser's address bar so its keyboard opens, then press **Send Jarvis address to TV** at http://127.0.0.1:3210/tv-launch. The approved Samsung text-input connection sends only the configured local receiver URL and presses Enter. Address delivery is not treated as proof of successful navigation; the paired receiver must still connect and report visible. The same remote input was physically verified for address entry during the November 17 setup.

When DHCP or the network changes this computer’s address, the old receiver address may not bind. The local receiver bind was updated to the current Wi-Fi address on November 12; a TV browser using the old address may need one-time pairing at the new address. Refresh its receiver page once for foreground presence reporting. The central app remains available on localhost and saved pairings remain intact. Check the configured LAN address before enabling the receiver on another network. The new TV dashboard was verified in an isolated paired browser preview; a physical Samsung check remains for the home network.

The user enabled the Samsung browser setting to automatically hide its tabs and toolbar and confirmed that both the address bar and tabs disappeared. Keep this setting enabled for the minimal HUD view. If setting up another Samsung, look in the Internet browser's menu → Settings → General for Hide Tabs and Toolbar automatically (wording can vary), choose Use/On, then return to Jarvis and move the pointer away from the top edge.

If the TV reports Server not found, check the full address: this receiver uses **http://**, not **https://**. A phone on the same Wi-Fi successfully loaded the pairing page on November 5, while the TV's failed attempt was using HTTPS. Replace the whole address, including its scheme; do not change Windows firewall or router settings for this scheme mismatch.

Keep the TV on the same home network:

1. Set JARVIS_DISPLAY_BIND in .env.local to the computer’s current private IPv4 address and JARVIS_DISPLAY_PORT to 3211. Restart Jarvis.
2. Open http://127.0.0.1:3210/setup on the computer and create a code for the TV’s room.
3. On the TV’s Internet browser, open the displayed receiver address, or use **Send Jarvis address to TV** after selecting its address bar. Enter the pairing code and screen name.
4. Ask a question assigned to that room. Other rooms should remain idle.

This grants read-only room display access, with one-use five-minute codes, expiring sessions, and revocation. Local HTTP is intended for a trusted home network; private calendars need encrypted access and personal authentication. TV wake/app restoration still needs physical tests. Existing Node.js firewall rules were inspected; Windows firewall and network profile settings have not been changed. No public port forwarding is needed.

## Google Calendar

The project has a local desktop OAuth flow and a read/write Google Calendar connection. It reads titles and times only for the day/week preview and asks for confirmation before creating an event. The OAuth client and token are stored under the central computer's private/ folder; do not copy/share that folder. OAuth requires internet access to Google, while conversation AI, voice recognition, and speech remain local.

Use a dedicated shared household Google account with no private events; Jarvis reads that account's primary calendar. Any room can request a preview, and the selected room's paired TV receives event titles and times. Voice identification is not personal authorization, so do not connect a personal account until per-person sign-in and privacy controls exist.

1. In House setup, open Google Cloud credentials.
2. Create a Google Cloud project and enable the Google Calendar API.
3. Configure Google Auth Platform / OAuth consent. For an External audience in Testing, add the household Google account as a test user.
4. Create an OAuth client with application type **Desktop app**, then download its JSON file.
5. In Jarvis House setup, choose that JSON file and select **Save client file**.
6. Select **Connect Google Calendar**, sign into the dedicated shared account in the browser, and accept the requested Calendar access.
7. Return to Jarvis and try “Show my calendar today” or “Show me this week.” Try event creation only with a test event first; verify the spoken title/time confirmation before saying “confirm.”

Google's current setup guide is [Calendar API Node.js quickstart](https://developers.google.com/workspace/calendar/api/quickstart/nodejs) and [OAuth consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent).

## Later connections

Apple Calendar and per-person calendar access need separate sign-in and privacy controls. Router device lists/coverage need the actual router’s supported integration. Jarvis’s number requires a telephone-provider account and local calling bridge; no number has been purchased. These connections remain unavailable until set up and tested.
