"use client"

import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"

/* ---------------------------------------------------------------------- *
 *  VortexRing
 *  A hollow ring of liquid energy seen face-on: one ribbon of two
 *  hundred thousand glowing points circulating, twisting and throwing
 *  fountains of itself upward, inside a wide cyan atmosphere over
 *  black.
 *
 *  Built from eight frames of the reference loop (Screen_Recording_
 *  2026-09-10_at_11_30_31_AM_001..008 in ~/Downloads/videotoframes).
 *  Where the brief and the frames disagree the frames win, and each
 *  such place says so in a comment.
 *
 *  WHAT IS ACTUALLY DRAWN
 *    gl.POINTS, additively blended, in two colours and one white --
 *    and nothing else. Every point is a small flat disc. There is no
 *    ribbon mesh, no lighting pass, no emitter. Everything the eye
 *    reads as structure is the crowd overlapping itself:
 *
 *      the palette   two ends and a burn. A point rolled away from the
 *                    camera draws the deep blue, a point on the lit
 *                    face draws the electric cyan, and a point that is
 *                    both face-on and squeezed draws white. Stacking
 *                    finishes it: cyan saturates green and blue first,
 *                    so a thick sheet goes white where the frames put
 *                    white and the blue survives only where the
 *                    material is thin or turned under. One colour was
 *                    tried first and could not hold both the vivid
 *                    blue undersides and a cyan-dominant ribbon
 *      the sheet     a ribbon-shaped cloud: each point owns a place on
 *                    a strip (along, across, through), and the strip is
 *                    wrapped around a circle, bent by a few slow fields
 *                    and twisted about its own tangent. Face-on the
 *                    strip is wide and bright; edge-on it is a dim
 *                    line, so a fold reads as the deep-blue underside
 *                    the frames show and not as a white wire
 *      the lobes     compressions travelling along the ribbon. Points
 *                    keep their place in the material; an asymmetric
 *                    displacement wave shocks -- sharp leading edge,
 *                    long tail -- so a dense stretch reads as a sheet
 *                    streaming round the ring. Nothing is emitted
 *      the gaps      a density mask that dips to a thin stream and
 *                    back, and takes the ribbon's width down with it
 *      the splashes  a second population that tears off the sheet and
 *                    shoots upward on a short repeating life. Site
 *                    strength comes from a field read at the birth
 *                    angle and birth moment, so most of the ring only
 *                    fizzes while a few stretches throw a fountain
 *                    half a radius high, and a site builds, fires and
 *                    dies while the flow streams through it. Screen-up
 *                    is up: a plume leaving the bottom of the ring
 *                    rises into the hole, which the frames also show
 *      the horns     the reference keeps a split at the top of the ring
 *                    in all eight frames -- two crests reaching up with
 *                    a dark gap between them. The brief calls that
 *                    shape transient; the frames do not, so it is a
 *                    fixed screen-space feature whose strength rides on
 *                    the flow passing through, and the horns grow, lean
 *                    and collapse while the split itself stays put
 *      the air      the biggest single difference from the first
 *                    build. Two thirds of every reference frame sits
 *                    above black, nearly all of it dim cyan a long way
 *                    from any particle; the first build lit under a
 *                    quarter. It takes six blur levels, the widest two
 *                    run three times over, and the wide part painted
 *                    in one tinted colour rather than blurred from the
 *                    scene -- the frames' atmosphere has no red in it
 *                    at all, so a neutral blur of white crests cannot
 *                    make it
 *
 *  ONE CLOCK, ALL INTEGERS
 *    Every moving term is a sinusoid of the loop phase with a whole-
 *    number frequency, and the flow makes a whole number of turns per
 *    loop, so the loop is seamless by construction: there is no state,
 *    nothing to reset, and the frame at phase 1 is the frame at phase
 *    0. The deformation fields are short Fourier series around the ring
 *    with seeded amplitudes and phases, each frequency-modulated by one
 *    slower carrier so their peaks are never evenly spaced. Their time
 *    frequencies are chosen so each field travels at a fraction of the
 *    flow speed: structures drift around the ring, material streams
 *    through them faster, and the two never lock.
 *
 *  WHAT WAS DELIBERATELY LEFT OUT
 *    No noise texture or simplex noise -- a Fourier series is loop-
 *    safe, seedable and cheaper, and with FM it does not read as waves.
 *    No fluid solver and no velocity integration -- everything is
 *    closed-form in (place in the material, loop phase), so every
 *    control is live and nothing has to converge. No gravity on the
 *    spray: the frames' plumes rise, spread and fade, and none of them
 *    is seen falling back. No global tilt of the ring -- the frames
 *    look straight through it, and all depth comes from the ribbon's
 *    own twist. No pointer interaction -- the frames are silent on it
 *    and the ring is a background subject.
 *
 *  ONE KNOWN CONSEQUENCE
 *    The fine filaments the sheet is combed with run across the ribbon
 *    and are rolled into diagonal folds by the twist. Set Twist to 0
 *    and there is nothing to roll them, so they stand out as clean
 *    concentric rings. That is the honest result of turning the roll
 *    off, not an artifact to sand away.
 *
 *  Raw WebGL 1, no dependencies.
 * ---------------------------------------------------------------------- */

/* ------------------------------------------------------------ constants */

/** Never oversample the backing store past this. */
const DPR_CAP = 2

/** Point budget for one frame, ribbon and spray together. */
const MAX_POINTS = 300000
const MIN_POINTS = 2000

/** Particle count the alpha scale is calibrated against. Per-point
 *  alpha falls with the square root of count / this, so more particles
 *  add grain rather than flooding the ring white. The base coefficient
 *  next to it in `draw` is what sets the overall level; it is above 1
 *  because the reference's ribbon is a solid bright mass, not a spray
 *  of separated points, and the wide halo needs something bright to
 *  sit around. */
const REF_COUNT = 100000

/** Point diameter, in CSS px at a 900px frame, that the alpha scale is
 *  calibrated against. */
const REF_POINT = 3.0

/** Frame dimension the point size is expressed against. */
const REF_DIM = 900

/** Camera distance in ring radii. Depth here is slight on purpose --
 *  the frames look straight through the ring -- so this only has to
 *  make a twist toward the camera read a little larger and brighter. */
const CAM = 4.5

/** Mean outer edge of the ring as a multiple of its radius, used to
 *  turn the Size percentage into a scale. Radius 1 plus a typical bulge
 *  plus a half-width. */
const OUTER_EXTENT = 1.18

/* -------------------------------------------------------------- defaults */

export interface ShapeSettings {
    /** How far sections of the ring push out and pull in. */
    bulge: number
    /** How hard the ribbon rotates about its own path. */
    twist: number
    /** How strongly material bunches and stretches along the ring. */
    waves: number
    /** How much each point wanders on its own inside the sheet. */
    turbulence: number
    /** How far the sparse stretches thin out toward nothing. */
    gaps: number
    /** How strongly the split crests at the top reach up. */
    crown: number
}

