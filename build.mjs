import { mkdir, readFile, writeFile } from "node:fs/promises";

const entries = [
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/style.css", "style.css", "text/css; charset=utf-8"],
  ["/app.js", "app.js", "text/javascript; charset=utf-8"],
];
const assets = Object.fromEntries(await Promise.all(entries.map(async ([path, file, type]) =>
  [path, [type, await readFile(new URL("./web/" + file, import.meta.url), "utf8")]],
)));
assets["/qrcode.js"] = ["text/javascript; charset=utf-8",
  await readFile(new URL(import.meta.resolve("qrcode-generator")), "utf8")];
const inter = "@fontsource-variable/inter";
const font = await readFile(new URL(import.meta.resolve(inter + "/files/inter-latin-wght-normal.woff2")));
assets["/inter.woff2"] = ["font/woff2", font.toString("base64"), "base64"];
assets["/inter-license.txt"] = ["text/plain; charset=utf-8",
  await readFile(new URL(import.meta.resolve(inter + "/LICENSE")), "utf8")];
const worker = await Promise.all(["clipdrop.mjs", "rooms.mjs"].map(file =>
  readFile(new URL("./worker/" + file, import.meta.url), "utf8"),
));
await mkdir(new URL("./dist/server/", import.meta.url), { recursive: true });
await writeFile(new URL("./dist/server/index.js", import.meta.url),
  worker.join("\n") + "\nexport default makeWorker(" + JSON.stringify(assets) + ");\n");
