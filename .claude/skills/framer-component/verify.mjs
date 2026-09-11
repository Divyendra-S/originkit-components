// Renders a component the way the Originkit builder does: its real esbuild
// pipeline (compile-component.ts), its framer shim, props derived by its
// extractPropertyControls, React from globalThis.__compifyGlobals.
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import http from "node:http"
import os from "node:os"

// Usage: node .claude/skills/framer-component/verify.mjs components/X.tsx '{"prop":1}' "[0.5,6]" "[1000,900]" tag
// Screenshots land in $TMPDIR/framer-verify/. Needs originkit-builder installed (pnpm install).
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..")
const BUILDER = path.join(ROOT, "originkit-builder")
const OUT = path.join(os.tmpdir(), "framer-verify")
fs.mkdirSync(OUT, { recursive: true })
const require = createRequire(path.join(BUILDER, "package.json"))
const esbuild = require("esbuild")

const componentPath = path.resolve(process.argv[2] || path.join(ROOT, "components/VortexRing.tsx"))
const overrides = JSON.parse(process.argv[3] || "{}")
const shots = JSON.parse(process.argv[4] || "[0.5, 4, 8, 12, 16]")
const size = JSON.parse(process.argv[5] || "[1000, 900]")
const tag = process.argv[6] || "shot"

// 1. Bundle the builder's compiler for node and run it.
await esbuild.build({
  entryPoints: [path.join(BUILDER, "lib/server/compile-component.ts")],
  bundle: true, platform: "node", format: "esm", packages: "external",
  alias: { "@": BUILDER }, outfile: path.join(BUILDER, ".compify-harness.mjs"), logLevel: "silent",
  absWorkingDir: BUILDER,
})
const { compileComponent } = await import(path.join(BUILDER, ".compify-harness.mjs") + "?t=" + Date.now())
const source = fs.readFileSync(componentPath, "utf8")
const res = await compileComponent({ source, slug: path.basename(componentPath, ".tsx").toLowerCase() })
if (!res.ok) { console.error("COMPILE FAILED\n" + res.error); process.exit(1) }
if (res.warnings.length) console.log("warnings:\n" + res.warnings.join("\n"))
fs.writeFileSync(path.join(OUT, "component.js"), res.code)
console.log("compiled", res.bytes, "bytes")

// 2. Browser runtime: host React + the builder's control extractor.
fs.writeFileSync(path.join(BUILDER, ".compify-runtime-entry.js"), `
import * as React from "react"
import * as ReactDOM from "react-dom"
import * as ReactDOMClient from "react-dom/client"
import * as JSX from "react/jsx-runtime"
import * as FM from "framer-motion"
import { extractPropertyControls } from "${BUILDER}/lib/originkit-shared/extractPropertyControls.ts"
globalThis.__compifyGlobals = { react: React, "react-dom": ReactDOM, "react/jsx-runtime": JSX, "framer-motion": FM }
globalThis.__host = { React, ReactDOMClient, extractPropertyControls }
`)
await esbuild.build({
  entryPoints: [path.join(BUILDER, ".compify-runtime-entry.js")], bundle: true, platform: "browser",
  format: "iife", outfile: path.join(OUT, "runtime.js"), logLevel: "silent", absWorkingDir: BUILDER,
  define: { "process.env.NODE_ENV": '"production"' },
})

fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><html><head><meta charset=utf-8>
<style>html,body{margin:0;background:#222}#root{width:${size[0]}px;height:${size[1]}px}</style></head>
<body><div id="root"></div>
<script src="runtime.js"></script>
<script type="module">
  const mod = await import("./component.js?t=" + Date.now())
  const Comp = mod.default
  const { React, ReactDOMClient, extractPropertyControls } = globalThis.__host
  const controls = extractPropertyControls(Comp.propertyControls)
  const props = {}
  for (const c of controls) props[c.key] = c.default
  Object.assign(props, ${JSON.stringify(overrides)})
  console.log("props", JSON.stringify(props))
  ReactDOMClient.createRoot(document.getElementById("root")).render(React.createElement(Comp, props))
  window.__ready = true
</script></body></html>`)

// 3. Serve and screenshot.
const server = http.createServer((req, res) => {
  const p = path.join(OUT, decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html")
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return }
  const ext = path.extname(p)
  res.writeHead(200, { "content-type": ext === ".js" ? "text/javascript" : "text/html" })
  fs.createReadStream(p).pipe(res)
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const { chromium } = require("playwright-core")
const browser = await chromium.launch({ channel: "chrome", args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"] })
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 })
page.on("console", (m) => console.log("[console." + m.type() + "]", m.text().slice(0, 500)))
page.on("pageerror", (e) => console.log("[pageerror]", e.message))
await page.goto(`http://127.0.0.1:${port}/index.html`)
await page.waitForFunction(() => window.__ready === true)
const t0 = Date.now()
for (const s of shots) {
  const wait = t0 + s * 1000 - Date.now()
  if (wait > 0) await page.waitForTimeout(wait)
  const file = path.join(OUT, `${tag}-${String(s).replace(".", "_")}s.png`)
  await page.screenshot({ path: file })
  console.log("shot", file)
}
await browser.close()
server.close()
fs.rmSync(path.join(BUILDER, ".compify-harness.mjs"), { force: true })
fs.rmSync(path.join(BUILDER, ".compify-runtime-entry.js"), { force: true })
