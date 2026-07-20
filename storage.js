// Persistent data: brand palette + pick history, backed by chrome.storage.local.

import { hexToRgb, rgbToHex } from "./helper.js";

// ---- Defaults ---------------------------------------------------------------

// Volkswagen brand palette, grouped by usage tier.
export const DEFAULT_PALETTE = [
  { name: "White", hex: "#FFFFFF", category: "Primary" },
  { name: "VW Dark Blue", hex: "#001E50", category: "Primary" },
  { name: "VW Dark Blue [Uncoated]", hex: "#003870", category: "Primary" },
  { name: "VW Dark Blue [Coated]", hex: "#002E63", category: "Primary" },

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
export const CATEGORY_ORDER = ["Primary", "Secondary", "Tertiary", "Custom"];
export const MAX_HISTORY = 24;

// ---- chrome.storage wrappers ------------------------------------------------

function getStore(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function setStore(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

// ---- Palette ----------------------------------------------------------------

// Stored under "brandPalette" as [{ name, hex, category }]. The key is
// distinct from any earlier hex-string format so the VW defaults seed cleanly.
export async function getPalette() {
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

export async function setPalette(palette) {
  await setStore({ brandPalette: palette });
}

// Overwrites the stored palette with a fresh copy of the built-in defaults.
export async function resetPalette() {
  await setPalette(DEFAULT_PALETTE.map((c) => ({ ...c })));
}

// ---- History ----------------------------------------------------------------

export async function getHistory() {
  const { history } = await getStore("history");
  return Array.isArray(history) ? history : [];
}

export async function setHistory(history) {
  await setStore({ history });
}
