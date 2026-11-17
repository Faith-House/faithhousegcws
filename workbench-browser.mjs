import path from "node:path";
import { problem, text, owner } from "./workbench-data.mjs";
export function createManagedBrowser({
  directory,
  launch,
  headless = false,
} = {}) {
  const sessions = new Map(),
    opening = new Map(),
    queues = new Map();
  let closed = false;
  async function session(profile) {
    if (closed) throw problem("The managed browser is stopping.", 503);
    if (sessions.has(profile)) return sessions.get(profile);
    if (opening.has(profile)) return opening.get(profile);
    if (sessions.size + opening.size >= 2)
      throw problem(
        "Close an unused managed browser before opening another profile.",
        409,
      );
    const factory =
      launch ||
      (async (folder) => {
        const { chromium } = await import("playwright-core");
        return chromium.launchPersistentContext(folder, {
          channel: "msedge",
          headless,
          acceptDownloads: false,
          viewport: { width: 1280, height: 800 },
        });
      });
    const pending = (async () => {
      let context;
      try {
        context = await factory(
          path.join(directory, "browser-profiles", profile),
        );
        if (closed) {
          await context.close();
          throw Error("Stopping");
        }
        const state = {
          context,
          page: context.pages()[0] || (await context.newPage()),
        };
        sessions.set(profile, state);
        context.on?.("close", () => {
          if (sessions.get(profile) === state) sessions.delete(profile);
        });
        return state;
      } catch {
        if (context && !sessions.has(profile))
          await context.close().catch(() => {});
        throw problem(
          "Jarvis could not start its managed Microsoft Edge browser. Check that Edge is installed and close any stuck Jarvis browser window.",
          503,
        );
      }
    })();
    opening.set(profile, pending);
    try {
      return await pending;
    } finally {
      opening.delete(profile);
    }
  }
  function url(value) {
    const u = new URL(text(value, 2000));
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      throw problem(
        "Use an HTTP or HTTPS address without embedded credentials.",
      );
    return u.href;
  }
  async function perform(profile, action, args = {}, options = {}) {
    const signal = options.signal;
    signal?.throwIfAborted();
    if (
      ![
        "open",
        "click",
        "type",
        "press",
        "back",
        "forward",
        "read",
        "screenshot",
        "close",
      ].includes(action)
    )
      throw problem("Unknown browser action.");
    const address = action === "open" ? url(args.url) : null;
    if (["click", "type"].includes(action)) text(args.label, 160);
    if (
      action === "click" &&
      !["button", "link", "menuitem", "tab"].includes(args.role || "button")
    )
      throw problem("Choose a supported browser element role.");
    if (
      action === "type" &&
      (typeof args.value !== "string" || args.value.length > 4000)
    )
      throw problem("Enter text under 4,000 characters.");
    if (
      action === "press" &&
      ![
        "Enter",
        "Escape",
        "Tab",
        "ArrowDown",
        "ArrowUp",
        "PageDown",
        "PageUp",
      ].includes(args.key)
    )
      throw problem("Unsupported browser key.");
    if (action !== "open" && !sessions.has(profile))
      throw problem("Open a managed browser for this profile first.", 409);
    const state = await session(profile);
    signal?.throwIfAborted();
    if (action === "close") {
      await state.context.close();
      sessions.delete(profile);
      return {
        outcome: "confirmed",
        summary: "Closed this profile’s managed browser.",
      };
    }
    if (state.page.isClosed?.())
      state.page =
        state.context.pages().find((p) => !p.isClosed()) ||
        (await state.context.newPage());
    const page = state.page;
    page.setDefaultTimeout?.(8000);
    const cdp = signal ? await state.context.newCDPSession?.(page) : null;
    const stopLoading = () => {
      if (cdp) void cdp.send("Page.stopLoading").catch(() => {});
    };
    signal?.addEventListener("abort", stopLoading, { once: true });
    try {
      if (action === "open") {
        const response = await page.goto(address, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        signal?.throwIfAborted();
        await page.bringToFront?.();
        const actual = page.url(),
          title = await page.title(),
          requestedHost = new URL(address).hostname.replace(/^www\./, ""),
          actualHost = new URL(actual).hostname.replace(/^www\./, "");
        const status = response?.status?.() ?? null;
        if (status !== null && status >= 400)
          return {
            ok: false,
            outcome: "failed",
            summary:
              "The browser reached " +
              actualHost +
              ", but the website returned HTTP " +
              status +
              ".",
            url: actual,
            title,
            httpStatus: status,
          };
        const expected =
          actualHost === requestedHost ||
          actualHost.endsWith("." + requestedHost);
        return {
          outcome: expected ? "confirmed" : "unverified",
          summary: expected
            ? "Opened " +
              (title || actualHost) +
              " in Jarvis’s managed Edge browser."
            : "The browser navigated to " +
              actualHost +
              " after a redirect. The requested page was not independently confirmed.",
          requestedUrl: address,
          url: actual,
          title,
          httpStatus: status,
        };
      } else if (action === "click") {
        text(args.label, 160);
        await page
          .getByRole(args.role || "button", { name: args.label, exact: true })
          .click();
      } else if (action === "type") {
        text(args.label, 160);
        if (typeof args.value !== "string" || args.value.length > 4000)
          throw problem("Enter text under 4,000 characters.");
        await page.getByLabel(args.label, { exact: true }).fill(args.value);
      } else if (action === "press") {
        if (
          ![
            "Enter",
            "Escape",
            "Tab",
            "ArrowDown",
            "ArrowUp",
            "PageDown",
            "PageUp",
          ].includes(args.key)
        )
          throw problem("Unsupported browser key.");
        await page.keyboard.press(args.key);
      } else if (action === "back")
        await page.goBack({ waitUntil: "domcontentloaded" });
      else if (action === "forward")
        await page.goForward({ waitUntil: "domcontentloaded" });
      else if (action === "screenshot")
        return {
          outcome: "confirmed",
          summary: "Captured the current managed browser page.",
          imageBase64: (
            await page.screenshot({ type: "jpeg", quality: 75 })
          ).toString("base64"),
          mime: "image/jpeg",
          url: page.url(),
        };
      else if (action !== "read") throw problem("Unknown browser action.");
      const content = await page.locator("body").innerText({ timeout: 8000 });
      return {
        outcome: ["click", "press"].includes(action)
          ? "unverified"
          : "confirmed",
        summary: ["click", "press"].includes(action)
          ? "The browser input was delivered. Inspect the page to confirm the intended result."
          : "Read the current browser page.",
        url: page.url(),
        title: await page.title(),
        text: content.slice(0, 24000),
      };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error.status) throw error;
      const reason = error.message?.match(/net::ERR_[A-Z_]+/)?.[0];
      throw problem(
        "The managed browser could not complete " +
          action +
          (reason ? " (" + reason + ")" : "") +
          ". No successful result was confirmed.",
        502,
      );
    } finally {
      signal?.removeEventListener("abort", stopLoading);
      await cdp?.detach().catch(() => {});
    }
  }
  function run(profile, action, args = {}, options = {}) {
    owner(profile);
    const prior = queues.get(profile) || Promise.resolve(),
      next = prior
        .catch(() => {})
        .then(() => perform(profile, action, args, options));
    queues.set(profile, next);
    next
      .finally(() => {
        if (queues.get(profile) === next) queues.delete(profile);
      })
      .catch(() => {});
    return next;
  }
  return {
    run,
    status: () => ({
      sessions: [...sessions.keys()],
      engine: "Managed Microsoft Edge",
      separateProfiles: true,
    }),
    async close() {
      closed = true;
      await Promise.allSettled([...opening.values()]);
      await Promise.allSettled(
        [...sessions.values()].map((s) => s.context.close()),
      );
      sessions.clear();
      await Promise.allSettled([...queues.values()]);
    },
  };
}
