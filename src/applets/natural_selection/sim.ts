import { createRng, gaussian, nextRandom, type Rng } from "../../core/seededRng";
import { clampToGamut, deltaE, hexToRgb, labToCss, mixLab, rgbToLab, type Lab } from "./color";

/**
 * Natural selection on one trait, body colour. Strawberries pop up on the ground; a blob that eats
 * one splits in two, and one copy's colour may change a little (a mutation). Fewer blobs means more
 * strawberries, which keeps the population near a target size. Predators hunt by sight: the more a
 * blob's colour differs from the ground right under it, the more likely a predator is to spot it.
 * Nothing else decides who is eaten, so over the generations the survivors' colours drift towards
 * the background's. Everything happens in screen pixels (WORLD_W × WORLD_H) and seconds.
 */

export const WORLD_W = 1280;
export const WORLD_H = 720;
export const BLOB_R = 15;
export const PREDATOR_R = 38;

/** The strawberry supply steers the population towards this size: the fewer blobs, the more fruit. */
export const TARGET_POPULATION = 100;
/** Strawberries popping up per second while short of the target: a trickle, plus more per missing blob. */
const FRUIT_TRICKLE = 0.15;
const FRUIT_PER_MISSING = 0.4;
const MAX_FRUITS = 40;
/** Uneaten strawberries rot away after this long (s). */
const FRUIT_LIFE = 25;
export const FRUIT_R = 11;
/** Blobs notice a strawberry this close and hurry over to it. */
const SMELL_RADIUS = 160;
const FORAGE_SPEED = 48;
/** Eating, swelling, then pinching in two (s). */
export const REPRO_TIME = 1.1;
/**
 * Average lifespan (s); each blob's own is up to 30% either side. Long, so that nearly every death
 * is a predator's choice: old age kills regardless of colour, which would only slow selection down.
 */
export const LIFESPAN = 600;
const LIFESPAN_SPREAD = 0.3;
/** Starting blobs and newcomers are up to this old (s): young, but not all the same age. */
const YOUNG = 40;
/** Beards start growing at this age (s) and are full by the second. */
const BEARD_FROM = 45;
const BEARD_FULL = 150;
/** Dying of old age: eyes close, then the blob fades (s). */
const OLD_AGE_FADE = 2.4;
/**
 * Crowding speeds up ageing: blobs age at (population ÷ target) times the normal rate, within
 * these limits, so they die younger on a crowded ground and live longer when there are few.
 */
const AGEING_MIN = 0.5;
const AGEING_MAX = 2;
/** When fewer than this many blobs are left, a group of newcomers wanders in from the edges. */
export const RESCUE_BELOW = 5;
export const NEWCOMERS = 30;
const ARRIVALS_PER_S = 10;
export const START_COUNT = 40;
/** How far apart (in blob radii) the two new blobs' centres end up. */
export const SPLIT_GAP = 1.15;
const BLOB_SPEED = 22;

const PREDATOR_SPEED = 230;
const PREDATOR_WANDER = 70;
/** How far a predator looks, and how often it scans for prey (s). */
const VIEW_RADIUS = 330;
const SCAN_EVERY = 0.3;
const EAT_TIME = 0.35;
const REST_TIME = 0.2;
export const MAX_PREDATORS = 7;

/**
 * Colour difference (ΔE, see color.ts) at which a blob is about two-thirds likely to be seen on one
 * look. Gentle enough that a slightly better match is a real advantage across the whole range.
 */
export const SEEN_AT = 22;

export type MutationLevel = "off" | "small" | "large";
/** Typical size of one mutation, in OKLab lightness and colour units. */
const MUTATION: Record<MutationLevel, { L: number; ab: number }> = {
  off: { L: 0, ab: 0 },
  small: { L: 0.03, ab: 0.03 },
  large: { L: 0.055, ab: 0.045 }
};

/**
 * Lamarck's idea, for comparison: during its life a blob's colour creeps towards the ground under
 * it (this fraction of the difference per second), and its offspring start from the changed colour.
 * Darwin's: a blob's colour is fixed for life. Only the second is how inheritance really works.
 */
export type Inheritance = "darwin" | "lamarck";
const LAMARCK_RATE = 0.02;

/**
 * Which trait evolves. "colour": body colour, as above. "hiding": every blob is the same colour, and
 * what varies is how long it can hide. When a predator chasing a blob gets within HIDE_TRIGGER, the
 * blob turns invisible for its hiding time (s), then needs HIDE_RECHARGE seconds before it can hide
 * again. The predator waits where it lost the blob for a random while (PATIENCE on average): if the
 * blob reappears first, it is caught; if the predator gives up first, the blob got away. Darwin: the
 * hiding time is fixed for life, and a new copy's may mutate. Lamarck: each hide is practice that
 * lengthens it by HIDE_PRACTICE, and the young inherit the practised time.
 */
