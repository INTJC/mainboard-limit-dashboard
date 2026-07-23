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

test("range observation controls and the shared market-data source are wired", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /https:\/\/intjc\.github\.io\/mainboard-limit-dashboard/);
  assert.match(pageSource, /payload\.shards\?\.length/);
  assert.match(pageSource, /payload\.events = batches\.flat\(\)/);
  assert.match(pageSource, /minutes-base64/);
  assert.match(pageSource, /decodeBase64Buffer/);
  assert.match(pageSource, /function buildRangeObservation/);
  assert.match(pageSource, /区间涨停节奏观察/);
  assert.match(pageSource, /分钟移动平均窗口/);
  assert.match(pageSource, /板块（可多选）/);
  assert.match(pageSource, /RangeObservationChart mode="count"/);
  assert.match(pageSource, /RangeObservationChart mode="rate"/);
  assert.match(pageSource, /PathStackedChart kind="sealed"/);
  assert.match(pageSource, /PathStackedChart kind="opened"/);
  assert.match(pageSource, /未开板封住/);
  assert.match(pageSource, /开板后回封/);
  assert.match(pageSource, /封板后开板/);
  assert.match(pageSource, /触板未封/);
  assert.match(pageSource, /所选区间路径统计/);
  assert.match(pageSource, /不做日内累计/);
  const rangeBuilder = pageSource.slice(
    pageSource.indexOf("function buildRangeObservation"),
    pageSource.indexOf("function CumulativeChart"),
  );
  assert.match(rangeBuilder, /sealedSums\[index\] \+= 1/);
  assert.match(rangeBuilder, /openedSums\[index\] \+= 1/);
  assert.match(rangeBuilder, /sealedPerMinute/);
  assert.doesNotMatch(rangeBuilder, /buildCumulative/);
  assert.match(rangeBuilder, /sealedShare\(value, opened\[index\]\)/);
  assert.match(rangeBuilder, /1 - rate/);
  assert.match(pageSource, /total <= Number\.EPSILON/);
  assert.match(pageSource, /Math\.min\(1, Math\.max\(0, sealed \/ total\)\)/);
});

test("compact path codes preserve the sample and split every event into one valid path", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../public/data/events.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.event_count, 69_220);
  assert.equal(manifest.dates.length, 790);
  assert.deepEqual(manifest.path_labels, [
    "未开板封住",
    "开板后回封",
    "封板后开板",
    "触板未封",
  ]);
  const packed = Buffer.from(manifest.path_codes, "base64");
  assert.equal(packed.length, Math.ceil(manifest.event_count / 4));
  const counts = [0, 0, 0, 0];
  for (let index = 0; index < manifest.event_count; index += 1) {
    counts[(packed[index >> 2] >> ((index & 3) * 2)) & 3] += 1;
  }
  assert.deepEqual(counts, [25_443, 21_046, 17_022, 5_709]);
  assert.equal(manifest.shards.reduce((sum, shard) => sum + shard.event_count, 0), 69_220);
});