/** The ribbon's deformation, one dial per scale of motion.
 *
 *  These are the layers the brief lists, each with its own control, and
 *  they are deliberately not one "chaos" slider: they move at different
 *  rates and the picture depends on the difference. Bulge is the slow
 *  large-scale silhouette (low harmonics, travelling at about half the
 *  flow). Twist is the medium-scale roll of the sheet about its tangent
 *  and is what makes a section go broad-and-white then thin-and-blue.
 *  Waves is compression along the ring -- the lobes -- and is what
 *  makes two neighbours merge into one white mass and a mass split as
 *  its middle stretches thin. Turbulence is per-point and fast. Gaps is
 *  the density mask; at 0 nothing ever thins below half and the ring
 *  reads continuous, at 10 whole quadrants fade to a thread. Crown is
 *  the fixed split at the top, from the frames; 0 removes it.
 *
 *  All neutral at 5, which is the reference. */
const DEFAULT_SHAPE: ShapeSettings = {
    bulge: 5,
    twist: 5,
    waves: 5,
    turbulence: 5,
    gaps: 5,
    crown: 5,
}

export interface SpraySettings {
    /** How many points break away from the outer edge. */
    amount: number
    /** How far outward they get before they fade. */
    reach: number
    /** How much they drift upward on the way. */
    lift: number
}

/** The points that leave the ribbon.
 *
 *  Amount is a share of the particle budget, not a rate: spray points
 *  are a fixed population on a short repeating life, so there is never
 *  a burst. Reach is deliberately short -- the frames show sprays that
 *  travel a fraction of the ring's width and dissolve, not trails. Lift
 *  is the one screen-fixed bias: the frames' sprays rise, which is why
 *  the top of the ring reads fragmented and the bottom heavy. It also
 *  weights spray toward the upper half. 0 makes it symmetric. */
const DEFAULT_SPRAY: SpraySettings = {
    amount: 5,
    reach: 5,
    lift: 5,
}

export interface GlowSettings {
    /** Bloom around the bright crests. */
    bloom: number
    /** The wide soft atmosphere around the whole ring. */
    halo: number
}

/** Two radii of glow, because they do different jobs. Bloom is tight
 *  and gives the white crests their burn without erasing point detail;
 *  Halo is very wide and is the deep-navy atmosphere the frames have
 *  around the ring, in the ring's own colour. */
const DEFAULT_GLOW: GlowSettings = {
    bloom: 5,
    halo: 5,
}

const DEFAULTS = {
    background: "#000206",
    color: "#3AE6FF",
    deepColor: "#0A3CFF",
    size: 80,
    thickness: 5,
    particles: 210000,
    pointSize: 3.0,
    speed: 5,
    direction: "clockwise",
    seed: 7,
    /* props without a control */
    loopSeconds: 36,
    turns: 3,
    weight: 5,
    depth: 5,
    maxPixelRatio: 1.5,
    animateOnCanvas: false,
}

/* --------------------------------------------------------------- helpers */

/** Deterministic PRNG. The point lattice and the field coefficients
 *  both come from this, so a seed is one fixed ring and the server's
 *  render matches the client's. */
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

/** Loop rate from Speed 0-10. 5 is the reference, one loop per
 *  `loopSeconds`; 10 is not twice that but nearly three times, so the
 *  top of the slider is a real rush. Exactly zero at zero, which is the
 *  only way the panel can hold the ring still. */
function speedRate(speed: number) {
    return Math.pow(clamp(speed, 0, 10) / 5, 1.5)
}

/** Mean ribbon half-width in ring radii, from Thickness 0-10. Measured
 *  off the frames: the broad sheets are about 0.14 of the radius, the
 *  thin stretches about 0.035, so the mean is a little under 0.09 and
 *  Thickness 5 is the reference. The swing around it is capped in the
 *  shader -- see the note on `wmul`. */
function halfWidth(t: number) {
    return 0.028 * clamp(t, 0, 10)
}

/** Ribbon half-thickness (the through-axis) in ring radii. */
function halfDepth(d: number) {
    return 0.008 * clamp(d, 0, 10)
}

/** Radial deformation amplitude in ring radii, from Bulge 0-10. */
function bulgeAmp(b: number) {
    return 0.058 * clamp(b, 0, 10)
}

/** Twist amplitude in radians, from Twist 0-10. At 5 the sheet rolls
 *  through about a turn and a half of variation around the ring, which
 *  is the eight-to-ten folds the tighter frames show. */
function twistAmp(t: number) {
    return 0.3 * Math.PI * clamp(t, 0, 10)
}

/** Along-ring displacement amplitude in radians, from Waves 0-10. At 5
 *  the densest stretches are about twice the mean and the thinnest
 *  about half; at 10 the material folds over itself. */
function wavesAmp(w: number) {
    return 0.024 * clamp(w, 0, 10)
}

/** Per-point wander in ring radii, from Turbulence 0-10. */
function turbAmp(t: number) {
    return 0.004 * clamp(t, 0, 10)
}

/** The density mask's smoothstep edges, from Gaps 0-10. The mask field
 *  runs roughly -0.7..0.7; the edges slide up it so that at 0 nothing
 *  thins much and at 10 large stretches fade to a thread. */
function gapEdges(g: number): [number, number] {
    const c = clamp(g, 0, 10)
    return [-0.55 + 0.10 * c, -0.05 + 0.08 * c]
}

/** Share of the point budget spent on spray, from Amount 0-10. A
 *  quarter of the points at 5: the frames throw a lot of material off
 *  the ribbon, and a thin spray reads as fuzz on the edge rather than
 *  as fountains. */
function sprayShare(a: number) {
    return 0.05 * clamp(a, 0, 10)
}

/** How far spray spreads sideways, in ring radii, from Reach 0-10.
 *  This is the fan, not the travel -- Lift does the travel. */
function sprayReach(r: number) {
    return 0.022 * clamp(r, 0, 10)
}

/** How far the biggest plumes rise, in ring radii, from Lift 0-10. At
 *  5 a full burst climbs about a third of the ring's radius, which is
 *  what the frames' tallest fountains do. */
function sprayLift(l: number) {
    return 0.065 * clamp(l, 0, 10)
}

function bloomStrength(b: number) {
    return 0.125 * clamp(b, 0, 10)
}

function haloStrength(h: number) {
    return 0.17 * clamp(h, 0, 10)
}

/** A deformation field: a short Fourier series around the ring.
 *
 *  Each term is A * sin(m * theta + 2pi * n * tau + phi + fm), theta the
 *  angle around the ring and tau the loop phase. m and n are integers,
 *  so every term closes on itself over one loop. n is chosen so the
 *  term travels at `advect` of the flow speed -- structures drift
 *  around the ring more slowly than the material streams through
 *  them -- with a little per-term scatter so the field also evolves
 *  as it travels rather than sliding rigidly. Amplitudes fall with m
 *  and sum to 1, so a field's range is about -0.7..0.7.
 *
 *  Every term shares one FM carrier: a slow sinusoid whose value is
 *  added to every phase. That is what stops a sum of sines around a
 *  circle from reading as evenly-spaced waves -- the peaks are pushed
 *  together on one side of the carrier and apart on the other, and
 *  the carrier itself moves. */
interface FieldSpec {
    terms: Float32Array // K x (m, n, A, phi)
    fm: [number, number, number, number] // (m, n, amount, phi)
}

