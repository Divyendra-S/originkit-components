"use client"

import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"

/* ---------------------------------------------------------------------- *
 *  EnergyForm
 *  A suspended structure of electricity -- an octahedral crystal or a
 *  sphere -- that gathers out of magenta dust, floods with orange-white
 *  energy, cools, bends, breaks back into particles and gathers again,
 *  ringed by a wide equatorial band of pink particles.
 *
 *  Built from nine frames of the reference loop (Screen_Recording_
 *  2026-09-10_at_11_52_07_AM_001..009 in ~/Downloads/videotoframes).
 *  Where the brief and the frames disagree the frames win, and each
 *  such place says so in a comment.
 *
 *  WHAT IS ACTUALLY DRAWN
 *    Three additive primitives into one half-float buffer, then bloom:
 *
 *      points    gl.POINTS, tens of thousands, tiny. Every point owns a
 *                home on the structure -- on a path, on a face (or the
 *                shell), inside the volume, on the band, or at a node --
 *                and a loose position a little way off it. Each frame
 *                puts the point somewhere between the two, by how
 *                assembled its neighbourhood is at that moment. Nothing
 *                is emitted or destroyed: dissolution is every point
 *                sliding off its home, assembly is sliding back
 *      ribbons   the structural lines. Each path is a thin screen-
 *                facing strip whose centre line is computed in the
 *                vertex shader -- a chord or a surface arc, bowed by a
 *                few loop-safe sinusoids -- with a bright core and a
 *                soft glow across its width. The points that live on a
 *                path evaluate the same function, so they ride the line
 *                while it bends and scatter off it where it breaks
 *      nodes     one sprite per anchor: a tight white core and a wide
 *                warm halo, brightening when a pulse leaves or arrives
 *
 *    And what is emergent, not drawn:
 *
 *      the colour      one ramp, magenta -> pink -> red -> orange ->
 *                      yellow-white, indexed by a local heat. Everything
 *                      draws in its own heat colour; the whites in the
 *                      frames are stacking and bloom on top of orange,
 *                      never a white element
 *      the surge       frames 001 and 006 are not a brighter version of
 *                      the assembled crystal. The two pyramidal caps are
 *                      blown out and the middle is nearly empty: nodes,
 *                      dust and one arc. The brief describes a whole-
 *                      object flare; the frames show energy entering at
 *                      the poles. So assembly and heat both travel as a
 *                      front from the poles to the equator, the caps
 *                      get an extra dose of heat and a pull of material
 *                      toward the axis while the front is still near the
 *                      poles, and the full orange crystal (002, 007) is
 *                      what that front looks like once it has arrived
 *      the breakup     a two-lobed field drifting over the object offsets
 *                      the assembly locally, so one edge holds while the
 *                      one beside it is already dust (004, 005, 009).
 *                      Lines break along their length the same way; the
 *                      points that lived on them are what remains
 *      the band        an equatorial ring of points in world space, its
 *                      inner rings turning faster, corrugated when dense
 *                      and spread into haze when the object is loose,
 *                      with a lobed vertical wave. The far side is not
 *                      hidden by the object; it is dimmed where it lies
 *                      behind the silhouette and it is farther, so it is
 *                      smaller and fainter. That is enough for it to wrap
 *
 *  ONE CLOCK, ALL INTEGERS
 *    One master loop of three energy cycles. Every moving term is a
 *    sinusoid of the loop phase (or of the cycle phase) with a whole-
 *    number frequency, the object makes a whole number of turns and the
 *    band a whole number of orbits, so the loop is seamless by
 *    construction, and the terms keyed to the loop rather than the
 *    cycle keep any two of the three cycles from matching.
 *
 *  WHAT WAS DELIBERATELY LEFT OUT
 *    No depth test and no sorting -- everything is additive light, and
 *    depth comes from perspective size, distance dimming and the band's
 *    silhouette dimming. No physics and no velocity state -- closed-form
 *    in (home, loop phase), so every control is live and the static
 *    canvas frame is exact. No noise texture. No camera orbit -- the
 *    camera holds a little above the equator and the object turns. No
 *    floor: the frames have a dark rock under the object and the brief
 *    says leave it out. No pointer interaction.
 *
 *  Raw WebGL (2 where available, else 1), no dependencies. Bloom is a
 *  five-level blurred mip chain composited over the background.
 * ---------------------------------------------------------------------- */

/* ------------------------------------------------------------ constants */

/** Never oversample the backing store past this. */
const DPR_CAP = 2

/** Point budget for one frame, every population together. */
const MAX_POINTS = 200000
const MIN_POINTS = 4000

/** Particle count and point diameter the alpha scale is calibrated
 *  against, so more or bigger points add grain, not white. */
const REF_COUNT = 60000
const REF_POINT = 2.2

/** Frame dimension the point and line sizes are expressed against. */
const REF_DIM = 900

/** Camera distance in object radii, its vertical field of view, and how
 *  far above the equator it sits. The frames look slightly down on the
 *  object: the near vertex of the equatorial square projects below the
 *  centre and the band reads as an ellipse. */
const CAM = 8
const FOV = 20
const CAM_PITCH = 11

/** The seamless loop is this many energy cycles long. */
const CYCLES = 3

/** Samples per structural line, and bloom mip levels. */
const RIBBON_SEGS = 56
const BLOOM_LEVELS = 5

/** Where the detached pole dots sit on the vertical axis (radius 1 is
 *  the top vertex). */
const POLE_DOT = 1.17

/** Emission lives per loop for the points that leave the nodes. */
const LIVES = 15

/* -------------------------------------------------------------- defaults */

export interface EnergySettings {
    /** How hot the peak runs: orange at 5, yellow-white at 10. */
    heat: number
    /** How far the shape comes apart at the bottom of the cycle. */
    dissolve: number
    /** How fast energy travels along the lines. */
    flow: number
    /** How hard the poles blow out before the flood. */
    surge: number
}

/** The energy cycle, one dial per stage. Neutral is 5 throughout.
 *  Heat is the ceiling of the ramp: 0 never leaves red, 10 goes past
 *  white and the edges vanish into bloom at the peak, as in frame 007.
 *  Dissolve is the floor: 0 keeps the shape whole and only cools it,
 *  10 leaves nothing but the nodes and the band. Flow counts how many
 *  pulses cross a line per cycle. Surge is the polar blow-out of frames
 *  001 and 006; 0 removes it and the flood simply arrives. */
const DEFAULT_ENERGY: EnergySettings = { heat: 5, dissolve: 5, flow: 5, surge: 5 }

export interface LineSettings {
    /** Width of the structural lines. */
    thickness: number
    /** How far lines bow and wobble when the shape loosens. */
    bend: number
    /** Brightness of the internal lines against the outer edges. */
    inner: number
}

/** The lines. Bend is the flexibility: outer edges take about a third
 *  of it and internal lines all of it, and both are stiff while the
 *  shape is assembled and loose while it dissolves, so 0 is a rigid
 *  wireframe at every stage. */
const DEFAULT_LINES: LineSettings = { thickness: 5, bend: 5, inner: 5 }

export interface BandSettings {
    /** Density of the equatorial band. 0 removes it. */
    amount: number
    /** Radius of the band around the object. */
    radius: number
    /** How much the band rises and falls around its orbit. */
    wave: number
    /** How fast the band circulates. */
    speed: number
}

/** The orbiting particle band. Speed is whole orbits per loop, so the
 *  loop stays seamless at every setting. */
const DEFAULT_BAND: BandSettings = { amount: 5, radius: 5, wave: 5, speed: 5 }

export interface GlowSettings {
    /** Bloom on the bright cores. */
    bloom: number
    /** The deep red haze around the object, breathing with its heat. */
    atmosphere: number
    /** Size of the anchor node cores and halos. */
    nodes: number
}

/** Bloom is what turns stacked orange into white; atmosphere is the
 *  only thing in the frame that is not the object. */
const DEFAULT_GLOW: GlowSettings = { bloom: 5, atmosphere: 4, nodes: 5 }

const DEFAULTS = {
    shape: "diamond",
    background: "#050206",
    size: 66,
    particles: 60000,
    pointSize: 2.2,
    speed: 5,
    cycleSeconds: 22,
    rotation: 5,
    phase: 0.42,
    hue: 0,
    seed: 7,
    maxPixelRatio: 1.5,
    poleDots: true,
}

/* --------------------------------------------------------------- helpers */

function mulberry32(seed: number) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function clamp(v: number, lo: number, hi: number) {
    return Math.min(hi, Math.max(lo, v))
}

/** Defensive numeric read: a host that sends "" or undefined gets the
 *  fallback rather than a coerced zero. */
function num(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value)
    return Number.isFinite(n) ? n : fallback
}

function sstep(a: number, b: number, x: number) {
    const t = clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
}

/** CSS colour to [r, g, b] in 0-1 sRGB. Hex, rgb(a) and hsl(a); anything
 *  else falls back to near-black. */
function toRGB(css: unknown): [number, number, number] {
    const s = typeof css === "string" ? css.trim() : ""
    const hex = /^#([0-9a-f]{3,8})$/i.exec(s)
    if (hex) {
        let h = hex[1]
        if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("")
        if (h.length >= 6) {
            return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
        }
    }
    const fn = /^(rgba?|hsla?)\(([^)]+)\)$/i.exec(s)
    if (fn) {
        const parts = fn[2].split(/[\s,\/]+/).filter(Boolean).map((p) => parseFloat(p))
        if (parts.length >= 3 && parts.slice(0, 3).every((v) => Number.isFinite(v))) {
            if (fn[1].toLowerCase().startsWith("rgb")) {
                return [clamp(parts[0] / 255, 0, 1), clamp(parts[1] / 255, 0, 1), clamp(parts[2] / 255, 0, 1)]
            }
            const h = (((parts[0] % 360) + 360) % 360) / 360
            const sat = clamp(parts[1] / 100, 0, 1)
            const l = clamp(parts[2] / 100, 0, 1)
            const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat
            const p = 2 * l - q
            const ch = (t: number) => {
                t = ((t % 1) + 1) % 1
                if (t < 1 / 6) return p + (q - p) * 6 * t
                if (t < 1 / 2) return q
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
                return p
            }
            return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)]
        }
    }
    return [0.02, 0.008, 0.024]
}

