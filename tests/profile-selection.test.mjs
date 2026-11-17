import test from "node:test";
import assert from "node:assert/strict";
import { createProfileSelection } from "../public/profile-selection.js";
const roster = ["cooper", "wade", "grayson", "seattle"].map((id) => ({ id }));
function selection() {
  const s = createProfileSelection();
  s.setProfiles(roster);
  return s;
}

test("a failed voice match preserves a deliberately selected roommate profile", () => {
  const s = selection();
  s.select("cooper");
  assert.deepEqual(s.identify({ status: "unknown" }), {
    profileId: "cooper",
    profileSelection: "manual",
  });
  assert.equal(s.manualId, "cooper");
  assert.deepEqual(s.identify(undefined), {profileId:"cooper",profileSelection:"manual"});
});

test("an unknown speaker never inherits the last automatically recognized roommate", () => {
  const s = selection();
  assert.deepEqual(s.identify({ status: "matched", profileId: "wade" }), {
    profileId: "wade",
    profileSelection: "automatic",
  });
  assert.deepEqual(s.identify({ status: "unknown" }), {
    profileId: null,
    profileSelection: "shared",
  });
  s.identify({ status: "matched", profileId: "seattle" });
  assert.equal(s.forText().profileId, null);
});

test("fresh recognition takes precedence for the voice turn while typed requests use the deliberate selection", () => {
  const s = selection();
  s.select("cooper");
  assert.equal(
    s.identify({ status: "matched", profileId: "wade" }).profileId,
    "wade",
  );
  assert.equal(s.manualId, "cooper");
  assert.deepEqual(s.forText(), {
    profileId: "cooper",
    profileSelection: "manual",
  });
  s.select("");
  s.identify({ status: "matched", profileId: "wade" });
  assert.equal(s.identify({ status: "unknown" }).profileId, null);
});

test("removed and invalid profile selections return to Shared without inventing an owner", () => {
  const s = selection();
  s.select("missing");
  assert.equal(s.current().profileId, null);
  s.select("cooper");
  s.setProfiles(roster.filter((p) => p.id !== "cooper"));
  assert.deepEqual(s.current(), {
    profileId: null,
    profileSelection: "shared",
  });
  assert.equal(
    s.identify({ status: "matched", profileId: "missing" }).profileId,
    null,
  );
});
