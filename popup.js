"use strict";

// ---- Defaults ---------------------------------------------------------------

// Volkswagen brand palette, grouped by usage tier.
const DEFAULT_PALETTE = [
  { name: "White", hex: "#FFFFFF", category: "Primary" },
  { name: "VW Dark Blue", hex: "#001E50", category: "Primary" },

  { name: "VW Digital Cobalt", hex: "#11192E", category: "Secondary" },
  { name: "VW Digital Cobalt 80", hex: "#404759", category: "Secondary" },
  { name: "VW Digital Cobalt 60", hex: "#707582", category: "Secondary" },
  { name: "VW Digital Cobalt 40", hex: "#A1A3AB", category: "Secondary" },
  { name: "VW Digital Cobalt 10", hex: "#D0D1D5", category: "Secondary" },
  { name: "VW Light Blue", hex: "#00B0F0", category: "Secondary" },
  { name: "VW Light Petrol", hex: "#00A8C6", category: "Secondary" },
  { name: "VW Turquoise", hex: "#00CACA", category: "Secondary" },
  { name: "VW Mint Blue", hex: "#00E6E6", category: "Secondary" },
  { name: "VW Ultramarine", hex: "#0040C5", category: "Secondary" },

  { name: "VW Red", hex: "#E4002C", category: "Tertiary" },
  { name: "VW Green", hex: "#029640", category: "Tertiary" },
  { name: "VW Yellow", hex: "#FFD100", category: "Tertiary" },
  { name: "VW Amber", hex: "#F08203", category: "Tertiary" },
];
const CATEGORY_ORDER = ["Primary", "Secondary", "Tertiary", "Custom"];
const MAX_HISTORY = 24;
// Max CIE76 deltaE for a picked color to count as "on brand".
const MATCH_THRESHOLD = 12;

// ---- State ------------------------------------------------------------------

let current = null; // { hex, rgb: [r,g,b] }
let editingIndex = null; // index in palette being edited, or null when adding

// ---- Color math -------------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]) {
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return "#" + to2(r) + to2(g) + to2(b);
}

function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

