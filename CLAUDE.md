# originkit-components

Single-file Framer code components. Each one lives in `components/` and imports
nothing but React, `framer`, and — when it needs one — a CDN library pinned to a
full URL.

Components have two hosts: Framer, and the Originkit builder at
`originkit-builder/` (a submodule tracking its own repo). The builder compiles
the source with esbuild, evaluates it outside Framer, and derives props itself,
so it is stricter than Framer in ways that produce black screens rather than
errors.

**Before writing or editing a component, or its `addPropertyControls`, read
`.claude/skills/framer-component/SKILL.md`.** It carries the full contract and
the verification loop. The two rules that have actually broken components here:

1. **No Enum with numeric `options`.** Outside Framer, option lists are read as
   strings, so a numeric list vanishes and the default collapses to `""` — which
   `clamp` coerces to `0`, not `undefined`. That is how `maxPixelRatio` reached
   `setPixelRatio(0)` and rendered a 0x0 canvas. Use a Number control, or a
   string-optioned Enum, or no control at all.
2. **Pin CDN libraries to a full https URL.** A bare `"three"` is rewritten to
   an unpinned `https://esm.sh/three`; the current release changed shadow
   sampler types and every instanced draw failed silently. Use
   `https://esm.sh/three@0.170.0`.

Keep the panel to roughly 12–16 controls, each with a `title` and a
`description`. To drop a control, keep the prop and its default and move it to
the "Props without a control" list in `README.md` — never delete the prop.

Verify by rendering, not by compiling. Both black screens compiled cleanly with
zero warnings.

## Writing a new component

`components/example.tsx` (AuroraSeam) is the reference build — read it before
starting a new one. `CapsuleOrb.tsx` and `LightVeil.tsx` are the two shipped
ones. A component is one file, top to bottom in this order, and the order is
not cosmetic: everything a later section names has to already exist, because
there is no module graph to hoist things out of.

```tsx
"use client"                                    // 1. always first, before imports

import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
// A CDN library, if any, goes here — pinned:
// import * as THREE from "https://esm.sh/three@0.170.0"

/* ---------------------------------------------------------------------- *
 *  ComponentName
 *  What is on screen, in two lines.
 *
 *  WHAT IS ACTUALLY DRAWN
 *    Name the primitive — points, instanced meshes, one full-screen
 *    fragment shader — and then say which visible features are that
 *    primitive overlapping itself rather than elements of their own.
 *
 *  WHAT WAS DELIBERATELY LEFT OUT
 *    Each thing a reader would expect and not find (no spring solver, no
 *    colour ramp, no Transition control), and why.
 * ---------------------------------------------------------------------- */

/* --------------------------------------------------------- constants */
const DPR_CAP = 2                 // never oversample the backing store past this
const MAX_POINTS = 200000         // budget for one frame; thin, don't crash

/* ---------------------------------------------------------- defaults */
export interface SectionsSettings { count: number; taper: number /* … */ }

/** Prose above each group: what the dial is for, what its neutral value
 *  is, what the extremes do, and why it is two controls and not one.
 *  This is where the design decisions live — not in the README. */
const DEFAULT_SECTIONS: SectionsSettings = { count: 3, taper: 5 /* … */ }

const DEFAULTS = { background: "#000000", strands: 42, speed: 17.7 /* … */ }

/* ----------------------------------------------------------- helpers */
// mulberry32 (seeded PRNG), clamp, num (defensive numeric read),
// toRGB (CSS colour → [r,g,b]), and the 0–10 → real-units response
// curves: speedRate, taperExponent, joinWidth…

/* -------------------------------------------------------------- glsl */
const POINT_VERT = `…`            // shaders as plain template strings

/* ------------------------------------------------------------- props */
interface ComponentNameProps {
    /** One sentence per prop. Every prop optional. */
    background?: string
    sections?: Partial<SectionsSettings>   // grouped props are always Partial
    style?: CSSProperties                  // always last
}

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 675
 */
export default function ComponentName({
    background = DEFAULTS.background,     // inline default on every single prop
    sections,
    style,
}: ComponentNameProps) {
    const isStatic = useIsStaticRenderer()      // one frame on the Framer canvas
    const animate = !isStatic || animateOnCanvas

    const hostRef = useRef<HTMLDivElement>(null)
    const sceneRef = useRef<Scene | null>(null)
    const [failed, setFailed] = useState(false)

    // Every host number read through num(); grouped props merged over defaults.
    const paramsRef = useRef<Params>(null!)
    paramsRef.current = {
        background,
        strands: num(strands, DEFAULTS.strands),
        sections: { ...DEFAULT_SECTIONS, ...sections },
    }

    // Build once. Only `animate`, and anything that truly needs a realloc,
    // belongs in these deps.
    useEffect(() => {
        const scene = init(hostRef.current, paramsRef.current)
        if (!scene) { setFailed(true); return }
        sceneRef.current = scene
        animate ? scene.start() : scene.renderOnce()
        return () => { scene.dispose(); sceneRef.current = null }
    }, [animate])

    // Push prop changes into the running scene. NO dep array — see below.
    useEffect(() => {
        const scene = sceneRef.current
        if (!scene) return
        scene.setParams(paramsRef.current)
        if (!animate) scene.renderOnce()
    })

    return ( /* relative host at 100%/100%, ...style last, canvas inset */ )
}

/* ------------------------------------------------- property controls */
addPropertyControls(ComponentName, { /* … */ })
```

