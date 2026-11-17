import test from "node:test";
import assert from "node:assert/strict";
import { computerIntent } from "../computer-intents.mjs";
import { validateArguments } from "../tool-agent.mjs";
test("computer controls understand ordinary requests without confusing house devices", () => {
  assert.deepEqual(
    computerIntent("Jarvis, set computer volume to 40 percent"),
    { operation: "volume", percent: 40 },
  );
  assert.deepEqual(computerIntent("Can you set laptop brightness to 70%?"), {
    operation: "brightness",
    percent: 70,
  });
  assert.deepEqual(computerIntent("mute my computer"), {
    operation: "mute",
    muted: true,
  });
  assert.deepEqual(computerIntent("unmute the laptop"), {
    operation: "mute",
    muted: false,
  });
  assert.deepEqual(computerIntent("What is my computer volume?"), {
    operation: "get_audio",
  });
  assert.deepEqual(computerIntent("Take a screenshot"), {
    operation: "screenshot",
  });
  for (const q of [
    "Mute the TV",
    "How do I mute my computer?",
    "Don't mute my laptop",
    "Tell me about computer hardware",
  ])
    assert.equal(computerIntent(q), null, q);
  assert.match(
    computerIntent("Set computer volume to 500%").clarification,
    /between 0 and 100/,
  );
});
test("multiline file content is allowed while control bytes and multiline command labels remain rejected", () => {
  const text = {
      type: "string",
      maxLength: 100,
      contentMediaType: "text/plain",
    },
    schema = {
      type: "object",
      properties: { content: text },
      required: ["content"],
    };
  assert.equal(
    validateArguments({ content: "first\nsecond\tthird" }, schema),
    true,
  );
  assert.equal(validateArguments({ content: "bad\0byte" }, schema), false);
  assert.equal(
    validateArguments(
      { content: "first\nsecond" },
      {
        ...schema,
        properties: { content: { type: "string", maxLength: 100 } },
      },
    ),
    false,
  );
});
