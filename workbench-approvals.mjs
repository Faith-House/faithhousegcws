import { randomUUID } from "node:crypto";
import { problem } from "./workbench-data.mjs";
export function createApprovals({ now = Date.now } = {}) {
  const items = new Map();
  function capacity() {
    clean();
    if (
      [...items.values()].filter((i) =>
        ["needs_approval", "running"].includes(i.status),
      ).length >= 30
    )
      throw problem("Finish or dismiss the pending actions first.", 429);
  }
  function clean() {
    for (const [id, item] of items)
      if (item.status === "needs_approval" && now() > item.expiresAt) {
        item.status = "expired";
        delete item.run;
      }
    if (items.size > 100)
      for (const [id, item] of items) {
        if (!["needs_approval", "running"].includes(item.status))
          items.delete(id);
        if (items.size <= 80) break;
      }
  }
  function request({ profileId, room, title, detail, run }) {
    capacity();
    const id = randomUUID();
    items.set(id, {
      id,
      profileId,
      room,
      title,
      detail: structuredClone(detail),
      mode: "review",
      status: "needs_approval",
      createdAt: now(),
      expiresAt: now() + 300000,
      run,
    });
    return {
      outcome: "needs_approval",
      summary:
        title +
        " is ready for review. Approve it in the local Workbench to execute.",
      approvalId: id,
    };
  }
  const publicItem = ({ run, ...item }) => structuredClone(item);
  async function perform(item, run) {
    item.status = "running";
    try {
      item.result = await run();
      item.status =
        item.result?.outcome ||
        (item.result?.ok === false ? "failed" : "confirmed");
    } catch (error) {
      const cancelled =
        error.name === "AbortError" ||
        ["cancelled", "Request closed", "Stopped by user"].includes(
          error.message,
        );
      item.status = cancelled ? "cancelled" : "failed";
      item.result = {
        ok: false,
        outcome: item.status,
        summary: cancelled
          ? "The command stopped. Earlier completed changes may remain."
          : error.status
            ? error.message
            : "The action failed. No success was confirmed.",
      };
    }
    item.finishedAt = now();
    return publicItem(item);
  }
  async function resolve(id, allow) {
    clean();
    const item = items.get(id);
    if (!item || item.status !== "needs_approval")
      throw problem("That approval is expired or already used.", 409);
    if (typeof allow !== "boolean") throw problem("Choose approve or cancel.");
    const run = item.run;
    delete item.run;
    if (!allow) {
      item.status = "cancelled";
      return publicItem(item);
    }
    return perform(item, run);
  }
  async function execute({ profileId, room, title, detail, run }) {
    capacity();
    const id = randomUUID(),
      item = {
        id,
        profileId,
        room,
        title,
        detail: structuredClone(detail),
        mode: "direct",
        status: "running",
        createdAt: now(),
      };
    items.set(id, item);
    await perform(item, run);
    return {
      ...item.result,
      ok: item.result?.ok ?? item.status !== "failed",
      outcome: item.status,
      executionId: id,
    };
  }
  function cancelPending() {
    for (const item of items.values())
      if (item.status === "needs_approval") {
        item.status = "cancelled";
        item.result = {
          summary:
            "Execution mode changed. Request this command again to run it directly.",
        };
        delete item.run;
      }
  }
  return {
    request,
    resolve,
    execute,
    cancelPending,
    list: () => {
      clean();
      return [...items.values()].map(publicItem).reverse();
    },
    close() {
      for (const item of items.values())
        if (item.status === "needs_approval") {
          item.status = "expired";
          delete item.run;
        }
    },
  };
}
