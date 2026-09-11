"use client"

import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"

/* ---------------------------------------------------------------------- *
 *  HaloShell
 *  A hollow globe of liquid electricity: a dense white-cyan dome with
 *  glowing strands hanging down a spherical surface, which every cycle
 *  gathers itself into a bright cap and one clean orbital ring, then
 *  grows back into an irregular shell. Over a near-black navy void.
 *
 *  Built from eight frames of the reference (Screen_Recording_2026-09-10_
 *  at_11_44_51_AM_001..008 in ~/Downloads/videotoframes). The platform at
 *  the bottom of those frames is not part of this and is not drawn. Where
 *  the brief and the frames disagree the frames win, and each such place
 *  says so in a comment.
 *
 *  WHAT THE FRAMES SAY
 *    One sphere, fixed in place, seen a little from above: the ring's
 *    ellipse is about 0.15 as tall as it is wide in both ring frames, so
 *    the eye sits roughly nine degrees above the ring's plane. The sphere
 *    never turns -- the same strands persist and slide over the surface.
 *    The grain is dots: every strand breaks into particles at its edges
 *    and tips (002, 005, 006), so the primitive is points. The ring sits
 *    at two different heights (upper-middle in 003, low in 007), so it
 *    descends while it lives. Between the ring and the next globe there
 *    is a cap with no ring and a rain of particles (004), then thin
 *    dotted strands hanging from the cap (005): the shell grows back
 *    from the top, it does not fade back in.
 *
 *  WHAT IS ACTUALLY DRAWN
 *    gl.POINTS, additively blended, in one colour -- and nothing else.
 *    Every point is a small soft disc of the panel's blue-cyan at a
 *    fraction of full intensity, accumulated in a float target and
 *    tone-mapped, so blue saturates first, then green, then red:
 *
 *      the palette   dark blue -> cyan -> white is nothing but stacking.
 *                    A lone point is deep blue; a strand's core is cyan;
 *                    the dome, where hundreds of strand roots pile up,
 *                    burns white. Brightness can only sit where the
 *                    material is thickest, which is where the frames
 *                    put it
 *      the strands   every point owns a place on one strand: a seeded
 *                    path down the sphere from a root high in the dome,
 *                    meandering in longitude, with a width that tapers
 *                    to the tip and a scatter that grows there, so a
 *                    line frays into dots at its end. Material streams
 *                    down the path a whole number of times per loop
 *      the dome      not an element. It is the strands' roots: they all
 *                    start above 55 degrees, so the top of the sphere is
 *                    where every strand overlaps every other
 *      the veins     the same strands near the pole. Lateral offsets are
 *                    kept as arc length, so near the top a strand wanders
 *                    much further in longitude and the roots read as a
 *                    branching network rather than a comb of parallels
 *      the splits    child strands that copy a parent's path to a branch
 *                    point and then leave it. Their points double the
 *                    parent's density above the branch, which is why a
 *                    fork is brighter than either arm
 *      the cap       the dome again, with every point above thirty
 *                    degrees pulled up into the top thirty and made
 *                    brighter. Nothing is added; the material is packed
 *      the ring      a share of the same points, each sliding along the
 *                    surface from wherever it was to one horizontal
 *                    circle, nearest first. When the ring breaks up they
 *                    spray outward and fall, dim, and are next seen
 *                    growing back down from the cap with everything else
 *      the back      the far side of the sphere is drawn dim and half as
 *                    dense, and shows through the hollow, which is what
 *                    makes the shell read as a volume and the ring's far
 *                    arc sit behind it
 *
 *  ONE CLOCK, ALL INTEGERS
 *    Every moving term is a sinusoid of the loop phase with a whole-
 *    number frequency, and the flow makes a whole number of trips per
 *    loop, so the loop is seamless by construction: no state, nothing
 *    to reset, the frame at phase 1 is the frame at phase 0. The cycle
 *    itself -- globe, gather, ring, dissolve, regrow -- is a handful of
 *    smoothstep envelopes of the phase (see `envelopes`), and the way in
 *    is not the way out: going in, strands fade from the bottom and the
 *    ring assembles; coming out, the ring sprays into falling particles
 *    and new strands grow from the cap with their tips leading.
 *
 *  WHAT WAS DELIBERATELY LEFT OUT
 *    No latitude/longitude grid, no wireframe, no sphere mesh -- the
 *    surface is only ever implied by points. No noise texture -- seeded
 *    sinusoids are loop-safe and cheaper. No fluid solver -- everything
 *    is closed-form in (place in the material, loop phase), so every
 *    control is live and nothing has to converge. No colour ramp -- see
 *    above. No rotation of the globe -- the frames show energy moving
 *    over a still sphere. No base, floor or reflection -- the frames
 *    have one and the brief says to ignore it. No pointer interaction --
 *    the frames are silent on it.
 *
 *  Raw WebGL 2, no dependencies. Bloom is a four-level blurred mip
 *  chain composited over the background colour.
 * ---------------------------------------------------------------------- */

/* ------------------------------------------------------------ constants */

/** Never oversample the backing store past this. */
const DPR_CAP = 2

/** Point budget for one frame. */
const MAX_POINTS = 300000
const MIN_POINTS = 2000

/** Strand budget. */
const MAX_STRANDS = 600
const MIN_STRANDS = 8

/** Particle count the intensity scale is calibrated against. Per-point
 *  intensity falls with the square root of count / this, so more
 *  particles add grain rather than flooding the dome white. */
const REF_COUNT = 120000

/** Frame dimension the point size is expressed against. */
const REF_DIM = 900

/** Camera: distance in sphere radii and elevation above the ring plane.
 *  Nine degrees is what the ring's ellipse in the frames measures. */
const CAM_DIST = 4.2
const CAM_ELEV = (9 * Math.PI) / 180

/** Loop phase the static Framer-canvas frame shows: mid-globe. */
const STATIC_PHASE = 0.14

/* -------------------------------------------------------------- defaults */

export interface ShellSettings {
    /** How far strands hang down the sphere. */
    reach: number
    /** How wide the strands are. */
    width: number
    /** How far strands wander sideways. */
    meander: number
    /** Share of points that break loose from their strand. */
    scatter: number
}

/** The strands' shape, one dial per feature the frames show.
 *
 *  Reach scales every strand's length; at 5 the longest reach about
 *  forty degrees below the equator and most stop above it, which is the
 *  frames' dark lower third. Width is the strand's core thickness -- 0 is
 *  a thread, 10 a broad stream. Meander is the sideways wander along the
 *  strand; it is scaled by arc length, so it is what turns the roots into
 *  a branching network near the pole. Scatter is the share of points
 *  that live a short way off their strand and drift, the particle haze
 *  around the shell. All neutral at 5. */
const DEFAULT_SHELL: ShellSettings = {
    reach: 5,
    width: 5,
    meander: 5,
    scatter: 5,
}

export interface RingSettings {
    /** Where on the sphere the ring first forms. */
    height: number
    /** How far it sinks while it lives. */
    drift: number
    /** How much of the material joins it. */
    share: number
}

/** The orbital ring.
 *
 *  Height is where it assembles, 0 at the equator and 10 well up the
 *  dome; the frames form it just above the equator, which is 3. Drift
 *  is how far it sinks before it dissolves -- the frames show it at two
 *  heights, upper-middle and low, so 5 sinks it about half a radius;
 *  0 holds it still. Share is the fraction of points that leave the
 *  shell for the ring; more makes a brighter ring and a thinner cap. */