### Why each of those pieces is there

- **`"use client"`** — first line, above the imports. Not load-bearing in
  either host today: both shipped components omit it and render fine. It is
  what the builder's own generator emits, and its paste validator accepts only
  `"use client"`, an `import` or an `export` as the first line
  (`lib/server/generate-component.ts`), so it is the house default and costs
  nothing. It starts mattering the moment the module is evaluated in an RSC
  context.
- **Imports** — `react`, `framer`, and full-URL CDN libraries only. Nothing
  else resolves in either host. `import type { CSSProperties }` stays a
  separate type-only import.
- **The header block** — the longest comment in the file, and the point of the
  house style. It says what is actually drawn, which visible features are
  emergent (a stack of sprites seen end-on, not a "line" element), and what was
  left out on purpose. Every later reader who wants to "add the missing
  gradient" is answered here instead of re-litigating it.
- **Constants before defaults, defaults before helpers** — caps and budgets
  first, then the `DEFAULT_*` objects and one flat `DEFAULTS`, so the controls
  block at the bottom and the destructuring at the top read the same numbers.
  One default lives in one place; a control's `defaultValue` always points at
  it, never at a literal it can drift from.
- **Grouped settings** — a group is an exported `interface`, a `DEFAULT_X`
  object and a doc comment. The prop is `Partial<X>` and the component merges
  `{ ...DEFAULT_X, ...x }`, so a host that sends half an object still works.
- **Helpers, then shaders, then the component.** Panel numbers are 0–10 and
  neutral at 5 wherever there is no natural unit; a response curve
  (`speedRate`, `taperExponent`) maps that to real units, so the useful range
  is spread across the slider instead of bunched in its first tenth.
- **Annotations** — `any-prefer-fixed` for both axes on these, since they want
  a real box; plus `@framerIntrinsicWidth` / `Height` so dropping one onto a
  canvas gives a sane frame.
- **Live props, without a rebuild and without a stale list.** Two effects: one
  keyed `[animate]` that builds the scene, and a second with **no dependency
  array at all** that pushes `paramsRef.current` in through `setParams` and
  calls `renderOnce()` when static. This is the one place neither existing
  component is right, so take it from here rather than from either:
  `example.tsx` reads its `propsRef` inside the rAF loop and keys its effect
  `[]` — elegant, never stale, and silently dead under `useIsStaticRenderer`,
  because with no loop running nothing repaints when a slider moves. LightVeil
  instead hand-maintains a ~25-entry dep list: correct, but add a prop and
  forget the list and the control is dead with no error. An effect with no dep
  array runs after every render, so it cannot go stale, and it still repaints
  on a static canvas. `setParams` is uniform assignment — running it per render
  is free. Reserve the build effect's deps for what genuinely needs
  reallocation, and give a buffer rebuild a tolerance so a resize cannot thrash
  it.
