"use client"

import { addPropertyControls, ControlType } from "framer"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"

/* ------------------------------------------------------------------ *
 *  AuroraSeam
 *  A seam of light lying on the horizon of the frame, swelling into
 *  lens-shaped lobes and pinching back to a needle at either margin.
 *
 *  Built to the "Particle Wave Visualizer" blueprint and to ten frames
 *  of the reference loop. The blueprint's vertex maths is transcribed
 *  as written -- its Envelope(X), its SUM[A_i * sin(k_i*X - omega_i*t
 *  + phi_N)], its CurlNoise term, its exp(-d*d*4.0) sprite softening
 *  and its UnrealBloomPass numbers, which are this file's defaults.
 *  Where the frames contradict the blueprint the frames win, and each
 *  of those places says so in a comment.
 *
 *  WHAT IS ACTUALLY DRAWN
 *    A crowd of gl.POINTS -- a few hundred strands, each a row of
 *    points sampled uniformly in X -- and nothing else. There is no
 *    line, no mesh, no ribbon. Everything the eye reads as structure
 *    is the crowd overlapping itself:
 *
 *      the needle    every strand's displacement is multiplied by an
 *                    envelope that reaches zero at the frame's edges,
 *                    so out there the whole family collapses onto one
 *                    row of pixels and stacks a few hundred deep. The
 *                    hairline is not an element -- it is the entire
 *                    component seen end-on
 *      the caustics  the hard bright rims bounding each lobe are the
 *                    envelope of the family of curves: where adjacent
 *                    strands turn over together their points pile up
 *                    and the additive sum spikes
 *      the nodes     the X-shaped cusps where a lobe narrows to a
 *                    point are where every strand crosses at once
 *      the grain     points are spaced uniformly in X, so on a steep
 *                    segment they spread apart and resolve as speckle.
 *                    In the reference the grain sits exactly where the
 *                    strands twist hardest, which is what says the
 *                    renderer is points and not line strips
 *
 *  ONE COLOUR, NOT A RAMP
 *    The blueprint asks for a cyan -> cobalt -> fuchsia ramp keyed to
 *    abs(Y). The reference frames have no cyan and no magenta in them:
 *    they are a single violet, going to white only where the stack is
 *    deepest. So every point is drawn flat in one colour and every
 *    value brighter than that colour is overlap. This also matches
 *    where the brightness actually falls -- the outermost caustic rims
 *    are among the brightest pixels in the frames, which an abs(Y)
 *    ramp would have washed out.
 *
 *  NO SPRING
 *    The blueprint's "harmonic elasticity" -- tension back toward
 *    Y = 0 with overshoot -- is not in the frames, and a solver would
 *    only add a settling transient the reference never shows. The
 *    displacement stays closed-form and is evaluated fresh every
 *    frame, so every control is live and nothing has to converge.
 *
 *  PHASE MULTIPLES, NOT ONE PHASE
 *    phi_N is the strand's place in the family, and each harmonic
 *    takes a different whole multiple of it. Handing all three the
 *    same phi would make every strand the same curve slid sideways --
 *    a smooth lens with no nodes in it. The multiples are what make
 *    the family beat, and the beat is the picture.
 *
 *  NO TRANSITION CONTROL
 *    Nothing here is a framer-motion animation -- it is a rAF loop
 *    over shader uniforms -- so there is no curve to hand a Transition
 *    to. Speed, Waves, Taper and Turbulence are the motion's dials.
 *
 *  Raw WebGL, no dependencies. Sizes come from the container, so
 *  several can sit on one page and it behaves in a frame of any size.
 * ------------------------------------------------------------------ */

/* ---------------------------------------------------------- constants */

/** Never oversample the backing store past this. */
const DPR_CAP = 2

/** Point budget for one frame, across every strand. Beyond this the
 *  points per strand are thinned rather than the strand count, because
 *  losing strands loses the stacking that makes the needle. */
const MAX_POINTS = 200000

/** Bounds on the points per strand, which is derived from the frame's
 *  CSS width rather than set by a slider -- a strand wants roughly one
 *  point per CSS pixel to read continuous, and what that means in
 *  points depends entirely on how wide the thing has been dropped in.
 *  Density scales that ratio; see wantedPerStrand for why the width is
 *  the CSS one and not the backing store's. */
const MIN_PER_STRAND = 160
const MAX_PER_STRAND = 3200

/** Rebuilding the point buffer allocates a couple of megabytes, so a
 *  resize only triggers one when the count has moved more than this. */
const REBUILD_TOLERANCE = 0.15

/** Strand count the Opacity scale is calibrated against. Per-point
 *  alpha is divided by sqrt(strands / this), so pushing Strands up
 *  adds fibre instead of flooding the frame white. */
const REF_STRANDS = 140

/* ----------------------------------------------------------- defaults */

export interface SectionsSettings {
    /** How many wave cells the line is cut into. */
    count: number
    /** How hard each section pinches shut at its own two joins. */
    taper: number
    /** Width of the needle the collapsed strands draw at a join. */
    width: number
    /** How hot that needle burns, independently of how wide it is. */
    glow: number
    /** How much the cuts between them are softened. */
    bleed: number
    /** How far the sections are allowed to differ from one another. */
    variety: number
    /** How fast the whole run of sections travels along the line. */
    drift: number
}

/** The line, cut into repeating wave cells.
 *
 *  At Count 1 there is nothing to cut and every term in the shader
 *  folds back to what it was, so the component is exactly the
 *  unsectioned one -- that is the setting to go back to. Above 1 the
 *  seam becomes a row of separate bursts, each windowed so it pinches
 *  onto the axis at both of its own boundaries: one wave twists shut
 *  where the next begins, and the Ends group's needle appears at every
 *  one of those joins rather than only at the frame's two margins.
 *
 *  Variety deals each section its own amplitude, wavenumber and phase.
 *  It is the difference between a row of related events and the same
 *  burst stamped out N times, which reads as wallpaper. At 0 they are
 *  identical again.
 *
 *  Bleed lifts the section window off zero, so the cuts soften. At 10
 *  the window is gone entirely and the sections run back together into
 *  one wave, keeping only their differing phases -- which is a real
 *  third state, somewhere between sectioned and not.
 *
 *  Taper and Width are the joins' own, and are deliberately not the
 *  ones in Ends. A join in the middle of the line and the end of the
 *  whole seam are different things to look at: the ends want to run out
 *  long and fine into the horizon, while the joins between sections are
 *  usually better short and sharp, so the bursts read as separate
 *  rather than as one wave with dents in it. Sharing a single Taper
 *  between them meant every attempt to sharpen one blunted the other.
 *
 *  Width and Glow are deliberately two controls and not one. A wider
 *  join carries the same light through a wider mark rather than simply
 *  more of it, so Width changes only the shape of the join; Glow is the
 *  only thing that decides how hot it burns. Width runs to 50 because a
 *  join sits inside an already bright mass and has a long way to travel
 *  before it reads as a knot rather than a waist.
 *
 *  Drift slides the whole run of sections along the line. Because each
 *  section is pinched to nothing at its own boundaries, a section can
 *  be born, cross the frame and close again without anything ever
 *  appearing or vanishing in view: the identity swap happens exactly
 *  where there is nothing drawn. It is measured against the same clock
 *  as everything else, so Speed scales it too. */
const DEFAULT_SECTIONS: SectionsSettings = {
    count: 3,
    taper: 5,
    width: 5,
    glow: 5,
    bleed: 0,
    variety: 5,
    drift: 0,
}

export interface EndsSettings {
    /** How hard the envelope pinches toward the margins. */
    taper: number
    /** Width of the needle the collapsed strands draw. */
    thickness: number
    /** How hot that needle is allowed to burn. */
    whiteness: number
}

