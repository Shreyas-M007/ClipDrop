import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const entries = [
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/clipdrop-mark.svg", "clipdrop-mark.svg", "image/svg+xml"],
  ["/style.css", "style.css", "text/css; charset=utf-8"],
  ["/app.js", "app.js", "text/javascript; charset=utf-8"],
  ["/theme.js", "theme.js", "text/javascript; charset=utf-8"],
  ["/drop.js", "drop.js", "text/javascript; charset=utf-8"],
];
const assets = Object.fromEntries(await Promise.all(entries.map(async ([path, file, type]) =>
  [path, [type, await readFile(new URL("./web/" + file, import.meta.url), "utf8")]],
)));
const landingRenderer = new URL("./dist/landing-render.mjs", import.meta.url);
await build({ entryPoints: ["web/landing-render.tsx"], platform: "node", external: ["react", "react-dom"], bundle: true, loader: { ".html": "text" },
  jsx: "automatic", format: "esm", outfile: fileURLToPath(landingRenderer) });
const { renderLanding } = await import(landingRenderer.href);
assets["/"][1] = assets["/"][1].replace("<!-- TAPE_LANDING -->", () => renderLanding());
const landingClient = await build({
  entryPoints: ["web/landing-client.tsx"], bundle: true, write: false, minify: true,
  jsx: "automatic", format: "esm", loader: { ".html": "text" }, legalComments: "inline",
  define: { "process.env.NODE_ENV": '"production"' },
});
assets["/motion.js"] = ["text/javascript; charset=utf-8", landingClient.outputFiles[0].text];
assets["/landing.css"] = ["text/css; charset=utf-8", await readFile(new URL("./dist/landing.css", import.meta.url), "utf8")];

async function binaryAsset(path, file, mime) {
  const contents = await readFile(file);
  assets[path] = [mime, contents.toString("base64"), "base64"];
}
const anton = "@fontsource/anton";
const antonFont = "anton-latin-400-normal.woff2";
await binaryAsset("/" + antonFont, new URL(import.meta.resolve(anton + "/files/" + antonFont)), "font/woff2");
assets["/anton-license.txt"] = ["text/plain; charset=utf-8",
  await readFile(new URL(import.meta.resolve(anton + "/LICENSE")), "utf8")];
const kalam = "@fontsource/kalam";
const kalamFont = "kalam-latin-700-normal.woff2";
await binaryAsset("/" + kalamFont, new URL(import.meta.resolve(kalam + "/files/" + kalamFont)), "font/woff2");
assets["/kalam-license.txt"] = ["text/plain; charset=utf-8",
  await readFile(new URL(import.meta.resolve(kalam + "/LICENSE")), "utf8")];
assets["/qrcode.js"] = ["text/javascript; charset=utf-8",
  await readFile(new URL(import.meta.resolve("qrcode-generator")), "utf8")];
const inter = "@fontsource-variable/inter";
const font = await readFile(new URL(import.meta.resolve(inter + "/files/inter-latin-wght-normal.woff2")));
assets["/inter.woff2"] = ["font/woff2", font.toString("base64"), "base64"];
assets["/inter-license.txt"] = ["text/plain; charset=utf-8",
  await readFile(new URL(import.meta.resolve(inter + "/LICENSE")), "utf8")];
const tools = await build({ entryPoints: ["web/tools.js"], bundle: true, write: false, minify: true,
  format: "esm", legalComments: "inline" });
assets["/tools.js"] = ["text/javascript; charset=utf-8", tools.outputFiles[0].text];
const convert = await build({ entryPoints: ["web/convert.js"], bundle: true, write: false, minify: true,
  format: "esm", legalComments: "inline" });
assets["/convert.js"] = ["text/javascript; charset=utf-8", convert.outputFiles[0].text];

const worker = await Promise.all(["clipdrop.mjs", "rooms.mjs", "workspace.mjs"].map(file =>
  readFile(new URL("./worker/" + file, import.meta.url), "utf8"),
));
await mkdir(new URL("./dist/server/", import.meta.url), { recursive: true });
const backend = await build({
  stdin: { contents: worker.join("\n") + "\nexport default makeWorker(" + JSON.stringify(assets) + ");\n",
    resolveDir: process.cwd(), sourcefile: "clipdrop-worker.mjs" },
  bundle: true, write: false, format: "esm", minify: true, legalComments: "inline",
  // Tree-shake dead code aggressively; the worker has no dynamic requires
  treeShaking: true,
});
const workerEntry = new URL("./dist/server/index.js", import.meta.url);
await writeFile(workerEntry, backend.outputFiles[0].contents);

const publicDir = new URL("./public/", import.meta.url);
await mkdir(publicDir, { recursive: true });
await Promise.all(Object.entries(assets).map(([path, [, contents, encoding]]) => {
  const filename = path === "/" ? "index.html" : path.slice(1);
  return writeFile(new URL(filename, publicDir), contents, encoding === "base64" ? "base64" : "utf8");
}));

if (process.argv.includes("--vercel") || process.env.VERCEL === "1") {
  const backendUrl = process.env.CLIPDROP_BACKEND_URL?.trim() || "https://clipdrop-share.bakedmandrill16.chatgpt.site";
  let origin;
  if (backendUrl) {
    const url = new URL(backendUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("CLIPDROP_BACKEND_URL must be an HTTPS origin, such as https://clipdrop.roomdrop.workers.dev.");
    }
    origin = url.origin;
  } else {
    console.warn("CLIPDROP_BACKEND_URL is unset. The page will render, but room operations require a deployed Worker.");
  }

  const { default: app } = await import(workerEntry.href);
  const output = new URL("./.vercel/output/", import.meta.url);
  const staticDir = new URL("static/", output);
  await rm(output, { recursive: true, force: true });
  await cp(publicDir, staticDir, { recursive: true });

  const escaped = path => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headersByPolicy = new Map();
  await Promise.all(Object.keys(assets).map(async path => {
    const response = await app.fetch(new Request("https://clipdrop.invalid" + path, { method: "HEAD" }), {}, {});
    const headers = Object.fromEntries(response.headers);
    delete headers["content-type"];
    const key = JSON.stringify(headers);
    if (!headersByPolicy.has(key)) headersByPolicy.set(key, []);
    headersByPolicy.get(key).push(path);
    if (path === "/") headersByPolicy.get(key).push("/index.html");
  }));
  const routes = [...headersByPolicy].map(([headers, paths]) => ({
    src: "^/(?:" + paths.sort().map(path => escaped(path.slice(1))).join("|") + ")$",
    headers: JSON.parse(headers),
    continue: true,
  }));
  if (origin) routes.unshift({ src: "^/((?:api/.*)|share-target)$", dest: origin + "/$1" });
  routes.push({ src: "^/$", dest: "/index.html" }, { handle: "filesystem" });
  await writeFile(new URL("config.json", output), JSON.stringify({ version: 3, routes }, null, 2) + "\n");
}