/* Response curves: panel dials are 0-10, neutral at 5, and these spread
 * the useful range across the slider. */

function speedRate(s: number) {
    return s <= 0 ? 0 : Math.pow(s / 5, 1.4)
}

/** Whole turns per loop, so any setting loops seamlessly; the wobble
 *  amplitude in radians rides on the same dial so 0 is perfectly still. */
function turnsPerLoop(r: number) {
    return Math.round(clamp(r, 0, 10) / 5)
}
function wobbleAmp(r: number) {
    return 0.06 + 0.05 * (clamp(r, 0, 10) / 5)
}

/** Ceiling of the heat ramp at the peak. 1.0 is orange going white. */
function heatMax(h: number) {
    return 0.45 + 0.09 * clamp(h, 0, 10)
}

/** Floor of the assembly at the bottom of the cycle. Below 0 nothing
 *  is left but what the lobe field lifts back up. */
function assemblyFloor(d: number) {
    d = clamp(d, 0, 10)
    return d <= 5 ? 0.9 - 0.128 * d : 0.26 - 0.082 * (d - 5)
}

/** How far a loose point drifts from its home, in object radii. */
function scatterReach(d: number) {
    return 0.15 + 0.05 * clamp(d, 0, 10)
}

/** Pulses per cycle along each line, whole so the loop stays seamless. */
function pulsesPerCycle(f: number) {
    return Math.max(1, Math.round(clamp(f, 0, 10) * 0.6))
}

/** How many times a line's own points travel its length per loop. */
function flowTraversals(f: number) {
    return Math.max(1, Math.round(2 + clamp(f, 0, 10) * 1.2))
}

function surgeAmp(s: number) {
    return clamp(s, 0, 10) / 5
}

/** Half width of a line in CSS px at a 900px frame; the fragment
 *  shader keeps a core about a sixth of that wide. */
function lineHalfWidth(t: number) {
    return 3 + 0.9 * clamp(t, 0, 10)
}

function bendAmp(b: number) {
    return 0.075 * clamp(b, 0, 10)
}

function innerMix(i: number) {
    return clamp(i, 0, 10) / 5
}

function bandAmount(a: number) {
    return clamp(a, 0, 10) / 5
}
function bandRadius(r: number) {
    return 0.7 + 0.06 * clamp(r, 0, 10)
}
function bandWave(w: number) {
    return clamp(w, 0, 10) / 5
}
function bandOrbits(s: number) {
    return Math.max(0, Math.round(1 + clamp(s, 0, 10) * 0.6))
}

function bloomStrength(b: number) {
    return 0.18 * clamp(b, 0, 10)
}
function atmosStrength(a: number) {
    return 0.06 * clamp(a, 0, 10)
}
function nodeScale(n: number) {
    return 0.3 + 0.14 * clamp(n, 0, 10)
}

/** The per-frame scalars of the energy cycle, from the cycle phase.
 *  Read against the frames: the front (assembly and heat together)
 *  leaves the poles at 0.10 and reaches the equator by 0.36; the surge
 *  peaks at 0.19 while the front is still in the caps; heat holds to
 *  0.44 and is gone by 0.74; the shape loosens from 0.50 and is at its
 *  floor by 0.88, where it stays until the next front. */
function cycleState(phi: number, e: EnergySettings) {
    const p = ((phi % 1) + 1) % 1
    const hm = heatMax(num(e.heat, DEFAULT_ENERGY.heat))
    const sa = surgeAmp(num(e.surge, DEFAULT_ENERGY.surge))
    const d = (p - 0.2) / 0.055
    return {
        amin: assemblyFloor(num(e.dissolve, DEFAULT_ENERGY.dissolve)),
        down: sstep(0.5, 0.88, p),
        front: -0.35 + 1.85 * sstep(0.06, 0.34, p),
        ebase: 0.16,
        eflood: hm * (sstep(0.1, 0.3, p) - sstep(0.44, 0.74, p)),
        surge: sa * Math.exp(-d * d),
        pulse: 0.35 + 0.65 * (sstep(0.08, 0.24, p) - sstep(0.6, 0.9, p)),
        bandAct: 0.3 + 0.7 * (sstep(0.14, 0.34, p) - sstep(0.56, 0.86, p)),
        heatNow: 0.16 + hm * (sstep(0.1, 0.3, p) - sstep(0.44, 0.74, p)) * 0.8 + 0.3 * sa * Math.exp(-d * d),
    }
}

/* 3x3 matrices, column-major, for the object rotation, the camera pitch
 * and the band's tilt. */
type Mat3 = Float32Array

function rotX(a: number): Mat3 {
    const c = Math.cos(a), s = Math.sin(a)
    return new Float32Array([1, 0, 0, 0, c, s, 0, -s, c])
}
function rotY(a: number): Mat3 {
    const c = Math.cos(a), s = Math.sin(a)
    return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c])
}
function rotZ(a: number): Mat3 {
    const c = Math.cos(a), s = Math.sin(a)
    return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1])
}
function mul3(a: Mat3, b: Mat3): Mat3 {
    const o = new Float32Array(9)
    for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
            o[col * 3 + row] = a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2]
        }
    }
    return o
}

/* -------------------------------------------------------------- geometry */

interface NodeSpec {
    p: [number, number, number]
    /** 0 pole, 1 equatorial vertex or surface anchor, 2 interior junction,
     *  3 detached pole dot. */
    kind: number
    /** Graph distance from the poles; pulses leave later the deeper a
     *  path starts, so energy is seen to propagate. */
    depth: number
    /** Pulse phase offsets of the paths that touch this node. A node
     *  flares when a pulse leaves or arrives. */
    phases: number[]
}

interface PathSpec {
    a: number
    b: number
    /** 0 outer edge, 1 internal line. */
    order: number
    /** 0 straight chord, 1 arc on the sphere surface, 2 bowed chord. */
    curve: number
    seeds: [number, number, number, number]
    phase: number
    length: number
}

interface Structure {
    nodes: NodeSpec[]
    paths: PathSpec[]
    sphere: boolean
}

function dist3(a: number[], b: number[]) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function unitDir(rng: () => number): [number, number, number] {
    const z = rng() * 2 - 1
    const t = rng() * Math.PI * 2
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    return [r * Math.cos(t), z, r * Math.sin(t)]
}

/** Paths are oriented from the shallower node, so a pulse runs away
 *  from the poles; its phase offset staggers by depth with a little
 *  jitter, so the chain reads as propagation without ever locking. */
function addPath(st: Structure, rng: () => number, a: number, b: number, order: number, curve: number) {
    if (st.nodes[a].depth > st.nodes[b].depth) {
        const t = a
        a = b
        b = t
    }
    for (const q of st.paths) if ((q.a === a && q.b === b) || (q.a === b && q.b === a)) return
    const phase = (0.17 * st.nodes[a].depth + 0.14 * rng() + (order ? 0.06 : 0)) % 1
    st.paths.push({
        a,
        b,
        order,
        curve,
        seeds: [rng(), rng(), rng(), rng()],
        phase,
        length: dist3(st.nodes[a].p, st.nodes[b].p),
    })
    st.nodes[a].phases.push(phase)
    st.nodes[b].phases.push(phase)
}

function nearest(st: Structure, from: number, pool: number[], count: number) {
    return pool
        .filter((i) => i !== from)
        .sort((i, j) => dist3(st.nodes[from].p, st.nodes[i].p) - dist3(st.nodes[from].p, st.nodes[j].p))
        .slice(0, count)
}

/** The octahedron: poles at y = +-1, an equatorial square, the centre,
 *  and a few seeded junctions inside the volume. Twelve outer edges,
 *  six half-axes through the centre (the cross of frame 007), and two
 *  chords from each junction to its nearest anchors. */
function buildDiamond(rng: () => number): Structure {
    const st: Structure = { nodes: [], paths: [], sphere: false }
    const N = (p: [number, number, number], kind: number, depth: number) => st.nodes.push({ p, kind, depth, phases: [] })
    N([0, 1, 0], 0, 0)
    N([0, -1, 0], 0, 0)
    N([1, 0, 0], 1, 1)
    N([0, 0, 1], 1, 1)
    N([-1, 0, 0], 1, 1)
    N([0, 0, -1], 1, 1)
    N([0, 0, 0], 2, 1)
    for (let i = 0; i < 4; i++) {
        let p: [number, number, number] = [0.3, 0.2, 0.2]
        for (let tries = 0; tries < 60; tries++) {
            const q: [number, number, number] = [(rng() * 2 - 1) * 0.7, (rng() * 2 - 1) * 0.7, (rng() * 2 - 1) * 0.7]
            const l1 = Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2])
            if (l1 > 0.32 && l1 < 0.74) {
                p = q
                break
            }
        }
        N(p, 2, 2)
    }
    for (const pole of [0, 1]) for (const eq of [2, 3, 4, 5]) addPath(st, rng, pole, eq, 0, 0)
    addPath(st, rng, 2, 3, 0, 0)
    addPath(st, rng, 3, 4, 0, 0)
    addPath(st, rng, 4, 5, 0, 0)
    addPath(st, rng, 5, 2, 0, 0)
    for (const v of [0, 1, 2, 3, 4, 5]) addPath(st, rng, v, 6, 1, 0)
    const anchors = [2, 3, 4, 5, 6]
    for (let i = 7; i < st.nodes.length; i++) {
        const pool = anchors.concat(Array.from({ length: i - 7 }, (_, k) => 7 + k))
        for (const j of nearest(st, i, pool, 2)) addPath(st, rng, j, i, 1, 0)
    }
    return st
}

/** The sphere: two near-polar anchors, eight surface anchors on a
 *  jittered Fibonacci lattice, three junctions inside. Surface arcs join
 *  each anchor to its two nearest, the poles to their three nearest,
 *  and three long arcs cross between far anchors so the cage has
 *  partial latitudes and longitudes without ever being a grid. Interior
 *  strands are bowed chords. */