const DEFAULT_RING: RingSettings = {
    height: 3,
    drift: 5,
    share: 5,
}

export interface GlowSettings {
    /** Bloom around the bright regions. */
    bloom: number
    /** The wide soft atmosphere around the whole sphere. */
    halo: number
}

/** Two radii of glow, because they do different jobs. Bloom is tight
 *  and gives the cap and the ring their burn without erasing point
 *  detail; Halo is very wide and is the deep-navy atmosphere the frames
 *  have around the sphere, in the sphere's own colour. */
const DEFAULT_GLOW: GlowSettings = {
    bloom: 5,
    halo: 5,
}

const DEFAULTS = {
    background: "#02070F",
    color: "#4FC8FF",
    size: 76,
    strands: 120,
    particles: 120000,
    speed: 5,
    cycleSeconds: 30,
    exposure: 5,
    seed: 3,
    /* props without a control */
    pointSize: 2.2,
    offsetY: 0,
    flowTrips: 3,
    branching: 5,
    maxPixelRatio: 1.5,
    animateOnCanvas: false,
}

/* --------------------------------------------------------------- helpers */

/** Deterministic PRNG. The strand family and the point lattice both
 *  come from this, so a seed is one fixed globe and the server's render
 *  matches the client's. */
function mulberry32(seed: number) {
    let a = seed >>> 0
    return function () {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Defensive numeric read. Rejects non-finite values instead of
 *  coercing them, so a host that hands over "" cannot zero a buffer. */
function num(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value)
    return Number.isFinite(n) ? n : fallback
}

const clamp = (v: number, lo: number, hi: number) =>
    v < lo ? lo : v > hi ? hi : v

const smooth = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
}

function toRGB(css: string): [number, number, number] {
    if (!css) return [0, 0, 0]
    const s = css.trim()
    const hex = /^#([0-9a-f]{3,8})$/i.exec(s)
    if (hex) {
        let h = hex[1]
        if (h.length === 3 || h.length === 4) {
            h = h
                .split("")
                .map((c) => c + c)
                .join("")
        }
        const n = parseInt(h.slice(0, 6), 16)
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
    }
    const fn = /^rgba?\(([^)]+)\)$/i.exec(s)
    if (fn) {
        const parts = fn[1]
            .split(/[\s,/]+/)
            .filter(Boolean)
            .slice(0, 3)
        const v = parts.map((x) =>
            x.indexOf("%") >= 0 ? parseFloat(x) * 2.55 : parseFloat(x)
        )
        return [(v[0] || 0) / 255, (v[1] || 0) / 255, (v[2] || 0) / 255]
    }
    return [1, 1, 1]
}

/** Loop rate from Speed 0-10. 5 is the reference, one cycle per
 *  `cycleSeconds`; 10 is nearly three times that. Exactly zero at zero,
 *  which is the only way the panel can hold the globe still. */
function speedRate(speed: number) {
    return Math.pow(clamp(speed, 0, 10) / 5, 1.5)
}

/** Strand length multiplier from Reach 0-10. */
function reachScale(r: number) {
    return 0.4 + 0.12 * clamp(r, 0, 10)
}

/** Strand half-width in radians of arc, from Width 0-10. */
function widthArc(w: number) {
    return 0.0025 * clamp(w, 0, 10)
}

/** Meander multiplier from Meander 0-10. */
function meanderScale(m: number) {
    return 0.2 * clamp(m, 0, 10)
}

/** Share of points that live off their strand, from Scatter 0-10. */
function scatterShare(s: number) {
    return 0.05 * clamp(s, 0, 10)
}

/** Ring height in sphere units where it first forms, from Height 0-10. */
function ringStart(h: number) {
    return 0.02 + 0.06 * clamp(h, 0, 10)
}

/** How far the ring sinks over its life, in sphere units, from Drift 0-10. */
function ringDrop(d: number) {
    return 0.11 * clamp(d, 0, 10)
}

/** Share of points that join the ring, from Share 0-10. */
function ringShare(s: number) {
    return 0.045 * clamp(s, 0, 10)
}

function bloomStrength(b: number) {
    return 0.22 * clamp(b, 0, 10)
}

function haloStrength(h: number) {
    return 0.14 * clamp(h, 0, 10)
}

function exposureScale(e: number) {
    return Math.pow(2, (clamp(e, 0, 10) - 5) / 2.5)
}

/** The cycle, as envelopes of the loop phase. Every curve is 0 or 1 at
 *  both ends, so the loop closes, and the stages overlap on purpose:
 *
 *    0.00-0.38  globe: dome and strands, nothing else moving but flow
 *    0.38-0.60  gather: the dome packs into a cap, strands fade from
 *               the bottom up and retract a little, and a broad band
 *               of material collects around the sphere
 *    0.52-0.66  the band tightens into a line
 *    0.60-0.72  ring: cap and ring, a few faint strands, the ring sinks
 *    0.70-0.86  dissolve: the ring sprays into falling particles
 *    0.80-1.00  regrow: strands grow down from the cap, tips leading,
 *               the cap spreads back into the dome
 *
 *  `ringPos` (where ring-role points sit) drops in a window where their
 *  brightness is already zero on both sides, so the return to the shell
 *  is a fade-in at the cap, never a flight back up. */
interface Envelopes {
    cap: number
    capGlow: number
    latCut: number
    grow: number
    ringPos: number
    ringBright: number
    ringScatter: number
    ringGate: number
    ringSink: number
    ringSharp: number
}

function envelopes(phi: number): Envelopes {
    const cap = smooth(0.38, 0.56, phi) * (1 - smooth(0.82, 0.98, phi))
    const capGlow = smooth(0.34, 0.58, phi) * (1 - smooth(0.8, 0.99, phi))
    const cutAmt = smooth(0.4, 0.6, phi) * (1 - smooth(0.78, 0.97, phi))
    const growDown = smooth(0.42, 0.64, phi)
    const growUp = smooth(0.8, 1.0, phi)
    const grow = 1 - 0.88 * growDown * (1 - growUp)
    const ringPos = smooth(0.44, 0.62, phi) * (1 - smooth(0.845, 0.875, phi))
    const ringBright = smooth(0.48, 0.64, phi) * (1 - smooth(0.7, 0.78, phi))
    const ringScatter = smooth(0.7, 0.845, phi) * (1 - smooth(0.88, 0.92, phi))
    const ringGate = 1 - smooth(0.78, 0.84, phi) * (1 - smooth(0.875, 0.97, phi))
    const ringSink = smooth(0.5, 0.86, phi)
    const ringSharp = smooth(0.52, 0.66, phi) * (1 - smooth(0.86, 0.9, phi))
    return {
        cap,
        capGlow,
        latCut: -2.2 + 2.82 * cutAmt,
        grow,
        ringPos,
        ringBright,
        ringScatter,
        ringGate,
        ringSink,
        ringSharp,
    }
}

/** One strand family from one seed. Four RGBA rows per strand:
 *
 *    row 0  lon0, latTop, length, width
 *    row 1  meander amp, meander freq, meander phase, drift harmonic
 *    row 2  branch depth (0 for a root strand), divergence amp, freq, phase
 *    row 3  brightness, persist, life phase, life harmonic
 *
 *  Child strands copy rows 0-1 from a parent so they share its path
 *  above the branch depth. Persist is nonzero for about one strand in
 *  eight: those hang on faint and full-length through the ring stage,
 *  which is the thin side strands frame 003 keeps. Everything time-
 *  dependent is an integer harmonic of the loop. */
