# Hands-free “Hey Jarvis”

This computer is set up for local wake-word listening. Browser capture, two synthesized voices, and the local recognition/AI/output path were checked. Your real speaking voice, distance, and background noise still need a listening test.

## Turn it on

1. Open http://127.0.0.1:3210 while START.cmd and Ollama are running. Refresh if an older copy is open.
2. Press Enter. Choose the microphone and room, and check Spoken replies.
3. Select Enable “Hey Jarvis” and allow the microphone if prompted.
4. Wait for Listening for “Hey Jarvis”. Say “Hey Jarvis”.
5. After the short chime, ask something such as “What time is it?” and pause.

The recognized question sends automatically and Jarvis speaks its answer. With Allow voice interruptions checked (the default), wake listening continues during answers and speech. A short rolling audio buffer transfers into question capture so words immediately after the wake phrase are retained. One browser tab may own the listener at a time.

## Stop and mute

- Stop listening ends detection and releases the microphone until enabled again.
- Escape stops listening, microphone capture, and current speech playback.
- Refreshing, navigating away, or changing rooms turns hands-free mode off.
- Spoken replies controls voice output. Use Stop listening to stop microphone input.
- Talk to Jarvis turns hands-free mode off and uses the review-before-send microphone flow.

## Interrupt a reply

Keep Allow voice interruptions checked. While Jarvis is answering or speaking:

- Say “Hey Jarvis, stop” to cut off the reply without a spoken acknowledgement.
- Say “Hey Jarvis”, then ask your next question and pause. Playback stops as soon as the wake phrase is detected; local transcription follows.
- You can answer a clarification over his voice, such as “Hey Jarvis, five minutes”. Pending clarification remains available.

Turning Allow voice interruptions off pauses wake listening during answers and playback. Question capture, transcription, a typed draft, and submission still pause detection. Stop speaking and Escape remain available.

The browser requests echo cancellation and playback uses a stricter wake gate: two consecutive detections scoring at least 0.75. This reduces accidental triggers but does not guarantee rejection of Jarvis or television audio. Test with the actual microphone and speakers at normal volume. If replies trigger themselves, lower the speaker volume, move the microphone, or disable interruptions temporarily. No persistent memory or NAS setup is added.

## Current limits

Keep the page open and computer awake. A closed browser or sleeping computer cannot listen. This uses the current computer’s microphone, not the Samsung TV’s microphone or future room units. General room audio feeds only the local wake detector; Whisper runs after activation. Audio buffers are discarded in memory. Runtime microphone audio is not saved or sent to a hosted service.

The first question may take several seconds to recognize, and natural speech takes additional preparation time on this laptop. A wake activation with no question returns to listening after an eight-second no-speech timeout; a spoken question is limited to 20 seconds.

If another tab owns the listener, stop it there first. A disconnected microphone, server restart, denied access, or processing backlog stops listening with an error. Fix the issue and enable it again; capture does not silently continue after failure.

## Tuning later

The starting threshold is 0.5. If real-room tests produce accidental activations, set JARVIS_WAKE_THRESHOLD=0.6 in .env.local, restart START.cmd, and test again. Loud TV audio, placement, and accents still require room testing. Physical microphone mute switches remain a hardware choice.

The implementation uses [openWakeWord’s Hey Jarvis models](https://github.com/dscripka/openWakeWord/blob/main/docs/models/hey_jarvis.md), local ONNX inference, Whisper, Ollama, and local speech synthesis. No account or API key is needed for wake detection.
