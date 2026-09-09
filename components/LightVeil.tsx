import { useEffect, useRef } from "react"
import type { CSSProperties } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"

/**
 * LightVeil
 *
 * A dark ambient light field: blurred vertical columns of emerald and teal
 * breathing behind frosted glass, with muted red and amber glows surfacing
 * underneath them, cycling between full colour and drained grayscale.
 *
 * Everything is one full-screen fragment shader on a raw WebGL context — no
 * three.js, no post-processing package, no textures. The multi-tier softness
 * (narrow core, diffused body, wide halo), the frosted striation and the
 * grayscale drain are all done in the same pass.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Shader loop ceilings. The uniform counts break out early below these. */
const MAX_COOL_COLUMNS = 24
const MAX_WARM_COLUMNS = 18

const DEFAULT_BACKGROUND = "#03080B"
const DEFAULT_COOL_A = "#1BE087"
const DEFAULT_COOL_B = "#0A6B60"
const DEFAULT_WARM_A = "#C2264F"
const DEFAULT_WARM_B = "#E08A2A"

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
    uniform float u_haze;
    uniform float u_falloff;
    uniform float u_vignette;
    uniform float u_grain;
    uniform float u_coolCount;
    uniform float u_warmCount;
    uniform float u_warmAmount;
    uniform float u_seed;
    uniform vec3 u_background;
    uniform vec3 u_coolA;
    uniform vec3 u_coolB;
    uniform vec3 u_warmA;
    uniform vec3 u_warmB;

    ${NOISE_GLSL}

    void main() {
        float x = v_uv.x;
        // v runs 0 at the top edge to 1 at the bottom — the light hangs downwards.
        float v = 1.0 - v_uv.y;

        // The whole field leans and wobbles, as if seen through moving glass.
        float warp = fbm(vec2(x * 3.1 + u_seed, v * 0.85 + u_time * 0.02)) - 0.5;
        float sx = x + warp * 0.07 * u_softness;

        vec3 glow = vec3(0.0);

        // ── Cool columns: top-anchored emerald and teal shafts ───────────────
        for (int i = 0; i < ${MAX_COOL_COLUMNS}; i++) {
            float fi = float(i);
            if (fi >= u_coolCount) break;

            float r1 = hash11(fi * 1.73 + u_seed);
            float r2 = hash11(fi * 3.31 + u_seed + 17.0);
            float r3 = hash11(fi * 5.17 + u_seed + 41.0);
            float r4 = hash11(fi * 7.93 + u_seed + 73.0);
            float r5 = hash11(fi * 9.37 + u_seed + 101.0);

            // Jittered well past the even spacing, so columns cluster and leave gaps.
            float cx = (fi + 0.5) / u_coolCount + (r1 - 0.5) * 1.7 / u_coolCount;
            cx += sin(u_time * (0.05 + r2 * 0.08) + r3 * 6.2832) * 0.045 * u_drift;

            float girth = pow(r2, 1.8);
            float w = (0.010 + 0.055 * girth) * u_softness;
            w *= 1.0 + 0.45 * u_breath * sin(u_time * (0.10 + r4 * 0.15) + r5 * 6.2832);

            // Most columns hang from the top edge; a few pick up further down.
            float start = 0.24 * r1 * r1;

            // How far down the frame this column survives before dissolving.
            float reach = start + 0.35 + r3 * 0.70;
            reach *= 1.0 + 0.16 * u_breath * sin(u_time * (0.08 + r1 * 0.12) + r2 * 6.2832);

            // Where the bright core sits inside the column.
            float head = start + 0.03 + r4 * 0.26;
            head += 0.09 * u_breath * sin(u_time * (0.12 + r5 * 0.14) + r3 * 6.2832);

            // Weighted, so most columns stay dim and only a handful truly burn.
            float amp = 0.08 + 1.65 * pow(r5, 2.8);
            // Thin shafts carry less light than broad ones, or they read as hard lines.
            amp *= mix(0.55, 1.15, girth);
            amp *= 1.0 + 0.45 * u_breath * sin(u_time * (0.13 + r2 * 0.18) + r4 * 6.2832);
            amp = max(amp, 0.0);

            float vprof = smoothstep(start - 0.26, start + 0.07, v) * (1.0 - smoothstep(reach * 0.34, reach, v));

            // Wide and hazy up top, tapering into a thinner streak on the way down.
            float vt = clamp((v - start) / max(reach - start, 0.001), 0.0, 1.0);
            float wv = max(w * mix(1.15, 0.70, vt * vt), 0.002);

            float d = (sx - cx) / wv;
            // Brightness rises and falls along the column instead of running flat.
            float lv = 0.62 + 0.38 * sin(v * (7.0 + r2 * 9.0) + r3 * 6.2832 + u_time * 0.35 * u_breath);
            float body = (gauss(d) * 0.32 + gauss(d * 0.50) * 0.07) * lv;
            float hv = (v - head) / (0.07 + r1 * 0.15);
            float core = (gauss(d * 1.3) * 0.65 + gauss(d * 2.8) * 0.50) * gauss(hv);

            // Emerald is the norm; teal is what the dimmer columns fall back to.
            vec3 hue = mix(u_coolA, u_coolB, pow(r4, 1.9) * 0.92);
            glow += hue * body * vprof * amp;
            // Cores bloom towards white-green without ever reading as a beam.
            glow += mix(hue, vec3(1.0), 0.16) * core * vprof * amp * 3.1;
        }

        // ── Warm columns: dim reds and ambers under the greens ───────────────
        for (int i = 0; i < ${MAX_WARM_COLUMNS}; i++) {
            float fi = float(i);
            if (fi >= u_warmCount) break;

            float r1 = hash11(fi * 2.11 + u_seed + 211.0);
            float r2 = hash11(fi * 4.27 + u_seed + 233.0);
            float r3 = hash11(fi * 6.53 + u_seed + 257.0);
            float r4 = hash11(fi * 8.71 + u_seed + 283.0);

            float cx = (fi + 0.5) / u_warmCount + (r1 - 0.5) / u_warmCount;
            cx += sin(u_time * (0.04 + r2 * 0.07) + r3 * 6.2832) * 0.035 * u_drift;

            float w = (0.006 + 0.030 * pow(r2, 1.7)) * u_softness;
            w *= 1.0 + 0.40 * u_breath * sin(u_time * (0.09 + r3 * 0.13) + r1 * 6.2832);

            // These live as a band across the lower middle, never the full height.
            float cy = 0.46 + r3 * 0.26;
            cy += 0.05 * u_breath * sin(u_time * (0.11 + r4 * 0.12) + r2 * 6.2832);
            float ry = 0.09 + r4 * 0.15;

            float amp = (0.26 + 1.25 * pow(r4, 1.4)) * u_warmAmount;
            amp *= 1.0 + 0.50 * u_breath * sin(u_time * (0.14 + r1 * 0.16) + r3 * 6.2832);
            amp = max(amp, 0.0);

            float d = (sx - cx) / max(w, 0.002);
            float dv = (v - cy) / ry;

            // Crimson on the left drifting to amber on the right.
            vec3 hue = mix(u_warmA, u_warmB, smoothstep(0.30, 0.95, cx));
            glow += hue * (gauss(d) * 0.50 + gauss(d * 0.60) * 0.07) * gauss(dv) * amp;
        }

        // Frosted striation — stretched hard in y so it smears rather than speckles.
        // A broad scale shapes the clouds, a fine one adds the thin vertical streaks.
        float striation = fbm(vec2(sx * 5.5 + u_seed, v * 1.2 - u_time * 0.025));
        float detail = fbm(vec2(sx * 30.0 + u_seed, v * 2.6 - u_time * 0.018));
        glow *= mix(1.0, (0.45 + 0.95 * striation) * (0.90 + 0.20 * detail), u_haze);

        // The lower third stays dark; nothing lands on a surface.
        float depth = mix(1.0, 1.0 - smoothstep(0.55, 1.10, v), u_falloff);
        glow *= depth;

        // A breath of fog so the gaps read as atmosphere, not void.
        float fog = fbm(vec2(sx * 4.2 - u_time * 0.012, v * 1.05 + u_seed + 9.0));
        glow += u_coolB * fog * u_haze * 0.014 * depth;

        // Drain the hue, keep the light.
        float lum = dot(glow, vec3(0.2126, 0.7152, 0.0722));
        glow = mix(glow, vec3(lum * u_monoLift), u_mono);

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
    "u_haze",
    "u_falloff",
    "u_vignette",
    "u_grain",
    "u_coolCount",
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
    const n = typeof value === "number" ? value : Number(value)
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
    coolCount: number
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
        setFloat("u_haze", params.haze)
        setFloat("u_falloff", params.falloff)
        setFloat("u_vignette", params.vignette)
        setFloat("u_grain", params.grain)
        setFloat("u_coolCount", Math.max(params.coolCount, 1))
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
    breath: number
    drift: number
    animateOnCanvas: boolean
    // Colour
    colorMode: "cycle" | "color" | "mono"
    cyclePeriod: number
    cycleFade: number
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
        coolCount = 15,
        warmCount = 9,
        warmAmount = 1,
        softness = 1,
        haze = 0.55,
        falloff = 0.8,
        intensity = 1,
        seed = 37,
        speed = 1,
        breath = 1,
        drift = 1,
        animateOnCanvas = false,
        colorMode = "cycle",
        cyclePeriod = 16,
        cycleFade = 2.4,
        monoLift = 1.45,
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

    const isStatic = useIsStaticRenderer()
    const animate = !isStatic || animateOnCanvas

    const containerRef = useRef<HTMLDivElement>(null)
    const experienceRef = useRef<Experience | null>(null)

    const params: SceneParams = {
        coolCount: Math.round(clamp(coolCount, 1, MAX_COOL_COLUMNS)),
        warmCount: Math.round(clamp(warmCount, 0, MAX_WARM_COLUMNS)),
        warmAmount,
        softness,
        haze,
        falloff,
        intensity,
        seed,
        speed,
        breath,
        drift,
        colorMode,
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
        coolCount,
        warmCount,
        warmAmount,
        softness,
        haze,
        falloff,
        intensity,
        seed,
        speed,
        breath,
        drift,
        colorMode,
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
    // Kept deliberately small. Every other knob the shader supports still exists
    // as a prop with a default — see the destructuring in LightVeil — it just
    // isn't worth a row in the panel.
    //
    // `colorMode` is the only Enum, and its options are strings on purpose: an
    // Enum whose options are numbers loses them outside Framer (option lists are
    // read as strings), and the component then receives "" where it expected a
    // number. That is how `Quality` once produced a 1x1 canvas.

    // ── Composition ────────────────────────────────────────────────
    coolCount: {
        type: ControlType.Number,
        title: "Columns",
        description: "How many cool light shafts hang from the top edge.",
        defaultValue: 15,
        min: 1,
        max: MAX_COOL_COLUMNS,
        step: 1,
        displayStepper: true,
    },
    warmCount: {
        type: ControlType.Number,
        title: "Warm Lights",
        description: "How many dim warm glows surface underneath the cool columns.",
        defaultValue: 9,
        min: 0,
        max: MAX_WARM_COLUMNS,
        step: 1,
        displayStepper: true,
    },
    softness: {
        type: ControlType.Number,
        title: "Softness",
        description: "How far each light diffuses. Low is a sharp shaft, high is a wide haze.",
        defaultValue: 1,
        min: 0.4,
        max: 2.5,
        step: 0.05,
    },
    intensity: {
        type: ControlType.Number,
        title: "Brightness",
        description: "Overall strength of the light field.",
        defaultValue: 1,
        min: 0,
        max: 2.5,
        step: 0.05,
    },
    seed: {
        type: ControlType.Number,
        title: "Seed",
        description: "Reshuffles the column positions and widths. Any value is a different arrangement.",
        defaultValue: 37,
        min: 0,
        max: 100,
        step: 1,
        displayStepper: true,
    },

    // ── Animation ──────────────────────────────────────────────────
    speed: {
        type: ControlType.Number,
        title: "Speed",
        description: "How fast the whole field breathes and drifts.",
        defaultValue: 1,
        min: 0,
        max: 3,
        step: 0.05,
    },
    animateOnCanvas: {
        type: ControlType.Boolean,
        title: "On Canvas",
        description: "Keep animating on the Framer canvas instead of rendering one static frame.",
        defaultValue: false,
        enabledTitle: "Animate",
        disabledTitle: "Static",
    },

    // ── Colour ─────────────────────────────────────────────────────
    colorMode: {
        type: ControlType.Enum,
        title: "Mode",
        description: "Cycle drains to grayscale and back; Colour and Mono hold one look.",
        defaultValue: "cycle",
        options: ["cycle", "color", "mono"],
        optionTitles: ["Cycle", "Colour", "Mono"],
        displaySegmentedControl: true,
    },
    background: {
        type: ControlType.Color,
        title: "Background",
        description: "The dark ground the lights sit on.",
        defaultValue: DEFAULT_BACKGROUND,
    },
    coolA: {
        type: ControlType.Color,
        title: "Light A",
        description: "The first cool colour the columns are drawn from.",
        defaultValue: DEFAULT_COOL_A,
    },
    coolB: {
        type: ControlType.Color,
        title: "Light B",
        description: "The second cool colour. Columns mix between A and B.",
        defaultValue: DEFAULT_COOL_B,
    },
    warmA: {
        type: ControlType.Color,
        title: "Warm",
        description: "The colour of the warm glows underneath.",
        defaultValue: DEFAULT_WARM_A,
        hidden: (props: LightVeilProps) => props.warmCount === 0,
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