/** The tapered ends, which are one thing and get one group.
 *
 *  These are the frame's own two outer ends, and nothing else. The
 *  joins between sections have their own Taper, Width and Glow over in
 *  the Sections group, and the two sets do not reach into each other.
 *
 *  Out at the margins the envelope has collapsed every strand onto the axis,
 *  so a few hundred sprites are stacked on one row of pixels: that
 *  stack is what turns the seam white there, and the sprite's own
 *  diameter is what gives the white line its width. Taper decides how
 *  far in that collapse begins, Thickness how wide the line it draws
 *  is, Whiteness how hard it burns. Change any one and you are working
 *  on the ends, which is why they open together.
 *
 *  Taper ships one notch past the reference. The frames were traced at
 *  4; 5 draws the same body but runs the ends out into a longer, finer
 *  needle. Drop it back to 4 for the reference envelope exactly.
 *
 *  Thickness and Whiteness are both neutral at 5 -- the ends then draw
 *  exactly as the stacking leaves them, with nothing added or taken
 *  away, which is the reference. */
const DEFAULT_ENDS: EndsSettings = {
    taper: 5,
    thickness: 5,
    whiteness: 5,
}

/* Structure and Element defaults, matched against the reference frames
 * at 1200 x 600: the mass fills about 38% of the frame's height, holds
 * inside the middle two thirds of its width, and shows half a dozen
 * crossing ribbons over a fibrous fill. */

export interface PointerSettings {
    /** Whether the pointer swells the seam under it at all. */
    enabled: boolean
    /** Radius of that swell, as a share of the frame's width. */
    reach: number
    /** How far the swell lifts the strands it reaches. */
    strength: number
}

const DEFAULT_POINTER: PointerSettings = {
    enabled: true,
    reach: 4,
    strength: 4,
}

export interface BloomSettings {
    strength: number
    radius: number
    threshold: number
}

/** The blueprint's UnrealBloomPass settings, mid-range of each band it
 *  gives (strength 1.2-1.6, radius 0.4-0.6, threshold 0.7-0.8). The
 *  high threshold is the point: only the multiply-overlapped core
 *  blooms, and the void around it stays clean black. */
const DEFAULT_BLOOM: BloomSettings = {
    strength: 1.4,
    radius: 0.5,
    threshold: 0.75,
}

const DEFAULTS = {
    background: "#000000",
    strands: 42,
    density: 10,
    amplitude: 3.6,
    waves: 6,
    turbulence: 4,
    color: "rgb(139, 92, 246)",
    pointSize: 3.7,
    opacity: 5.8,
    speed: 17.7,
}

/* ------------------------------------------------------------ helpers */

/** Deterministic PRNG. The point lattice is jittered, and a jitter that
 *  came from Math.random would differ between the server's render and
 *  the client's -- and would reshuffle on every rebuild besides. */
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

const clamp = (v: number, lo: number, hi: number) =>
    v < lo ? lo : v > hi ? hi : v

/** Clock rate the travelling sum is advanced at, from Speed 0-25.
 *
 *  Blended linear and cubic rather than a straight multiply. A linear
 *  scale that puts the reference's rate at 5 could only ever reach five
 *  times it at 25, which is not a different speed so much as the same
 *  one hurried; this reaches about eighty times it, which is a wave
 *  that crosses half the frame in a little over a second. Still exactly
 *  zero at zero -- an eased scale that bottoms out at a slow crawl
 *  instead of a stop would cost the panel its only way to hold the seam
 *  still.
 *
 *  The curve itself is unchanged from when the slider stopped at 10, so
 *  every value that existed then still means what it meant; the extra
 *  track is all new headroom on top. 5 remains the reference rate. */
const SPEED_BASE = 0.09
const SPEED_MAX = 25
function speedRate(speed: number) {
    const s = clamp(speed, 0, SPEED_MAX) / 5
    return SPEED_BASE * (0.35 * s + 0.65 * s * s * s)
}

/** Exponent the envelope is raised to, from Taper 0-10.
 *
 *  Geometric for the same reason. A Taper of 4 gives 1.49, which is
 *  what the reference frames were matched at; 10 reaches about 9.5,
 *  a needle with almost no body left on it. The linear mapping this
 *  replaces topped out at 2.8, so the whole upper half of the slider
 *  was one broad envelope and no amount of dragging sharpened it. */
function taperExponent(taper: number) {
    return 0.43 * Math.pow(1.365, clamp(taper, 0, 10))
}

/** Diameter the sprites are scaled to out at the ends, from Thickness
 *  0-10. Neutral at 5, so the needle is left exactly as the stacking
 *  draws it unless the control is moved. */
function tipThickness(thickness: number) {
    return 0.35 + clamp(thickness, 0, 10) * 0.13
}

/** The same for a join, from Sections > Width 0-50. A join sits inside
 *  a bright mass rather than alone against the background, so it has to
 *  travel a great deal further than a frame end before the difference
 *  reads at all. Neutral at 5 like everything else, which puts the
 *  resting value near the bottom of the track on purpose: everything
 *  above it is headroom that did not exist before. */
function joinWidth(width: number) {
    return 0.15 + clamp(width, 0, 50) * 0.17
}

/** How hot a join burns, from Sections > Glow 0-10. Neutral at 5. This
 *  is the only thing that changes a join's brightness -- Width is
 *  compensated so that resizing it moves the same light around rather
 *  than making more of it. */
function joinGlow(glow: number) {
    return clamp(glow, 0, 10) * 0.2
}

/** How much of the end stack's alpha survives, from Whiteness 0-10.
 *  Neutral at 5. At 0 the collapsed strands are faded out before they
 *  can pile into white and the seam runs off into violet; at 10 they
 *  are pushed well past saturation, so the white core spreads further
 *  in from each margin. */
function tipWhiteness(whiteness: number) {
    return clamp(whiteness, 0, 10) * 0.2
}

/* -------------------------------------------------------------- glsl */

/** Ashima / Stefan Gustavson 3D simplex noise, unmodified. This is the
 *  blueprint's CurlNoise(X * s, N * s, t) sampler: two octaves of it,
 *  read at (position along the strand, strand index, time). */
const NOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`

const POINT_VERT = `
precision highp float;

// x along the strand in [-1,1], strand index in [0,1)
attribute vec2 aSeed;

uniform float uTime;
uniform float uAmp;
uniform float uWaves;
uniform float uTaper;
uniform float uTurb;
uniform float uPointSize;
uniform float uOpacity;
uniform float uAspect;
uniform vec2  uPointer;
uniform float uPointerAmt;
uniform float uReach;
uniform float uSwell;
uniform float uTipThick;
uniform float uTipWhite;
uniform float uSections;
uniform float uVariety;
uniform float uBleed;
uniform float uSecTaper;
uniform float uSecWidth;
uniform float uSecGlow;
uniform float uSecDrift;

varying float vAlpha;

${NOISE_GLSL}

const float TAU = 6.28318530718;

/**
 * Per-section randomness. Fixed, with no Seed control: a seed here
 * would only ever be rerolled until it looked like this one, and what
 * matters is that neighbouring sections differ at all, not which
 * particular differences they were dealt.
 */
float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

// SUM[A_i * sin(k_i * X - omega_i * t + phi_N)] from the blueprint's
// vertex spec. The k ratios are deliberately NOT whole multiples of one
// another: with k = (1,2,3) against phi multiples (1,2,3) the sum
// degenerates into a Fourier series in (kx + phi), every strand becomes
// the same curve translated sideways, and the nodes vanish.
const vec3 K_I = vec3(1.00, 2.30, 3.70);
const vec3 W_I = vec3(0.62, 0.97, 1.44);
const vec3 A_I = vec3(0.50, 0.30, 0.20);   // sums to 1, so |wave| <= 1
const vec3 PHI_I = vec3(1.0, 3.0, 6.0);    // whole multiples of phi_N

