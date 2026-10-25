import { useEffect, useRef, useState } from "react";
import { setLogicalTransform } from "../../core/canvasScale";
import { AppletHostAdapter } from "../../core/host";
import { AppletStage } from "../../ui/stage/AppletStage";
import { useCanvasBackingStore } from "../../ui/stage/hooks";
import {
  StageDivider,
  StageHero,
  StageIconButton,
  StagePillButton,
  StagePills,
  StageReadout,
  StageSegmented,
  StageSlider,
  StageToggle
} from "../../ui/stage/StageControls";
import { DEFAULT_PLAIN, photoById, photoField, PHOTOS, type BackgroundId, type PhotoId } from "./backgrounds";
import { hexToRgb, rgbToLab } from "./color";
import {
  createHistoryLayer,
  DARWIN_COLOUR,
  HIST_H,
  HIST_W,
  LAMARCK_COLOUR,
  renderHistory,
  renderScene,
  renderSideBySide,
  type Ground,
  type HistoryLayer
} from "./render";
import {
  createWorld,
  HIDE_RECHARGE,
  launchAsteroid,
  MAX_PREDATORS,
  middleStrip,
  PATIENCE,
  stats,
  stepWorld,
  uniformField,
  WORLD_H,
  WORLD_W,
  type Field,
  type Inheritance,
  type MutationLevel,
  type Settings,
  type StartMix,
  type Stats,
  type Trait,
  type World
} from "./sim";
import "./naturalSelection.css";

type Props = {
  host?: AppletHostAdapter;
};

const TIP = {
  play: "Start or pause.",
  reset: "Start again with a fresh population.",
  speed: "How fast time runs.",
  background: "The ground the blobs live on. Change it while it runs and watch the colours follow.",
  plain: "Pick any colour for the ground.",
  predators: "How many hungry predators roam the ground. They spot blobs whose colour stands out from the ground under them.",
  mutation: "When a blob splits, the new copy's trait (colour, or hiding time) can change a little (small) or a lot (large), at random.",
  trait:
    "Which trait varies and is passed on. Colour: blobs that blend in with the ground are spotted less. Hiding: every blob is the same colour, but some can turn invisible for longer when a predator closes in. Switching starts again.",
  view: "One ground, or Darwin and Lamarck side by side: the same starting blobs on the same strip of ground, so you can compare. Switching starts again.",
  start: "Colours of the first blobs, used when you restart: every colour, or all the same lilac.",
  inheritance:
    "Darwin: a blob's trait is fixed for life, and its young inherit what it was born with. Lamarck: blobs change during life (turning the ground's colour, or hiding for longer after each hide) and pass the change on. Lamarck's idea is not how inheritance works.",
  asteroid: "An asteroid hits: most blobs and every predator die, then dust blocks out the sun for a while.",
  standOut: "Rings round the blobs a predator is most likely to spot.",
  population: "Blobs alive now. More strawberries grow when there are fewer blobs, which keeps them near 100.",
  hidden: "Blobs that blend in well enough that a predator would usually miss them.",
  eaten: "Blobs eaten so far.",
  generations: "Average number of splits since the first blobs.",
  hideTime: "How long the average blob can stay invisible when a predator closes in.",
  pairHide: "Average hiding time on each side.",
  pairHidden: "Blobs that blend in well enough that a predator would usually miss them, on each side.",
  pairEaten: "Blobs eaten so far on each side."
} as const;

const SPEEDS = [
  { value: 0.5, label: "½×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 4, label: "4×" }
];

const MUTATIONS: { value: MutationLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "small", label: "Small" },
  { value: "large", label: "Large" }
];

const INHERITANCE: { value: Inheritance; label: string }[] = [
  { value: "darwin", label: "Darwin" },
  { value: "lamarck", label: "Lamarck" }
];

const TRAITS: { value: Trait; label: string }[] = [
  { value: "colour", label: "Colour" },
  { value: "hiding", label: "Hiding" }
];

type View = "one" | "pair";
const VIEWS: { value: View; label: string }[] = [
  { value: "one", label: "One ground" },
  { value: "pair", label: "Darwin vs Lamarck" }
];
/** Each half of the side-by-side view. */
const HALF_W = WORLD_W / 2;

const START_MIXES: { value: StartMix; label: string }[] = [
  { value: "mixed", label: "Every colour" },
  { value: "alike", label: "All alike" }
];

