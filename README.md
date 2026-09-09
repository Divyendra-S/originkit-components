# originkit-components

## Capsule Orb

A sphere of instanced capsules that orbiting glass marbles dent as they pass, lit
with real shadows, refraction and bloom. Single-file Framer code component —
three.js is the only dependency.

### Key features

- 250–8,000 instanced capsules on a golden-angle sphere, rebuilt live from the panel
- Up to four glass marbles with true screen-space refraction
- Marbles carve dents whose reach tracks their size automatically
- Mipmap bloom, vignette and sRGB output implemented inline — no post-processing package
- Drag to orbit and wheel/pinch to zoom, always on, plus optional auto-rotate
- Pauses off-screen, survives WebGL context loss, disposes everything on unmount

### API Reference

All props map directly to the controls panel sliders and color pickers. The
panel is ordered the way the rest of the kit orders one: the background and the
palette first, then the numbers most people reach for, then the grouped rows.

#### COLORS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `background` | color | `#AEB2B5` | The colour behind the orb. The gradient shades away from it on its own. |
| `capsuleColor` | color | `#B2B8BB` | The colour of the capsules before lighting. |
| `glassTint` | color | `#FFFFFF` | Tints the glass marbles orbiting the orb. White leaves them clear. |

#### FORM

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `capsuleCount` | number | `3000` | How many capsules make up the sphere. Higher is denser and costs more to draw. |
| `capsuleSize` | number | `100` | The thickness of each capsule, as a percentage of the default. |
| `orbCount` | number | `4` | How many glass marbles orbit the sphere and dent it as they pass. |
| `marbleSize` | number | `100` | The size of each marble, as a percentage. The dents it carves scale with it. |
| `distance` | number | `5` | Camera distance, framing the orb tighter or wider. |

#### MOTION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `speed` | number | `50` | How fast the marbles travel around their orbits. 50 is the natural pace. |
| `autoRotate` | boolean | `false` | Spins the camera around the orb on its own. |

#### LIGHT & MATERIAL

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `lightAngle` | number | `166` | Rotates the key light around the orb, in degrees. |
| `shadow` | object | `{ strength: 0.6, contact: 0.3 }` | How dark a shadowed capsule goes, and the contact shade under the orb. |
| `glass` | object | `{ refraction: 1.45, thickness: 0.6 }` | How strongly the marbles bend the scene behind them. |

### Props without a control

The scene supports more than the panel exposes. These stay props with the
defaults below — pass them in code, or promote one to a control when it earns a
row:

`interactive` `true` (drag to orbit has no switch; it is always on) ·
`allowZoom` `true` · `bulge` `0.4` · `dentSize` `1` · `orbDistance` `1.9` ·
`autoRotateSpeed` `0.3` · `gradientAngle` `0` · `backgroundShade` `0.7` ·
`coreColor` `#111111` · `lightHeight` `0.78` · `bloomIntensity` `2` ·
`bloomThreshold` `0.65` · `bloomSpread` `0.85` · `vignette` `0.6` ·
`vignetteSpread` `0.3` · `maxPixelRatio` `1.5` · `animateOnCanvas` `false` ·
`noiseImage` · `matcapImage`

`backgroundShade` is what keeps one background colour from reading flat: the far
stop of the gradient is that colour multiplied down, in linear space.

## Light Veil

A dark ambient light field: blurred vertical columns of emerald and teal breathing
behind frosted glass, with muted red and amber glows surfacing underneath them,
cycling between full color and drained grayscale. Single-file Framer code
component — no imports beyond React and Framer.

### Key features

- The whole composition is one full-screen fragment shader on a raw WebGL context: no three.js, no post-processing package, no textures to load
- Layered softness per column — a bright inner core, a diffused body and a wide halo — so nothing ever reads as a hard beam
- Columns are wide and hazy at the top and taper into thin streaks as they fall, with brightness rising and falling along their length
- Color drains to grayscale and floods back on a seamless loop; positions and shapes are untouched, only saturation goes
- A precision-safe hash keeps the layout identical on mobile GPUs, where the usual `sin`-based noise drifts
- Reseedable layout and dithered output so the near-black falloffs never band
- Pauses off-screen, rebuilds itself after WebGL context loss, and disposes everything on unmount

### API Reference

All props map directly to the controls panel sliders and color pickers, ordered
palette first, then composition, then the grouped row.

#### COLOUR

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `background` | color | `#03080B` | The near-black the lights float in. |
| `coolA` | color | `#1BE087` | The colour most of the columns are drawn from. |
| `coolB` | color | `#0A6B60` | The colour the dimmer columns fall back to. Columns mix between the two. |
| `warmA` | color | `#C2264F` | The colour of the warm glows underneath. |
| `colorMode` | enum | `cycle` | Cycle drains to grayscale and back; Colour and Mono hold one look. |

#### COMPOSITION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `coolCount` | number | `15` | How many light shafts hang from the top edge. |
| `warmCount` | number | `9` | How many dim warm glows surface underneath the cool columns. |
| `softness` | number | `1` | How far each light diffuses. Low is a sharp shaft, high is a wide haze. |
| `intensity` | number | `1` | Overall strength of the light field. |
| `seed` | number | `37` | Reshuffles the column positions and widths. |

#### MOTION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `speed` | number | `50` | How fast the whole field breathes and drifts. 50 is the natural pace. |
| `animateOnCanvas` | boolean | `false` | Keep animating on the Framer canvas instead of rendering one static frame. |

#### FINISH

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `vignette` | number | `0.45` | How dark the corners of the frame go. |
| `cycle` | object | `{ period: 16, fade: 2.4 }` | Seconds for one round trip through grayscale, and how long the drain lasts. Only in Cycle mode. |

### Props without a control

`warmAmount` `1` · `haze` `0.55` · `falloff` `0.8` · `breath` `1` · `drift` `1` ·
`monoLift` `1.45` · `warmB` `#E08A2A` · `grain` `0.014` · `maxPixelRatio` `1`

## Two things worth not undoing

Both components rendered black when first uploaded outside Framer. These are why.

**No Enum whose options are numbers.** Applies to both. Option lists are read as
strings outside Framer, so a numeric list vanishes and the control's default
collapses to `""` — which `clamp` then coerces to `0` rather than rejecting.
That is how `maxPixelRatio` reached `setPixelRatio(0)` and gave Capsule Orb a
0x0 canvas and Light Veil a 1x1 one. Both now expose it as no control at all;
`orbCount` is a stepper for the same reason. String-optioned enums are fine —
Light Veil's `colorMode` is one. Numeric props are additionally read through a
`num()` helper, which rejects `""` and `null` before coercing — `Number("")` is
`0`, and finite, so the usual `isFinite` guard waves it straight through — and a
missing value lands on its default instead of on zero.

**three.js is pinned to a full URL.** Capsule Orb only.
`import * as THREE from "https://esm.sh/three@0.170.0"`. A bare `"three"`
resolves through a CDN at whatever version is current; on r186 the shadow
sampler types no longer match, every instanced draw fails with
`GL_INVALID_OPERATION`, and the capsule shell renders as nothing at all.
