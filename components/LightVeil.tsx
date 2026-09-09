import { useEffect, useRef } from "react"
import type { CSSProperties } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"

/**
 * LightVeil
 *
 * A dark ambient light field: broad emerald haze, glowing teal bands and a few
 * narrow bright streaks, all behind frosted glass, with muted red and amber
 * glows surfacing underneath them, cycling between full colour and drained
 * grayscale.
 *
 * The composition is a drum turning about a vertical axis through the middle
 * of the frame. A dense core of light stands close to the axis and hardly
 * moves. Around it, clumps of light ride the drum: one swings forward across
 * the front — wide, bright and quick — slows as it reaches the flank, turns,
 * and tracks back behind the core, small and dim and running the other way,
 * before coming round again. The drum itself is textured with fine vertical
 * lines, packed far more tightly on the far face than the near one, so the
 * background is a dense grain always travelling against the foreground. The
 * structure never changes; only the angle it is seen from does.
 *
 * Everything is one full-screen fragment shader on a raw WebGL context — no
 * three.js, no post-processing package, no textures. The multi-tier softness
 * (narrow core, diffused body, wide halo), the drum striation and the
 * grayscale drain are all done in the same pass.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Shader loop ceilings. The uniform counts break out early below these. */
const MAX_HAZE_MASSES = 12
const MAX_BANDS = 48
const MAX_STREAKS = 40
const MAX_WARM_LIGHTS = 20

/**
 * How many clumps of light ride the carousel. Every light belongs to one, so a
 * clump carries its own haze, bands, streaks and warm glows round together and
 * turns as one body instead of dissolving on the way. Slightly under half of
 * them stay in the core; the rest ride the drum.
 */
const CLUSTERS = 14

/**
 * Turns of the carousel each second at Travel 1. At the default Travel a full
 * revolution takes about sixteen seconds — slow enough that the frame reads as
 * the same clumps seen from a changing angle, not as traffic going past.
 */
const TURNS_PER_SECOND = 0.22

/**
 * The drum the fine lines are drawn on: its radius in screen widths from the
 * axis, and how many broad and fine lines it carries the whole way round. The
 * line counts are integers because the noise wraps on them — that is what makes
 * a full turn seamless.
 */
const DRUM_RADIUS = 0.46
const DRUM_LINES_COARSE = 40
const DRUM_LINES_FINE = 120

/**
 * The layer counts at Density 16. A carousel keeps all of its light on screen at
 * once — the far half is merely small and dim — so unlike a field that slides
 * past, these are what the frame actually holds at any moment.
 */
const BASE_DENSITY = 16
const HAZE_AT_BASE = 8
const BANDS_AT_BASE = 34
const STREAKS_AT_BASE = 28

const DEFAULT_BACKGROUND = "#03080B"
const DEFAULT_COOL_A = "#1BE087"
const DEFAULT_COOL_B = "#0A6B60"
const DEFAULT_WARM_A = "#C2264F"
const DEFAULT_WARM_B = "#E08A2A"

/** Multiplier on TURNS_PER_SECOND. 1 is one revolution every four and a half seconds. */
const DEFAULT_SWEEP = 0.28

/**
 * How much nearer the front of the turn is than the back, as a fraction of the
 * ring's own radius. Zero is a flat wheel with no depth at all; one puts the
 * viewer one screen width from the axis, so the near side of the drum is
 * roughly two and a half times the size and speed of the far side.
 */
const DEFAULT_CURVE = 0.9

/** Speed is a 0-100 dial; this is where it sits at 1x, so it can be halved or doubled. */
const BASE_SPEED = 50

/** Default for the grouped Cycle control, also used when one of its fields arrives missing. */
const DEFAULT_CYCLE = { period: 16, fade: 2.4 }

// ─────────────────────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────────────────────

const VERTEX_SHADER = /* glsl */ `
    attribute vec2 a_position;
    varying vec2 v_uv;

    void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`

const NOISE_GLSL = /* glsl */ `
    // Multiply-and-fract hashes rather than the usual sin(x) * 43758.5 trick: the
    // sine version drifts badly once the argument grows, and highp float on a
    // phone would not draw the same composition a desktop does.
    float hash11(float n) {
        n = fract(n * 0.1031);
        n *= n + 33.33;
        n *= n + n;
        return fract(n);
    }

    float hash21(vec2 p) {
        vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
        q += dot(q, vec3(q.y, q.z, q.x) + 33.33);
        return fract((q.x + q.y) * q.z);
    }

    float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
        float sum = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 4; i++) {
            sum += amp * vnoise(p);
            p *= 2.03;
            amp *= 0.5;
        }
        return sum;
    }

    /**
     * Value noise that wraps in x every \`period\` cells and runs on in y. This is
     * what the drum is textured with: x is the angle round it, so the pattern
     * has to meet itself after one turn or the seam would sweep past once a
     * revolution.
     */
    float vnoiseWrap(vec2 p, float period) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float x0 = mod(i.x, period);
        float x1 = mod(i.x + 1.0, period);
        float a = hash21(vec2(x0, i.y));
        float b = hash21(vec2(x1, i.y));
        float c = hash21(vec2(x0, i.y + 1.0));
        float d = hash21(vec2(x1, i.y + 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    /** Three octaves of the wrapping noise, normalised to 0-1. The period doubles with the frequency so every octave still wraps. */
    float fbmWrap(vec2 p, float period) {
        float sum = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 3; i++) {
            sum += amp * vnoiseWrap(p, period);
            p *= 2.0;
            period *= 2.0;
            amp *= 0.5;
        }
        return sum / 0.875;
    }

    /** Unit gaussian. Scaling the argument up narrows the falloff, down widens it. */
    float gauss(float d) {
        return exp(-d * d);
    }
`

