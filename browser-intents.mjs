const sites = new Map(
  Object.entries({
    youtube: "https://www.youtube.com/",
    "you tube": "https://www.youtube.com/",
    google: "https://www.google.com/",
    github: "https://github.com/",
    wikipedia: "https://www.wikipedia.org/",
    reddit: "https://www.reddit.com/",
    twitch: "https://www.twitch.tv/",
    netflix: "https://www.netflix.com/",
    amazon: "https://www.amazon.com/",
    gmail: "https://mail.google.com/",
    spotify: "https://open.spotify.com/",
  }),
);
const request =
  /^(?:open|launch|visit|navigate(?: to)?|go to|take me to|pull up|bring up|show(?: me)?)\s+(.+)$/i;
export function browserIntent(question) {
  if (typeof question !== "string" || question.length > 24000) return null;
  let q = question
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
  if (
    /^(?:read|describe) (?:the |my )?(?:managed )?(?:browser|web page)(?: page)?[?!.]*$/i.test(
      q,
    )
  )
    return { type: "read" };
  const match = q.match(request);
  if (!match) return null;
  let target = match[1].trim().replace(/\s+(?:for me|please)[?!.]*$/i, ""),
    hint = /\b(?:browser|website|web page)\b/i.test(target);
  if (
    /\b(?:and(?: then| also)?|then)\s+(?:open|launch|show|start|set|check|go|visit|turn)\b/i.test(
      target,
    )
  ) {
    if (
      hint ||
      /https?:\/\/|youtube|github|google|wikipedia|reddit|twitch|netflix|amazon|gmail|spotify/i.test(
        target,
      )
    )
      return { type: "compound" };
    return null;
  }
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
      /\s+(?:on|using) (?:my |the |this )?(?:computer|laptop|pc)[?!.]*$/i,
      "",
    )
    .replace(/\s+(?:for me|please)[?!.]*$/i, "")
    .replace(/\s+(?:website|web page)[?!.]*$/i, "")
    .replace(/^(?:the )(?=\S)/i, "")
    .trim();
  const alias = target.toLowerCase().replace(/[?!.]+$/, "");
  if (sites.has(alias))
    return { type: "open", url: sites.get(alias), name: alias };
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(target) && !/^https?:\/\//i.test(target))
    return {
      type: "clarify",
      summary: "Use an HTTP or HTTPS website address for the managed browser.",
    };
  if (
    /^(?:https?:\/\/|www\.)\S+$/i.test(target) ||
    /^(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(target)
  ) {
    try {
      const url = new URL(
        /^https?:\/\//i.test(target)
          ? target
          : "https://" + target.replace(/[?.!]$/, ""),
      );
      if (url.username || url.password)
        return {
          type: "clarify",
          summary: "Use a website address without embedded login details.",
        };
      return { type: "open", url: url.href, name: url.hostname };
    } catch {
      return {
        type: "clarify",
        summary: "What is the website’s full address?",
      };
    }
  }
  if (hint || /^(?:browser|website)[?!.]*$/i.test(target) || !target)
    return {
      type: "clarify",
      summary: "Which website should I open? Give its name or address.",
    };
  return null;
}
export const isBrowserRequest = (question) => browserIntent(question) !== null;
