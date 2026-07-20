// Main entry point: wires the tab shell and hands each tab off to its module.
// Picker-tab logic lives in picker.js; Brand-tab logic lives in brand.js.

import { initPicker } from "./picker.js";
import { initBrand, renderBrandGroups, closeEditor } from "./brand.js";

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

// ---- Init -------------------------------------------------------------------

document
  .querySelectorAll(".tab")
  .forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

initPicker();
initBrand();