- **The effect body**, in order: `init()` → `resize()` → `draw(dt)` → `loop()`
  → listeners → first frame → cleanup. `init()` returning false sets a `failed`
  state that renders a static CSS approximation, so no-WebGL is a picture and
  not a black box.
- **Listeners, all of them optional-guarded and all of them removed:**
  `ResizeObserver` (resize), `IntersectionObserver` (pause off-screen),
  `visibilitychange` (pause in a background tab), `prefers-reduced-motion`,
  pointer move/leave, and `webglcontextlost` / `webglcontextrestored`. Cleanup
  sets `disposed`, cancels the rAF, disconnects observers, removes every
  listener, deletes every buffer and program, and calls
  `WEBGL_lose_context.loseContext()`.
- **Static canvas rendering** — `useIsStaticRenderer()` from `framer` is how
  CapsuleOrb and LightVeil draw one frame on the Framer canvas and animate only
  in preview and on the published site.
- **The root element** — a `position: relative` div at `width: 100%` /
  `height: 100%` with `overflow: hidden`, spreading `...style` last, and the
  canvas absolutely inset inside it.
- **`addPropertyControls` last**, after the function it names.

### The controls panel

Declaration order is render order — the builder does not group or sort — so
order the block Layout → Animation → Interaction → Colors → Light → Effects and
mark each run with a `// ---------- Name` comment. Every control gets a `title`
in human words ("Marble Size", not `orbSize`), a one-sentence `description`,
`unit` where one applies, and `hidden: (props) => …` when it only matters
conditionally.

Use `ControlType.Object` when a run of related dials would otherwise blow the
row ceiling: a group is **one** row, and it collapses. Two fields is not a
group — that is two rows. Inside an Object, `hidden` receives the **object's
own** props, so `hidden: (props) => props.count < 2` refers to the sibling
field, not to a top-level prop.

Both survive the builder — checked, not assumed. `extractPropertyControls.ts`
recurses into a nested `controls` map, and synthesizes the group's default from
its children when the group has none (`defaultsFromControls`). `hidden`
predicates are kept as `hiddenWhen` on the client, though only for top-level
controls — nested fields carry their own. Still give a grouped prop the
`Partial<X>` type and merge it over `DEFAULT_X`, so a host that sends a partial
object cannot punch a hole in it.

A `ControlType.Enum` is fine and normalizes correctly as long as the `options`
are strings — `options: ["cycle", "color", "mono"]` with `optionTitles` and
`displaySegmentedControl: true`. Numeric options are the rule-1 failure above.

### Reading `example.tsx`

It is the reference for **structure**, not for values, and not for runtime
hardening. Take:

- **`ControlType.Object` grouping.** It fits 22 dials into ~11 rows; LightVeil
  spends 13 flat rows on 13 dials. This is the cheapest way to stop fighting
  the row ceiling.
- **Pause on `visibilitychange`, and honour `prefers-reduced-motion`.** Ours
  have neither. `IntersectionObserver` does not cover a backgrounded tab, so a
  LightVeil behind another tab keeps a full-screen fragment shader running.
- **The `failed` → CSS-approximation fallback.** LightVeil has the flag;
  CapsuleOrb has nothing, so no-WebGL is a black box there.
- **A seeded PRNG (`mulberry32`)** for any lattice built in JS. LightVeil's
  precision-safe shader hash is the same idea on the GPU side.
- **The header comment discipline** — what is drawn, what is emergent, what was
  left out.

Leave:

- **Its live-prop plumbing.** See the bullet above; it cannot repaint a static
  canvas.
- **Its bare panel.** Zero `description` fields across the whole file, against
  13 in each of ours. The builder renders them as helper text, so that panel
  ships as unexplained labels.
- **Its unguarded numeric reads.** No `num()` anywhere. That is the exact class
  of bug that black-screened both of ours.
- **Its always-on animation.** No `useIsStaticRenderer`, so a full-screen
  shader runs per instance while you are editing the canvas.
- **Its numbers.** They have already drifted: `DEFAULTS.color` is
  `rgb(139, 92, 246)` while the control's `defaultValue` is `#203BFF`, and the
  `propsRef` merges carry injected `defaultValue: {...}` literals from a
  builder round-trip. Read it for shape; do not copy a constant out of it.

## Working from reference frames

LightVeil was built from a screen recording, and the first build was wrong in a
way that cost a 573-line rewrite (`68adcda`). It read the frames as **traffic** —
drifting columns sliding left to right — when the reference is one fixed
structure seen from a **turning viewpoint**. The user had to say so. They
shouldn't have to; the frames say it. This is the read to do before writing a
line.

**Get frames that are spread across the loop, not consecutive.** Adjacent
frames show almost no motion, and motion is what discriminates the models.
LightVeil's ten stills are in `~/Downloads/videotoframes/`. From a fresh
recording: `ffmpeg -i rec.mov -vf fps=2 frames/%03d.png`. Then actually look at
them — read the PNGs as images, several at a time, and compare a frame against
one from the far side of the loop.

Then answer these, in this order, before choosing a technique:

1. **What is the primitive?** One full-screen fragment shader, gl.POINTS,
   instanced meshes. The grain is the tell. LightVeil's fine vertical lines
   persist and stay parallel through the whole loop, so they are noise fixed to
   a surface — one shader — and not a few hundred lights drawn individually.
   AuroraSeam's speckle sits exactly where its curves twist hardest, which is
   what says points and not line strips.
2. **Which features are elements, and which are the primitive overlapping
   itself?** This decides everything downstream. AuroraSeam's white needle at
   the margins is not a line element — it is a few hundred strands collapsed
   onto one row of pixels, seen end-on. Model an emergent feature as its own
   element and you get wallpaper: one stamp repeated N times, evenly spaced,
   never beating against itself.
3. **Is the motion travel, or a changing viewpoint?** Travel if things enter and
   leave the frame and everything moves at one flat rate. A viewpoint change if
   the same features persist across the whole loop, change size *and* speed with
   where they sit, and some run against the others. **Nothing moving at one flat
   rate is the strongest single tell for projection** — LightVeil's screen speed
   is greatest dead in front, drops toward the flanks, reverses and slows round
   the back, and slows again on the inner rings, and all of that falls out of one
   projection rather than being dialled in per layer.
4. **Is there counter-motion, and a density difference?** Two populations
   running opposite ways, with the denser one packed tighter, is a cylinder in
   perspective. The far face is squeezed toward the axis, so it packs its lines
   more tightly and always runs against the near ones — one consequence of the
   same drum, not a second effect to add.
5. **What is fixed in screen space?** LightVeil's frame is composed on a
   diagonal: light hangs from the top edge on the left, sits lower toward the
   right, top-right and bottom-left stay dark (`4e0d3a2`). That envelope does
   **not** turn with the drum — the lights pass behind it. Composition and
   motion are separate axes; fuse them and neither can be tuned.
6. **What colours are actually in the pixels?** Count hues in the frames, not in
   the description. AuroraSeam's blueprint asked for a cyan → cobalt → fuchsia
   ramp keyed to `abs(Y)`; the frames hold a single violet that goes white only
   where the stack is deepest, so every point draws flat in one colour and every
   brighter value is overlap — which also puts the brightness where the frames
   put it.