const FRAGMENT_SHADER = /* glsl */ `
    precision highp float;

    varying vec2 v_uv;

    uniform float u_time;
    uniform float u_mono;
    uniform float u_monoLift;
    uniform float u_intensity;
    uniform float u_softness;
    uniform float u_breath;
    uniform float u_drift;
    uniform float u_sweep;
    uniform float u_curve;
    uniform float u_direction;
    uniform float u_haze;
    uniform float u_falloff;
    uniform float u_vignette;
    uniform float u_grain;
    uniform float u_hazeCount;
    uniform float u_bandCount;
    uniform float u_streakCount;
    uniform float u_warmCount;
    uniform float u_warmAmount;
    uniform float u_seed;
    uniform vec3 u_background;
    uniform vec3 u_coolA;
    uniform vec3 u_coolB;
    uniform vec3 u_warmA;
    uniform vec3 u_warmB;

    ${NOISE_GLSL}

    // ── The carousel ─────────────────────────────────────────────────────────
    // Nothing slides. The light stands in clumps set off from a vertical axis
    // through the middle of the frame, and the whole arrangement turns about
    // that axis. A clump on the drum swings forward across the front — wide,
    // bright and quick — slows as it reaches the flank, then tracks back behind
    // the core, narrow and dim and running the other way, before coming round
    // again. The core clumps sit close to the axis and barely move at all. The
    // clumps themselves do not change: this is one structure seen from a
    // turning angle rather than a procession of new material.

    const float TAU = 6.28318530;
    const float PI = 3.14159265;

    /** How many clumps the carousel carries. */
    float clusterCount() { return ${CLUSTERS}.0; }

    /**
     * How far the carousel has turned by time t, in radians.
     *
     * One direction, forever, and seamless with no trickery at all: an angle
     * wraps on its own, so there is no field width to run out of and no seam to
     * hide. The two swings on top vary the rate by about +-13% so the turn
     * breathes instead of grinding round at a machine-constant pace; their
     * derivatives sum to well under the base rate, which makes the direction
     * monotonic by construction rather than by tuning. The sign is the
     * direction: negative turns the drum clockwise seen from above, so the near
     * side tracks right to left and the far side comes back left to right.
     */
    float carousel(float t) {
        return u_direction * TAU * ${TURNS_PER_SECOND} * u_sweep *
            (t + 0.32 * sin(t * 0.23) + 0.55 * sin(t * 0.11 + 1.7));
    }

    /** Where clump k stands on the turn, spaced unevenly so it never reads as spokes. */
    float clusterPhase(float k, float nc) {
        float r = hash11(k * 4.17 + u_seed + 19.0);
        return (k + 0.10 + 0.80 * r) / nc;
    }

    /**
     * How far clump k stands off the axis.
     *
     * Two populations, not one spread. A little under half the clumps are the
     * core: they stand so close to the axis that a full turn moves them only a
     * fraction of the frame, so the middle stays put and stays dense. The rest
     * ride the drum, at about the radius the fine lines are drawn on, so they
     * swing right across the frame and turn round at its flanks.
     */
    float clusterRadius(float k) {
        float r = hash11(k * 8.53 + u_seed + 131.0);
        float q = hash11(k * 2.71 + u_seed + 211.0);
        return q < 0.42 ? 0.04 + 0.16 * r : 0.36 + 0.14 * r;
    }

    /** Each clump's axis is nudged off centre, so the carousel is not one tidy wheel. */
    float clusterAxis(float k) {
        return 0.5 + (hash11(k * 6.29 + u_seed + 173.0) - 0.5) * 0.14;
    }

    /**
     * A slow swell shared by everything in one clump. Kept shallow: the
     * structure is meant to stay recognisably the same from one turn to the
     * next, so a clump may lead for a while but never vanishes.
     */
    float clusterGain(float k, float t) {
        float r = hash11(k * 8.53 + u_seed + 67.0);
        return 0.60 + 0.55 * (0.5 + 0.5 * sin(t * (0.05 + r * 0.055) + r * 6.2832));
    }

    /**
     * Where a light on this ring is now, measured from its own axis, and how
     * near the viewer that puts it.
     *
     * front is +1 dead in front of the axis and -1 straight behind it, and the
     * perspective zoom falls out of it: on the near side a light is closer to
     * the camera, so it is wider, taller, brighter and crosses the frame faster
     * than the same light does on the way back, and it passes in front of the
     * core while the far ones pass behind. The screen speed is the derivative
     * of this — greatest dead in front, zero at the flank where the light turns,
     * and reversed and smaller round the back.
     */
    float ringOffset(float phase, float radius, float a, out float front, out float zoom) {
        float th = phase * TAU + a;
        front = cos(th);
        // Clamped so a wide ring at full depth cannot divide its way to infinity.
        zoom = 1.0 / max(1.0 - front * radius * u_curve, 0.35);
        return radius * sin(th) * zoom;
    }

    /** How much of a light belongs to the near face, given where it is on the turn. */
    float nearWeight(float front) {
        return smoothstep(-0.35, 0.35, front);
    }

    void main() {
        float x = v_uv.x;
        // v runs 0 at the top edge to 1 at the bottom — the light hangs downwards.
        float v = 1.0 - v_uv.y;

        float t = u_time;
        float a = carousel(t);
        float nc = clusterCount();

        // The whole field leans and wobbles, as if seen through moving glass.
        // The warp is applied to the sampling position, after the projection,
        // so it reads as a flaw in the glass rather than a dent in the turning
        // arrangement behind it.
        float warp = fbm(vec2(x * 3.1 + u_seed, v * 0.85 + t * 0.02)) - 0.5;
        float px = x + warp * 0.07 * u_softness;

        // Parallax. Every layer turns on the same angle — a layer running at its
        // own rate would pull a clump apart within one revolution — and instead
        // stands off the axis by a different amount. The haze rides an inner
        // ring, so it sweeps a narrower arc than the streaks outside it, which
        // is what parallax actually is rather than an imitation of it.
        float rHaze = 0.86;
        float rBand = 0.95;
        float rStreak = 1.0;
        float rWarm = 0.92;

        // Light on the near face and light on the far face are kept apart until
        // the end, because each is seen through its own face of the drum.
        vec3 glowNear = vec3(0.0);
        vec3 glowFar = vec3(0.0);

        // ── Haze masses: the broad glowing clouds that carry the frame ───────
        for (int i = 0; i < ${MAX_HAZE_MASSES}; i++) {
            float fi = float(i);
            if (fi >= u_hazeCount) break;

            float r1 = hash11(fi * 1.37 + u_seed + 3.0);
            float r2 = hash11(fi * 3.91 + u_seed + 29.0);
            float r3 = hash11(fi * 6.11 + u_seed + 53.0);

            float k = floor(r1 * nc);
            float front, zoom;
            float cx = clusterAxis(k) + ringOffset(
                clusterPhase(k, nc) + (r2 - 0.5) * 0.05,
                clusterRadius(k) * rHaze * (0.90 + 0.20 * r3),
                a, front, zoom);

            // Wide enough that neighbours run together into one continuous mass,
            // and wider again on the near side of the turn.
            float w = (0.060 + 0.115 * r3) * u_softness * zoom;
            w *= 1.0 + 0.30 * u_breath * sin(t * (0.07 + r1 * 0.09) + r2 * 6.2832);

            // Past ~3 sigma of the widest tier a light contributes less than one
            // 8-bit step, so it is skipped before it costs anything. The test sits
            // as high as it can — everything below is work a rejected light would
            // have thrown away — and neighbouring pixels agree on which lights are
            // near, so the branch stays coherent. This is what pays for a field of
            // ninety lights at 1080p.
            float dx = px - cx;
            if (abs(dx) > w * 5.9) continue;

            // They sit high — upper and middle of the frame, not the floor. The
            // rings are seen slightly from above, so a mass on the near side
            // also rides a little lower than the same one round the back.
            float cy = 0.14 + r2 * 0.20 + 0.04 * front;
            // Only half the zoom goes into the height: at full strength a near
            // mass grows tall enough to blanket the frame, and the dark floor is
            // the first thing to go.
            float ry = (0.16 + r3 * 0.20) * mix(1.0, zoom, 0.5) * (0.85 + 0.50 * clamp(cx, 0.0, 1.0));
            ry *= 1.0 + 0.22 * u_breath * sin(t * (0.06 + r3 * 0.08) + r1 * 6.2832);

            // Near light is bright light. Together with the width and height the
            // zoom already gave it, this is what makes a clump read as coming
            // forward and going back rather than travelling across.
            float amp = (0.050 + 0.16 * r3) * clusterGain(k, t) * mix(0.34, 1.36, 0.5 + 0.5 * front);

            float d = dx / max(w, 0.004);
            float dv = (v - cy) / max(ry, 0.02);
            // Two tiers only. This layer is a cloud, never a shaft.
            vec3 hue = mix(u_coolB, u_coolA, r1 * 0.35);
            vec3 c = hue * (gauss(d) * 0.52 + gauss(d * 0.55) * 0.08) * gauss(dv) * amp;
            float nw = nearWeight(front);
            glowNear += c * nw;
            glowFar += c * (1.0 - nw);
        }

        // ── Bands: medium-width emerald and teal shafts ──────────────────────
        for (int i = 0; i < ${MAX_BANDS}; i++) {
            float fi = float(i);
            if (fi >= u_bandCount) break;

            float r1 = hash11(fi * 1.73 + u_seed);
            float r2 = hash11(fi * 3.31 + u_seed + 17.0);
            float r3 = hash11(fi * 5.17 + u_seed + 41.0);
            float r4 = hash11(fi * 7.93 + u_seed + 73.0);
            float r5 = hash11(fi * 9.37 + u_seed + 101.0);

            float k = floor(r1 * nc);
            float front, zoom;
            float cx = clusterAxis(k) + ringOffset(
                clusterPhase(k, nc) + (r2 - 0.5) * 0.045,
                clusterRadius(k) * rBand * (0.90 + 0.20 * r3),
                a, front, zoom);
            cx += sin(t * (0.09 + r3 * 0.11) + r4 * 6.2832) * 0.020 * u_drift;

            float girth = pow(r3, 1.5);
            float w = (0.022 + 0.070 * girth) * u_softness * zoom;
            w *= 1.0 + 0.40 * u_breath * sin(t * (0.10 + r4 * 0.15) + r5 * 6.2832);

            float dx = px - cx;
            if (abs(dx) > w * 7.3) continue;

            // Most hang from the top edge, but a fair few begin around the
            // middle, so the lengths never line up into a row.
            float top = mix(0.0, 0.34, pow(r2, 1.6)) + 0.03 * front;

            // How far down the frame this band survives before dissolving. It
            // grows with the zoom, so a band coming forward lengthens as well as
            // widening — the two together are what sell the approach.
            float reach = top + (0.20 + r4 * 0.40) * zoom * (0.80 + 0.65 * clamp(cx, 0.0, 1.0));
            reach *= 1.0 + 0.20 * u_breath * sin(t * (0.08 + r1 * 0.12) + r2 * 6.2832);

            float amp = (0.07 + 0.95 * pow(r5, 2.2)) * mix(0.60, 1.20, girth) * clusterGain(k, t);
            amp *= mix(0.30, 1.40, 0.5 + 0.5 * front);
            amp *= 1.0 + 0.40 * u_breath * sin(t * (0.13 + r2 * 0.18) + r4 * 6.2832);
            amp = max(amp, 0.0);

            float vprof = smoothstep(top - 0.28, top + 0.10, v) * (1.0 - smoothstep(reach * 0.38, reach, v));

            // Wide and hazy up top, tapering on the way down.
            float vt = clamp((v - top) / max(reach - top, 0.001), 0.0, 1.0);
            float wv = max(w * mix(1.25, 0.72, vt * vt), 0.003);

            float d = dx / wv;
            // Brightness rises and falls along the band instead of running flat.
            float lv = 0.66 + 0.34 * sin(v * (5.0 + r2 * 7.0) + r3 * 6.2832 + t * 0.30 * u_breath);
            vec3 hue = mix(u_coolA, u_coolB, pow(r4, 1.7) * 0.90);
            vec3 c = hue * (gauss(d) * 0.32 + gauss(d * 0.55) * 0.08) * lv * vprof * amp;
            float nw = nearWeight(front);
            glowNear += c * nw;
            glowFar += c * (1.0 - nw);
        }

        // ── Streaks: the narrow lights, with cores ───────────────────────────
        for (int i = 0; i < ${MAX_STREAKS}; i++) {
            float fi = float(i);
            if (fi >= u_streakCount) break;

            float r1 = hash11(fi * 2.29 + u_seed + 131.0);
            float r2 = hash11(fi * 4.61 + u_seed + 149.0);
            float r3 = hash11(fi * 6.83 + u_seed + 167.0);
            float r4 = hash11(fi * 8.09 + u_seed + 181.0);
            float r5 = hash11(fi * 9.91 + u_seed + 197.0);

            float k = floor(r1 * nc);
            float front, zoom;
            // Tighter to the clump's own phase than the haze, so streaks land
            // inside the clouds rather than out in the dark between them.
            float cx = clusterAxis(k) + ringOffset(
                clusterPhase(k, nc) + (r2 - 0.5) * 0.035,
                clusterRadius(k) * rStreak * (0.92 + 0.16 * r3),
                a, front, zoom);
            cx += sin(t * (0.10 + r3 * 0.13) + r5 * 6.2832) * 0.016 * u_drift;

            float w = (0.0095 + 0.015 * r3) * u_softness * zoom;
            w *= 1.0 + 0.35 * u_breath * sin(t * (0.12 + r4 * 0.16) + r2 * 6.2832);

            float dx = px - cx;

            if (abs(dx) > w * 13.9) continue;


            // Some are tall, some are a short concentrated highlight halfway down.
            float top = mix(0.0, 0.40, pow(r2, 1.4)) + 0.03 * front;
            // Some stretch downwards over time and pull back up again.
            float reach = top + (0.14 + r4 * 0.46) * zoom * (0.80 + 0.65 * clamp(cx, 0.0, 1.0));
            reach *= 1.0 + 0.26 * u_breath * sin(t * (0.09 + r1 * 0.13) + r3 * 6.2832);

            // Where the bright core sits, and how far it shifts inside its halo.
            float head = top + 0.05 + r5 * 0.30;
            head += 0.10 * u_breath * sin(t * (0.12 + r5 * 0.14) + r3 * 6.2832);

            // Weighted, so most stay dim and only a handful truly burn.
            float amp = (0.05 + 1.35 * pow(r5, 2.6)) * clusterGain(k, t);
            amp *= mix(0.26, 1.44, 0.5 + 0.5 * front);
            amp *= 1.0 + 0.45 * u_breath * sin(t * (0.14 + r2 * 0.18) + r4 * 6.2832);
            amp = max(amp, 0.0);

            float vprof = smoothstep(top - 0.20, top + 0.06, v) * (1.0 - smoothstep(reach * 0.40, reach, v));
            float vt = clamp((v - top) / max(reach - top, 0.001), 0.0, 1.0);
            float wv = max(w * mix(1.30, 0.65, vt * vt), 0.0022);

            float d = dx / wv;
            float hv = (v - head) / (0.06 + r1 * 0.16);
            vec3 hue = mix(u_coolA, u_coolB, pow(r4, 2.0) * 0.85);
            // Diffused body under a much wider halo, and no edge on either.
            vec3 c = hue * (gauss(d) * 0.22 + gauss(d * 0.30) * 0.11) * vprof * amp;
            // Cores bloom towards white-green without ever reading as a beam.
            c += mix(hue, vec3(1.0), 0.34) * (gauss(d * 1.0) * 0.50 + gauss(d * 2.0) * 0.28) * gauss(hv) * vprof * amp * 1.5;
            float nw = nearWeight(front);
            glowNear += c * nw;
            glowFar += c * (1.0 - nw);
        }

        // ── Warm lights: dim reds and ambers under the greens ────────────────
        for (int i = 0; i < ${MAX_WARM_LIGHTS}; i++) {
            float fi = float(i);
            if (fi >= u_warmCount) break;

            float r1 = hash11(fi * 2.11 + u_seed + 211.0);
            float r2 = hash11(fi * 4.27 + u_seed + 233.0);
            float r3 = hash11(fi * 6.53 + u_seed + 257.0);
            float r4 = hash11(fi * 8.71 + u_seed + 283.0);

            float k = floor(r1 * nc);
            float front, zoom;
            float cx = clusterAxis(k) + ringOffset(
                clusterPhase(k, nc) + (r2 - 0.5) * 0.04,
                clusterRadius(k) * rWarm * (0.90 + 0.20 * r2),
                a, front, zoom);
            cx += sin(t * (0.08 + r3 * 0.10) + r4 * 6.2832) * 0.016 * u_drift;

            float w = (0.018 + 0.040 * pow(r2, 1.3)) * u_softness * zoom;
            w *= 1.0 + 0.40 * u_breath * sin(t * (0.09 + r3 * 0.13) + r1 * 6.2832);

            float dx = px - cx;

            if (abs(dx) > w * 6.4) continue;


            // These live across the middle and lower middle of their own clump,
            // never the full height.
            float cy = 0.34 + r3 * 0.22 + 0.04 * front + 0.20 * clamp(cx, 0.0, 1.0);
            cy += 0.05 * u_breath * sin(t * (0.11 + r4 * 0.12) + r2 * 6.2832);
            float ry = (0.10 + r4 * 0.20) * zoom;

            float amp = (0.18 + 0.95 * pow(r4, 1.4)) * u_warmAmount * clusterGain(k, t);
            amp *= mix(0.32, 1.38, 0.5 + 0.5 * front);
            amp *= 1.0 + 0.50 * u_breath * sin(t * (0.14 + r1 * 0.16) + r3 * 6.2832);
            amp = max(amp, 0.0);

            float d = dx / max(w, 0.002);
            float dv = (v - cy) / ry;

            // Crimson and amber, drawn per light rather than by position, so a
            // cluster can hold one of each.
            vec3 hue = mix(u_warmA, u_warmB, smoothstep(0.10, 0.90, r3));
            vec3 c = hue * (gauss(d) * 0.52 + gauss(d * 0.50) * 0.14) * gauss(dv) * amp;
            float nw = nearWeight(front);
            glowNear += c * nw;
            glowFar += c * (1.0 - nw);
        }

        // ── The drum: the fine lines ─────────────────────────────────────────
        // Screen x is mapped back onto a cylinder about the axis, once for the
        // face nearest the viewer and once for the face behind it. Both come
        // from the same projection the lights use, solved for the angle, so a
        // line on the near face and a light on the near ring move together: fast
        // across the middle, slowing towards the flank, still at the silhouette.
        // The far face shows through the near one the way the far lights show
        // through the near ones — squeezed towards the axis by the perspective,
        // so its lines pack far more tightly, and running the opposite way.
        // The lines are noise fixed to the drum, not drawn one by one, so the
        // fine texture in the reference costs two lookups whatever its density.
        // The drum takes only a trace of the glass warp: its lines are meant
        // to hang straight, and at this density the full warp turns them into
        // hair.
        float xp = x + warp * 0.016 * u_softness - 0.5;
        float kd = ${DRUM_RADIUS} * u_curve;
        float s = clamp(xp / sqrt(${DRUM_RADIUS} * ${DRUM_RADIUS} + xp * xp * kd * kd), -1.0, 1.0);
        float lean = atan(xp * kd, ${DRUM_RADIUS});
        float asn = asin(s);
        // Where on the material this pixel lands, in turns, for each face.
        float turnNear = (asn - lean - a) / TAU;
        float turnFar = (PI - asn - lean - a) / TAU;

        // Stretched hard in y so it smears rather than speckles, with a slow
        // downward crawl. A broad scale shapes the clouds and is given most of
        // the depth, so the field gathers into clumps with darker gaps between
        // them; a fine one, kept shallow — in the reference the grain is a
        // faint texture on the masses, never etched lines — is the vertical grain.
        float vy = v * 1.2 - t * 0.025;
        float coarseNear = fbmWrap(vec2(turnNear * ${DRUM_LINES_COARSE}.0, vy), ${DRUM_LINES_COARSE}.0);
        float coarseFar = fbmWrap(vec2(turnFar * ${DRUM_LINES_COARSE}.0 + 11.0, vy + 5.0), ${DRUM_LINES_COARSE}.0);
        float fineNear = fbmWrap(vec2(turnNear * ${DRUM_LINES_FINE}.0, v * 2.6 - t * 0.018 + 3.0), ${DRUM_LINES_FINE}.0);
        float fineFar = fbmWrap(vec2(turnFar * ${DRUM_LINES_FINE}.0 + 37.0, v * 2.6 - t * 0.018 + 9.0), ${DRUM_LINES_FINE}.0);
        float linesNear = 0.78 + 0.40 * fineNear;
        float linesFar = 0.72 + 0.50 * fineFar;
        float striateNear = (0.26 + 1.30 * coarseNear) * linesNear;
        float striateFar = (0.24 + 1.32 * coarseFar) * linesFar;

        // Each face's light is seen through its own face of the drum.
        vec3 glow = glowNear * mix(1.0, striateNear, u_haze) + glowFar * mix(1.0, striateFar, u_haze);

        // The far face on its own, faintly, packed around the axis: the dense
        // background of thin lines behind the core, there even between the far
        // lights, and always running against the near ones.
        float axisMask = exp(-xp * xp * 9.0) * (1.0 - smoothstep(0.10, 0.70, v)) * smoothstep(-0.05, 0.12, v);
        glow += mix(u_coolB, u_coolA, 0.25) * striateFar * axisMask * u_haze * 0.04;

        // ── The diagonal ─────────────────────────────────────────────────────
        // The reference is composed on a diagonal, not a horizon: the light hangs
        // from the top edge on the left, sits lower and lower towards the right,
        // and leaves the top right and the bottom left dark. A static envelope
        // over the frame does that — a floor that drops from a third of the way
        // down at the left edge to three quarters at the right, and a ceiling
        // that comes down over the right-hand side — so the turning lights pass
        // through it the way they would pass behind a fixed edge of glass. The
        // floor breathes a little, so the bottom fills and empties over time.
        // In grayscale the reference is covered further down — the shafts run
        // on towards the bottom edge and fog fills what they miss — so the floor
        // drops and its fade lengthens as the colour drains, and comes back up
        // as it floods in.
        float floorAt = 0.34 + 0.42 * x + 0.06 * sin(t * 0.045) + 0.20 * u_mono;
        float floorMask = 1.0 - smoothstep(floorAt, floorAt + 0.32 + 0.30 * u_mono, v);
        float ceilingAt = max(0.0, (x - 0.50) * 0.75);
        float ceilingMask = smoothstep(ceilingAt - 0.10, ceilingAt + 0.22, v);
        float depth = mix(1.0, floorMask * ceilingMask, u_falloff);
        glow *= depth;

        // A breath of fog so the gaps read as atmosphere, not void.
        float fog = fbm(vec2(px * 3.4 - a * 0.22 - t * 0.012, v * 1.05 + u_seed + 9.0));
        glow += u_coolB * fog * u_haze * (0.012 + 0.018 * u_mono) * depth;

        // Most of the frame has to stay near black with colour surfacing only
        // locally, and that is contrast, not exposure — winding the gain up on
        // its own just fogs the whole frame evenly, which is what made this read
        // as a flat green wash. Raising the accumulated field to a power above
        // one drags the long dim tails down towards black while leaving the
        // cores roughly where they are; the gain then puts the peaks back.
        glow = pow(max(glow, 0.0), vec3(1.7)) * 2.0;

        // The field breathes overall, on two slow periods that never line up —
        // a wander in the light level, not a pulse.
        glow *= 1.30 + 0.28 * (0.5 + 0.5 * sin(t * 0.081 + 1.3)) + 0.16 * (0.5 + 0.5 * sin(t * 0.037));

        // Drain the hue, keep the light. Positions, shapes, travel and every
        // internal movement carry straight on through — only saturation goes.
        float lum = dot(glow, vec3(0.2126, 0.7152, 0.0722));
        // Grayscale is not one look: it swells between a soft dark state and a
        // bright foggy one with near-white cores, on its own slow period.
        float monoSwell = u_monoLift * (0.82 + 0.36 * (0.5 + 0.5 * sin(t * 0.063 + 0.9)));
        // Same field, colour drained — but not the same tone curve. The mono
        // moments in the reference are flatter and foggier than the colour ones:
        // a wide bright haze rather than dark ground with bright cores. A plain
        // multiply cannot get there, because it drives the highlights so far up
        // the tone map that they clip and the whole state reads as one flat
        // white. Taking a root first re-lifts the mid tones that the contrast
        // curve above pushed down and leaves headroom at the top, which turns
        // local highlights into fog without moving anything or altering its
        // travel. A soft knee ahead of the root holds the near-black down —
        // without it the faint tails the drum lines leave everywhere would lift
        // the whole frame to one grey — and it has to be soft: a hard black
        // point clips the fog into jagged cut-outs.
        float knee = lum * lum / (lum + 0.02);
        float mono = pow(max(knee, 0.0), 0.55) * monoSwell;
        glow = mix(glow, vec3(mono), u_mono);

        vec3 color = u_background * (1.0 - u_mono * 0.9) + glow * u_intensity;

        // Restrained highlights — the brightest centres still stay fogged, and the
        // per-channel roll-off is what keeps the hot cores green instead of white.
        color = color / (color + vec3(1.0));

        vec2 q = v_uv - 0.5;
        color *= 1.0 - u_vignette * dot(q, q) * 1.35;

        color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
        // Dither, or the near-black falloffs band badly on 8-bit displays.
        color += (hash21(gl_FragCoord.xy + fract(u_time) * 91.7) - 0.5) * u_grain;

        gl_FragColor = vec4(color, 1.0);
    }
`

