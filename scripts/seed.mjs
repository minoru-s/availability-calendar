import { readFile, writeFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const root = new URL("../", import.meta.url);
const text = await readFile(new URL("data.js", root), "utf8");
const context = { window: {} };
runInNewContext(text, context);
const old = context.window.availabilityData;
const overrides = {};
const parts = ["am", "pm", "night"];
const day = new Date(`${old.start}T00:00:00Z`);
while (day.toISOString().slice(0, 10) <= old.end) {
  const iso = day.toISOString().slice(0, 10), weekday = day.getUTCDay();
  overrides[iso] = {};
  for (const part of parts) {
    const rule = old.rules.find(item => iso >= item.from && iso <= item.to && item.weekdays.includes(weekday) && item.parts.includes(part));
    overrides[iso][part] = old.slots[iso]?.[part] || rule?.status || "available";
  }
  day.setUTCDate(day.getUTCDate() + 1);
}
const value = JSON.stringify({ rules: [], overrides, locations: {} }).replaceAll("'", "''");
await writeFile(new URL("worker/seed.sql", root), `INSERT INTO calendar (id,version,data,legacy_checked_at) VALUES (1,1,'${value}','${old.checkedAt}') ON CONFLICT(id) DO NOTHING;\n`);
console.log(`Seeded ${Object.keys(overrides).length} days (${Object.keys(overrides).length * 3} slots).`);
