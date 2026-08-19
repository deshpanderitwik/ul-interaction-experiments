# Thesis

> Working doc. The durable thing this repo is building toward: a short **thesis
> video** that bundles our audiovisual-interactivity sketches into one compelling
> statement. The experiments are disposable; this argument is not. We develop it
> in parallel with the sketches.

## The statement (one line)

_Working draft — wording not locked:_

> Phone music tools inherited the button/pad/slider grid from hardware. There's a
> different instrument latent in the glass: **continuous gestures where sound and
> image are one material — and that accumulate into whole compositions**, not just
> one-off patterns.

_Alt draft (post-corpus, sharper on what the sketches proved):_

> On the phone's glass, what you see can be what sounds. A gesture doesn't
> trigger a note — it leaves a **living trace** that keeps playing. And the
> traces are themselves instruments: **playable, pluckable, revisable** — until
> a whole composition is standing in front of you, with no timeline in sight.

## What we're arguing

- **Buttons/pads/sliders aren't the enemy.** They're legible because they're
  *discrete and labeled* — a thing at a place that does one thing. You learn them
  in seconds and you can aim. They also plug into the machinery (sequencers,
  loopers, DAWs) that lets gestures **accumulate** into songs. We honor that.
- **What we're going beyond** is the unquestioned *port of hardware affordances
  onto glass* — a pad grid is a photograph of an MPC. The phone is continuous,
  multitouch, and its surface *is* the display; it affords a different instrument.
- **Toy vs. instrument, the axis that matters: do gestures accumulate?**
  Present-tense coupling (touch → sound+light → gone) = toy or provocation.
  Accumulation into structure = instrument.
- **Solo composition first** (jamming comes later). So the bar: gestures must
  **persist, layer, arrange, and be revisitable** into a cohesive whole.
- **The real frontier isn't input or looping.** Expressive coupled input we have;
  loopers already exist. The unclaimed problem is giving **structure and revision**
  the same living, coupled, gestural quality — so the whole composition is a
  *material you shape*, not a timeline you assemble. (Otherwise we just move the
  grid up one layer into a piano roll.)
- **The video is itself a provocation.** Its job is to argue the serious
  instrument is possible and worth wanting — not to be one yet.

## The three levels of solo composition

The problem decomposes into a hierarchy. A composition is made of scenes; a scene
is made of expressive voices. Each level is a design problem of its own.

1. **Compose a scene** — how a gesture becomes a persistent, looping *body*, and
   how several bodies come to coexist and be arranged in one living groove.
   _(the meso unit — the moment)_
2. **Maximum expressiveness within a scene** — how deeply you can shape a single
   body after it's alive: pitch, dynamics, timbre, density, articulation. This is
   the skill ceiling — where "instrument" is won or lost. _(the micro unit)_
3. **Link scenes into a composition** — how scenes connect into an arc: sequenced,
   launched, travelled-between, or morphed. Structure without a timeline.
   _(the macro unit — the arc)_

**Build order (proposed):** get the *atom* right first — one living, expressive
body you can keep reshaping (1 ∩ 2 at n=1). A scene of dead loops is just a loop
pile; if one body isn't alive, multiplying them won't save it. Then multiply into
a scene (1), then link scenes (3).

## Facets (the corners to sketch — solo composition)

- **Coupling** — sound and image as a single event. _(have several)_
- **Persistence** — a gesture leaves a living, looping trace.
- **Layering** — persistent voices coexist and visibly relate.
- **Structure** — sections / build-release / arrangement without a timeline. ← _frontier_
- **Revision** — reach into a committed loop and reshape it as material. ← _frontier_
- **Coherence** — scale / quantize so accumulation stays musical, not mud.

## Experiment → facet map

