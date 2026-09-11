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
colors first — with the two speed dials at the end of that group, since they
are the ones people reach for first — then form, then motion, then the finish. Panel titles are plain
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
| `speed` | number | `50` | How fast the lights move and turn. 50 is the natural pace. |

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

## Vortex Ring

A hollow ring of liquid energy seen face-on: one ribbon of two hundred thousand
glowing points circulating around a circle, twisting about its own path,
bunching into white sheets and thinning to blue threads, and continuously
tearing fountains of itself upward, inside a wide cyan atmosphere over black.
Single-file Framer code component — no imports beyond React and Framer.

### Key features

- gl.POINTS only, additively blended, in two colours and one white: a point rolled away draws the deep blue, a point on the lit face the electric cyan, a point both face-on and squeezed white — and stacking finishes it, so the blue survives only where the material is thin or turned under
- The ribbon is a strip wrapped around a circle and bent by six seeded Fourier fields — radius, twist, width, along-ring compression, density and a medium ripple — each travelling at a fraction of the flow speed, so structures drift around the ring while material streams through them
- The along-ring displacement is asymmetric, so its compression shocks: a dense stretch has a sharp leading edge and a long tail and reads as a sheet streaming round the ring, not as a bead on a string
- Upward splashes are the ring's second population: they tear off the sheet and shoot up on a short repeating life, dense at the base and separating into loose dots as they climb. Site strength is a field read at the birth angle and birth moment, so most of the ring only fizzes while a few stretches throw a fountain half a radius high, and a site builds, fires and dies as the flow passes through it
- Screen-up is up: a plume leaving the bottom of the ring rises into the hole, which the reference frames also show
- The sheet is lit from the camera: a section rolled toward you burns white, an edge-on fold is a thin line, a section rolled away is the deep-blue underside — the white-sheet / blue-fold alternation of the reference
- The split crest at the top of the ring, present in every reference frame, is a fixed screen-space feature whose strength rides on the flow through it, so the horns grow, lean and collapse while the split stays put
- Every moving term is an integer harmonic of one loop phase and the flow makes a whole number of turns per loop, so the loop is seamless by construction — no state, no reset, nothing reversed
- Six-level blurred mip chain, the widest two run three times over, for a tight bloom on the crests and an atmosphere that reaches the frame edges; the wide part is painted in one tinted colour rather than blurred from the scene, because the reference's glow has no red in it at all
- One static frame on the Framer canvas, animation in preview and on the published site; pauses off-screen and in a background tab, honours reduced motion, rebuilds after WebGL context loss, disposes everything on unmount

### API Reference

All props map directly to the controls panel, in the panel's order.

#### LAYOUT

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | number | `80` | Ring diameter as a percentage of the frame's shorter side. |
| `thickness` | number | `5` | Width of the ribbon, 0–10. 5 is the reference; 0 is a thread. |
| `particles` | number | `210000` | How many points make up the ring, spray included. More is finer grain, not brighter. |
| `pointSize` | number | `3` | Diameter of one point in px at a 900px frame. Smaller is grainier. |

#### ANIMATION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `speed` | number | `5` | How fast the material flows around the ring. 0 holds it still. |
| `direction` | enum | `"clockwise"` | `"clockwise"` or `"counterclockwise"`. |
| `shape` | object | `{ bulge: 5, twist: 5, waves: 5, turbulence: 5, gaps: 5, crown: 5 }` | The deformation, one dial per scale of motion. Bulge is the slow silhouette, Twist the roll of the sheet, Waves the lobes, Turbulence the per-point wander, Gaps how far sparse stretches thin, Crown the split crests at the top. All neutral at 5. |
| `spray` | object | `{ amount: 5, reach: 5, lift: 5 }` | The upward splashes: how much of the budget they get, how far they fan, how high the biggest plumes climb. |
| `seed` | number | `7` | Picks one fixed ring out of the family. Same seed, same ring. |

#### COLORS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `background` | color | `#000206` | The colour behind the ring. |
| `color` | color | `#3AE6FF` | The lit face of the ribbon. Where the points pile up it burns through to white. |
| `deepColor` | color | `#0A3CFF` | The rolled-away underside, showing between the bright sheets. It also sets how blue the wide atmosphere runs. |

#### EFFECTS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `glow` | object | `{ bloom: 5, halo: 5 }` | Tight bloom on the crests and the wide atmosphere around the ring. |

### Props without a control

`loopSeconds` `36` · `turns` `3` · `weight` `5` · `depth` `5` ·
`maxPixelRatio` `1.5` · `animateOnCanvas` `false`

`loopSeconds` is how long one seamless loop takes at Speed 5; Speed scales it
(10 is nearly three times the pace, 0 holds). `turns` is how many whole
circuits the material makes in one loop, and has to stay an integer for the
loop to close — that is why it is not a slider.

