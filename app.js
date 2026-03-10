const form = document.getElementById("config-form");
const errorEl = document.getElementById("error");
const summaryEl = document.getElementById("summary");
const scheduleBodyEl = document.getElementById("schedule-body");

const input = {
  shiftStart: document.getElementById("shift-start"),
  shiftEnd: document.getElementById("shift-end"),
  crewCount: document.getElementById("crew-count"),
  rounds: document.getElementById("rounds"),
  shortBreakWrap: document.getElementById("short-break-wrap"),
  shortBreakDuration: document.getElementById("short-break-duration"),
  patternWrap: document.getElementById("pattern-wrap"),
  patternSequence: document.getElementById("pattern-sequence"),
};
const allowedCrewCounts = [2, 3];

function parseClock(value, fieldLabel) {
  const normalized = normalizeClockValue(value);
  if (!normalized) {
    throw new Error(
      `${fieldLabel} must be 24-hour HHMM or HH:MM (example: 1900 or 19:00).`
    );
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function parseDuration(value, fieldLabel) {
  const normalized = normalizeDurationValue(value);
  if (!normalized) {
    throw new Error(
      `${fieldLabel} must be HMM or H:MM (example: 340 or 3:40).`
    );
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatClock(totalMinutes) {
  const inDay = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(inDay / 60);
  const m = inDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDuration(totalMinutes) {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(totalMinutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${hours}:${String(mins).padStart(2, "0")}`;
}

function normalizeClockValue(rawValue) {
  const text = String(rawValue).trim();
  if (!text) {
    return "";
  }

  let hours;
  let minutes;

  const withColon = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (withColon) {
    hours = Number(withColon[1]);
    minutes = Number(withColon[2]);
  } else if (/^\d{3,4}$/.test(text)) {
    const padded = text.padStart(4, "0");
    hours = Number(padded.slice(0, 2));
    minutes = Number(padded.slice(2));
  } else if (/^\d{1,2}$/.test(text)) {
    hours = Number(text);
    minutes = 0;
  } else {
    return "";
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return "";
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeDurationValue(rawValue) {
  const text = String(rawValue).trim();
  if (!text) {
    return "";
  }

  let hours;
  let minutes;

  const withColon = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (withColon) {
    hours = Number(withColon[1]);
    minutes = Number(withColon[2]);
  } else if (/^\d{3,4}$/.test(text)) {
    const splitIndex = text.length - 2;
    hours = Number(text.slice(0, splitIndex));
    minutes = Number(text.slice(splitIndex));
  } else if (/^\d{1,2}$/.test(text)) {
    hours = Number(text);
    minutes = 0;
  } else {
    return "";
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return "";
  }

  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function normalizePatternValue(rawValue) {
  let text = String(rawValue).trim();
  if (!text) {
    return "";
  }

  text = text
    .replace(/\bshort\b/gi, "S")
    .replace(/\blong\b/gi, "L")
    .toUpperCase()
    .replace(/[\s|/;-]+/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "");

  if (!text) {
    return "";
  }

  const tokens = /^[SL]+$/.test(text) ? text.split("") : text.split(",");
  if (tokens.some((token) => token !== "S" && token !== "L")) {
    return "";
  }

  return tokens.join(",");
}

function parsePatternTokens(rawValue, expectedSlots) {
  if (!String(rawValue).trim()) {
    return null;
  }

  const normalized = normalizePatternValue(rawValue);
  if (!normalized) {
    throw new Error(
      "Pattern order must contain only S or L values (for example S,S,L,L)."
    );
  }

  const tokens = normalized.split(",");
  if (tokens.length !== expectedSlots) {
    throw new Error(`Pattern order must have exactly ${expectedSlots} entries.`);
  }

  return tokens;
}

function buildDefaultPattern(slotCount) {
  const shortCount = Math.floor(slotCount / 2);
  const longCount = slotCount - shortCount;
  return [
    ...Array(shortCount).fill("S"),
    ...Array(longCount).fill("L"),
  ].join(",");
}

function applyTimeNormalization(field) {
  const normalized = normalizeClockValue(field.value);
  if (normalized) {
    field.value = normalized;
  }
}

function applyDurationNormalization(field) {
  const normalized = normalizeDurationValue(field.value);
  if (normalized) {
    field.value = normalized;
  }
}

function applyPatternNormalization(field) {
  const normalized = normalizePatternValue(field.value);
  if (normalized) {
    field.value = normalized;
  }
}

function syncPatternLength() {
  const slotCount = Number(input.crewCount.value) * Number(input.rounds.value);
  if (!slotCount) {
    return;
  }

  const normalized = normalizePatternValue(input.patternSequence.value);
  if (!normalized) {
    return;
  }

  const currentCount = normalized.split(",").length;
  if (currentCount !== slotCount) {
    input.patternSequence.value = buildDefaultPattern(slotCount);
  } else {
    input.patternSequence.value = normalized;
  }
}

function updateBreakInputsVisibility() {
  const rounds = Number(input.rounds.value);
  const multiBreak = rounds > 1;

  input.shortBreakWrap.hidden = !multiBreak;
  input.patternWrap.hidden = !multiBreak;
  input.shortBreakDuration.required = false;
  input.patternSequence.required = false;

  if (multiBreak) {
    syncPatternLength();
  }
}

function crewOrder(crewCount, rounds) {
  const base = [];
  for (let i = 0; i < crewCount; i += 1) {
    base.push(i + 1);
  }

  const ordered = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const crew of base) {
      ordered.push(crew);
    }
  }

  return ordered;
}

function buildSlotDurations(config, breakWindowLength) {
  const slotCount = config.crewCount * config.rounds;

  if (config.rounds > 1 && config.patternTokens) {
    const shortCount = config.patternTokens.filter((token) => token === "S").length;
    const longCount = config.patternTokens.length - shortCount;
    const totalShort = config.shortBreakDuration * shortCount;
    const remainingMinutes = breakWindowLength - totalShort;

    if (remainingMinutes < 0) {
      throw new Error("Short break duration is too long for this shift.");
    }

    if (longCount === 0 && remainingMinutes !== 0) {
      throw new Error("Pattern is all short breaks but does not fill the break window.");
    }

    const longBase = longCount > 0 ? Math.floor(remainingMinutes / longCount) : 0;
    let longRemainder = longCount > 0 ? remainingMinutes - longBase * longCount : 0;
    const durations = [];

    for (const token of config.patternTokens) {
      if (token === "S") {
        durations.push(config.shortBreakDuration);
      } else {
        let longDuration = longBase;
        if (longRemainder > 0) {
          longDuration += 1;
          longRemainder -= 1;
        }
        durations.push(longDuration);
      }
    }

    return durations;
  }

  const baseSlotMinutes = Math.floor(breakWindowLength / slotCount);
  const remainder = breakWindowLength - baseSlotMinutes * slotCount;
  const durations = Array(slotCount).fill(baseSlotMinutes);
  for (let i = slotCount - remainder; i < slotCount; i += 1) {
    durations[i] += 1;
  }

  return durations;
}

function calculateSchedule(config) {
  let shiftEnd = config.shiftEnd;
  if (shiftEnd <= config.shiftStart) {
    shiftEnd += 24 * 60;
  }

  const shiftLength = shiftEnd - config.shiftStart;
  const breakWindowStart = config.shiftStart;
  const breakWindowEnd = shiftEnd;
  const breakWindowLength = breakWindowEnd - breakWindowStart;

  if (breakWindowLength <= 0) {
    throw new Error("Break window is zero or negative for this shift.");
  }

  const slotCount = config.crewCount * config.rounds;
  const slotDurations = buildSlotDurations(config, breakWindowLength);

  const order = crewOrder(config.crewCount, config.rounds);
  const slots = [];

  let cursor = breakWindowStart;
  for (let i = 0; i < slotCount; i += 1) {
    const crew = order[i];
    const duration = slotDurations[i];
    const off = cursor;
    const on = cursor + duration;
    cursor = on;

    slots.push({
      crew,
      off,
      on,
      duration,
    });
  }

  return {
    shiftLength,
    breakWindowStart,
    breakWindowEnd,
    breakWindowLength,
    eachCrewTarget: breakWindowLength / config.crewCount,
    slots,
  };
}

function renderSummary(data, config) {
  const metrics = [
    { label: "Crew Count", value: String(config.crewCount) },
    { label: "Number of Breaks", value: String(config.rounds) },
    { label: "Break Window", value: formatDuration(data.breakWindowLength) },
    { label: "Each Crew Off", value: formatDuration(Math.round(data.eachCrewTarget)) },
  ];

  summaryEl.innerHTML = metrics
    .map(
      (metric) => `
      <article class="metric">
        <div class="label">${metric.label}</div>
        <div class="value">${metric.value}</div>
      </article>
    `
    )
    .join("");
}

function renderSchedule(data) {
  scheduleBodyEl.innerHTML = data.slots
    .map(
      (slot) => `
      <tr>
        <td>${slot.crew}</td>
        <td>${formatClock(slot.off)}</td>
        <td>${formatClock(slot.on)}</td>
        <td>${formatDuration(slot.duration)}</td>
      </tr>
    `
    )
    .join("");
}

function readConfig() {
  const rounds = Number(input.rounds.value);
  const crewCount = Number(input.crewCount.value);
  const slotCount = crewCount * rounds;
  const multiBreak = rounds > 1;
  const patternTokens = multiBreak
    ? parsePatternTokens(input.patternSequence.value, slotCount)
    : null;
  const config = {
    shiftStart: parseClock(input.shiftStart.value, "Off"),
    shiftEnd: parseClock(input.shiftEnd.value, "All on"),
    crewCount,
    rounds,
    shortBreakDuration:
      multiBreak && patternTokens
        ? parseDuration(input.shortBreakDuration.value, "Short break duration")
        : null,
    patternTokens,
  };

  if (
    !allowedCrewCounts.includes(config.crewCount) ||
    config.rounds < 1 ||
    (config.patternTokens && config.shortBreakDuration <= 0)
  ) {
    throw new Error(
      "Crew count must be 2 or 3. Check rounds and break duration settings."
    );
  }

  return config;
}

function runCalculation() {
  try {
    errorEl.textContent = "";
    applyTimeNormalization(input.shiftStart);
    applyTimeNormalization(input.shiftEnd);
    if (Number(input.rounds.value) > 1) {
      applyPatternNormalization(input.patternSequence);
      if (String(input.patternSequence.value).trim()) {
        applyDurationNormalization(input.shortBreakDuration);
      }
    }
    const config = readConfig();
    const results = calculateSchedule(config);
    renderSummary(results, config);
    renderSchedule(results);
  } catch (err) {
    summaryEl.innerHTML = "";
    scheduleBodyEl.innerHTML = "";
    errorEl.textContent = err.message;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runCalculation();
});

input.crewCount.addEventListener("change", () => {
  updateBreakInputsVisibility();
});
input.rounds.addEventListener("change", () => {
  updateBreakInputsVisibility();
});
input.shiftStart.addEventListener("blur", () => {
  applyTimeNormalization(input.shiftStart);
});
input.shiftEnd.addEventListener("blur", () => {
  applyTimeNormalization(input.shiftEnd);
});
input.shortBreakDuration.addEventListener("blur", () => {
  applyDurationNormalization(input.shortBreakDuration);
});
input.patternSequence.addEventListener("blur", () => {
  applyPatternNormalization(input.patternSequence);
});

updateBreakInputsVisibility();
runCalculation();
