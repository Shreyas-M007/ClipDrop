import { mkdir, readFile, writeFile } from "node:fs/promises";

const entries = [
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/style.css", "style.css", "text/css; charset=utf-8"],
  ["/app.js", "app.js", "text/javascript; charset=utf-8"],
];
const assets = Object.fromEntries(await Promise.all(entries.map(async ([path, file, type]) =>
  [path, [type, await readFile(new URL("./web/" + file, import.meta.url), "utf8")]],
)));
const worker = await readFile(new URL("./worker/clipdrop.mjs", import.meta.url), "utf8");
await mkdir(new URL("./dist/server/", import.meta.url), { recursive: true });
await writeFile(new URL("./dist/server/index.js", import.meta.url),
  worker + "\nexport default makeWorker(" + JSON.stringify(assets) + ");\n");