// The phi multiples are what set how many caustic rims run through the
// body. At a fixed x the family is y(phi), and a rim is one of its
// turning points, so the highest multiple is roughly the number of
// sheets the eye can pick out. (1, 2, 3) gives a lit outer edge and a
// dead interior; (1, 3, 6) gives the half-dozen crossing ribbons the
// reference has. They also have to stay clear of the k ratios above --
// matching them collapses the sum into a Fourier series in (kx + phi)
// and every strand becomes one curve slid sideways.

// Crest fade. In the frames the outermost strands are thinner than the
// body, not merely further out. Fixed rather than exposed: the envelope
// already decides where the crests are, so there is one right answer.
const float CREST_FADE = 0.55;

// Where the ends begin, as a share of how far the envelope has fallen.
// The Ends group only touches points past this, so the body of the
// seam is left alone whatever Thickness and Whiteness are set to.
const float TIP_ONSET = 0.5;

// How far in from a margin the frame's own taper reaches once the line
// is sectioned, as a share of the half-frame. Fixed rather than
// exposed: it is what makes Ends a control over the two ends instead of
// a second squash laid over every section, and there is one right
// answer -- far enough in to leave room for a taper, not so far that it
// reaches the sections in the middle.
const float FRAME_SHOULDER = 0.28;

/**
 * Envelope(X) = 1.0 - (2.0 * X / Width)^2, clamped -- the blueprint's
 * window function, with X pre-normalised so the frame spans [-1, 1].
 *
 * Raised to an exponent, which the blueprint does not do. The bare
 * parabola still carries three quarters of full amplitude a quarter of
 * the way out and a third of it at |x| = 0.8; the reference frames are
 * down to a hairline well before that, with the focal mass held inside
 * the middle two thirds. Taper is that exponent.
 */
float envelope(float x, float k) {
    return pow(clamp(1.0 - x * x, 0.0, 1.0), k);
}

/**
 * The frame's own window, which is two different shapes.
 *
 * Unsectioned it is the blueprint's parabola across the whole frame.
 * Sectioned it becomes a shoulder: flat across the middle, falling only
 * inside FRAME_SHOULDER of each margin.
 *
 * That difference is the whole point. A parabola spanning the frame
 * multiplies every section by a different amount depending on where it
 * sits, and by a different amount across its own length -- so an outer
 * section is pulled down harder on its outward side than its inward
 * one. The taper the Sections group asks for is then uniform in the
 * arithmetic and visibly lopsided on the screen, which is not a taper
 * control anyone can use. Confined to the margins it shapes the two
 * ends, which is its job, and leaves every section between them alone.
 */
float frameWindow(float x, float k, float on) {
    // How far in from the nearer margin, over 0 at the margin to 1 at
    // the inner edge of the shoulder, then held there.
    float d = clamp((1.0 - abs(x)) / FRAME_SHOULDER, 0.0, 1.0);

    // The shoulder is the OUTER HALF OF THE SAME PARABOLA, squeezed into
    // FRAME_SHOULDER of the frame -- which is why d is flipped into u
    // and handed straight back to envelope().
    //
    // It is not pow(d, k), which is what this was. That rises with a
    // slope of k / FRAME_SHOULDER and then stops dead where the clamp
    // holds d at 1, so the window has a corner in it at |x| = 1 -
    // FRAME_SHOULDER. Every strand is multiplied by that same window,
    // so one corner in it is a crease across the whole mass at once,
    // and the seam flares out of its needle along a straight edge like
    // a cone instead of curving out of it.
    //
    // Run through the parabola instead, the slope is 2ku(1-u^2)^(k-1),
    // which is zero at u = 0. The shoulder meets the flat middle with
    // no corner at all, and it leaves the margin the same way the
    // unsectioned window does -- because it is the same curve.
    float u = 1.0 - d;
    return mix(envelope(x, k), envelope(u, k), on);
}

/**
 * One section's harmonic sum, read at a position local to that section.
 * Written once and called for each of the two overlapping sections and
 * for the unsectioned line, so there is a single place where the phase
 * is assembled.
 */
float sectionWave(float p, float phi, float wScale, float pOff) {
    return dot(A_I, sin(
        K_I * uWaves * wScale * p - W_I * uTime + PHI_I * phi + pOff
    ));
}