const UNIFORM_NAMES = [
    "u_time",
    "u_mono",
    "u_monoLift",
    "u_intensity",
    "u_softness",
    "u_breath",
    "u_drift",
    "u_sweep",
    "u_curve",
    "u_direction",
    "u_haze",
    "u_falloff",
    "u_vignette",
    "u_grain",
    "u_hazeCount",
    "u_bandCount",
    "u_streakCount",
    "u_warmCount",
    "u_warmAmount",
    "u_seed",
    "u_background",
    "u_coolA",
    "u_coolB",
    "u_warmA",
    "u_warmB",
] as const

type UniformName = (typeof UNIFORM_NAMES)[number]
type UniformMap = Partial<Record<UniformName, WebGLUniformLocation | null>>

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

/**
 * A number, or the fallback when the prop arrived as something else.
 *
 * Outside Framer a control can hand over a value of the wrong type — an empty
 * string is the usual one — and `clamp` would coerce that to 0 rather than
 * reject it. Harmless for most props; for the pixel ratio it means a 1x1 canvas
 * and a black screen, which is a very confusing way to find out.
 */
function num(value: unknown, fallback: number): number {
    if (typeof value === "number") return Number.isFinite(value) ? value : fallback
    // `Number("")` and `Number(null)` are both 0 — finite, and so silently
    // accepted by the check below. Those are exactly the values a host hands over
    // when it has nothing, so they have to be rejected before the coercion.
    if (value == null) return fallback
    if (typeof value === "string" && value.trim() === "") return fallback
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
}

