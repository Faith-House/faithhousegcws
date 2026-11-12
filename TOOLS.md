# Jarvis’s local AI tools

Jarvis now has a registry of real household tools and a local action planner. Open **Tools** on the control dashboard to see available tools and recent actions for the selected room. The planner runs through local Ollama. It uses no document retrieval or RAG.

Try:

- “Give me two minutes for tea and then show the dashboard.”
- “I need a nudge to check laundry in ten minutes.”
- “Start a countdown.” When Jarvis asks for the duration, answer “five minutes.”
- “Check the computer and show the dashboard.”
- “Pull up the demo calendar for this week.”

The first two paraphrases were checked with the installed qwen3:0.6b model. After narrowing its choices and independently resolving durations, it chose a 120-second timer plus the dashboard and a 600-second laundry reminder. The measured planning calls took about 7–14 seconds on this laptop. These examples do not establish that every phrasing or conditional decision is correct.

## Available actions

The registry covers screen modes, real time/date, starting/reading/cancelling room timers, creating/reading/clearing room reminders, computer network checks, measured computer health, calendar/demo previews, calendar-event drafts, and discovery of shared devices. Approved Home Assistant controls become available when configured. Door locks, private devices, phone calls, router administration and arbitrary terminal commands are not connected.

## How requests execute

1. Dependable direct commands use the existing local handlers.
2. Compound or unfamiliar requests reach the planner, with the relevant tools and their argument schemas.
3. The planner can return several calls, ask a question, or leave an ordinary conversation for the chat model.
4. Every call in a batch is checked before any call executes. The current room is supplied by the server, not selected by the model.
5. Tool results become the action report. For a conditional request, read tools run before changes, and the planner receives the observed data before choosing its next step.
6. A failed action stops later steps. Duplicate calls are blocked within a request. Planning is limited to three rounds and six tool executions.

Clarification context lasts two minutes and is scoped to the room and profile. “Never mind” drops it; resetting a conversation clears it. Context may include completed results so the planner does not repeat a completed action. Activity history is held in memory and includes tool names/statuses, not credentials.

Durations are parsed independently of the model. A single explicit duration is used to correct model unit-conversion mistakes. Missing times, invalid arguments and unsupported tools do not become actions. Calendar additions still prepare a draft and require explicit confirmation. Existing private-device and door restrictions remain in force.

## Model and startup

JARVIS_MODEL remains the conversation model. Optionally set JARVIS_TOOL_MODEL in .env.local to a different model already installed in Ollama; otherwise the planner uses JARVIS_MODEL. Changing the setting requires restarting Jarvis. No new model was downloaded or selected automatically.

The current small model is fallible. A larger installed model was also probed but did not finish within the local test timeout under the available memory; it was unloaded after that test. Keep the small model for now and judge additional tasks individually before relying on them for the house.

Source reference: [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs). The implementation passes a JSON schema to the local chat API and validates tool arguments again before execution.

Tests: the tool-agent tests cover duration correction, whole-batch validation, conditional read-before-write behavior, result-driven continuation, room/profile clarification isolation, duplicate/failure handling, and compound execution using real room timers against a controlled model server.
