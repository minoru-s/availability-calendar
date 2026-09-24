// このファイルは公開されます。予定名・場所・個人情報は記載しないでください。
// available = ○、tentative = △、busy = ×
window.availabilityData = {
  start: "2026-09-25",
  end: "2026-10-22",
  checkedAt: "2026-09-25",
  reviewed: true,
  rules: [
    { from: "2026-10-01", to: "2026-10-22", weekdays: [1, 2, 3, 4, 5], parts: ["am", "pm"], status: "tentative" }
  ],
  slots: {
    "2026-09-25": { pm: "busy", night: "busy" },
    "2026-09-26": { am: "busy", pm: "busy" },
    "2026-09-28": { am: "busy", pm: "busy" },
    "2026-09-29": { am: "busy", pm: "busy", night: "busy" },
    "2026-09-30": { pm: "busy" },
    "2026-10-11": { am: "busy", pm: "busy" },
    "2026-10-14": { am: "tentative" },
    "2026-10-16": { am: "busy" }
  }
};