function smoothstep01(t: number): number {
    const c = clamp(t, 0, 1)
    return c * c * (3 - 2 * c)
}

/** Accepts the hex and rgb()/rgba() forms Framer's colour picker hands back. */
function parseColor(value: string | undefined, fallback: string): [number, number, number] {
    const raw = (value || "").trim()

    const hex = /^#([0-9a-f]{3,8})$/i.exec(raw)
    if (hex) {
        let digits = hex[1]
        if (digits.length === 3 || digits.length === 4) {
            digits = digits
                .split("")
                .map((c) => c + c)
                .join("")
        }
        if (digits.length >= 6) {
            const n = parseInt(digits.slice(0, 6), 16)
            return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
        }
    }

    const rgb = /^rgba?\(([^)]+)\)$/i.exec(raw)
    if (rgb) {
        const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat)
        if (parts.length >= 3 && parts.slice(0, 3).every((p) => !isNaN(p))) {
            return [clamp(parts[0], 0, 255) / 255, clamp(parts[1], 0, 255) / 255, clamp(parts[2], 0, 255) / 255]
        }
    }

    if (raw !== fallback) return parseColor(fallback, fallback)
    return [0, 0, 0]
}

/** The shader accumulates light linearly, so colours go in linear and come out encoded. */
function toLinear(value: string | undefined, fallback: string): [number, number, number] {
    const [r, g, b] = parseColor(value, fallback)
    return [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)]
}

