import test from "node:test";
import assert from "node:assert/strict";

import { createSpeedometer, describeDownload, toMbps } from "../public/lib/download-progress.js";

const GB = 1e9;
const MB = 1e6;

test("speed is megabits per second: eight bits to the byte", () => {
  assert.equal(toMbps(12_500_000), 100);
  assert.equal(toMbps(125_000), 1);
});

test("the readout says how far, how fast and how long to go", () => {
  assert.deepEqual(describeDownload({ doneBytes: 3.2 * GB, totalBytes: 16.1 * GB, bytesPerSecond: 12.5 * MB }), {
    percent: 19,
    text: "3.2 of 16.1 GB (19%) · 100 Mbps · about 17 minutes left",
  });
  // A slow line gets a decimal, so it doesn't read as nothing.
  assert.match(describeDownload({ doneBytes: 1 * GB, totalBytes: 16 * GB, bytesPerSecond: 100_000 }).text, / · 0\.8 Mbps · about 42 hours left$/);
  assert.match(describeDownload({ doneBytes: 15.9 * GB, totalBytes: 16 * GB, bytesPerSecond: 12.5 * MB }).text, / · less than a minute left$/);
  assert.match(describeDownload({ doneBytes: 15 * GB, totalBytes: 16 * GB, bytesPerSecond: 12.5 * MB }).text, / · about 1 minute left$/);
  // A small download is counted in megabytes.
  assert.equal(describeDownload({ doneBytes: 120 * MB, totalBytes: 382 * MB }).text, "120 of 382 MB (31%)");
});

test("the readout leaves out what it cannot know", () => {
  // No speed yet, or paused: no speed and no time left.
  assert.deepEqual(describeDownload({ doneBytes: 3.2 * GB, totalBytes: 16.1 * GB, bytesPerSecond: null }), {
    percent: 19,
    text: "3.2 of 16.1 GB (19%)",
  });
  assert.equal(describeDownload({ doneBytes: 3.2 * GB, totalBytes: 16.1 * GB, bytesPerSecond: 0 }).text, "3.2 of 16.1 GB (19%)");
  // The app doesn't know the size yet: no percentage, and the bar shows only that something is happening.
  assert.deepEqual(describeDownload({ doneBytes: 0, totalBytes: 0 }), { percent: null, text: "" });
  assert.deepEqual(describeDownload({ doneBytes: 2.5 * GB, totalBytes: 0, bytesPerSecond: 12.5 * MB }), {
    percent: null,
    text: "2.5 GB so far · 100 Mbps",
  });
  // More than the total is shown as the total, and 99% stays 99% until it is done.
  assert.equal(describeDownload({ doneBytes: 17 * GB, totalBytes: 16 * GB }).text, "16.0 of 16.0 GB (100%)");
  assert.equal(describeDownload({ doneBytes: 15.99 * GB, totalBytes: 16 * GB }).percent, 99);
});

test("speed is averaged over the last readings, not taken from one moment", () => {
  const speed = createSpeedometer({ windowMs: 10_000 });
  assert.equal(speed.add(0, 0), null); // one reading says nothing yet
  assert.equal(speed.add(20 * MB, 2000), 10 * MB);
  // A stall between two readings pulls the average down instead of dropping it to zero.
  assert.equal(speed.add(20 * MB, 4000), 5 * MB);
  assert.equal(speed.add(60 * MB, 6000), 10 * MB);
  // Readings older than the window stop counting: only the last ten seconds are averaged.
  assert.equal(speed.add(60 * MB, 8000), 7.5 * MB);
  assert.equal(speed.add(60 * MB, 10_000), 6 * MB);
  assert.equal(speed.add(60 * MB, 12_000), 4 * MB); // from the reading at 2000: 40 MB in 10 s
  assert.equal(speed.add(60 * MB, 16_000), 0); // from the reading at 6000: nothing since
});

test("a download that starts again is measured from its new start", () => {
  const speed = createSpeedometer();
  speed.add(500 * MB, 0);
  speed.add(600 * MB, 2000);
  assert.equal(speed.add(10 * MB, 4000), null);
  assert.equal(speed.add(30 * MB, 6000), 10 * MB);
});
