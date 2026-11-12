# Roommate profiles and local speaker recognition

Profiles are created for Wade, Grayson, Cooper, and Seattle. Bedrooms are unassigned until you choose them. Each profile has a Jarvis voice, spoken-reply preference, and answer length. These are household preference profiles, not authenticated accounts.

## Enroll your own voice

1. Open http://127.0.0.1:3210/profiles. If another Jarvis tab is listening for the wake word, stop it first.
2. On your own card choose Set up voice. Read the consent statement and check it yourself.
3. Choose the microphone. Select Record sample 1, read the displayed sentence naturally for 3–15 seconds, and pause.
4. Repeat with the next two sentences. Each sample must be a new recording of the same person. Use the same microphone and a quiet room.
5. After Voice setup complete, choose Test recognition and record a different sentence. Check the suggested name.
6. Return to Jarvis. Profile availability refreshes when the page gains focus, when enrollment changes in another tab, and before voice capture. Leave Recognize who is speaking checked, enable Hey Jarvis, and ask a question after the chime.

Each roommate must enroll their own actual voice. Cooper has completed enrollment himself; Wade, Grayson, and Seattle still need their own samples. The synthetic voices used for testing are separate fixtures and were not added to your household profiles.

## What changes after a match

Speaker matching uses the question audio after wake activation; the wake phrase alone does not identify the person. A match selects their preferred Jarvis voice and answer style, and conversation context is kept separate by profile and room. The current room remains the audio/display destination; recognizing someone does not move their answer to a different bedroom.

Each question carries its fresh local match into the reply. Jarvis can answer “What’s my name?” naturally and use the speaker’s name when appropriate without requiring them to introduce themselves. Editing a transcript clears its match reference. The reference expires after two minutes and cannot be reused for another question or room. A manual profile selection is described as a selection, never as recognition.

An uncertain or ambiguous voice uses the shared profile. Short or noisy questions can remain unknown. The first matching pass adds model-loading time; this laptop measured about 1.1–1.6 seconds for cold synthetic examples and about 0.4 seconds for subsequent examples. These are component tests, not a household accuracy guarantee.

You can choose a profile manually for typed questions. Selecting a name does not prove identity. Voice matches always carry authorized=false internally and do not grant lock, private-device, phone, or calendar access. Those features still need their own authentication and account setup. Room answers remain visible on that room’s display; this is not a private messaging system.

## Saved data and controls

Raw enrollment and question audio is processed in memory and discarded. Completing three samples saves a normalized derived voice signature and the profile preferences in private/profiles.json. That signature is sensitive voice data: it remains on this computer, is never returned by the browser API, and is excluded from source control by private/. Do not share that folder in a public archive.

Partial enrollment signatures stay in memory, expire after ten minutes, and can be cancelled by closing the setup. Re-record voice keeps the previous completed signature until three replacement samples pass. Remove voice deletes that profile’s saved signature after confirmation. It does not delete the preference card.

For another computer run SETUP-SPEAKER-ID.cmd once after installing project dependencies. The downloaded model is WeSpeaker ResNet34-LM via the ONNX Community conversion, pinned to a recorded revision and checked hash. Runtime model fetching is disabled. See MODEL-NOTICES.md for attribution.

## Before relying on automatic personalization

Test each person with several new sentences at their usual speaking distance. Include an unenrolled guest and normal room noise. Similar voices, overlapping speakers, illness, changed microphones, and recordings can affect matches. The conservative starting threshold and separation margin intentionally favor Unknown over a close guess. Voice matching remains a convenience for preferences, never an authorization method.