/**
 * Colour holds, drains to grayscale, holds, and floods back — one full round
 * trip per period, so the cycle is seamless however long it runs.
 */
function monoAmount(time: number, params: SceneParams): number {
    if (params.colorMode === "color") return 0
    if (params.colorMode === "mono") return 1

    const period = Math.max(params.cyclePeriod, 2)
    const fade = clamp(params.cycleFade, 0.2, period * 0.45)
    const hold = (period - fade * 2) / 2
    const p = ((time % period) + period) % period

    if (p < hold) return 0
    if (p < hold + fade) return smoothstep01((p - hold) / fade)
    if (p < hold + fade + hold) return 1
    return 1 - smoothstep01((p - hold - fade - hold) / fade)
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn("LightVeil: shader failed to compile\n", gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
    }
    return shader
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    if (!vertex || !fragment) return null

    const program = gl.createProgram()
    if (!program) return null
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    // The shaders live on inside the program object once it has linked.
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn("LightVeil: program failed to link\n", gl.getProgramInfoLog(program))
        gl.deleteProgram(program)
        return null
    }
    return program
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene
// ─────────────────────────────────────────────────────────────────────────────

interface SceneParams {
    hazeCount: number
    bandCount: number
    streakCount: number
    warmCount: number
    warmAmount: number
    softness: number
    haze: number
    falloff: number
    intensity: number
    seed: number
    speed: number
    breath: number
    drift: number
    sweep: number
    curve: number
    direction: number
    colorMode: "cycle" | "color" | "mono"
    cyclePeriod: number
    cycleFade: number
    monoLift: number
    background: string
    coolA: string
    coolB: string
    warmA: string
    warmB: string
    vignette: number
    grain: number
    maxPixelRatio: number
}

