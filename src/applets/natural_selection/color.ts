/**
 * Colours in OKLab (Ottosson 2020), a perceptual space: equal distances look about equally
 * different, whatever the colour. That makes it the right place to measure how well a blob blends
 * in, and to add mutations of a fixed size. L is lightness (0–1); a and b run green–red and blue–yellow.
 */

export type Lab = { L: number; a: number; b: number };
export type Rgb = [number, number, number];

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** sRGB channels 0–255 → OKLab. */
export function rgbToLab([r8, g8, b8]: Rgb): Lab {
  const r = toLinear(r8 / 255);
  const g = toLinear(g8 / 255);
  const b = toLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  };
}

/** OKLab → linear-light sRGB, possibly out of gamut. */
function labToLinear({ L, a, b }: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

function inGamut(c: Lab): boolean {
  return labToLinear(c).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

/** Pull a colour into the displayable range by reducing its saturation (lightness and hue kept). */
export function clampToGamut(c: Lab): Lab {
  const L = Math.min(1, Math.max(0, c.L));
  if (inGamut({ L, a: c.a, b: c.b })) {
    return { L, a: c.a, b: c.b };
  }
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 18; k += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut({ L, a: c.a * mid, b: c.b * mid })) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { L, a: c.a * lo, b: c.b * lo };
}

/** OKLab → sRGB channels 0–255 (clamped to gamut first). */
export function labToRgb(c: Lab): Rgb {
  const lin = labToLinear(clampToGamut(c));
  return lin.map((v) => Math.round(255 * Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))))) as Rgb;
}

export function labToCss(c: Lab, alpha = 1): string {
  const [r, g, b] = labToRgb(c);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Perceptual difference, scaled so ~2 is just noticeable and ~10 is plainly different. */
export function deltaE(p: Lab, q: Lab): number {
  return 100 * Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

export function mixLab(p: Lab, q: Lab, f: number): Lab {
  return { L: p.L + (q.L - p.L) * f, a: p.a + (q.a - p.a) * f, b: p.b + (q.b - p.b) * f };
}
