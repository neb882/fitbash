// Words and numbers for a download in progress: how far, how fast, how long to go.

const UNITS = [
  { name: "GB", bytes: 1e9, digits: 1 },
  { name: "MB", bytes: 1e6, digits: 0 },
];

/**
 * Tracks download speed from readings of "bytes so far".
 *
 * The speed is the average over the last `windowMs`, so one stalled or bursty
 * moment between two readings doesn't swing the number or the time left.
 */
export function createSpeedometer({ windowMs = 15_000 } = {}) {
  let readings = [];
  return {
    /** Add a reading. Returns bytes per second, or null until two readings can be compared. */
    add(bytes, at) {
      // Fewer bytes than before means the download began again: old readings say nothing about it.
      if (readings.length > 0 && bytes < readings.at(-1).bytes) readings = [];
      readings.push({ bytes, at });
      // Drop the oldest reading while the next one still spans the whole window.
      while (readings.length > 2 && at - readings[1].at >= windowMs) readings.shift();
      const first = readings[0];
      const seconds = (at - first.at) / 1000;
      return seconds > 0 ? (bytes - first.bytes) / seconds : null;
    },
  };
}

/** Megabits per second, the unit internet plans are sold in. */
export const toMbps = (bytesPerSecond) => (bytesPerSecond * 8) / 1e6;

function speedWords(bytesPerSecond) {
  const mbps = toMbps(bytesPerSecond);
  return `${mbps >= 10 ? Math.round(mbps) : mbps.toFixed(1)} Mbps`;
}

function timeLeftWords(seconds) {
  if (seconds < 60) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"} left`;
  return `about ${Math.round(minutes / 60)} hours left`;
}

/**
 * What to show for a download.
 *
 * @param {object} download
 * @param {number} download.doneBytes
 * @param {number} download.totalBytes         0 when the app doesn't know yet
 * @param {number|null} [download.bytesPerSecond]
 * @returns {{ percent: number|null, text: string }}  percent is null when the total isn't known
 */
export function describeDownload({ doneBytes, totalBytes, bytesPerSecond = null }) {
  const known = totalBytes > 0;
  const done = Math.max(0, known ? Math.min(doneBytes, totalBytes) : doneBytes);
  const unit = UNITS.find((u) => (known ? totalBytes : done) >= u.bytes) ?? UNITS.at(-1);
  const amount = (bytes) => (bytes / unit.bytes).toFixed(unit.digits);
  const percent = known ? Math.floor((done / totalBytes) * 100) : null;

  const parts = [];
  if (known) parts.push(`${amount(done)} of ${amount(totalBytes)} ${unit.name} (${percent}%)`);
  else if (done > 0) parts.push(`${amount(done)} ${unit.name} so far`);
  if (bytesPerSecond > 0) {
    parts.push(speedWords(bytesPerSecond));
    if (known && done < totalBytes) parts.push(timeLeftWords((totalBytes - done) / bytesPerSecond));
  }
  return { percent, text: parts.join(" · ") };
}
