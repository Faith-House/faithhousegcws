import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  publicAddress,
  fetchPublicPage,
  verifiedQuote,
  createResearch,
} from "../workbench-research.mjs";
const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];
function responseFixture({
  html = "<html><title>Fixture</title><main>Public fixture text that is long enough to read.</main></html>",
  status = 200,
  headers = {},
  inspect,
} = {}) {
  return (url, options, callback) => {
    inspect?.(url, options);
    const request = new EventEmitter();
    request.end = () =>
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = status;
        response.headers = { "content-type": "text/html", ...headers };
        callback(response);
        response.end(html);
      });
    request.destroy = (error) => request.emit("error", error);
    return request;
  };
}

test("research blocks local, private, documentation and mapped addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.18.48.1",
    "192.168.86.32",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:0db8::1",
    "2001:2::1",
    "3fff::1",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(publicAddress(address), true, address);
});

test("public DNS resolution is pinned to its checked address", async () => {
  let pinned;
  const page = await fetchPublicPage("https://public.example/", {
    lookup: publicLookup,
    requestImpl: responseFixture({
      inspect: (_url, options) => {
        options.lookup("public.example", {}, (_error, address) => {
          pinned = address;
        });
      },
    }),
  });
  assert.equal(pinned, "8.8.8.8");
  assert.equal(page.title, "Fixture");
  assert.match(page.text, /Public fixture text/);
});

test("redirects and mixed DNS records cannot reach an internal service", async () => {
  let requests = 0;
  await assert.rejects(
    fetchPublicPage("https://public.example/", {
      lookup: publicLookup,
      requestImpl: responseFixture({
        status: 302,
        headers: { location: "http://127.0.0.1:3210/" },
        inspect: () => requests++,
      }),
    }),
    /public HTTP|Private, local/,
  );
  assert.equal(requests, 1);
  await assert.rejects(
    fetchPublicPage("https://mixed.example/", {
      lookup: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      requestImpl: () => {
        throw Error("Must not connect");
      },
    }),
    /Private, local/,
  );
});

test("source reading honors size limits and cancellation during DNS lookup", async () => {
  await assert.rejects(
    fetchPublicPage("https://public.example/", {
      lookup: publicLookup,
      maxBytes: 20,
      requestImpl: responseFixture(),
    }),
    /page size limit/,
  );
  const controller = new AbortController(),
    reading = fetchPublicPage("https://slow.example/", {
      lookup: () => new Promise(() => {}),
      signal: controller.signal,
    });
  controller.abort(Error("Cancelled fixture"));
  await assert.rejects(reading, /Cancelled fixture/);
});

test("only exact matching source quotes are attributed as verified findings", async () => {
  const source =
    "This fixture source explains how a public research report should preserve exact supporting text. No household data is present.";
  const modelCall = async (messages) =>
    messages[0].content.startsWith("Plan")
      ? JSON.stringify({ queries: ["public fixture query"] })
      : JSON.stringify({
          findings: [
            {
              claim: "Supported fixture finding",
              quote:
                "This fixture source explains how a public research report should preserve exact supporting text.",
            },
            {
              claim: "Invented claim",
              quote: "This sentence is not in the source page at all.",
            },
          ],
        });
  const research = createResearch({
    modelCall,
    webSearch: {
      answer: async () => ({
        patch: {
          webSearch: { results: [{ url: "https://example.com/source" }] },
        },
      }),
    },
    fetchPage: async () => ({
      url: "https://example.com/source",
      title: "Fixture source",
      text: source,
    }),
  });
  let saved;
  const result = await research(
    { goal: "Public fixture research", work: {} },
    async (state) => {
      saved = structuredClone(state);
    },
    new AbortController().signal,
  );
  assert.match(result.report, /Supported fixture finding/);
  assert.doesNotMatch(result.report, /Invented claim/);
  assert.equal(result.sources.length, 1);
  assert.equal(saved.findings.length, 1);
  assert(verifiedQuote(saved.findings[0].quote, source));
});
