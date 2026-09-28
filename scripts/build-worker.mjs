import { readFile, writeFile, mkdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
let source = await readFile(new URL("worker/index.js", root), "utf8");
for (const [token, file] of [["__ADMIN_JS__", "admin/app.js"], ["__ADMIN_CSS__", "admin/styles.css"]]) {
  source = source.replace(token, JSON.stringify(await readFile(new URL(file, root), "utf8")));
}
await mkdir(new URL("worker/dist/", root), { recursive: true });
await writeFile(new URL("worker/dist/index.js", root), source);
