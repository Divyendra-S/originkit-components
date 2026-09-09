# originkit-components

## Capsule Orb

A sphere of instanced capsules that orbiting glass marbles dent as they pass,
with refraction and bloom. Single-file Framer code component — three.js is the
only dependency.

### Key features

- 250–8,000 instanced capsules on a golden-angle sphere, rebuilt live from the panel
- Up to four glass marbles with true screen-space refraction
- Marbles carve dents whose reach tracks their size automatically
- No light source and nothing casts a shadow: the capsules are the colour you pick, modelled by one direction fixed to the camera, so the bright side stays put as the orb turns
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
| `background` | color | `#000000` | The colour behind the orb. The gradient shades away from it on its own. |
| `capsuleColor` | color | `#D9DDE0` | The colour of the capsules. It is the colour you see — nothing lights them. |
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

#### MATERIAL

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `glass` | object | `{ refraction: 1.45, thickness: 0.6 }` | How strongly the marbles bend the scene behind them. |

### Props without a control

The scene supports more than the panel exposes. These stay props with the
defaults below — pass them in code, or promote one to a control when it earns a
row:

`interactive` `true` (drag to orbit has no switch; it is always on) ·
`allowZoom` `true` · `bulge` `0.4` · `dentSize` `1` · `orbDistance` `1.9` ·
`autoRotateSpeed` `0.3` · `gradientAngle` `0` · `backgroundShade` `0.7` ·
`coreColor` `#111111` · `bloomIntensity` `1` · `bloomThreshold` `0.82` ·
`bloomSpread` `0.85` · `vignette` `0.6` · `vignetteSpread` `0.3` ·
`maxPixelRatio` `1.5` · `matcapImage`

`backgroundShade` is what keeps one background colour from reading flat: the far
stop of the gradient is that colour multiplied down, in linear space. On the
default black it has nothing to shade, which is the point of a black default.

There is no `lightAngle`, `lightHeight`, `shadow` or `animateOnCanvas` — the
first three went with the light itself, and the canvas switch went with the
panel. On the Framer canvas the component now renders one static frame and
animates in preview and on the published site.

`noiseImage` went too. The blue noise texture only ever dithered the shadow
taps, so with the shadows gone nothing sampled it; dropping it also drops one
of the two images the component fetches at runtime. `matcapImage` is the one
that remains, and it has a procedural fallback if the fetch fails.

## Light Veil

A dark ambient light field: a drum of blurred emerald haze, glowing bands and
narrow cyan streaks turning about a dense core behind frosted glass, textured
with fine vertical lines, with muted red and amber glows surfacing inside the
green clusters, cycling between full color and drained grayscale. Single-file
Framer code component — no imports beyond React and Framer.

### Key features

- The whole composition is one full-screen fragment shader on a raw WebGL context: no three.js, no post-processing package, no textures to load
- The composition is one fixed structure seen from a turning angle, not a field sliding past: a dense core of light stands close to a vertical axis through the middle of the frame and hardly moves, and the rest of the clusters ride a drum around it
- A cluster on the drum comes forward across the front — wide, bright and quick — slows towards the flank, turns, and tracks back behind the core, small and dim and running the other way, before coming round again. The turn is clockwise seen from above, so the near side travels right to left
- The screen speed of every light falls out of the same projection: greatest dead in front, dropping towards the flanks, reversed and slower round the back, and slower again on the inner rings — nothing moves at one flat rate
- The drum itself carries the fine vertical lines. Screen x is mapped back onto the cylinder for the near face and for the far face, so the lines are noise fixed to the drum rather than lights drawn one by one, and the far face — squeezed towards the axis by the perspective — packs its lines far more tightly and always runs against the near ones
- Four layers — broad haze masses, medium bands, narrow streaks and warm glows — share the same cluster centres, so the reds and ambers belong to the green clusters rather than floating loose
- Layered softness per light — a bright inner core, a diffused body and a wide halo — so nothing ever reads as a hard beam
- Gentle parallax — the haze rides an inner ring, the streaks the outer one, the bands between — for depth without the layers coming apart, since every layer turns on the same angle
- The frame is composed on a diagonal, as the reference is: light hangs from the top edge on the left and sits lower towards the right, with the top right and bottom left left dark, through a fixed envelope the turning lights pass behind
- Irregular vertical extents and per-light breathing keep the frame from ever reading as a row of evenly spaced bars
- Color drains to grayscale and floods back on a seamless loop; positions, shapes and travel are untouched, only saturation goes
- A precision-safe hash keeps the layout identical on mobile GPUs, where the usual `sin`-based noise drifts
- Reseedable layout and dithered output so the near-black falloffs never band
- Pauses off-screen, rebuilds itself after WebGL context loss, and disposes everything on unmount