function buildSphere(rng: () => number): Structure {
    const st: Structure = { nodes: [], paths: [], sphere: true }
    const N = (p: [number, number, number], kind: number, depth: number) => st.nodes.push({ p, kind, depth, phases: [] })
    const norm = (v: number[]): [number, number, number] => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1
        return [v[0] / l, v[1] / l, v[2] / l]
    }
    N(norm([0.06, 1, -0.05]), 0, 0)
    N(norm([-0.05, -1, 0.07]), 0, 0)
    const golden = Math.PI * (3 - Math.sqrt(5))
    const count = 8
    for (let i = 0; i < count; i++) {
        let y = 1 - ((i + 0.5) / count) * 2
        y *= 0.78
        const r = Math.sqrt(Math.max(0, 1 - y * y))
        const t = golden * i + (rng() - 0.5) * 0.9
        const p = norm([r * Math.cos(t) + (rng() - 0.5) * 0.25, y + (rng() - 0.5) * 0.25, r * Math.sin(t) + (rng() - 0.5) * 0.25])
        N(p, 1, 1)
    }
    for (let i = 0; i < 3; i++) {
        const d = unitDir(rng)
        const r = 0.3 + 0.3 * rng()
        N([d[0] * r, d[1] * r, d[2] * r], 2, 2)
    }
    const surface = [2, 3, 4, 5, 6, 7, 8, 9]
    const interior = [10, 11, 12]
    for (const i of surface) for (const j of nearest(st, i, surface, 2)) addPath(st, rng, i, j, 0, 1)
    for (const pole of [0, 1]) for (const j of nearest(st, pole, surface, 3)) addPath(st, rng, pole, j, 0, 1)
    let long = 0
    for (let tries = 0; tries < 200 && long < 3; tries++) {
        const i = surface[Math.floor(rng() * surface.length)]
        const j = surface[Math.floor(rng() * surface.length)]
        if (i === j) continue
        const a = st.nodes[i].p, b = st.nodes[j].p
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
        if (dot < -0.55 || dot > 0.2) continue
        const before = st.paths.length
        addPath(st, rng, i, j, 0, 1)
        if (st.paths.length > before) long++
    }
    for (const i of interior) {
        for (const j of nearest(st, i, surface, 2)) addPath(st, rng, j, i, 1, 2)
        for (const j of nearest(st, i, interior, 1)) addPath(st, rng, j, i, 1, 2)
    }
    for (const pole of [0, 1]) for (const j of nearest(st, pole, interior, 1)) addPath(st, rng, pole, j, 1, 2)
    return st
}

/** Floats per point: aA, aB, aMeta, aR1, aR2, aR3. */
const P_STRIDE = 24
/** Floats per ribbon vertex: aA, aB, aMeta, aR1. */
const L_STRIDE = 16
/** Floats per node: aA, aMeta, aR1. */
const N_STRIDE = 12

/** Every point's home, by population: 0 on a path, 1 on a face or the
 *  shell, 2 in the volume, 3 on the band, 4 leaving a node. Volume
 *  homes are pulled inward so the dust thickens toward the centre. */
function buildParticles(rng: () => number, count: number, st: Structure, poleDots: boolean) {
    const data = new Float32Array(count * P_STRIDE)
    const nPath = Math.round(count * 0.24)
    const nFace = Math.round(count * 0.24)
    const nVol = Math.round(count * 0.24)
    const nBand = Math.round(count * 0.24)
    const weights = st.paths.map((p) => p.length * (p.order ? 0.6 : 1))
    const total = weights.reduce((a, b) => a + b, 0) || 1
    const emitters = st.nodes.map((_, i) => i).filter((i) => st.nodes[i].kind < 3 || poleDots)
    for (let i = 0; i < count; i++) {
        const o = i * P_STRIDE
        const type = i < nPath ? 0 : i < nPath + nFace ? 1 : i < nPath + nFace + nVol ? 2 : i < nPath + nFace + nVol + nBand ? 3 : 4
        let order = 0
        let curve = 0
        let phase = 0
        let a: number[] = [0, 0, 0, 0]
        let b: number[] = [0, 0, 0, 0]
        let r1: number[] = [rng(), rng(), rng(), rng()]
        if (type === 0) {
            let pick = rng() * total
            let j = 0
            while (j < weights.length - 1 && pick > weights[j]) {
                pick -= weights[j]
                j++
            }
            const path = st.paths[j]
            order = path.order
            curve = path.curve
            phase = path.phase
            a = [...st.nodes[path.a].p, rng()]
            b = [...st.nodes[path.b].p, curve]
            r1 = path.seeds.slice()
        } else if (type === 1) {
            if (st.sphere) {
                const d = unitDir(rng)
                const r = 0.97 + 0.05 * rng()
                a = [d[0] * r, d[1] * r, d[2] * r, 0]
            } else {
                const sx = rng() < 0.5 ? -1 : 1
                const sy = rng() < 0.5 ? -1 : 1
                const sz = rng() < 0.5 ? -1 : 1
                let u = rng(), v = rng()
                if (u + v > 1) {
                    u = 1 - u
                    v = 1 - v
                }
                a = [sx * u, sy * v, sz * (1 - u - v), 0]
            }
        } else if (type === 2) {
            const inward = 0.45 + 0.55 * rng()
            if (st.sphere) {
                const d = unitDir(rng)
                const r = 0.96 * Math.cbrt(rng()) * inward
                a = [d[0] * r, d[1] * r, d[2] * r, 0]
            } else {
                let q = [0, 0, 0]
                for (let tries = 0; tries < 40; tries++) {
                    q = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]
                    if (Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]) <= 1) break
                }
                a = [q[0] * inward, q[1] * inward, q[2] * inward, 0]
            }
        } else if (type === 3) {
            const r0 = 0.5 * (rng() + rng())
            const y0 = (rng() + rng() + rng()) / 1.5 - 1
            a = [rng() * Math.PI * 2, r0, y0, 0]
        } else {
            const n = st.nodes[emitters[Math.floor(rng() * emitters.length)]]
            a = [n.p[0], n.p[1], n.p[2], 0]
        }
        const dir = unitDir(rng)
        data.set(a, o)
        data.set(b, o + 4)
        data.set([type, order, rng(), phase], o + 8)
        data.set(r1, o + 12)
        data.set([dir[0], dir[1], dir[2], rng()], o + 16)
        data.set([rng(), rng(), rng(), rng()], o + 20)
    }
    return data
}

function buildRibbons(st: Structure) {
    const perPath = (RIBBON_SEGS + 1) * 2
    const verts = new Float32Array(st.paths.length * perPath * L_STRIDE)
    const index = new Uint16Array(st.paths.length * RIBBON_SEGS * 6)
    let vi = 0
    let ii = 0
    for (let k = 0; k < st.paths.length; k++) {
        const path = st.paths[k]
        const A = st.nodes[path.a].p
        const B = st.nodes[path.b].p
        const base = vi
        for (let i = 0; i <= RIBBON_SEGS; i++) {
            const s = i / RIBBON_SEGS
            for (const side of [-1, 1]) {
                const o = vi * L_STRIDE
                verts.set([A[0], A[1], A[2], s], o)
                verts.set([B[0], B[1], B[2], path.curve], o + 4)
                verts.set([side, path.order, path.seeds[0], path.phase], o + 8)
                verts.set(path.seeds, o + 12)
                vi++
            }
        }
        for (let i = 0; i < RIBBON_SEGS; i++) {
            const v0 = base + i * 2
            index.set([v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2], ii)
            ii += 6
        }
    }
    return { verts, index }
}

function buildNodes(rng: () => number, st: Structure, poleDots: boolean) {
    const list = st.nodes.slice()
    if (poleDots) {
        list.push({ p: [0, POLE_DOT, 0], kind: 3, depth: 0, phases: [] })
        list.push({ p: [0, -POLE_DOT, 0], kind: 3, depth: 0, phases: [] })
    }
    const data = new Float32Array(list.length * N_STRIDE)
    list.forEach((n, i) => {
        const o = i * N_STRIDE
        const ph = [0, 1, 2, 3].map((k) => (k < n.phases.length ? n.phases[k] : -1))
        const sizeMul = n.kind === 0 ? 1.15 : n.kind === 1 ? 1.0 : n.kind === 2 ? 0.7 : 0.85
        data.set([n.p[0], n.p[1], n.p[2], n.kind], o)
        data.set([rng(), ph[0], ph[1], ph[2]], o + 4)
        data.set([ph[3], sizeMul, 0, 0], o + 8)
    })
    return { data, count: list.length }
}

/* ------------------------------------------------------------------ glsl */

/** Shared by the three vertex shaders: the cycle fields, the heat ramp,
 *  the path function and the projection. */
