import { navigationRequest } from "./navigation-intents.mjs";
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
    discord: "https://discord.com/app",
    outlook: "https://outlook.live.com/",
    chatgpt: "https://chatgpt.com/",
  }),
);
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
  const request = navigationRequest(question);
  if (!request || (request.explicitApp && !/^you ?tube$/i.test(request.target))) return null;
  const { target, compound, explicitBrowser: hint, engine } = request;
  const options = { ...(engine ? { engine } : {}), ...(request.destination ? { destination: request.destination } : {}) };
  if (compound) {
    if (
      hint ||
      /https?:\/\/|youtube|github|google|wikipedia|reddit|twitch|netflix|amazon|gmail|spotify|discord/i.test(
        target,
      )
    )
      return { type: "compound" };
    return null;
  }
  const alias = target.toLowerCase().replace(/[?!.]+$/, "");
  if (sites.has(alias))
    return { type: "open", url: sites.get(alias), name: alias, ...options };
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
      return { type: "open", url: url.href, name: url.hostname, ...options };
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
