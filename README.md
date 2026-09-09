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
- Drag to orbit, wheel/pinch to zoom, plus optional auto-rotate
- Pauses off-screen, survives WebGL context loss, disposes everything on unmount

### API Reference

All props map directly to the controls panel sliders and color pickers.

#### LAYOUT

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `capsuleCount` | number | `3000` | How many capsules make up the sphere. Higher is denser and costs more to draw. |
| `capsuleScale` | number | `0.06` | The thickness of each individual capsule. |
| `orbCount` | number | `4` | How many glass marbles orbit the sphere and dent it as they pass. |
| `orbSize` | number | `0.3` | The radius of each marble. The dents it carves scale with it. |
| `distance` | number | `5` | Camera distance, framing the orb tighter or wider. |

#### ANIMATION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `speed` | number | `1` | How fast the marbles travel around their orbits. |
| `autoRotate` | boolean | `false` | Spins the camera around the orb on its own. |
| `animateOnCanvas` | boolean | `false` | Keep animating on the Framer canvas instead of rendering one static frame. |

#### INTERACTION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `interactive` | boolean | `true` | Lets visitors drag to orbit the camera and zoom. |

#### COLORS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `backgroundLeft` | color | `#AEB2B5` | The first stop of the background gradient. |
| `backgroundRight` | color | `#939A9D` | The second stop of the background gradient. |
| `capsuleColor` | color | `#B2B8BB` | The base color of the capsules before lighting. |

#### LIGHT

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `lightAngle` | number | `166` | Rotates the key light around the orb, in degrees. |
| `lightHeight` | number | `0.78` | Raises or lowers the key light above the orb. |

#### EFFECTS

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `bloomIntensity` | number | `2` | How strongly the bright edges glow. |

### Props without a control

The scene supports more than the panel exposes. These stay props with the
defaults below — pass them in code, or promote one to a control when it earns a
row:

`bulge` `0.4` · `dentSize` `1` · `orbDistance` `1.9` · `autoRotateSpeed` `0.3` ·
`allowZoom` `true` · `gradientAngle` `0` · `coreColor` `#111111` ·
`glassTint` `#FFFFFF` · `shadowStrength` `0.6` · `contactShadow` `0.3` ·
`refraction` `1.45` · `glassThickness` `0.6` · `bloomThreshold` `0.65` ·
`bloomSpread` `0.85` · `vignette` `0.6` · `vignetteSpread` `0.3` ·
`maxPixelRatio` `1.5` · `noiseImage` · `matcapImage`

### Two things worth not undoing

**three.js is pinned to a full URL.** `import * as THREE from "https://esm.sh/three@0.170.0"`.
A bare `"three"` resolves through a CDN at whatever version is current; on r186
the shadow sampler types no longer match, every instanced draw fails with
`GL_INVALID_OPERATION`, and the capsule shell renders as nothing.

**No Enum controls.** An Enum whose `options` are numbers loses them outside
Framer — option lists are read as strings — and the component then receives `""`
where it expected a number. That is how `maxPixelRatio` once reached
`setPixelRatio(0)` and produced a 0×0 canvas. `orbCount` is a stepper for this
reason, and numeric props are read through `num()` so a bad value falls back
instead of coercing to zero.

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
- Reseedable layout, a built-in "AI modified" pill, and dithered output so the near-black falloffs never band
- Pauses off-screen, rebuilds itself after WebGL context loss, and disposes everything on unmount

### API Reference

All props map directly to the controls panel sliders and color pickers.

#### COMPOSITION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `coolCount` | number | `15` | Sets how many green and teal columns make up the light field. |
| `warmCount` | number | `9` | Sets how many red and amber glows sit underneath them. Zero removes the warm layer. |
| `warmAmount` | number | `1` | Controls how strongly the warm glows read against the greens. |
| `softness` | number | `1` | Scales the width of every column, from tight shafts to broad clouds. |
| `haze` | number | `0.55` | Controls the frosted striation and the fog filling the gaps between columns. |
| `falloff` | number | `0.8` | Controls how quickly the light dies towards the bottom of the frame. |
| `intensity` | number | `1` | Sets the overall exposure of the light field. |
| `seed` | number | `37` | Reshuffles the whole layout. Each value is a different composition. |

#### ANIMATION

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `speed` | number | `1` | Controls how fast the whole field evolves. Zero freezes it. |
| `breath` | number | `1` | Controls how much each column swells, brightens and shifts over time. |
| `drift` | number | `1` | Controls how far columns wander sideways. |
| `animateOnCanvas` | boolean | `false` | Keeps the field animating on the Framer canvas instead of rendering one static frame. |

#### COLOR

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `colorMode` | enum | `cycle` | Cycles between color and grayscale, or holds either one. |
| `cyclePeriod` | number | `16` | Sets how long one full color-to-grayscale-and-back round trip takes, in seconds. |
| `cycleFade` | number | `2.4` | Sets how long the color takes to drain and to return, in seconds. |
| `monoLift` | number | `1.45` | Brightens the grayscale state, which is what makes it read as foggier than the color one. |
| `background` | color | `#03080B` | Sets the near-black the lights float in. Grayscale states fade it to true black. |
| `coolA` | color | `#1BE087` | Sets the emerald most columns are drawn from. |
| `coolB` | color | `#0A6B60` | Sets the teal the dimmer columns fall back to. |
| `warmA` | color | `#C2264F` | Sets the crimson used on the left of the frame. |
| `warmB` | color | `#E08A2A` | Sets the amber the warm glows shift to on the right. |

#### FINISH

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `vignette` | number | `0.45` | Controls how dark the corners of the frame go. |
| `grain` | number | `0.014` | Adds dither. Lowering it towards zero can band the dark gradients. |

#### LABEL

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `showLabel` | boolean | `true` | Shows the rounded pill in the bottom-left corner. |
| `labelText` | string | `AI modified` | Sets the text inside the pill. |
| `labelColor` | color | `#E4E4E4` | Sets the text color. |
| `labelBackground` | color | `rgba(28, 28, 28, 0.72)` | Sets the pill fill. It sits over a blur of the light behind it. |
| `labelSize` | number | `16` | Sets the text size. The pill's padding scales with it. |
| `labelInset` | number | `24` | Sets how far the pill sits in from the left and bottom edges. |

#### PERFORMANCE

| Props | Type | Default | Description |
| --- | --- | --- | --- |
| `maxPixelRatio` | enum | `1` | Caps the render resolution. Low is fastest and costs little here, since the image is blurred anyway. |