function makeField(
    rng: () => number,
    ms: number[],
    advectTurns: number,
    scatter: number,
    decay: number,
    fmAmount: number
): FieldSpec {
    const K = ms.length
    const terms = new Float32Array(K * 4)
    const amps: number[] = []
    let sum = 0
    for (let i = 0; i < K; i++) {
        const a = (0.55 + 0.45 * rng()) / Math.pow(ms[i], decay)
        amps.push(a)
        sum += a
    }
    for (let i = 0; i < K; i++) {
        const m = ms[i]
        const j = Math.round((rng() * 2 - 1) * scatter)
        terms[i * 4 + 0] = m
        terms[i * 4 + 1] = Math.round(-advectTurns * m) + j
        terms[i * 4 + 2] = amps[i] / sum
        terms[i * 4 + 3] = rng() * Math.PI * 2
    }
    const fmM = 1 + Math.floor(rng() * 2)
    const fmN = Math.round(-advectTurns * fmM * 0.5) + (rng() < 0.5 ? -1 : 1)
    return { terms, fm: [fmM, fmN, fmAmount, rng() * Math.PI * 2] }
}

interface Fields {
    radial: FieldSpec
    twist: FieldSpec
    width: FieldSpec
    along: FieldSpec
    density: FieldSpec
    medium: FieldSpec
}

/** All six fields from one seed and one flow. `flowTurns` is signed:
 *  turns per loop, negative for clockwise. Each field's advection
 *  fraction is the share of the flow speed its structures move at. */
function makeFields(seed: number, flowTurns: number): Fields {
    const rng = mulberry32(Math.floor(seed) * 7919 + 13)
    return {
        radial: makeField(rng, [1, 2, 2, 3, 3, 4, 5, 7], flowTurns * 0.55, 1, 0.7, 1.1),
        twist: makeField(rng, [2, 3, 4, 5, 6, 8], flowTurns * 0.45, 1, 0.35, 1.4),
        width: makeField(rng, [2, 3, 4, 5, 7], flowTurns * 0.6, 1, 0.45, 0.9),
        along: makeField(rng, [1, 2, 2, 3, 3, 4], flowTurns * 0.6, 1, 0.3, 1.2),
        density: makeField(rng, [1, 2, 3, 4, 6], flowTurns * 0.55, 1, 0.5, 1.3),
        medium: makeField(rng, [5, 7, 9, 12, 14], flowTurns * 0.7, 2, 0.4, 1.0),
    }
}

/* ------------------------------------------------------------------ glsl */

const TERMS = { radial: 8, twist: 6, width: 5, along: 6, density: 5, medium: 5 }

/** Points. Every visible property -- position, size, alpha -- is a
 *  closed-form function of (place in the material, loop phase). */
