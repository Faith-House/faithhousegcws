import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chooseLanBinding, recoverLanBindings } from "../lan-recovery.mjs";
const wifi = (address) => ({ family: "IPv4", internal: false, address });

test("LAN repair prefers one real Wi-Fi address and preserves valid explicit bindings", () => {
  const interfaces = {
    "Wi-Fi": [wifi("192.168.1.12")],
    "vEthernet (WSL)": [wifi("172.18.48.1")],
  };
  assert.deepEqual(chooseLanBinding("192.168.1.9", interfaces), {
    address: "192.168.1.12",
    changed: true,
  });
  assert.deepEqual(chooseLanBinding("172.18.48.1", interfaces), {
    address: "172.18.48.1",
    changed: false,
  });
  assert.deepEqual(chooseLanBinding("", interfaces), {
    address: "",
    changed: false,
  });
});

test("ambiguous, virtual-only and public interfaces never become an automatic listener", () => {
  for (const interfaces of [
    { "vEthernet (WSL)": [wifi("172.18.48.1")] },
    { Ethernet: [wifi("192.168.1.2")], Ethernet2: [wifi("10.1.1.2")] },
    { "Wi-Fi": [wifi("8.8.8.8")] },
  ]) {
    const result = chooseLanBinding("192.168.1.9", interfaces);
    assert.equal(result.address, "192.168.1.9");
    assert.equal(result.changed, false);
    assert.equal(result.unavailable, true);
  }
});

test("TV address updates preserve unrelated local configuration and do not enable phone access", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-lan-")),
    envFile = path.join(directory, ".env.local");
  await writeFile(
    envFile,
    "JARVIS_DISPLAY_BIND=192.168.1.9\nJARVIS_MODEL=test-model\n",
  );
  const environment = { JARVIS_DISPLAY_BIND: "192.168.1.9" };
  const result = await recoverLanBindings({
    directory,
    envFile,
    environment,
    interfaces: { "Wi-Fi": [wifi("192.168.1.12")] },
  });
  assert.equal(result.updates.JARVIS_DISPLAY_BIND, "192.168.1.12");
  assert.equal(environment.JARVIS_PHONE_BIND, undefined);
  const saved = await readFile(envFile, "utf8");
  assert.match(saved, /JARVIS_MODEL=test-model/);
  assert.match(saved, /JARVIS_DISPLAY_BIND=192.168.1.12/);
});

test("missing phone CA is preserved for repair rather than silently replaced", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jarvis-lan-phone-")),
    envFile = path.join(directory, ".env.local");
  let tlsCalls = 0;
  const environment = { JARVIS_PHONE_BIND: "192.168.1.9" };
  const result = await recoverLanBindings({
    directory,
    envFile,
    environment,
    interfaces: { "Wi-Fi": [wifi("192.168.1.12")] },
    prepareTls: async () => {
      tlsCalls++;
    },
  });
  assert.equal(tlsCalls, 0);
  assert.equal(environment.JARVIS_PHONE_BIND, "192.168.1.9");
  assert.equal(Object.keys(result.updates).length, 0);
  assert.match(result.notes[0], /certificate could not be renewed/);
});