const COMMON = `
precision highp float;
#define TAU 6.283185307179586
#define PI 3.141592653589793
#define CYCLES_F ${CYCLES}.0
#define SEGS_F ${RIBBON_SEGS}.0
uniform float uTau;
uniform float uAmin;
uniform float uDown;
uniform float uFront;
uniform float uEbase;
uniform float uEflood;
uniform float uS;
uniform float uPulse;
uniform float uPulseK;
uniform float uBend;
uniform mat3 uRot;
uniform mat3 uView;
uniform float uScale;
uniform float uCam;
uniform float uFocal;
uniform float uAspect;
uniform vec2 uRes;
uniform float uBob;
uniform float uShape;
uniform float uHueC;
uniform float uHueS;
uniform float uPre;

float cyc() { return CYCLES_F * uTau; }

// Two slow lobes drifting over the object. One term rides the loop and
// one the cycle, so no two cycles break up the same way.
float lobes(vec3 p, float k) {
    return 0.5 * sin(2.1 * p.x + 1.3 * p.y - 0.7 * p.z + TAU * 2.0 * uTau + k)
         + 0.5 * sin(1.6 * p.z - 2.4 * p.y + 0.9 * p.x - TAU * cyc() + 2.4 + 1.7 * k);
}

float capAt(vec3 p) { return smoothstep(0.4, 0.85, abs(p.y)); }

// 1 where the front from the poles has passed, 0 where it has not.
float floodAt(vec3 p) {
    float d = 1.0 - abs(p.y);
    return 1.0 - smoothstep(uFront - 0.4, uFront + 0.05, d);
}

// How assembled the structure is here, 0..1. The poles hold longest:
// frame 005 keeps the top vertex and its edges when little else is left.
float assembleAt(vec3 p, float seed) {
    float a = uAmin + (1.05 - uAmin) * clamp(floodAt(p) - uDown, 0.0, 1.0);
    return smoothstep(0.0, 1.0, a + 0.4 * lobes(p, 0.0) + 0.14 * (seed - 0.5) + 0.25 * capAt(p));
}

// Local heat: the cool floor, the flood behind the front, the surge in
// the caps.
float heatAt(vec3 p, float seed) {
    return uEbase + uEflood * floodAt(p) * (0.82 + 0.25 * lobes(p, 1.3)) + uS * capAt(p);
}

// A pulse travelling A -> B: a bright head and a fading tail behind it.
float pulseAt(float s, float ph) {
    float p = fract(cyc() * uPulseK + ph);
    float d = s - p;
    float head = exp(-d * d * 120.0);
    float tail = exp(-d * d * 12.0) * (1.0 - step(0.0, d)) * 0.35;
    return head + tail;
}

// magenta -> pink -> red -> orange -> yellow-white, stops in sRGB terms
// squared to linear.
vec3 rampLin(float e) {
    e = clamp(e, 0.0, 1.25);
    vec3 c0 = vec3(0.30, 0.02, 0.20);
    vec3 c1 = vec3(0.95, 0.10, 0.55);
    vec3 c2 = vec3(1.00, 0.22, 0.30);
    vec3 c3 = vec3(1.00, 0.42, 0.12);
    vec3 c4 = vec3(1.00, 0.68, 0.22);
    vec3 c5 = vec3(1.00, 0.95, 0.70);
    vec3 c = mix(c0, c1, smoothstep(0.0, 0.25, e));
    c = mix(c, c2, smoothstep(0.25, 0.48, e));
    c = mix(c, c3, smoothstep(0.48, 0.68, e));
    c = mix(c, c4, smoothstep(0.68, 0.88, e));
    c = mix(c, c5, smoothstep(0.88, 1.10, e));
    return c * c;
}

float glowOf(float e) { return 0.25 + 2.2 * e * e; }

vec3 hueShift(vec3 c) {
    const vec3 k = vec3(0.57735027);
    return c * uHueC + cross(k, c) * uHueS + k * dot(k, c) * (1.0 - uHueC);
}

vec3 pathBase(vec3 A, vec3 B, float s, float curve) {
    vec3 p = mix(A, B, s);
    if (curve > 0.5 && curve < 1.5) p = normalize(p) * mix(length(A), length(B), s);
    return p;
}

// Stiff while assembled, loose while dissolving; outer edges take a
// third of what internal lines take.
float bendAmpOf(float built, float order) {
    return uBend * (0.08 + 0.7 * (1.0 - built)) * (order > 0.5 ? 1.0 : 0.2);
}

vec3 pathPos(vec3 A, vec3 B, float s, float curve, vec4 r, float amp) {
    vec3 p = pathBase(A, B, s, curve);
    vec3 d = B - A;
    vec3 n1 = cross(d, vec3(0.31 + r.x, 0.95 - 0.5 * r.y, 0.12 + r.z));
    if (dot(n1, n1) < 1e-6) n1 = cross(d, vec3(1.0, 0.0, 0.0));
    n1 = normalize(n1);
    vec3 n2 = normalize(cross(d, n1));
    // A short chord bends less, so junction links never loop on themselves.
    amp *= min(1.0, length(d) / 0.9);
    float c = cyc();
    float w = sin(PI * s);
    float b1 = sin(TAU * (s * (0.8 + r.x) + c) + r.y * TAU);
    float b2 = sin(TAU * (s * (1.4 + r.z) - c) + r.w * TAU);
    float b3 = 0.4 * sin(TAU * (s * 2.3 + 2.0 * uTau) + r.x * TAU);
    if (curve > 1.5) p += n1 * (0.15 + 0.35 * r.w) * w;
    return p + (n1 * (b1 + b3) + n2 * b2) * w * amp;
}

vec3 toView(vec3 world) { return uView * world; }

vec2 ndcOf(vec3 v, float depth) {
    return vec2(v.x * uFocal / (depth * uAspect), v.y * uFocal / depth);
}
`

const POINT_VERT =
    COMMON +
    `
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aMeta;
attribute vec4 aR1;
attribute vec4 aR2;
attribute vec4 aR3;
uniform float uPx;
uniform float uAlpha;
uniform float uFlow;
uniform float uReach;
uniform float uBandR;
uniform float uBandWave;
uniform float uBandTurns;
uniform float uBandAmt;
uniform float uBandAct;
uniform mat3 uBandRot;
uniform float uLives;
uniform float uMaxPt;
varying vec3 vCol;

void main() {
    float type = aMeta.x;
    float order = aMeta.y;
    float seed = aMeta.z;
    float ph = aMeta.w;
    float c = cyc();
    float e = 0.0;
    float alpha = 1.0;
    float isBand = 0.0;
    vec3 world;
    if (type < 2.5) {
        vec3 home = aA.xyz;
        float g = 1.0;
        float onPath = 0.0;
        float s = 0.0;
        if (type < 0.5) {
            onPath = 1.0;
            float n = uFlow + floor(aR2.w * 3.0);
            s = fract(aA.w + n * uTau * (order > 0.5 ? -1.0 : 1.0));
            vec3 mid = pathBase(aA.xyz, aB.xyz, 0.5, aB.w);
            float amp = bendAmpOf(assembleAt(mid, seed), order);
            home = pathPos(aA.xyz, aB.xyz, s, aB.w, aR1, amp) + aR2.xyz * 0.025 * aR3.x;
            alpha = 1.15;
        } else {
            home += 0.05 * vec3(sin(TAU * (2.0 * uTau + aR3.x)), sin(TAU * (aR3.y - uTau)), cos(TAU * (uTau + aR3.z)));
        }
        g = assembleAt(home, seed);
        // The surge of frames 001 and 006: while the front is still in
        // the caps, dust from the middle is drawn up into them, keeping
        // its place in the cross-section, and what stays behind thins.
        float ay = abs(home.y);
        float pull = uS * smoothstep(0.15, 0.4, ay) * (1.0 - onPath);
        float ny = 0.6 + 0.4 * ay;
        float sq = uShape < 0.5
            ? (1.0 - ny) / max(1.0 - ay, 0.05)
            : sqrt(max(1.0 - ny * ny, 0.0)) / max(sqrt(max(1.0 - ay * ay, 0.0)), 0.05);
        vec3 capHome = vec3(home.x * sq, sign(home.y) * ny, home.z * sq);
        home = mix(home, capHome, pull);
        g = max(g, pull);
        g *= 1.0 - 0.8 * uS * (1.0 - smoothstep(0.05, 0.3, ay)) * (1.0 - onPath);
        // Dust runs cooler than the lines through it, so at the peak the
        // interior is orange grain under yellow-white edges (002, 007).
        e = onPath > 0.5 ? heatAt(home, seed) + 0.5 * uPulse * pulseAt(s, ph) : 0.85 * heatAt(home, seed);
        vec3 outward = normalize(home + 0.6 * aR2.xyz + vec3(0.001, 0.0013, 0.0007));
        float reach = uReach * (0.25 + aR1.x);
        vec3 drift = 0.16 * vec3(
            sin(TAU * 2.0 * uTau + 1.7 * home.y + 0.5),
            sin(2.3 * home.z - TAU * uTau + 1.0),
            cos(TAU * 2.0 * uTau + 1.9 * home.x + 2.0));
        vec3 loose = home + outward * reach * (0.75 + 0.25 * sin(TAU * (c + aR1.y))) + drift;
        float gg = smoothstep(0.0, 1.0, g);
        vec3 obj = mix(loose, home, gg);
        alpha *= 0.3 + 0.7 * gg;
        e *= 0.6 + 0.4 * gg;
        world = uRot * obj;
    } else if (type < 3.5) {
        isBand = 1.0;
        float a0 = aA.x;
        float r0 = aA.y;
        float y0 = aA.z;
        float turns = uBandTurns + floor((1.0 - r0) * 2.0);
        float ang = a0 + TAU * turns * uTau;
        float frag = 1.0 - uBandAct;
        // A tight corrugated ribbon when the object is assembled (002), a
        // wide disc of haze when it is loose (003, 004).
        float r = uBandR * (1.85 + (r0 - 0.5) * (0.7 + 1.3 * frag));
        r *= 1.0 + 0.035 * sin(22.0 * ang + TAU * 4.0 * uTau) * uBandAct;
        r += frag * (aR3.x - 0.5);
        float y = uBandWave * (
            0.10 * sin(2.0 * ang - TAU * 2.0 * uTau)
            + 0.06 * sin(3.0 * ang + TAU * 3.0 * uTau + 1.0)
            + 0.06 * sin(4.0 * ang + TAU * 3.0 * uTau) * smoothstep(2.3, 1.3, r));
        y += y0 * (0.03 + 0.3 * frag) * (0.6 + 0.25 * r);
        y += 0.02 * sin(22.0 * ang + TAU * 4.0 * uTau + 1.5) * uBandAct;
        vec3 bp = vec3(r * cos(ang), y, r * sin(ang));
        float dens = 0.4 + 0.6 * (0.5 + 0.5 * sin(2.0 * ang - TAU * uTau + 0.5)) * (0.5 + 0.5 * sin(5.0 * ang + TAU * 2.0 * uTau + aR3.y));
        // Loose, the band survives as two side clouds (004, 009), so its
        // near and far stretches fade first.
        alpha = mix(dens, dens * 0.2 * (0.3 + 0.7 * abs(cos(ang))), frag) * uBandAmt * 0.9;
        e = 0.2 + 0.14 * uBandAct + 0.06 * sin(3.0 * ang + TAU * 2.0 * uTau);
        world = uBandRot * bp;
    } else {
        float life = fract(uLives * uTau + seed);
        vec3 dir = normalize(aR2.xyz + vec3(0.001, 0.002, 0.0015));
        vec3 obj = aA.xyz + dir * life * (0.12 + 0.35 * aR1.x) + vec3(0.0, 0.05 * life, 0.0);
        float en = heatAt(aA.xyz, seed);
        e = 0.8 * en;
        alpha = (1.0 - life) * (0.25 + en) * 0.9;
        world = uRot * obj;
    }
    world *= uScale;
    world.y += uBob;
    vec3 v = toView(world);
    float depth = max(uCam - v.z, 0.5);
    if (isBand > 0.5) {
        // Dim the far side of the band where it lies behind the object.
        float behind = smoothstep(0.1, -0.3, v.z / uScale);
        float rr = uShape < 0.5 ? (abs(v.x) + abs(v.y)) / uScale : length(v.xy) / uScale;
        float inside = 1.0 - smoothstep(0.85, 1.05, rr);
        alpha *= 1.0 - 0.8 * behind * inside;
    }
    float att = uCam / depth;
    float spark = step(0.94, aR3.w);
    float px = uPx * (0.75 + 0.5 * aR3.z) * (0.8 + 0.5 * clamp(e, 0.0, 1.2)) * att * (1.0 + 0.9 * spark);
    gl_PointSize = min(px, uMaxPt);
    gl_Position = vec4(ndcOf(v, depth), 0.0, 1.0);
    float a = uAlpha * alpha * (1.0 + 1.5 * spark) * att * att;
    vCol = hueShift(rampLin(e)) * glowOf(e) * a * uPre;
}
`