export type Trait = "colour" | "hiding";
const HIDE_TRIGGER = 140;
export const HIDE_RECHARGE = 4;
export const HIDE_MAX = 12;
const HIDE_PRACTICE = 0.5;
/** Starting blobs and newcomers hide for this long, give or take HIDE_START_SPREAD (s). */
const HIDE_START = 1;
const HIDE_START_SPREAD = 0.8;
/**
 * Typical size of one hiding-time mutation (s). Large next to the starting times on purpose: with
 * little variation there is little to select, and Darwin's blobs barely change in a class period.
 */
const HIDE_MUTATION: Record<MutationLevel, number> = { off: 0, small: 0.5, large: 0.9 };
export const PATIENCE = 2;
const PATIENCE_MAX = 15;

/**
 * An asteroid. It falls for IMPACT_AT seconds; then a shockwave spreads from where it hits and
 * kills every predator and all but SURVIVORS blobs, chosen by luck, not colour. Dust darkens the
 * sky so no strawberries grow until it thins; later the predators wander back in, one at a time.
 * Times are seconds since the asteroid appeared.
 */
export const IMPACT_AT = 3;
export const SHOCK_SPEED = 900;
export const SURVIVORS = 8;
const DUST_THICK = 4.2;
const DUST_THINS = 14;
const DUST_GONE = 26;
const FRUIT_RETURNS = 18;
const PREDATORS_RETURN = 45;
const PREDATOR_RETURN_EVERY = 5;
const IMPACT_OVER = 80;
/** Killed by the impact: the blob chars and fades (s). */
const SCORCH_FADE = 1.6;
const PREDATOR_FADE = 1.2;

export type StartMix = "mixed" | "alike";
/** "All alike" starts every blob lilac, which stands out on every background. */
export const ALIKE_COLOUR = "#b48ad6";

export type Field = { sample: (x: number, y: number) => Lab; mean: Lab };

/** Cosmetic: a googly pupil's offset (in eye radii) and velocity. */
export type Googly = { x: number; y: number; vx: number; vy: number };

export type Blob = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  colour: Lab;
  css: string;
  gen: number;
  /** Eating a strawberry, swelling and splitting in two: progress 0–1, or −1. */
  repro: number;
  reproAxis: number;
  /** Where the strawberry being eaten was, relative to the blob. */
  fruitDx: number;
  fruitDy: number;
  /** Seconds since this blob came out of a split (for the little bounce). */
  born: number;
  /** Seconds alive, and how long it will live. Splitting doesn't reset the parent's age. */
  age: number;
  lifespan: number;
  /** Being swallowed: progress 0–1, or −1; and by which predator (id). */
  caught: number;
  eater: number;
  /** Dying of old age, or from the impact if `scorched`: progress 0–1, or −1. */
  dying: number;
  scorched: boolean;
  /** Seconds until the impact's shockwave reaches it, or −1. */
  doomIn: number;
  phase: number;
  eyes: Googly;
  /** A newcomer still walking in from beyond the edge. */
  entering: boolean;
  /** Inherited hiding time (s); seconds left invisible (0 when seen), out of `hideFor`; recharge left (s). */
  hide: number;
  hiding: number;
  hideFor: number;
  recharge: number;
};

export type Predator = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  /** Blob being chased (id), or −1. */
  target: number;
  scan: number;
  /** Seconds left eating, or 0; then a short rest. */
  eating: number;
  rest: number;
  /** Prey that just vanished (id, or −1), and seconds left waiting for it to reappear. */
  lost: number;
  puzzled: number;
  /** Cosmetic: how open the mouth is, 0–1. */
  mouth: number;
  phase: number;
  eye: Googly;
  /** Killed by the impact: countdown to the shockwave (or −1), then fading 0–1 (or −1). */
  doomIn: number;
  dying: number;
};

export type Fruit = { id: number; x: number; y: number; age: number };

/** One moment: blob colours (dark to light), the ground, and the hiding times' mean and 10–90% range. */
export type HistorySample = { t: number; colours: string[]; background: string; hide: number; hideLo: number; hideHi: number };

export type Settings = { predators: number; mutation: MutationLevel; inheritance?: Inheritance; trait?: Trait };

/** An asteroid on its way, or its aftermath: seconds since it appeared, and where it hits. */
export type Impact = { t: number; x: number; y: number; struck: boolean };