`weight` is the one vertical bias on the ribbon itself: how much broader the
bottom of the ring runs than the top, from the frames. `depth` is the
ribbon's thickness through its face, which is what gives an edge-on fold a
body instead of a hairline.

`animateOnCanvas` keeps the animation running on the Framer canvas. At its
default the canvas shows one static frame and the component animates in
preview and on the published site, like the rest of the kit.

## Halo Shell

A hollow globe of liquid electricity: a dense white-cyan dome with glowing
strands hanging down a spherical surface, which once a cycle gathers itself
into a bright flattened cap and one clean orbital ring, then grows back into
an irregular shell, over a near-black navy void. Single-file Framer code
component — no imports beyond React and Framer.

### Key features

- gl.POINTS only, additively blended, in one colour into a float target: the dark blue → cyan → white palette is nothing but points stacking through a per-channel tone map, so brightness can only sit where the material is densest
- Every point owns a place on one strand: a seeded path down the sphere from a root high in the dome, meandering in longitude, tapering to a tip that frays into dots. Material streams down each path a whole number of times per loop
- The dome is not an element — it is the strands' roots piling up above fifty degrees. Lateral offsets are kept as arc length, so near the pole the roots wander into a branching network of veins rather than a comb of parallels
- Forks are child strands that copy a parent's path to a branch depth and then peel away; their points double the parent's density above the branch, so a fork is brighter than either arm
- The cycle — globe, gather, ring, dissolve, regrow — is a handful of smoothstep envelopes of one loop phase, and the way in is not the way out: strands fade from the bottom and a band of material collects and tightens into the ring; later the ring frays into falling particles and new strands grow down from the cap with their tips leading
- The cap is the dome again, packed above forty-three degrees and flattened, and the ring is a share of the same points slid over the surface — three configurations of one material, never three objects
- The ring sinks while it lives, as the frames show it at two heights, and the far side of the sphere is drawn dim and half as dense, so the shell reads as a volume and the ring's far arc sits behind it
- Every moving term is an integer harmonic of the loop phase and every envelope returns to its start, so the loop is seamless by construction — no state, no reset, nothing reversed
- Four-level blurred mip chain for a tight bloom on the cap, the ring and the veins, and a wide navy halo around the sphere
- One static frame on the Framer canvas, animation in preview and on the published site; pauses off-screen and in a background tab, honours reduced motion, rebuilds after WebGL context loss, falls back to a CSS approximation without WebGL 2, disposes everything on unmount

### API Reference

All props map directly to the controls panel, in the panel's order.

#### LAYOUT

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | number | `76` | Sphere diameter as a percentage of the frame's shorter side. |
| `strands` | number | `120` | How many strands hang down the sphere, forks included. |
| `particles` | number | `120000` | How many points make up the shell. More is finer grain, not brighter. |
| `shell` | object | `{ reach: 5, width: 5, meander: 5, scatter: 5 }` | The strands' shape: how far they hang, how wide they are, how far they wander sideways, and the share of points that break loose and drift. All neutral at 5. |

#### ANIMATION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `speed` | number | `5` | How fast the energy flows and the cycle turns. 0 holds it still. |
| `cycleSeconds` | number | `30` | Seconds one globe-to-ring-and-back cycle takes at Speed 5. |
| `ring` | object | `{ height: 3, drift: 5, share: 5 }` | The orbital ring: where on the sphere it forms (0 is the equator), how far it sinks while it lives (0 holds it still), and how much of the material joins it. |
| `seed` | number | `3` | Picks one fixed globe out of the family. Same seed, same strands. |

#### COLORS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `background` | color | `#02070F` | The colour behind the sphere. |
| `color` | color | `#4FC8FF` | The one colour the points are drawn in. Where they pile up it goes cyan, then white. |
| `exposure` | number | `5` | Overall brightness (panel title "Brightness"). 5 is the reference; 10 burns the dome out. |

#### EFFECTS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `glow` | object | `{ bloom: 5, halo: 5 }` | Tight bloom on the bright regions and the wide atmosphere around the sphere. |

### Props without a control

`pointSize` `2.2` · `offsetY` `0` · `flowTrips` `3` · `branching` `5` ·
`maxPixelRatio` `1.5` · `animateOnCanvas` `false`

`pointSize` is the diameter of one point in px at a 900px frame; the
per-point intensity is calibrated against it, so it changes grain, not
brightness. `offsetY` moves the sphere up or down as a percentage of the
frame height, for when the cap's bloom needs more headroom than a centred
sphere leaves.

`flowTrips` is how many whole trips the material makes down a strand in one
cycle, and has to stay an integer for the loop to close — that is why it is
not a slider. `branching` is how many strands fork off another, 0–10; it
changes the strand family, so it rebuilds the lattice.

