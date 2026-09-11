---
name: framer-component
description: Write or fix a Framer code component in this repo so it also renders in the Originkit builder. Use when adding a component, editing addPropertyControls, importing a CDN library like three.js, or when an uploaded component renders black or blank.
---

# Framer components that survive the Originkit builder

These components have two hosts: Framer, and the Originkit builder at
`originkit-builder/` (`pnpm dev`, port 3100). Framer is forgiving. The builder
compiles the source with esbuild, evaluates it outside Framer, and renders it
with props it derives itself — so things Framer papers over become black
screens there.

Both components in this repo shipped black on their first upload. Neither
failure produced a visible error.

## The two rules that caused those failures

### 1. Never give an Enum numeric options

```ts
// BROKEN outside Framer
maxPixelRatio: { type: ControlType.Enum, defaultValue: 1.5, options: [1, 1.5, 2] }
```

The builder normalizes controls with `extractPropertyControls`
(`originkit-builder/lib/originkit-shared/extractPropertyControls.ts`). Its
`strArray()` keeps only strings, so a numeric `options` list becomes
`undefined`, and the default falls through to `strArray(raw.options)?.[0] ?? ""`.
The component receives `""`.

`""` is not `undefined`, so a destructuring default does **not** rescue it, and
`clamp` coerces it to `0` rather than rejecting it. That is how `maxPixelRatio`
reached `setPixelRatio(0)` — a 0x0 drawing buffer, rendering pure black — in
CapsuleOrb, and a 1x1 canvas in LightVeil.

Instead:

- A count or a scale → `ControlType.Number` with `min`/`max`/`step`, plus
  `displayStepper: true` for small integer ranges.
- A genuine choice → `ControlType.Enum` with **string** options
  (`["cycle", "color", "mono"]`). These normalize fine.
- A performance cap → no control at all. Keep it a prop with a default.

### 2. Pin every CDN library to a full https URL

```ts
import * as THREE from "https://esm.sh/three@0.170.0"   // correct
import * as THREE from "three"                          // silently wrong
```

`compile-component.ts` rewrites any unresolved bare specifier to
`https://esm.sh/<name>` — unpinned, so whatever is current. CapsuleOrb is
written against three r170; r186 changed the shadow sampler types, so every
instanced draw failed with `GL_INVALID_OPERATION` and the entire capsule shell
drew nothing. The background still rendered, which is why it read as "mostly
black" rather than "broken".

The builder states this rule itself in `lib/server/simple-build.ts`: bare
imports for react / framer / framer-motion only, full URLs for everything else.

## Defensive reading of numeric props

Any prop that can zero a dimension gets read through a guard, so a wrong-typed
value falls back instead of coercing:

```ts
function num(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value)
    return Number.isFinite(n) ? n : fallback
}

const dpr = clamp(window.devicePixelRatio || 1, 1, num(params.maxPixelRatio, 1.5))
```

Apply it to pixel ratio, instance counts, and anything feeding a buffer size.

## How many controls

Aim for **12–16**. Both components landed at 13–15 after being cut from 30+.

Do not delete a prop to remove a control. Keep the prop with its inline
destructuring default, drop only its `addPropertyControls` entry, and list it
under "Props without a control" in `README.md`. Promoting one back is then a
five-line change.

Every control needs:

- `title` — human words ("Marble Size", not "orbSize")
- `description` — one sentence; the builder renders it as helper text
- `unit` where it applies (`"°"`, `"s"`)
- `hidden: (props: XProps) => ...` for controls that only matter conditionally

The panel renders controls in declaration order and does not group them, so
order them Layout → Animation → Interaction → Colors → Light → Effects and mark
the groups with comments.

## The rest of the contract

- Named default export: `export default function X(props: XProps)`
- Root element spreads `...style` and fills its parent (100% / 100%)
- `@framerSupportedLayoutWidth` / `@framerSupportedLayoutHeight` annotations
- Give every prop an inline destructuring default — outside Framer nothing
  injects them for you
- Kill every rAF, timer, listener, observer and GL resource on unmount

## Verifying before you hand it over

A component that compiles is not a component that renders. Compiling only
proves esbuild was happy; both black screens compiled cleanly with zero
warnings. Check pixels.

1. Start the builder: `cd originkit-builder && pnpm dev` (port 3100).
2. Compile through its real path, not your own esbuild:
   `POST /api/compile-preview` with `{ source, slug }`.
3. Render the compiled module in a browser with `globalThis.__compifyGlobals`
   set to react / react-dom / react/jsx-runtime, passing props derived the way
   the builder derives them — mirror `defaultFor()`, including the enum
   string-filter, or you will not reproduce the bug that matters.
4. Screenshot and look at it. Do not read pixels back with `drawImage` from a
   WebGL canvas — without `preserveDrawingBuffer` it reports all-black even
   when the render is correct, which will send you chasing a bug that is not
   there.
5. Read the console. `GL_INVALID_OPERATION` and three.js deprecation warnings
   are where the real cause showed up both times.

Chrome can be driven with the builder's own `playwright-core` using
`chromium.launch({ channel: "chrome" })` — no browser download needed.

`verify.mjs` next to this file does steps 2–5 without the dev server: it
bundles the builder's `compile-component.ts`, derives props with its
`extractPropertyControls`, renders in headless Chrome and screenshots.

```
node .claude/skills/framer-component/verify.mjs components/VortexRing.tsx \
  '{"thickness":0}' "[0.5,6,12]" "[1000,900]" tag     # overrides, shot times, size
```

Screenshots land in `$TMPDIR/framer-verify/`. Read them as images; a run
that prints no `[console.error]` and no shader log is not yet a pass.

## Builder setup notes

- `pnpm` may need `corepack enable pnpm` first.
- `pnpm-workspace.yaml` uses the old `allowBuilds:` key, so pnpm 10 skips the
  `ffmpeg-static` / `@ffprobe-installer` postinstalls and leaves those binaries
  missing or non-executable. Point at system binaries in `.env.local`:
  `FFMPEG_PATH` / `FFPROBE_PATH`.
- No Supabase keys are needed for a local run; without them catalog grounding
  and publishing are off, and the prop audit refuses to run since it has no
  house contract to measure against.
- Upload at `/maker` → **Code** tab (drop, pick, or paste a `.tsx`).
