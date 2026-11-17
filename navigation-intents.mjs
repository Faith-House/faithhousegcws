import { screenTarget } from './screen-target.mjs';
// Parse a direct navigation request. Household views keep their existing routes.
export function navigationRequest(question) {
  if (
    typeof question !== "string" ||
    question.length > 24000 ||
    /[\x00-\x1f`{}]/.test(question)
  )
    return null;
  const output = screenTarget(question);
  let q = output.question
    .trim()
    .replaceAll("’", "'")
    .replace(/^(?:hey\s+)?jarvis[,\s:]*/i, "");
  if (/\b(?:don't|do not|never|not to|shouldn't|wouldn't)\b/i.test(q))
    return null;
  for (let i = 0; i < 3; i++)
    q = q
      .replace(/^please\s+/i, "")
      .replace(/^(?:can|could|would|will) you\s+/i, "")
      .replace(
        /^(?:i (?:want|need)(?: you)? to|i(?:'d| would) like (?:you )?to)\s+/i,
        "",
      );
  const match =
    q.match(
      /^(?:open|launch|start|visit|navigate(?: to)?|go to|take me to|pull up|bring up|switch(?: over)? to|focus(?: on)?|show(?: me)?)\s+(.+)$/i,
    ) || q.match(/^bring\s+(.+?)\s+to (?:the )?(?:front|foreground)[?!.]*$/i) || q.match(/^(?:play|put(?: on)?)\s+(you ?tube)[?!.]*$/i);
  if (!match) return null;
  let target = match[1].trim().replace(/\s+(?:for me|please)[?!.]*$/i, "");
  let compound =
    /\b(?:and(?: then| also)?|then)\s+(?:open|launch|show|start|set|check|go|visit|turn|switch|type|write|search|close|click|navigate)\b/i.test(
      target,
    );
  const browserHint = /\b(?:browser|website|web page)\b/i.test(target);
  let engine;
  const browserName = "(?:(?:google )?chrome|(?:microsoft )?edge|firefox)";
  const suffix = target.match(
    new RegExp(
      "\\s+(?:in|using|with|on|and) (?:a |the |my )?(" +
        browserName +
        ")(?: browser)?[?!.]*$",
      "i",
    ),
  );
  const prefix = target.match(
    new RegExp(
      "^(?:the |my )?(" +
        browserName +
        ")(?: browser)? (?:at|to|on|and (?:open|go to|navigate to))\\s+",
      "i",
    ),
  );
  const chosen = suffix || prefix;
  if (chosen) {
    engine = /chrome/i.test(chosen[1])
      ? "chrome"
      : /firefox/i.test(chosen[1])
        ? "firefox"
        : "edge";
    target = suffix
      ? target.slice(0, suffix.index)
      : target.slice(prefix[0].length);
    if (prefix)
      compound =
        /\b(?:and(?: then| also)?|then)\s+(?:open|launch|show|start|set|check|go|visit|turn|switch|type|write|search|close|click|navigate)\b/i.test(
          target,
        );
  }
  const explicitApp =
    /\s+(?:app|application)(?:\s+(?:on|using) (?:my |the |this )?(?:computer|laptop|desktop|pc))?[?!.]*$/i.test(
      target,
    );
  target = target
    .replace(
      /^(?:(?:the|a|my) )?(?:managed )?(?:web )?browser(?: (?:at|to|on|and open))?\s*/i,
      "",
    )
    .replace(
      /\s+(?:in|using|with|on) (?:a |the |my )?(?:managed )?(?:web )?browser[?!.]*$/i,
      "",
    )
    .replace(
      /\s+(?:on|using) (?:my |the |this )?(?:computer|laptop|desktop|pc)[?!.]*$/i,
      "",
    )
    .replace(/\s+(?:for me|please)[?!.]*$/i, "")
    .replace(/\s+(?:website|web page|app|application)[?!.]*$/i, "")
    .replace(/^(?:the|my)\s+/i, "")
    .trim();
  if (/^(["']).*\1[?!.]*$/.test(target))
    target = target.replace(/^['"]|['"][?!.]*$/g, "");
  return {
    target,
    compound,
    explicitApp,
    displayOnly: /^(?:show|start)\b/i.test(q),
    explicitBrowser: browserHint || Boolean(engine),
    ...(output.destination ? { destination: output.destination } : {}),
    ...(engine ? { engine } : {}),
  };
}

export function appIntent(question) {
  const request = navigationRequest(question);
  if (!request || request.explicitBrowser) return null;
  const app = request.target.replace(/[?!.]+$/, "").trim();
  if (
    !app ||
    app.length > 160 ||
    /(?:https?:\/\/|\.(?:com|org|net|edu|gov|io)(?:[/?#]|$))/i.test(app)
  )
    return null;
  if (
    !request.explicitApp &&
    /^(?:(?:my|our|the|a|an)\s+)?(?:dashboard|control\s+(?:room|dashboard)|quiet|jarvis|assistant|calendar|agenda|week|day|today|tomorrow|reminders?|timers?|countdowns?|chores?|housework|lights?|lamps?|locks?|doors?|garage|tv|television|music|movies?|songs?|routines?|tasks?|files|workspace|tool(?:\s+activity|s)?|activity|connections?|diagnostics?|network|wi-?fi|weather|forecast|profiles?|roommates?|voice|screen|research|studying|study\s+mode|coding\s+mode|normal\s+mode)\b/i.test(
      app,
    )
  )
    return null;
  if (request.compound) return { type: "compound" };
  return {
    type: "open",
    app,
    explicit: request.explicitApp,
    passThroughIfMissing: request.displayOnly && !request.explicitApp,
  };
}