export type World = {
  /**
   * Size of the ground (px). A narrower world (one half of a side-by-side comparison) is the middle
   * strip of the ground, with blob, predator and strawberry numbers scaled to its area.
   */
  width: number;
  height: number;
  /** Population the strawberry supply steers towards. */
  target: number;
  t: number;
  rng: Rng;
  nextId: number;
  blobs: Blob[];
  predators: Predator[];
  fruits: Fruit[];
  eaten: number;
  born: number;
  history: HistorySample[];
  sinceSample: number;
  field: Field;
  settings: Settings;
  /** Colours of the first blobs, and of any newcomers. */
  mix: StartMix;
  /** Newcomers still to arrive. */
  arriving: number;
  impact: Impact | null;
};

/** How likely a predator is to notice a blob on one look: 0 (invisible) to 1 (glaring). */
export function visibility(colour: Lab, ground: Lab): number {
  const d = deltaE(colour, ground);
  return 1 - Math.exp(-((d / SEEN_AT) ** 2));
}

export function uniformField(colour: Lab): Field {
  return { sample: () => colour, mean: colour };
}

/** The middle strip of a full-width ground, `width` wide, for a narrower world. */
export function middleStrip(field: Field, width: number): Field {
  const dx = (WORLD_W - width) / 2;
  return { sample: (x, y) => field.sample(x + dx, y), mean: field.mean };
}

/** A count meant for the full ground, scaled to this world's area (at least 1). */
function scaled(w: World, n: number): number {
  return Math.max(1, Math.round((n * w.width * w.height) / (WORLD_W * WORLD_H)));
}

const HISTORY_EVERY = 0.5;
/** Two minutes of history. */
export const HISTORY_LENGTH = 240;

function makeBlob(w: World, x: number, y: number, colour: Lab, gen: number, hide: number): Blob {
  const c = clampToGamut(colour);
  const heading = nextRandom(w.rng) * Math.PI * 2;
  return {
    id: w.nextId++,
    x,
    y,
    vx: Math.cos(heading) * BLOB_SPEED,
    vy: Math.sin(heading) * BLOB_SPEED,
    heading,
    colour: c,
    css: labToCss(c),
    gen,
    repro: -1,
    reproAxis: 0,
    fruitDx: 0,
    fruitDy: 0,
    born: 10,
    age: 0,
    lifespan: LIFESPAN * (1 + LIFESPAN_SPREAD * (2 * nextRandom(w.rng) - 1)),
    caught: -1,
    eater: -1,
    dying: -1,
    scorched: false,
    doomIn: -1,
    phase: nextRandom(w.rng) * Math.PI * 2,
    eyes: { x: 0, y: 0, vx: 0, vy: 0 },
    entering: false,
    hide: Math.min(HIDE_MAX, Math.max(0, hide)),
    hiding: 0,
    hideFor: 0,
    recharge: 0
  };
}

function makePredator(w: World): Predator {
  const side = Math.floor(nextRandom(w.rng) * 4);
  const u = nextRandom(w.rng);
  const x = side === 0 ? -PREDATOR_R : side === 1 ? w.width + PREDATOR_R : u * w.width;
  const y = side === 2 ? -PREDATOR_R : side === 3 ? w.height + PREDATOR_R : u * w.height;
  return {
    id: w.nextId++,
    x,
    y,
    vx: 0,
    vy: 0,
    heading: Math.atan2(w.height / 2 - y, w.width / 2 - x),
    target: -1,
    scan: nextRandom(w.rng) * SCAN_EVERY,
    eating: 0,
    rest: 0,
    lost: -1,
    puzzled: 0,
    mouth: 0,
    phase: nextRandom(w.rng) * Math.PI * 2,
    eye: { x: 0, y: 0, vx: 0, vy: 0 },
    doomIn: -1,
    dying: -1
  };
}

function startColour(rng: Rng, mix: StartMix): Lab {
  if (mix === "alike") {
    const base = rgbToLab(hexToRgb(ALIKE_COLOUR));
    return { L: base.L + 0.004 * gaussian(rng), a: base.a + 0.003 * gaussian(rng), b: base.b + 0.003 * gaussian(rng) };
  }
  // Every hue, from muted to vivid, light to fairly dark.
  const hue = nextRandom(rng) * Math.PI * 2;
  const chroma = 0.03 + 0.14 * nextRandom(rng);
  return { L: 0.4 + 0.47 * nextRandom(rng), a: chroma * Math.cos(hue), b: chroma * Math.sin(hue) };
}

/** Starting blobs and newcomers are poor hiders, but not all equally poor. */
function startHide(rng: Rng): number {
  return HIDE_START + HIDE_START_SPREAD * (2 * nextRandom(rng) - 1);
}