`animateOnCanvas` keeps the animation running on the Framer canvas. At its
default the canvas shows one static frame and the component animates in
preview and on the published site, like the rest of the kit.

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

## Energy Form

A suspended structure of electricity — an octahedral crystal or a sphere — that
gathers out of magenta dust, floods with orange-white energy from its poles,
cools, bends, breaks back into particles and gathers again, ringed by a wide
equatorial band of pink particles. Single-file Framer code component — no
imports beyond React and Framer.

Built from nine frames of a reference loop. Where the brief and the frames
disagree the frames win, and the component header says where.

### Key features

- One component, two shapes: the diamond of the reference and a spherical field made of the same material — same points, same lines, same nodes, same cycle, same band; only the geometry changes
- Three additive primitives into a half-float buffer, then a five-level bloom: tiny points (tens of thousands), thin screen-facing ribbons for the structural lines, and one core-and-halo sprite per anchor node. Raw WebGL, no three.js
- Every point owns a home on the structure — on a line, on a face or the shell, inside the volume, on the band, or leaving a node — and a loose position off it. Assembly slides points onto their homes; dissolution slides them off. Nothing is emitted or destroyed, so the two states are always continuous
- One heat ramp — magenta → pink → red → orange → yellow-white — indexed by a local heat, so a line can still be hot beside dust that has cooled. Whites are stacking and bloom on top of orange, never a white element
- The surge is polar, as in the frames: assembly and heat travel as a front from the poles to the equator, the caps blow out and draw material toward the axis while the front is still near them, and the full orange crystal is what the front looks like once it has arrived
- A two-lobed field drifting over the object offsets assembly locally, so one edge holds while the one beside it is dust; lines break along their length the same way, and the points that lived on them are what remains
- Lines bow with a few loop-safe sinusoids — stiff while assembled, loose while dissolving, internal lines several times more than the outer edges — and the points on a line ride the same function
- Pulses run along each line from the shallower node, with a bright head and a fading tail; a node flares when a pulse leaves or arrives
- The band is a ring of points in world space with inner rings orbiting faster, a lobed vertical wave, corrugation when dense and haze when loose; its far side is dimmed where it lies behind the silhouette and is farther, so it wraps
- One master loop of three energy cycles, every moving term a sinusoid of the loop or cycle phase with a whole-number frequency, whole turns and whole orbits — seamless by construction, and no two cycles break up the same way
- Draws one frame on the Framer canvas at a chosen phase and animates in preview and on the published site; pauses off-screen and in a background tab, honours reduced motion, rebuilds after context loss, disposes everything on unmount

### API Reference

All props map directly to the controls panel, in this order: layout, animation,
colours, then the grouped effect dials. Dials are 0–10 with 5 neutral.

#### LAYOUT

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `shape` | enum | `"diamond"` | `"diamond"` or `"sphere"`. |
| `size` | number | `66` | Object height as a percentage of the frame's shorter side. |
| `particles` | number | `60000` | Points in the structure and band together, 4,000–200,000. |
| `pointSize` | number | `2.2` | Point diameter in CSS px at a 900px frame. |

#### ANIMATION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `speed` | number | `5` | Playback rate. 0 holds the frame at the start phase. |
| `cycleSeconds` | number | `22` | Seconds per energy cycle at speed 5. The loop is three cycles. |
| `rotation` | number | `5` | Whole turns per loop plus wobble. 0 holds still. |
| `phase` | number | `0.42` | Where in the cycle to begin, and the frame the canvas shows. 0.42 is the assembled crystal, 0.2 the surge, 0.65 cooling, 0.95 sparse. |

#### COLORS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `background` | color | `#050206` | The colour behind everything. |
| `hue` | number | `0` | Rotates the whole palette, in degrees. |

#### EFFECTS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `energy` | object | `{ heat: 5, dissolve: 5, flow: 5, surge: 5 }` | Peak temperature, how far the shape comes apart, pulses per cycle, and the polar blow-out. |
| `lines` | object | `{ thickness: 5, bend: 5, inner: 5 }` | Line width, flexibility, and the brightness of the internal lines. |
| `band` | object | `{ amount: 5, radius: 5, wave: 5, speed: 5 }` | Density, radius, vertical wave and orbits per loop of the equatorial band. |
| `glow` | object | `{ bloom: 5, atmosphere: 4, nodes: 5 }` | Bloom on the cores, the red haze around the object, and node size. |
| `seed` | number | `7` | Reseeds the interior junctions, the sphere's anchors and every point's home. |

### Props without a control

`maxPixelRatio` `1.5` · `poleDots` `true` (the two detached dots above and
below the object on its axis)

Whole-number dials: `rotation`, `energy.flow` and `band.speed` round to whole
turns, pulses and orbits per loop, so any setting keeps the loop seamless.