const POINT_FRAG = `
precision mediump float;
varying vec3 vCol;
void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float a = exp(-r2 * 3.0) * (1.0 - r2);
    gl_FragColor = vec4(vCol * a, 1.0);
}
`

const LINE_VERT =
    COMMON +
    `
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aMeta;
attribute vec4 aR1;
uniform float uLineW;
uniform float uInner;
varying float vX;
varying vec3 vCol;
varying float vHot;

void main() {
    float s = aA.w;
    float side = aMeta.x;
    float order = aMeta.y;
    float seed = aMeta.z;
    float ph = aMeta.w;
    vec3 A = aA.xyz;
    vec3 B = aB.xyz;
    float curve = aB.w;
    vec3 mid = pathBase(A, B, 0.5, curve);
    float amp = bendAmpOf(assembleAt(mid, seed), order);
    float ds = 1.0 / SEGS_F;
    float s1 = s + ds;
    float flip = 1.0;
    if (s1 > 1.0) { s1 = s - ds; flip = -1.0; }
    vec3 p0 = pathPos(A, B, s, curve, aR1, amp);
    vec3 p1 = pathPos(A, B, s1, curve, aR1, amp);
    float g = assembleAt(p0, seed);
    // Lines break along their length as their neighbourhood loosens.
    float pres = smoothstep(0.28, 0.62, g + 0.14 * sin(TAU * 2.0 * cyc() + 9.0 * s + 6.0 * seed));
    float e = heatAt(p0, seed) + 0.6 * uPulse * pulseAt(s, ph);
    vec3 w0 = uRot * p0 * uScale;
    vec3 w1 = uRot * p1 * uScale;
    w0.y += uBob;
    w1.y += uBob;
    vec3 v0 = toView(w0);
    vec3 v1 = toView(w1);
    float d0 = max(uCam - v0.z, 0.5);
    float d1 = max(uCam - v1.z, 0.5);
    vec2 n0 = ndcOf(v0, d0);
    vec2 n1 = ndcOf(v1, d1);
    vec2 dir = (n1 - n0) * uRes * flip;
    float len = length(dir);
    dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float att = uCam / d0;
    float hw = uLineW * (0.7 + 0.5 * clamp(e, 0.0, 1.2)) * (order > 0.5 ? 0.7 : 1.0) * (0.45 + 0.55 * pres) * att;
    vec2 off = nrm * side * hw * 2.0 / uRes;
    gl_Position = vec4(n0 + off, 0.0, 1.0);
    vX = side;
    vHot = clamp(e, 0.0, 1.5);
    float inner = order > 0.5 ? uInner : 1.0;
    vCol = hueShift(rampLin(e)) * glowOf(e) * pres * inner * att * uPre * 0.5;
}
`

const LINE_FRAG = `
precision mediump float;
varying float vX;
varying vec3 vCol;
varying float vHot;
void main() {
    float x = abs(vX);
    float core = exp(-x * x * 40.0);
    float glow = exp(-x * x * 3.5) * 0.16;
    vec3 c = vCol * (glow + core * (0.8 + vHot));
    float lum = max(max(vCol.r, vCol.g), vCol.b);
    c += vec3(lum) * core * 0.6 * vHot * vHot;
    gl_FragColor = vec4(c, 1.0);
}
`

const NODE_VERT =
    COMMON +
    `
attribute vec4 aA;
attribute vec4 aMeta;
attribute vec4 aR1;
uniform float uNodePx;
uniform float uMaxPt;
varying vec3 vCore;
varying vec3 vHalo;

float arrive(float ph) {
    if (ph < 0.0) return 0.0;
    float d = fract(cyc() * uPulseK + ph);
    float dist = min(d, 1.0 - d);
    return exp(-dist * dist * 400.0);
}

void main() {
    vec3 p = aA.xyz;
    float kind = aA.w;
    float seed = aMeta.x;
    float g = smoothstep(0.0, 1.0, assembleAt(p, seed));
    float e = heatAt(p, seed);
    float flare = uPulse * (arrive(aMeta.y) + arrive(aMeta.z) + arrive(aMeta.w) + arrive(aR1.x));
    // Poles and equatorial anchors persist through the sparsest state;
    // interior junctions come and go with the lines that meet there.
    float vis = kind > 2.5 ? 1.0 : (kind > 1.5 ? 0.15 + 0.85 * g : 0.55 + 0.45 * g);
    if (kind > 2.5) {
        e = 0.7 + 0.08 * sin(TAU * (3.0 * uTau + seed));
        flare = 0.0;
    }
    // Nodes never cool below pink: frame 005 keeps them lit when the
    // lines are gone.
    float heat = clamp(max(e, 0.35) + 0.5 * flare, 0.0, 1.6);
    vec3 world = uRot * p * uScale;
    world.y += uBob;
    vec3 v = toView(world);
    float depth = max(uCam - v.z, 0.5);
    float att = uCam / depth;
    gl_PointSize = min(uNodePx * aR1.y * (0.7 + 0.6 * heat) * att, uMaxPt);
    gl_Position = vec4(ndcOf(v, depth), 0.0, 1.0);
    vec3 col = hueShift(rampLin(heat));
    vCore = mix(col, vec3(1.0), 0.25 + 0.6 * clamp(heat, 0.0, 1.0)) * (1.0 + 5.0 * heat) * vis * uPre;
    vHalo = col * (0.6 + 2.5 * heat) * vis * uPre;
}
`

const NODE_FRAG = `
precision mediump float;
varying vec3 vCore;
varying vec3 vHalo;
void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 60.0);
    float halo = exp(-r2 * 4.0) * 0.1 * (1.0 - r2);
    gl_FragColor = vec4(vCore * core + vHalo * halo, 1.0);
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

const BLUR_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
    vec3 c = texture2D(uTex, vUv).rgb * 0.2270270270;
    c += (texture2D(uTex, vUv + uStep * 1.3846153846).rgb + texture2D(uTex, vUv - uStep * 1.3846153846).rgb) * 0.3162162162;
    c += (texture2D(uTex, vUv + uStep * 3.2307692308).rgb + texture2D(uTex, vUv - uStep * 3.2307692308).rgb) * 0.0702702703;
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
uniform vec3 uBg;
uniform vec3 uAtmos;
uniform float uBloom;
uniform float uHalo;
uniform float uPost;
uniform float uHeat;
uniform vec2 uRes;
varying vec2 vUv;
float ign(vec2 p) { return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)); }
void main() {
    vec3 s = texture2D(uScene, vUv).rgb;
    vec3 b = texture2D(uB0, vUv).rgb * 0.5
           + texture2D(uB1, vUv).rgb * 0.4
           + texture2D(uB2, vUv).rgb * 0.3
           + texture2D(uB3, vUv).rgb * 0.22
           + texture2D(uB4, vUv).rgb * 0.18;
    vec3 hdr = (s + uBloom * b) * uPost;
    vec3 tm = hdr / (1.0 + hdr);
    vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float d = dot(q, q);
    vec3 atm = uAtmos * (0.5 + 0.9 * uHeat) * exp(-d * 3.5) * uHalo;
    vec3 col = uBg + atm + pow(tm, vec3(1.0 / 2.2));
    col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
}
`

/* --------------------------------------------------------------- runtime */

interface Params {
    shape: string
    background: string
    size: number
    particles: number
    pointSize: number
    speed: number
    cycleSeconds: number
    rotation: number
    phase: number
    hue: number
    energy: EnergySettings
    lines: LineSettings
    band: BandSettings
    glow: GlowSettings
    seed: number
    maxPixelRatio: number
    poleDots: boolean
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

type GL = WebGLRenderingContext

function compile(gl: GL, type: number, src: string) {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("EnergyForm shader:", gl.getShaderInfoLog(sh))
        gl.deleteShader(sh)
        return null
    }
    return sh
}

function link(gl: GL, vs: string, fs: string) {
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
        console.error("EnergyForm link:", gl.getProgramInfoLog(prog))
        gl.deleteProgram(prog)
        return null
    }
    return prog
}

const COMMON_UNIFORMS = [
    "uTau", "uAmin", "uDown", "uFront", "uEbase", "uEflood", "uS", "uPulse", "uPulseK", "uBend",
    "uRot", "uView", "uScale", "uCam", "uFocal", "uAspect", "uRes", "uBob", "uShape", "uHueC", "uHueS", "uPre",
]

