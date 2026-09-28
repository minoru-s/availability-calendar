(() => {
  "use strict";
  const apiBase = window.availabilityApiBase;
  let data = window.availabilityData;
  let apiDays = null;
  let rangeOffset = 0;
  const parts = ["am", "pm", "night"];
  const partLabels = { am: "午前", pm: "午後", night: "夜" };
  const statusLabels = { available: "空き", tentative: "調整中", busy: "予定あり" };
  // Shared geometry avoids font-dependent symbol sizing and baseline offsets.
  const markPaths = {
    available: '<circle cx="12" cy="12" r="9"/>',
    tentative: '<path d="M12 3 22 21H2Z"/>',
    busy: '<path d="m3.5 3.5 17 17m0-17-17 17"/>'
  };
  function markIcon(status) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + markPaths[status] + '</svg>';
  }
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const selected = new Set();
  const selectedStatuses = new Map();
  let loadSequence = 0;
  const months = document.getElementById("months");
  const selectionBar = document.getElementById("selection-bar");
  const count = document.getElementById("selection-count");
  const announcement = document.getElementById("announcement");
  const todayButton = document.getElementById("go-today");
  const toolbar = document.querySelector(".calendar-toolbar");
  const helpButton = document.getElementById("toggle-help");
  const helpPanel = document.getElementById("calendar-help");

  function closeHelp(restoreFocus = false) {
    helpPanel.hidden = true;
    helpButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) helpButton.focus({ preventScroll: true });
  }

  function todayInJapan() {
    const fields = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const value = type => fields.find(field => field.type === type).value;
    return [value("year"), value("month"), value("day")].join("-");
  }

  function refreshToday() {
    const today = todayInJapan();
    let target = null;
    document.querySelectorAll(".day-card").forEach(card => {
      const isToday = card.dataset.date === today;
      card.classList.toggle("is-today", isToday);
      card.querySelector(".today-label").hidden = !isToday;
      if (isToday) {
        card.setAttribute("aria-current", "date");
        target = card;
      } else {
        card.removeAttribute("aria-current");
      }
    });
    todayButton.disabled = !target && !apiBase;
    todayButton.title = labelOf(today) + "へ移動";
    todayButton.setAttribute("aria-label", "今日（" + labelOf(today) + "）へ移動");
    return target;
  }

  async function goToToday() {
    closeHelp();
    let target = refreshToday();
    if (!target && apiBase) { rangeOffset = 0; await loadRange(); target = refreshToday(); }
    if (!target) return;
    const topInset = parseFloat(getComputedStyle(toolbar).top) || 0;
    const offset = toolbar.getBoundingClientRect().height + topInset + 16;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    target.focus({ preventScroll: true });
    window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    announcement.textContent = labelOf(target.dataset.date) + "、今日の空き状況です";
  }

  function dateOf(iso) { return new Date(iso + "T12:00:00Z"); }
  function isoOf(date) { return date.toISOString().slice(0, 10); }
  function labelOf(iso) {
    const d = dateOf(iso);
    return (d.getUTCMonth() + 1) + "月" + d.getUTCDate() + "日（" + weekdays[d.getUTCDay()] + "）";
  }
  function statusOf(iso, part) {
    if (apiDays) return apiDays.get(iso)?.[part] ?? "tentative";
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
    button.innerHTML = '<span class="slot-label">' + partLabels[part] + '</span><span class="slot-mark" aria-hidden="true">' + markIcon(status) + "</span>";
    if (status === "busy" || iso < todayInJapan()) button.disabled = true;
    else button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (selected.has(key)) { selected.delete(key); selectedStatuses.delete(key); }
      else { selected.add(key); selectedStatuses.set(key, status); }
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
    card.dataset.date = iso;
    card.tabIndex = -1;
    card.setAttribute("aria-label", labelOf(iso));
    const heading = document.createElement("div");
    heading.className = "day-heading";
    heading.innerHTML = '<span class="day-number">' + d.getUTCDate() + '</span><span class="day-weekday">' + weekdays[weekday] + '</span><span class="today-label" hidden>今日</span>';
    card.append(heading);
    const slots = document.createElement("div");
    slots.className = "day-slots";
    parts.forEach(part => slots.append(slot(iso, part)));
    card.append(slots);
    const place = apiDays?.get(iso)?.location;
    if (place) { const label = document.createElement("span"); label.className = "location-label"; label.textContent = place; card.append(label); }
    return card;
  }
  function renderMonth(year, month, dates) {
    const section = document.createElement("section");
    section.className = "month-section";
    section.setAttribute("aria-label", year + "年" + month + "月");
    section.innerHTML = '<div class="month-heading"><h2>' + year + '年<span>' + month + '月</span></h2><span>' + dates.length + "日間</span></div>";
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
      return "・" + labelOf(iso) + " " + partLabels[part] + (selectedStatuses.get(key) === "tentative" ? "（調整中）" : "");
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

  function renderDates(from, to) {
    const grouped = new Map();
    const cursor = dateOf(from), end = dateOf(to);
    while (cursor <= end) {
      const iso = isoOf(cursor);
      const key = cursor.getUTCFullYear() + "-" + (cursor.getUTCMonth() + 1);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(iso);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    months.replaceChildren();
    grouped.forEach((dates, key) => {
      const [year, month] = key.split("-").map(Number);
      months.append(renderMonth(year, month, dates));
    });
    refreshToday();
  }
  function plus(iso, count) { return isoOf(new Date(dateOf(iso).getTime() + count * 86400000)); }
  async function loadRange() {
    const sequence = ++loadSequence;
    const from = plus(todayInJapan(), rangeOffset * 28), to = plus(from, 55);
    const notice = document.getElementById("load-status");
    notice.hidden = false; notice.textContent = "空き状況を読み込んでいます…";
    try {
      const response = await fetch(apiBase + "/api/public?from=" + from + "&to=" + to, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (sequence !== loadSequence) return;
      if (!Array.isArray(result.days) || result.days.length !== 56) throw new Error();
      apiDays = new Map(result.days.map(day => [day.date, day]));
      renderDates(from, to);
      for (const key of [...selected]) {
        const day = key.slice(0, 10), part = key.split(":")[1];
        if (day < todayInJapan() || apiDays.has(day) && statusOf(day, part) === "busy") { selected.delete(key); selectedStatuses.delete(key); }
        else if (apiDays.has(day)) selectedStatuses.set(key, statusOf(day, part));
      }
      updateSelection();
      document.getElementById("updated-at").textContent = result.publishedAt ? "最終公開 " + new Date(result.publishedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : result.legacyCheckedAt ? "移行前の最終確認 " + labelOf(result.legacyCheckedAt) : "移行した公開データ";
      notice.hidden = true;
    } catch {
      if (sequence !== loadSequence) return;
      apiDays = null; months.replaceChildren();
      notice.innerHTML = '空き状況を取得できませんでした。 <button type="button" id="retry-load">再試行</button>';
      document.getElementById("retry-load").addEventListener("click", loadRange);
    }
  }
  document.querySelectorAll(".legend .symbol").forEach(symbol => {
    const status = Object.keys(markPaths).find(name => symbol.classList.contains(name));
    symbol.innerHTML = markIcon(status);
    symbol.setAttribute("aria-hidden", "true");
  });
  if (apiBase) {
    document.getElementById("range-nav").hidden = false;
    document.getElementById("previous-range").addEventListener("click", () => { rangeOffset--; loadRange(); });
    document.getElementById("next-range").addEventListener("click", () => { rangeOffset++; loadRange(); });
    loadRange();
  } else {
    renderDates(data.start, data.end);
    document.getElementById("updated-at").textContent = (data.reviewed ? "最終更新 " : "資料確認 ") + labelOf(data.checkedAt);
    document.getElementById("review-notice").hidden = data.reviewed;
  }
  document.getElementById("clear-selection").addEventListener("click", () => {
    selected.clear();
    selectedStatuses.clear();
    document.querySelectorAll(".slot.selected").forEach(button => {
      button.classList.remove("selected");
      button.setAttribute("aria-pressed", "false");
    });
    updateSelection();
  });
  document.getElementById("copy-selection").addEventListener("click", copySelection);
  todayButton.addEventListener("click", goToToday);
  helpButton.addEventListener("click", () => {
    const open = helpPanel.hidden;
    helpPanel.hidden = !open;
    helpButton.setAttribute("aria-expanded", String(open));
  });
  document.getElementById("close-help").addEventListener("click", () => closeHelp(true));
  document.addEventListener("click", event => { if (!toolbar.contains(event.target)) closeHelp(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !helpPanel.hidden) {
      event.preventDefault();
      closeHelp(true);
    }
  });
  refreshToday();
  // Recheck on return and across midnight while the calendar stays open.
  window.addEventListener("focus", refreshToday);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshToday(); });
  window.setInterval(refreshToday, 60000);
})();