function buildStrands(rng: () => number, count: number, branching: number) {
    const share = 0.1 * clamp(branching, 0, 10) * 0.9
    const base = Math.max(1, Math.round(count / (1 + share)))
    const kids = Math.max(0, count - base)
    const data = new Float32Array(count * 16)
    const put = (i: number, row: number, a: number, b: number, c: number, d: number) => {
        const o = (row * count + i) * 4
        data[o] = a
        data[o + 1] = b
        data[o + 2] = c
        data[o + 3] = d
    }
    const TAU = Math.PI * 2
    for (let i = 0; i < base; i++) {
        const lon0 = ((i + 0.9 * rng()) / base) * TAU
        const latTop = 0.75 + 0.8 * rng()
        const r0 = rng()
        const length = 0.35 + 1.9 * r0 * r0
        const width = 0.5 + 1.5 * rng()
        put(i, 0, lon0, latTop, length, width)
        const drift = (1 + Math.floor(rng() * 2)) * (rng() < 0.5 ? -1 : 1)
        put(i, 1, 0.05 + 0.1 * rng(), 2 + 3 * rng(), TAU * rng(), drift)
        put(i, 2, 0, 0, 0, 0)
        const r = rng()
        const persist = rng() < 0.18 ? 0.6 + 0.4 * rng() : 0
        put(i, 3, 0.55 + 0.75 * r * r, persist, TAU * rng(), 1 + Math.floor(rng() * 2))
    }
    for (let j = 0; j < kids; j++) {
        const i = base + j
        const p = Math.floor(rng() * base)
        const po = p * 4
        const branchD = 0.25 + 0.7 * rng()
        const length = branchD + 0.3 + 1.0 * Math.pow(rng(), 1.5)
        put(i, 0, data[po], data[po + 1], length, 0.4 + 1.0 * rng())
        const p1 = (count + p) * 4
        put(i, 1, data[p1], data[p1 + 1], data[p1 + 2], data[p1 + 3])
        const sign = rng() < 0.5 ? -1 : 1
        put(i, 2, branchD, sign * (0.12 + 0.25 * rng()), 2 + 3 * rng(), TAU * rng())
        const persist = rng() < 0.08 ? 0.6 + 0.4 * rng() : 0
        put(i, 3, 0.5 + 0.6 * rng(), persist, TAU * rng(), 1 + Math.floor(rng() * 2))
    }
    return { data, count }
}

/** Points: each picks a strand, weighted by length so the linear density
 *  along a long strand is close to a short one's, then a place along it
 *  and seven seeds. Eight floats per point. */
function buildPoints(rng: () => number, count: number, strands: Float32Array, strandCount: number) {
    const cum = new Float32Array(strandCount)
    let acc = 0
    for (let i = 0; i < strandCount; i++) {
        acc += 0.35 + strands[i * 4 + 2]
        cum[i] = acc
    }
    const data = new Float32Array(count * 8)
    for (let i = 0; i < count; i++) {
        const o = i * 8
        const pick = rng() * acc
        let lo = 0
        let hi = strandCount - 1
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (cum[mid] < pick) lo = mid + 1
            else hi = mid
        }
        data[o + 0] = rng()
        data[o + 1] = lo
        data[o + 2] = rng()
        data[o + 3] = rng()
        data[o + 4] = rng()
        data[o + 5] = rng()
        data[o + 6] = rng()
        data[o + 7] = rng()
    }
    return data
}

/* ------------------------------------------------------------------ glsl */

/** Points. Every visible property -- position, size, intensity -- is a
 *  closed-form function of (place in the material, loop phase, the cycle
 *  envelopes). Strand parameters come from a float texture, one texel
 *  column per strand. */