type Uniforms = Record<string, WebGLUniformLocation | null>

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
    let gl: GL | null = null
    let isGL2 = false
    try {
        gl = canvas.getContext("webgl2", opts) as GL | null
        isGL2 = !!gl
    } catch {
        gl = null
    }
    if (!gl) {
        gl =
            (canvas.getContext("webgl", opts) as GL | null) ||
            (canvas.getContext("experimental-webgl", opts) as GL | null)
    }
    if (!gl) return null

    const progPts = link(gl, POINT_VERT, POINT_FRAG)
    const progLine = link(gl, LINE_VERT, LINE_FRAG)
    const progNode = link(gl, NODE_VERT, NODE_FRAG)
    const progBlur = link(gl, QUAD_VERT, BLUR_FRAG)
    const progComp = link(gl, QUAD_VERT, COMP_FRAG)
    if (!progPts || !progLine || !progNode || !progBlur || !progComp) return null

    const U = (prog: WebGLProgram, names: string[]): Uniforms => {
        const out: Uniforms = {}
        for (const n of names) out[n] = gl!.getUniformLocation(prog, n)
        return out
    }
    const A = (prog: WebGLProgram, names: string[]) => names.map((n) => gl!.getAttribLocation(prog, n))
    const uP = U(progPts, COMMON_UNIFORMS.concat(["uPx", "uAlpha", "uFlow", "uReach", "uBandR", "uBandWave", "uBandTurns", "uBandAmt", "uBandAct", "uBandRot", "uLives", "uMaxPt"]))
    const uL = U(progLine, COMMON_UNIFORMS.concat(["uLineW", "uInner"]))
    const uN = U(progNode, COMMON_UNIFORMS.concat(["uNodePx", "uMaxPt"]))
    const uB = U(progBlur, ["uTex", "uStep"])
    const uC = U(progComp, ["uScene", "uB0", "uB1", "uB2", "uB3", "uB4", "uBg", "uAtmos", "uBloom", "uHalo", "uPost", "uHeat", "uRes"])
    const aP = A(progPts, ["aA", "aB", "aMeta", "aR1", "aR2", "aR3"])
    const aL = A(progLine, ["aA", "aB", "aMeta", "aR1"])
    const aN = A(progNode, ["aA", "aMeta", "aR1"])
    const aPosBlur = gl.getAttribLocation(progBlur, "aPos")
    const aPosComp = gl.getAttribLocation(progComp, "aPos")

    const quadBuf = gl.createBuffer()
    const ptsBuf = gl.createBuffer()
    const lineBuf = gl.createBuffer()
    const lineIdx = gl.createBuffer()
    const nodeBuf = gl.createBuffer()
    if (!quadBuf || !ptsBuf || !lineBuf || !lineIdx || !nodeBuf) return null
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | number[] | null
    const maxPoint = pointRange && Number.isFinite(pointRange[1]) ? Math.max(1, pointRange[1]) : 64

    // Half-float accumulation when the device renders to it, otherwise
    // bytes with everything drawn at a quarter and scaled back in the
    // composite, so stacking still has headroom.
    const fmt = (() => {
        const tryFmt = (internal: number, type: number) => {
            while (gl!.getError() !== gl!.NO_ERROR) { /* clear */ }
            const tex = gl!.createTexture()
            const fb = gl!.createFramebuffer()
            if (!tex || !fb) return false
            gl!.bindTexture(gl!.TEXTURE_2D, tex)
            gl!.texImage2D(gl!.TEXTURE_2D, 0, internal, 4, 4, 0, gl!.RGBA, type, null)
            gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST)
            gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST)
            gl!.bindFramebuffer(gl!.FRAMEBUFFER, fb)
            gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0)
            const ok = gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) === gl!.FRAMEBUFFER_COMPLETE && gl!.getError() === gl!.NO_ERROR
            gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
            gl!.deleteFramebuffer(fb)
            gl!.deleteTexture(tex)
            return ok
        }
        if (isGL2) {
            const ext = gl!.getExtension("EXT_color_buffer_float") || gl!.getExtension("EXT_color_buffer_half_float")
            if (ext && tryFmt(0x881a, 0x140b)) return { internal: 0x881a, type: 0x140b, hdr: true, linear: true }
        } else {
            const half = gl!.getExtension("OES_texture_half_float")
            gl!.getExtension("EXT_color_buffer_half_float")
            const linear = !!gl!.getExtension("OES_texture_half_float_linear")
            if (half && tryFmt(gl!.RGBA, 0x8d61)) return { internal: gl!.RGBA, type: 0x8d61, hdr: true, linear }
        }
        return { internal: gl!.RGBA, type: gl!.UNSIGNED_BYTE, hdr: false, linear: true }
    })()
    const preScale = fmt.hdr ? 1 : 0.25

    let params = first
    let tau = (clamp(num(first.phase, DEFAULTS.phase), 0, 1) % 1) / CYCLES
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

    let geomKey = ""
    let builtCount = 0
    let lineIndexCount = 0
    let nodeCount = 0

    function makeTarget(w: number, h: number): Target | null {
        const tex = gl!.createTexture()
        const fb = gl!.createFramebuffer()
        if (!tex || !fb) return null
        const filter = fmt.linear ? gl!.LINEAR : gl!.NEAREST
        gl!.bindTexture(gl!.TEXTURE_2D, tex)
        gl!.texImage2D(gl!.TEXTURE_2D, 0, fmt.internal, w, h, 0, gl!.RGBA, fmt.type, null)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter)
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
        for (let i = 0; i < BLOOM_LEVELS; i++) {
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
        const count = clamp(Math.round(num(p.particles, DEFAULTS.particles)), MIN_POINTS, MAX_POINTS)
        const sphere = p.shape === "sphere"
        const dots = p.poleDots !== false
        const key = [seed, count, sphere ? "s" : "d", dots ? 1 : 0].join("/")
        if (key === geomKey) return
        const rng = mulberry32(seed * 2654435761 + 1)
        const st = sphere ? buildSphere(rng) : buildDiamond(rng)
        gl!.bindBuffer(gl!.ARRAY_BUFFER, ptsBuf)
        gl!.bufferData(gl!.ARRAY_BUFFER, buildParticles(rng, count, st, dots), gl!.STATIC_DRAW)
        const ribbons = buildRibbons(st)
        gl!.bindBuffer(gl!.ARRAY_BUFFER, lineBuf)
        gl!.bufferData(gl!.ARRAY_BUFFER, ribbons.verts, gl!.STATIC_DRAW)
        gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, lineIdx)
        gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, ribbons.index, gl!.STATIC_DRAW)
        const nodes = buildNodes(rng, st, dots)
        gl!.bindBuffer(gl!.ARRAY_BUFFER, nodeBuf)
        gl!.bufferData(gl!.ARRAY_BUFFER, nodes.data, gl!.STATIC_DRAW)
        builtCount = count
        lineIndexCount = ribbons.index.length
        nodeCount = nodes.count
        geomKey = key
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
        gl!.uniform2f(uB.uStep, dx / dst.w, dy / dst.h)
        drawQuad(aPosBlur)
    }

    function bindVec4s(buf: WebGLBuffer, locs: number[], stride: number) {
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buf)
        locs.forEach((loc, i) => {
            if (loc < 0) return
            gl!.enableVertexAttribArray(loc)
            gl!.vertexAttribPointer(loc, 4, gl!.FLOAT, false, stride * 4, i * 16)
        })
    }

    function unbindVec4s(locs: number[]) {
        for (const loc of locs) if (loc >= 0) gl!.disableVertexAttribArray(loc)
    }

    interface FrameState {
        cs: ReturnType<typeof cycleState>
        rot: Mat3
        view: Mat3
        scale: number
        focal: number
        aspect: number
        w: number
        h: number
        bob: number
        sphere: boolean
        hue: number
        bend: number
        pulseK: number
    }

    function setCommon(u: Uniforms, f: FrameState) {
        gl!.uniform1f(u.uTau, tau)
        gl!.uniform1f(u.uAmin, f.cs.amin)
        gl!.uniform1f(u.uDown, f.cs.down)
        gl!.uniform1f(u.uFront, f.cs.front)
        gl!.uniform1f(u.uEbase, f.cs.ebase)
        gl!.uniform1f(u.uEflood, f.cs.eflood)
        gl!.uniform1f(u.uS, f.cs.surge)
        gl!.uniform1f(u.uPulse, f.cs.pulse)
        gl!.uniform1f(u.uPulseK, f.pulseK)
        gl!.uniform1f(u.uBend, f.bend)
        gl!.uniformMatrix3fv(u.uRot, false, f.rot)
        gl!.uniformMatrix3fv(u.uView, false, f.view)
        gl!.uniform1f(u.uScale, f.scale)
        gl!.uniform1f(u.uCam, CAM)
        gl!.uniform1f(u.uFocal, f.focal)
        gl!.uniform1f(u.uAspect, f.aspect)
        gl!.uniform2f(u.uRes, f.w, f.h)
        gl!.uniform1f(u.uBob, f.bob)
        gl!.uniform1f(u.uShape, f.sphere ? 1 : 0)
        gl!.uniform1f(u.uHueC, Math.cos(f.hue))
        gl!.uniform1f(u.uHueS, Math.sin(f.hue))
        gl!.uniform1f(u.uPre, preScale)
    }

    function draw(dpr: number) {
        if (!sceneT || mips.length < BLOOM_LEVELS) return
        const p = params
        ensureGeometry(p)
        const w = canvas.width
        const h = canvas.height
        const minDim = Math.min(w, h)
        const aspect = w / h
        const energy = p.energy
        const lines = p.lines
        const band = p.band
        const glow = p.glow

        const phi = (((tau * CYCLES) % 1) + 1) % 1
        const cs = cycleState(phi, energy)
        const focal = 1 / Math.tan((FOV * Math.PI) / 360)
        const frac = clamp(num(p.size, DEFAULTS.size), 10, 150) / 100
        const scale = (frac * CAM) / focal * Math.min(aspect, 1)
        const rotAmt = num(p.rotation, DEFAULTS.rotation)
        const turns = turnsPerLoop(rotAmt)
        const wob = wobbleAmp(rotAmt)
        // A resting yaw keeps the equatorial square off edge-on, and the
        // wobbles keep the turn from ever reading as one flat rate.
        const yaw = Math.PI * 2 * turns * tau + wob * Math.sin(Math.PI * 4 * tau + 1.0) + 0.35
        const pitchW = 0.6 * wob * Math.sin(Math.PI * 6 * tau + 2.0)
        const rollW = 0.35 * wob * Math.sin(Math.PI * 2 * tau + 0.5)
        const rot = mul3(rotY(yaw), mul3(rotX(pitchW), rotZ(rollW)))
        const view = rotX((CAM_PITCH * Math.PI) / 180)
        const bandRot = mul3(rotZ(0.05 * Math.sin(Math.PI * 4 * tau + 1.0)), rotX(0.06 + 0.08 * Math.sin(Math.PI * 2 * tau)))
        const frame: FrameState = {
            cs,
            rot,
            view,
            scale,
            focal,
            aspect,
            w,
            h,
            bob: 0.03 * scale * Math.sin(Math.PI * 4 * tau),
            sphere: p.shape === "sphere",
            hue: (num(p.hue, DEFAULTS.hue) * Math.PI) / 180,
            bend: bendAmp(num(lines.bend, DEFAULT_LINES.bend)),
            pulseK: pulsesPerCycle(num(energy.flow, DEFAULT_ENERGY.flow)),
        }

        // 1. Everything additive into the scene target.
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, sceneT.fb)
        gl!.viewport(0, 0, w, h)
        gl!.clearColor(0, 0, 0, 0)
        gl!.clear(gl!.COLOR_BUFFER_BIT)
        gl!.enable(gl!.BLEND)
        gl!.blendFunc(gl!.ONE, gl!.ONE)

        const px = Math.max(0.5, num(p.pointSize, DEFAULTS.pointSize))
        const pxDev = (px * minDim) / REF_DIM
        const alpha = 1.3 * Math.sqrt(REF_COUNT / Math.max(1, builtCount)) * (REF_POINT / px)
        gl!.useProgram(progPts)
        setCommon(uP, frame)
        gl!.uniform1f(uP.uPx, pxDev)
        gl!.uniform1f(uP.uAlpha, alpha)
        gl!.uniform1f(uP.uFlow, flowTraversals(num(energy.flow, DEFAULT_ENERGY.flow)))
        gl!.uniform1f(uP.uReach, scatterReach(num(energy.dissolve, DEFAULT_ENERGY.dissolve)))
        gl!.uniform1f(uP.uBandR, bandRadius(num(band.radius, DEFAULT_BAND.radius)))
        gl!.uniform1f(uP.uBandWave, bandWave(num(band.wave, DEFAULT_BAND.wave)))
        gl!.uniform1f(uP.uBandTurns, bandOrbits(num(band.speed, DEFAULT_BAND.speed)))
        gl!.uniform1f(uP.uBandAmt, bandAmount(num(band.amount, DEFAULT_BAND.amount)))
        gl!.uniform1f(uP.uBandAct, cs.bandAct)
        gl!.uniformMatrix3fv(uP.uBandRot, false, bandRot)
        gl!.uniform1f(uP.uLives, LIVES)
        gl!.uniform1f(uP.uMaxPt, maxPoint)
        bindVec4s(ptsBuf, aP, P_STRIDE)
        gl!.drawArrays(gl!.POINTS, 0, builtCount)
        unbindVec4s(aP)

        gl!.useProgram(progLine)
        setCommon(uL, frame)
        gl!.uniform1f(uL.uLineW, (lineHalfWidth(num(lines.thickness, DEFAULT_LINES.thickness)) * minDim) / REF_DIM)
        gl!.uniform1f(uL.uInner, innerMix(num(lines.inner, DEFAULT_LINES.inner)))
        bindVec4s(lineBuf, aL, L_STRIDE)
        gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, lineIdx)
        gl!.drawElements(gl!.TRIANGLES, lineIndexCount, gl!.UNSIGNED_SHORT, 0)
        unbindVec4s(aL)

        gl!.useProgram(progNode)
        setCommon(uN, frame)
        gl!.uniform1f(uN.uNodePx, (44 * nodeScale(num(glow.nodes, DEFAULT_GLOW.nodes)) * minDim) / REF_DIM)
        gl!.uniform1f(uN.uMaxPt, maxPoint)
        bindVec4s(nodeBuf, aN, N_STRIDE)
        gl!.drawArrays(gl!.POINTS, 0, nodeCount)
        unbindVec4s(aN)
        gl!.disable(gl!.BLEND)

        // 2. Blur chain, each level reading the one above and halving.
        let src: Target = sceneT
        for (let i = 0; i < mips.length; i++) {
            const [a, b] = mips[i]
            blurInto(src, a, 1, 0)
            blurInto(a, b, 0, 1)
            src = b
        }

        // 3. Composite: tone map, bloom, atmosphere, background.
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
        const bg = toRGB(p.background)
        gl!.uniform3f(uC.uBg, bg[0], bg[1], bg[2])
        const atm = atmosStrength(num(glow.atmosphere, DEFAULT_GLOW.atmosphere))
        gl!.uniform3f(uC.uAtmos, 0.36 * atm, 0.02 * atm, 0.14 * atm)
        gl!.uniform1f(uC.uBloom, bloomStrength(num(glow.bloom, DEFAULT_GLOW.bloom)))
        gl!.uniform1f(uC.uHalo, 1)
        gl!.uniform1f(uC.uPost, (fmt.hdr ? 1 : 4) * 1.1)
        gl!.uniform1f(uC.uHeat, clamp(cs.heatNow, 0, 1.2))
        gl!.uniform2f(uC.uRes, w, h)
        drawQuad(aPosComp)
        gl!.activeTexture(gl!.TEXTURE0)
        needsFrame = false
    }

    function frame(dt: number) {
        const dpr = resize()
        const rate = speedRate(num(params.speed, DEFAULTS.speed))
        const cycle = Math.max(1, num(params.cycleSeconds, DEFAULTS.cycleSeconds))
        if (!reduceMotion && rate > 0 && dt > 0) {
            tau = (tau + (dt * rate) / (cycle * CYCLES)) % 1
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
    const ro =
        typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => {
                  needsFrame = true
                  if (!running) frame(0)
              })
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
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null
    reduceMotion = !!mq && mq.matches
    const onMQ = (e: MediaQueryListEvent) => {
        reduceMotion = e.matches
        needsFrame = true
    }
    if (mq) {
        if (mq.addEventListener) mq.addEventListener("change", onMQ)
        else mq.addListener(onMQ)
    }
    const onLost = (e: Event) => {
        e.preventDefault()
        cancelAnimationFrame(raf)
    }
    const onRestored = () => {
        // Buffers and programs went with the context; let React rebuild.
        if (!disposed) host.dispatchEvent(new CustomEvent("energyform-restore"))
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
            const phaseChanged = num(p.phase, DEFAULTS.phase) !== num(params.phase, DEFAULTS.phase)
            params = p
            if (phaseChanged && (!running || speedRate(num(p.speed, DEFAULTS.speed)) === 0)) {
                tau = (clamp(num(p.phase, DEFAULTS.phase), 0, 1) % 1) / CYCLES
            }
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
            gl!.deleteBuffer(quadBuf)
            gl!.deleteBuffer(ptsBuf)
            gl!.deleteBuffer(lineBuf)
            gl!.deleteBuffer(lineIdx)
            gl!.deleteBuffer(nodeBuf)
            gl!.deleteProgram(progPts)
            gl!.deleteProgram(progLine)
            gl!.deleteProgram(progNode)
            gl!.deleteProgram(progBlur)
            gl!.deleteProgram(progComp)
            const lose = gl!.getExtension("WEBGL_lose_context")
            if (lose) lose.loseContext()
        },
    }
}

