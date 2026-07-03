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

## The video

- Length: _TBD_
- Format / language: _TBD_
- Capture: iOS screen recording (screen + audio together). Keep sketches
  capture-ready — clean attract state, no dev chrome.

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
