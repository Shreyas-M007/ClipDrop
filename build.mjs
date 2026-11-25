import { mkdir, readFile, writeFile } from "node:fs/promises";

import { build } from "esbuild";

const entries = [
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/style.css", "style.css", "text/css; charset=utf-8"],
  ["/app.js", "app.js", "text/javascript; charset=utf-8"],
  ["/workspace.js", "workspace.js", "text/javascript; charset=utf-8"],
  ["/screens.js", "screens.js", "text/javascript; charset=utf-8"],
];
const assets = Object.fromEntries(await Promise.all(entries.map(async ([path, file, type]) =>
  [path, [type, await readFile(new URL("./web/" + file, import.meta.url), "utf8")]],
)));
const landing = await build({ entryPoints: ["web/landing.tsx"], bundle: true, write: false, minify: true,
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, legalComments: "inline" });
assets["/landing.js"] = ["text/javascript; charset=utf-8", landing.outputFiles[0].text];
assets["/landing.css"] = ["text/css; charset=utf-8", await readFile(new URL("./dist/landing.css", import.meta.url), "utf8")];
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
const worker = await Promise.all(["clipdrop.mjs", "rooms.mjs", "workspace.mjs"].map(file =>
  readFile(new URL("./worker/" + file, import.meta.url), "utf8"),
));
await mkdir(new URL("./dist/server/", import.meta.url), { recursive: true });
const backend = await build({
  stdin: { contents: worker.join("\n") + "\nexport default makeWorker(" + JSON.stringify(assets) + ");\n",
    resolveDir: process.cwd(), sourcefile: "clipdrop-worker.mjs" },
  bundle: true, write: false, format: "esm", minify: true, legalComments: "inline",
});
await writeFile(new URL("./dist/server/index.js", import.meta.url), backend.outputFiles[0].contents);
