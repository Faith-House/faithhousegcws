import { randomUUID } from "node:crypto";
import { problem } from "./workbench-data.mjs";

export function clientDevice(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw problem("Use a valid requesting device.");
  if (value.kind === "discord") return { kind: "discord" };
  if (
    value.kind !== "browser" ||
    typeof value.id !== "string" ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(value.id)
  )
    throw problem("Use a valid browser device identifier.");
  return { kind: "browser", id: value.id, desktop: value.desktop === true };
}

export function websiteNavigation(client, address) {
  if (
    typeof address !== "string" ||
    address.length > 2000 ||
    /[\x00-\x1f]/.test(address)
  )
    throw problem("Give a valid website address.");
  let url;
  try {
    url = new URL(address);
  } catch {
    throw problem("Give the website’s full address.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw problem(
      "Use an HTTP or HTTPS website address without embedded login details.",
    );
  const name = url.hostname.replace(/^www\./, "");
  if (client.kind === "discord")
    return {
      ok: true,
      outcome: "unverified",
      summary:
        "Discord cannot open a browser on your device. Here’s the link: " +
        url.href,
      url: url.href,
    };
  return {
    ok: true,
    outcome: "unverified",
    summary: "Opening " + name + " on the device you’re using.",
    url: url.href,
    deviceAction: {
      id: randomUUID(),
      kind: "open_url",
      clientId: client.id,
      url: url.href,
      label: name,
    },
  };
}