/** `width` below WORLD_W makes a narrower world: the middle strip of the ground (see World). */
export function createWorld(field: Field, settings: Settings, mix: StartMix = "mixed", seed = 1, width = WORLD_W): World {
  const w: World = {
    width,
    height: WORLD_H,
    target: TARGET_POPULATION,
    t: 0,
    rng: createRng(seed),
    nextId: 1,
    blobs: [],
    predators: [],
    fruits: [],
    eaten: 0,
    born: 0,
    history: [],
    sinceSample: HISTORY_EVERY,
    field,
    settings: { ...settings },
    mix,
    arriving: 0,
    impact: null
  };
  w.target = scaled(w, TARGET_POPULATION);
  const start = scaled(w, START_COUNT);
  for (let k = 0; k < start; k += 1) {
    const x = BLOB_R + nextRandom(w.rng) * (w.width - 2 * BLOB_R);
    const y = BLOB_R + nextRandom(w.rng) * (w.height - 2 * BLOB_R);
    const b = makeBlob(w, x, y, startColour(w.rng, mix), 0, startHide(w.rng));
    // Young, but not all the same age, so the first generation doesn't die all at once.
    b.age = YOUNG * nextRandom(w.rng);
    w.blobs.push(b);
  }
  syncPredators(w);
  return w;
}

/** Blobs that are alive and not already being eaten or dying. */
export function living(w: World): Blob[] {
  return w.blobs.filter((b) => b.caught < 0 && b.dying < 0);
}

/** How grown a blob's beard is: 0 (none) to 1 (full). */
export function beardOf(b: Blob): number {
  return Math.min(1, Math.max(0, (b.age - BEARD_FROM) / (BEARD_FULL - BEARD_FROM)));
}

/** How many predators there should be: the setting, except after an asteroid. */
function predatorsWanted(w: World): number {
  const n = Math.max(0, Math.min(MAX_PREDATORS, Math.round(w.settings.predators)));
  const want = n > 0 ? scaled(w, n) : 0;
  const im = w.impact;
  if (!im || !im.struck) {
    return want;
  }
  return im.t < PREDATORS_RETURN ? 0 : Math.min(want, 1 + Math.floor((im.t - PREDATORS_RETURN) / PREDATOR_RETURN_EVERY));
}

function syncPredators(w: World): void {
  const want = predatorsWanted(w);
  // Predators killed by an asteroid finish fading out on their own.
  const active = w.predators.filter((p) => p.doomIn < 0 && p.dying < 0);
  for (let k = active.length; k < want; k += 1) {
    w.predators.push(makePredator(w));
  }
  if (active.length > want) {
    const gone = new Set(active.slice(want));
    w.predators = w.predators.filter((p) => !gone.has(p));
  }
}

/** Send an asteroid (ignored while one is already under way). */
export function launchAsteroid(w: World): void {
  if (w.impact) {
    return;
  }
  w.impact = {
    t: 0,
    // Right of centre, clear of the controls panel.
    x: w.width * (w.width < WORLD_W ? 0.3 + 0.4 * nextRandom(w.rng) : 0.42 + 0.33 * nextRandom(w.rng)),
    y: w.height * (0.35 + 0.3 * nextRandom(w.rng)),
    struck: false
  };
}

/** How thick the asteroid's dust is: 0 (clear sky) to 1. */
export function dustOf(w: World): number {
  const im = w.impact;
  if (!im || !im.struck) {
    return 0;
  }
  if (im.t < DUST_THINS) {
    return Math.min(1, (im.t - IMPACT_AT) / (DUST_THICK - IMPACT_AT));
  }
  return Math.max(0, 1 - (im.t - DUST_THINS) / (DUST_GONE - DUST_THINS));
}

function stepImpact(w: World, dt: number): void {
  const im = w.impact;
  if (!im) {
    return;
  }
  im.t += dt;
  if (!im.struck && im.t >= IMPACT_AT) {
    im.struck = true;
    // Who survives is down to luck: a few at random, whatever their colour.
    const alive = living(w);
    for (let k = alive.length - 1; k > 0; k -= 1) {
      const j = Math.floor(nextRandom(w.rng) * (k + 1));
      [alive[k], alive[j]] = [alive[j], alive[k]];
    }
    alive.slice(scaled(w, SURVIVORS)).forEach((b) => {
      b.doomIn = Math.hypot(b.x - im.x, b.y - im.y) / SHOCK_SPEED;
    });
    w.predators.forEach((p) => {
      p.doomIn = Math.hypot(p.x - im.x, p.y - im.y) / SHOCK_SPEED;
      p.target = -1;
    });
    // The strawberries wither in the dark.
    w.fruits.forEach((f) => {
      f.age = Math.max(f.age, FRUIT_LIFE - 2);
    });
  }
  if (im.t >= IMPACT_OVER) {
    w.impact = null;
  }
}