7. **What stays the same across the loop?** Anything that persists must be
   deterministic — seeded, closed-form, evaluated fresh rather than regenerated.
   LightVeil dropped its seed control outright (`d2ec2b6`) so the composition is
   one fixed thing you look at from a moving angle.

**The frames outrank the description — the blueprint's, the README's, mine and
the user's.** Where prose and pixels disagree, follow the pixels and leave a
comment at that line saying the frames won and what they showed. Both component
headers do exactly this, and those comments are why the decisions have stayed
made.

**Verify against the frames, not against the prose.** Screenshot the build at
the reference's aspect and set it beside a still from the far side of the loop.
For direction and rate, do not trust your eye on the composite — the layers
alias, and a turning drum reads convincingly as a sideways slide. Build isolated
debug variants (near-face lines only, far-face lines only, lights only), run a
block matcher over consecutive frames of each, and read the sign of the
displacement.

**Then write the read into the header comment** — what is actually drawn, what
is emergent, what was deliberately left out — so the next session inherits it
instead of re-deriving it and landing on drifting columns again.

**What to ask, and what not to.** Ask where the frames are genuinely silent:
hover behaviour, how it should hold at a phone aspect, whether the loop has to
be seamless, what the thing is for. Do not ask what the frames already answer —
direction, palette, density, rate, composition, whether it is one structure or
many. "Does it look like the frames" is the acceptance test; deriving the answer
from them is the job.

## What yesterday cost us (2026-09-09)

Both shipped components rendered black on their first upload, and neither
failure produced a visible error. What came out of fixing them:

- **A component that compiles is not a component that renders.** Both black
  screens compiled cleanly with zero warnings. The check is a screenshot.
- **Reproduce the host's prop derivation, not your own.** The bug only appears
  when props are derived the way the builder derives them — mirror
  `defaultFor()` including the enum string-filter, or the run is green and the
  upload is still black.
- **Do not read a WebGL canvas back with `drawImage`.** Without
  `preserveDrawingBuffer` it reports all-black even when the render is correct.
  That sends you chasing a bug that is not there.
- **Read the console.** `GL_INVALID_OPERATION` and three.js deprecation
  warnings are where the real cause surfaced both times.
- **Guard every numeric prop that can zero a dimension** — pixel ratio,
  instance counts, buffer sizes — through a `num(value, fallback)` that rejects
  non-finite values instead of coercing them.
- **Seed your randomness.** `Math.random` in a point lattice differs between
  the server render and the client, and reshuffles on every rebuild.
  `mulberry32` off a seed prop keeps the layout stable and reseedable.
- **Use a precision-safe hash in shaders.** The usual `sin`-based noise drifts
  on mobile GPUs and the layout moves under you.
- **The panel gets cut, the props do not.** Both components came down from 30+
  controls to 13–15. Every control that went kept its prop and its default and
  moved to "Props without a control" in `README.md`; promoting one back is a
  five-line change. Yesterday's cuts: CapsuleOrb's shadow and fixed-lighting
  controls, LightVeil's label overlay.
- **Read the reference frames before choosing a technique.** LightVeil's first
  build modelled the motion as drifting columns and had to be rewritten as a
  turning drum — 573 lines — because the frames were read as traffic rather than
  as one structure seen from a moving angle. See "Working from reference
  frames" above; it is the section to follow when a recording or a still is the
  brief.
- **Round-tripping through the builder edits your source.** Values tweaked in
  the builder panel come back injected into the file as stray
  `defaultValue: {...}` literals inside the merge expressions — visible in
  `example.tsx`'s `propsRef`. Diff after a round-trip and fold anything you
  want to keep into the `DEFAULT_*` objects.

## Running the builder

```
git submodule update --init          # first time, or after a fresh clone
cd originkit-builder && pnpm install # first time, or when its lockfile moves
pnpm dev                             # http://localhost:3100/maker → Code tab
```

Run it in your own terminal — a long-lived dev server started from an agent
session gets reaped. Setup caveats are in the skill file.
