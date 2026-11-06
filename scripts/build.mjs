/**
 * Builds everything into dist/:
 *   dist/server.js        API + static server (all deps bundled: zero runtime npm install)
 *   dist/migrate.js       one-off migrations task
 *   dist/seed-demo.js     demo data for sales demos
 *   dist/migrations/      SQL files
 *   dist/public/          admin SPA, member PWA, hashed assets
 * Usage: node scripts/build.mjs [--watch]
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist");
const pub = path.join(out, "public");
const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(pub, "assets"), { recursive: true });

// static files
for (const f of fs.readdirSync(path.join(root, "web/public"))) {
  if (!f.endsWith(".html")) fs.copyFileSync(path.join(root, "web/public", f), path.join(pub, f));
}
fs.cpSync(path.join(root, "server/db/migrations"), path.join(out, "migrations"), { recursive: true });
// the GMS website (served on "/" to visitors): static HTML, CSS, JS and screenshots
fs.copyFileSync(path.join(root, "web/site/site.html"), path.join(pub, "site.html"));
fs.mkdirSync(path.join(pub, "site"), { recursive: true });
for (const f of ["site.css", "site.js"]) fs.copyFileSync(path.join(root, "web/site", f), path.join(pub, "site", f));
if (fs.existsSync(path.join(root, "web/site/img"))) fs.cpSync(path.join(root, "web/site/img"), path.join(pub, "site/img"), { recursive: true });

const webOptions = {
  entryPoints: {
    admin: path.join(root, "web/admin/main.tsx"),
    member: path.join(root, "web/member/main.tsx"),
    "admin-style": path.join(root, "web/styles/admin-entry.css"),
    "member-style": path.join(root, "web/styles/member-entry.css"),
  },
  bundle: true,
  outdir: path.join(pub, "assets"),
  entryNames: "[name]-[hash]",
  format: "esm",
  splitting: true,
  minify: !dev,
  sourcemap: watch ? "inline" : false,
  target: ["es2021", "safari15"],
  jsx: "automatic",
  metafile: true,
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  logLevel: "info",
};

function writeHtml(meta) {
  const outputs = Object.entries(meta.outputs);
  const find = (entry, ext) => {
    const hit = outputs.find(([file, o]) => o.entryPoint && o.entryPoint.endsWith(entry) && file.endsWith(ext));
    if (!hit) throw new Error(`build output for ${entry} not found`);
    return "/" + path.relative(pub, path.resolve(root, hit[0])).split(path.sep).join("/");
  };
  const page = (tpl, js, css) => fs.writeFileSync(path.join(pub, tpl), fs.readFileSync(path.join(root, "web/public", tpl), "utf8").replace("{{JS}}", js).replace("{{CSS}}", css));
  page("index.html", find("web/admin/main.tsx", ".js"), find("web/styles/admin-entry.css", ".css"));
  page("member.html", find("web/member/main.tsx", ".js"), find("web/styles/member-entry.css", ".css"));
}

const serverOptions = {
  entryPoints: { server: path.join(root, "server/index.ts"), migrate: path.join(root, "scripts/migrate.ts"), "seed-demo": path.join(root, "scripts/seed-demo.ts") },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: out,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
};

if (watch) {
  const webCtx = await esbuild.context({ ...webOptions, plugins: [{ name: "html", setup(b) { b.onEnd((r) => r.metafile && writeHtml(r.metafile)); } }] });
  await webCtx.watch();
  console.log("[build] watching web/ …");
} else {
  const web = await esbuild.build(webOptions);
  writeHtml(web.metafile);
  await esbuild.build(serverOptions);
  const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + " KB";
  console.log(`[build] done: server.js ${size("server.js")}`);
}
