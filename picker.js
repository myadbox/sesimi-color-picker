// Picker tab: eyedropper, color formats, pick history, and the target /
// on-brand comparison. Owns the current pick + target selection state.

import { hexToRgb, rgbToHex, deltaE, escapeHtml, formatFor } from "./helper.js";
import {
  CATEGORY_ORDER,
  MAX_HISTORY,
  getPalette,
  getHistory,
  setHistory,
} from "./storage.js";

// Max CIE76 deltaE for a picked color to count as "on brand".
const MATCH_THRESHOLD = 12.7;

let current = null; // { hex, rgb: [r,g,b] }
// The compare target: "" = none, "cat:<Category>" = whole category,
// "hex:<#HEX>" = one brand color. Mirrors the <option> values.
let targetSel = "";

// ---- Eyedropper -------------------------------------------------------------

// Opens the native EyeDropper from the popup itself. It must be called
// directly in the click handler (before any `await`) so the button's
// transient user activation is still valid — otherwise open() rejects.
// Returns the picked sRGBHex, or null if the user cancelled (Esc).
function pickFromPage() {
  if (!("EyeDropper" in window)) {
    return Promise.reject(new Error("unsupported"));
  }
  return new EyeDropper()
    .open()
    .then((result) => result.sRGBHex)
    .catch(() => null); // cancelled with Esc / lost activation
}

// ---- Rendering --------------------------------------------------------------

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 1400);
}

async function showColor(hex) {
  const rgb = hexToRgb(hex);
  current = { hex: rgbToHex(rgb), rgb };

  document.getElementById("result").classList.remove("hidden");
  document.getElementById("swatch").style.background = current.hex;
  document.getElementById("hexValue").textContent = formatFor("hex", rgb);
  document.getElementById("rgbValue").textContent = formatFor("rgb", rgb);
  document.getElementById("hslValue").textContent = formatFor("hsl", rgb);

  await renderTargetCompare(rgb);
  await renderCompliance(rgb);
}

// Compares the given rgb against the chosen target — either one brand color
// ("hex:…") or the closest color within a category ("cat:…"). Hidden entirely
// when no target is set or no color is on screen.
async function renderTargetCompare(rgb) {
  const el = document.getElementById("targetCompare");
  if (!targetSel || !rgb) {
    el.className = "compliance hidden";
    el.innerHTML = "";
    return;
  }

  const palette = await getPalette();
  const [kind, value] = splitTarget(targetSel);

  // Candidate brand colors to measure against: one color, or a whole category.
  const candidates =
    kind === "cat"
      ? palette.filter((c) => c.category === value)
      : palette.filter((c) => c.hex === value);

  if (!candidates.length) {
    // The target was deleted or renamed out from under us; treat as unset.
    el.className = "compliance hidden";
    el.innerHTML = "";
    return;
  }

  let best = null;
  for (const entry of candidates) {
    const d = deltaE(rgb, hexToRgb(entry.hex));
    if (!best || d < best.d) best = { entry, d };
  }

  el.className = "compliance";
  const name = escapeHtml(best.entry.name);
  const scope =
    kind === "cat"
      ? `closest in ${escapeHtml(value)} — <b>${name}</b> ${best.entry.hex}`
      : `<b>${name}</b> ${best.entry.hex}`;
  el.innerHTML =
    `<div class="compliance-badge">` +
    `<span class="compliance-dot" style="background:${best.entry.hex}"></span>` +
    `<span class="compliance-text">${scope} · ΔE ${best.d.toFixed(1)}</span>` +
    `</div>`;
}

// Splits an <option> value like "cat:Primary" / "hex:#001E50" into [kind, value].
function splitTarget(sel) {
  const i = sel.indexOf(":");
  return [sel.slice(0, i), sel.slice(i + 1)];
}

async function renderCompliance(rgb) {
  const el = document.getElementById("compliance");

  // With a target set, the target comparison replaces the closest-color search.
  if (targetSel) {
    el.className = "compliance hidden";
    el.innerHTML = "";
    return;
  }

  const palette = await getPalette();
  let best = null;
  for (const entry of palette) {
    const d = deltaE(rgb, hexToRgb(entry.hex));
    if (!best || d < best.d) best = { entry, d };
  }

  if (!best) {
    el.className = "compliance";
    el.innerHTML = "";
    return;
  }

  const onBrand = best.d <= MATCH_THRESHOLD;
  el.className = "compliance " + (onBrand ? "match" : "off");
  const name = escapeHtml(best.entry.name);
  const label = onBrand
    ? `On brand — <b>${name}</b> ${best.entry.hex} (ΔE ${best.d.toFixed(1)})`
    : `Off brand — closest is <b>${name}</b> ${best.entry.hex} (ΔE ${best.d.toFixed(1)})`;
  el.innerHTML =
    `<div class="compliance-badge">` +
    `<span class="compliance-dot" style="background:${best.entry.hex}"></span>` +
    `<span class="compliance-text">${label}</span>` +
    `</div>`;
}