const ASSETS = `${import.meta.env.BASE_URL ?? "/"}natural_selection/`;

function fieldFor(background: BackgroundId, plain: string): Field {
  return background === "plain" ? uniformField(rgbToLab(hexToRgb(plain))) : photoField(photoById(background));
}

/** Side by side, the left world is Darwin's and the right Lamarck's, whatever the switch says. */
function settingsFor(view: View, k: number, s: Settings): Settings {
  return view === "pair" ? { ...s, inheritance: k === 0 ? "darwin" : "lamarck" } : s;
}

/** One world, or two half-width ones started from the same seed (so the same blobs). */
function makeWorlds(view: View, field: Field, s: Settings, mix: StartMix, seed: number): World[] {
  if (view === "one") {
    return [createWorld(field, s, mix, seed)];
  }
  const strip = middleStrip(field, HALF_W);
  return [0, 1].map((k) => createWorld(strip, settingsFor(view, k, s), mix, seed, HALF_W));
}

function fmtHide(s: Stats): string {
  return `${s.hideTime.toFixed(1)} s`;
}

export function NaturalSelectionCanvas({ host }: Props): JSX.Element {
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const histRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = host?.readReducedMotion?.() ?? false;

  const [background, setBackground] = useState<BackgroundId>("oklahoma");
  const [plain, setPlain] = useState(DEFAULT_PLAIN);
  const [predators, setPredators] = useState(5);
  const [mutation, setMutation] = useState<MutationLevel>("small");
  const [mix, setMix] = useState<StartMix>("mixed");
  const [inheritance, setInheritance] = useState<Inheritance>("darwin");
  const [trait, setTrait] = useState<Trait>("colour");
  const [view, setView] = useState<View>("one");
  const [impacting, setImpacting] = useState(false);
  const [standOut, setStandOut] = useState(false);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(reducedMotion ? 1 : 2);
  const [snaps, setSnaps] = useState<Stats[]>([]);

  const worlds = useRef<World[]>(makeWorlds("one", fieldFor("oklahoma", DEFAULT_PLAIN), { predators: 5, mutation: "small" }, "mixed", 1));
  const images = useRef<Partial<Record<PhotoId, HTMLImageElement>>>({});
  const history = useRef<HistoryLayer[]>([]);

  useCanvasBackingStore([histRef]);

  // Changing the ground or the settings acts on the running population.
  useEffect(() => {
    const field = fieldFor(background, plain);
    worlds.current.forEach((w) => {
      w.field = w.width < WORLD_W ? middleStrip(field, w.width) : field;
    });
  }, [background, plain]);
  useEffect(() => {
    worlds.current.forEach((w, k) => {
      w.settings = settingsFor(view, k, { predators, mutation, inheritance, trait });
    });
  }, [predators, mutation, inheritance, trait, view]);

  function imageFor(id: PhotoId): HTMLImageElement {
    let img = images.current[id];
    if (!img) {
      img = new Image();
      img.decoding = "async";
      img.src = `${ASSETS}${photoById(id).image}`;
      images.current[id] = img;
    }
    return img;
  }

  useEffect(() => {
    const sctx = sceneRef.current?.getContext("2d");
    if (!sctx) {
      return;
    }
    if (history.current.length === 0) {
      history.current = [createHistoryLayer(), createHistoryLayer()];
    }
    const photo = background === "plain" ? null : photoById(background);
    const ground: Ground = { image: photo ? imageFor(photo.id) : null, colour: photo ? photo.mean : plain };
    let last = performance.now();
    let lastUi = -Infinity;
    let clock = 0;
    let raf = 0;
    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (running) {
        clock += dt;
        worlds.current.forEach((w) => stepWorld(w, dt * speed));
      }
      setLogicalTransform(sctx, WORLD_W);
      if (worlds.current.length > 1) {
        renderSideBySide(sctx, worlds.current, ground, clock, standOut);
      } else {
        renderScene(sctx, worlds.current[0], ground, clock, standOut);
      }
      const hctx = histRef.current?.getContext("2d");
      if (hctx) {
        setLogicalTransform(hctx, HIST_W);
        renderHistory(hctx, history.current, worlds.current, worlds.current[0].settings.trait === "hiding");
      }
      if (now - lastUi > 200) {
        lastUi = now;
        setSnaps(worlds.current.map(stats));
        setImpacting(worlds.current.some((w) => w.impact !== null));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, standOut, background, plain]);

  function restart(nextView: View, nextTrait: Trait): void {
    // With hiding as the trait, every blob starts the same colour, so only hiding time varies.
    const startMix = nextTrait === "hiding" ? "alike" : mix;
    const s: Settings = { predators, mutation, inheritance, trait: nextTrait };
    worlds.current = makeWorlds(nextView, fieldFor(background, plain), s, startMix, 1 + Math.floor(Math.random() * 1e6));
    setSnaps(worlds.current.map(stats));
    setRunning(false);
  }

  function onReset(): void {
    restart(view, trait);
    host?.onResult?.({ event: "reset" });
  }

  function onView(next: View): void {
    setView(next);
    restart(next, trait);
    host?.onResult?.({ event: "view", view: next });
  }

  function onTrait(next: Trait): void {
    setTrait(next);
    restart(view, next);
    host?.onResult?.({ event: "trait", trait: next });
  }

  function onAsteroid(): void {
    worlds.current.forEach(launchAsteroid);
    setImpacting(true);
    setRunning(true);
    host?.onResult?.({ event: "asteroid" });
  }

  const toolbar = (
    <>
      <StageIconButton icon={running ? "pause" : "play"} label={running ? "Pause" : "Start"} tip={TIP.play} onClick={() => setRunning((r) => !r)} />
      <StageIconButton icon="reset" label="Restart" tip={TIP.reset} onClick={onReset} />
      <StageDivider />
      <StageSegmented ariaLabel="Speed" tip={TIP.speed} value={speed} options={SPEEDS} onChange={setSpeed} />
      <StageDivider />
      <StageSegmented ariaLabel="View" tip={TIP.view} value={view} options={VIEWS} onChange={onView} />
    </>
  );

  const controls = (
    <>
      <div className="stage-field" data-hover-help={TIP.background}>
        <span className="stage-field-head">
          <span>Background</span>
        </span>
        <div className="ns-postcards">
          {PHOTOS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`ns-postcard${background === p.id ? " is-on" : ""}`}
              aria-pressed={background === p.id}
              aria-label={`${p.place}: ${p.ground}`}
              title={`${p.place}: ${p.ground}`}
              onClick={() => setBackground(p.id)}
            >
              <img src={`${ASSETS}${p.postcard}`} alt="" loading="lazy" />
              <span>{p.place}</span>
            </button>
          ))}
          <button
            type="button"
            className={`ns-postcard${background === "plain" ? " is-on" : ""}`}
            aria-pressed={background === "plain"}
            aria-label="Plain colour"
            title={TIP.plain}
            onClick={() => setBackground("plain")}
          >
            <span className="ns-swatch" style={{ background: plain }} />
            <span>Plain colour</span>
          </button>
        </div>
      </div>
      {background === "plain" ? (
        <label className="stage-field" data-hover-help={TIP.plain}>
          <span className="stage-field-head">
            <span>Colour</span>
          </span>
          <input className="ns-colour" type="color" value={plain} onChange={(e) => setPlain(e.target.value)} />
        </label>
      ) : null}
      <StageSegmented ariaLabel="Trait" label="Trait" tip={TIP.trait} value={trait} options={TRAITS} onChange={onTrait} />
      <StageSlider
        label="Predators"
        display={String(predators)}
        value={predators}
        min={0}
        max={MAX_PREDATORS}
        step={1}
        tip={TIP.predators}
        onChange={setPredators}
      />
      <StageSegmented ariaLabel="Mutations" label="Mutations" tip={TIP.mutation} value={mutation} options={MUTATIONS} onChange={setMutation} />
      {view === "one" ? (
        <StageSegmented
          ariaLabel="Inheritance"
          label="Inheritance"
          tip={TIP.inheritance}
          value={inheritance}
          options={INHERITANCE}
          onChange={setInheritance}
        />
      ) : null}
      {trait === "colour" ? (
        <StageSegmented ariaLabel="Start with" label="Start with" tip={TIP.start} value={mix} options={START_MIXES} onChange={setMix} />
      ) : null}
      <StagePills>
        {trait === "colour" ? <StageToggle label="Who stands out" tip={TIP.standOut} on={standOut} onChange={setStandOut} /> : null}
        <StagePillButton label="☄ Asteroid" tip={TIP.asteroid} disabled={impacting} onClick={onAsteroid} />
      </StagePills>
    </>
  );

  const pct = (s: Stats): string => `${Math.round(100 * s.hidden)}%`;
  const [snap, other] = snaps;
  let readouts: JSX.Element | null = null;
  if (snap && other) {
    readouts = (
      <>
        <StageReadout
          label={trait === "hiding" ? "Darwin · hiding time" : "Darwin · blend in"}
          value={trait === "hiding" ? fmtHide(snap) : pct(snap)}
          valueColor={DARWIN_COLOUR}
          tip={trait === "hiding" ? TIP.pairHide : TIP.pairHidden}
        />
        <StageReadout
          label={trait === "hiding" ? "Lamarck · hiding time" : "Lamarck · blend in"}
          value={trait === "hiding" ? fmtHide(other) : pct(other)}
          valueColor={LAMARCK_COLOUR}
          tip={trait === "hiding" ? TIP.pairHide : TIP.pairHidden}
        />
        <StageReadout label="Darwin · eaten" value={String(snap.eaten)} valueColor={DARWIN_COLOUR} tip={TIP.pairEaten} />
        <StageReadout label="Lamarck · eaten" value={String(other.eaten)} valueColor={LAMARCK_COLOUR} tip={TIP.pairEaten} />
      </>
    );
  } else if (snap) {
    readouts = (
      <>
        <StageHero label="Blobs" value={String(snap.population)} tip={TIP.population} />
        {trait === "hiding" ? (
          <StageReadout label="Hiding time" value={fmtHide(snap)} tip={TIP.hideTime} />
        ) : (
          <StageReadout label="Hidden" value={pct(snap)} tip={TIP.hidden} />
        )}
        <StageReadout label="Eaten" value={String(snap.eaten)} tip={TIP.eaten} />
        <StageReadout label="Generations" value={snap.generations.toFixed(0)} tip={TIP.generations} />
      </>
    );
  }

  const inset = (
    <canvas
      ref={histRef}
      style={{ width: HIST_W, height: HIST_H }}
      role="img"
      aria-label={
        trait === "hiding"
          ? "The blobs' average hiding time over the last two minutes, with the spread around it"
          : "The blobs' colours over the last two minutes, with the background colour along the top"
      }
    />
  );

  const info = (
    <>
      <h4>What you are seeing</h4>
      <ul>
        <li>
          Googly-eyed blobs live on the ground. A blob that eats a strawberry splits in two. Fewer blobs means more
          strawberries, so the population stays near 100.
        </li>
        <li>
          When a blob splits, the new copy usually has its parent's colour, but sometimes it changes a little at random:
          a mutation.
        </li>
        <li>
          Blobs that live a long time grow beards, and in the end die of old age: sooner when the ground is crowded,
          later when there are few.
        </li>
        <li>If the blobs nearly die out, newcomers wander in from the edges.</li>
        <li>
          Purple predators hunt by sight. The more a blob's colour stands out from the ground right under it, the more
          likely it is to be spotted and eaten.
        </li>
        <li>
          So the blobs that blend in leave more offspring, and over the generations the population's colours shift
          towards the ground's. Change the background and watch them follow, if there is enough variety to choose from.
        </li>
        <li>The ribbon (bottom right) stacks the blobs' colours, dark to light, moment by moment; the top strip is the ground.</li>
      </ul>
      <h4>Hiding</h4>
      <ul>
        <li>
          With the trait set to "Hiding", every blob is the same colour. What differs is how long each can turn
          invisible: when a predator closes in, the blob vanishes behind a shield (we can see the shield, the predator
          can't), then needs {HIDE_RECHARGE} seconds before it can hide again.
        </li>
        <li>
          The predator waits where it lost the blob, puzzled (?), for a few seconds ({PATIENCE} on average, some longer,
          some shorter). If the blob reappears while it is still waiting, it is caught. If the predator gives up first,
          the blob got away. So the longer a blob can hide, the better its chances.
        </li>
        <li>The chart (bottom right) shows the average hiding time, and the spread from the shorter to the longer hiders.</li>
      </ul>
      <h4>Darwin or Lamarck?</h4>
      <ul>
        <li>
          Lamarck (1809) thought living things change during their lives to suit their surroundings, and pass those
          changes on. With "Lamarck", each blob slowly turns the colour of the ground it stands on, or (with hiding)
          gets a little better at hiding every time it hides, like practising. Its young start from the changed blob.
        </li>
        <li>
          Darwin (1859): nobody changes. Traits are fixed for life, and the population changes only because blobs that
          stand out, or hide too briefly, get eaten before they have young.
        </li>
        <li>
          The evidence backs Darwin: what happens to a body during its life isn't written into its genes, so it isn't
          inherited. Practising the piano doesn't give your children piano skills.
        </li>
        <li>
          "Darwin vs Lamarck" (top bar) runs both side by side, from the same starting blobs on the same ground. Lamarck's
          way is faster, because every blob improves, not just the lucky ones. It would be a better way to adapt; it is
          just not how heredity works.
        </li>
      </ul>
      <h4>Asteroid</h4>
      <ul>
        <li>
          A big impact, like the one that ended the dinosaurs 66 million years ago (the K–Pg extinction). The blast kills
          the predators and most blobs, and dust blots out the sun, so nothing grows for a while.
        </li>
        <li>
          Who survives is luck, not colour. When the sky clears, the few survivors spread into the empty ground; the
          predators come back later.
        </li>
      </ul>
      <h4>Try</h4>
      <ul>
        <li>Turn the predators off: colours wander, but no longer head for the ground.</li>
        <li>Switch on "Who stands out": the blobs with rings rarely live long enough to grow a beard.</li>
        <li>
          Turn the predators off and compare Darwin with Lamarck. Lamarck's blobs still adapt; Darwin's don't, because in
          Darwin's version it is the predators that do the choosing.
        </li>
        <li>
          Send an asteroid: a lucky few survive. Watch them fill the empty ground, and spread out in colour, while the
          predators are gone; then watch the predators sort them again.
        </li>
        <li>Start "All alike" with mutations off: with no variety, there is nothing to select, and they never adapt.</li>
        <li>
          Set the trait to "Hiding" and pick "Darwin vs Lamarck". Both sides get better at hiding, but for different
          reasons: on the left only because the short hiders get eaten; on the right because every blob practises.
        </li>
        <li>
          With "Hiding", turn the predators off: on the Darwin side hiding time just wanders, because nobody is chased
          and nobody is selected; on the Lamarck side nobody practises, so it stays put too.
        </li>
      </ul>
      <h4>Simplified on purpose</h4>
      <ul>
        <li>
          One trait (colour), passed on whole, with no sexes or mixing of parents. Blobs wander or head for strawberries;
          they don't flee or hide. Real camouflage also involves pattern, shape and behaviour.
        </li>
        <li>Beards are just for show: predators only judge the body's colour.</li>
        <li>
          No real animal turns invisible. Hiding stands in for any escape trick that works for a while: freezing,
          diving into a burrow, squirting ink. How long it lasts is passed on whole, like colour.
        </li>
        <li>Side by side, each half is half the ground, with half the blobs, predators and strawberries.</li>
        <li>
          The asteroid kills at random. In the real K–Pg extinction luck mattered, but so did traits: small animals that
          burrowed, or ate seeds and scraps, survived best.
        </li>
        <li>The strawberry supply is tuned to hold the population steady, so predators change who survives, not how many.</li>
        <li>
          Predators judge colour difference the way our eyes do (a perceptual colour space). Real predators see colour
          differently from us, and from each other.
        </li>
        <li>Everything runs thousands of times faster than real evolution.</li>
      </ul>
      <h4>Photos</h4>
      <ul>
        {PHOTOS.map((p) => (
          <li key={p.id}>
            {p.place}: <a href={p.credit.url} target="_blank" rel="noreferrer">{p.credit.photo}</a>, by {p.credit.author},{" "}
            {p.credit.licenseUrl ? (
              <a href={p.credit.licenseUrl} target="_blank" rel="noreferrer">{p.credit.license}</a>
            ) : (
              p.credit.license
            )}
            . Cropped and resized.
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <AppletStage
      logicalWidth={WORLD_W}
      logicalHeight={WORLD_H}
      canvasRef={sceneRef}
      canvasLabel="Googly-eyed blobs on the ground, hunted by purple predators"
      toolbar={toolbar}
      controls={controls}
      controlsWidth={300}
      readouts={readouts}
      inset={inset}
      info={info}
      play={{ visible: !running, label: "Start", onClick: () => setRunning(true) }}
    />
  );
}
