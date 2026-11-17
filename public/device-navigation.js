export function createDeviceNavigator({
  browser = globalThis.window,
  onError = () => {},
} = {}) {
  const id = browser.crypto.randomUUID(),
    seen = new Set();
  const client = {
    kind: "browser",
    id,
    desktop: ["127.0.0.1", "localhost", "[::1]"].includes(
      browser.location.hostname,
    ),
  };
  function apply(snapshot, ownedRequestId) {
    if (
      !ownedRequestId ||
      snapshot.requestId !== ownedRequestId ||
      snapshot.state !== "ready"
    )
      return false;
    let navigated = false;
    for (const action of snapshot.deviceActions || []) {
      if (
        !action ||
        action.clientId !== id ||
        action.kind !== "open_url" ||
        typeof action.id !== "string" ||
        seen.has(action.id)
      )
        continue;
      let url;
      try {
        url = new URL(action.url);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          continue;
      } catch {
        continue;
      }
      seen.add(action.id);
      try {
        let tab;
        try {
          tab = browser.open("about:blank", "_blank");
        } catch {}
        if (tab) {
          try {
            tab.opener = null;
            tab.location.replace(url.href);
            tab.focus?.();
          } catch {
            try {
              tab.close();
            } catch {}
            browser.location.assign(url.href);
          }
        } else browser.location.assign(url.href);
        navigated = true;
      } catch {
        onError(
          "Your browser blocked navigation. Open this address: " + url.href,
        );
      }
    }
    return navigated;
  }
  return { client, apply };
}