| Experiment | Facet | Reads on camera? |
|---|---|---|
| **bodies** | **Compose a scene** (Persistence · Layering · Coherence) + first take on the legibility-without-discreteness win | strong — stark B/W (see log below) |
| duet | Coupling | strong |
| raindrops | Coupling | strong |
| notesketch | Coupling (hint of persistence) | ? |
| note-radial | Coupling / Coherence | ? |
| fence/* | (visual substrate, no audio) | strong |

## Bodies — where the sketch landed (log)

The first `experiments/bodies` sketch, as of this writing. A stark monochrome
scene: plain white circles ("bodies") on black.

**Built / working (Level 1 — compose a scene):**
- **Plant & arrange.** Double-tap plants a body; single-tap play/pauses it;
  long-press opens options (subdivision + delete); drag to move. New bodies
  *join on the grid* rather than firing instantly — they enter the groove.
- **Position = pitch** (the slider is gone). Vertical position maps to the nearest
  scale note (C3–C5, snapped); dragging up/down tunes, and the note letter on the
  circle updates live. This is our first real take on **legibility without
  discreteness**: a body is a *thing at a place* (aim-able like a button) yet
  continuous, and it *is* the sound made visible. A left **pitch ruler** +
  full-width **note-boundary grid lines** make the field read like a staff.
- **One shared backing grid.** A single global scheduler phase-locks every body to
  a common `t0`, so voices lock together instead of free-running (**coherence**).
- **Drift** = horizontal position: center is on-grid, right lays a note late, left
  pushes it early — bounded to a fraction of the body's own step, so it's subtle
  and slot-safe. A bottom **drift ruler** + center guide read it. This is the
  first taste of per-voice *life* on top of a quantized grid.
- **Coupling.** Each note sheds a single hairline ripple — the Fence·Raindrops
  ring shader ported to monochrome (white ring on black), dimmed so dense scenes
  layer instead of washing out. Dragging mutes a body; it re-enters in time.

**Not yet (the next frontier):**
- **Level 2 — expressiveness / aliveness.** Each body still plays *one static
  note*. The open move (brainstormed): make the note **change over time** via a
  gesture beyond the slider. Position=pitch already sets up the key idea —
  **motion = melody** — so the candidates are: draw-a-path (patrol a traced
  shape), flick-to-orbit (physics), wander-within-a-temperament (generative), or
  entangle neighbors (emergence). Tension to hold: composition wants
  repeatability, aliveness wants variation — likely a deterministic path with a
  thin generative jitter.
- **Level 3 — link scenes.** Untouched. The Fence dissolve/erode vocabulary is the
  candidate transition grammar.

## Going deeper: grids + bodies — the option space

We've committed to **depth over an orthogonal jump** here. The grids-+-bodies
family (bodies, paths, emitters & receivers, slingshot, extended grid) has become a
real substrate — one shared scheduler, drift, the ripple shader, note-masking,
waypoint paths, spatial persistence — where new mechanics compose cheaply and read
as *one idea* rather than scattered demos. And the hard part of the thesis (Levels
1→3, structure without a timeline) is still unclimbed *here*, so depth isn't polish;
it's the unsolved core.

**What the video length forces.** Target is **1–3 minutes**, not a one-gesture
clip. A minute-plus needs an **arc** — build → develop → move between sections →
resolve. So the fruitful avenues aren't more one-off mechanics; they're the ones
that give the piece **time-development**. Mapped to what a long-form piece needs:

**1 · BUILD — accumulation** _(Level 1 · Persistence/Layering — the backbone)_
- **Looping / layering ("takes").** Capture what's sounding into a loop, keep
  adding on top; the piece visibly accumulates. The single biggest unlock — you
  film it building. Free win: the shared scheduler keeps layers phase-locked.
- **Freeze & ghost.** Freeze a body's current pattern into a dim background layer,
  freeing the foreground to play a new voice. Frozen = arrangement, live =
  performance.

**2 · DEVELOP — transform a scene over time** _(Level 2 → modulation)_
- **Move the grid, not the bodies.** Transpose / tilt / compress the grid under
  stationary bodies → everything re-pitches (or re-drifts) at once. Ensemble-wide
  key change or feel-shift from one gesture. Cheap on Extended Grid's scroll.
- **Morph the scale / mask.** The note-mask becomes a living chord; slide it
  minor→Lydian and the same body motion yields new harmony — modulation without
  touching a body.
- **Live tempo / phrasing.** A conductor gesture — accelerando/ritardando, swing,
  rubato — so a long clip breathes instead of ticking.

**3 · MOVE — link scenes into sections** _(Level 3 · Structure ← frontier)_
- **Rooms / multiple grids.** Each grid is a section; swipe or portal between them,
  and bodies can travel across. The video becomes a journey through rooms.
- **Nesting (bodies made of bodies).** Zoom into a body to find a sub-scene you
  compose; zoom out and it collapses to one voice. Scene-linking via containment —
  and zoom transitions are cinematic.

**4 · EMERGENCE — surprise & hands-off passages** _(Level 2 aliveness, ensemble-scale)_
- **Forces between bodies.** Attraction/repulsion, consonance pulls together,
  crowding pushes apart — the ensemble self-organizes into evolving patterns.
- **Bodies with agency.** Semi-autonomous wander / seek-consonance / migrate — you
  garden an ensemble rather than trigger notes.
- **New grid geometries.** Radial / spiral / hex change position→pitch and how a
  slingshot body *moves* (orbit vs bounce) — a fresh motion vocabulary on the same
  premise.

**Proposed order:** **#1 (accumulation)** first — it's the backbone and the thesis
clip ("a composition builds in front of you"). Then **#2 (move-the-grid
modulation)** — cheap, extends the scroll code, and instantly gives the piece an
emotional arc. #1 + #2 alone are enough to shoot a 1–3 min video; #3 and #4 are the
second act once the core loop feels good.

## Where the corpus stands — audit (late Aug 2026)

Everything above froze when the corpus was bodies / paths / emitters / slingshot
+ fence. Since then the sketches answered several of the doc's own open
questions — the story should now be told from what exists.

**Level 2 got its answer: motion = melody, and the aliveness dial is per-node.**
The predicted shape ("a deterministic path with a thin generative jitter") is
literally what got built:
- **Paths → Extended Grid** — draw a path and the body travels it, playing as it
  goes. Melody is motion; spatial persistence keeps it real across the scrolling
  window.
- **Bent Paths** — press a path's length and it bows to the finger like a
  string; release and it twangs, sounding its segment. **Revision as physics,
  not menus** — the first real answer to "how do you edit a committed gesture."
- **Path Explorations** — each waypoint carries its own aliveness setting:
  📌 static / 🎲 wander (bounded ±2, re-rolled at cycle start so you see where
  it's headed) / ✏️ sub-path (a laid orbit of points the node steps through,
  returning home each cycle). Repeatability and variation coexist per node.

**Level 3 got its first answer — in the *time* family, not bodies.** A second
substrate grew that this doc never recorded: Time → Eight/Sixteen Step → 3D
Clock → Overlapping Rings I–IV (layers in colour, velocity bars, every-N
rotation skips, live resolution) → **Ring Joining**: whole ring-stacks as live
tokens in a column, one active, reorder / duplicate / remove, zoom *into* a
token to edit its sub-scene. That is **structure without a timeline** — an
arrangement you hold as an object (tilt into the isometric stack) — the
frontier facet, first-pass solved, via exactly the "nesting" move sketched
above.

**DEVELOP is half-built.** The scroll window shifts register; the **seven
diatonic modes** (just shipped) re-harmonize every experiment at once. Missing
for the film: the *performance-gesture* version — mode/transpose as a touch on
the field, not a settings sheet.

**Coherence machinery is real and crosses experiments.** One shared scheduler
phase-locks everything — including across sketch families (**Combinations**:
Path Explorations + drums on one clock). Drums add the percussion floor.

**A new axis appeared that the statement doesn't yet claim: sensing.** The
**Sampler** (mic → live scrolling waveform; native module built, awaiting
TestFlight) and the camera (in the shipped binary, unused) point at the *world*
as material. Stance for now: a **coda / sequel thread**, not this video's
spine — but see the closing-shot candidate below.

## The video

- Length: **1–3 minutes** — needs an arc (build → develop → move → resolve), not a
  single-gesture clip.
- Format / language: leaning **filmed hands-on-glass** (overhead) intercut with
  clean screen captures — pure screencap hides the gesture; a tap with no
  visible finger reads as autoplay. _Not locked._
- Capture: iOS screen recording (screen + audio together). Keep sketches
  capture-ready — clean attract state, no dev chrome.

### Story arc (draft v1 — cast entirely from built sketches)

1. **Provocation (~5s).** The inherited pad grid, named and dismissed in one
   beat. Then black.
2. **Coupling (~10s).** One touch → light and note as a single event (duet /
   raindrops language). Sound made visible, before any structure.
3. **BUILD (~25s).** Extended Grid: bodies planted one by one, each joining the
   groove phase-locked; ripples layer; position=pitch reads like a staff. A
   scene accumulates in front of you.
4. **COME ALIVE (~35s) — the core.** Lay a path; the body travels — melody is
   motion. Reach into it: drag a waypoint, then **pluck** a segment — twang.
   Flip a node 🎲, give another a ✏️ sub-path — the piece starts developing
   itself.
5. **DEVELOP (~20s).** The field modulates under the music: scroll shifts
   register; a mode flip re-harmonizes the same motion; drums enter
   (Combinations).
6. **MOVE (~25s).** Rings: the loop as a circle; layers stack; tilt into the 3D
   arrangement-as-object; Ring Joining chains sections and zooms into one.
   Structure without a timeline.
7. **RESOLVE (~10s).** Hands off — the composition plays itself.
   _Stretch coda (needs the new build): the phone lifts and listens; the room's
   waveform breathes into frame — the world is next._

### Pre-shoot gaps (small, OTA-able)

- A **performance gesture for mode/transpose** in one bodies sketch — the
  settings sheet is invisible on film.
- **Attract / hide states** everywhere the camera goes (Extended Grid has the
  eye toggle; audit the rest).
- Pick the per-beat sketches and lock their look (stark B/W reads best).

## Open questions

- **What's the unit of accumulation?** A loop? a voice? a gesture-trace you can grab?
  _(Bodies' answer so far: a placed, grid-locked voice — a body.)_
- **How does structure work without a timeline / piano roll** — else we've just
  moved the grid up a layer?
- **How do you edit a committed gesture** without delete-and-redo?
- **Where's the "legibility without discreteness" win** that beats the button at
  its own game? _(Bodies: position=pitch — a body is aim-able like a button but
  continuous and is the sound. Partial answer; wants stress-testing.)_
- **How does a voice come alive?** Make its note change over time via gesture, not
  a slider — the Level-2 question now on deck (see Bodies log).
