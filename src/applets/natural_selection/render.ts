import { hexToRgb, labToCss, mixLab, rgbToLab, type Lab } from "./color";
import {
  beardOf,
  BLOB_R,
  dustOf,
  FRUIT_R,
  HISTORY_LENGTH,
  IMPACT_AT,
  PREDATOR_R,
  SHOCK_SPEED,
  SPLIT_GAP,
  visibility,
  WORLD_W,
  type Blob,
  type Fruit,
  type Impact,
  type Predator,
  type World
} from "./sim";

export const HIST_W = 300;
export const HIST_H = 128;
/** With hiding as the trait the inset also carries the colour key, so it is taller. */
const HIST_H_HIDING = 172;

export function historyHeight(hiding: boolean): number {
  return hiding ? HIST_H_HIDING : HIST_H;
}

const PREDATOR_BODY = "#7b3fb3";
const PREDATOR_DARK = "#4a1f73";
const PREDATOR_LIGHT = "#a873d9";

export type Ground = { image: HTMLImageElement | null; colour: string };

/**
 * With hiding as the trait, blobs are drawn in a colour that shows their hiding time: pale blue
 * for short, deep blue for long, from 0 to HIDE_KEY_MAX seconds (longer ones take the deepest).
 * Only we see it; predators still judge every blob by its real colour, which is the same for all.
 */
export const HIDE_KEY_MAX = 8;
const HIDE_KEY = ["#cde2fb", "#3987e5", "#0d366b"].map((hex) => rgbToLab(hexToRgb(hex)));

export function hideColour(hide: number): Lab {
  const f = Math.min(1, Math.max(0, hide / HIDE_KEY_MAX)) * (HIDE_KEY.length - 1);
  const k = Math.min(HIDE_KEY.length - 2, Math.floor(f));
  return mixLab(HIDE_KEY[k], HIDE_KEY[k + 1], f - k);
}

function tintedByHide(b: Blob): Blob {
  const colour = hideColour(b.hide);
  return { ...b, colour, css: labToCss(colour) };
}

/** Line colours for the two halves of the side-by-side view. */
export const DARWIN_COLOUR = "#7cc4ff";
export const LAMARCK_COLOUR = "#ffb454";

/** Uneaten strawberries rot away over their last few seconds (keep in step with sim.ts). */
const FRUIT_LIFE = 25;

// ─── Shapes ──────────────────────────────────────────────────────────────────