### API Reference

All props map directly to the controls panel sliders and color pickers, ordered
colors first, then form, then motion, then the finish. Panel titles are plain
words, as on Capsule Orb; where a title differs from the prop name the table
says so.

#### COLORS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `background` | color | `#03080B` | The dark colour behind the lights. |
| `coolA` | color | `#1BE087` | The main colour of the lights. Shown as **Base Color**. |
| `coolB` | color | `#0A6B60` | A second colour the dimmer lights lean towards. Shown as **Accent Color**. |
| `warmA` | color | `#C2264F` | The colour of the warm glows low in the frame. Shown as **Warm Color**. |
| `colorMode` | enum | `cycle` | Cycle fades between white and colour; Colour and Mono hold one look. Shown as **Color Mode**. |
| `colorSpeed` | number | `50` | How fast the scene fades from white to colour and back. 50 is the natural pace, 0 stays in colour. Only in Cycle mode. Shown as **Color Speed**. |

#### FORM

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `coolCount` | number | `16` | How many lights fill the frame. Shown as **Density**. |
| `warmCount` | number | `8` | How many warm glows appear among the lights. Shown as **Warm Lights**. |
| `softness` | number | `1` | How blurred each light is. Low is crisp, high is a soft haze. |
| `intensity` | number | `1` | How bright the whole scene is. Shown as **Brightness**. |

#### MOTION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `speed` | number | `50` | How fast the lights move and turn. 50 is the natural pace. |
| `curve` | number | `0.9` | How much the lights swell as they come to the front. Low is flat, high is deep. Shown as **Depth**. |

#### FINISH

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `vignette` | number | `0.45` | How dark the corners of the frame go. |

### Props without a control

`seed` `37` · `sweep` `0.28` · `cycle` `{ period: 16, fade: 2.4 }` ·
`animateOnCanvas` `false` · `clockwise` `true` · `warmAmount` `0.72` · `haze` `0.7` · `falloff` `0.8` ·
`breath` `0.55` · `drift` `1` · `monoLift` `0.62` · `warmB` `#E08A2A` ·
`grain` `0.014` · `maxPixelRatio` `1`

`sweep` is how fast the drum turns, in turns per second at the default speed.
It only ever confused next to Speed, so the panel keeps Speed and the turn
rate stays at the pace the reference has.

`cycle` is the base timing of the Cycle colour mode: `period` seconds for one
round trip through grayscale and back, `fade` seconds for the drain and the
flood. **Color Speed** scales both: it is squared, so 100 is four times the
base pace, 25 a quarter of it, and 0 stops the cycle and holds colour. The
raw timings only apply in that mode and no longer take a row in the panel.

`animateOnCanvas` keeps the animation running on the Framer canvas. At its
default the canvas shows one static frame and the component animates in
preview and on the published site, which is what every other component in the
kit does.

`seed` reshuffles the clusters, their positions and their widths. It has no
control on purpose: the composition is meant to be one fixed structure, so it
stays at its default unless set in code.

`clockwise` is the direction of the turn, seen from above. True sends the near
side right to left and the far side back left to right; false reverses both.

`haze` is also what the drum lines hang off: at zero the light is unstriated
and the far face's own faint grain behind the core goes with it.

`monoLift` is why grayscale reads as bright fog rather than a dimmed copy. It is
applied to a *root* of the luminance, not the luminance itself: a plain multiply
drives the highlights so far up the tone map that they clip and the whole state
flattens to one white. The root re-lifts the mid tones and leaves headroom at the
top, which is what turns local highlights into fog while positions, shapes and
travel carry on untouched.

Three constants in the source set the scale rather than the look. `DRUM_RADIUS`
(`0.46` screen widths from the axis) is where the fine lines are drawn and about
where the outer clusters ride, so at the default Depth a cluster turns round
just inside the edge of the frame. `DRUM_LINES_COARSE` and `DRUM_LINES_FINE`
(`40` and `120`) are how many lines of each scale the drum carries the whole way
round; they are integers because the noise wraps on them, which is what makes
a turn seamless. At the default Travel a full revolution takes about sixteen
seconds.

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
resolves through a CDN at whatever version is current; on r186 every instanced
draw fails with `GL_INVALID_OPERATION` and the capsule shell renders as nothing
at all. That was first traced to the shared PCF shadow code, which the component
no longer carries — the pin stays because an unpinned import is a version you
never chose, not because of that one symptom.
