// Color math + string formatting helpers. Pure functions — no DOM, no chrome APIs.

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function rgbToHex([r, g, b]) {
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return "#" + to2(r) + to2(g) + to2(b);
}

export function rgbToHsl([r, g, b]) {
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

// CIE Lab conversion; used only by deltaE below.
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
    v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116,
  );
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// CIE76 deltaE — perceptual distance between two RGB colors.
export function deltaE(rgb1, rgb2) {
  const [l1, a1, b1] = rgbToLab(rgb1);
  const [l2, a2, b2] = rgbToLab(rgb2);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

export function formatFor(kind, rgb) {
  if (kind === "hex") return rgbToHex(rgb);
  if (kind === "rgb") return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  const [h, s, l] = rgbToHsl(rgb);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// Normalizes a raw HEX string to "#RRGGBB", or null when it isn't a valid hex.
export function normalizeHex(raw) {
  let s = raw.trim();
  if (!s.startsWith("#")) s = "#" + s;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return null;
  return rgbToHex(hexToRgb(s));
}
