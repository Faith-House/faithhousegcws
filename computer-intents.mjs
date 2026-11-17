export function computerIntent(question) {
  if (typeof question !== "string") return null;
  let q = question
    .trim()
    .replaceAll("’", "'")
    .replace(/^(?:hey\s+)?jarvis[,\s:]*/i, "")
    .replace(
      /^(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/i,
      "",
    );
  if (
    /\b(?:don't|do not|never|not to|shouldn't|wouldn't)\b/i.test(q) ||
    /^(?:if|how|explain|describe|what would)\b/i.test(q)
  )
    return null;
  if (
    /^(?:take|capture|save|grab)(?: me)? (?:a |the )?(?:(?:computer|laptop|desktop|pc) )?screen\s?shot[?!.]*$/i.test(
      q,
    )
  )
    return { operation: "screenshot" };
  if (
    /^(?:list|show|read)(?: me)? (?:the |my )?(?:(?:installed|available) (?:computer |windows )?apps|(?:computer |windows )(?:installed )?apps)[?!.]*$/i.test(
      q,
    )
  )
    return { operation: "list_apps" };
  const target = /\b(?:computer|laptop|desktop|pc|system)\b/i.test(q);
  if (!target) return null;
  const percent = q.match(
    /\b(?:volume|brightness)\b.*?\b(?:to|at)\s*(\d{1,3})\s*(?:%|percent)?[?!.]*$/i,
  );
  if (percent && /^(?:set|change|turn|put|make)\b/i.test(q)) {
    const amount = Number(percent[1]);
    if (amount > 100)
      return { clarification: "Choose a percentage between 0 and 100." };
    return {
      operation: /brightness/i.test(q) ? "brightness" : "volume",
      percent: amount,
    };
  }
  if (/^unmute\b/i.test(q)) return { operation: "mute", muted: false };
  if (/^mute\b/i.test(q)) return { operation: "mute", muted: true };
  if (/^(?:what|check|read|show|tell)\b.*\b(?:volume|audio|mute)\b/i.test(q))
    return { operation: "get_audio" };
  if (/^(?:list|show|read)\b.*\b(?:windows|open apps|running apps)\b/i.test(q))
    return { operation: "list_windows" };
  return null;
}
