// A failed voice match may fall back to a deliberate choice, never to the last
// person recognized by voice. This is a preference selection, not authentication.
export function createProfileSelection() {
  let valid = new Set(),
    manual = "",
    active = "",
    source = "shared";
  const current = () => ({
    profileId: active || null,
    profileSelection: source,
  });
  const manualSelection = () => {
    active = manual;
    source = manual ? "manual" : "shared";
    return current();
  };
  return {
    current,
    get manualId() {
      return manual;
    },
    setProfiles(profiles) {
      valid = new Set(profiles.map((profile) => profile.id));
      if (!valid.has(manual)) manual = "";
      if (!valid.has(active)) manualSelection();
      return current();
    },
    select(id) {
      manual = valid.has(id) ? id : "";
      return manualSelection();
    },
    identify(speaker) {
      if (speaker?.status === "matched" && valid.has(speaker.profileId)) {
        active = speaker.profileId;
        source = "automatic";
        return current();
      }
      return manualSelection();
    },
    forText: manualSelection,
  };
}