function mutate(w: World, c: Lab): Lab {
  const m = MUTATION[w.settings.mutation];
  return { L: c.L + m.L * gaussian(w.rng), a: c.a + m.ab * gaussian(w.rng), b: c.b + m.ab * gaussian(w.rng) };
}

function mutateHide(w: World, hide: number): number {
  return hide + HIDE_MUTATION[w.settings.mutation] * gaussian(w.rng);
}

/** Cosmetic googly physics: the pupil lags behind the body's acceleration, then wobbles back. */
function wobble(eye: Googly, ax: number, ay: number, dt: number): void {
  const k = 60;
  const damp = 5;
  eye.vx += (-k * eye.x - damp * eye.vx - 0.012 * ax) * dt;
  eye.vy += (-k * eye.y - damp * eye.vy - 0.012 * ay + 2.5) * dt;
  eye.x += eye.vx * dt;
  eye.y += eye.vy * dt;
  const r = Math.hypot(eye.x, eye.y);
  if (r > 0.55) {
    eye.x *= 0.55 / r;
    eye.y *= 0.55 / r;
    eye.vx *= -0.4;
    eye.vy *= -0.4;
  }
}

function nearestFruit(w: World, b: Blob): { fruit: Fruit; d: number } | null {
  let best: Fruit | null = null;
  let bestD = SMELL_RADIUS;
  for (const f of w.fruits) {
    const d = Math.hypot(f.x - b.x, f.y - b.y);
    if (d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best ? { fruit: best, d: bestD } : null;
}

function stepBlobs(w: World, dt: number): void {
  const rng = w.rng;
  const born: Blob[] = [];
  const eatenFruit = new Set<number>();
  const ageing = Math.min(AGEING_MAX, Math.max(AGEING_MIN, living(w).length / w.target));
  const lamarck = w.settings.inheritance === "lamarck";
  const colourEvolves = w.settings.trait !== "hiding";
  for (const b of w.blobs) {
    b.born += dt;
    if (b.caught >= 0) {
      continue;
    }
    if (b.doomIn >= 0 && b.dying < 0) {
      b.doomIn -= dt;
      if (b.doomIn < 0) {
        b.doomIn = -1;
        b.dying = 0;
        b.scorched = true;
        b.repro = -1;
      }
    }
    if (b.dying >= 0) {
      b.dying += dt / (b.scorched ? SCORCH_FADE : OLD_AGE_FADE);
      continue;
    }
    b.age += dt * ageing;
    if (b.hiding > 0) {
      b.hiding = Math.max(0, b.hiding - dt);
      if (b.hiding === 0) {
        b.recharge = HIDE_RECHARGE;
        if (lamarck) {
          // Lamarck: practice makes a better hider, and the young inherit what was practised.
          b.hide = Math.min(HIDE_MAX, b.hide + HIDE_PRACTICE);
        }
      }
    } else {
      b.recharge = Math.max(0, b.recharge - dt);
    }
    if (b.entering) {
      // Walk straight in until fully on the ground.
      b.x += Math.cos(b.heading) * FORAGE_SPEED * dt;
      b.y += Math.sin(b.heading) * FORAGE_SPEED * dt;
      b.entering = b.x < BLOB_R || b.x > w.width - BLOB_R || b.y < BLOB_R || b.y > w.height - BLOB_R;
      continue;
    }
    // Head for a strawberry it can smell, or else wander on a slowly turning heading.
    const food = b.repro < 0 ? nearestFruit(w, b) : null;
    let speed = BLOB_SPEED;
    if (food && !eatenFruit.has(food.fruit.id)) {
      let turn = Math.atan2(food.fruit.y - b.y, food.fruit.x - b.x) - b.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      b.heading += Math.max(-5 * dt, Math.min(5 * dt, turn));
      speed = FORAGE_SPEED;
      if (food.d < BLOB_R + FRUIT_R) {
        // Eat it, then split in two.
        eatenFruit.add(food.fruit.id);
        b.repro = 0;
        b.reproAxis = nextRandom(rng) * Math.PI * 2;
        b.fruitDx = food.fruit.x - b.x;
        b.fruitDy = food.fruit.y - b.y;
      }
    } else {
      b.heading += 1.4 * gaussian(rng) * Math.sqrt(dt);
    }
    const vx = Math.cos(b.heading) * speed;
    const vy = Math.sin(b.heading) * speed;
    wobble(b.eyes, (vx - b.vx) / dt, (vy - b.vy) / dt, dt);
    b.vx = vx;
    b.vy = vy;
    if (b.repro < 0) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    if (b.x < BLOB_R || b.x > w.width - BLOB_R) {
      b.heading = Math.PI - b.heading;
      b.x = Math.min(w.width - BLOB_R, Math.max(BLOB_R, b.x));
    }
    if (b.y < BLOB_R || b.y > w.height - BLOB_R) {
      b.heading = -b.heading;
      b.y = Math.min(w.height - BLOB_R, Math.max(BLOB_R, b.y));
    }
    if (lamarck && colourEvolves) {
      b.colour = mixLab(b.colour, w.field.sample(b.x, b.y), 1 - Math.exp(-LAMARCK_RATE * dt));
      b.css = labToCss(b.colour);
    }
    if (b.repro >= 0) {
      b.repro += dt / REPRO_TIME;
      if (b.repro >= 1) {
        // Two blobs where there was one; the new one may carry mutations, in colour and in hiding time.
        const ax = Math.cos(b.reproAxis);
        const ay = Math.sin(b.reproAxis);
        const gap = SPLIT_GAP * BLOB_R;
        const child = makeBlob(w, b.x + ax * gap, b.y + ay * gap, colourEvolves ? mutate(w, b.colour) : b.colour, b.gen + 1, mutateHide(w, b.hide));
        child.heading = b.reproAxis;
        child.born = 0;
        b.x -= ax * gap;
        b.y -= ay * gap;
        b.heading = b.reproAxis + Math.PI;
        b.gen += 1;
        b.repro = -1;
        b.born = 0;
        born.push(child);
      }
      continue;
    }
    // With hiding as the trait only predators (and asteroids) kill, so every death is selection.
    if (b.age >= b.lifespan && colourEvolves) {
      b.dying = 0;
    }
  }
  w.blobs.push(...born);
  w.born += born.length;
  w.blobs = w.blobs.filter((b) => b.dying < 1 && b.caught < 1);
  if (eatenFruit.size > 0) {
    w.fruits = w.fruits.filter((f) => !eatenFruit.has(f.id));
  }
}

/** Near extinction, a group of newcomers of the starting mix wanders in from the edges. */
function stepArrivals(w: World, dt: number): void {
  if (w.arriving === 0 && !w.impact && living(w).length < scaled(w, RESCUE_BELOW)) {
    w.arriving = scaled(w, NEWCOMERS);
  }
  if (w.arriving === 0 || nextRandom(w.rng) >= ARRIVALS_PER_S * dt) {
    return;
  }
  w.arriving -= 1;
  const side = Math.floor(nextRandom(w.rng) * 4);
  const u = 0.1 + 0.8 * nextRandom(w.rng);
  const x = side === 0 ? -BLOB_R : side === 1 ? w.width + BLOB_R : u * w.width;
  const y = side === 2 ? -BLOB_R : side === 3 ? w.height + BLOB_R : u * w.height;
  const b = makeBlob(w, x, y, startColour(w.rng, w.mix), 0, startHide(w.rng));
  b.heading = [0, Math.PI, Math.PI / 2, -Math.PI / 2][side] + 0.8 * (nextRandom(w.rng) - 0.5);
  b.age = YOUNG * nextRandom(w.rng);
  b.entering = true;
  w.blobs.push(b);
}

/** Strawberries pop up at random, more of them the further the population is below its target. */
function stepFruit(w: World, dt: number): void {
  // Strawberries already on the ground count as blobs to come, so the supply doesn't overshoot.
  const missing = Math.max(0, w.target - living(w).length - w.fruits.length);
  const dark = w.impact !== null && w.impact.struck && w.impact.t < FRUIT_RETURNS;
  const rate = missing > 0 && !dark ? FRUIT_TRICKLE + FRUIT_PER_MISSING * missing : 0;
  if (w.fruits.length < scaled(w, MAX_FRUITS) && nextRandom(w.rng) < rate * dt) {
    // On clear ground, so each strawberry is seen before it is eaten; skip it if the ground is crowded.
    const m = 3 * FRUIT_R;
    const clear = BLOB_R + FRUIT_R + 6;
    for (let k = 0; k < 6; k += 1) {
      const x = m + nextRandom(w.rng) * (w.width - 2 * m);
      const y = m + nextRandom(w.rng) * (w.height - 2 * m);
      if (!w.blobs.some((b) => Math.hypot(b.x - x, b.y - y) < clear)) {
        w.fruits.push({ id: w.nextId++, x, y, age: 0 });
        break;
      }
    }
  }
  w.fruits.forEach((f) => {
    f.age += dt;
  });
  w.fruits = w.fruits.filter((f) => f.age < FRUIT_LIFE);
}

function stepPredators(w: World, dt: number): void {
  const rng = w.rng;
  const hiding = w.settings.trait === "hiding";
  const byId = new Map(w.blobs.map((b) => [b.id, b]));
  w.predators.forEach((p) => {
    p.phase += dt;
    let speed = PREDATOR_WANDER;
    let goal: number | null = null;
    if (p.doomIn >= 0 || p.dying >= 0) {
      // Hit by the impact: stops hunting, then (once the shockwave arrives) fades away.
      if (p.dying < 0) {
        p.doomIn -= dt;
        if (p.doomIn < 0) {
          p.doomIn = -1;
          p.dying = 0;
        }
      } else {
        p.dying += dt / PREDATOR_FADE;
      }
      p.target = -1;
      speed = 0.3 * PREDATOR_WANDER;
    } else if (p.eating > 0) {
      p.eating = Math.max(0, p.eating - dt);
      if (p.eating === 0) {
        p.rest = REST_TIME;
      }
      speed = 0;
    } else if (p.puzzled > 0) {
      // Waiting where its prey vanished: if the blob shows itself again in time, it's caught.
      p.puzzled = Math.max(0, p.puzzled - dt);
      const lost = byId.get(p.lost);
      if (lost && lost.hiding === 0 && lost.caught < 0 && lost.dying < 0 && Math.hypot(lost.x - p.x, lost.y - p.y) < VIEW_RADIUS) {
        p.target = lost.id;
        p.puzzled = 0;
      }
      if (p.puzzled === 0) {
        p.lost = -1;
      }
      speed = 0.25 * PREDATOR_WANDER;
    } else if (p.rest > 0) {
      p.rest = Math.max(0, p.rest - dt);
      speed = 0.3 * PREDATOR_WANDER;
    } else {
      const target = p.target >= 0 ? byId.get(p.target) : undefined;
      if (
        !target ||
        target.caught >= 0 ||
        target.dying >= 0 ||
        target.hiding > 0 ||
        Math.hypot(target.x - p.x, target.y - p.y) > 1.6 * VIEW_RADIUS
      ) {
        p.target = -1;
      }
      p.scan -= dt;
      if (p.target < 0 && p.scan <= 0) {
        // One look around: each blob in view is noticed with a chance set by how much it stands out,
        // and of those noticed it goes for the most conspicuous (a bit nearer is a bit better).
        p.scan = SCAN_EVERY;
        let best: Blob | null = null;
        let bestScore = -Infinity;
        for (const b of w.blobs) {
          if (b.caught >= 0 || b.dying >= 0 || b.entering || b.hiding > 0) {
            continue;
          }
          const d = Math.hypot(b.x - p.x, b.y - p.y);
          if (d > VIEW_RADIUS) {
            continue;
          }
          const v = visibility(b.colour, w.field.sample(b.x, b.y));
          const score = v - 0.15 * (d / VIEW_RADIUS);
          if (nextRandom(rng) < v * (1 - 0.5 * (d / VIEW_RADIUS)) && score > bestScore) {
            best = b;
            bestScore = score;
          }
        }
        if (best) {
          p.target = best.id;
        }
      }
      const chase = p.target >= 0 ? byId.get(p.target) : undefined;
      const gap = chase ? Math.hypot(chase.x - p.x, chase.y - p.y) : Infinity;
      if (chase && hiding && gap < HIDE_TRIGGER && chase.recharge === 0 && chase.hide > 0) {
        // The blob sees the predator coming and turns invisible: the predator loses it.
        chase.hiding = chase.hide;
        chase.hideFor = chase.hide;
        p.target = -1;
        p.lost = chase.id;
        p.puzzled = Math.min(PATIENCE_MAX, -PATIENCE * Math.log(1 - nextRandom(rng)));
      } else if (chase) {
        goal = Math.atan2(chase.y - p.y, chase.x - p.x);
        speed = PREDATOR_SPEED;
        if (gap < PREDATOR_R + 0.4 * BLOB_R) {
          chase.caught = 0;
          chase.eater = p.id;
          p.target = -1;
          p.eating = EAT_TIME;
          w.eaten += 1;
        }
      }
    }
    if (goal === null) {
      // Roam the whole ground, turning back only at its very edge (no safe corners for the blobs).
      p.heading += 0.9 * gaussian(rng) * Math.sqrt(dt);
      const m = 0.6 * PREDATOR_R;
      if (p.x < m || p.x > w.width - m || p.y < m || p.y > w.height - m) {
        goal = Math.atan2(w.height / 2 - p.y, w.width / 2 - p.x);
      }
    }
    if (goal !== null) {
      let d = goal - p.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.heading += Math.max(-6 * dt, Math.min(6 * dt, d));
    }
    const vx = Math.cos(p.heading) * speed;
    const vy = Math.sin(p.heading) * speed;
    wobble(p.eye, (vx - p.vx) / dt, (vy - p.vy) / dt, dt);
    p.vx = vx;
    p.vy = vy;
    p.x += vx * dt;
    p.y += vy * dt;
    const chasing = p.target >= 0;
    p.mouth += ((p.eating > 0 ? 0.6 + 0.4 * Math.abs(Math.sin(p.phase * 14)) : chasing ? 0.75 : 0.12) - p.mouth) * Math.min(1, dt * 10);
  });
  w.predators = w.predators.filter((p) => p.dying < 1);
  // Swallowed blobs slide into the mouth and vanish.
  const predatorById = new Map(w.predators.map((p) => [p.id, p]));
  for (const b of w.blobs) {
    if (b.caught < 0) {
      continue;
    }
    const p = predatorById.get(b.eater);
    if (!p) {
      b.caught = -1;
      continue;
    }
    b.caught += dt / (0.8 * EAT_TIME);
    const mx = p.x + Math.cos(p.heading) * PREDATOR_R * 0.55;
    const my = p.y + Math.sin(p.heading) * PREDATOR_R * 0.55;
    b.x += (mx - b.x) * Math.min(1, dt * 12);
    b.y += (my - b.y) * Math.min(1, dt * 12);
  }
}

function sampleHistory(w: World): void {
  const alive = living(w);
  const colours = alive
    .slice()
    .sort((p, q) => p.colour.L - q.colour.L)
    .map((b) => b.css);
  const hides = alive.map((b) => b.hide).sort((p, q) => p - q);
  const at = (f: number): number => (hides.length ? hides[Math.min(hides.length - 1, Math.floor(f * hides.length))] : 0);
  w.history.push({ t: w.t, colours, background: labToCss(w.field.mean), hide: meanHide(w), hideLo: at(0.1), hideHi: at(0.9) });
  if (w.history.length > HISTORY_LENGTH) {
    w.history.shift();
  }
}

/** Advance by `dt` seconds. */
export function stepWorld(w: World, dt: number): void {
  let left = Math.max(0, dt);
  while (left > 1e-9) {
    const h = Math.min(1 / 30, left);
    stepImpact(w, h);
    syncPredators(w);
    stepArrivals(w, h);
    stepFruit(w, h);
    stepBlobs(w, h);
    stepPredators(w, h);
    w.t += h;
    w.sinceSample += h;
    if (w.sinceSample >= HISTORY_EVERY) {
      w.sinceSample = 0;
      sampleHistory(w);
    }
    left -= h;
  }
}

/** Average colour of the living blobs (null when there are none). */
export function meanColour(w: World): Lab | null {
  const alive = living(w);
  if (alive.length === 0) {
    return null;
  }
  const s = alive.reduce((acc, b) => ({ L: acc.L + b.colour.L, a: acc.a + b.colour.a, b: acc.b + b.colour.b }), { L: 0, a: 0, b: 0 });
  return { L: s.L / alive.length, a: s.a / alive.length, b: s.b / alive.length };
}

/** Average inherited hiding time of the living blobs (s; 0 when there are none). */
export function meanHide(w: World): number {
  const alive = living(w);
  return alive.length ? alive.reduce((s, b) => s + b.hide, 0) / alive.length : 0;
}

export type Stats = {
  population: number;
  eaten: number;
  /** Average number of splits back to the first blobs. */
  generations: number;
  /** Share of blobs that a predator would usually miss (visibility below 0.3). */
  hidden: number;
  /** How far the average blob's colour is from the ground under it (ΔE). */
  mismatch: number;
  /** Average hiding time (s). */
  hideTime: number;
};

export function stats(w: World): Stats {
  const alive = living(w);
  if (alive.length === 0) {
    return { population: 0, eaten: w.eaten, generations: 0, hidden: 0, mismatch: 0, hideTime: 0 };
  }
  let hidden = 0;
  let mismatch = 0;
  let gen = 0;
  for (const b of alive) {
    const ground = w.field.sample(b.x, b.y);
    hidden += visibility(b.colour, ground) < 0.3 ? 1 : 0;
    mismatch += deltaE(b.colour, ground);
    gen += b.gen;
  }
  return {
    population: alive.length,
    eaten: w.eaten,
    generations: gen / alive.length,
    hidden: hidden / alive.length,
    mismatch: mismatch / alive.length,
    hideTime: meanHide(w)
  };
}