interface Experience {
    start(): void
    stop(): void
    renderOnce(): void
    resize(): void
    setParams(next: SceneParams): void
    dispose(): void
}

function createExperience(container: HTMLElement, initial: SceneParams, animate: boolean): Experience | null {
    const canvas = document.createElement("canvas")
    canvas.style.display = "block"
    canvas.style.width = "100%"
    canvas.style.height = "100%"
    container.appendChild(canvas)

    const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
    }) as WebGLRenderingContext | null

    if (!gl) {
        container.removeChild(canvas)
        return null
    }

    let params = initial
    let time = 0
    let program: WebGLProgram | null = null
    let buffer: WebGLBuffer | null = null
    let uniforms: UniformMap = {}

    // ── Resources ────────────────────────────────────────────────────────────
    // Rebuilt from scratch on context restore, so this stays a plain function.
    function createResources(): boolean {
        program = createProgram(gl)
        if (!program) return false

        buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        // One oversized triangle covers the viewport with no seam down the middle.
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

        const position = gl.getAttribLocation(program, "a_position")
        gl.enableVertexAttribArray(position)
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

        gl.useProgram(program)
        uniforms = {}
        for (const name of UNIFORM_NAMES) {
            uniforms[name] = gl.getUniformLocation(program, name)
        }
        return true
    }

    function destroyResources() {
        if (buffer) gl.deleteBuffer(buffer)
        if (program) gl.deleteProgram(program)
        buffer = null
        program = null
        uniforms = {}
    }

    if (!createResources()) {
        destroyResources()
        container.removeChild(canvas)
        return null
    }

    // ── Render ───────────────────────────────────────────────────────────────
    function resize() {
        const width = container.clientWidth || 1
        const height = container.clientHeight || 1
        const dpr = clamp(window.devicePixelRatio || 1, 0.5, num(params.maxPixelRatio, 1))
        const w = Math.max(1, Math.round(width * dpr))
        const h = Math.max(1, Math.round(height * dpr))
        if (canvas.width === w && canvas.height === h) return
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
    }

    function setFloat(name: UniformName, value: number) {
        const location = uniforms[name]
        if (location) gl.uniform1f(location, value)
    }

    function setColor(name: UniformName, value: string, fallback: string) {
        const location = uniforms[name]
        if (!location) return
        const [r, g, b] = toLinear(value, fallback)
        gl.uniform3f(location, r, g, b)
    }

    function renderFrame(delta: number) {
        if (!program) return
        time += delta * params.speed

        setFloat("u_time", time)
        setFloat("u_mono", monoAmount(time, params))
        setFloat("u_monoLift", params.monoLift)
        setFloat("u_intensity", params.intensity)
        setFloat("u_softness", params.softness)
        setFloat("u_breath", params.breath)
        setFloat("u_drift", params.drift)
        setFloat("u_sweep", params.sweep)
        setFloat("u_curve", params.curve)
        setFloat("u_direction", params.direction)
        setFloat("u_haze", params.haze)
        setFloat("u_falloff", params.falloff)
        setFloat("u_vignette", params.vignette)
        setFloat("u_grain", params.grain)
        setFloat("u_hazeCount", params.hazeCount)
        setFloat("u_bandCount", params.bandCount)
        setFloat("u_streakCount", params.streakCount)
        setFloat("u_warmCount", params.warmCount)
        setFloat("u_warmAmount", params.warmAmount)
        setFloat("u_seed", params.seed)
        setColor("u_background", params.background, DEFAULT_BACKGROUND)
        setColor("u_coolA", params.coolA, DEFAULT_COOL_A)
        setColor("u_coolB", params.coolB, DEFAULT_COOL_B)
        setColor("u_warmA", params.warmA, DEFAULT_WARM_A)
        setColor("u_warmB", params.warmB, DEFAULT_WARM_B)

        gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    // ── Loop ─────────────────────────────────────────────────────────────────
    let rafId = 0
    let running = false
    let visible = true
    let lastTime = 0
    let disposed = false

    function loop(now: number) {
        if (!running || disposed) return
        rafId = requestAnimationFrame(loop)
        const delta = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0
        lastTime = now
        renderFrame(delta)
    }

    function start() {
        if (running || disposed || !visible) return
        running = true
        lastTime = 0
        rafId = requestAnimationFrame(loop)
    }

    function stop() {
        running = false
        cancelAnimationFrame(rafId)
    }

    function renderOnce() {
        if (disposed) return
        renderFrame(0)
    }

    const intersection =
        typeof IntersectionObserver !== "undefined"
            ? new IntersectionObserver((entries) => {
                  visible = entries.some((entry) => entry.isIntersecting)
                  if (!animate) return
                  if (visible) start()
                  else stop()
              })
            : null
    intersection?.observe(container)

    const onContextLost = (event: Event) => {
        event.preventDefault()
        stop()
        destroyResources()
    }
    const onContextRestored = () => {
        if (disposed) return
        if (!createResources()) return
        // The drawing buffer comes back at 1×1, so force the viewport through again.
        canvas.width = 0
        resize()
        if (animate) start()
        else renderOnce()
    }
    canvas.addEventListener("webglcontextlost", onContextLost)
    canvas.addEventListener("webglcontextrestored", onContextRestored)

    resize()

    return {
        start,
        stop,
        renderOnce,
        resize,
        setParams(next: SceneParams) {
            params = next
        },
        dispose() {
            disposed = true
            stop()
            intersection?.disconnect()
            canvas.removeEventListener("webglcontextlost", onContextLost)
            canvas.removeEventListener("webglcontextrestored", onContextRestored)
            destroyResources()
            gl.getExtension("WEBGL_lose_context")?.loseContext()
            if (canvas.parentNode === container) container.removeChild(canvas)
        },
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Framer component
// ─────────────────────────────────────────────────────────────────────────────

/** The grouped Cycle control. One row, summarising its fields. */
interface VeilCycle {
    period: number
    fade: number
}

interface LightVeilProps {
    // Composition
    coolCount: number
    warmCount: number
    warmAmount: number
    softness: number
    haze: number
    falloff: number
    intensity: number
    seed: number
    // Animation
    speed: number
    sweep: number
    curve: number
    clockwise: boolean
    breath: number
    drift: number
    animateOnCanvas: boolean
    // Colour
    colorMode: "cycle" | "color" | "mono"
    colorSpeed: number
    cycle: VeilCycle
    monoLift: number
    background: string
    coolA: string
    coolB: string
    warmA: string
    warmB: string
    // Finish
    vignette: number
    grain: number
    // Performance
    maxPixelRatio: number
    style?: CSSProperties
}

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 675
 */
export default function LightVeil(props: LightVeilProps) {
    const {
        coolCount = BASE_DENSITY,
        warmCount = 8,
        warmAmount = 0.72,
        softness = 1,
        haze = 0.7,
        falloff = 0.8,
        intensity = 1,
        seed = 37,
        speed = BASE_SPEED,
        sweep = DEFAULT_SWEEP,
        curve = DEFAULT_CURVE,
        clockwise = true,
        breath = 0.55,
        drift = 1,
        animateOnCanvas = false,
        colorMode = "cycle",
        colorSpeed = BASE_SPEED,
        cycle = DEFAULT_CYCLE,
        monoLift = 0.62,
        background = DEFAULT_BACKGROUND,
        coolA = DEFAULT_COOL_A,
        coolB = DEFAULT_COOL_B,
        warmA = DEFAULT_WARM_A,
        warmB = DEFAULT_WARM_B,
        vignette = 0.45,
        grain = 0.014,
        maxPixelRatio = 1,
        style,
    } = props

    // The grouped control arrives as an object and the speed dial as 0-100. Both
    // are read defensively: a partial object, or a number the host handed over as
    // a string, falls back to the shader's own value.
    // Color Speed is a 0-100 dial over the cycle timings. It is squared so the
    // top of the dial is four times the natural pace and the bottom quarter is a
    // slow drift; at 0 the cycle stops and the scene simply holds its colour.
    const colorRate = Math.pow(clamp(num(colorSpeed, BASE_SPEED), 0, 100) / BASE_SPEED, 2)
    const cycleScale = 1 / Math.max(colorRate, 0.05)
    const cyclePeriod = clamp(num(cycle?.period, DEFAULT_CYCLE.period) * cycleScale, 2, 600)
    const cycleFade = clamp(num(cycle?.fade, DEFAULT_CYCLE.fade) * cycleScale, 0.2, 60)
    const veilColorMode = colorMode === "cycle" && colorRate === 0 ? "color" : colorMode
    const veilSpeed = clamp(num(speed, BASE_SPEED), 0, 200) / BASE_SPEED
    // Turn rate. No cap beyond taste: an angle wraps, so the turn is seamless
    // at any rate.
    const veilSweep = clamp(num(sweep, DEFAULT_SWEEP), 0, 1.2)
    const veilCurve = clamp(num(curve, DEFAULT_CURVE), 0.02, 1)

    // One Density dial scales all three cool layers together. The counts are for
    // the whole field, so only about a quarter of each is ever in frame.
    const density = clamp(num(coolCount, BASE_DENSITY), 1, 24) / BASE_DENSITY
    const hazeCount = Math.round(clamp(HAZE_AT_BASE * density, 2, MAX_HAZE_MASSES))
    const bandCount = Math.round(clamp(BANDS_AT_BASE * density, 2, MAX_BANDS))
    const streakCount = Math.round(clamp(STREAKS_AT_BASE * density, 1, MAX_STREAKS))

    const isStatic = useIsStaticRenderer()
    const animate = !isStatic || animateOnCanvas

    const containerRef = useRef<HTMLDivElement>(null)
    const experienceRef = useRef<Experience | null>(null)

    const params: SceneParams = {
        hazeCount,
        bandCount,
        streakCount,
        warmCount: Math.round(clamp(num(warmCount, 8), 0, MAX_WARM_LIGHTS)),
        warmAmount,
        softness,
        haze,
        falloff,
        intensity,
        seed,
        speed: veilSpeed,
        breath,
        drift,
        sweep: veilSweep,
        curve: veilCurve,
        // Negative turns the drum clockwise seen from above: near side right to left.
        direction: clockwise ? -1 : 1,
        colorMode: veilColorMode,
        cyclePeriod,
        cycleFade,
        monoLift,
        background,
        coolA,
        coolB,
        warmA,
        warmB,
        vignette,
        grain,
        maxPixelRatio,
    }
    const paramsRef = useRef(params)
    paramsRef.current = params

    // Build (and tear down) the WebGL scene.
    useEffect(() => {
        const container = containerRef.current
        if (!container || typeof window === "undefined") return

        const experience = createExperience(container, paramsRef.current, animate)
        if (!experience) return
        experienceRef.current = experience

        const resizeObserver =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver(() => {
                      experience.resize()
                      if (!animate) experience.renderOnce()
                  })
                : null
        resizeObserver?.observe(container)

        if (animate) experience.start()
        else experience.renderOnce()

        return () => {
            resizeObserver?.disconnect()
            experience.dispose()
            experienceRef.current = null
        }
    }, [animate])

    // Push property changes into the running scene without rebuilding it.
    useEffect(() => {
        const experience = experienceRef.current
        if (!experience) return
        experience.setParams(paramsRef.current)
        experience.resize()
        if (!animate) experience.renderOnce()
    }, [
        hazeCount,
        bandCount,
        streakCount,
        warmCount,
        warmAmount,
        softness,
        haze,
        falloff,
        intensity,
        seed,
        veilSpeed,
        veilSweep,
        veilCurve,
        clockwise,
        breath,
        drift,
        veilColorMode,
        cyclePeriod,
        cycleFade,
        monoLift,
        background,
        coolA,
        coolB,
        warmA,
        warmB,
        vignette,
        grain,
        maxPixelRatio,
        animate,
    ])

    return (
        <div
            ref={containerRef}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                background: background,
                ...style,
            }}
        />
    )
}

