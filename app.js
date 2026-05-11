const errorEl = document.getElementById("error");
const summaryEl = document.getElementById("summary");
const scheduleBodyEl = document.getElementById("schedule-body");
const scheduleWarningEl = document.getElementById("schedule-warning");
const resetDurationsButton = document.getElementById("reset-durations");
const timePickerDialog = document.getElementById("time-picker-dialog");
const timePickerTitle = document.getElementById("time-picker-title");
const timePickerHours = document.getElementById("time-picker-hours");
const timePickerMinutes = document.getElementById("time-picker-minutes");

const input = {
  shiftStart: document.getElementById("shift-start"),
  shiftEnd: document.getElementById("shift-end"),
  crewCount: document.getElementById("crew-count"),
  rounds: document.getElementById("rounds"),
};

const allowedCrewCounts = [2, 3];
const formStateStorageKey = "crew-rest:last-form-state:v2";
const legacyFormStateStorageKey = "crew-rest:last-form-state:v1";
const themeStorageKey = "crew-rest:theme-mode:v1";
const defaultThemeMode = "day";

let durationOverrides = {};
let activeTimePicker = null;
const wheelScrollFrames = {};
const wheelRepeatCount = 7;
const wheelCenterRepeat = Math.floor(wheelRepeatCount / 2);
let suppressWheelScroll = false;

function saveFormState(state) {
  try {
    localStorage.setItem(formStateStorageKey, JSON.stringify(state));
  } catch (err) {
    // Ignore storage errors (private mode, disabled storage, etc).
  }
}

function loadJsonState(key) {
  try {
    const serialized = localStorage.getItem(key);
    if (!serialized) {
      return null;
    }
    const parsed = JSON.parse(serialized);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    return null;
  }
}

function sanitizeDurationOverrides(rawOverrides, crewCount, rounds) {
  if (!rawOverrides || typeof rawOverrides !== "object") {
    return {};
  }

  const slotCount = crewCount * rounds;
  const sanitized = {};
  for (const [rawKey, rawValue] of Object.entries(rawOverrides)) {
    const index = Number(rawKey);
    const minutes = Number(rawValue);
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < slotCount &&
      Number.isInteger(minutes) &&
      minutes >= 0 &&
      minutes < 24 * 60
    ) {
      sanitized[String(index)] = minutes;
    }
  }
  return sanitized;
}

function normalizeLoadedState(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return null;
  }

  const crewCount = Number(rawState.crewCount ?? "");
  const rounds = Number(rawState.rounds ?? "");
  if (!allowedCrewCounts.includes(crewCount) || !Number.isFinite(rounds) || rounds < 1) {
    return null;
  }

  return {
    shiftStart: normalizeClockValue(rawState.shiftStart) || "00:00",
    shiftEnd: normalizeClockValue(rawState.shiftEnd) || "17:00",
    crewCount: String(crewCount),
    rounds: String(Math.floor(rounds)),
    durationOverrides: sanitizeDurationOverrides(rawState.durationOverrides, crewCount, Math.floor(rounds)),
  };
}

function loadFormState() {
  return normalizeLoadedState(loadJsonState(formStateStorageKey)) || normalizeLoadedState(loadJsonState(legacyFormStateStorageKey));
}

function sanitizeThemeMode(mode) {
  return mode === "night" ? "night" : defaultThemeMode;
}

function readThemeMode() {
  try {
    return sanitizeThemeMode(localStorage.getItem(themeStorageKey));
  } catch (err) {
    return defaultThemeMode;
  }
}

function writeThemeMode(mode) {
  try {
    localStorage.setItem(themeStorageKey, sanitizeThemeMode(mode));
  } catch (err) {
    // Ignore storage failures and keep the app usable.
  }
}

function applyTheme(mode = readThemeMode()) {
  const normalized = sanitizeThemeMode(mode);
  const rootEl = document.documentElement;
  if (rootEl?.dataset) {
    rootEl.dataset.themeMode = normalized;
    rootEl.dataset.theme = normalized;
  }

  const themeToggle = document.querySelector("#theme-toggle");
  if (themeToggle) {
    const isNight = normalized === "night";
    themeToggle.setAttribute("aria-pressed", String(isNight));
    themeToggle.setAttribute("aria-label", isNight ? "Switch to day mode" : "Switch to night mode");
  }

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta && rootEl && typeof getComputedStyle === "function") {
    const cssValue = getComputedStyle(rootEl).getPropertyValue("--theme-color").trim();
    if (cssValue) {
      themeColorMeta.setAttribute("content", cssValue);
    }
  }
}