// CIE Lab conversion + CIE76 deltaE for perceptual color distance.
function rgbToLab([r, g, b]) {
  let [rr, gg, bb] = [r, g, b].map((v) => {
    v /= 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  });
  // sRGB -> XYZ (D65)
  let x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
  let y = rr * 0.2126 + gg * 0.7152 + bb * 0.0722;
  let z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
  [x, y, z] = [x, y, z].map((v) =>
    v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116
  );
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(rgb1, rgb2) {
  const [l1, a1, b1] = rgbToLab(rgb1);
  const [l2, a2, b2] = rgbToLab(rgb2);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// ---- Formatting -------------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function formatFor(kind, rgb) {
  if (kind === "hex") return rgbToHex(rgb);
  if (kind === "rgb") return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const [h, s, l] = rgbToHsl(rgb);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// ---- Storage ----------------------------------------------------------------

function getStore(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function setStore(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

// Stored under "brandPalette" as [{ name, hex, category }]. The key is
// distinct from any earlier hex-string format so the VW defaults seed cleanly.
async function getPalette() {
  const { brandPalette } = await getStore("brandPalette");
  if (!Array.isArray(brandPalette) || !brandPalette.length) {
    return DEFAULT_PALETTE.map((c) => ({ ...c }));
  }
  return brandPalette.map((c) => ({
    name: c.name || c.hex,
    hex: rgbToHex(hexToRgb(c.hex)),
    category: CATEGORY_ORDER.includes(c.category) ? c.category : "Custom",
  }));
}

async function setPalette(palette) {
  await setStore({ brandPalette: palette });
}

async function getHistory() {
  const { history } = await getStore("history");
  return Array.isArray(history) ? history : [];
}

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

  await renderCompliance(rgb);
}

async function renderCompliance(rgb) {
  const palette = await getPalette();
  let best = null;
  for (const entry of palette) {
    const d = deltaE(rgb, hexToRgb(entry.hex));
    if (!best || d < best.d) best = { entry, d };
  }

  const el = document.getElementById("compliance");
  if (!best) {
    el.className = "compliance";
    el.innerHTML = "";
    return;
  }

  const onBrand = best.d <= MATCH_THRESHOLD;
  el.className = "compliance " + (onBrand ? "match" : "off");
  const name = escapeHtml(best.entry.name);
  const label = onBrand
    ? `On brand — <b>${name}</b> (${best.entry.hex})`
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
    container.innerHTML = '<p class="empty-hint">Colors you pick will show up here.</p>';
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
  history = [hex, ...history.filter((h) => h.toLowerCase() !== hex.toLowerCase())];
  history = history.slice(0, MAX_HISTORY);
  await setStore({ history });
  await renderHistory();
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

// ---- Tabs -------------------------------------------------------------------

function switchTab(name) {
  const isPicker = name === "picker";
  document.getElementById("tab-picker").classList.toggle("hidden", !isPicker);
  document.getElementById("tab-brand").classList.toggle("hidden", isPicker);

  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });

  if (!isPicker) {
    renderBrandGroups();
    closeEditor();
  }
}

// ---- Brand palette (grouped cards + inline editor) --------------------------

async function renderBrandGroups() {
  const palette = await getPalette();
  const container = document.getElementById("brandGroups");
  container.innerHTML = "";

  for (const category of CATEGORY_ORDER) {
    const items = palette
      .map((entry, index) => ({ entry, index }))
      .filter((x) => x.entry.category === category);
    if (!items.length) continue;

    const title = document.createElement("div");
    title.className = "brand-group-title";
    title.textContent = category;
    container.appendChild(title);

    const list = document.createElement("div");
    list.className = "brand-cards";
    for (const { entry, index } of items) {
      list.appendChild(makeCard(entry, index));
    }
    container.appendChild(list);
  }
}

function makeCard(entry, index) {
  const rgb = hexToRgb(entry.hex);
  const card = document.createElement("button");
  card.className = "brand-card" + (index === editingIndex ? " selected" : "");
  card.innerHTML =
    `<span class="brand-card-swatch" style="background:${entry.hex}"></span>` +
    `<span class="brand-card-info">` +
    `<span class="brand-card-name">${escapeHtml(entry.name)}</span>` +
    `<span class="brand-card-meta">${entry.hex} · RGB ${rgb[0]}, ${rgb[1]}, ${rgb[2]}</span>` +
    `</span>`;
  card.addEventListener("click", () => openEditor(index));
  return card;
}

// Set editor fields from one rgb triple. Pass skipRgb when the R/G/B inputs
// are the source of the change, so the user's typing isn't clobbered.
function setEditorColor(rgb, skipRgb) {
  const hex = rgbToHex(rgb);
  document.getElementById("brandColorInput").value = hex.toLowerCase();
  document.getElementById("brandHexInput").value = hex.toUpperCase();
  if (!skipRgb) {
    document.getElementById("brandRInput").value = rgb[0];
    document.getElementById("brandGInput").value = rgb[1];
    document.getElementById("brandBInput").value = rgb[2];
  }
}

async function openEditor(index) {
  const palette = await getPalette();
  editingIndex = index;
  const isNew = index === null;
  const entry = isNew
    ? { name: "", hex: "#001E50", category: "Custom" }
    : palette[index];

  document.getElementById("editorTitle").textContent = isNew ? "Add color" : "Edit color";
  document.getElementById("brandNameInput").value = entry.name;
  document.getElementById("brandCategoryInput").value = entry.category;
  setEditorColor(hexToRgb(entry.hex));
  document.getElementById("brandDeleteBtn").classList.toggle("hidden", isNew);
  document.getElementById("brandStatus").textContent = "";
  document.getElementById("brandEditor").classList.remove("hidden");
  await renderBrandGroups();
  document.getElementById("tab-brand").scrollTop = 0;
  window.scrollTo(0, 0);
}

function closeEditor() {
  editingIndex = null;
  document.getElementById("brandEditor").classList.add("hidden");
}

function normalizeHex(raw) {
  let s = raw.trim();
  if (!s.startsWith("#")) s = "#" + s;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return null;
  return rgbToHex(hexToRgb(s));
}

async function saveBrandColor() {
  const status = document.getElementById("brandStatus");
  const hex = normalizeHex(document.getElementById("brandHexInput").value);
  if (!hex) {
    status.style.color = "var(--warn)";
    status.textContent = "Enter a valid HEX color, e.g. #001E50.";
    return;
  }
  const name = document.getElementById("brandNameInput").value.trim() || hex;
  const category = document.getElementById("brandCategoryInput").value;
  const entry = { name, hex, category };

  const palette = await getPalette();
  if (editingIndex === null) {
    palette.push(entry);
  } else {
    palette[editingIndex] = entry;
  }
  await setPalette(palette);
  closeEditor();
  await renderBrandGroups();
  if (current) await renderCompliance(current.rgb);
}

async function deleteBrandColor() {
  if (editingIndex === null) return;
  const palette = await getPalette();
  palette.splice(editingIndex, 1);
  await setPalette(palette);
  closeEditor();
  await renderBrandGroups();
  if (current) await renderCompliance(current.rgb);
}

async function clearHistory() {
  await setStore({ history: [] });
  await renderHistory();
}

// ---- Init -------------------------------------------------------------------

document.getElementById("pickBtn").addEventListener("click", onPick);
document.getElementById("clearBtn").addEventListener("click", clearHistory);
document.querySelectorAll(".copy-btn").forEach((b) => b.addEventListener("click", onCopy));

// Tabs
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => switchTab(t.dataset.tab))
);

// Brand editor: keep color input, HEX, and R/G/B fields in sync.
const brandColorInput = document.getElementById("brandColorInput");
const brandHexInput = document.getElementById("brandHexInput");
const rgbInputs = ["brandRInput", "brandGInput", "brandBInput"].map((id) =>
  document.getElementById(id)
);

brandColorInput.addEventListener("input", () =>
  setEditorColor(hexToRgb(brandColorInput.value))
);
brandHexInput.addEventListener("input", () => {
  const hex = normalizeHex(brandHexInput.value);
  if (hex) setEditorColor(hexToRgb(hex));
});
rgbInputs.forEach((input) =>
  input.addEventListener("input", () => {
    const rgb = rgbInputs.map((el) => {
      const n = parseInt(el.value, 10);
      return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : 0;
    });
    setEditorColor(rgb, true);
  })
);

document.getElementById("brandAddBtn").addEventListener("click", () => openEditor(null));
document.getElementById("brandSaveBtn").addEventListener("click", saveBrandColor);
document.getElementById("brandDeleteBtn").addEventListener("click", deleteBrandColor);
document.getElementById("brandCancelBtn").addEventListener("click", closeEditor);

renderHistory();