const POINT_VERT = `#version 300 es
precision highp float;

#define TAU 6.28318530718
#define HALFPI 1.57079632679

in vec4 aP;   // s along the strand, strand id, seed a, seed b
in vec4 aS;   // role seed, scatter seed, size seed, flow seed

uniform sampler2D uStrands;
uniform float uTau;        // loop phase 0..1
uniform float uFlow;       // strand flow trips per loop (integer)
uniform vec2  uRes;        // backing store size
uniform float uScale;      // sphere radius in NDC of the shorter side
uniform vec2  uOffset;     // NDC offset of the sphere centre
uniform float uPx;         // point diameter in device px
uniform float uAlpha;
uniform float uWidth;      // strand half-width, radians of arc
uniform float uMeander;
uniform float uScatter;    // share of loose points
uniform float uReach;
uniform vec3  uCam;
uniform float uCap;
uniform float uCapGlow;
uniform float uLatCut;
uniform float uGrow;
uniform float uRingPos;
uniform float uRingBright;
uniform float uRingScatter;
uniform float uRingGate;
uniform float uRingY;
uniform float uRingY0;
uniform float uRingShare;
uniform float uRingSharp;

out float vA;

void main() {
    int id = int(aP.y + 0.5);
    vec4 S0 = texelFetch(uStrands, ivec2(id, 0), 0);
    vec4 S1 = texelFetch(uStrands, ivec2(id, 1), 0);
    vec4 S2 = texelFetch(uStrands, ivec2(id, 2), 0);
    vec4 S3 = texelFetch(uStrands, ivec2(id, 3), 0);

    float tau = uTau;
    float persist = S3.y;

    // Material streams down the strand a whole number of trips per loop,
    // with a little spread between neighbours so a strand never reads
    // as a conveyor belt.
    float trips = uFlow + floor(aS.w * 3.0) - 1.0;
    float sf = fract(aP.x + trips * tau);
    // Material speeds up as it falls, so a strand is dense at its root
    // and thins toward the tip even though the flow is steady.
    float sd = pow(sf, 1.5);

    // Each strand breathes: stretches and retracts on its own slow beat.
    float life = 0.5 + 0.5 * sin(TAU * S3.w * tau + S3.z);
    float g = mix(uGrow, 1.0, persist);
    float len = S0.z * uReach * (0.65 + 0.35 * life) * g;
    float d = sd * len;                   // radians down from the root

    float lat0 = S0.y - d;
    // Keep lateral offsets as arc length, so a strand wanders as far
    // near the pole as at the equator. This is what makes the roots a
    // network and not a comb.
    float sc = 1.0 / max(cos(lat0), 0.22);

    float m1 = sin(S1.y * d + S1.z + TAU * S1.w * tau);
    float m2 = sin(2.3 * S1.y * d - 1.7 * S1.z - TAU * S1.w * tau);
    float m3 = sin(6.0 * S1.y * d + 2.0 * S1.z + TAU * S1.w * tau);   // the jag
    float lon = S0.x
              + 0.08 * sin(TAU * S1.w * tau + 3.1 * S1.z)
              + uMeander * S1.x * (m1 + 0.5 * m2 + 0.25 * m3) * sc;

    // A child strand shares its parent's path to the branch depth, then
    // peels away to one side and wanders on its own.
    if (S2.x > 0.0) {
        float e = max(d - S2.x, 0.0);
        float away = 1.0 - exp(-3.0 * e);
        lon += S2.y * away * (1.0 + 0.5 * sin(S2.z * e + S2.w + TAU * S1.w * tau)) * sc;
    }

    // Width across the strand: a broad vein at the root, a thread at
    // the tip.
    float tipT = smoothstep(0.55, 1.0, sf);
    float across = aP.z + aP.w - 1.0;
    lon += across * uWidth * S0.w * (1.0 + 2.5 * exp(-2.5 * d)) * (1.0 - 0.6 * tipT) * sc;

    // Cap: everything above thirty degrees is packed above forty-three,
    // and flattened below -- the frames' cap is wide and short, not a
    // spherical cap.
    float capBand = smoothstep(0.3, 0.6, lat0);
    float latCap = 0.75 + (lat0 - 0.5) / (HALFPI - 0.5) * (HALFPI - 0.75);
    float lat = mix(lat0, latCap, uCap * capBand);

    // Intensity.
    float b = S3.x;
    b *= 1.0 - 0.85 * tipT * tipT;
    // The energy concentrates at the top: the dome burns, the tips are
    // blue. This is the density gradient of the frames.
    b *= 1.0 + 2.6 * smoothstep(0.25, 1.0, lat0);
    // Fade from the bottom up as the cycle gathers. Persist strands hang
    // on longer and fainter -- the thin side strands of frame 003.
    float cut = uLatCut - 1.4 * persist + 0.5 * (fract(S1.z) - 0.5) * uCap;
    b *= smoothstep(cut - 0.45, cut + 0.15, lat0);
    b *= 1.0 - 0.3 * uCap * persist;
    // Regrowing strands are thin and dotted (frame 005).
    b *= mix(0.45, 1.0, g);
    float capT = smoothstep(0.45, 1.1, lat);
    b *= 1.0 + 3.0 * uCapGlow * capT;

    float cl = cos(lat);
    vec3 P = vec3(cl * sin(lon), sin(lat), cl * cos(lon));

    // Broad patches rolling over the surface that split into streaks:
    // two travelling plane waves, strongest over the dome.
    float pw = sin(3.1 * P.x + 2.2 * P.y + 1.3 * P.z + TAU * tau + 1.0)
             * sin(2.4 * P.z - 3.3 * P.x + 1.1 * P.y - TAU * 2.0 * tau + 2.0);
    b *= 0.7 + 0.3 * pw + 0.5 * capT * smoothstep(-0.2, 0.8, pw);

    // Shell thickness, a slow breath, and the loose particles: a share
    // of points sit a short way off their strand and drift about it.
    // Tips fray the same way.
    float loose = step(aS.y, uScatter);
    vec3 dir = normalize(vec3(aP.z - 0.5, aS.z - 0.5, fract(aS.y * 37.0) - 0.5) + 1e-4);
    float spread = 0.07 * loose * (0.4 + 0.6 * fract(aS.z * 13.0)) * (1.0 + 1.5 * smoothstep(0.5, 1.3, lat0))
                 + 0.045 * tipT * tipT;
    float wobble = 0.7 + 0.3 * sin(TAU * (2.0 * tau + aP.z));
    float r = 1.0 + 0.02 * (aP.w - 0.5) + 0.02 * sin(TAU * tau + 0.7 * lon);
    P = P * r + dir * spread * wobble;
    P.y = mix(P.y, 0.7 + (P.y - 0.7) * 0.6 + 0.04, uCap * capBand);
    // Loose points below the cap rain down while it is packed (frame 004).
    P.y -= loose * uCap * 0.55 * fract(aS.w * 5.0) * (0.5 + 0.5 * sin(TAU * (tau + aS.y * 11.0)));
    b *= mix(1.0, 0.4, loose);

    // The ring: a share of points slide over the surface to one circle,
    // nearest first. When it breaks up they spray out and fall.
    // Which points join: mostly those whose strand already lives near the
    // ring's latitude, so the ring is fed from the shell around it and
    // the cap keeps its energy.
    float latMid = S0.y - 0.5 * S0.z * uReach;
    float latR0 = asin(clamp(uRingY0, -1.0, 1.0));
    float near = 1.0 - min(1.0, abs(latMid - latR0) / 1.1);
    float isRing = step(aS.x, uRingShare * (0.35 + 0.65 * near));
    float jd = 0.6 * min(1.0, abs(latMid - latR0) / 1.4) + 0.4 * aS.z;
    float m = isRing * smoothstep(0.0, 1.0, (uRingPos - 0.55 * jd) / (1.0 - 0.55 * jd));
    // First a soft broad band around the sphere, on its surface, dim;
    // then the band tightens into one bright line.
    float latR = asin(clamp(uRingY, -1.0, 1.0));
    float latQ = latR + 0.5 * (1.0 - uRingSharp) * (fract(aS.z * 5.0) + fract(aP.z * 7.0) - 1.0);
    float th = lon + 0.5 * (fract(aS.y * 23.0) - 0.5) + TAU * 0.25 * (tau - 0.5);
    float rq = 1.03 + 0.012 * (aP.w - 0.5) * (1.0 + 4.0 * (1.0 - uRingSharp));
    vec3 Q = rq * vec3(cos(latQ) * sin(th), sin(latQ), cos(latQ) * cos(th));
    // Dissolve: the line frays. Most points stay close and go dim, a
    // few fly out, and they fall as they fade.
    float fly = fract(aS.w * 7.0);
    float fall = pow(fract(aP.z * 9.0), 3.0);
    Q += dir * 0.3 * uRingScatter * fly * fly * fly;
    Q.y -= 0.8 * uRingScatter * fall;
    Q.xz *= 1.0 + 0.2 * uRingScatter * fall;
    float ringB = uRingBright * (1.6 + 0.25 * sin(3.0 * th - TAU * 2.0 * tau))
                * (0.25 + 0.75 * uRingSharp) * pow(1.0 - uRingScatter, 2.0)
                * (1.0 - 0.9 * uRingScatter * sqrt(fall));

    vec3 X = P;
    float bright = b * mix(1.0, uRingGate, isRing);
    if (m > 0.0) {
        vec3 dirP = normalize(mix(normalize(P), normalize(Q), m));
        X = dirP * mix(length(P), length(Q), m);
        bright = mix(bright, ringB, m);
    }

    // The far side is dim and half as dense, and shows through.
    vec3 n = normalize(X);
    float facing = dot(n, normalize(uCam));
    bright *= mix(0.1, 1.0, smoothstep(-0.6, 0.5, facing));
    bright *= mix(1.0, step(0.5, aS.z), smoothstep(0.1, -0.5, facing));

    // Camera at uCam looking at the origin, y up.
    vec3 f = normalize(-uCam);
    vec3 rgt = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rgt, f);
    vec3 rel = X - uCam;
    float depth = max(dot(rel, f), 0.5);
    vec2 v = vec2(dot(rel, rgt), dot(rel, up));
    float focal = uScale * sqrt(dot(uCam, uCam) - 1.0);
    float minDim = min(uRes.x, uRes.y);
    vec2 ndc = v * focal / depth * vec2(minDim / uRes.x, minDim / uRes.y) + uOffset;
    gl_Position = vec4(ndc, 0.0, 1.0);

    float persp = length(uCam) / depth;
    vA = uAlpha * bright;
    gl_PointSize = max(1.0, uPx * persp * (0.7 + 0.6 * aS.z)
        * mix(1.0, 1.1, m) * mix(1.0, 0.7, loose) * (1.0 - 0.35 * tipT));
}
`

const POINT_FRAG = `#version 300 es
precision mediump float;
uniform vec3 uColor;
in float vA;
out vec4 outColor;
void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d = dot(q, q);
    if (d > 1.0) discard;
    float a = vA * smoothstep(1.0, 0.3, d);
    outColor = vec4(uColor * a, a);
}
`