/* ------------------------------------------------------------------ props */

interface EnergyFormProps {
    /** "diamond" for the octahedral crystal, "sphere" for the spherical
     *  field. Same material, same cycle; only the geometry changes. */
    shape?: string
    /** The colour behind everything. Near-black with a hint of red. */
    background?: string
    /** Object height as a percentage of the frame's shorter side. */
    size?: number
    /** How many points make up the structure, band included. */
    particles?: number
    /** Point diameter in CSS px at a 900px frame. */
    pointSize?: number
    /** Playback rate, 0-10. 0 holds the frame at the start phase. */
    speed?: number
    /** Seconds per energy cycle at speed 5. The seamless loop is three. */
    cycleSeconds?: number
    /** How much the object turns, 0-10. 0 holds still. */
    rotation?: number
    /** Where in the cycle to begin, 0-1. Also the frame the Framer
     *  canvas shows. 0.42 is the assembled orange crystal. */
    phase?: number
    /** Rotates the whole palette, in degrees. */
    hue?: number
    /** The energy cycle dials. */
    energy?: Partial<EnergySettings>
    /** The structural lines. */
    lines?: Partial<LineSettings>
    /** The orbiting particle band. */
    band?: Partial<BandSettings>
    /** Bloom, atmosphere and node size. */
    glow?: Partial<GlowSettings>
    /** Reseeds the junctions, the sphere's anchors and every point's home. */
    seed?: number
    /** Cap on the device pixel ratio the canvas renders at. */
    maxPixelRatio?: number
    /** The two detached dots above and below the object. */
    poleDots?: boolean
    style?: CSSProperties
}

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 * @framerIntrinsicWidth 1000
 * @framerIntrinsicHeight 900
 */
