/**
 * Synthesised completion chime via Web Audio. No audio asset to bundle, no
 * permission required. Toggleable per-user via localStorage; rate-limited to
 * one ping per 2 seconds so quick back-to-back turns don't machine-gun.
 */

const STORAGE_KEY = "clawagents:sound";

export function isSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch { /* ignore */ }
}

let lastPlayedAt = 0;
const RATE_LIMIT_MS = 2000;

function playTones(notes: Array<{ freq: number; start: number; dur: number }>): void {
  if (!isSoundEnabled()) return;
  const now = Date.now();
  if (now - lastPlayedAt < RATE_LIMIT_MS) return;
  lastPlayedAt = now;

  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const longest = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.freq;
      // Quick attack, longer release: keep it light.
      gain.gain.setValueAtTime(0.0, ctx.currentTime + n.start);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + n.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + n.start + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + n.start);
      osc.stop(ctx.currentTime + n.start + n.dur + 0.02);
    }
    // Close the context after the last note finishes so we don't leak audio resources.
    setTimeout(() => { ctx.close().catch(() => { /* ignore */ }); }, (longest + 0.1) * 1000);
  } catch {
    // AudioContext blocked (Safari before user gesture, etc.) — silent fail.
  }
}

export function playCompletionChime(): void {
  // Two-note "ding": A5 then E6.
  playTones([
    { freq: 880, start: 0,    dur: 0.10 },
    { freq: 1318, start: 0.08, dur: 0.16 },
  ]);
}

export function playPermissionBell(): void {
  // Slightly more attention-grabbing three-note: G5, B5, D6 (G-major chord).
  playTones([
    { freq: 784, start: 0.00, dur: 0.12 },
    { freq: 988, start: 0.10, dur: 0.12 },
    { freq: 1175, start: 0.20, dur: 0.18 },
  ]);
}
