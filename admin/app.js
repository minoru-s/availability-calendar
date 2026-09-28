const app = document.getElementById("app");
const PARTS = ["am", "pm", "night"];
const LABELS = { am: "午前", pm: "午後", night: "夜", available: "○ 空き", tentative: "△ 調整中", busy: "× 不可", inherit: "個別指定を解除" };
const MARKS = { available: "○", tentative: "△", busy: "×" };
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
let published, draft, version, publishedAt, canRestore;
let mode = "busy", offset = 0, anchor = null, history = [], busy = false;

const clone = value => JSON.parse(JSON.stringify(value));
const iso = date => date.toISOString().slice(0, 10);
const date = value => new Date(`${value}T00:00:00Z`);
const plus = (value, count) => iso(new Date(date(value).getTime() + count * 86400000));
const today = () => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const field = type => parts.find(part => part.type === type).value;
  return `${field("year")}-${field("month")}-${field("day")}`;
};
const label = value => { const d = date(value); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS[d.getUTCDay()]}）`; };
const allDates = (from, to) => {
  const result = [];
  for (let day = from; day <= to && result.length <= 366; day = plus(day, 1)) result.push(day);
  return result;
};
const validRange = (from, to) => /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from && allDates(from, to).length <= 366;
function status(data, day, part) {
  if (data.overrides[day]?.[part]) return data.overrides[day][part];
  let value = "tentative";
  const weekday = date(day).getUTCDay();
  for (const rule of data.rules) if (day >= rule.from && day <= rule.to && rule.weekdays.includes(weekday) && rule.parts.includes(part)) value = rule.status;
  return value;
}
function diffCount() {
  const days = new Set([...Object.keys(published.overrides), ...Object.keys(draft.overrides), ...Object.keys(published.locations), ...Object.keys(draft.locations)]);
  for (const rule of [...published.rules, ...draft.rules]) for (const day of allDates(rule.from, rule.to)) days.add(day);
  let count = 0;
  for (const day of days) {
    for (const part of PARTS) if (status(draft, day, part) !== status(published, day, part)) count++;
    if ((draft.locations[day] || "") !== (published.locations[day] || "")) count++;
  }
  return count;
}
function message(text, error = false) {
  const el = document.getElementById("message");
  el.textContent = text;
  el.classList.toggle("error", error);
}
function saveUndo() { history.push(clone(draft)); if (history.length > 50) history.shift(); }
function selectedMode() {
  document.querySelectorAll("[data-mode]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}
function updateSummary() {
  const count = diffCount();
  const changed = JSON.stringify(draft) !== JSON.stringify(published);
  document.getElementById("change-count").textContent = changed ? `${count}枠変更中${count === 0 ? "（設定を更新）" : ""}` : "変更なし";
  document.getElementById("publish").disabled = busy || !changed;
  document.getElementById("undo").disabled = busy || history.length === 0;
  document.getElementById("discard").disabled = busy || !changed;
  document.getElementById("restore").disabled = busy || !canRestore || changed;
}
function renderDays() {
  const start = plus(anchor || today(), offset * 28), end = plus(start, 55);
  document.getElementById("visible-range").textContent = `${label(start)}〜${label(end)}`;
  const list = document.getElementById("days");
  list.replaceChildren();
  let lastMonth = "";
  for (const day of allDates(start, end)) {
    const month = day.slice(0, 7);
    if (month !== lastMonth) {
      const heading = document.createElement("h2");
      heading.textContent = `${date(day).getUTCFullYear()}年 ${date(day).getUTCMonth() + 1}月`;
      list.append(heading); lastMonth = month;
    }
    const row = document.createElement("div");
    row.className = "day";
    const title = document.createElement("div");
    title.className = "date";
    title.textContent = label(day);
    if (day === today()) title.classList.add("is-today");
    row.append(title);
    const slots = document.createElement("div"); slots.className = "slots";
    for (const part of PARTS) {
      const value = status(draft, day, part), button = document.createElement("button");
      button.type = "button"; button.className = `slot ${value}`; button.dataset.day = day; button.dataset.part = part;
      button.setAttribute("aria-label", `${label(day)} ${LABELS[part]}：${LABELS[value]}。押すと${LABELS[mode]}に変更`);
      const partText = document.createElement("span"); partText.textContent = LABELS[part];
      const mark = document.createElement("strong"); mark.textContent = MARKS[value];
      button.append(partText, mark);
      slots.append(button);
    }
    row.append(slots);
    if (draft.locations[day]) {
      const place = document.createElement("span"); place.className = "place";
      place.textContent = draft.locations[day]; row.append(place);
    }
    list.append(row);
  }
  updateSummary();
}
function render() {
  app.innerHTML = `<header><div><p class="owner">Saito Minoru</p><h1>空き状況を編集</h1><p class="sub">公開中：<span id="published-at"></span></p></div><div class="header-links"><a href="https://minoru-s.github.io/availability-calendar/" target="_blank" rel="noopener">公開ページ ↗</a><button type="button" id="logout">ログアウト</button></div></header>
    <div class="editor-bar"><div class="modes" role="group" aria-label="入力する記号"><button type="button" data-mode="available">○ 空き</button><button type="button" data-mode="tentative">△ 調整中</button><button type="button" data-mode="busy">× 不可</button><button type="button" data-mode="inherit">指定解除</button></div><div class="actions"><span id="change-count"></span><button id="undo" type="button">元に戻す</button><button id="discard" type="button">破棄</button><button id="publish" type="button" class="primary">公開する</button></div></div>
    <p id="message" role="status" aria-live="polite"></p>
    <nav class="range-nav" aria-label="表示期間"><button type="button" id="prev">← 前の4週間</button><span id="visible-range"></span><label>年月へ移動 <input type="month" id="jump-month" aria-label="表示する年月"></label><button type="button" id="current">今日から8週間</button><button type="button" id="next">次の4週間 →</button></nav>
    <details class="tools"><summary>まとめて変更</summary><form id="batch"><div class="fields"><label>開始日<input type="date" name="from" required></label><label>終了日<input type="date" name="to" required></label><fieldset><legend>曜日</legend><div class="checks" id="weekdays"></div></fieldset><fieldset><legend>時間帯</legend><div class="checks" id="parts"></div></fieldset><label class="check"><input type="checkbox" name="overwrite">個別指定も上書き</label></div><button type="submit">対象を確認して適用</button></form></details>
    <details class="tools"><summary>滞在場所</summary><p>入力した地名は公開ページに表示されます。空欄で適用すると削除します。</p><form id="location"><div class="fields"><label>開始日<input type="date" name="from" required></label><label>終了日<input type="date" name="to" required></label><label>地名<input name="label" maxlength="40" placeholder="例：三重"></label></div><button type="submit">対象を確認して適用</button></form></details>
    <section class="calendar" id="days" aria-label="空き状況を編集"></section>
    <section class="tools"><h2>直前の公開内容</h2><button type="button" id="restore">復元する</button></section>`;
  document.getElementById("published-at").textContent = publishedAt ? new Date(publishedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "移行した既存データ（未更新）";
  for (let i = 0; i < 7; i++) document.getElementById("weekdays").insertAdjacentHTML("beforeend", `<label><input type="checkbox" name="weekday" value="${i}" ${i > 0 && i < 6 ? "checked" : ""}>${WEEKDAYS[i]}</label>`);
  for (const part of PARTS) document.getElementById("parts").insertAdjacentHTML("beforeend", `<label><input type="checkbox" name="part" value="${part}" checked>${LABELS[part]}</label>`);
  for (const id of ["batch", "location"]) {
    const form = document.getElementById(id); form.elements.from.value = today(); form.elements.to.value = today();
  }
  selectedMode(); renderDays();
}
async function load() {
  const response = await fetch("/api/admin/state", { cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 403 ? "ログインを確認してください" : "公開内容を読み込めませんでした");
  const state = await response.json();
  published = state.data; draft = clone(published); version = state.version; publishedAt = state.publishedAt; canRestore = state.canRestore; history = [];
  render();
}
app.addEventListener("click", async event => {
  const button = event.target.closest("button"); if (!button || busy) return;
  if (button.id === "logout") { if (JSON.stringify(draft) !== JSON.stringify(published) && !confirm("未公開の変更を破棄してログアウトしますか？")) return; await fetch("/api/admin/logout", { method: "POST" }); draft = published; location.assign("/admin/login"); return; }
  if (button.dataset.mode) { mode = button.dataset.mode; selectedMode(); renderDays(); return; }
  if (button.classList.contains("slot")) {
    const { day, part } = button.dataset;
    if (mode === "inherit" && !draft.overrides[day]?.[part] || mode !== "inherit" && draft.overrides[day]?.[part] === mode) return;
    saveUndo();
    if (mode === "inherit") {
      delete draft.overrides[day][part];
      if (!Object.keys(draft.overrides[day]).length) delete draft.overrides[day];
    } else { draft.overrides[day] ||= {}; draft.overrides[day][part] = mode; }
    renderDays();
    document.querySelector(`.slot[data-day="${day}"][data-part="${part}"]`)?.focus({ preventScroll: true });
    message(`${label(day)} ${LABELS[part]}を${LABELS[mode]}に変更しました（未公開）`); return;
  }
  if (button.id === "prev" || button.id === "next" || button.id === "current") { if (button.id === "current") { offset = 0; anchor = null; } else offset += button.id === "prev" ? -1 : 1; renderDays(); return; }
  if (button.id === "undo") { draft = history.pop(); renderDays(); message("直前の操作を取り消しました"); return; }
  if (button.id === "discard") { if (confirm("未公開の変更を破棄しますか？")) { draft = clone(published); history = []; renderDays(); message("変更を破棄しました"); } return; }
  if (button.id === "publish") {
    const count = diffCount(); if (JSON.stringify(draft) === JSON.stringify(published) || !confirm(`${count}枠の表示と設定の変更を公開しますか？`)) return;
    busy = true; updateSummary(); message("公開しています…");
    try {
      const response = await fetch("/api/admin/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version, data: draft }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await load(); message("公開しました。公開ページを再読み込みすると反映されます。");
    } catch (error) { message(error.message || "公開に失敗しました", true); }
    finally { busy = false; updateSummary(); } return;
  }
  if (button.id === "restore") {
    let preview;
    try { const response = await fetch("/api/admin/restore-preview", { cache: "no-store" }); preview = await response.json(); if (!response.ok) throw new Error(preview.error); }
    catch (error) { message(error.message || "差分を確認できませんでした", true); return; }
    if (preview.version !== version) { message("別の画面で更新されています。再読み込みしてください", true); return; }
    if (!confirm(`直前の公開内容へ戻しますか？ ${preview.changeCount}枠が変わります。現在の公開内容は次の復元候補として保持されます。`)) return;
    busy = true; updateSummary();
    try {
      const response = await fetch("/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await load(); message("直前の公開内容を復元しました");
    } catch (error) { message(error.message || "復元に失敗しました", true); }
    finally { busy = false; updateSummary(); }
  }
});
app.addEventListener("change", event => {
  if (event.target.id === "jump-month" && /^\d{4}-\d{2}$/.test(event.target.value)) { anchor = event.target.value + "-01"; offset = 0; renderDays(); }
});
app.addEventListener("submit", event => {
  event.preventDefault(); if (busy) return;
  const form = event.target, values = new FormData(form), from = values.get("from"), to = values.get("to");
  if (!validRange(from, to)) { message("開始日・終了日を366日以内で指定してください", true); return; }
  const days = allDates(from, to);
  if (form.id === "batch") {
    const weekdays = values.getAll("weekday").map(Number), parts = values.getAll("part"), overwrite = values.has("overwrite");
    if (!weekdays.length || !parts.length) { message("曜日と時間帯を選んでください", true); return; }
    const target = days.filter(day => weekdays.includes(date(day).getUTCDay()));
    const skipped = target.reduce((n, day) => n + parts.filter(part => draft.overrides[day]?.[part]).length, 0);
    if (!target.length || !confirm(`${target.length}日・${parts.length}時間帯を${LABELS[mode]}にします。${overwrite ? "個別指定も上書きします。" : `${skipped}件の個別指定は保持します。`}`)) return;
    saveUndo(); draft.rules.push({ from, to, weekdays, parts, status: mode });
    if (overwrite) for (const day of target) for (const part of parts) if (draft.overrides[day]) { delete draft.overrides[day][part]; if (!Object.keys(draft.overrides[day]).length) delete draft.overrides[day]; }
    renderDays(); message("一括設定を適用しました（未公開）");
  }
  if (form.id === "location") {
    const place = String(values.get("label") || "").trim();
    if (place.length > 40 || !confirm(`${days.length}日間の滞在場所を${place ? `「${place}」に設定` : "削除"}しますか？`)) return;
    saveUndo(); for (const day of days) if (place) draft.locations[day] = place; else delete draft.locations[day];
    renderDays(); message("滞在場所を変更しました（未公開）");
  }
});
window.addEventListener("beforeunload", event => { if (draft && published && JSON.stringify(draft) !== JSON.stringify(published)) { event.preventDefault(); event.returnValue = ""; } });
load().catch(error => { app.innerHTML = `<p class="fatal">${error.message}</p>`; });
