// Brand tab: the grouped color cards and the inline add/edit/delete editor.
// After any palette change it asks the Picker tab to refresh its views.

import { hexToRgb, rgbToHex, escapeHtml, normalizeHex } from "./helper.js";
import {
  CATEGORY_ORDER,
  getPalette,
  setPalette,
  resetPalette,
} from "./storage.js";
import { renderTargetOptions, refreshCurrent } from "./picker.js";

let editingIndex = null; // index in palette being edited, or null when adding

// ---- Grouped cards ----------------------------------------------------------

export async function renderBrandGroups() {
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

// ---- Inline editor ----------------------------------------------------------

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

  document.getElementById("editorTitle").textContent = isNew
    ? "Add color"
    : "Edit color";
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

export function closeEditor() {
  editingIndex = null;
  document.getElementById("brandEditor").classList.add("hidden");
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
  await renderTargetOptions();
  await refreshCurrent();
}

async function deleteBrandColor() {
  if (editingIndex === null) return;
  const palette = await getPalette();
  palette.splice(editingIndex, 1);
  await setPalette(palette);
  closeEditor();
  await renderBrandGroups();
  await renderTargetOptions();
  await refreshCurrent();
}

// Restores the built-in default palette, discarding any customizations. Guarded
// by a confirm since it overwrites the user's saved colors.
async function resetBrandColors() {
  const ok = window.confirm(
    "Reset the palette to the built-in default colors? Your custom colors will be removed.",
  );
  if (!ok) return;
  await resetPalette();
  closeEditor();
  await renderBrandGroups();
  await renderTargetOptions();
  await refreshCurrent();
}

// ---- Wiring -----------------------------------------------------------------

// Wires up the Brand tab's editor. Cards are (re)built by renderBrandGroups,
// which the main module calls when the tab is shown.
export function initBrand() {
  // Keep the color input, HEX field, and R/G/B fields in sync as they change.
  const brandColorInput = document.getElementById("brandColorInput");
  const brandHexInput = document.getElementById("brandHexInput");
  const rgbInputs = ["brandRInput", "brandGInput", "brandBInput"].map((id) =>
    document.getElementById(id),
  );

  brandColorInput.addEventListener("input", () =>
    setEditorColor(hexToRgb(brandColorInput.value)),
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
    }),
  );

  document
    .getElementById("brandAddBtn")
    .addEventListener("click", () => openEditor(null));
  document
    .getElementById("brandSaveBtn")
    .addEventListener("click", saveBrandColor);
  document
    .getElementById("brandDeleteBtn")
    .addEventListener("click", deleteBrandColor);
  document
    .getElementById("brandCancelBtn")
    .addEventListener("click", closeEditor);
  document
    .getElementById("brandResetBtn")
    .addEventListener("click", resetBrandColors);
}
