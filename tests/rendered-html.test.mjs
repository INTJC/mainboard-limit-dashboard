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
  assert.match(html, /<title>全市场涨停观察台<\/title>/);
  assert.match(html, /正在整理触板数据/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("event index and daily minute payload use matching stock codes", async () => {
  const eventsPayload = JSON.parse(
    await readFile(new URL("../public/data/events.json", import.meta.url), "utf8"),
  );
  assert.ok(eventsPayload.event_count > 0);
  assert.ok(eventsPayload.dates.length > 0);
  assert.deepEqual(eventsPayload.boards, ["沪市主板", "深市主板", "创业板", "科创板", "北交所"]);

  const firstDate = eventsPayload.dates[0];
  const dateIndex = eventsPayload.fields.indexOf("date");
  const codeIndex = eventsPayload.fields.indexOf("code");
  const expectedCodes = new Set(
    eventsPayload.events
      .filter((event) => event[dateIndex] === firstDate)
      .map((event) => event[codeIndex]),
  );
  const minuteBytes = await readFile(
    new URL(`../public/data/minutes/${firstDate}.bin`, import.meta.url),
  );
  assert.equal(minuteBytes.subarray(0, 4).toString("ascii"), "LUP2");
  let offset = 4;
  const readUnsigned = () => {
    let value = 0;
    let multiplier = 1;
    while (offset < minuteBytes.length) {
      const byte = minuteBytes[offset++];
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return value;
      multiplier *= 128;
    }
    throw new Error("Incomplete minute payload");
  };
  const actualCodes = new Set();
  const stockCount = readUnsigned();
  for (let stockIndex = 0; stockIndex < stockCount; stockIndex += 1) {
    const codeLength = minuteBytes[offset++];
    const code = minuteBytes.subarray(offset, offset + codeLength).toString("ascii");
    offset += codeLength;
    actualCodes.add(code);
    const pointCount = readUnsigned();
    assert.ok(pointCount > 0);
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      for (let fieldIndex = 0; fieldIndex < 7; fieldIndex += 1) readUnsigned();
    }
  }

  assert.deepEqual(actualCodes, expectedCodes);
});
