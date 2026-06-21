# Marketing & Positioning Strategy

A living strategy doc for building this project **marketing-first / distribution-first** on **X**. Written so it can be pasted into a fresh conversation as context.

> **One-line context:** This repo is a **mobile-native (iOS, Expo/React Native + Skia) interaction-design sketchbook.** Each "sketch" is a self-contained touch interaction, shipped over-the-air via `eas update`. The goal is to use it as the engine for a personal brand on X.

---

## 1. The core reframe: distribution-first changes the *definition of done*

- The stated problem to solve: a maker-first habit of building things to a point where they're **"not that shareable."**
- Fix: a sketch isn't "done" when it works — it's done when **there's a clip posted to X.** The build is the input; **the post is the deliverable.** "Not shareable" stops being a valid terminal state.
- Inspiration: Emil Kowalski — *"sharing your work increases your opportunity surface area."*

## 2. The niche (locked, after two pivots)

The niche evolved across the thread: haptics → experimental/spectacle → final:

> **Touch-native experimental interfaces as art.** Genuinely beautiful, novel interactions that show what a phone can do when pushed — at the intersection of **interaction design and art direction.**

- **Not** about haptics or a TestFlight funnel.
- **Not** the "craft/polish/taste" lane (that's crowded — Josh Puckett, Emil Kowalski, Rauno Freiberg, Paco Coursey).
- **Not** the cold dev-first creative-coding/WebGL lane (Matt DesLauriers, Awwwards/Codrops crowd).
- **The wedge:** the spectacle world is overwhelmingly *developer-first* (great tech, weak art direction, demos not interfaces) and *web/desktop*. Almost nobody does **technically ambitious spectacle that is genuinely interaction-designed AND art-directed, on mobile, driven by touch.** That intersection is open.

## 3. Platform decision (locked): mobile-native

Chosen deliberately over web/WebGL. Trade-offs accepted:

- **Constraints turned into edges:**
  - *Video-only sharing* → vertical video **is** the native X format; cross-posts free to Reels/TikTok/Shorts.
  - *"The phone is the subject, not the constraint"* → viewer watches on the exact device the work is for; collapses the distance ("my thumb could be doing that").
  - **Touch is the moat** → design for multitouch/pressure/momentum — things a mouse (the whole WebGL crowd) structurally can't show.
- **Honest costs:** no live "playable link" (the video must do 100% of the work → production value is mandatory); lower top-end vs desktop GPU; must become excellent at capture.
- **Note:** Skia's SkSL runtime shaders + Reanimated mean the mobile ceiling is higher than people assume.

## 4. Competitive analysis takeaways

Case study: Josh Puckett's launch post for "Means & Methods" (part of Interface Craft).

- **A successful launch post is a *harvest*, not a *seed*.** It converts attention compounded over years; there's no trick in the tweet.
- **Ferocious positioning wins.** Everything Puckett ships rolls up to one ownable flag: *"uncommon care."*
- **The medium is the portfolio** — his product (interactive site) demonstrates the skill it sells; no gap between claim and proof.
- **The peer graph is the real "opportunity surface area"** — a tight cluster of high-craft people amplifying each other's launches.
- **What you can't copy:** his two decades + pedigree + already-compounded audience + paid product. Don't fight him head-on; take the adjacent, uncrowded mobile/touch lane.

## 5. "What you're really selling" — applied to personal branding

From the *What You're Really Selling* framework (Apple→taste, Stripe→care, Disney→nostalgia). A personal brand is a company of one. Key rules:

- **Sell the feeling, not the thing.** The "thing" is Skia interactions; the brand is the feeling they leave.
- **Name the *payer's* feeling — there are two buyers:**
  - **Scroller** (free, drives reach) feels **wonder + desire** ("why isn't my phone like this?"). This is Disney's *magic* — manufacturable, makes the clip travel.
  - **Opportunity-giver** (founder/studio/recruiter — the real "payer") feels **trust in rare taste at the frontier** — *"this person can see our product's future and make it feel inevitable."* This is Disney's *nostalgia* — the moat, can't be faked, compounds.
  - → Build the brand around the payer's feeling; use wonder as the distribution engine.
- **Skip your own marketing words.** "Experimental / novel / stunning / beautiful" are self-narration (the surface). Drop them from the bio.
- **Plain/quiet words can be deepest** (Stripe sells *care*, not "craft").
- **Having a trait isn't selling it.** Technical skill is a trait, not the brand (unless virtuosity itself is the product).
- **The truth test = where your effort actually goes** (capital allocation, for a person = unpaid obsession). The brand is only *true* if revealed behavior matches it.
- **A too-hard decision is a clue** you haven't resolved what you sell. (The platform decision felt hard for exactly this reason; once the feeling was named, mobile became obvious.)

## 6. The flag + thesis (working)

- **Flag:** **"Interfaces that don't exist yet."** (Plain, not a self-marketing adjective, makes you lean in; the feeling lives underneath.)
- **Thesis line:** **"a future you can feel."**
- **The symmetry:** Disney sells *nostalgia* (longing backward). This sells the **forward version — longing for an interface that should exist but doesn't.** Same moat shape; the scroller's ache ("why isn't my phone already like this?") is the product.
- Alternatives considered: "Futures you can feel," "Make-believe interfaces."

## 7. What the user actually obsesses over (the truth test result)

Self-reported: **a mix of "how it feels to use" and "whether the idea is new."**

- → You sell the **intersection: feel × novelty.** Neither alone (feel-only = polish; novelty-only = cold demo).
- **The leak, named:** you did *not* pick **care/finishing** or **virtuosity**. The unloved finishing 10% (sound, perfect loop, grade, cut) is exactly what converts a felt new idea into a *stunning, shareable* artifact — and exactly what your maker-first self skips. **Importing finishing-discipline is the key habit to build.** (This is why the capture/finish rig keeps surfacing as priority #1.)

## 8. Visual vocabulary ("film stock") — recommended, to refine

Direction: **"Warm computational"** — the future as warm/physical/alive, cutting against *both* cold sci-fi neon and grey corporate SaaS. Rules that make the feed recognizable with the handle covered:

- **One stage:** warm near-black (~`#0E0E0C`); a paper-white variant for "daylight" pieces.
- **One accent per piece**, from a tight curated palette (restraint = recognizability).
- **A signature texture:** subtle film grain / noise (Skia SkSL) on every piece — the single biggest "that's a [you] piece" tell.
- **One physics personality:** everything spring-based, nothing linear; touch tracks sub-frame.
- **One idea per frame:** full-bleed, vertical, generous negative space, near-zero chrome, wow inside 1s.
- **Sound as a first-class layer** (soft/organic/musical, never "UI beep") — this is the *care leg the user skips*, so it's a rule, not a preference.

## 9. Content pillars

1. **Impossible primitives** — a familiar control (slider, toggle, keyboard, scrollbar) behaving like nothing you've seen but feeling inevitable. *Best reach-to-effort ratio → open with this.*
2. **Living matter** — interfaces made of simulated material (fluid, light, cloth, magnetism) shaped by touch.
3. **Gestural grammar** — genuinely new interaction *models* that only exist because of multitouch. Most defensible/original.

## 10. First flagship piece (planned)

**A slider that isn't a slider — value as a living substance.** You push/pull a volume of luminous elastic matter; it tracks finger velocity, overshoots, sloshes, settles with a wobble + a single satisfying tone.

- Familiar (legible in 1s) × new (it's matter, not a handle) × feel-forward (velocity/overshoot/sound) × touch-native (the moat) × scoped (actually finishable).
- Doubles as a stress test of the whole visual vocabulary.

## 11. Cadence & format

- **Flagship-driven, not daily.** Spectacle is higher ceiling / higher variance / higher effort. Reputation compounds on the best 3–4 pieces, not on consistency. One jaw-dropper > thirty tidy ones.
- **Format spec for X:** **vertical 9:16, 1080×1920, H.264/AAC MP4/MOV, up to 60fps** (motion is the point — never let it land at 30). ≤512MB / ≤140s.
- **Never crop to horizontal:** vertical gets the **Immersive Media Viewer** (full-screen, sound-on, TikTok-like) — the best stage for wonder; horizontal letterboxes on mobile and kills it.
- **Safe zone:** keep key action centered; keep essentials out of the top/bottom ~12% (timeline preview crops, and the bottom strip holds controls/caption).
- **Positioning-as-art disarms the "you could never ship that" critique** — claim the art frame explicitly; have a thesis, not just eye candy.

## 12. Capture / distribution pipeline (in progress)

- **Decision:** an in-app recorder was deemed overkill. Chosen approach: a **"hide chrome" affordance + the iOS Control Center recorder** (saves vertical video to Photos → post to X).
- **Implemented (shipped OTA):** an **eye toggle in the sketch screen's top bar** — tap to hide header + status bar (full-bleed); **double-tap top-right to restore**; back button shows just the chevron. Reusable across every sketch (build-once).
- **Zero-build option to start today:** iOS Control Center screen recording already captures full-res, with in-app audio + Skia grain, straight to Photos.
- **Capture quality is now part of the product** (no playable link to fall back on): 60fps, sound design, color/grade, perfect loops.
- **OTA loop works end-to-end from the dev environment** (project linked: `@ritwikdesh/ul-interaction-experiments`). JS-only changes ship via `eas update --channel preview`; the phone pulls on next launch. Native changes still need `eas build`.

---

## Open threads / next decisions

- React to / lock the flag: **"Interfaces that don't exist yet"** + thesis **"a future you can feel."**
- Lock the **visual vocabulary** (warm computational) and the curated accent palette.
- Build the **living-slider** flagship and run it through the capture flow.
- Bio / handle / pinned post once the flag is locked.
- Habit to build: **finishing-discipline** (sound, loops, grade) — the named leak.
