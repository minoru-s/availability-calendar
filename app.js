(() => {
  "use strict";
  const data = window.availabilityData;
  const parts = ["am", "pm", "night"];
  const partLabels = { am: "午前", pm: "午後", night: "夜" };
  const statusLabels = { available: "空き", tentative: "調整中", busy: "予定あり" };
  const marks = { available: "○", tentative: "△", busy: "×" };
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const selected = new Set();
  const months = document.getElementById("months");
  const selectionBar = document.getElementById("selection-bar");
  const count = document.getElementById("selection-count");
  const announcement = document.getElementById("announcement");

  function dateOf(iso) { return new Date(iso + "T12:00:00Z"); }
  function isoOf(date) { return date.toISOString().slice(0, 10); }
  function labelOf(iso) {
    const d = dateOf(iso);
    return (d.getUTCMonth() + 1) + "月" + d.getUTCDate() + "日（" + weekdays[d.getUTCDay()] + "）";
  }
  function statusOf(iso, part) {
    const override = data.slots[iso]?.[part];
    if (override) return override;
    const weekday = dateOf(iso).getUTCDay();
    const rule = data.rules?.find(item => iso >= item.from && iso <= item.to && item.weekdays.includes(weekday) && item.parts.includes(part));
    return rule?.status ?? "available";
  }
  function slot(iso, part) {
    const status = statusOf(iso, part);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slot " + status;
    button.dataset.key = iso + ":" + part;
    button.setAttribute("aria-label", labelOf(iso) + " " + partLabels[part] + "：" + statusLabels[status]);
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = '<span class="slot-label">' + partLabels[part] + '</span><span class="slot-mark" aria-hidden="true">' + marks[status] + "</span>";
    if (status === "busy") button.disabled = true;
    else button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (selected.has(key)) selected.delete(key); else selected.add(key);
      button.classList.toggle("selected", selected.has(key));
      button.setAttribute("aria-pressed", String(selected.has(key)));
      updateSelection();
    });
    return button;
  }
  function day(iso) {
    const d = dateOf(iso);
    const weekday = d.getUTCDay();
    const card = document.createElement("article");
    card.className = "day-card" + (weekday === 0 ? " sunday" : weekday === 6 ? " saturday" : "");
    const heading = document.createElement("div");
    heading.className = "day-heading";
    heading.innerHTML = '<span class="day-number">' + d.getUTCDate() + '</span><span class="day-weekday">' + weekdays[weekday] + "曜日</span>";
    card.append(heading);
    const slots = document.createElement("div");
    slots.className = "day-slots";
    parts.forEach(part => slots.append(slot(iso, part)));
    card.append(slots);
    return card;
  }
  function renderMonth(year, month, dates) {
    const section = document.createElement("section");
    section.className = "month-section";
    section.setAttribute("aria-label", year + "年" + month + "月");
    section.innerHTML = '<div class="month-heading"><h3>' + year + '<span>' + String(month).padStart(2, "0") + '</span></h3><span>' + month + "月 / " + dates.length + "日間</span></div>";
    const grid = document.createElement("div");
    grid.className = "month-grid";
    weekdays.forEach(w => {
      const label = document.createElement("div");
      label.className = "weekday-header";
      label.textContent = w;
      grid.append(label);
    });
    for (let i = 0; i < dateOf(dates[0]).getUTCDay(); i++) {
      const blank = document.createElement("div");
      blank.className = "blank-day";
      blank.setAttribute("aria-hidden", "true");
      grid.append(blank);
    }
    dates.forEach(iso => grid.append(day(iso)));
    section.append(grid);
    return section;
  }
  function updateSelection() {
    selectionBar.hidden = selected.size === 0;
    count.textContent = selected.size + "件選択中";
    document.body.classList.toggle("has-selection", selected.size > 0);
  }
  function fallbackCopy(value) {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.cssText = "position:fixed;opacity:0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
  async function copySelection() {
    const lines = [...selected].sort().map(key => {
      const [iso, part] = key.split(":");
      return "・" + labelOf(iso) + " " + partLabels[part] + (statusOf(iso, part) === "tentative" ? "（調整中）" : "");
    });
    const value = "日程の候補です。\n" + lines.join("\n") + "\n\n最終的な日程はご連絡のうえ決められればと思います。";
    let ok = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); ok = true; } else ok = fallbackCopy(value); }
    catch (_) { ok = fallbackCopy(value); }
    announcement.textContent = ok ? "候補をコピーしました" : "コピーできませんでした";
    const button = document.getElementById("copy-selection");
    if (ok) {
      button.firstChild.textContent = "コピーしました ";
      setTimeout(() => { button.firstChild.textContent = "候補をコピー "; }, 2200);
    }
  }

  const grouped = new Map();
  const cursor = dateOf(data.start);
  const end = dateOf(data.end);
  while (cursor <= end) {
    const iso = isoOf(cursor);
    const key = cursor.getUTCFullYear() + "-" + (cursor.getUTCMonth() + 1);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  grouped.forEach((dates, key) => {
    const [year, month] = key.split("-").map(Number);
    months.append(renderMonth(year, month, dates));
  });
  document.getElementById("range-label").textContent = labelOf(data.start) + " — " + labelOf(data.end);
  document.getElementById("updated-at").textContent = (data.reviewed ? "最終更新 " : "資料確認 ") + labelOf(data.checkedAt);
  document.getElementById("review-notice").hidden = data.reviewed;
  document.getElementById("clear-selection").addEventListener("click", () => {
    selected.clear();
    document.querySelectorAll(".slot.selected").forEach(button => {
      button.classList.remove("selected");
      button.setAttribute("aria-pressed", "false");
    });
    updateSelection();
  });
  document.getElementById("copy-selection").addEventListener("click", copySelection);
})();
