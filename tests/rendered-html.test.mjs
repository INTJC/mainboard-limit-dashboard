import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the dashboard loading state and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>主板涨停观察台<\/title>/);
  assert.match(html, /正在整理触板数据/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("event index and daily minute payload use matching stock codes", async () => {
  const eventsPayload = JSON.parse(
    await readFile(new URL("../public/data/events.json", import.meta.url), "utf8"),
  );
  assert.ok(eventsPayload.event_count > 0);
  assert.ok(eventsPayload.dates.length > 0);

  const firstDate = eventsPayload.dates[0];
  const dateIndex = eventsPayload.fields.indexOf("date");
  const codeIndex = eventsPayload.fields.indexOf("code");
  const expectedCodes = new Set(
    eventsPayload.events
      .filter((event) => event[dateIndex] === firstDate)
      .map((event) => event[codeIndex]),
  );
  const minutePayload = JSON.parse(
    await readFile(new URL(`../public/data/minutes/${firstDate}.json`, import.meta.url), "utf8"),
  );
  const actualCodes = new Set(minutePayload.stocks.map((stock) => stock[0]));

  assert.equal(minutePayload.date, firstDate);
  assert.deepEqual(actualCodes, expectedCodes);
  assert.ok(minutePayload.stocks.every((stock) => stock[1].length > 0));
});