function bindThemeControls() {
  const themeToggle = document.querySelector("#theme-toggle");
  if (!themeToggle) {
    return;
  }

  themeToggle.addEventListener("click", () => {
    const nextMode = readThemeMode() === "night" ? "day" : "night";
    writeThemeMode(nextMode);
    applyTheme(nextMode);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Ignore registration errors in unsupported contexts (for example file://).
    });
  });
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

function parseClock(value, fieldLabel) {
  const normalized = normalizeClockValue(value);
  if (!normalized) {
    throw new Error(`${fieldLabel} must be a valid 24-hour time.`);
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

function formatDurationForPicker(totalMinutes) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatPositiveDuration(totalMinutes) {
  if (totalMinutes >= 0 && totalMinutes < 24 * 60) {
    return formatDurationForPicker(totalMinutes);
  }
  return formatDuration(totalMinutes);
}

function wrapPickerValue(value, max) {
  return ((value % max) + max) % max;
}

function renderWheelValues(container, selectedValue, max, unit) {
  if (!container) {
    return;
  }

  container.dataset.wheel = unit;
  container.dataset.max = String(max);
  container.dataset.repeatCount = String(wheelRepeatCount);
  container.innerHTML = Array.from({ length: wheelRepeatCount }, (_, repeatIndex) =>
    Array.from({ length: max }, (_, value) => {
      const isSelected = value === selectedValue;
      return `
          <button
            type="button"
            class="wheel-value${isSelected ? " is-selected" : ""}"
            data-wheel="${unit}"
            data-value="${value}"
            data-repeat="${repeatIndex}"
            aria-pressed="${isSelected ? "true" : "false"}"
          >${String(value).padStart(2, "0")}</button>
        `;
    }).join("")
  )
    .join("");
}

function updateWheelSelection(container, selectedValue) {
  if (!container) {
    return;
  }

  container.querySelectorAll(".wheel-value").forEach((button) => {
    const isSelected = Number(button.dataset.value) === selectedValue;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
}

function scrollWheelToValue(container, selectedValue, smooth = false) {
  if (!container) {
    return;
  }

  const selectedButton =
    container.querySelector(
      `.wheel-value[data-value="${selectedValue}"][data-repeat="${wheelCenterRepeat}"]`
    ) || container.querySelector(`.wheel-value[data-value="${selectedValue}"]`);
  if (!selectedButton) {
    return;
  }

  const targetTop =
    selectedButton.offsetTop - (container.clientHeight - selectedButton.offsetHeight) / 2;
  container.scrollTo({
    top: Math.max(0, targetTop),
    behavior: smooth ? "smooth" : "auto",
  });
}

function renderTimePickerWheels() {
  if (!activeTimePicker) {
    return;
  }

  renderWheelValues(timePickerHours, activeTimePicker.hour, 24, "hour");
  renderWheelValues(timePickerMinutes, activeTimePicker.minute, 60, "minute");
  requestAnimationFrame(() => {
    suppressWheelScroll = true;
    scrollWheelToValue(timePickerHours, activeTimePicker.hour);
    scrollWheelToValue(timePickerMinutes, activeTimePicker.minute);
    window.setTimeout(() => {
      suppressWheelScroll = false;
    }, 80);
  });
}

function positionTimePicker(anchorEl) {
  if (!timePickerDialog || !anchorEl) {
    return;
  }

  const sheet = timePickerDialog.querySelector(".time-picker-sheet");
  if (!sheet) {
    return;
  }

  sheet.style.left = "";
  sheet.style.right = "";
  sheet.style.top = "";
  sheet.style.bottom = "";
  sheet.style.transform = "";

  const gap = 8;
  const margin = 8;
  const anchorRect = anchorEl.getBoundingClientRect();
  const sheetRect = sheet.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (viewportWidth <= 640) {
    sheet.style.left = "50%";
    sheet.style.bottom = "0.5rem";
    sheet.style.transform = "translateX(-50%)";
    return;
  }

  let left = anchorRect.right + gap;
  if (left + sheetRect.width + margin > viewportWidth) {
    left = anchorRect.left - sheetRect.width - gap;
  }
  if (left < margin) {
    left = Math.max(margin, viewportWidth - sheetRect.width - margin);
  }

  let top = anchorRect.top + anchorRect.height / 2 - sheetRect.height / 2;
  top = Math.max(margin, Math.min(top, viewportHeight - sheetRect.height - margin));

  sheet.style.left = `${left}px`;
  sheet.style.top = `${top}px`;
}

function openTimePicker({ title, initialMinutes, onSet, anchorEl }) {
  if (!timePickerDialog || !timePickerHours || !timePickerMinutes) {
    return;
  }

  const minutes = Math.max(0, Math.min(23 * 60 + 59, Math.round(initialMinutes || 0)));
  activeTimePicker = {
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
    onSet,
    anchorEl,
  };
  timePickerTitle.textContent = title;
  timePickerDialog.hidden = false;
  renderTimePickerWheels();
  positionTimePicker(anchorEl);
}

function closeTimePicker() {
  if (timePickerDialog) {
    timePickerDialog.hidden = true;
  }
  activeTimePicker = null;
}

function selectedPickerMinutes() {
  if (!activeTimePicker) {
    return 0;
  }
  return activeTimePicker.hour * 60 + activeTimePicker.minute;
}

function selectedWheelItem(container) {
  if (!container) {
    return null;
  }

  const center = container.scrollTop + container.clientHeight / 2;
  const values = Array.from(container.querySelectorAll(".wheel-value"));
  if (!values.length) {
    return null;
  }

  let nearest = values[0];
  let nearestDistance = Infinity;
  for (const valueEl of values) {
    const valueCenter = valueEl.offsetTop + valueEl.offsetHeight / 2;
    const distance = Math.abs(center - valueCenter);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = valueEl;
    }
  }

  return {
    value: Number(nearest.dataset.value || 0),
    repeat: Number(nearest.dataset.repeat || 0),
  };
}

function recenterWheelIfNeeded(container, selectedItem) {
  if (!container || !selectedItem) {
    return;
  }

  const max = Number(container.dataset.max || 0);
  const repeatCount = Number(container.dataset.repeatCount || 0);
  const isNearEdge = selectedItem.repeat <= 1 || selectedItem.repeat >= repeatCount - 2;
  if (!max || repeatCount < 3 || !isNearEdge) {
    return;
  }

  const target = container.querySelector(
    `.wheel-value[data-value="${selectedItem.value}"][data-repeat="${wheelCenterRepeat}"]`
  );
  if (!target) {
    return;
  }

  const targetTop = target.offsetTop - (container.clientHeight - target.offsetHeight) / 2;
  suppressWheelScroll = true;
  container.scrollTo({ top: targetTop, behavior: "auto" });
  requestAnimationFrame(() => {
    suppressWheelScroll = false;
  });
}

function applyActivePickerValue() {
  if (activeTimePicker?.onSet) {
    activeTimePicker.onSet(selectedPickerMinutes());
  }
}

function syncActivePickerToMinutes(minutes) {
  if (!activeTimePicker || !Number.isFinite(minutes)) {
    return;
  }

  const normalizedMinutes = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  activeTimePicker.hour = Math.floor(normalizedMinutes / 60);
  activeTimePicker.minute = normalizedMinutes % 60;
  updateWheelSelection(timePickerHours, activeTimePicker.hour);
  updateWheelSelection(timePickerMinutes, activeTimePicker.minute);

  suppressWheelScroll = true;
  scrollWheelToValue(timePickerHours, activeTimePicker.hour);
  scrollWheelToValue(timePickerMinutes, activeTimePicker.minute);
  window.setTimeout(() => {
    suppressWheelScroll = false;
  }, 80);
}

function setPickerPart(part, value, options = {}) {
  if (!activeTimePicker) {
    return;
  }

  const { syncScroll = true } = options;

  if (part === "hour") {
    activeTimePicker.hour = wrapPickerValue(value, 24);
    updateWheelSelection(timePickerHours, activeTimePicker.hour);
    if (syncScroll) {
      scrollWheelToValue(timePickerHours, activeTimePicker.hour);
    }
  } else if (part === "minute") {
    activeTimePicker.minute = wrapPickerValue(value, 60);
    updateWheelSelection(timePickerMinutes, activeTimePicker.minute);
    if (syncScroll) {
      scrollWheelToValue(timePickerMinutes, activeTimePicker.minute);
    }
  }

  applyActivePickerValue();
}

function handleWheelScroll(container) {
  const part = container?.dataset.wheel;
  if (!part || !activeTimePicker || suppressWheelScroll) {
    return;
  }

  cancelAnimationFrame(wheelScrollFrames[part]);
  wheelScrollFrames[part] = requestAnimationFrame(() => {
    const selectedItem = selectedWheelItem(container);
    if (!selectedItem) {
      return;
    }
    setPickerPart(part, selectedItem.value, { syncScroll: false });
    recenterWheelIfNeeded(container, selectedItem);
  });
}

function syncStaticTimeTriggers() {
  document.querySelectorAll(".time-trigger[data-time-target]").forEach((button) => {
    const field = document.getElementById(button.dataset.timeTarget);
    if (field) {
      button.textContent = normalizeClockValue(field.value) || field.value || "00:00";
    }
  });
}

function calculateBreakWindowLength(shiftStart, shiftEnd) {
  let normalizedEnd = shiftEnd;
  if (normalizedEnd <= shiftStart) {
    normalizedEnd += 24 * 60;
  }
  return normalizedEnd - shiftStart;
}

function crewOrder(crewCount, rounds) {
  const ordered = [];
  for (let round = 0; round < rounds; round += 1) {
    for (let crew = 1; crew <= crewCount; crew += 1) {
      ordered.push(crew);
    }
  }
  return ordered;
}

function readConfig() {
  const crewCount = Number(input.crewCount.value);
  const rounds = Number(input.rounds.value);

  if (!allowedCrewCounts.includes(crewCount) || !Number.isInteger(rounds) || rounds < 1) {
    throw new Error("Crew count must be 2 or 3 and breaks must be at least 1.");
  }

  const shiftStart = parseClock(input.shiftStart.value, "Off duty");
  const shiftEnd = parseClock(input.shiftEnd.value, "All on");
  const breakWindowLength = calculateBreakWindowLength(shiftStart, shiftEnd);

  return {
    shiftStart,
    shiftEnd,
    crewCount,
    rounds,
    durationOverrides: normalizeDurationOverridesForSchedule(
      durationOverrides,
      crewCount,
      rounds,
      breakWindowLength
    ),
  };
}

function slotIndexesByCrew(order, crewCount) {
  const byCrew = Array.from({ length: crewCount }, () => []);
  for (let index = 0; index < order.length; index += 1) {
    byCrew[order[index] - 1].push(index);
  }
  return byCrew;
}

function orderedManualIndexesForCrew(overrides, crewIndexes) {
  const crewIndexSet = new Set(crewIndexes);
  return Object.keys(overrides)
    .map(Number)
    .filter((index) => crewIndexSet.has(index));
}

function enforceOneAutoBreakPerCrew(overrides, indexesByCrew) {
  for (const crewIndexes of indexesByCrew) {
    let manualIndexes = orderedManualIndexesForCrew(overrides, crewIndexes);
    while (manualIndexes.length >= crewIndexes.length && manualIndexes.length > 0) {
      delete overrides[String(manualIndexes[0])];
      manualIndexes = orderedManualIndexesForCrew(overrides, crewIndexes);
    }
  }
  return overrides;
}

function clampCrewManualTotals(overrides, indexesByCrew, targetMinutes) {
  for (const crewIndexes of indexesByCrew) {
    const manualIndexes = orderedManualIndexesForCrew(overrides, crewIndexes);
    let manualTotal = manualIndexes.reduce(
      (total, index) => total + overrides[String(index)],
      0
    );

    for (let i = manualIndexes.length - 1; i >= 0 && manualTotal > targetMinutes; i -= 1) {
      const key = String(manualIndexes[i]);
      const excess = manualTotal - targetMinutes;
      const adjusted = Math.max(0, overrides[key] - excess);
      manualTotal -= overrides[key] - adjusted;
      overrides[key] = adjusted;
    }
  }
  return overrides;
}

function normalizeDurationOverridesForSchedule(rawOverrides, crewCount, rounds, breakWindowLength) {
  const overrides = sanitizeDurationOverrides(rawOverrides, crewCount, rounds);
  const order = crewOrder(crewCount, rounds);
  const indexesByCrew = slotIndexesByCrew(order, crewCount);
  const targetMinutes = Math.round(breakWindowLength / crewCount);

  enforceOneAutoBreakPerCrew(overrides, indexesByCrew);
  clampCrewManualTotals(overrides, indexesByCrew, targetMinutes);
  return overrides;
}

function applyDurationOverride(slotIndex, minutes) {
  const crewCount = Number(input.crewCount.value);
  const rounds = Number(input.rounds.value);
  if (!allowedCrewCounts.includes(crewCount) || !Number.isInteger(rounds) || rounds < 1) {
    return null;
  }

  const shiftStart = parseClock(input.shiftStart.value, "Off duty");
  const shiftEnd = parseClock(input.shiftEnd.value, "All on");
  const breakWindowLength = calculateBreakWindowLength(shiftStart, shiftEnd);
  const order = crewOrder(crewCount, rounds);
  const indexesByCrew = slotIndexesByCrew(order, crewCount);
  const crew = order[slotIndex];
  const crewIndexes = indexesByCrew[crew - 1] || [];
  const slotKey = String(slotIndex);
  const overrides = sanitizeDurationOverrides(durationOverrides, crewCount, rounds);
  const otherManualTotal = crewIndexes
    .filter((index) => index !== slotIndex && overrides[String(index)] != null)
    .reduce((total, index) => total + overrides[String(index)], 0);
  const targetMinutes = Math.round(breakWindowLength / crewCount);
  const maxCurrentDuration = Math.max(0, targetMinutes - otherManualTotal);
  const wasManual = overrides[slotKey] != null;

  if (!wasManual) {
    delete overrides[slotKey];
  }
  overrides[slotKey] = Math.max(0, Math.min(Math.round(minutes), maxCurrentDuration));

  if (!wasManual) {
    const manualIndexes = orderedManualIndexesForCrew(overrides, crewIndexes);
    if (manualIndexes.length >= crewIndexes.length) {
      const oldestManualIndex = manualIndexes.find((index) => index !== slotIndex);
      if (oldestManualIndex != null) {
        delete overrides[String(oldestManualIndex)];
      }
    }
  }

  durationOverrides = normalizeDurationOverridesForSchedule(
    overrides,
    crewCount,
    rounds,
    breakWindowLength
  );

  const { durations } = buildSlotDurations(
    { crewCount, rounds, durationOverrides },
    breakWindowLength,
    order
  );
  return durations[slotIndex] ?? null;
}

function distributeMinutes(totalMinutes, slotCount) {
  if (slotCount <= 0) {
    return [];
  }

  const base = Math.floor(totalMinutes / slotCount);
  let remainder = totalMinutes - base * slotCount;
  return Array.from({ length: slotCount }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) {
      remainder -= 1;
    }
    return value;
  });
}

function buildSlotDurations(config, breakWindowLength, order) {
  const slotCount = config.crewCount * config.rounds;
  const durations = Array(slotCount).fill(0);
  const warnings = [];
  const target = breakWindowLength / config.crewCount;
  const targetMinutes = Math.round(target);

  if (!Number.isInteger(target)) {
    warnings.push(`Break window ${formatPositiveDuration(breakWindowLength)} cannot be split into exact whole-minute totals across ${config.crewCount} crews.`);
  }

  const indexesByCrew = slotIndexesByCrew(order, config.crewCount);
  for (let crewIndex = 0; crewIndex < indexesByCrew.length; crewIndex += 1) {
    const indexes = indexesByCrew[crewIndex];
    const manualIndexes = indexes.filter((index) => config.durationOverrides[String(index)] != null);
    const autoIndexes = indexes.filter((index) => config.durationOverrides[String(index)] == null);
    const manualTotal = manualIndexes.reduce(
      (total, index) => total + config.durationOverrides[String(index)],
      0
    );
    const remaining = targetMinutes - manualTotal;

    for (const index of manualIndexes) {
      durations[index] = config.durationOverrides[String(index)];
    }

    if (remaining < 0) {
      warnings.push(`Crew ${crewIndex + 1} manually set breaks exceed ${formatPositiveDuration(targetMinutes)} by ${formatPositiveDuration(Math.abs(remaining))}.`);
      for (const index of autoIndexes) {
        durations[index] = 0;
      }
      continue;
    }

    if (autoIndexes.length === 0) {
      if (remaining !== 0) {
        warnings.push(`Crew ${crewIndex + 1} total is ${formatPositiveDuration(manualTotal)}, not ${formatPositiveDuration(targetMinutes)}.`);
      }
      continue;
    }

    const distributed = distributeMinutes(remaining, autoIndexes.length);
    for (let i = 0; i < autoIndexes.length; i += 1) {
      durations[autoIndexes[i]] = distributed[i];
    }
  }

  return { durations, warnings, targetMinutes };
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

  const order = crewOrder(config.crewCount, config.rounds);
  const { durations, warnings, targetMinutes } = buildSlotDurations(config, breakWindowLength, order);
  const slots = [];

  let cursor = breakWindowStart;
  for (let index = 0; index < durations.length; index += 1) {
    const crew = order[index];
    const duration = durations[index];
    const off = cursor;
    const on = cursor + duration;
    cursor = on;

    slots.push({
      index,
      crew,
      off,
      on,
      duration,
      isManual: config.durationOverrides[String(index)] != null,
    });
  }

  const totals = calculateCrewRestTotals(slots, config.crewCount);
  for (let crewIndex = 0; crewIndex < totals.length; crewIndex += 1) {
    if (totals[crewIndex] !== targetMinutes) {
      warnings.push(`Crew ${crewIndex + 1} total is ${formatPositiveDuration(totals[crewIndex])}; target is ${formatPositiveDuration(targetMinutes)}.`);
    }
  }

  const timelineTotal = durations.reduce((total, duration) => total + duration, 0);
  if (timelineTotal !== breakWindowLength) {
    warnings.push(`Scheduled break durations total ${formatPositiveDuration(timelineTotal)}, but the break window is ${formatPositiveDuration(breakWindowLength)}.`);
  }

  return {
    shiftLength,
    breakWindowStart,
    breakWindowEnd,
    breakWindowLength,
    eachCrewTarget: targetMinutes,
    warnings,
    slots,
  };
}

function calculateCrewRestTotals(slots, crewCount) {
  const totals = Array(crewCount).fill(0);
  for (const slot of slots) {
    totals[slot.crew - 1] += slot.duration;
  }
  return totals;
}

function renderSummary(data) {
  const metrics = [
    { label: "Break Window", value: formatPositiveDuration(data.breakWindowLength) },
    { label: "Each Crew Off", value: formatPositiveDuration(data.eachCrewTarget) },
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

function renderWarnings(warnings) {
  if (!scheduleWarningEl) {
    return;
  }

  if (!warnings.length) {
    scheduleWarningEl.textContent = "";
    scheduleWarningEl.hidden = true;
    return;
  }

  scheduleWarningEl.hidden = false;
  scheduleWarningEl.textContent = warnings.join(" ");
}

function renderSchedule(data) {
  scheduleBodyEl.innerHTML = data.slots
    .map(
      (slot) => `
      <tr>
        <td>${slot.crew}</td>
        <td>${formatClock(slot.off)}</td>
        <td>${formatClock(slot.on)}</td>
        <td>
          <div class="duration-editor">
            <button
              class="schedule-duration-button"
              type="button"
              data-slot-index="${slot.index}"
              data-duration-minutes="${slot.duration}"
              aria-label="Set crew ${slot.crew} break duration"
            >${formatDurationForPicker(slot.duration)}</button>
            <span class="duration-source">${slot.isManual ? "set" : "auto"}</span>
          </div>
        </td>
      </tr>
    `
    )
    .join("");
}

function captureFormState() {
  const crewCount = Number(input.crewCount.value);
  const rounds = Number(input.rounds.value);
  return {
    shiftStart: normalizeClockValue(input.shiftStart.value) || input.shiftStart.value,
    shiftEnd: normalizeClockValue(input.shiftEnd.value) || input.shiftEnd.value,
    crewCount: input.crewCount.value,
    rounds: input.rounds.value,
    durationOverrides: sanitizeDurationOverrides(durationOverrides, crewCount, rounds),
  };
}

function applyFormState(state) {
  if (!state) {
    return;
  }

  input.shiftStart.value = state.shiftStart;
  input.shiftEnd.value = state.shiftEnd;
  input.crewCount.value = state.crewCount;
  input.rounds.value = state.rounds;
  durationOverrides = sanitizeDurationOverrides(
    state.durationOverrides,
    Number(state.crewCount),
    Number(state.rounds)
  );
}

function runCalculation() {
  try {
    errorEl.textContent = "";
    input.shiftStart.value = normalizeClockValue(input.shiftStart.value) || input.shiftStart.value;
    input.shiftEnd.value = normalizeClockValue(input.shiftEnd.value) || input.shiftEnd.value;
    syncStaticTimeTriggers();

    const config = readConfig();
    durationOverrides = config.durationOverrides;
    const results = calculateSchedule(config);
    renderSummary(results);
    renderWarnings(results.warnings);
    renderSchedule(results);
    saveFormState(captureFormState());
  } catch (err) {
    summaryEl.innerHTML = "";
    scheduleBodyEl.innerHTML = "";
    renderWarnings([]);
    errorEl.textContent = err.message;
  }
}

function clearDurationOverridesOutsideCurrentShape() {
  const crewCount = Number(input.crewCount.value);
  const rounds = Number(input.rounds.value);
  durationOverrides = sanitizeDurationOverrides(durationOverrides, crewCount, rounds);
}

function handleCoreInputChange() {
  clearDurationOverridesOutsideCurrentShape();
  runCalculation();
}

input.crewCount.addEventListener("change", handleCoreInputChange);
input.rounds.addEventListener("change", handleCoreInputChange);
input.shiftStart.addEventListener("change", handleCoreInputChange);
input.shiftEnd.addEventListener("change", handleCoreInputChange);
input.shiftStart.addEventListener("blur", handleCoreInputChange);
input.shiftEnd.addEventListener("blur", handleCoreInputChange);

scheduleBodyEl.addEventListener("click", (event) => {
  const durationButton = event.target.closest?.(".schedule-duration-button");
  if (!durationButton) {
    return;
  }

  const slotIndex = String(durationButton.dataset.slotIndex || "");
  openTimePicker({
    title: "Set duration",
    initialMinutes: Number(durationButton.dataset.durationMinutes || 0),
    anchorEl: durationButton,
    onSet: (minutes) => {
      const appliedMinutes = applyDurationOverride(Number(slotIndex), minutes);
      runCalculation();
      if (appliedMinutes !== minutes) {
        syncActivePickerToMinutes(appliedMinutes);
      }
    },
  });
});

document.querySelectorAll(".time-trigger[data-time-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const field = document.getElementById(button.dataset.timeTarget);
    if (!field) {
      return;
    }

    openTimePicker({
      title: button.dataset.timeTarget === "shift-start" ? "Set off-duty time" : "Set all-on time",
      initialMinutes: parseClock(field.value, "Time"),
      anchorEl: button,
      onSet: (minutes) => {
        field.value = formatDurationForPicker(minutes);
        syncStaticTimeTriggers();
        handleCoreInputChange();
      },
    });
  });
});

document.querySelectorAll("[data-time-picker-cancel]").forEach((button) => {
  button.addEventListener("click", closeTimePicker);
});

timePickerDialog?.addEventListener("click", (event) => {
  const valueButton = event.target.closest?.(".wheel-value");
  if (valueButton) {
    setPickerPart(valueButton.dataset.wheel, Number(valueButton.dataset.value || 0));
  }
});

timePickerHours?.addEventListener("scroll", () => handleWheelScroll(timePickerHours), {
  passive: true,
});

timePickerMinutes?.addEventListener("scroll", () => handleWheelScroll(timePickerMinutes), {
  passive: true,
});

window.addEventListener("resize", () => {
  if (activeTimePicker?.anchorEl) {
    positionTimePicker(activeTimePicker.anchorEl);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeTimePicker) {
    closeTimePicker();
  }
});

resetDurationsButton?.addEventListener("click", () => {
  durationOverrides = {};
  runCalculation();
});

applyTheme();
bindThemeControls();

const persistedState = loadFormState();
if (persistedState) {
  applyFormState(persistedState);
}
syncStaticTimeTriggers();
runCalculation();
registerServiceWorker();

window.addEventListener("beforeunload", () => {
  saveFormState(captureFormState());
});