const QUAD_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/** 9-tap separable gaussian. The same program downsamples: reading a
 *  full-res source into a half-res target through it is the blur and
 *  the reduction in one pass. */
const BLUR_FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
    vec3 c = texture(uTex, vUv).rgb * 0.2270;
    c += (texture(uTex, vUv + uStep).rgb + texture(uTex, vUv - uStep).rgb) * 0.1946;
    c += (texture(uTex, vUv + uStep * 2.0).rgb + texture(uTex, vUv - uStep * 2.0).rgb) * 0.1216;
    c += (texture(uTex, vUv + uStep * 3.0).rgb + texture(uTex, vUv - uStep * 3.0).rgb) * 0.0540;
    c += (texture(uTex, vUv + uStep * 4.0).rgb + texture(uTex, vUv - uStep * 4.0).rgb) * 0.0162;
    outColor = vec4(c, 1.0);
}
`

/** Composite: scene plus bloom, tone-mapped per channel so the blue
 *  channel saturates first and a dense stack goes cyan then white, over
 *  the background, with a dither so the halo's falloff never bands. */
const COMP_FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uScene;
uniform sampler2D uB0;
uniform sampler2D uB1;
uniform sampler2D uB2;
uniform sampler2D uB3;
uniform vec3 uBg;
uniform float uBloom;
uniform float uHalo;
uniform float uExposure;
in vec2 vUv;
out vec4 outColor;
void main() {
    vec3 scene = texture(uScene, vUv).rgb;
    vec3 b0 = texture(uB0, vUv).rgb;
    vec3 b1 = texture(uB1, vUv).rgb;
    vec3 b2 = texture(uB2, vUv).rgb;
    vec3 b3 = texture(uB3, vUv).rgb;
    vec3 hdr = uExposure * (scene + uBloom * (0.35 * b0 + 0.65 * b1) + uHalo * (0.4 * b2 + 0.6 * b3));
    vec3 col = uBg + (1.0 - exp(-hdr));
    float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    outColor = vec4(clamp(col + dither, 0.0, 1.0), 1.0);
}
`

/* ------------------------------------------------------------------ scene */

interface Params {
    background: string
    color: string
    size: number
    strands: number
    particles: number
    speed: number
    cycleSeconds: number
    exposure: number
    seed: number
    shell: ShellSettings
    ring: RingSettings
    glow: GlowSettings
    pointSize: number
    offsetY: number
    flowTrips: number
    branching: number
    maxPixelRatio: number
}

interface Target {
    fb: WebGLFramebuffer
    tex: WebGLTexture
    w: number
    h: number
}

interface Scene {
    start(): void
    renderOnce(): void
    setParams(p: Params): void
    dispose(): void
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("HaloShell shader:", gl.getShaderInfoLog(sh))
        gl.deleteShader(sh)
        return null
    }
    return sh
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string) {
    const v = compile(gl, gl.VERTEX_SHADER, vs)
    const f = compile(gl, gl.FRAGMENT_SHADER, fs)
    if (!v || !f) return null
    const prog = gl.createProgram()
    if (!prog) return null
    gl.attachShader(prog, v)
    gl.attachShader(prog, f)
    gl.linkProgram(prog)
    gl.deleteShader(v)
    gl.deleteShader(f)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("HaloShell link:", gl.getProgramInfoLog(prog))
        gl.deleteProgram(prog)
        return null
    }
    return prog
}