export default function EnergyForm({
    shape = DEFAULTS.shape,
    background = DEFAULTS.background,
    size = DEFAULTS.size,
    particles = DEFAULTS.particles,
    pointSize = DEFAULTS.pointSize,
    speed = DEFAULTS.speed,
    cycleSeconds = DEFAULTS.cycleSeconds,
    rotation = DEFAULTS.rotation,
    phase = DEFAULTS.phase,
    hue = DEFAULTS.hue,
    energy,
    lines,
    band,
    glow,
    seed = DEFAULTS.seed,
    maxPixelRatio = DEFAULTS.maxPixelRatio,
    poleDots = DEFAULTS.poleDots,
    style,
}: EnergyFormProps) {
    const isStatic = useIsStaticRenderer()
    const animate = !isStatic

    const hostRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const sceneRef = useRef<Scene | null>(null)
    const [failed, setFailed] = useState(false)
    const [generation, setGeneration] = useState(0)

    // Every number read through num(); grouped props merged over defaults.
    const paramsRef = useRef<Params>(null!)
    paramsRef.current = {
        shape: shape === "sphere" ? "sphere" : "diamond",
        background: typeof background === "string" ? background : DEFAULTS.background,
        size: num(size, DEFAULTS.size),
        particles: num(particles, DEFAULTS.particles),
        pointSize: num(pointSize, DEFAULTS.pointSize),
        speed: num(speed, DEFAULTS.speed),
        cycleSeconds: num(cycleSeconds, DEFAULTS.cycleSeconds),
        rotation: num(rotation, DEFAULTS.rotation),
        phase: num(phase, DEFAULTS.phase),
        hue: num(hue, DEFAULTS.hue),
        energy: { ...DEFAULT_ENERGY, ...energy },
        lines: { ...DEFAULT_LINES, ...lines },
        band: { ...DEFAULT_BAND, ...band },
        glow: { ...DEFAULT_GLOW, ...glow },
        seed: num(seed, DEFAULTS.seed),
        maxPixelRatio: num(maxPixelRatio, DEFAULTS.maxPixelRatio),
        poleDots: poleDots !== false,
    }

    // Build once; rebuild only when animation is switched or the GL
    // context comes back. Geometry changes are handled inside the scene.
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
        host.addEventListener("energyform-restore", onRestore)
        if (animate) scene.start()
        else scene.renderOnce()
        return () => {
            host.removeEventListener("energyform-restore", onRestore)
            scene.dispose()
            sceneRef.current = null
        }
    }, [animate, generation])

    // Push prop changes into the running scene. No dependency array on
    // purpose: it runs after every render, so no control can go stale,
    // and it repaints the static canvas.
    useEffect(() => {
        const scene = sceneRef.current
        if (!scene) return
        scene.setParams(paramsRef.current)
        if (!animate) scene.renderOnce()
    })

    const bgCss = typeof background === "string" ? background : DEFAULTS.background

    return (
        <div
            ref={hostRef}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",
                background: bgCss,
                ...style,
            }}
        >
            {failed ? (
                // No WebGL: a still of the assembled crystal in CSS, so the
                // slot is a picture rather than a black box.
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background: `radial-gradient(ellipse 22% 32% at 50% 50%, rgba(255,205,120,0.95) 0%, rgba(255,120,40,0.7) 40%, rgba(255,60,90,0.25) 75%, rgba(0,0,0,0) 100%), radial-gradient(ellipse 60% 18% at 50% 52%, rgba(255,50,140,0.35) 0%, rgba(120,10,60,0.15) 60%, rgba(0,0,0,0) 100%), radial-gradient(circle at 50% 50%, rgba(90,8,40,0.45) 0%, rgba(0,0,0,0) 65%)`,
                    }}
                />
            ) : (
                <canvas
                    ref={canvasRef}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
                />
            )}
        </div>
    )
}

/* ------------------------------------------------- property controls */

addPropertyControls(EnergyForm, {
    // ---------- Layout
    shape: {
        type: ControlType.Enum,
        title: "Shape",
        description: "The octahedral crystal of the reference, or a spherical field of the same material.",
        options: ["diamond", "sphere"],
        optionTitles: ["Diamond", "Sphere"],
        defaultValue: DEFAULTS.shape,
        displaySegmentedControl: true,
    },
    size: {
        type: ControlType.Number,
        title: "Size",
        description: "Object height as a percentage of the frame's shorter side.",
        defaultValue: DEFAULTS.size,
        min: 10,
        max: 150,
        step: 1,
        unit: "%",
    },
    particles: {
        type: ControlType.Number,
        title: "Particles",
        description: "How many points make up the structure and the band. More is denser and costs more to draw.",
        defaultValue: DEFAULTS.particles,
        min: MIN_POINTS,
        max: MAX_POINTS,
        step: 1000,
    },
    pointSize: {
        type: ControlType.Number,
        title: "Point Size",
        description: "Diameter of one point at a 900px frame. Keep it small; the sparks and nodes are bigger on their own.",
        defaultValue: DEFAULTS.pointSize,
        min: 0.5,
        max: 6,
        step: 0.1,
        unit: "px",
    },
    // ---------- Animation
    speed: {
        type: ControlType.Number,
        title: "Speed",
        description: "Playback rate. 0 holds the frame at the start phase.",
        defaultValue: DEFAULTS.speed,
        min: 0,
        max: 10,
        step: 0.1,
    },
    cycleSeconds: {
        type: ControlType.Number,
        title: "Cycle Length",
        description: "Seconds from one assembly to the next at speed 5. The seamless loop is three cycles.",
        defaultValue: DEFAULTS.cycleSeconds,
        min: 6,
        max: 90,
        step: 1,
        unit: "s",
    },
    rotation: {
        type: ControlType.Number,
        title: "Rotation",
        description: "How much the object turns and wobbles over the loop. 0 holds still.",
        defaultValue: DEFAULTS.rotation,
        min: 0,
        max: 10,
        step: 0.1,
    },
    phase: {
        type: ControlType.Number,
        title: "Start Phase",
        description: "Where in the cycle it begins, and the frame shown on the canvas. 0.42 is the assembled crystal, 0.19 the surge, 0.95 the sparse network.",
        defaultValue: DEFAULTS.phase,
        min: 0,
        max: 1,
        step: 0.01,
    },
    // ---------- Colors
    background: {
        type: ControlType.Color,
        title: "Background",
        description: "The colour behind everything. Near-black is the reference.",
        defaultValue: DEFAULTS.background,
    },
    hue: {
        type: ControlType.Number,
        title: "Hue Shift",
        description: "Rotates the whole palette. 0 is the magenta-to-white of the reference.",
        defaultValue: DEFAULTS.hue,
        min: -180,
        max: 180,
        step: 1,
        unit: "°",
    },
    // ---------- Effects
    energy: {
        type: ControlType.Object,
        title: "Energy",
        description: "The cycle: how hot it peaks, how far it dissolves, how fast it flows, how hard the poles surge.",
        defaultValue: DEFAULT_ENERGY,
        controls: {
            heat: {
                type: ControlType.Number,
                title: "Heat",
                description: "Peak temperature. 5 is orange, 10 goes white.",
                defaultValue: DEFAULT_ENERGY.heat,
                min: 0,
                max: 10,
                step: 0.1,
            },
            dissolve: {
                type: ControlType.Number,
                title: "Dissolve",
                description: "How far the shape comes apart at the bottom of the cycle.",
                defaultValue: DEFAULT_ENERGY.dissolve,
                min: 0,
                max: 10,
                step: 0.1,
            },
            flow: {
                type: ControlType.Number,
                title: "Flow",
                description: "How fast energy travels along the lines.",
                defaultValue: DEFAULT_ENERGY.flow,
                min: 0,
                max: 10,
                step: 0.1,
            },
            surge: {
                type: ControlType.Number,
                title: "Surge",
                description: "How hard the poles blow out before the flood.",
                defaultValue: DEFAULT_ENERGY.surge,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },
    lines: {
        type: ControlType.Object,
        title: "Lines",
        description: "The structural lines: their width, how far they bend, how bright the internal ones are.",
        defaultValue: DEFAULT_LINES,
        controls: {
            thickness: {
                type: ControlType.Number,
                title: "Thickness",
                description: "Width of the lines.",
                defaultValue: DEFAULT_LINES.thickness,
                min: 0,
                max: 10,
                step: 0.1,
            },
            bend: {
                type: ControlType.Number,
                title: "Bend",
                description: "How far lines bow and wobble as the shape loosens.",
                defaultValue: DEFAULT_LINES.bend,
                min: 0,
                max: 10,
                step: 0.1,
            },
            inner: {
                type: ControlType.Number,
                title: "Inner Lines",
                description: "Brightness of the internal lines against the outer edges.",
                defaultValue: DEFAULT_LINES.inner,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },
    band: {
        type: ControlType.Object,
        title: "Band",
        description: "The magenta particle band orbiting the middle.",
        defaultValue: DEFAULT_BAND,
        controls: {
            amount: {
                type: ControlType.Number,
                title: "Amount",
                description: "Density of the band. 0 removes it.",
                defaultValue: DEFAULT_BAND.amount,
                min: 0,
                max: 10,
                step: 0.1,
            },
            radius: {
                type: ControlType.Number,
                title: "Radius",
                description: "How far the band sits from the object.",
                defaultValue: DEFAULT_BAND.radius,
                min: 0,
                max: 10,
                step: 0.1,
            },
            wave: {
                type: ControlType.Number,
                title: "Wave",
                description: "How much the band rises and falls around its orbit.",
                defaultValue: DEFAULT_BAND.wave,
                min: 0,
                max: 10,
                step: 0.1,
            },
            speed: {
                type: ControlType.Number,
                title: "Speed",
                description: "How fast the band circulates.",
                defaultValue: DEFAULT_BAND.speed,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },
    glow: {
        type: ControlType.Object,
        title: "Glow",
        description: "Bloom on the cores, the red haze around the object, and the size of the nodes.",
        defaultValue: DEFAULT_GLOW,
        controls: {
            bloom: {
                type: ControlType.Number,
                title: "Bloom",
                description: "Bloom on the bright cores.",
                defaultValue: DEFAULT_GLOW.bloom,
                min: 0,
                max: 10,
                step: 0.1,
            },
            atmosphere: {
                type: ControlType.Number,
                title: "Atmosphere",
                description: "The deep red haze around the object, breathing with its heat.",
                defaultValue: DEFAULT_GLOW.atmosphere,
                min: 0,
                max: 10,
                step: 0.1,
            },
            nodes: {
                type: ControlType.Number,
                title: "Nodes",
                description: "Size of the anchor node cores and halos.",
                defaultValue: DEFAULT_GLOW.nodes,
                min: 0,
                max: 10,
                step: 0.1,
            },
        },
    },
    seed: {
        type: ControlType.Number,
        title: "Seed",
        description: "Reseeds the interior junctions, the sphere's anchors and where every point lives.",
        defaultValue: DEFAULTS.seed,
        min: 0,
        max: 999,
        step: 1,
        displayStepper: true,
    },
})