/** A soft, wobbling blob outline around (x, y). `stretch` elongates it along `angle`. */
function blobPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, phase: number, t: number, stretch = 1, angle = 0): void {
  const n = 28;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  ctx.beginPath();
  for (let k = 0; k <= n; k += 1) {
    const th = (k / n) * Math.PI * 2;
    const rr = r * (1 + 0.05 * Math.sin(3 * th + phase + 2.2 * t) + 0.035 * Math.sin(5 * th - 1.3 * phase - 1.6 * t));
    // Stretch along the direction of travel, squash across it (keeps the area about the same).
    const u = Math.cos(th) * rr * stretch;
    const v = Math.sin(th) * (rr / stretch);
    const px = x + u * c - v * s;
    const py = y + u * s + v * c;
    if (k === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

function shade(c: Lab, dL: number): string {
  return labToCss({ L: c.L + dL, a: c.a, b: c.b });
}

/** A googly eye: white ball, dark rim, and a pupil that rolls with the body's motion. */
function googly(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, px: number, py: number): void {
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(20, 20, 30, 0.55)";
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.stroke();
  ctx.fillStyle = "#111118";
  ctx.beginPath();
  ctx.arc(x + px * r, y + py * r, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.arc(x + px * r - r * 0.16, y + py * r - r * 0.18, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
}

function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  ctx.fillStyle = `rgba(0, 0, 0, ${0.16 * alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.8, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Happy closed eyes (^ ^), while a blob swells after eating. */
function happyEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.strokeStyle = "#111118";
  ctx.lineWidth = Math.max(1.4, 0.32 * r);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y + 0.35 * r, 0.75 * r, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
}

/** Peacefully closed eyes (◡ ◡), for a blob dying of old age. */
function closedEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.strokeStyle = "#111118";
  ctx.lineWidth = Math.max(1.2, 0.26 * r);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y - 0.25 * r, 0.7 * r, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
}

const BEARD_LIGHT = "#f6f3ec";
const BEARD_DARK = "#d6cfc2";

/**
 * A fluffy white beard hanging from the cheeks, longer the older the blob (`amount` 0–1), with a
 * moustache on top. `sway` (in radii) swings the tip as the blob moves.
 */
function drawBeard(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, amount: number, sway: number): void {
  if (amount <= 0.02) {
    return;
  }
  const hw = r * (0.48 + 0.3 * amount);
  const top = y + 0.12 * r;
  const tipX = x + sway * r * amount;
  const tipY = y + r * (0.62 + 0.85 * amount);
  // Scalloped edge: cheek → tip → cheek, bulging out in little tufts.
  const n = 6;
  ctx.beginPath();
  ctx.moveTo(x - hw, top);
  let px = x - hw;
  let py = top;
  for (let k = 1; k <= n; k += 1) {
    const f = k / n;
    // A rounded V from one cheek to the other, through the tip.
    const along = f < 0.5 ? f / 0.5 : (1 - f) / 0.5;
    const qx = f < 0.5 ? x - hw + (tipX - (x - hw)) * smooth(along) : x + hw + (tipX - (x + hw)) * smooth(along);
    const qy = top + (tipY - top) * Math.sin((along * Math.PI) / 2);
    const mx = (px + qx) / 2;
    const my = (py + qy) / 2;
    const nx = qy - py;
    const ny = -(qx - px);
    const nl = Math.hypot(nx, ny) || 1;
    const bulge = 0.2 * r;
    ctx.quadraticCurveTo(mx + (nx / nl) * bulge, my + (ny / nl) * bulge, qx, qy);
    px = qx;
    py = qy;
  }
  ctx.quadraticCurveTo(x, y + 0.42 * r, x - hw, top);
  ctx.closePath();
  const g = ctx.createLinearGradient(x, top, x, tipY);
  g.addColorStop(0, BEARD_LIGHT);
  g.addColorStop(1, BEARD_DARK);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(70, 60, 50, 0.35)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // A few strands.
  ctx.strokeStyle = "rgba(120, 110, 95, 0.3)";
  ctx.lineWidth = 0.7;
  [-0.45, 0, 0.45].forEach((u) => {
    ctx.beginPath();
    ctx.moveTo(x + u * hw * 0.8, y + 0.5 * r);
    ctx.quadraticCurveTo(x + u * hw * 0.6 + 0.3 * sway * r, y + r * (0.55 + 0.45 * amount), tipX + u * hw * 0.35, tipY - 0.25 * r * (1 + amount));
    ctx.stroke();
  });
  // Moustache: two curling tufts under the eyes.
  ctx.fillStyle = BEARD_LIGHT;
  ctx.strokeStyle = "rgba(70, 60, 50, 0.4)";
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.ellipse(x + side * 0.2 * r, y + 0.2 * r, 0.24 * r, (0.08 + 0.05 * amount) * r, side * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

type BodyStyle = { sx?: number; sy?: number; eyes?: "open" | "happy" | "closed"; beard?: number };

/** One blob body with its eyes. The body's average colour is exactly its trait. */
function blobBody(
  ctx: CanvasRenderingContext2D,
  b: Blob,
  x: number,
  y: number,
  r: number,
  t: number,
  alpha: number,
  lookX: number,
  lookY: number,
  style: BodyStyle = {}
): void {
  const sx = style.sx ?? 1;
  const sy = style.sy ?? 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.translate(-x, -y);
  ctx.globalAlpha = alpha;
  drawShadow(ctx, x, y, r, 1);
  blobPath(ctx, x, y, r, b.phase, t);
  // A gentle highlight and shade, balanced so the body still averages to its own colour.
  const g = ctx.createRadialGradient(x - 0.35 * r, y - 0.4 * r, 0.1 * r, x, y, 1.1 * r);
  g.addColorStop(0, shade(b.colour, 0.05));
  g.addColorStop(0.55, b.css);
  g.addColorStop(1, shade(b.colour, -0.05));
  ctx.fillStyle = g;
  ctx.fill();
  drawBeard(ctx, x, y, r, style.beard ?? beardOf(b), -0.25 * (b.vx / 48));
  const e = 0.34 * r;
  if (style.eyes === "happy") {
    happyEye(ctx, x - 0.36 * r, y - 0.2 * r, e);
    happyEye(ctx, x + 0.36 * r, y - 0.2 * r, e);
  } else if (style.eyes === "closed") {
    closedEye(ctx, x - 0.36 * r, y - 0.2 * r, e);
    closedEye(ctx, x + 0.36 * r, y - 0.2 * r, e);
  } else {
    const px = 0.25 * lookX + b.eyes.x;
    const py = 0.25 * lookY + b.eyes.y;
    googly(ctx, x - 0.36 * r, y - 0.2 * r, e, px, py);
    googly(ctx, x + 0.36 * r, y - 0.2 * r, e, px, py);
  }
  ctx.restore();
}

function smooth(f: number): number {
  const c = Math.min(1, Math.max(0, f));
  return c * c * (3 - 2 * c);
}

/** Phases of eating a strawberry and splitting in two (fractions of the whole). */
const EAT_END = 0.22;
const SWELL_END = 0.45;
const SWELL = 0.22;

/**
 * Eat, swell, split: the strawberry slides in and shrinks while the blob munches; the blob swells
 * with happy eyes; then it stretches into a peanut, pinches at the waist and pops into two.
 */
function drawReproducing(ctx: CanvasRenderingContext2D, b: Blob, t: number): void {
  const p = b.repro;
  if (p < EAT_END) {
    const e = p / EAT_END;
    const munch = 0.1 * Math.sin(e * Math.PI * 4);
    blobBody(ctx, b, b.x, b.y, BLOB_R, t, 1, b.fruitDx / 30, b.fruitDy / 30, { sx: 1 + munch, sy: 1 - munch });
    drawStrawberry(ctx, b.x + b.fruitDx * (1 - e), b.y + b.fruitDy * (1 - e), FRUIT_R * (1 - 0.8 * e), 1 - e, 0);
    return;
  }
  if (p < SWELL_END) {
    const q = (p - EAT_END) / (SWELL_END - EAT_END);
    const jiggle = 0.06 * Math.sin(q * Math.PI * 6) * (1 - q);
    blobBody(ctx, b, b.x, b.y, BLOB_R * (1 + SWELL * smooth(q)), t, 1, 0, 0, { sx: 1 + jiggle, sy: 1 - jiggle, eyes: "happy" });
    return;
  }
  const q = (p - SWELL_END) / (1 - SWELL_END);
  const ax = Math.cos(b.reproAxis);
  const ay = Math.sin(b.reproAxis);
  const d = SPLIT_GAP * BLOB_R * smooth(q);
  const r = BLOB_R * (1 + SWELL - SWELL * q);
  // The waist: a bridge between the two halves that thins to nothing, then they're apart.
  const waist = r * 0.9 * (1 - smooth(q / 0.75));
  if (waist > 0.5) {
    ctx.strokeStyle = b.css;
    ctx.lineWidth = 2 * waist;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(b.x - ax * d, b.y - ay * d);
    ctx.lineTo(b.x + ax * d, b.y + ay * d);
    ctx.stroke();
  }
  // The parent (which keeps its age, and its beard) goes one way; the fresh copy the other.
  blobBody(ctx, b, b.x - ax * d, b.y - ay * d, r, t, 1, -ax, -ay);
  blobBody(ctx, b, b.x + ax * d, b.y + ay * d, r, t, 1, ax, ay, { beard: 0 });
  if (q > 0.72) {
    // Pop!
    const k = (q - 0.72) / 0.28;
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.8 * (1 - k)).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BLOB_R * (0.4 + 1.1 * k), 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * Dying of old age: the blob closes its eyes and settles, then fades while a little ghost with a
 * halo floats up and away.
 */
function drawOldAge(ctx: CanvasRenderingContext2D, b: Blob, t: number): void {
  const p = b.dying;
  const settle = smooth(p / 0.3);
  const fade = 1 - smooth((p - 0.3) / 0.7);
  blobBody(ctx, b, b.x, b.y + 0.12 * BLOB_R * settle, BLOB_R, t, fade, 0, 0, {
    sx: 1 + 0.07 * settle,
    sy: 1 - 0.12 * settle,
    eyes: "closed"
  });
  if (p < 0.3) {
    return;
  }
  const k = (p - 0.3) / 0.7;
  const gx = b.x + 0.4 * BLOB_R * Math.sin(k * Math.PI * 2.5);
  const gy = b.y - 3 * BLOB_R * smooth(k);
  const r = 0.8 * BLOB_R;
  const a = 0.8 * Math.sin(Math.PI * Math.min(1, k * 1.1));
  ctx.save();
  ctx.globalAlpha = a;
  blobPath(ctx, gx, gy, r, b.phase, t);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  closedEye(ctx, gx - 0.36 * r, gy - 0.2 * r, 0.34 * r);
  closedEye(ctx, gx + 0.36 * r, gy - 0.2 * r, 0.34 * r);
  ctx.strokeStyle = "#ffd75e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(gx, gy - 1.25 * r, 0.55 * r, 0.17 * r, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

const ASH = rgbToLab(hexToRgb("#3b3632"));

/** Killed by the impact: the blob chars to ash, settles and fades, with a wisp of smoke. */
function drawScorched(ctx: CanvasRenderingContext2D, b: Blob, t: number): void {
  const p = b.dying;
  const char = smooth(p / 0.35);
  const colour = mixLab(b.colour, ASH, 0.85 * char);
  const burnt = { ...b, colour, css: labToCss(colour) };
  const fade = 1 - smooth((p - 0.35) / 0.65);
  blobBody(ctx, burnt, b.x, b.y + 0.15 * BLOB_R * char, BLOB_R * (1 - 0.15 * char), t, fade, 0, 0, {
    sx: 1 + 0.12 * char,
    sy: 1 - 0.2 * char,
    eyes: "closed"
  });
  const k = Math.min(1, p / 0.8);
  ctx.fillStyle = `rgba(60, 56, 54, ${(0.35 * Math.sin(Math.PI * k)).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(b.x + 4 * Math.sin(p * 9 + b.phase), b.y - BLOB_R - 22 * k, 5 + 7 * k, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Hiding: the predators can't see the blob, but we can. A faint body inside a shimmering shield
 * bubble that pops up, and flickers in the last half-second before the blob shows itself again.
 */
function drawHiding(ctx: CanvasRenderingContext2D, b: Blob, t: number): void {
  const since = b.hideFor - b.hiding;
  const pop = springOut(since / 0.25);
  const flicker = b.hiding < 0.5 ? 0.55 + 0.45 * Math.cos(t * 40) : 1;
  // springOut(0) can round to just below zero, which createRadialGradient rejects.
  const r = (BLOB_R + 9) * Math.max(0.05, pop);
  blobBody(ctx, b, b.x, b.y, BLOB_R, t, 0.3, Math.cos(b.heading), Math.sin(b.heading));
  ctx.save();
  ctx.globalAlpha = flicker;
  const g = ctx.createRadialGradient(b.x - 0.3 * r, b.y - 0.35 * r, 0.1 * r, b.x, b.y, r);
  g.addColorStop(0, "rgba(220, 250, 255, 0.28)");
  g.addColorStop(0.7, "rgba(120, 220, 255, 0.14)");
  g.addColorStop(1, "rgba(120, 220, 255, 0.4)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 40, 60, 0.45)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = "rgba(170, 240, 255, 0.95)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Two glints chasing round the rim.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  for (const off of [0, Math.PI]) {
    const a = 2.4 * t + b.phase + off;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, a, a + 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBlob(ctx: CanvasRenderingContext2D, b: Blob, t: number): void {
  const lookX = Math.cos(b.heading);
  const lookY = Math.sin(b.heading);
  if (b.hiding > 0 && b.caught < 0 && b.dying < 0) {
    drawHiding(ctx, b, t);
    return;
  }
  if (b.repro >= 0) {
    drawReproducing(ctx, b, t);
    return;
  }
  if (b.caught >= 0) {
    blobBody(ctx, b, b.x, b.y, BLOB_R * Math.max(0.05, 1 - b.caught), t, 1 - 0.3 * b.caught, lookX, lookY);
    return;
  }
  if (b.dying >= 0) {
    if (b.scorched) {
      drawScorched(ctx, b, t);
    } else {
      drawOldAge(ctx, b, t);
    }
    return;
  }
  // A fresh blob lands with a little squash-and-stretch bounce.
  const bounce = b.born < 0.4 ? 0.16 * Math.sin((b.born / 0.4) * Math.PI * 2) * (1 - b.born / 0.4) : 0;
  blobBody(ctx, b, b.x, b.y, BLOB_R, t, 1, lookX, lookY, { sx: 1 + bounce, sy: 1 - bounce });
}

/** Oklahoma's state fruit, the strawberry: red heart with seeds and a green leafy top. */
function drawStrawberry(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, wobble: number): void {
  if (alpha <= 0.01 || r <= 0.3) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(0.12 * Math.sin(wobble));
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 1.1 * r, 0.8 * r, 0.25 * r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -0.7 * r);
  ctx.bezierCurveTo(1.25 * r, -1.05 * r, 1.1 * r, 0.5 * r, 0, 1.15 * r);
  ctx.bezierCurveTo(-1.1 * r, 0.5 * r, -1.25 * r, -1.05 * r, 0, -0.7 * r);
  const g = ctx.createRadialGradient(-0.3 * r, -0.35 * r, 0.1 * r, 0, 0, 1.3 * r);
  g.addColorStop(0, "#ff6b78");
  g.addColorStop(0.6, "#e8283f");
  g.addColorStop(1, "#a8132b");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = "#ffe08a";
  [[-0.45, -0.25], [0.1, -0.35], [0.5, -0.15], [-0.2, 0.15], [0.3, 0.3], [-0.05, 0.6], [-0.5, 0.25]].forEach(([u, v]) => {
    ctx.beginPath();
    ctx.ellipse(u * r, v * r, 0.07 * r, 0.11 * r, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#3fae4a";
  for (let k = 0; k < 5; k += 1) {
    const a = -Math.PI / 2 + (k - 2) * 0.55;
    ctx.beginPath();
    ctx.moveTo(-0.18 * r, -0.72 * r);
    ctx.lineTo(Math.cos(a) * 0.75 * r, -0.72 * r + Math.sin(a) * 0.45 * r + 0.2 * r);
    ctx.lineTo(0.18 * r, -0.72 * r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = "#2f7d36";
  ctx.lineWidth = Math.max(1, 0.14 * r);
  ctx.beginPath();
  ctx.moveTo(0, -0.8 * r);
  ctx.lineTo(0.12 * r, -1.15 * r);
  ctx.stroke();
  ctx.restore();
}

/** Ease out with a little overshoot: 0 → 1, peaking ~10% past 1 on the way. */
function springOut(f: number): number {
  const x = Math.min(1, Math.max(0, f)) - 1;
  return 1 + 2.7 * x * x * x + 1.7 * x * x;
}

/** Strawberries pop up with a springy bounce and wither away when nobody eats them. */
function drawFruit(ctx: CanvasRenderingContext2D, f: Fruit, t: number): void {
  const pop = springOut(f.age / 0.45);
  const rot = Math.min(1, Math.max(0, (FRUIT_LIFE - f.age) / 3));
  drawStrawberry(ctx, f.x, f.y, FRUIT_R * pop * (0.7 + 0.3 * rot), rot, t * 2 + f.id);
}

/** The predator: a big purple blob with one huge googly eye and a chomping mouth. */
function drawPredator(ctx: CanvasRenderingContext2D, p: Predator, w: World, t: number): void {
  const speed = Math.hypot(p.vx, p.vy);
  const stretch = 1 + 0.12 * Math.min(1, speed / 175);
  drawShadow(ctx, p.x, p.y + 4, PREDATOR_R, 1.4);
  blobPath(ctx, p.x, p.y, PREDATOR_R, p.phase, t, stretch, p.heading);
  const g = ctx.createRadialGradient(p.x - 0.35 * PREDATOR_R, p.y - 0.45 * PREDATOR_R, 4, p.x, p.y, 1.15 * PREDATOR_R);
  g.addColorStop(0, PREDATOR_LIGHT);
  g.addColorStop(0.55, PREDATOR_BODY);
  g.addColorStop(1, PREDATOR_DARK);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(30, 10, 50, 0.6)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Looks at its target, or where it is going.
  const target = p.target >= 0 ? w.blobs.find((b) => b.id === p.target) : undefined;
  const look = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.heading;
  googly(ctx, p.x, p.y - 0.28 * PREDATOR_R, 0.42 * PREDATOR_R, 0.3 * Math.cos(look) + p.eye.x, 0.3 * Math.sin(look) + p.eye.y);

  // Mouth: a dark oval that gapes while chasing and chomps while eating, with two teeth.
  const mw = 0.52 * PREDATOR_R;
  const mh = 0.06 * PREDATOR_R + 0.3 * PREDATOR_R * p.mouth;
  const my = p.y + 0.38 * PREDATOR_R;
  ctx.fillStyle = "#2a0a1e";
  ctx.beginPath();
  ctx.ellipse(p.x, my, mw, mh, 0, 0, Math.PI * 2);
  ctx.fill();
  if (p.mouth > 0.25) {
    ctx.fillStyle = "#fffdf5";
    [-0.42, 0.18].forEach((u) => {
      ctx.beginPath();
      ctx.moveTo(p.x + u * mw, my - mh * 0.92);
      ctx.lineTo(p.x + (u + 0.24) * mw, my - mh * 0.92);
      ctx.lineTo(p.x + (u + 0.12) * mw, my - mh * 0.92 + 0.22 * PREDATOR_R);
      ctx.closePath();
      ctx.fill();
    });
  }

  // Waiting where its prey vanished: a bobbing question mark.
  if (p.puzzled > 0 && p.dying < 0) {
    const bob = 3 * Math.sin(t * 6 + p.phase);
    ctx.font = "800 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(30, 10, 50, 0.85)";
    ctx.strokeText("?", p.x + 0.6 * PREDATOR_R, p.y - 0.95 * PREDATOR_R + bob);
    ctx.fillStyle = "#fff6c8";
    ctx.fillText("?", p.x + 0.6 * PREDATOR_R, p.y - 0.95 * PREDATOR_R + bob);
  }
}

/**
 * "Who stands out": a ring around each blob, bolder the more likely a predator is to spot it.
 * White over a dark edge, so it shows on any ground.
 */
function drawStandOut(ctx: CanvasRenderingContext2D, w: World): void {
  for (const b of w.blobs) {
    if (b.caught >= 0 || b.dying >= 0 || b.hiding > 0) {
      continue;
    }
    const v = visibility(b.colour, w.field.sample(b.x, b.y));
    if (v < 0.05) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(b.x, b.y, BLOB_R + 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 0, 0, ${(0.55 * v).toFixed(3)})`;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.95 * v).toFixed(3)})`;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }
}

// ─── Asteroid ────────────────────────────────────────────────────────────────

/** The falling asteroid's position: in from just above the top edge, on a steep slant, speeding up. */
function asteroidAt(im: Impact): { x: number; y: number; e: number; ux: number; uy: number } {
  const e = (im.t / IMPACT_AT) ** 1.3;
  const dy = -(im.y + 40);
  const dx = -0.75 * dy;
  const l = Math.hypot(dx, dy);
  return { x: im.x + dx * (1 - e), y: im.y + dy * (1 - e), e, ux: dx / l, uy: dy / l };
}

/** A scorched crater at the impact point, under everything else; it fades as the event ends. */
function drawCrater(ctx: CanvasRenderingContext2D, im: Impact): void {
  if (!im.struck) {
    // The asteroid's shadow, growing as it comes in.
    const { e } = asteroidAt(im);
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.3 * e).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(im.x, im.y, 8 + 34 * e, 4 + 14 * e, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const a = 1 - smooth((im.t - 30) / 50);
  const g = ctx.createRadialGradient(im.x, im.y, 4, im.x, im.y, 110);
  g.addColorStop(0, `rgba(20, 14, 10, ${(0.85 * a).toFixed(3)})`);
  g.addColorStop(0.45, `rgba(45, 30, 20, ${(0.55 * a).toFixed(3)})`);
  g.addColorStop(1, "rgba(45, 30, 20, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(im.x, im.y, 110, 70, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** The falling asteroid; then the fireball, flash and shockwave; then dust and falling ash. */
function drawImpact(ctx: CanvasRenderingContext2D, w: World, im: Impact, t: number): void {
  if (!im.struck) {
    const { x: hx, y: hy, e, ux, uy } = asteroidAt(im);
    const len = 160 + 200 * e;
    const trail = ctx.createLinearGradient(hx, hy, hx + ux * len, hy + uy * len);
    trail.addColorStop(0, "rgba(255, 236, 170, 0.95)");
    trail.addColorStop(0.3, "rgba(255, 150, 60, 0.6)");
    trail.addColorStop(1, "rgba(255, 110, 40, 0)");
    ctx.strokeStyle = trail;
    ctx.lineCap = "round";
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + ux * len, hy + uy * len);
    ctx.stroke();
    const r = 14 + 6 * e;
    const glow = ctx.createRadialGradient(hx, hy, r * 0.6, hx, hy, r * 2.2);
    glow.addColorStop(0, "rgba(255, 190, 100, 0.8)");
    glow.addColorStop(1, "rgba(255, 120, 40, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    const rock = ctx.createRadialGradient(hx - 0.3 * r, hy - 0.3 * r, 1, hx, hy, r);
    rock.addColorStop(0, "#9a8c7e");
    rock.addColorStop(1, "#3a312a");
    ctx.fillStyle = rock;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const s = im.t - IMPACT_AT;
  if (s < 1.6) {
    const k = s / 1.6;
    const r = 60 + 280 * smooth(s / 0.9);
    const fire = ctx.createRadialGradient(im.x, im.y, 0, im.x, im.y, r);
    fire.addColorStop(0, `rgba(255, 250, 225, ${(1 - k).toFixed(3)})`);
    fire.addColorStop(0.4, `rgba(255, 160, 60, ${(0.8 * (1 - k)).toFixed(3)})`);
    fire.addColorStop(1, "rgba(255, 90, 30, 0)");
    ctx.fillStyle = fire;
    ctx.beginPath();
    ctx.arc(im.x, im.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const ring = s * SHOCK_SPEED;
  if (ring < 1700) {
    const a = 1 - ring / 1700;
    ctx.strokeStyle = `rgba(255, 236, 205, ${(0.75 * a).toFixed(3)})`;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(im.x, im.y, ring, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 200, 150, ${(0.3 * a).toFixed(3)})`;
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.arc(im.x, im.y, Math.max(0, ring - 30), 0, Math.PI * 2);
    ctx.stroke();
  }
  // Dust: a cold, dark sky, with ash drifting down.
  const dust = dustOf(w);
  if (dust > 0) {
    ctx.fillStyle = `rgba(22, 28, 48, ${(0.6 * dust).toFixed(3)})`;
    ctx.fillRect(0, 0, w.width, w.height);
    ctx.fillStyle = `rgba(205, 200, 194, ${(0.7 * dust).toFixed(3)})`;
    for (let i = 0; i < 110; i += 1) {
      const fx = (i * 0.6180339) % 1;
      const fy = (i * 0.3772) % 1;
      const fall = 16 + 14 * ((i * 0.913) % 1);
      const x = fx * w.width + 26 * Math.sin(0.7 * t + i);
      const y = (fy * w.height + fall * t) % w.height;
      ctx.beginPath();
      ctx.arc(x, y, 1.2 + 1.6 * ((i * 0.517) % 1), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (s < 0.6) {
    ctx.fillStyle = `rgba(255, 250, 238, ${(0.85 * (1 - s / 0.6)).toFixed(3)})`;
    ctx.fillRect(0, 0, w.width, w.height);
  }
}

export function renderScene(ctx: CanvasRenderingContext2D, w: World, ground: Ground, t: number, standOut: boolean): void {
  const img = ground.image;
  if (img && img.complete && img.naturalWidth > 0) {
    // A narrower world is the middle strip of the ground (see middleStrip in sim.ts).
    const k = img.naturalWidth / WORLD_W;
    ctx.drawImage(img, ((WORLD_W - w.width) / 2) * k, 0, w.width * k, img.naturalHeight, 0, 0, w.width, w.height);
  } else {
    ctx.fillStyle = ground.colour;
    ctx.fillRect(0, 0, w.width, w.height);
  }
  if (w.impact) {
    drawCrater(ctx, w.impact);
  }
  for (const f of w.fruits) {
    drawFruit(ctx, f, t);
  }
  const byHide = w.settings.trait === "hiding";
  for (const b of w.blobs) {
    if (byHide && b.repro < 0 && b.caught < 0 && b.dying < 0 && b.hiding === 0) {
      // A dark rim, so the pale (short-hiding) blobs stay readable on light grounds like snow.
      ctx.strokeStyle = "rgba(10, 22, 45, 0.6)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BLOB_R + 1, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawBlob(ctx, byHide ? tintedByHide(b) : b, t);
  }
  if (standOut) {
    drawStandOut(ctx, w);
  }
  for (const p of w.predators) {
    if (p.dying >= 0) {
      // Killed by the impact: slumps and fades.
      ctx.save();
      ctx.globalAlpha = 1 - p.dying;
      ctx.translate(p.x, p.y + PREDATOR_R);
      ctx.scale(1 + 0.15 * p.dying, 1 - 0.35 * p.dying);
      ctx.translate(-p.x, -(p.y + PREDATOR_R));
      drawPredator(ctx, p, w, t);
      ctx.restore();
    } else {
      drawPredator(ctx, p, w, t);
    }
  }
  if (w.impact) {
    drawImpact(ctx, w, w.impact, t);
  }
}

/** Darwin (left) and Lamarck (right): two narrower worlds side by side, each labelled. */
export function renderSideBySide(ctx: CanvasRenderingContext2D, worlds: World[], ground: Ground, t: number, standOut: boolean): void {
  let x0 = 0;
  worlds.forEach((w) => {
    ctx.save();
    ctx.translate(x0, 0);
    ctx.beginPath();
    ctx.rect(0, 0, w.width, w.height);
    ctx.clip();
    renderScene(ctx, w, ground, t, standOut);
    ctx.restore();
    x0 += w.width;
  });
  const mid = worlds[0].width;
  ctx.fillStyle = "rgba(10, 12, 18, 0.85)";
  ctx.fillRect(mid - 3, 0, 6, worlds[0].height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillRect(mid - 0.75, 0, 1.5, worlds[0].height);
  // Names at the bottom, clear of the panels at the top and the inset at bottom right.
  const label = (text: string, colour: string, x: number): void => {
    ctx.font = "700 22px system-ui, sans-serif";
    const tw = ctx.measureText(text).width;
    const y = worlds[0].height - 26;
    ctx.fillStyle = "rgba(10, 12, 18, 0.72)";
    ctx.beginPath();
    ctx.roundRect(x - tw / 2 - 14, y - 19, tw + 28, 34, 17);
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.textAlign = "center";
    ctx.fillText(text, x, y + 6);
  };
  label("Darwin", DARWIN_COLOUR, mid - 90);
  label("Lamarck", LAMARCK_COLOUR, mid + 90);
}

// ─── Over time ───────────────────────────────────────────────────────────────

/**
 * Colours: each column is one moment, the blobs' colours stacked from dark (bottom) to light (top),
 * one slice each, so the ribbon shows the whole spread and how it shifts. The strip on top is the
 * background at that moment. Drawn incrementally into a 1-pixel-per-sample strip and scaled up.
 * Hiding: the average hiding time as a line, over a band from the 10th to the 90th percentile.
 */
export type HistoryLayer = { canvas: HTMLCanvasElement; drawn: number; lastT: number };

const STRIP_H = 96;
const GROUND_H = 8;

export function createHistoryLayer(): HistoryLayer {
  const canvas = document.createElement("canvas");
  canvas.width = HISTORY_LENGTH;
  canvas.height = STRIP_H + GROUND_H + 2;
  return { canvas, drawn: 0, lastT: -1 };
}

function updateHistoryLayer(layer: HistoryLayer, w: World): void {
  const ctx = layer.canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const newest = w.history.length ? w.history[w.history.length - 1].t : -1;
  if (newest < layer.lastT) {
    // The world was reset.
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.lastT = -1;
  }
  const fresh = w.history.filter((h) => h.t > layer.lastT);
  for (const h of fresh) {
    // Scroll left by one column and paint the new one at the right edge.
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(layer.canvas, -1, 0);
    ctx.globalCompositeOperation = "source-over";
    const x = layer.canvas.width - 1;
    ctx.clearRect(x, 0, 1, layer.canvas.height);
    ctx.fillStyle = h.background;
    ctx.fillRect(x, 0, 1, GROUND_H);
    const n = h.colours.length;
    h.colours.forEach((css, i) => {
      const y0 = GROUND_H + 2 + STRIP_H * (1 - (i + 1) / n);
      ctx.fillStyle = css;
      ctx.fillRect(x, y0, 1, STRIP_H / n + 0.6);
    });
    layer.lastT = h.t;
  }
}

/** Hiding time over the last two minutes: one line and band per world, on a shared axis. */
function renderHideChart(ctx: CanvasRenderingContext2D, worlds: World[], colours: string[], x: number, y: number, w: number, h: number): void {
  let top = 0;
  worlds.forEach((wd) => wd.history.forEach((s) => (top = Math.max(top, s.hideHi))));
  const max = Math.max(3, Math.ceil(top));
  const step = max <= 4 ? 1 : max <= 8 ? 2 : 4;
  const px = (i: number, n: number): number => x + w - ((n - 1 - i) * w) / (HISTORY_LENGTH - 1);
  const py = (v: number): number => y + h - (v / max) * h;
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.textAlign = "right";
  for (let v = 0; v <= max; v += step) {
    ctx.strokeStyle = "rgba(235, 232, 226, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, py(v));
    ctx.lineTo(x + w, py(v));
    ctx.stroke();
    ctx.fillStyle = "rgba(235, 232, 226, 0.7)";
    ctx.fillText(`${v} s`, x - 3, py(v) + 3.5);
  }
  worlds.forEach((wd, k) => {
    const hist = wd.history;
    const n = hist.length;
    if (n < 2) {
      return;
    }
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = colours[k];
    ctx.beginPath();
    hist.forEach((s, i) => (i === 0 ? ctx.moveTo(px(i, n), py(s.hideHi)) : ctx.lineTo(px(i, n), py(s.hideHi))));
    for (let i = n - 1; i >= 0; i -= 1) {
      ctx.lineTo(px(i, n), py(hist[i].hideLo));
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colours[k];
    ctx.lineWidth = 2;
    ctx.beginPath();
    hist.forEach((s, i) => (i === 0 ? ctx.moveTo(px(i, n), py(s.hide)) : ctx.lineTo(px(i, n), py(s.hide))));
    ctx.stroke();
  });
}

/** The key to the blobs' colours with hiding as the trait: a bar from short to long hiding times. */
function renderHideKey(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.font = "500 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(235, 232, 226, 0.9)";
  ctx.fillText("Blob colour", x, y + 9);
  const bx = x + 70;
  const bw = w - 70 - 8;
  const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  for (let i = 0; i <= 16; i += 1) {
    g.addColorStop(i / 16, labToCss(hideColour((i / 16) * HIDE_KEY_MAX)));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(bx, y, bw, 11, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.fillStyle = "rgba(235, 232, 226, 0.75)";
  for (let v = 0; v <= HIDE_KEY_MAX; v += 2) {
    const tx = bx + (v / HIDE_KEY_MAX) * bw;
    ctx.fillRect(tx - 0.5, y + 11, 1, 3);
    ctx.textAlign = v === 0 ? "left" : v === HIDE_KEY_MAX ? "right" : "center";
    ctx.fillText(v === HIDE_KEY_MAX ? `${v}+ s` : v === 0 ? "0 s" : String(v), v === HIDE_KEY_MAX ? tx + 2 : tx, y + 24);
  }
}

/**
 * The inset. Colour: one ribbon per world (two, labelled, side by side). Hiding: the key to the
 * blobs' colours, then the hiding-time chart. `layers` must hold one layer per world.
 */
export function renderHistory(ctx: CanvasRenderingContext2D, layers: HistoryLayer[], worlds: World[], hiding: boolean): void {
  const pair = worlds.length > 1;
  const colours = pair ? [DARWIN_COLOUR, LAMARCK_COLOUR] : ["#ffffff"];
  const height = historyHeight(hiding);
  ctx.clearRect(0, 0, HIST_W, height);
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(235, 232, 226, 0.9)";
  ctx.fillText(hiding ? "Hiding time" : "Colours over time", 4, 13);
  if (pair) {
    ctx.textAlign = "right";
    ctx.fillStyle = LAMARCK_COLOUR;
    ctx.fillText("Lamarck", HIST_W - 4, 13);
    const lw = ctx.measureText("Lamarck").width;
    ctx.fillStyle = DARWIN_COLOUR;
    ctx.fillText("Darwin", HIST_W - 14 - lw, 13);
  }
  const top = 20;
  if (hiding) {
    renderHideKey(ctx, 4, top + 2, HIST_W - 4);
    renderHideChart(ctx, worlds, colours, 30, top + 44, HIST_W - 36, height - top - 50);
    return;
  }
  ctx.imageSmoothingEnabled = false;
  const h = (HIST_H - top - 4 - (worlds.length - 1) * 4) / worlds.length;
  worlds.forEach((w, k) => {
    updateHistoryLayer(layers[k], w);
    const y = top + k * (h + 4);
    ctx.drawImage(layers[k].canvas, 4, y, HIST_W - 8, h);
    if (pair) {
      ctx.fillStyle = colours[k];
      ctx.fillRect(0, y, 2, h);
    }
  });
}