const POINT_VERT = `
precision highp float;

#define TAU 6.28318530718
#define PI 3.14159265359
#define HALFPI 1.57079632679

attribute vec3 aP;   // u0 (turns), v across (-1..1), w through (-1..1)
attribute vec4 aS;   // four seeds in 0..1

uniform float uTau;        // loop phase 0..1
uniform float uFlow;       // signed turns per loop
uniform float uSpray;      // 1 for the spray population
uniform float uLives;      // spray lives per loop (integer)
uniform vec2  uRes;        // backing store size
uniform float uScale;      // ring radius in NDC of the shorter side
uniform float uPx;         // point diameter in device px
uniform float uHalfW;
uniform float uThick;
uniform float uBulge;
uniform float uTwist;
uniform float uWaves;
uniform float uTurb;
uniform vec2  uGap;        // density mask smoothstep edges
uniform float uCrown;
uniform float uWeight;
uniform float uReach;
uniform float uLift;
uniform float uAlpha;

uniform vec4 uFR[${TERMS.radial}];  uniform vec4 uFRm;
uniform vec4 uFT[${TERMS.twist}];   uniform vec4 uFTm;
uniform vec4 uFW[${TERMS.width}];   uniform vec4 uFWm;
uniform vec4 uFA[${TERMS.along}];   uniform vec4 uFAm;
uniform vec4 uFD[${TERMS.density}]; uniform vec4 uFDm;
uniform vec4 uFM[${TERMS.medium}];  uniform vec4 uFMm;

varying float vA;
varying float vHot;
varying float vShade;

// Sum of K seeded sinusoids around the ring, phase-modulated by one
// slow carrier. See makeField in the source for the choice of terms.
#define FIELD(out, T, K, th, tau, fm) { \\
    float acc = 0.0; \\
    float md = fm.z * sin(fm.x * (th) + TAU * fm.y * (tau) + fm.w); \\
    for (int i = 0; i < K; i++) { \\
        vec4 q = T[i]; \\
        acc += q.z * sin(q.x * (th) + TAU * q.y * (tau) + q.w + md); \\
    } \\
    out = acc; \\
}

// The same, also returning d(field)/d(theta) -- the compression of the
// along-ring displacement, which is where the material is densest.
#define FIELD_D(out, dout, T, K, th, tau, fm) { \\
    float acc = 0.0; \\
    float dacc = 0.0; \\
    float md = fm.z * sin(fm.x * (th) + TAU * fm.y * (tau) + fm.w); \\
    float dmd = fm.z * fm.x * cos(fm.x * (th) + TAU * fm.y * (tau) + fm.w); \\
    for (int i = 0; i < K; i++) { \\
        vec4 q = T[i]; \\
        float ph = q.x * (th) + TAU * q.y * (tau) + q.w + md; \\
        acc += q.z * sin(ph); \\
        dacc += q.z * cos(ph) * (q.x + dmd); \\
    } \\
    out = acc; \\
    dout = dacc; \\
}

void main() {
    float v = aP.y;
    float w = aP.z;
    float outer = 0.5 + 0.5 * v;          // 0 at the inner edge, 1 at the outer
    float ef = 0.30 + 0.70 * outer;       // the inner edge is the calmer one

    // Spray points read the fields at the moment they left the ribbon,
    // so they are born exactly where it was and carry on from there.
    float p = 0.0;
    float age = 0.0;
    float tau = uTau;
    if (uSpray > 0.5) {
        p = fract(uLives * uTau + aS.w);
        age = p / uLives;
        tau = uTau - age;
    }

    // Place in the material, carried around by the flow.
    float th0 = TAU * (aP.x + uFlow * tau);

    // Along-ring waves: squeeze and stretch the material. The squared
    // term makes the displacement asymmetric, so the compression it
    // produces is a shock -- sharp leading edge, long trailing tail --
    // and a dense stretch reads as a sheet streaming round the ring. A
    // symmetric wave piles material into round lumps instead, which is
    // exactly the beads-on-a-string the frames do not have.
    float fa; float dfa;
    FIELD_D(fa, dfa, uFA, ${TERMS.along}, th0, tau, uFAm)
    float squeeze = uWaves * (0.6 + 0.4 * outer);
    float th = th0 + squeeze * (fa + 0.35 * fa * fa);
    // Material density relative to rest: the inverse of the stretch.
    // The floor caps compression at about three times rest. It is not
    // a safety clamp -- past that the shock overturns, a wide arc of
    // material lands on a narrow one, and the stretch collapses into a
    // round white disc sitting on the ring. The frames have bright
    // stretches, never discs.
    float comp = 1.0 / max(0.35, 1.0 + squeeze * dfa * (1.0 + 0.7 * fa));

    float fr; FIELD(fr, uFR, ${TERMS.radial}, th, tau, uFRm)
    float ft; FIELD(ft, uFT, ${TERMS.twist}, th, tau, uFTm)
    float fw; FIELD(fw, uFW, ${TERMS.width}, th, tau, uFWm)
    float fm; FIELD(fm, uFM, ${TERMS.medium}, th, tau, uFMm)
    // The density field is read at an angle warped by itself -- the
    // same shock -- so a gap tears open sharply and fills back slowly.
    float fd0; FIELD(fd0, uFD, ${TERMS.density}, th, tau, uFDm)
    float fd;  FIELD(fd, uFD, ${TERMS.density}, th + 0.9 * fd0, tau, uFDm)

    float c = cos(th);
    float s = sin(th);
    vec3 rhat = vec3(c, s, 0.0);
    vec3 that = vec3(-s, c, 0.0);
    vec3 zhat = vec3(0.0, 0.0, 1.0);

    // Screen-fixed composition, from the frames: a split crest at the
    // top of the ring, and weight at the bottom. Neither turns with the
    // material; the material passes through them.
    float dTop = mod(th - HALFPI + PI, TAU) - PI;
    float horn = exp(-dTop * dTop / 0.22);
    float gapT = exp(-dTop * dTop / 0.02);
    float crownMod = (0.3 + 0.7 * clamp(0.5 + 1.5 * fr, 0.0, 1.0))
                   * (0.6 + 0.4 * sin(TAU * tau + 2.0));
    float bottom = max(0.0, -s);

    float mask = smoothstep(uGap.x, uGap.y, fd);
    mask *= 1.0 - 0.9 * min(uCrown, 1.0) * gapT;

    // Width swings hard. The frames run from sheets several times the
    // mean width down to a blue thread, and the broad stretches are the
    // compressed ones, so a sheet tapers away as its tail stretches.
    // Two parts on purpose: the slow one is the low harmonics of the
    // width field, the fast one is the shocked compression. Only the
    // slow part is allowed near the radius below -- feeding a shock
    // into the contour spikes the silhouette into a zigzag, which the
    // frames never do.
    float wideSlow = clamp(0.30 + 1.50 * (fw + 0.42), 0.15, 2.6);
    // Compression is allowed only a little width. Letting it fatten the
    // ribbon as much as it brightens it turns every dense stretch into
    // a round bead, which is the one thing the frames never show: there
    // a squeezed stretch goes brighter and longer, not rounder.
    float wideFast = clamp(0.75 + 0.28 * comp, 0.60, 1.35);
    // Four multipliers, so they have to be capped as a product and not
    // one at a time: each is reasonable alone and their peaks together
    // were reaching half the ring's radius, which is what actually drew
    // the round white discs. 1.9 of the mean is the widest sheet in the
    // frames, 0.30 the thin blue thread between them.
    float wmul = clamp(wideSlow * wideFast
                     * (1.0 + 0.35 * uWeight * bottom)
                     * (0.42 + 0.58 * mask), 0.18, 1.40);
    float hw = uHalfW * wmul;
    float hwSlow = uHalfW * clamp(wideSlow * (1.0 + 0.35 * uWeight * bottom), 0.30, 1.9);

    float twist = uTwist * ft;
    float ct = cos(twist);
    float st = sin(twist);
    vec3 what = ct * rhat + st * zhat;     // across the ribbon
    vec3 nhat = -st * rhat + ct * zhat;    // through it

    float crown = uCrown * horn * outer * crownMod;
    // Width grows outward: the inner contour holds while the outer
    // edge does the bulging, which is how the frames keep their hole.
    float R = 1.0 + uBulge * (fr + 0.06 * fm) * ef + 0.16 * crown + 0.7 * (hwSlow - uHalfW);

    vec3 P = R * rhat + v * hw * what + w * uThick * nhat;
    P.y += 0.2 * crown;

    // Per-point wander: a small Lissajous with integer frequencies, so
    // it closes on the loop like everything else.
    float f1 = 2.0 + floor(aS.x * 4.0);
    float f2 = 2.0 + floor(aS.y * 4.0);
    float f3 = 1.0 + floor(aS.z * 3.0);
    vec3 jit = vec3(
        sin(TAU * (f1 * tau + aS.y)),
        sin(TAU * (f2 * tau + aS.z)),
        sin(TAU * (f3 * tau + aS.x)));
    P += (that * jit.x * 2.2 + what * jit.y * 0.8 + nhat * jit.z * 0.5) * uTurb * (0.3 + 0.7 * outer);

    float facing = clamp(ct * 0.5 + 0.5, 0.0, 1.0);
    float lum = 1.0;
    float sprayHot = -1.0;

    if (uSpray > 0.5) {
        // Where a plume erupts, and how hard. The field is read at the
        // birth angle and the birth moment, so most of the ring only
        // fizzes while a few stretches throw a fountain half a radius
        // up -- the small-spray / big-burst mix the frames show -- and
        // a site builds, fires and dies as the flow streams through it.
        // Two fixed high harmonics travelling round the ring, plus the
        // fields for irregularity. The fields alone -- even the medium
        // one -- have phases where every term is low at once and the
        // whole ring stops shedding for seconds together; these two
        // guarantee nine or so live sites at every moment, and their
        // integer frequencies keep the loop closed like everything else.
        float sites = 0.55 * sin(7.0 * th + TAU * 2.0 * tau + 1.7)
                    + 0.35 * sin(11.0 * th - TAU * 3.0 * tau);
        float b = smoothstep(0.05, 0.85,
            0.55 * fm + 0.35 * fd0 + 0.30 * fr + 0.60 * sites + 0.20 * (aS.y - 0.5));
        // A floor so the ribbon always sheds, and a square so the sites
        // that do fire throw a fountain rather than raise the haze.
        float burst = 0.30 + 2.1 * b * b;

        // Fast off the sheet then coasting, so a plume is a tight
        // column at its base and separate dots by the time it fades.
        float q = 1.0 - pow(1.0 - p, 1.8);
        float loose = 0.25 + 0.75 * q;

        // Up is screen-up and does not turn with the ring: every spray
        // in the frames rises, whatever part of the ring it leaves. It
        // has to stay the biggest of these three terms -- when the
        // outward and fan terms matched it, a big site blew a round
        // ball of points instead of throwing a fountain.
        P += vec3(0.0, 1.0, 0.0) * uLift * burst * q;
        P += rhat * uReach * burst * q * (0.25 + 0.75 * aS.x) * 1.1;
        // Some of the ribbon's own momentum goes with it, so a plume
        // leans into the flow instead of standing straight up.
        P += that * uFlow * TAU * 0.22 * age;
        // And it fans as it climbs -- dense at the base, loose at the
        // tip -- mostly along the flow, so the plume broadens sideways
        // the way a fountain does rather than swelling in every axis.
        P += (that * (aS.x - 0.5) * 2.6
            + rhat * (aS.y - 0.5) * 0.7
            + zhat * (aS.z - 0.5) * 0.7)
           * (0.9 * uReach * burst) * loose * q;

        float upper = 0.5 + 0.5 * s;
        lum = 2.6 * burst * mix(1.0, 0.45 + 0.55 * upper, 0.6)
            * pow(1.0 - p, 1.15) * min(1.0, p * 12.0);
        mask = 0.55 + 0.45 * mask;
        comp = 1.0;
        facing = 1.0;
        // Spray is torn off the lit face, so it stays cyan-white all
        // the way out; the big bursts run whiter than the fizz.
        sprayHot = 0.45 + 0.5 * min(1.0, b + 0.25);
    }

    // Slight perspective: a twist toward the camera reads a little
    // larger and brighter.
    float persp = ${CAM.toFixed(2)} / (${CAM.toFixed(2)} - P.z);
    float minDim = min(uRes.x, uRes.y);
    vec2 ndc = P.xy * persp * uScale * vec2(minDim / uRes.x, minDim / uRes.y);
    gl_Position = vec4(ndc, 0.0, 1.0);

    // Shading, signed: the sheet is lit from the camera, so a section
    // whose face has rolled toward us burns cyan-white, an edge-on fold
    // is a thin dim line, and a section rolled face-away keeps the deep
    // blue the frames show under and between the bright sheets. The
    // floor is high because that blue is vivid in the frames, not dark.
    float shade = mix(0.26, 1.0, facing * facing) * (1.0 + 2.2 * P.z);
    float edge = 1.0 - 0.55 * pow(abs(v), 4.0);
    // Streaks: the material carries fine filaments along the flow, so
    // the sheet reads as combed rather than as fog. They roll with the
    // twist, which is what turns them into the diagonal folds.
    float streak = 0.42 + 0.58 * sin(TAU * (6.5 * v + 0.4 * sin(TAU * 7.0 * aP.x) + 0.25 * fm));
    if (uSpray > 0.5) { shade = 1.0; edge = 1.0; streak = 1.0; }
    vA = uAlpha * lum * shade * edge * streak * (0.05 + 0.95 * mask);
    // Two colours and one white. A point rolled away draws the deep
    // blue, a point on the lit face draws the swatch cyan, and a point
    // that is both face-on and squeezed draws white. Stacking does the
    // rest: cyan saturates green and blue first, so a thick sheet goes
    // white exactly where the frames put white, and the blue only ever
    // survives where the material is thin or turned under.
    // Blue is the thin and the turned-under material, cyan the lit
    // face, and stacking takes the thick stretches on to white. Keying
    // it to the mask as well as to the facing is what puts the vivid
    // blue on the trailing threads, which is where the frames have it.
    vShade = pow(smoothstep(0.05, 0.48, facing), 0.75)
           * (0.50 + 0.50 * smoothstep(0.10, 0.70, mask));
    float hot = (0.18 + 0.82 * pow(facing, 1.2)) * smoothstep(0.35, 1.30, comp) * (0.20 + 0.80 * mask);
    vHot = 0.85 * (sprayHot >= 0.0 ? sprayHot : hot);
    gl_PointSize = max(1.0, uPx * persp * (0.75 + 0.5 * aS.z));
}
`