void main() {
    float x = aSeed.x;
    float n = aSeed.y;

    // phi_N -- where this strand sits in the family.
    float phi = n * TAU;

    // SECTIONS
    //
    // The line is cut into equal sections and each one carries a whole
    // wave of its own, windowed so it pinches shut at both of its own
    // boundaries. At every cut the family collapses onto the axis
    // exactly the way it does at the frame's margins, so the seam reads
    // as a row of separate bursts strung along one line -- each one
    // twisting closed where the next begins -- rather than a single
    // wave running the whole width.
    //
    // The uOn switch below is what makes this free: at one section
    // there is nothing to cut, so every term folds back to what it was
    // and the component is bit-for-bit the unsectioned one.
    float cells = max(uSections, 1.0);
    float on = step(1.5, cells);

    // Drift slides the lattice along the line. There is no clamp on
    // the index and there does not need to be: a section is pinched to
    // nothing at both its boundaries, so whatever whole number the
    // drift carries it to, the swap happens where the seam is not
    // drawing. Sections are born, cross and close without ever being
    // seen to appear.
    float sf = (x * 0.5 + 0.5) * cells + uSecDrift * uTime * on;

    // Sections are windowed about their CENTRES rather than cut at
    // their edges, and each window can be widened past its own cell so
    // that neighbours overlap.
    //
    // That is the whole reason Bleed works at all. Two neighbouring
    // sections carry different waves, so a hard cut between them cannot
    // be softened by lifting it off zero -- doing that only uncovers
    // the step from one wave to the other, which is a seam being torn
    // open rather than healed. Overlapped, the two cross-fade through
    // one another by window weight and there is no step left to find.
    // The widening stops at exactly two cells, and that ceiling is not
    // taste. Only the two nearest sections are evaluated, so a window
    // that reaches past its neighbour's CENTRE would still be carrying
    // weight at the moment that pair swaps over, and the section being
    // dropped would take its contribution away in one step -- a hard
    // vertical edge standing in the middle of a section, which is worse
    // than the seam this is here to remove. At two cells a window is
    // exactly zero when it arrives at the next centre, so the swap
    // costs nothing and the blend stays continuous. It is also already
    // enough: at two cells the paired windows sum past 1 everywhere
    // along the line, so the join is gone completely.
    float wid = 1.0 + uBleed * 1.0 * on;

    float c0 = floor(sf - 0.5);
    float c1 = c0 + 1.0;

    // Position within each of the two, where +-1 is that section's own
    // edge. At one section the nearer of these is exactly x, which is
    // what lets the whole block fold away.
    float vA = (sf - (c0 + 0.5)) * 2.0 / wid;
    float vB = (sf - (c1 + 0.5)) * 2.0 / wid;

    float wA = envelope(vA, uSecTaper);
    float wB = envelope(vB, uSecTaper);

    // Each section is dealt its own amplitude, wavenumber and phase.
    // Without this a row of them is the same burst stamped out N times,
    // which reads as wallpaper; with it they land as a row of related
    // but distinct events. Variety is how far apart they may drift, and
    // at 0 they are identical again.
    float V = uVariety * on;
    float aA = mix(1.0, mix(0.45, 1.35, hash11(c0 + 11.7)), V);
    float sA = mix(1.0, mix(0.70, 1.45, hash11(c0 + 47.3)), V);
    float pA = hash11(c0 + 91.1) * TAU * V;
    float aB = mix(1.0, mix(0.45, 1.35, hash11(c1 + 11.7)), V);
    float sB = mix(1.0, mix(0.70, 1.45, hash11(c1 + 47.3)), V);
    float pB = hash11(c1 + 91.1) * TAU * V;

    float yA = aA * sectionWave(vA, phi, sA, pA);
    float yB = aB * sectionWave(vB, phi, sB, pB);

    // Cross-fade the two by their own window weights.
    float wSum = max(wA + wB, 1e-4);
    float waveSec = (wA * yA + wB * yB) / wSum;
    float aMix = (wA * aA + wB * aB) / wSum;

    // The unsectioned line is kept as its own term rather than left to
    // fall out of the pair above. It does fall out -- but only to
    // within a rounding error, and a guarantee that one section is
    // exactly the original is worth three more sines to keep exact.
    float waveUn = sectionWave(x, phi, 1.0, 0.0);

    float wave = mix(waveUn, waveSec, on);
    float aScale = mix(1.0, aMix, on);

    // CurlNoise(X * s, N * s, t): two octaves, the second a shade over
    // twice the frequency, read across the strand index as well as
    // along the strand so neighbours thread past one another instead
    // of rippling in lockstep.
    //
    // The scale on n is deliberately low. Sampling the noise at a high
    // frequency across the strand index decorrelates neighbouring
    // strands, and the caustics ARE the correlation -- a rim only
    // appears where a run of adjacent strands turns over together. Read
    // it too finely and the family stops being a set of sheets and
    // becomes one fuzzy mound with no rims anywhere in it.
    // Too low a scale on n is its own failure: the whole family then
    // shares one offset and the band bulk-shifts off the axis into a
    // lopsided mound. These two sit either side of that.
    float turb =
          snoise(vec3(x * 1.8, n * 3.0, uTime * 0.28))
        + 0.5 * snoise(vec3(x * 4.0, n * 6.5, uTime * 0.41));

    // The frame still tapers at its own two margins; the section window
    // sits on top of that, so the outermost sections are pulled down by
    // both and the chain fades into the horizon rather than stopping.
    //
    // Bleed lifts the section window off zero. At 0 the sections are
    // fully cut apart and the axis shows through between them; at 1 the
    // window is gone and they run together into one continuous wave
    // again, keeping only their differing phases -- which is a genuinely
    // useful third thing, somewhere between sectioned and not.
    float frameEnv = frameWindow(x, uTaper, on);
    float cellEnv = mix(1.0, clamp(wA + wB, 0.0, 1.0), on);
    float env = frameEnv * cellEnv;

    float y = env * uAmp * (wave + uTurb * turb * aScale);

    // Pointer swell. Measured with the vertical axis divided by the
    // aspect so the reach is a circle on screen rather than an ellipse
    // that changes shape with the frame -- a Reach of 4 covers the same
    // part of the picture in a 1200x300 band as in a 600x600 square.
    vec2 d = vec2(x - uPointer.x, (y - uPointer.y) / max(uAspect, 0.001));
    float infl = exp(-dot(d, d) / max(uReach * uReach, 1e-5)) * uPointerAmt;
    y *= 1.0 + uSwell * infl;

    // Alpha is flat per point -- every value brighter than uColor in the
    // finished frame is stacking, never a ramp. The only shaping is the
    // crest fade, measured against how far out this point could have
    // gone rather than against the frame.
    float reach01 = clamp(abs(y) / max(uAmp * aScale, 1e-4), 0.0, 1.0);
    float a = uOpacity * mix(1.0, CREST_FADE, smoothstep(0.15, 1.0, reach01));
    vAlpha = a * (1.0 + 0.6 * uSwell * infl);

    // How far into a pinch this point is, measured twice -- once for
    // the frame's own ends and once for the joins between sections, so
    // the two can be sized separately.
    //
    // Both are read off their own window rather than off x, so they are
    // the same measure as the thing they describe: a pinch goes white
    // exactly where its window has collapsed the strands onto the axis,
    // and reading the window means Taper drags that region in and out
    // on its own without Width or Whiteness needing a re-tune after it.
    float tipF = smoothstep(TIP_ONSET, 1.0, 1.0 - frameEnv);

    // The outermost section boundaries sit exactly on the frame's
    // margins, so without this both measures would fire there and the
    // end would be sized twice. Fading the join measure out as the
    // frame closes hands those two boundaries to Ends alone, which is
    // what the eye reads them as anyway.
    float tipC = smoothstep(TIP_ONSET, 1.0, 1.0 - cellEnv)
               * on
               * smoothstep(0.0, 0.30, frameEnv);



    // Thickness scales the sprite, which is literally the width of the
    // line the collapsed strands draw. Alpha is divided by the area
    // that scaling costs, so the same light ends up in a narrower mark
    // instead of simply less of it -- otherwise thinning the needle
    // would only dim it, and Thickness would be a second Whiteness. The
    // clamp keeps that division from running away at the extremes.
    // Ends sizes the frame's margins, Sections sizes the joins. Only
    // one of them is ever far from 1 at a given point, because tipC has
    // already been faded out where tipF bites.
    float frameScale = mix(1.0, uTipThick, tipF);
    float secScale = mix(1.0, uSecWidth, tipC);

    // Both are energy-compensated, each over its own range: resizing
    // either mark moves the same light through a different shape
    // instead of making more or less of it. Width is therefore width
    // alone, and Glow below is the only thing that decides how hot a
    // join burns.
    //
    // The two are compensated by different powers, and the difference
    // is the shape of what is being resized rather than a fudge.
    //
    // A frame end is a long needle lying alone against the background,
    // so the light it carries is what the eye measures and the sprite
    // area is what carries it: squared.
    //
    // A join is a short band across a bright mass, and what reads there
    // is how bright the band is, not how much light is in it. Widening
    // it by a factor spreads the same light over that factor more
    // frame, so holding the band's brightness steady needs one power,
    // not two. Squared, a join at Width 50 falls so far out of
    // saturation that it stops resolving to white and shows the base
    // colour instead -- a blue bar with magenta ends, which is the
    // additive stack half-finished rather than any colour anyone chose.
    vAlpha /= clamp(frameScale * frameScale, 0.25, 4.0);
    vAlpha /= clamp(secScale, 0.15, 10.0);
    float sizeScale = frameScale * secScale;

    // Each has its own. Ends > Whiteness burns the frame's two
    // margins, Sections > Glow burns the joins, and neither reaches
    // into the other's half of the picture.
    vAlpha *= mix(1.0, uTipWhite, tipF);
    vAlpha *= mix(1.0, uSecGlow, tipC);

    gl_Position = vec4(x, y, 0.0, 1.0);
    gl_PointSize = uPointSize * sizeScale;
}
`

const POINT_FRAG = `
precision mediump float;

uniform vec3 uColor;
varying float vAlpha;

// The blueprint's point sprite softening, alpha = exp(-d * d * 4.0).
const float FALLOFF = 4.0;

void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    // Shifted and renormalised so the curve reaches exactly zero at the
    // sprite rim. The blueprint's form is still at exp(-1) = 0.37 there,
    // which is invisible on a one-pixel sprite and reads as a hard
    // square the moment Point Size is turned up past two or three.
    float rim = exp(-FALLOFF * 0.25);
    float g = (exp(-d * d * FALLOFF) - rim) / (1.0 - rim);

    float a = g * vAlpha;

    // Premultiplied, so the target can blend ONE, ONE. Same result as
    // the blueprint's gl.blendFunc(gl.SRC_ALPHA, gl.ONE) -- the points
    // are emissive light, nothing occludes anything, and the sum is the
    // whole picture.
    gl_FragColor = vec4(uColor * a, a);
}
`

const QUAD_VERT = `
precision mediump float;
attribute vec2 aPos;
varying vec2 vUv;
void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/** Bright pass with the soft knee UnrealBloomPass uses, so the bloom
 *  fades in over the threshold instead of switching on at it. */
const BRIGHT_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform float uThreshold;
varying vec2 vUv;

const float KNEE = 0.4;