function initScene(host: HTMLDivElement, canvas: HTMLCanvasElement, first: Params): Scene | null {
    const opts: WebGLContextAttributes = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
    }
    const gl = canvas.getContext("webgl2", opts) as WebGL2RenderingContext | null
    if (!gl) return null

    // Float accumulation when the platform allows it, so the dome can
    // pile up past 1.0 and bloom in proportion; bytes otherwise.
    const hdr = !!gl.getExtension("EXT_color_buffer_float")
    gl.getExtension("OES_texture_float_linear")

    const progPoints = link(gl, POINT_VERT, POINT_FRAG)
    const progBlur = link(gl, QUAD_VERT, BLUR_FRAG)
    const progComp = link(gl, QUAD_VERT, COMP_FRAG)
    if (!progPoints || !progBlur || !progComp) return null

    const U = (prog: WebGLProgram, names: string[]) => {
        const out: Record<string, WebGLUniformLocation | null> = {}
        for (const n of names) out[n] = gl.getUniformLocation(prog, n)
        return out
    }
    const uP = U(progPoints, [
        "uStrands", "uTau", "uFlow", "uRes", "uScale", "uOffset", "uPx", "uAlpha",
        "uWidth", "uMeander", "uScatter", "uReach", "uCam", "uCap", "uCapGlow",
        "uLatCut", "uGrow", "uRingPos", "uRingBright", "uRingScatter", "uRingGate",
        "uRingY", "uRingY0", "uRingShare", "uRingSharp", "uColor",
    ])
    const uB = U(progBlur, ["uTex", "uStep"])
    const uC = U(progComp, ["uScene", "uB0", "uB1", "uB2", "uB3", "uBg", "uBloom", "uHalo", "uExposure"])
    const aP = gl.getAttribLocation(progPoints, "aP")
    const aS = gl.getAttribLocation(progPoints, "aS")
    const aPosBlur = gl.getAttribLocation(progBlur, "aPos")
    const aPosComp = gl.getAttribLocation(progComp, "aPos")

    const quadBuf = gl.createBuffer()
    const pointBuf = gl.createBuffer()
    const strandTex = gl.createTexture()
    if (!quadBuf || !pointBuf || !strandTex) return null
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.bindTexture(gl.TEXTURE_2D, strandTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    let params = first
    let phase = STATIC_PHASE
    let raf = 0
    let lastNow = 0
    let running = false
    let disposed = false
    let onScreen = true
    let pageVisible = typeof document === "undefined" || document.visibilityState !== "hidden"
    let reduceMotion = false
    let needsFrame = true

    let sceneT: Target | null = null
    let mips: [Target, Target][] = []
    let builtW = 0
    let builtH = 0

    let builtKey = ""
    let builtPoints = 0

    function makeTarget(w: number, h: number): Target | null {
        const tex = gl!.createTexture()
        const fb = gl!.createFramebuffer()
        if (!tex || !fb) return null
        gl!.bindTexture(gl!.TEXTURE_2D, tex)
        if (hdr) gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA16F, w, h, 0, gl!.RGBA, gl!.HALF_FLOAT, null)
        else gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, fb)
        gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0)
        const ok = gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) === gl!.FRAMEBUFFER_COMPLETE
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
        if (!ok) {
            gl!.deleteFramebuffer(fb)
            gl!.deleteTexture(tex)
            return null
        }
        return { fb, tex, w, h }
    }

    function dropTarget(t: Target | null) {
        if (!t) return
        gl!.deleteFramebuffer(t.fb)
        gl!.deleteTexture(t.tex)
    }

    function dropTargets() {
        dropTarget(sceneT)
        sceneT = null
        for (const pair of mips) {
            dropTarget(pair[0])
            dropTarget(pair[1])
        }
        mips = []
    }

    function buildTargets(w: number, h: number) {
        dropTargets()
        sceneT = makeTarget(w, h)
        for (let i = 0; i < 4; i++) {
            const s = 1 << (i + 1)
            const mw = Math.max(1, Math.floor(w / s))
            const mh = Math.max(1, Math.floor(h / s))
            const a = makeTarget(mw, mh)
            const b = makeTarget(mw, mh)
            if (a && b) mips.push([a, b])
        }
        builtW = w
        builtH = h
    }

    function ensureGeometry(p: Params) {
        const seed = Math.floor(num(p.seed, DEFAULTS.seed))
        const points = clamp(Math.round(num(p.particles, DEFAULTS.particles)), MIN_POINTS, MAX_POINTS)
        const strands = clamp(Math.round(num(p.strands, DEFAULTS.strands)), MIN_STRANDS, MAX_STRANDS)
        const branching = clamp(num(p.branching, DEFAULTS.branching), 0, 10)
        const key = seed + "/" + points + "/" + strands + "/" + branching
        if (key === builtKey) return
        const rng = mulberry32(seed * 2654435761 + 7)
        const fam = buildStrands(rng, strands, branching)
        gl!.bindTexture(gl!.TEXTURE_2D, strandTex)
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA32F, fam.count, 4, 0, gl!.RGBA, gl!.FLOAT, fam.data)
        gl!.bindBuffer(gl!.ARRAY_BUFFER, pointBuf)
        gl!.bufferData(gl!.ARRAY_BUFFER, buildPoints(rng, points, fam.data, fam.count), gl!.STATIC_DRAW)
        builtPoints = points
        builtKey = key
    }

    function resize() {
        const rect = host.getBoundingClientRect()
        const dpr = clamp(window.devicePixelRatio || 1, 1, Math.min(DPR_CAP, num(params.maxPixelRatio, DEFAULTS.maxPixelRatio)))
        const w = Math.max(1, Math.floor(rect.width * dpr))
        const h = Math.max(1, Math.floor(rect.height * dpr))
        if (w !== canvas.width || h !== canvas.height) {
            canvas.width = w
            canvas.height = h
        }
        if (w !== builtW || h !== builtH) {
            buildTargets(w, h)
            needsFrame = true
        }
        return dpr
    }

    function drawQuad(attrib: number) {
        if (attrib < 0) return
        gl!.bindBuffer(gl!.ARRAY_BUFFER, quadBuf)
        gl!.enableVertexAttribArray(attrib)
        gl!.vertexAttribPointer(attrib, 2, gl!.FLOAT, false, 0, 0)
        gl!.drawArrays(gl!.TRIANGLES, 0, 3)
    }

    function blurInto(src: Target, dst: Target, dx: number, dy: number) {
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, dst.fb)
        gl!.viewport(0, 0, dst.w, dst.h)
        gl!.useProgram(progBlur)
        gl!.activeTexture(gl!.TEXTURE0)
        gl!.bindTexture(gl!.TEXTURE_2D, src.tex)
        gl!.uniform1i(uB.uTex, 0)
        gl!.uniform2f(uB.uStep, dx / src.w, dy / src.h)
        drawQuad(aPosBlur)
    }

    function draw(dpr: number) {
        if (!sceneT || mips.length < 4) return
        const p = params
        ensureGeometry(p)
        const w = canvas.width
        const h = canvas.height
        const minDim = Math.min(w, h)

        const shell = p.shell
        const ring = p.ring
        const glow = p.glow
        const env = envelopes(phase)
        const px = Math.max(0.5, num(p.pointSize, DEFAULTS.pointSize))
        const pxDev = (px * minDim) / REF_DIM
        const alpha = 0.9 * Math.sqrt(REF_COUNT / builtPoints) * (2.2 / px)
        const y0 = ringStart(num(ring.height, DEFAULT_RING.height))
        const ringY = y0 - ringDrop(num(ring.drift, DEFAULT_RING.drift)) * env.ringSink

        // 1. Points, additive, into the scene target.
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, sceneT.fb)
        gl!.viewport(0, 0, w, h)
        gl!.clearColor(0, 0, 0, 0)
        gl!.clear(gl!.COLOR_BUFFER_BIT)
        gl!.enable(gl!.BLEND)
        gl!.blendFunc(gl!.ONE, gl!.ONE)
        gl!.useProgram(progPoints)
        gl!.activeTexture(gl!.TEXTURE0)
        gl!.bindTexture(gl!.TEXTURE_2D, strandTex)
        gl!.uniform1i(uP.uStrands, 0)
        gl!.uniform1f(uP.uTau, phase)
        gl!.uniform1f(uP.uFlow, Math.max(1, Math.round(num(p.flowTrips, DEFAULTS.flowTrips))))
        gl!.uniform2f(uP.uRes, w, h)
        gl!.uniform1f(uP.uScale, clamp(num(p.size, DEFAULTS.size), 10, 100) / 100)
        gl!.uniform2f(uP.uOffset, 0, (-2 * clamp(num(p.offsetY, DEFAULTS.offsetY), -50, 50)) / 100)
        gl!.uniform1f(uP.uPx, pxDev)
        gl!.uniform1f(uP.uAlpha, alpha)
        gl!.uniform1f(uP.uWidth, widthArc(num(shell.width, DEFAULT_SHELL.width)))
        gl!.uniform1f(uP.uMeander, meanderScale(num(shell.meander, DEFAULT_SHELL.meander)))
        gl!.uniform1f(uP.uScatter, scatterShare(num(shell.scatter, DEFAULT_SHELL.scatter)))
        gl!.uniform1f(uP.uReach, reachScale(num(shell.reach, DEFAULT_SHELL.reach)))
        gl!.uniform3f(uP.uCam, 0, CAM_DIST * Math.sin(CAM_ELEV), CAM_DIST * Math.cos(CAM_ELEV))
        gl!.uniform1f(uP.uCap, env.cap)
        gl!.uniform1f(uP.uCapGlow, env.capGlow)
        gl!.uniform1f(uP.uLatCut, env.latCut)
        gl!.uniform1f(uP.uGrow, env.grow)
        gl!.uniform1f(uP.uRingPos, env.ringPos)
        gl!.uniform1f(uP.uRingBright, env.ringBright)
        gl!.uniform1f(uP.uRingScatter, env.ringScatter)
        gl!.uniform1f(uP.uRingGate, env.ringGate)
        gl!.uniform1f(uP.uRingY, ringY)
        gl!.uniform1f(uP.uRingY0, y0)
        gl!.uniform1f(uP.uRingShare, ringShare(num(ring.share, DEFAULT_RING.share)))
        gl!.uniform1f(uP.uRingSharp, env.ringSharp)
        const col = toRGB(p.color)
        gl!.uniform3f(uP.uColor, col[0], col[1], col[2])
        gl!.bindBuffer(gl!.ARRAY_BUFFER, pointBuf)
        gl!.enableVertexAttribArray(aP)
        gl!.vertexAttribPointer(aP, 4, gl!.FLOAT, false, 32, 0)
        gl!.enableVertexAttribArray(aS)
        gl!.vertexAttribPointer(aS, 4, gl!.FLOAT, false, 32, 16)
        gl!.drawArrays(gl!.POINTS, 0, builtPoints)
        gl!.disable(gl!.BLEND)

        // 2. Blur chain: each level reads the one above, halving as it goes.
        let src: Target = sceneT
        for (let i = 0; i < mips.length; i++) {
            const [a, b] = mips[i]
            blurInto(src, a, 1, 0)
            blurInto(a, b, 0, 1)
            src = b
        }

        // 3. Composite over the background.
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
        gl!.viewport(0, 0, w, h)
        gl!.useProgram(progComp)
        const bind = (unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) => {
            gl!.activeTexture(gl!.TEXTURE0 + unit)
            gl!.bindTexture(gl!.TEXTURE_2D, tex)
            gl!.uniform1i(loc, unit)
        }
        bind(0, sceneT.tex, uC.uScene)
        bind(1, mips[0][1].tex, uC.uB0)
        bind(2, mips[1][1].tex, uC.uB1)
        bind(3, mips[2][1].tex, uC.uB2)
        bind(4, mips[3][1].tex, uC.uB3)
        const bg = toRGB(p.background)
        gl!.uniform3f(uC.uBg, bg[0], bg[1], bg[2])
        gl!.uniform1f(uC.uBloom, bloomStrength(num(glow.bloom, DEFAULT_GLOW.bloom)))
        gl!.uniform1f(uC.uHalo, haloStrength(num(glow.halo, DEFAULT_GLOW.halo)))
        gl!.uniform1f(uC.uExposure, exposureScale(num(p.exposure, DEFAULTS.exposure)))
        drawQuad(aPosComp)
        needsFrame = false
    }

    function frame(dt: number) {
        const dpr = resize()
        const rate = speedRate(num(params.speed, DEFAULTS.speed))
        const cycle = Math.max(1, num(params.cycleSeconds, DEFAULTS.cycleSeconds))
        if (!reduceMotion && rate > 0 && dt > 0) {
            phase = (phase + (dt * rate) / cycle) % 1
            needsFrame = true
        }
        if (needsFrame) draw(dpr)
    }

    function loop(now: number) {
        if (disposed || !running) return
        raf = requestAnimationFrame(loop)
        if (!onScreen || !pageVisible) {
            lastNow = now
            return
        }
        const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 0
        lastNow = now
        frame(dt)
    }

    /* listeners */
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { needsFrame = true; if (!running) frame(0) }) : null
    if (ro) ro.observe(host)
    const io =
        typeof IntersectionObserver !== "undefined"
            ? new IntersectionObserver((entries) => { onScreen = entries.some((e) => e.isIntersecting) }, { rootMargin: "128px" })
            : null
    if (io) io.observe(host)
    const onVisibility = () => { pageVisible = document.visibilityState !== "hidden" }
    document.addEventListener("visibilitychange", onVisibility)
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null
    reduceMotion = !!mq && mq.matches
    const onMQ = (e: MediaQueryListEvent) => { reduceMotion = e.matches; needsFrame = true }
    if (mq) {
        if (mq.addEventListener) mq.addEventListener("change", onMQ)
        else mq.addListener(onMQ)
    }
    const onLost = (e: Event) => {
        e.preventDefault()
        cancelAnimationFrame(raf)
    }
    const onRestored = () => {
        // Buffers and programs are gone with the context; the cheapest
        // honest recovery is to let React rebuild the scene.
        if (!disposed) host.dispatchEvent(new CustomEvent("haloshell-restore"))
    }
    canvas.addEventListener("webglcontextlost", onLost)
    canvas.addEventListener("webglcontextrestored", onRestored)

    return {
        start() {
            if (running) return
            running = true
            lastNow = 0
            raf = requestAnimationFrame(loop)
        },
        renderOnce() {
            frame(0)
        },
        setParams(p: Params) {
            params = p
            needsFrame = true
        },
        dispose() {
            disposed = true
            running = false
            cancelAnimationFrame(raf)
            if (ro) ro.disconnect()
            if (io) io.disconnect()
            document.removeEventListener("visibilitychange", onVisibility)
            if (mq) {
                if (mq.removeEventListener) mq.removeEventListener("change", onMQ)
                else mq.removeListener(onMQ)
            }
            canvas.removeEventListener("webglcontextlost", onLost)
            canvas.removeEventListener("webglcontextrestored", onRestored)
            dropTargets()
            gl.deleteBuffer(quadBuf)
            gl.deleteBuffer(pointBuf)
            gl.deleteTexture(strandTex)
            gl.deleteProgram(progPoints)
            gl.deleteProgram(progBlur)
            gl.deleteProgram(progComp)
            const lose = gl.getExtension("WEBGL_lose_context")
            if (lose) lose.loseContext()
        },
    }
}