addPropertyControls(LightVeil, {
    // Ordered the way the rest of the kit orders a panel: the background and the
    // palette first, then the numbers most people reach for, then the finish.
    // Titles are plain words, as on Capsule Orb — Density, Speed, Brightness —
    // rather than the shader's own names.
    //
    // Kept deliberately small. Every other knob the shader supports still exists
    // as a prop with a default — see the destructuring in LightVeil — it just
    // isn't worth a row in the panel. `seed` is one of them: the structure is
    // meant to be the one structure, so it is fixed at its default rather than
    // offered as a reshuffle. `sweep`, `cycle` and `animateOnCanvas` are three
    // more: the turn rate and the cycle timings confused more than they helped
    // (Color Speed covers the one people wanted), and the canvas switch is a
    // Framer-only concern, so all stay at their defaults unless set in code.
    //
    // `colorMode` is the only Enum, and its options are strings on purpose: an
    // Enum whose options are numbers loses them outside Framer (option lists are
    // read as strings), and the component then receives "" where it expected a
    // number. That is how `Quality` once produced a 1x1 canvas.

    // ── Colors ─────────────────────────────────────────────────────
    background: {
        type: ControlType.Color,
        title: "Background",
        description: "The dark colour behind the lights.",
        defaultValue: DEFAULT_BACKGROUND,
    },
    coolA: {
        type: ControlType.Color,
        title: "Base Color",
        description: "The main colour of the lights.",
        defaultValue: DEFAULT_COOL_A,
    },
    coolB: {
        type: ControlType.Color,
        title: "Accent Color",
        description: "A second colour the dimmer lights lean towards.",
        defaultValue: DEFAULT_COOL_B,
    },
    warmA: {
        type: ControlType.Color,
        title: "Warm Color",
        description: "The colour of the warm glows low in the frame.",
        defaultValue: DEFAULT_WARM_A,
        hidden: (props: LightVeilProps) => props.warmCount === 0,
    },
    colorMode: {
        type: ControlType.Enum,
        title: "Color Mode",
        description: "Cycle fades between white and colour. Colour and Mono hold one look.",
        defaultValue: "cycle",
        options: ["cycle", "color", "mono"],
        optionTitles: ["Cycle", "Colour", "Mono"],
        displaySegmentedControl: true,
    },
    colorSpeed: {
        type: ControlType.Number,
        title: "Color Speed",
        description: "How fast the scene fades from white to colour and back. 50 is the natural pace, 0 stays in colour.",
        defaultValue: BASE_SPEED,
        min: 0,
        max: 100,
        step: 1,
        hidden: (props: LightVeilProps) => props.colorMode !== "cycle",
    },
    // Speed sits up here with Color Speed rather than down in Motion: the two
    // dials are the ones people reach for first, and they read as a pair.
    speed: {
        type: ControlType.Number,
        title: "Speed",
        description: "How fast the lights move and turn. 50 is the natural pace.",
        defaultValue: BASE_SPEED,
        min: 0,
        max: 100,
        step: 1,
    },

    // ── Form ───────────────────────────────────────────────────────
    coolCount: {
        type: ControlType.Number,
        title: "Density",
        description: "How many lights fill the frame.",
        defaultValue: BASE_DENSITY,
        min: 4,
        max: 24,
        step: 1,
        displayStepper: true,
    },
    warmCount: {
        type: ControlType.Number,
        title: "Warm Lights",
        description: "How many warm glows appear among the lights.",
        defaultValue: 8,
        min: 0,
        max: MAX_WARM_LIGHTS,
        step: 1,
        displayStepper: true,
    },
    softness: {
        type: ControlType.Number,
        title: "Softness",
        description: "How blurred each light is. Low is crisp, high is a soft haze.",
        defaultValue: 1,
        min: 0.4,
        max: 2.5,
        step: 0.05,
    },
    intensity: {
        type: ControlType.Number,
        title: "Brightness",
        description: "How bright the whole scene is.",
        defaultValue: 1,
        min: 0,
        max: 2.5,
        step: 0.05,
    },

    // ── Motion ─────────────────────────────────────────────────────
    curve: {
        type: ControlType.Number,
        title: "Depth",
        description: "How much the lights swell as they come to the front. Low is flat, high is deep.",
        defaultValue: DEFAULT_CURVE,
        min: 0.02,
        max: 1,
        step: 0.02,
    },

    // ── Finish ─────────────────────────────────────────────────────
    vignette: {
        type: ControlType.Number,
        title: "Vignette",
        description: "How dark the corners of the frame go.",
        defaultValue: 0.45,
        min: 0,
        max: 1,
        step: 0.05,
    },
})