const POINT_FRAG = `
precision mediump float;
uniform vec3 uColor;   // the lit face: electric cyan
uniform vec3 uDeep;    // the rolled-away underside: deep blue
varying float vA;
varying float vHot;
varying float vShade;
void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d = dot(q, q);
    if (d > 1.0) discard;
    float a = vA * (1.0 - smoothstep(0.45, 1.0, d));
    vec3 col = mix(mix(uDeep, uColor, vShade), vec3(1.0), vHot);
    gl_FragColor = vec4(col * a, a);
}
`

const QUAD_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/** 9-tap separable gaussian. The same program downsamples: reading a
 *  full-res source into a half-res target through it is the blur and
 *  the reduction in one pass. */
const BLUR_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
    vec3 c = texture2D(uTex, vUv).rgb * 0.2270;
    c += (texture2D(uTex, vUv + uStep).rgb + texture2D(uTex, vUv - uStep).rgb) * 0.1946;
    c += (texture2D(uTex, vUv + uStep * 2.0).rgb + texture2D(uTex, vUv - uStep * 2.0).rgb) * 0.1216;
    c += (texture2D(uTex, vUv + uStep * 3.0).rgb + texture2D(uTex, vUv - uStep * 3.0).rgb) * 0.0540;
    c += (texture2D(uTex, vUv + uStep * 4.0).rgb + texture2D(uTex, vUv - uStep * 4.0).rgb) * 0.0162;
    gl_FragColor = vec4(c, 1.0);
}
`

const COMP_FRAG = `
precision mediump float;
uniform sampler2D uScene;
uniform sampler2D uB0;
uniform sampler2D uB1;
uniform sampler2D uB2;
uniform sampler2D uB3;
uniform sampler2D uB4;
uniform sampler2D uB5;
uniform vec3 uBg;
uniform vec3 uHaloTint;
uniform float uBloom;
uniform float uHalo;
varying vec2 vUv;
void main() {
    vec3 scene = texture2D(uScene, vUv).rgb;
    // Six levels, halving each time, because the frames' atmosphere is
    // enormous: two thirds of every reference frame sits above black,
    // almost all of it dim cyan a long way from any particle. Measured
    // against a four-level chain the build lit under a quarter of the
    // frame. b0/b1 are the tight burn on the crests; b4 and b5, blurred
    // at a sixteenth and a thirty-second of full size, are what carries
    // light out to the corners.
    vec3 b0 = texture2D(uB0, vUv).rgb;
    vec3 b1 = texture2D(uB1, vUv).rgb;
    vec3 b2 = texture2D(uB2, vUv).rgb;
    vec3 b3 = texture2D(uB3, vUv).rgb;
    vec3 b4 = texture2D(uB4, vUv).rgb;
    vec3 b5 = texture2D(uB5, vUv).rgb;
    // The halo is driven by the wide levels' brightness but painted in
    // one tinted colour rather than blurred from the scene. Probing the
    // reference frames, the atmosphere is red-free wherever it is not a
    // core -- 0,29,46 a quarter of the way in, 0,52,79 just outside the
    // ring -- so a neutral blur of white crests cannot produce it: it
    // washes the whole frame pale. Only the tight bloom keeps the
    // scene's own colour, which is what keeps the crests white.
    vec3 wide = 0.20 * b2 + 0.32 * b3 + 0.70 * b4 + 1.45 * b5;
    float wideL = dot(wide, vec3(0.28, 0.52, 0.20));
    vec3 col = uBg + scene + uBloom * (0.15 * b0 + 0.85 * b1)
             + uHalo * wideL * uHaloTint;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`

/* ------------------------------------------------------------------ scene */

interface Params {
    background: string
    color: string
    deepColor: string
    size: number
    thickness: number
    particles: number
    pointSize: number
    speed: number
    direction: string
    shape: ShapeSettings
    spray: SpraySettings
    glow: GlowSettings
    seed: number
    loopSeconds: number
    turns: number
    weight: number
    depth: number
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

function compile(gl: WebGLRenderingContext, type: number, src: string) {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("VortexRing shader:", gl.getShaderInfoLog(sh))
        gl.deleteShader(sh)
        return null
    }
    return sh
}

function link(gl: WebGLRenderingContext, vs: string, fs: string) {
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
        console.error("VortexRing link:", gl.getProgramInfoLog(prog))
        gl.deleteProgram(prog)
        return null
    }
    return prog
}

/** Ribbon points: place along and across the ring uniform (the
 *  shader fades the outermost band so the edges resolve into dots),
 *  place through it triangular so the sheet has a dense core. Spray
 *  points sit on the outer edge. Seven floats per point: u0, v, w and
 *  four seeds. */
function buildPoints(rng: () => number, count: number, spray: boolean) {
    const data = new Float32Array(count * 7)
    for (let i = 0; i < count; i++) {
        const o = i * 7
        data[o + 0] = rng()
        if (spray) {
            // Across the whole sheet, biased outward. The frames tear
            // material off the face of the ribbon, not only off its rim.
            data[o + 1] = -0.3 + 1.3 * rng()
            data[o + 2] = (rng() - 0.5) * 0.6
        } else {
            data[o + 1] = rng() * 2 - 1
            data[o + 2] = rng() + rng() - 1
        }
        data[o + 3] = rng()
        data[o + 4] = rng()
        data[o + 5] = rng()
        data[o + 6] = rng()
    }
    return data
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
    const gl =
        (canvas.getContext("webgl", opts) as WebGLRenderingContext | null) ||
        (canvas.getContext("experimental-webgl", opts) as WebGLRenderingContext | null)
    if (!gl) return null

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
        "uTau", "uFlow", "uSpray", "uLives", "uRes", "uScale", "uPx", "uHalfW",
        "uThick", "uBulge", "uTwist", "uWaves", "uTurb", "uGap", "uCrown",
        "uWeight", "uReach", "uLift", "uAlpha", "uColor", "uDeep",
        "uFR", "uFRm", "uFT", "uFTm", "uFW", "uFWm", "uFA", "uFAm", "uFD", "uFDm", "uFM", "uFMm",
    ])
    const uB = U(progBlur, ["uTex", "uStep"])
    const uC = U(progComp, ["uScene", "uB0", "uB1", "uB2", "uB3", "uB4", "uB5", "uBg", "uHaloTint", "uBloom", "uHalo"])
    const aP = gl.getAttribLocation(progPoints, "aP")
    const aS = gl.getAttribLocation(progPoints, "aS")
    const aPosBlur = gl.getAttribLocation(progBlur, "aPos")
    const aPosComp = gl.getAttribLocation(progComp, "aPos")

    const quadBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    const ribbonBuf = gl.createBuffer()
    const sprayBuf = gl.createBuffer()
    if (!quadBuf || !ribbonBuf || !sprayBuf) return null

    let params = first
    let phase = 0.15 // where the static frame sits; a good-looking moment
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

    let builtRibbon = 0
    let builtSpray = 0
    let builtSeed = NaN
    let fields: Fields | null = null
    let fieldsKey = ""

    function makeTarget(w: number, h: number): Target | null {
        const tex = gl!.createTexture()
        const fb = gl!.createFramebuffer()
        if (!tex || !fb) return null
        gl!.bindTexture(gl!.TEXTURE_2D, tex)
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, fb)
        gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0)
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
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
        for (let i = 0; i < 6; i++) {
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

    function counts(p: Params) {
        const total = clamp(Math.round(num(p.particles, DEFAULTS.particles)), MIN_POINTS, MAX_POINTS)
        const spray = Math.round(total * sprayShare(num(p.spray.amount, DEFAULT_SPRAY.amount)))
        return { ribbon: Math.max(1, total - spray), spray }
    }

    function ensurePoints(p: Params) {
        const seed = Math.floor(num(p.seed, DEFAULTS.seed))
        const c = counts(p)
        if (c.ribbon === builtRibbon && c.spray === builtSpray && seed === builtSeed) return
        const rng = mulberry32(seed * 2654435761 + 1)
        gl!.bindBuffer(gl!.ARRAY_BUFFER, ribbonBuf)
        gl!.bufferData(gl!.ARRAY_BUFFER, buildPoints(rng, c.ribbon, false), gl!.STATIC_DRAW)
        gl!.bindBuffer(gl!.ARRAY_BUFFER, sprayBuf)
        gl!.bufferData(gl!.ARRAY_BUFFER, buildPoints(rng, Math.max(1, c.spray), true), gl!.STATIC_DRAW)
        builtRibbon = c.ribbon
        builtSpray = c.spray
        builtSeed = seed
    }

    function flowTurns(p: Params) {
        const t = Math.max(1, Math.round(num(p.turns, DEFAULTS.turns)))
        // Clockwise on screen is decreasing angle.
        return p.direction === "counterclockwise" ? t : -t
    }

    function ensureFields(p: Params) {
        const seed = Math.floor(num(p.seed, DEFAULTS.seed))
        const flow = flowTurns(p)
        const key = seed + "/" + flow
        if (key === fieldsKey && fields) return
        fields = makeFields(seed, flow)
        fieldsKey = key
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

    function drawPoints(buf: WebGLBuffer, count: number, spray: boolean) {
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buf)
        gl!.enableVertexAttribArray(aP)
        gl!.vertexAttribPointer(aP, 3, gl!.FLOAT, false, 28, 0)
        gl!.enableVertexAttribArray(aS)
        gl!.vertexAttribPointer(aS, 4, gl!.FLOAT, false, 28, 12)
        gl!.uniform1f(uP.uSpray, spray ? 1 : 0)
        gl!.drawArrays(gl!.POINTS, 0, count)
    }

    function setField(loc: WebGLUniformLocation | null, mloc: WebGLUniformLocation | null, f: FieldSpec) {
        gl!.uniform4fv(loc, f.terms)
        gl!.uniform4f(mloc, f.fm[0], f.fm[1], f.fm[2], f.fm[3])
    }

    function draw(dpr: number) {
        if (!sceneT || mips.length < 6) return
        const p = params
        ensurePoints(p)
        ensureFields(p)
        const F = fields!
        const w = canvas.width
        const h = canvas.height
        const minDim = Math.min(w, h)

        const shape = p.shape
        const spray = p.spray
        const glow = p.glow
        const px = Math.max(0.5, num(p.pointSize, DEFAULTS.pointSize))
        const pxDev = (px * dpr * minDim) / (REF_DIM * dpr)
        const total = builtRibbon + builtSpray
        const alpha = 1.75 * Math.sqrt(REF_COUNT / total) * (REF_POINT / px)
        const [gapLo, gapHi] = gapEdges(num(shape.gaps, DEFAULT_SHAPE.gaps))

        // 1. Points, additive, into the scene target.
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, sceneT.fb)
        gl!.viewport(0, 0, w, h)
        gl!.clearColor(0, 0, 0, 0)
        gl!.clear(gl!.COLOR_BUFFER_BIT)
        gl!.enable(gl!.BLEND)
        gl!.blendFunc(gl!.ONE, gl!.ONE)
        gl!.useProgram(progPoints)
        gl!.uniform1f(uP.uTau, phase)
        gl!.uniform1f(uP.uFlow, flowTurns(p))
        gl!.uniform1f(uP.uLives, 18)
        gl!.uniform2f(uP.uRes, w, h)
        gl!.uniform1f(uP.uScale, clamp(num(p.size, DEFAULTS.size), 10, 100) / 100 / OUTER_EXTENT)
        gl!.uniform1f(uP.uPx, pxDev)
        gl!.uniform1f(uP.uHalfW, halfWidth(num(p.thickness, DEFAULTS.thickness)))
        gl!.uniform1f(uP.uThick, halfDepth(num(p.depth, DEFAULTS.depth)))
        gl!.uniform1f(uP.uBulge, bulgeAmp(num(shape.bulge, DEFAULT_SHAPE.bulge)))
        gl!.uniform1f(uP.uTwist, twistAmp(num(shape.twist, DEFAULT_SHAPE.twist)))
        gl!.uniform1f(uP.uWaves, wavesAmp(num(shape.waves, DEFAULT_SHAPE.waves)))
        gl!.uniform1f(uP.uTurb, turbAmp(num(shape.turbulence, DEFAULT_SHAPE.turbulence)))
        gl!.uniform2f(uP.uGap, gapLo, gapHi)
        gl!.uniform1f(uP.uCrown, clamp(num(shape.crown, DEFAULT_SHAPE.crown), 0, 10) / 5)
        gl!.uniform1f(uP.uWeight, clamp(num(p.weight, DEFAULTS.weight), 0, 10) / 5)
        gl!.uniform1f(uP.uReach, sprayReach(num(spray.reach, DEFAULT_SPRAY.reach)))
        gl!.uniform1f(uP.uLift, sprayLift(num(spray.lift, DEFAULT_SPRAY.lift)))
        gl!.uniform1f(uP.uAlpha, alpha)
        const col = toRGB(p.color)
        gl!.uniform3f(uP.uColor, col[0], col[1], col[2])
        const deep = toRGB(p.deepColor)
        gl!.uniform3f(uP.uDeep, deep[0], deep[1], deep[2])
        setField(uP.uFR, uP.uFRm, F.radial)
        setField(uP.uFT, uP.uFTm, F.twist)
        setField(uP.uFW, uP.uFWm, F.width)
        setField(uP.uFA, uP.uFAm, F.along)
        setField(uP.uFD, uP.uFDm, F.density)
        setField(uP.uFM, uP.uFMm, F.medium)
        drawPoints(ribbonBuf!, builtRibbon, false)
        if (builtSpray > 0) drawPoints(sprayBuf!, builtSpray, true)
        gl!.disable(gl!.BLEND)

        // 2. Blur chain: each level reads the one above, halving as it
        //    goes. The two widest levels are blurred three times over
        //    instead of once. One pass each gives a glow that is very
        //    bright at the ring and gone by mid-frame; the reference
        //    falls only from about 80 just outside the ring to about 25
        //    at the edges, and that ratio needs a much longer tail than
        //    a single 9-tap at a sixty-fourth of full size can reach.
        let src: Target = sceneT
        for (let i = 0; i < mips.length; i++) {
            const [a, b] = mips[i]
            blurInto(src, a, 1, 0)
            blurInto(a, b, 0, 1)
            if (i >= 4) {
                for (let k = 0; k < 2; k++) {
                    blurInto(b, a, 1, 0)
                    blurInto(a, b, 0, 1)
                }
            }
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
        bind(5, mips[4][1].tex, uC.uB4)
        bind(6, mips[5][1].tex, uC.uB5)
        const bg = toRGB(p.background)
        gl!.uniform3f(uC.uBg, bg[0], bg[1], bg[2])
        // The atmosphere's own colour: mostly the swatch but pulled
        // toward the shadow blue, with its red almost entirely out, then
        // normalized so Halo alone sets its level. The frames' far field
        // runs green:blue near 0.55 -- bluer than the swatch itself --
        // because what scatters furthest is the deep material, not the
        // white crests.
        const mixDeep = 0.45
        const tint = [
            (col[0] * (1 - mixDeep) + deep[0] * mixDeep) * 0.12,
            col[1] * (1 - mixDeep) + deep[1] * mixDeep,
            col[2] * (1 - mixDeep) + deep[2] * mixDeep,
        ]
        const peak = Math.max(tint[0], tint[1], tint[2], 1e-3)
        gl!.uniform3f(uC.uHaloTint, tint[0] / peak, tint[1] / peak, tint[2] / peak)
        gl!.uniform1f(uC.uBloom, bloomStrength(num(glow.bloom, DEFAULT_GLOW.bloom)))
        gl!.uniform1f(uC.uHalo, haloStrength(num(glow.halo, DEFAULT_GLOW.halo)))
        drawQuad(aPosComp)
        needsFrame = false
    }

    function frame(dt: number) {
        const dpr = resize()
        const rate = speedRate(num(params.speed, DEFAULTS.speed))
        const loop = Math.max(1, num(params.loopSeconds, DEFAULTS.loopSeconds))
        if (!reduceMotion && rate > 0 && dt > 0) {
            phase = (phase + (dt * rate) / loop) % 1
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
        if (!disposed) host.dispatchEvent(new CustomEvent("vortexring-restore"))
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
            gl.deleteBuffer(ribbonBuf)
            gl.deleteBuffer(sprayBuf)
            gl.deleteProgram(progPoints)
            gl.deleteProgram(progBlur)
            gl.deleteProgram(progComp)
            const lose = gl.getExtension("WEBGL_lose_context")
            if (lose) lose.loseContext()
        },
    }
}

/* ------------------------------------------------------------------ props */

interface VortexRingProps {
    /** The colour behind the ring. Near-black navy is the reference. */
    background?: string
    /** The lit face of the ribbon, and the base of every bright pixel. */
    color?: string
    /** The rolled-away underside, showing between the bright sheets. */
    deepColor?: string
    /** Ring diameter as a percentage of the frame's shorter side. */
    size?: number
    /** Width of the ribbon, 0-10. */
    thickness?: number
    /** How many points make up the ring, spray included. */
    particles?: number
    /** Point diameter in CSS px at a 900px frame. */
    pointSize?: number
    /** Flow speed, 0-10. 0 holds still. */
    speed?: number
    /** Which way the material travels around the ring. */
    direction?: string
    /** The deformation dials. */
    shape?: Partial<ShapeSettings>
    /** The break-away points. */
    spray?: Partial<SpraySettings>
    /** Bloom and atmosphere. */
    glow?: Partial<GlowSettings>
    /** Picks one fixed ring out of the family. */
    seed?: number
    /** Seconds one loop takes at Speed 5. */
    loopSeconds?: number
    /** Whole turns the material makes per loop. */
    turns?: number
    /** How much heavier the bottom of the ring is than the top, 0-10. */
    weight?: number
    /** Thickness of the ribbon through its face, 0-10. */
    depth?: number
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
 * @framerIntrinsicHeight 900
 */
export default function VortexRing({
    background = DEFAULTS.background,
    color = DEFAULTS.color,
    deepColor = DEFAULTS.deepColor,
    size = DEFAULTS.size,
    thickness = DEFAULTS.thickness,
    particles = DEFAULTS.particles,
    pointSize = DEFAULTS.pointSize,
    speed = DEFAULTS.speed,
    direction = DEFAULTS.direction,
    shape,
    spray,
    glow,
    seed = DEFAULTS.seed,
    loopSeconds = DEFAULTS.loopSeconds,
    turns = DEFAULTS.turns,
    weight = DEFAULTS.weight,
    depth = DEFAULTS.depth,
    maxPixelRatio = DEFAULTS.maxPixelRatio,
    animateOnCanvas = DEFAULTS.animateOnCanvas,
    style,
}: VortexRingProps) {
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
        deepColor,
        size: num(size, DEFAULTS.size),
        thickness: num(thickness, DEFAULTS.thickness),
        particles: num(particles, DEFAULTS.particles),
        pointSize: num(pointSize, DEFAULTS.pointSize),
        speed: num(speed, DEFAULTS.speed),
        direction: direction === "counterclockwise" ? "counterclockwise" : "clockwise",
        shape: { ...DEFAULT_SHAPE, ...shape },
        spray: { ...DEFAULT_SPRAY, ...spray },
        glow: { ...DEFAULT_GLOW, ...glow },
        seed: num(seed, DEFAULTS.seed),
        loopSeconds: num(loopSeconds, DEFAULTS.loopSeconds),
        turns: num(turns, DEFAULTS.turns),
        weight: num(weight, DEFAULTS.weight),
        depth: num(depth, DEFAULTS.depth),
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
        host.addEventListener("vortexring-restore", onRestore)
        if (animate) scene.start()
        else scene.renderOnce()
        return () => {
            host.removeEventListener("vortexring-restore", onRestore)
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

    // Static approximation for the no-WebGL case: a soft ring of the
    // same colour over the same background.
    const fallbackStyle: CSSProperties = failed
        ? {
              background: `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${size * 0.36}%, ${deepColor} ${size * 0.43}%, ${color} ${size * 0.46}%, rgba(255,255,255,0.92) ${size * 0.485}%, ${color} ${size * 0.52}%, rgba(0,0,0,0) ${size * 0.62}%)`,
              filter: "blur(6px)",
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

addPropertyControls(VortexRing, {
    // ---------- Layout
    size: {
        type: ControlType.Number,
        title: "Size",
        description: "Ring diameter as a percentage of the frame's shorter side.",
        defaultValue: DEFAULTS.size,
        min: 20,
        max: 100,
        step: 1,
        unit: "%",
    },
    thickness: {
        type: ControlType.Number,
        title: "Thickness",
        description: "Width of the ribbon. 5 is the reference; 0 is a thread.",
        defaultValue: DEFAULTS.thickness,
        min: 0,
        max: 10,
        step: 0.1,
    },
    particles: {
        type: ControlType.Number,
        title: "Particles",
        description: "How many points make up the ring. More is finer grain, not brighter.",
        defaultValue: DEFAULTS.particles,
        min: 10000,
        max: 300000,
        step: 5000,
    },
    pointSize: {
        type: ControlType.Number,
        title: "Point Size",
        description: "Diameter of one point in pixels at a 900px frame. Smaller is grainier.",
        defaultValue: DEFAULTS.pointSize,
        min: 0.8,
        max: 8,
        step: 0.1,
        unit: "px",
    },

    // ---------- Animation
    speed: {
        type: ControlType.Number,
        title: "Speed",
        description: "How fast the material flows around the ring. 0 holds it still.",
        defaultValue: DEFAULTS.speed,
        min: 0,
        max: 10,
        step: 0.1,
    },
    direction: {
        type: ControlType.Enum,
        title: "Direction",
        description: "Which way the material travels around the ring.",
        defaultValue: DEFAULTS.direction,
        options: ["clockwise", "counterclockwise"],
        optionTitles: ["Clockwise", "Counter"],
        displaySegmentedControl: true,
    },
    shape: {
        type: ControlType.Object,
        title: "Shape",
        description: "The deformation, one dial per scale of motion. All neutral at 5.",
        defaultValue: DEFAULT_SHAPE,
        controls: {
            bulge: {
                type: ControlType.Number,
                title: "Bulge",
                description: "How far sections push out and pull in.",
                defaultValue: DEFAULT_SHAPE.bulge,
                min: 0,
                max: 10,
                step: 0.1,
            },
            twist: {
                type: ControlType.Number,
                title: "Twist",
                description: "How hard the ribbon rolls about its own path, making broad and thin sections.",
                defaultValue: DEFAULT_SHAPE.twist,
                min: 0,
                max: 10,
                step: 0.1,
            },
            waves: {
                type: ControlType.Number,
                title: "Waves",
                description: "How strongly material bunches into lobes and stretches thin between them.",
                defaultValue: DEFAULT_SHAPE.waves,
                min: 0,
                max: 10,
                step: 0.1,
            },
            turbulence: {
                type: ControlType.Number,
                title: "Turbulence",
                description: "How much each point wanders on its own inside the sheet.",
                defaultValue: DEFAULT_SHAPE.turbulence,
                min: 0,
                max: 10,
                step: 0.1,
            },
            gaps: {
                type: ControlType.Number,
                title: "Gaps",
                description: "How far the sparse stretches thin out. 0 keeps the ring continuous.",
                defaultValue: DEFAULT_SHAPE.gaps,
                min: 0,
                max: 10,
                step: 0.1,
            },
            crown: {
                type: ControlType.Number,
                title: "Crown",
                description: "The split crests at the top of the ring. 0 removes them.",
                defaultValue: DEFAULT_SHAPE.crown,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },
    spray: {
        type: ControlType.Object,
        title: "Spray",
        description: "The points that break away from the outer edge.",
        defaultValue: DEFAULT_SPRAY,
        controls: {
            amount: {
                type: ControlType.Number,
                title: "Amount",
                description: "Share of the points that break away.",
                defaultValue: DEFAULT_SPRAY.amount,
                min: 0,
                max: 10,
                step: 0.1,
            },
            reach: {
                type: ControlType.Number,
                title: "Reach",
                description: "How far outward they get before they fade.",
                defaultValue: DEFAULT_SPRAY.reach,
                min: 0,
                max: 10,
                step: 0.1,
                hidden: (props) => props.amount === 0,
            },
            lift: {
                type: ControlType.Number,
                title: "Lift",
                description: "How much they rise on the way. 0 makes the spray symmetric.",
                defaultValue: DEFAULT_SPRAY.lift,
                min: 0,
                max: 10,
                step: 0.1,
                hidden: (props) => props.amount === 0,
            },
        },
    },
    seed: {
        type: ControlType.Number,
        title: "Seed",
        description: "Picks one fixed ring out of the family. Same seed, same ring.",
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
        description: "The colour behind the ring.",
        defaultValue: DEFAULTS.background,
    },
    color: {
        type: ControlType.Color,
        title: "Color",
        description: "The lit face of the ribbon. Where the points pile up it burns through to white.",
        defaultValue: DEFAULTS.color,
    },
    deepColor: {
        type: ControlType.Color,
        title: "Shadow Color",
        description: "The rolled-away underside of the ribbon, showing between the bright sheets.",
        defaultValue: DEFAULTS.deepColor,
    },

    // ---------- Effects
    glow: {
        type: ControlType.Object,
        title: "Glow",
        description: "Tight bloom on the crests and a wide atmosphere around the ring.",
        defaultValue: DEFAULT_GLOW,
        controls: {
            bloom: {
                type: ControlType.Number,
                title: "Bloom",
                description: "Bloom around the bright crests.",
                defaultValue: DEFAULT_GLOW.bloom,
                min: 0,
                max: 10,
                step: 0.1,
            },
            halo: {
                type: ControlType.Number,
                title: "Halo",
                description: "The wide soft atmosphere around the whole ring.",
                defaultValue: DEFAULT_GLOW.halo,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },
})