/* ------------------------------------------------------------------ props */

interface HaloShellProps {
    /** The colour behind the sphere. Near-black navy is the reference. */
    background?: string
    /** The one colour every point is drawn in. Overlap makes the rest. */
    color?: string
    /** Sphere diameter as a percentage of the frame's shorter side. */
    size?: number
    /** How many strands hang down the sphere, forks included. */
    strands?: number
    /** How many points make up the shell. */
    particles?: number
    /** Flow speed, 0-10. 0 holds still. */
    speed?: number
    /** Seconds one globe-ring-globe cycle takes at Speed 5. */
    cycleSeconds?: number
    /** Overall brightness, 0-10. 5 is the reference. */
    exposure?: number
    /** The strands' shape. */
    shell?: Partial<ShellSettings>
    /** The orbital ring. */
    ring?: Partial<RingSettings>
    /** Bloom and atmosphere. */
    glow?: Partial<GlowSettings>
    /** Picks one fixed globe out of the family. */
    seed?: number
    /** Point diameter in CSS px at a 900px frame. */
    pointSize?: number
    /** Vertical offset of the sphere, as a percentage of the frame height. */
    offsetY?: number
    /** Whole trips the material makes down a strand per cycle. */
    flowTrips?: number
    /** How many strands fork off another, 0-10. */
    branching?: number
    /** Cap on the backing-store pixel ratio. */
    maxPixelRatio?: number
    /** Animate on the Framer canvas too, instead of one static frame. */
    animateOnCanvas?: boolean
    style?: CSSProperties
}

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 * @framerIntrinsicWidth 1000
 * @framerIntrinsicHeight 800
 */
