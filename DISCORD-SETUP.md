# Connect Jarvis to your Discord server

1. Open http://127.0.0.1:3210/discord on the central computer.
2. Open your existing application in the [Discord Developer Portal](https://discord.com/developers/applications). Copy its **Application ID** from General Information into Jarvis. On **Bot**, copy or reset its token, then paste it directly into Jarvis's password field. Keep the token out of chat, screenshots and GitHub. Resetting a token invalidates its previous value.
3. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click your server and select **Copy Server ID**. Right-click your own user and select **Copy User ID**. Right-click the voice channel you want to use and select **Copy Channel ID**. Paste these into the matching fields in Jarvis.
4. Link each approved Discord user to a Jarvis roommate profile and an assigned room. That room receives requests, conversation context and screen updates. Add approved voice channel IDs, one per line or separated by commas. Save the local connection.
5. Open **Invite bot** and authorize it for your existing server if it is not already installed. The invitation requests View Channels, Send Messages, Attach Files, Connect and Speak. Jarvis does not require Administrator or the privileged Message Content intent. Check channel overrides if permissions are denied.
6. Select **Connect Discord** in Jarvis. It registers `/jarvis` in this server. Wait until the setup page reports Connected.
7. In the server, try `/jarvis ask question:What time is it?`. The response is private to the invoking user. Unlinked users cannot run Jarvis commands.
8. Join an approved voice channel yourself, then use `/jarvis join`. Say **“Hey Jarvis, what is the weather today?”** in one utterance, then pause. Jarvis transcribes locally and speaks its answer in that channel. Keep each utterance under 20 seconds. Everyone in the channel can hear its replies.
9. Use `/jarvis last` for a private copy of your latest answer (available for five minutes), `/jarvis stop` to cancel your request or playback, and `/jarvis leave` to disconnect the bot from voice. `/jarvis status` checks the connection.

## Operation and limits

Only explicitly linked Discord accounts are processed. Discord user IDs determine the profile; voice matching is not needed for Discord identity. These users can invoke Jarvis's existing household tools. Link people you trust with that access. The central computer's setup controls remain on localhost.

An enabled bot reconnects when Jarvis starts; it does not join voice automatically. Select Disconnect to keep it off across restarts. Editing and saving the connection also disconnects it until you select Connect again. Leaving the token field blank when editing preserves the saved token.

Discord is an internet transport, so messages and channel audio pass through Discord. Recognition, AI and generated speech use the local Jarvis pipeline. This integration does not save voice clips. Temporary transcripts and answers use the existing short-lived room conversation state. Keep the central computer awake, online, and running Ollama and Jarvis. Busy local requests can delay or reject another user's request.

Voice handling uses the pinned @discordjs/voice library and its bundled encryption support. Discord does not officially document receiving channel audio; a live channel test is required, and future Discord changes may affect it. Start with ordinary voice channels rather than Stage channels. If text works but voice does not, verify the channel ID, Connect/Speak permissions, linked user, microphone settings and local speech services. Use `/jarvis leave` then `/jarvis join` to retry. Use `/jarvis last` when spoken playback fails.

Tokens are stored in `private/discord.json`, excluded from GitHub. Status responses expose only whether a token is present. Protect this computer and its private backup files. This integration adds no terminal or repository-editing tools.

References: [Discord ID instructions](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID), [Discord voice library](https://discordjs.dev/docs/packages/voice/main).