void main() {
    vec3 c = texture2D(uTex, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    float k = uThreshold * KNEE + 1e-5;
    float soft = clamp(l - uThreshold + k, 0.0, 2.0 * k);
    soft = soft * soft / (4.0 * k);
    float w = max(l - uThreshold, soft) / max(l, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
}
`

/** Nine-tap Gaussian folded into five linear samples, run once per axis
 *  per mip level. Three levels of it stacked is what stands in for
 *  UnrealBloomPass's mip chain. */
const BLUR_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;

void main() {
    vec4 sum = texture2D(uTex, vUv) * 0.2270270270;
    sum += (texture2D(uTex, vUv + uStep * 1.3846153846)
          + texture2D(uTex, vUv - uStep * 1.3846153846)) * 0.3162162162;
    sum += (texture2D(uTex, vUv + uStep * 3.2307692308)
          + texture2D(uTex, vUv - uStep * 3.2307692308)) * 0.0702702703;
    gl_FragColor = sum;
}
`

const COMP_FRAG = `
precision mediump float;
uniform sampler2D uScene;
uniform sampler2D uB0;
uniform sampler2D uB1;
uniform sampler2D uB2;
uniform float uStrength;
varying vec2 vUv;

void main() {
    vec3 c = texture2D(uScene, vUv).rgb;
    vec3 b = texture2D(uB0, vUv).rgb * 0.50
           + texture2D(uB1, vUv).rgb * 0.32
           + texture2D(uB2, vUv).rgb * 0.18;

    vec3 o = min(c + b * uStrength, vec3(1.0));

    // Alpha from luminance, so the glow dissolves into whatever the
    // Background is instead of the canvas painting black over it. Keeps
    // the output valid premultiplied: every channel is <= the max.
    float a = max(o.r, max(o.g, o.b));
    gl_FragColor = vec4(o, a);
}
`

/* ---------------------------------------------------------------- gl */

type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

function compile(
    gl: WebGLRenderingContext,
    type: number,
    src: string
): WebGLShader | null {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh)
        return null
    }
    return sh
}

function link(
    gl: WebGLRenderingContext,
    vs: string,
    fs: string
): WebGLProgram | null {
    const v = compile(gl, gl.VERTEX_SHADER, vs)
    const f = compile(gl, gl.FRAGMENT_SHADER, fs)
    if (!v || !f) return null
    const p = gl.createProgram()
    if (!p) return null
    gl.attachShader(p, v)
    gl.attachShader(p, f)
    gl.linkProgram(p)
    gl.deleteShader(v)
    gl.deleteShader(f)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        gl.deleteProgram(p)
        return null
    }
    return p
}

/* ------------------------------------------------------------- props */

export interface AuroraSeamProps {
    /** The ground the seam is lit against. */
    background?: string
    /** How many strands make up the family. */
    strands?: number
    /** Points per strand, as a share of the canvas width. */
    density?: number
    /** Peak displacement, as a share of the frame's half-height. */
    amplitude?: number
    /** The line cut into repeating wave cells; 1 leaves it whole. */
    sections?: Partial<SectionsSettings>
    /** Wavenumber of the fundamental across the half-frame. */
    waves?: number
    /** Weight of the two noise octaves that thread the lobes. */
    turbulence?: number
    /** The tapered ends: how far they run, how wide, how hot. */
    ends?: Partial<EndsSettings>
    /** The one colour every point is drawn in. Everything brighter is overlap. */
    color?: string
    /** Sprite diameter in CSS pixels. */
    pointSize?: number
    /** Per-point alpha, before stacking. */
    opacity?: number
    /** Bright pass and mip-chain blur over the finished points. */
    bloom?: Partial<BloomSettings>
    /** How the seam answers the pointer. */
    pointer?: Partial<PointerSettings>
    /** Rate of the travelling sum. Drives the rAF clock, not a Transition. */
    speed?: number
    style?: CSSProperties
}

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 600
 */