export default function HaloShell({
    background = DEFAULTS.background,
    color = DEFAULTS.color,
    size = DEFAULTS.size,
    strands = DEFAULTS.strands,
    particles = DEFAULTS.particles,
    speed = DEFAULTS.speed,
    cycleSeconds = DEFAULTS.cycleSeconds,
    exposure = DEFAULTS.exposure,
    shell,
    ring,
    glow,
    seed = DEFAULTS.seed,
    pointSize = DEFAULTS.pointSize,
    offsetY = DEFAULTS.offsetY,
    flowTrips = DEFAULTS.flowTrips,
    branching = DEFAULTS.branching,
    maxPixelRatio = DEFAULTS.maxPixelRatio,
    animateOnCanvas = DEFAULTS.animateOnCanvas,
    style,
}: HaloShellProps) {
    const isStatic = useIsStaticRenderer()
    const animate = !isStatic || animateOnCanvas

    const hostRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const sceneRef = useRef<Scene | null>(null)
    const [failed, setFailed] = useState(false)
    const [generation, setGeneration] = useState(0)

    const paramsRef = useRef<Params>(null!)
    paramsRef.current = {
        background,
        color,
        size: num(size, DEFAULTS.size),
        strands: num(strands, DEFAULTS.strands),
        particles: num(particles, DEFAULTS.particles),
        speed: num(speed, DEFAULTS.speed),
        cycleSeconds: num(cycleSeconds, DEFAULTS.cycleSeconds),
        exposure: num(exposure, DEFAULTS.exposure),
        shell: { ...DEFAULT_SHELL, ...shell },
        ring: { ...DEFAULT_RING, ...ring },
        glow: { ...DEFAULT_GLOW, ...glow },
        seed: num(seed, DEFAULTS.seed),
        pointSize: num(pointSize, DEFAULTS.pointSize),
        offsetY: num(offsetY, DEFAULTS.offsetY),
        flowTrips: num(flowTrips, DEFAULTS.flowTrips),
        branching: num(branching, DEFAULTS.branching),
        maxPixelRatio: num(maxPixelRatio, DEFAULTS.maxPixelRatio),
    }

    // Build once per `animate` (and once more after a lost context).
    useEffect(() => {
        const host = hostRef.current
        const canvas = canvasRef.current
        if (!host || !canvas) return
        const scene = initScene(host, canvas, paramsRef.current)
        if (!scene) {
            setFailed(true)
            return
        }
        sceneRef.current = scene
        const onRestore = () => setGeneration((g) => g + 1)
        host.addEventListener("haloshell-restore", onRestore)
        if (animate) scene.start()
        else scene.renderOnce()
        return () => {
            host.removeEventListener("haloshell-restore", onRestore)
            scene.dispose()
            sceneRef.current = null
        }
    }, [animate, generation])

    // Push prop changes into the running scene. No dep array on purpose:
    // it runs after every render, so it cannot go stale, and it still
    // repaints a static canvas.
    useEffect(() => {
        const scene = sceneRef.current
        if (!scene) return
        scene.setParams(paramsRef.current)
        if (!animate) scene.renderOnce()
    })

    // Static approximation for the no-WebGL case: a bright dome over a
    // dim sphere of the same colour, on the same background.
    const s = num(size, DEFAULTS.size)
    const fallbackStyle: CSSProperties = failed
        ? {
              background: [
                  `radial-gradient(ellipse ${s * 0.42}% ${s * 0.22}% at 50% ${50 - s * 0.28}%, rgba(255,255,255,0.95), ${color} 45%, rgba(0,0,0,0) 100%)`,
                  `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${s * 0.4}%, ${color} ${s * 0.47}%, rgba(0,0,0,0) ${s * 0.55}%)`,
              ].join(", "),
              filter: "blur(4px)",
          }
        : {}

    return (
        <div
            ref={hostRef}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                background,
                ...style,
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    display: "block",
                    ...fallbackStyle,
                }}
            />
        </div>
    )
}

/* ------------------------------------------------------ property controls */

addPropertyControls(HaloShell, {
    // ---------- Layout
    size: {
        type: ControlType.Number,
        title: "Size",
        description: "Sphere diameter as a percentage of the frame's shorter side.",
        defaultValue: DEFAULTS.size,
        min: 20,
        max: 100,
        step: 1,
        unit: "%",
    },
    strands: {
        type: ControlType.Number,
        title: "Strands",
        description: "How many strands hang down the sphere, forks included.",
        defaultValue: DEFAULTS.strands,
        min: 40,
        max: 400,
        step: 10,
    },
    particles: {
        type: ControlType.Number,
        title: "Particles",
        description: "How many points make up the shell. More is finer grain, not brighter.",
        defaultValue: DEFAULTS.particles,
        min: 20000,
        max: 250000,
        step: 5000,
    },
    shell: {
        type: ControlType.Object,
        title: "Shell",
        description: "The strands' shape. All neutral at 5.",
        defaultValue: DEFAULT_SHELL,
        controls: {
            reach: {
                type: ControlType.Number,
                title: "Reach",
                description: "How far strands hang down the sphere.",
                defaultValue: DEFAULT_SHELL.reach,
                min: 0,
                max: 10,
                step: 0.1,
            },
            width: {
                type: ControlType.Number,
                title: "Width",
                description: "How wide the strands are. 0 is a thread, 10 a broad stream.",
                defaultValue: DEFAULT_SHELL.width,
                min: 0,
                max: 10,
                step: 0.1,
            },
            meander: {
                type: ControlType.Number,
                title: "Meander",
                description: "How far strands wander sideways. 0 hangs them straight.",
                defaultValue: DEFAULT_SHELL.meander,
                min: 0,
                max: 10,
                step: 0.1,
            },
            scatter: {
                type: ControlType.Number,
                title: "Scatter",
                description: "Share of points that break loose from their strand and drift.",
                defaultValue: DEFAULT_SHELL.scatter,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },

    // ---------- Animation
    speed: {
        type: ControlType.Number,
        title: "Speed",
        description: "How fast the energy flows and the cycle turns. 0 holds it still.",
        defaultValue: DEFAULTS.speed,
        min: 0,
        max: 10,
        step: 0.1,
    },
    cycleSeconds: {
        type: ControlType.Number,
        title: "Cycle",
        description: "Seconds one globe-to-ring-and-back cycle takes at Speed 5.",
        defaultValue: DEFAULTS.cycleSeconds,
        min: 8,
        max: 120,
        step: 1,
        unit: "s",
    },
    ring: {
        type: ControlType.Object,
        title: "Ring",
        description: "The orbital ring the shell gathers into once a cycle.",
        defaultValue: DEFAULT_RING,
        controls: {
            height: {
                type: ControlType.Number,
                title: "Height",
                description: "Where on the sphere the ring forms. 0 is the equator.",
                defaultValue: DEFAULT_RING.height,
                min: 0,
                max: 10,
                step: 0.1,
            },
            drift: {
                type: ControlType.Number,
                title: "Drift",
                description: "How far the ring sinks while it lives. 0 holds it still.",
                defaultValue: DEFAULT_RING.drift,
                min: 0,
                max: 10,
                step: 0.1,
            },
            share: {
                type: ControlType.Number,
                title: "Share",
                description: "How much of the material joins the ring. More is a brighter ring and a thinner cap.",
                defaultValue: DEFAULT_RING.share,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },
    seed: {
        type: ControlType.Number,
        title: "Seed",
        description: "Picks one fixed globe out of the family. Same seed, same strands.",
        defaultValue: DEFAULTS.seed,
        min: 1,
        max: 9999,
        step: 1,
        displayStepper: true,
    },

    // ---------- Colors
    background: {
        type: ControlType.Color,
        title: "Background",
        description: "The colour behind the sphere.",
        defaultValue: DEFAULTS.background,
    },
    color: {
        type: ControlType.Color,
        title: "Color",
        description: "The one colour the points are drawn in. Where they pile up it goes cyan, then white.",
        defaultValue: DEFAULTS.color,
    },
    exposure: {
        type: ControlType.Number,
        title: "Brightness",
        description: "Overall brightness. 5 is the reference; 10 burns the dome out.",
        defaultValue: DEFAULTS.exposure,
        min: 0,
        max: 10,
        step: 0.1,
    },

    // ---------- Effects
    glow: {
        type: ControlType.Object,
        title: "Glow",
        description: "Tight bloom on the bright regions and a wide atmosphere around the sphere.",
        defaultValue: DEFAULT_GLOW,
        controls: {
            bloom: {
                type: ControlType.Number,
                title: "Bloom",
                description: "Bloom around the cap, the ring and the bright veins.",
                defaultValue: DEFAULT_GLOW.bloom,
                min: 0,
                max: 10,
                step: 0.1,
            },
            halo: {
                type: ControlType.Number,
                title: "Halo",
                description: "The wide soft atmosphere around the whole sphere.",
                defaultValue: DEFAULT_GLOW.halo,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },
})
