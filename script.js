// script.js - Automatic 3-day rotating key generator with safe refresh to mitigate throttling

document.addEventListener("DOMContentLoaded", () => {
  const copyBtn = document.getElementById("copyBtn");
  const keyOutput = document.getElementById("keyOutput");
  const periodIdxEl = document.getElementById("periodIdx");
  const nextRotationEl = document.getElementById("nextRotation");
  const countdownEl = document.getElementById("countdown");

  // Settings
  const DAYS_PER_PERIOD = 3;
  const GROUPS = 4;
  const CHARS_PER_GROUP = 4;
  const PREFIX = "LGL";

  // Refresh settings (tune as needed)
  const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const RELOAD_CHECK_INTERVAL_MS = 60 * 1000; // check every minute
  const LAST_RELOAD_KEY = "scorpionmodz_lastReloadAt_v1";

  // Generate immediately and update UI every second.
  // The key is deterministic based on the current period index (UTC).
  updateAll();
  setInterval(updateAll, 1000);

  // Copy button
  copyBtn.addEventListener("click", async () => {
    const value = keyOutput.value;
    if (!value) {
      flashTemporary(copyBtn, "No key!");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      flashTemporary(copyBtn, "Copied!");
    } catch (err) {
      // Fallback
      try {
        keyOutput.select();
        document.execCommand('copy');
        flashTemporary(copyBtn, "Copied!");
      } catch (e) {
        flashTemporary(copyBtn, "Copy failed");
      }
    }
  });

  // If tab becomes visible, refresh UI immediately (mitigates throttling while backgrounded)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateAll();
  });

  // If browser comes back online, refresh UI immediately
  window.addEventListener("online", () => {
    updateAll();
  });

  // Periodic safe reload to avoid long-running timers being throttled.
  // Only reload when page is hidden and browser is online, and only if the last reload
  // recorded in localStorage is older than REFRESH_INTERVAL_MS. This prevents multiple
  // tabs from all reloading at once.
  setInterval(() => {
    try {
      if (document.hidden && navigator.onLine) {
        const now = Date.now();
        const last = Number(localStorage.getItem(LAST_RELOAD_KEY) || 0);
        if (isNaN(last) || now - last >= REFRESH_INTERVAL_MS) {
          // claim the reload slot
          localStorage.setItem(LAST_RELOAD_KEY, String(now));
          // perform reload; deterministic key ensures reload doesn't change the current key
          // (key is derived from the period index)
          location.reload();
        }
      }
    } catch (e) {
      // localStorage can throw in some privacy modes; ignore and skip reload
      console.warn("Safe reload check failed:", e);
    }
  }, RELOAD_CHECK_INTERVAL_MS);

  async function updateAll() {
    const now = new Date();
    const idx = getPeriodIndex(now, DAYS_PER_PERIOD);
    periodIdxEl.textContent = String(idx);

    const periodMs = DAYS_PER_PERIOD * 24 * 60 * 60 * 1000;
    const nextRotationTs = (idx + 1) * periodMs;
    const nextRotation = new Date(nextRotationTs);
    nextRotationEl.textContent = nextRotation.toUTCString();

    const remainingMs = nextRotationTs - now.getTime();
    countdownEl.textContent = formatDuration(remainingMs);

    // Generate deterministic key for this period (no secret)
    const key = await generatePeriodKey(idx, GROUPS, CHARS_PER_GROUP, PREFIX);
    if (keyOutput.value !== key) {
      keyOutput.value = key;
    }
  }
});

/* Helpers and key generation */

/**
 * getPeriodIndex(date, days)
 * - UTC-based index: floor(epochMillis / (days * 24h))
 */
function getPeriodIndex(date, days = 3) {
  const epochMs = date.getTime();
  const periodMs = days * 24 * 60 * 60 * 1000;
  return Math.floor(epochMs / periodMs);
}

/**
 * generatePeriodKey(periodIndex, groups, charsPerGroup, prefix)
 * - Deterministic key derived from SHA-256(period:<index>).
 * - No secret required; all devices will generate same key for same period index.
 */
async function generatePeriodKey(periodIndex, groups = 4, charsPerGroup = 4, prefix = '') {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 32+ chars
  const total = groups * charsPerGroup;
  const message = `period:${periodIndex}`;

  // Try Web Crypto digest (SHA-256)
  let digestBytes = null;
  try {
    const msgBytes = new TextEncoder().encode(message);
    const digest = await crypto.subtle.digest("SHA-256", msgBytes);
    digestBytes = new Uint8Array(digest);
  } catch (e) {
    // Fallback deterministic bytes
    digestBytes = fallbackDeterministicBytes(message, total);
  }

  const out = [];
  for (let i = 0; out.length < total; i++) {
    const byte = digestBytes[i % digestBytes.length];
    const idx = byte % alphabet.length;
    out.push(alphabet[idx]);
  }

  const groupsArr = [];
  for (let g = 0; g < groups; g++) {
    groupsArr.push(out.slice(g * charsPerGroup, (g + 1) * charsPerGroup).join(''));
  }
  const joined = groupsArr.join('-');
  return prefix ? `${prefix}-${joined}` : joined;
}

/**
 * fallbackDeterministicBytes(seed, needed)
 * - Very simple deterministic generator for fallback only.
 * - NOT crypto-secure. Only used if Web Crypto isn't available.
 */
function fallbackDeterministicBytes(seed, needed) {
  // simple xorshift-ish generator seeded from seed string's UTF-8 bytes
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  const out = new Uint8Array(needed);
  let state = h >>> 0;
  for (let i = 0; i < needed; i++) {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = (state >>> 0) & 0xFF;
  }
  return out;
}

/**
 * formatDuration(ms)
 * - human friendly dd:hh:mm:ss
 */
function formatDuration(ms) {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / (24 * 3600));
  const hours = Math.floor((s % (24 * 3600)) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
  if (hours > 0) return `${hours}h ${pad(mins)}m ${pad(secs)}s`;
  if (mins > 0) return `${mins}m ${pad(secs)}s`;
  return `${secs}s`;
}
function pad(n) { return String(n).padStart(2, "0"); }

/**
 * Small UI helper to show temporary feedback on a button.
 */
function flashTemporary(button, text, ms = 1200) {
  const old = button.textContent;
  button.textContent = text;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = old;
    button.disabled = false;
  }, ms);
}