export default function AuroraSeam({
    background = DEFAULTS.background,
    strands = DEFAULTS.strands,
    density = DEFAULTS.density,
    amplitude = DEFAULTS.amplitude,
    sections,
    waves = DEFAULTS.waves,
    turbulence = DEFAULTS.turbulence,
    ends,
    color = "rgb(139, 92, 246)",
    pointSize = DEFAULTS.pointSize,
    opacity = DEFAULTS.opacity,
    bloom,
    pointer,
    speed = DEFAULTS.speed,
    style,
}: AuroraSeamProps) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const [failed, setFailed] = useState(false)

    // Live props for the loop, so dragging a slider re-reads on the very
    // next frame instead of tearing the context down and rebuilding it.
    const propsRef = useRef({
        strands,
        density,
        amplitude,
        sections: {
            defaultValue: {"glow":10,"bleed":10,"count":2,"drift":0,"taper":5.2,"width":5,"variety":10}, ...DEFAULT_SECTIONS, ...sections },
        waves,
        turbulence,
        ends: {
            defaultValue: {"taper":5,"thickness":5,"whiteness":5}, ...DEFAULT_ENDS, ...ends },
        color,
        pointSize,
        opacity,
        bloom: {
            defaultValue: {"radius":0.5,"strength":1.4,"threshold":0.75}, ...DEFAULT_BLOOM, ...bloom },
        pointer: {
            defaultValue: {"reach":10,"enabled":true,"strength":6.3}, ...DEFAULT_POINTER, ...pointer },
        speed,
    })
    propsRef.current = {
        strands,
        density,
        amplitude,
        sections: { ...DEFAULT_SECTIONS, ...sections },
        waves,
        turbulence,
        ends: { ...DEFAULT_ENDS, ...ends },
        color,
        pointSize,
        opacity,
        bloom: { ...DEFAULT_BLOOM, ...bloom },
        pointer: { ...DEFAULT_POINTER, ...pointer },
        speed,
    }

    useEffect(() => {
        const host = hostRef.current
        const canvas = canvasRef.current
        if (!host || !canvas) return

        let gl: WebGLRenderingContext | null = null
        let progPoints: WebGLProgram | null = null
        let progBright: WebGLProgram | null = null
        let progBlur: WebGLProgram | null = null
        let progComp: WebGLProgram | null = null
        let quadBuf: WebGLBuffer | null = null
        let pointBuf: WebGLBuffer | null = null

        let uPoint: Record<string, WebGLUniformLocation | null> = {}
        let uBright: Record<string, WebGLUniformLocation | null> = {}
        let uBlur: Record<string, WebGLUniformLocation | null> = {}
        let uComp: Record<string, WebGLUniformLocation | null> = {}
        let aSeedLoc = -1
        let aPosBright = -1
        let aPosBlur = -1
        let aPosComp = -1

        let scene: Target | null = null
        // Three mip levels, a ping-pong pair each. [0] is the level's result.
        let mips: [Target, Target][] = []

        let builtStrands = 0
        let builtPerStrand = 0
        let pointCount = 0

        let raf = 0
        let lastNow = 0
        let elapsed = 0
        let disposed = false
        let onScreen = true
        let pageVisible = true
        let reduceMotion = false

        // Pointer, in the same clip space the vertex shader works in,
        // eased so entering and leaving the frame is not a jump.
        let ptrX = 0
        let ptrY = 0
        let ptrTargetX = 0
        let ptrTargetY = 0
        let ptrAmt = 0
        let ptrTargetAmt = 0

        /* ------------------------------------------------------ setup */

        function makeTarget(w: number, h: number): Target | null {
            if (!gl) return null
            const tex = gl.createTexture()
            const fb = gl.createFramebuffer()
            if (!tex || !fb) return null
            gl.bindTexture(gl.TEXTURE_2D, tex)
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                w,
                h,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                null
            )
            // LINEAR + CLAMP_TO_EDGE with no mipmaps, which is what makes
            // these non-power-of-two sizes legal in WebGL 1.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
            gl.framebufferTexture2D(
                gl.FRAMEBUFFER,
                gl.COLOR_ATTACHMENT0,
                gl.TEXTURE_2D,
                tex,
                0
            )
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            return { fb, tex, w, h }
        }

        function dropTarget(t: Target | null) {
            if (!gl || !t) return
            gl.deleteFramebuffer(t.fb)
            gl.deleteTexture(t.tex)
        }

        function dropTargets() {
            dropTarget(scene)
            scene = null
            for (const pair of mips) {
                dropTarget(pair[0])
                dropTarget(pair[1])
            }
            mips = []
        }

        function buildTargets(w: number, h: number) {
            dropTargets()
            scene = makeTarget(w, h)
            for (let i = 0; i < 3; i++) {
                const s = 1 << (i + 1)
                const mw = Math.max(1, Math.floor(w / s))
                const mh = Math.max(1, Math.floor(h / s))
                const a = makeTarget(mw, mh)
                const b = makeTarget(mw, mh)
                if (a && b) mips.push([a, b])
            }
        }

        /** Lay out strands x points. X is stratified across [-1, 1] --
         *  one point per equal cell, placed anywhere inside it. Uniform
         *  in the large, which is what makes points spread apart on a
         *  steep segment and resolve as the grain the reference shows
         *  there, but with no shared lattice for the pixel grid to beat
         *  against. A bare lattice, jittered or not, moires into a
         *  visible checker right through the fill. */
        function buildPoints(nStrands: number, perStrand: number) {
            if (!gl || !pointBuf) return
            const total = nStrands * perStrand
            const data = new Float32Array(total * 2)
            const rnd = mulberry32(0x5eed1e)
            let o = 0
            for (let s = 0; s < nStrands; s++) {
                // Strand index over [0, 1) -- open at the top so the last
                // strand is not a duplicate of the first at phi = TAU.
                const n = s / nStrands
                for (let i = 0; i < perStrand; i++) {
                    data[o++] = ((i + rnd()) / perStrand) * 2 - 1
                    data[o++] = n
                }
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf)
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
            builtStrands = nStrands
            builtPerStrand = perStrand
            pointCount = total
        }

        function locs(prog: WebGLProgram, names: string[]) {
            const out: Record<string, WebGLUniformLocation | null> = {}
            for (const n of names) out[n] = gl!.getUniformLocation(prog, n)
            return out
        }

        function init(): boolean {
            const opts: WebGLContextAttributes = {
                alpha: true,
                premultipliedAlpha: true,
                antialias: false,
                depth: false,
                stencil: false,
                preserveDrawingBuffer: false,
                powerPreference: "high-performance",
            }
            gl =
                (canvas!.getContext("webgl", opts) as WebGLRenderingContext) ||
                (canvas!.getContext(
                    "experimental-webgl",
                    opts
                ) as WebGLRenderingContext)
            if (!gl) return false

            progPoints = link(gl, POINT_VERT, POINT_FRAG)
            progBright = link(gl, QUAD_VERT, BRIGHT_FRAG)
            progBlur = link(gl, QUAD_VERT, BLUR_FRAG)
            progComp = link(gl, QUAD_VERT, COMP_FRAG)
            if (!progPoints || !progBright || !progBlur || !progComp)
                return false

            quadBuf = gl.createBuffer()
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
            // One oversized triangle rather than two -- no seam down the
            // diagonal for the blur to sample across.
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([-1, -1, 3, -1, -1, 3]),
                gl.STATIC_DRAW
            )

            pointBuf = gl.createBuffer()

            aSeedLoc = gl.getAttribLocation(progPoints, "aSeed")
            aPosBright = gl.getAttribLocation(progBright, "aPos")
            aPosBlur = gl.getAttribLocation(progBlur, "aPos")
            aPosComp = gl.getAttribLocation(progComp, "aPos")

            uPoint = locs(progPoints, [
                "uTime",
                "uAmp",
                "uWaves",
                "uTaper",
                "uTurb",
                "uPointSize",
                "uOpacity",
                "uAspect",
                "uPointer",
                "uPointerAmt",
                "uReach",
                "uSwell",
                "uTipThick",
                "uTipWhite",
                "uSections",
                "uVariety",
                "uBleed",
                "uSecTaper",
                "uSecWidth",
                "uSecGlow",
                "uSecDrift",
                "uColor",
            ])
            uBright = locs(progBright, ["uTex", "uThreshold"])
            uBlur = locs(progBlur, ["uTex", "uStep"])
            uComp = locs(progComp, ["uScene", "uB0", "uB1", "uB2", "uStrength"])

            gl.disable(gl.DEPTH_TEST)
            gl.disable(gl.CULL_FACE)
            gl.clearColor(0, 0, 0, 0)
            builtStrands = 0
            builtPerStrand = 0
            pointCount = 0
            return true
        }

        /* ----------------------------------------------------- resize */

        function resize() {
            if (!gl) return
            const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
            const w = Math.max(1, Math.round(host!.clientWidth * dpr))
            const h = Math.max(1, Math.round(host!.clientHeight * dpr))
            if (canvas!.width !== w || canvas!.height !== h) {
                canvas!.width = w
                canvas!.height = h
                buildTargets(w, h)
            }
        }

        /** Points per strand follows the frame's CSS width: a strand
         *  wants roughly one point per CSS pixel to read continuous, and
         *  Density scales that. The whole crowd is then thinned, not the
         *  strand count, if the budget would be blown.
         *
         *  CSS width, not the backing store's -- deliberately. Sizing the
         *  crowd off the device width makes the whole picture brighter on
         *  a retina display, because the point count rises with the pixel
         *  ratio while the sprites cover the same share of the frame. Off
         *  the CSS width the crowd is the same crowd everywhere and the
         *  extra pixels only go into drawing it more finely, which is
         *  what they are for. */
        function wantedPerStrand(
            width: number,
            dens: number,
            nStrands: number
        ) {
            const ratio = 0.12 + (clamp(dens, 0, 10) / 10) * 1.25
            let per = Math.round(
                clamp(Math.round(width * ratio), MIN_PER_STRAND, MAX_PER_STRAND)
            )
            if (per * nStrands > MAX_POINTS) {
                per = Math.max(
                    MIN_PER_STRAND,
                    Math.floor(MAX_POINTS / Math.max(nStrands, 1))
                )
            }
            return per
        }

        function drawQuad(attrib: number) {
            if (!gl || attrib < 0) return
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
            gl.enableVertexAttribArray(attrib)
            gl.vertexAttribPointer(attrib, 2, gl.FLOAT, false, 0, 0)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
        }

        function blurInto(src: Target, dst: Target, dx: number, dy: number) {
            if (!gl || !progBlur) return
            gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
            gl.viewport(0, 0, dst.w, dst.h)
            gl.useProgram(progBlur)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, src.tex)
            gl.uniform1i(uBlur.uTex, 0)
            gl.uniform2f(uBlur.uStep, dx / src.w, dy / src.h)
            drawQuad(aPosBlur)
        }

        /* ------------------------------------------------------ frame */

        function draw(dt: number) {
            if (!gl || !progPoints || !scene || mips.length < 3) return
            const p = propsRef.current
            const w = canvas!.width
            const h = canvas!.height
            const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)

            const nStrands = Math.max(2, Math.round(p.strands))
            const per = wantedPerStrand(w / dpr, p.density, nStrands)
            const drift = builtPerStrand
                ? Math.abs(per - builtPerStrand) / builtPerStrand
                : 1
            if (nStrands !== builtStrands || drift > REBUILD_TOLERANCE) {
                buildPoints(nStrands, per)
            }
            if (!pointCount) return

            if (!reduceMotion) elapsed += dt * speedRate(p.speed)

            // Pointer easing, frame-rate independent.
            const ease = 1 - Math.pow(0.001, dt)
            ptrX += (ptrTargetX - ptrX) * ease
            ptrY += (ptrTargetY - ptrY) * ease
            ptrAmt += ((p.pointer.enabled ? ptrTargetAmt : 0) - ptrAmt) * ease

            /* -- 1. the crowd, into the scene target ------------------ */

            gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb)
            gl.viewport(0, 0, w, h)
            gl.clearColor(0, 0, 0, 0)
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.enable(gl.BLEND)
            // Premultiplied additive. The blueprint's SRC_ALPHA, ONE with
            // the multiply already done in the fragment shader.
            gl.blendFunc(gl.ONE, gl.ONE)

            gl.useProgram(progPoints)
            gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf)
            gl.enableVertexAttribArray(aSeedLoc)
            gl.vertexAttribPointer(aSeedLoc, 2, gl.FLOAT, false, 0, 0)

            const c = toRGB(p.color)
            const en = p.ends
            const pt = p.pointer
            const sc = p.sections

            gl.uniform1f(uPoint.uTime, elapsed)
            // Amplitude is a share of the half-height, so the seam keeps
            // its proportion of the frame whatever the frame is. Every
            // scale below is set so its default lands on the value the
            // reference frames were matched at.
            gl.uniform1f(uPoint.uAmp, clamp(p.amplitude, 0, 10) * 0.08)
            gl.uniform1f(uPoint.uWaves, Math.max(0, p.waves))
            gl.uniform1f(uPoint.uSections, Math.max(1, Math.round(sc.count)))
            gl.uniform1f(uPoint.uVariety, clamp(sc.variety, 0, 10) / 10)
            gl.uniform1f(uPoint.uBleed, clamp(sc.bleed, 0, 10) / 10)
            gl.uniform1f(uPoint.uSecTaper, taperExponent(sc.taper))
            gl.uniform1f(uPoint.uSecWidth, joinWidth(sc.width))
            gl.uniform1f(uPoint.uSecGlow, joinGlow(sc.glow))
            // Against the same clock as everything else, so Speed
            // carries the drift along with the waves rather than the
            // two running at unrelated rates.
            gl.uniform1f(uPoint.uSecDrift, clamp(sc.drift, 0, 10) * 0.25)
            gl.uniform1f(uPoint.uTaper, taperExponent(en.taper))
            gl.uniform1f(uPoint.uTipThick, tipThickness(en.thickness))
            gl.uniform1f(uPoint.uTipWhite, tipWhiteness(en.whiteness))
            gl.uniform1f(uPoint.uTurb, clamp(p.turbulence, 0, 10) * 0.017)
            // The reference's point size assumes one device pixel per CSS
            // pixel. Scaled by DPR, or the seam thins out on a retina
            // display exactly where it should be at its most solid.
            gl.uniform1f(uPoint.uPointSize, Math.max(0.5, p.pointSize) * dpr)
            // sqrt, because alpha stacks: raising Strands then adds fibre
            // instead of flooding the whole band to white.
            gl.uniform1f(
                uPoint.uOpacity,
                clamp(p.opacity, 0, 10) *
                    0.045 *
                    Math.sqrt(REF_STRANDS / nStrands)
            )
            gl.uniform1f(uPoint.uAspect, w / Math.max(h, 1))
            gl.uniform2f(uPoint.uPointer, ptrX, ptrY)
            gl.uniform1f(uPoint.uPointerAmt, ptrAmt)
            // Clip space spans 2 across the frame, so the radius the
            // shader gets is twice the share of the width it covers: a
            // Reach of 4 is 0.40 here and reads as a fifth of the frame.
            gl.uniform1f(uPoint.uReach, 0.08 + clamp(pt.reach, 0, 10) * 0.08)
            gl.uniform1f(uPoint.uSwell, clamp(pt.strength, 0, 10) * 0.11)
            gl.uniform3f(uPoint.uColor, c[0], c[1], c[2])

            gl.drawArrays(gl.POINTS, 0, pointCount)

            gl.disable(gl.BLEND)

            /* -- 2. bright pass into the first mip -------------------- */

            const bl = p.bloom
            const m0 = mips[0]
            gl.bindFramebuffer(gl.FRAMEBUFFER, m0[0].fb)
            gl.viewport(0, 0, m0[0].w, m0[0].h)
            gl.useProgram(progBright!)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, scene.tex)
            gl.uniform1i(uBright.uTex, 0)
            gl.uniform1f(uBright.uThreshold, clamp(bl.threshold, 0, 1))
            drawQuad(aPosBright)

            /* -- 3. blur each level, feeding the next ----------------- */

            const r = Math.max(0, bl.radius)
            for (let i = 0; i < 3; i++) {
                const lvl = mips[i]
                // Level 0 blurs its own bright pass; every level below
                // reads the one above, and the smaller viewport plus
                // LINEAR sampling is the halving -- no separate
                // downsample pass is needed.
                const src = i === 0 ? lvl[0] : mips[i - 1][0]
                blurInto(src, lvl[1], r, 0)
                blurInto(lvl[1], lvl[0], 0, r)
            }

            /* -- 4. composite to the canvas -------------------------- */

            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.viewport(0, 0, w, h)
            gl.useProgram(progComp!)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, scene.tex)
            gl.uniform1i(uComp.uScene, 0)
            for (let i = 0; i < 3; i++) {
                gl.activeTexture(gl.TEXTURE1 + i)
                gl.bindTexture(gl.TEXTURE_2D, mips[i][0].tex)
                gl.uniform1i(uComp["uB" + i], 1 + i)
            }
            gl.uniform1f(uComp.uStrength, Math.max(0, bl.strength))
            drawQuad(aPosComp)
        }

        /* ------------------------------------------------------- loop */

        function loop(now: number) {
            if (disposed) return
            raf = requestAnimationFrame(loop)
            if (!onScreen || !pageVisible) {
                lastNow = now
                return
            }
            const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 0
            lastNow = now
            resize()
            draw(dt)
        }

        /* -------------------------------------------------- listeners */

        if (!init()) {
            setFailed(true)
            return
        }

        const ro =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver(() => resize())
                : null
        if (ro) ro.observe(host)

        const io =
            typeof IntersectionObserver !== "undefined"
                ? new IntersectionObserver(
                      (entries) => {
                          onScreen = entries.some((e) => e.isIntersecting)
                      },
                      { rootMargin: "128px" }
                  )
                : null
        if (io) io.observe(host)

        const onVisibility = () => {
            pageVisible = document.visibilityState !== "hidden"
        }
        document.addEventListener("visibilitychange", onVisibility)

        const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
        reduceMotion = mq.matches
        const onMQ = (e: MediaQueryListEvent) => {
            reduceMotion = e.matches
        }
        if (mq.addEventListener) mq.addEventListener("change", onMQ)
        else mq.addListener(onMQ)

        const onPointer = (e: PointerEvent) => {
            const rect = host.getBoundingClientRect()
            if (!rect.width || !rect.height) return
            ptrTargetX = ((e.clientX - rect.left) / rect.width) * 2 - 1
            // Clip space: +y is up, the page's y runs down.
            ptrTargetY = 1 - ((e.clientY - rect.top) / rect.height) * 2
            ptrTargetAmt = 1
        }
        const onLeave = () => {
            ptrTargetAmt = 0
        }
        host.addEventListener("pointermove", onPointer)
        host.addEventListener("pointerleave", onLeave)

        const onLost = (e: Event) => {
            e.preventDefault()
            cancelAnimationFrame(raf)
        }
        const onRestored = () => {
            if (disposed) return
            lastNow = 0
            if (init()) {
                resize()
                raf = requestAnimationFrame(loop)
            } else setFailed(true)
        }
        canvas.addEventListener("webglcontextlost", onLost)
        canvas.addEventListener("webglcontextrestored", onRestored)

        resize()
        raf = requestAnimationFrame(loop)

        return () => {
            disposed = true
            cancelAnimationFrame(raf)
            if (ro) ro.disconnect()
            if (io) io.disconnect()
            document.removeEventListener("visibilitychange", onVisibility)
            if (mq.removeEventListener) mq.removeEventListener("change", onMQ)
            else mq.removeListener(onMQ)
            host.removeEventListener("pointermove", onPointer)
            host.removeEventListener("pointerleave", onLeave)
            canvas.removeEventListener("webglcontextlost", onLost)
            canvas.removeEventListener("webglcontextrestored", onRestored)
            if (gl) {
                dropTargets()
                if (quadBuf) gl.deleteBuffer(quadBuf)
                if (pointBuf) gl.deleteBuffer(pointBuf)
                if (progPoints) gl.deleteProgram(progPoints)
                if (progBright) gl.deleteProgram(progBright)
                if (progBlur) gl.deleteProgram(progBlur)
                if (progComp) gl.deleteProgram(progComp)
                const lose = gl.getExtension("WEBGL_lose_context")
                if (lose) lose.loseContext()
            }
        }
    }, [])

    // Static approximation for the rare no-WebGL case: the seam seen as
    // one soft lens of the same colour.
    const fallbackStyle: CSSProperties = failed
        ? {
              background: `radial-gradient(60% 26% at 50% 50%, ${color} 0%, rgba(0,0,0,0) 70%)`,
              filter: "blur(18px)",
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

/* --------------------------------------------------- property controls */

addPropertyControls(AuroraSeam, {
    // ---------- Background
    background: {
        type: ControlType.Color,
        title: "Background",
        defaultValue: DEFAULTS.background,
    },

    // ---------- Structure
    strands: {
        type: ControlType.Number,
        title: "Strands",
        defaultValue: DEFAULTS.strands,
        min: 20,
        max: 400,
        step: 1,
    },
    density: {
        type: ControlType.Number,
        title: "Density",
        defaultValue: DEFAULTS.density,
        min: 0,
        max: 10,
        step: 0.1,
    },
    amplitude: {
        type: ControlType.Number,
        title: "Amplitude",
        defaultValue: DEFAULTS.amplitude,
        min: 0,
        max: 10,
        step: 0.1,
    },
    sections: {
        type: ControlType.Object,
        title: "Sections",
        defaultValue: DEFAULT_SECTIONS,
        controls: {
            count: {
                type: ControlType.Number,
                title: "Count",
                defaultValue: DEFAULT_SECTIONS.count,
                min: 1,
                max: 12,
                step: 1,
            },
            taper: {
                type: ControlType.Number,
                title: "Taper",
                defaultValue: DEFAULT_SECTIONS.taper,
                min: 0,
                max: 10,
                step: 0.1,
                hidden: (props) => props.count < 2,
            },
            width: {
                type: ControlType.Number,
                title: "Width",
                defaultValue: DEFAULT_SECTIONS.width,
                min: 0,
                max: 50,
                step: 0.1,
                hidden: (props) => props.count < 2,
            },
            glow: {
                type: ControlType.Number,
                title: "Glow",
                defaultValue: DEFAULT_SECTIONS.glow,
                min: 0,
                max: 10,
                step: 0.1,
                hidden: (props) => props.count < 2,
            },
            bleed: {
                type: ControlType.Number,
                title: "Bleed",
                defaultValue: DEFAULT_SECTIONS.bleed,
                min: 0,
                max: 10,
                step: 0.1,
                hidden: (props) => props.count < 2,
            },
            variety: {
                type: ControlType.Number,
                title: "Variety",
                defaultValue: DEFAULT_SECTIONS.variety,
                min: 0,
                max: 10,
                step: 0.1,
                hidden: (props) => props.count < 2,
            },
            drift: {
                type: ControlType.Number,
                title: "Drift",
                defaultValue: DEFAULT_SECTIONS.drift,
                min: 0,
                max: 10,
                step: 0.1,
                hidden: (props) => props.count < 2,
            },
        },
    },

    // Waves and Turbulence sat in a Wave object until the ends earned a
    // group of their own and took Taper with them. Two is not a group --
    // it is two rows -- and both of these are reached for constantly.
    waves: {
        type: ControlType.Number,
        title: "Waves",
        defaultValue: DEFAULTS.waves,
        min: 1,
        max: 14,
        step: 0.1,
    },
    turbulence: {
        type: ControlType.Number,
        title: "Turbulence",
        defaultValue: DEFAULTS.turbulence,
        min: 0,
        max: 10,
        step: 0.1,
    },
    ends: {
        type: ControlType.Object,
        title: "Ends",
        defaultValue: DEFAULT_ENDS,
        controls: {
            taper: {
                type: ControlType.Number,
                title: "Taper",
                defaultValue: DEFAULT_ENDS.taper,
                min: 0,
                max: 10,
                step: 0.1,
            },
            thickness: {
                type: ControlType.Number,
                title: "Thickness",
                defaultValue: DEFAULT_ENDS.thickness,
                min: 0,
                max: 10,
                step: 0.1,
            },
            whiteness: {
                type: ControlType.Number,
                title: "Whiteness",
                defaultValue: DEFAULT_ENDS.whiteness,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },

    // ---------- Element
    color: {
        type: ControlType.Color,
        title: "Color",
        defaultValue: "#203BFF",
    },
    pointSize: {
        type: ControlType.Number,
        title: "Point Size",
        unit: "px",
        defaultValue: DEFAULTS.pointSize,
        min: 0.5,
        max: 8,
        step: 0.1,
        displayStepper: true,
    },
    opacity: {
        type: ControlType.Number,
        title: "Opacity",
        defaultValue: DEFAULTS.opacity,
        min: 0,
        max: 10,
        step: 0.1,
    },
    bloom: {
        type: ControlType.Object,
        title: "Bloom",
        defaultValue: DEFAULT_BLOOM,
        controls: {
            strength: {
                type: ControlType.Number,
                title: "Strength",
                defaultValue: DEFAULT_BLOOM.strength,
                min: 0,
                max: 3,
                step: 0.05,
            },
            radius: {
                type: ControlType.Number,
                title: "Radius",
                defaultValue: DEFAULT_BLOOM.radius,
                min: 0,
                max: 2,
                step: 0.05,
            },
            threshold: {
                type: ControlType.Number,
                title: "Threshold",
                defaultValue: DEFAULT_BLOOM.threshold,
                min: 0,
                max: 1,
                step: 0.01,
            },
        },
    },

    // ---------- Response
    // On / Reach / Strength were three top-level rows. Adding the Ends
    // group put the panel at its 15-row ceiling, and of everything on
    // it these three are the least often reached -- a hover response is
    // set once and left. They are the same three fields either way.
    pointer: {
        type: ControlType.Object,
        title: "Pointer",
        defaultValue: DEFAULT_POINTER,
        controls: {
            enabled: {
                type: ControlType.Boolean,
                title: "On",
                defaultValue: DEFAULT_POINTER.enabled,
                enabledTitle: "Yes",
                disabledTitle: "No",
            },
            reach: {
                type: ControlType.Number,
                title: "Reach",
                defaultValue: DEFAULT_POINTER.reach,
                min: 0,
                max: 10,
                step: 0.1,
                hidden: (props) => !props.enabled,
            },
            strength: {
                type: ControlType.Number,
                title: "Strength",
                defaultValue: DEFAULT_POINTER.strength,
                min: 0,
                max: 10,
                step: 0.1,
                hidden: (props) => !props.enabled,
            },
        },
    },

    // ---------- Travel
    speed: {
        type: ControlType.Number,
        title: "Speed",
        defaultValue: DEFAULTS.speed,
        min: 0,
        max: SPEED_MAX,
        step: 0.1,
    },
})