async function renderHistory() {
  const history = await getHistory();
  const container = document.getElementById("history");
  const clearBtn = document.getElementById("clearBtn");

  if (!history.length) {
    container.innerHTML =
      '<p class="empty-hint">Colors you pick will show up here.</p>';
    clearBtn.classList.add("hidden");
    return;
  }

  clearBtn.classList.remove("hidden");
  container.innerHTML = "";
  for (const hex of history) {
    const btn = document.createElement("button");
    btn.className = "history-swatch";
    btn.style.background = hex;
    btn.title = `${hex} — click to reload`;
    btn.addEventListener("click", () => showColor(hex));
    container.appendChild(btn);
  }
}

async function addToHistory(hex) {
  let history = await getHistory();
  history = [
    hex,
    ...history.filter((h) => h.toLowerCase() !== hex.toLowerCase()),
  ];
  history = history.slice(0, MAX_HISTORY);
  await setHistory(history);
  await renderHistory();
}

async function clearHistory() {
  await setHistory([]);
  await renderHistory();
}

// Rebuilds the target dropdown from the current palette: a per-category
// "(any)" option plus each color, grouped under <optgroup>. Preserves the
// saved selection when it still exists, otherwise falls back to "No target".
// Exported so the Brand tab can refresh it after editing the palette.
export async function renderTargetOptions() {
  const palette = await getPalette();
  const select = document.getElementById("targetSelect");

  let html = '<option value="">No target</option>';
  for (const category of CATEGORY_ORDER) {
    const items = palette.filter((c) => c.category === category);
    if (!items.length) continue;
    html += `<optgroup label="${escapeHtml(category)}">`;
    html += `<option value="cat:${escapeHtml(category)}">${escapeHtml(category)} — any</option>`;
    for (const c of items) {
      html += `<option value="hex:${c.hex}">${escapeHtml(c.name)} (${c.hex})</option>`;
    }
    html += `</optgroup>`;
  }
  select.innerHTML = html;

  // Restore selection; if the saved target no longer exists, clear it.
  const options = Array.from(select.options).map((o) => o.value);
  if (!options.includes(targetSel)) targetSel = "";
  select.value = targetSel;
}

async function onTargetChange(e) {
  targetSel = e.target.value;
  await renderTargetCompare(current ? current.rgb : null);
}

// Re-render the compare + compliance views for the currently picked color, if
// any. Exported so the Brand tab can refresh them after editing the palette.
export async function refreshCurrent() {
  if (!current) return;
  await renderTargetCompare(current.rgb);
  await renderCompliance(current.rgb);
}

// ---- Events -----------------------------------------------------------------

async function onPick() {
  try {
    const hex = await pickFromPage();
    if (!hex) return; // cancelled
    await showColor(hex);
    await addToHistory(current.hex);
  } catch (e) {
    if (e.message === "unsupported") {
      toast("EyeDropper needs Chrome 95+");
    } else {
      toast("Can't pick on this page");
    }
  }
}

async function onCopy(e) {
  const kind = e.currentTarget.dataset.copy;
  if (!current) return;
  const value = formatFor(kind, current.rgb);
  try {
    await navigator.clipboard.writeText(value);
    e.currentTarget.classList.add("copied");
    e.currentTarget.textContent = "Copied";
    setTimeout(() => {
      e.currentTarget.classList.remove("copied");
      e.currentTarget.textContent = "Copy";
    }, 1200);
  } catch {
    toast("Copy failed");
  }
}

// Wires up the Picker tab and does its initial render. The target selection is
// intentionally not persisted, so it starts at "No target" on every open.
export function initPicker() {
  document.getElementById("pickBtn").addEventListener("click", onPick);
  document.getElementById("clearBtn").addEventListener("click", clearHistory);
  document
    .querySelectorAll(".copy-btn")
    .forEach((b) => b.addEventListener("click", onCopy));
  document
    .getElementById("targetSelect")
    .addEventListener("change", onTargetChange);

  renderHistory();
  renderTargetOptions();
}
