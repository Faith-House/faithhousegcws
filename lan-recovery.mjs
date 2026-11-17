import { networkInterfaces } from "node:os";
import { readFile, writeFile, rename, access } from "node:fs/promises";
import path from "node:path";
import { randomUUID, X509Certificate } from "node:crypto";
import { privateIPv4 } from "./samsung-launcher.mjs";
import { preparePhoneTls } from "./phone-tls.mjs";

export function chooseLanBinding(configured, interfaces) {
  if (!configured) return { address: "", changed: false };
  const entries = Object.entries(interfaces).flatMap(([name, items]) =>
    (items || [])
      .filter(
        (i) =>
          !i.internal &&
          (i.family === "IPv4" || i.family === 4) &&
          privateIPv4(i.address),
      )
      .map((i) => ({ name, address: i.address })),
  );
  if (entries.some((i) => i.address === configured))
    return { address: configured, changed: false };
  const wireless = entries.filter((i) => /wi-?fi|wireless|wlan/i.test(i.name));
  const candidates = wireless.length
    ? wireless
    : entries.filter(
        (i) =>
          !/virtual|vEthernet|veth|WSL|Docker|bluetooth|VPN|Tailscale|ZeroTier|WireGuard|loopback/i.test(
            i.name,
          ),
      );
  const addresses = [...new Set(candidates.map((i) => i.address))];
  return addresses.length === 1
    ? { address: addresses[0], changed: true }
    : { address: configured, changed: false, unavailable: true };
}

export async function recoverLanBindings({
  directory,
  envFile,
  environment = process.env,
  interfaces = networkInterfaces(),
  prepareTls = preparePhoneTls,
} = {}) {
  const updates = {},
    notes = [];
  for (const name of ["JARVIS_DISPLAY_BIND", "JARVIS_PHONE_BIND"]) {
    const binding = chooseLanBinding(environment[name] || "", interfaces);
    if (binding.unavailable) {
      notes.push(
        name === "JARVIS_PHONE_BIND"
          ? "Phone access: saved address is unavailable; choose this network’s address in phone setup."
          : "TV receiver: saved address is unavailable; check the current network address.",
      );
      continue;
    }
    if (!binding.changed) continue;
    if (name === "JARVIS_PHONE_BIND") {
      try {
        const tls = path.join(directory, "phone-access", "tls");
        await access(path.join(tls, "ca.key"));
        const previousCa = new X509Certificate(
          await readFile(path.join(tls, "ca.pem")),
        );
        const prepared = await prepareTls({
          directory: tls,
          address: binding.address,
          openssl:
            environment.JARVIS_OPENSSL ||
            "C:/Program Files/Git/usr/bin/openssl.exe",
        });
        if (prepared.caFingerprint !== previousCa.fingerprint256)
          throw Error("Phone trust root changed");
      } catch {
        notes.push(
          "Phone access: the network address changed, but its certificate could not be renewed. Run SETUP-PHONE.cmd.",
        );
        continue;
      }
    }
    updates[name] = binding.address;
  }
  if (Object.keys(updates).length) {
    try {
      let source = await readFile(envFile, "utf8").catch((error) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      for (const [name, value] of Object.entries(updates)) {
        const expression = new RegExp("^" + name + "=[^\\r\\n]*", "m");
        source = expression.test(source)
          ? source.replace(expression, name + "=" + value)
          : source.replace(/\s*$/, "") + "\n" + name + "=" + value + "\n";
      }
      const temp = envFile + "." + randomUUID() + ".tmp";
      await writeFile(temp, source, { mode: 0o600, flag: "wx" });
      await rename(temp, envFile);
    } catch {
      notes.push(
        "The current LAN address is active for this run, but the local configuration file could not be updated.",
      );
    }
    Object.assign(environment, updates);
  }
  return { updates, notes };
}
