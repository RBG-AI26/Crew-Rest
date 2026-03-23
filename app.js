const form = document.getElementById("config-form");
const errorEl = document.getElementById("error");
const summaryEl = document.getElementById("summary");
const scheduleBodyEl = document.getElementById("schedule-body");
const transferStatusEl = document.getElementById("transfer-status");
const exportDataButton = document.getElementById("export-data");
const importDataButton = document.getElementById("import-data");
const importDataFileInput = document.getElementById("import-data-file");

const input = {
  shiftStart: document.getElementById("shift-start"),
  shiftEnd: document.getElementById("shift-end"),
  crewCount: document.getElementById("crew-count"),
  rounds: document.getElementById("rounds"),
  shortBreakSyncToggle: document.getElementById("short-break-sync-toggle"),
  shortBreakDuration1Wrap: document.getElementById("short-break-duration-1-wrap"),
  shortBreakDuration1: document.getElementById("short-break-duration-1"),
  shortBreakDuration2Wrap: document.getElementById("short-break-duration-2-wrap"),
  shortBreakDuration2: document.getElementById("short-break-duration-2"),
  shortBreakDuration3Wrap: document.getElementById("short-break-duration-3-wrap"),
  shortBreakDuration3: document.getElementById("short-break-duration-3"),
  patternWrap: document.getElementById("pattern-wrap"),
  patternSequence: document.getElementById("pattern-sequence"),
};
const allowedCrewCounts = [2, 3];
const maxPatternOptions = 200;
const maxPatternCandidates = 100000;
const formStateStorageKey = "crew-rest:last-form-state:v1";
const themeStorageKey = "crew-rest:theme-mode:v1";
const defaultThemeMode = "auto";
const transferFileVersion = 1;
const evenPatternValue = "__EVEN__";
const evenPatternLabel = "All Crew Even Breaks";
let lastAcceptedState = null;
let isRevertingSelection = false;

function setTransferStatus(message, tone = "") {
  if (!transferStatusEl) {
    return;
  }

  transferStatusEl.textContent = message;
  transferStatusEl.classList.remove("is-error", "is-success");
  if (tone === "error") {
    transferStatusEl.classList.add("is-error");
  } else if (tone === "success") {
    transferStatusEl.classList.add("is-success");
  }
}

function buildTransferPayload() {
  return {
    type: "crew-rest-transfer",
    version: transferFileVersion,
    exportedAt: new Date().toISOString(),
    themeMode: readThemeMode(),
    formState: captureFormState(),
  };
}

function buildTransferFileParts() {
  const payload = buildTransferPayload();
  const stamp = payload.exportedAt.slice(0, 19).replace(/[:T]/g, "-");
  const fileName = `crew-rest-${stamp}.json`;
  const fileText = JSON.stringify(payload, null, 2);
  const blob = new Blob([fileText], { type: "application/json" });
  return { payload, fileName, fileText, blob };
}

function updateExportButtonState() {
  if (!exportDataButton) {
    return;
  }

  exportDataButton.textContent = "Export Data";
  exportDataButton.title = "Download a transfer file you can import on another device.";
}

function sanitizeImportedFormState(rawState) {
  if (!rawState || typeof rawState !== "object") {
    throw new Error("Import file is missing form data.");
  }

  const normalized = {
    shiftStart: String(rawState.shiftStart ?? ""),
    shiftEnd: String(rawState.shiftEnd ?? ""),
    crewCount: String(rawState.crewCount ?? ""),
    rounds: String(rawState.rounds ?? ""),
    shortBreakDuration1: String(rawState.shortBreakDuration1 ?? ""),
    shortBreakDuration2: String(rawState.shortBreakDuration2 ?? ""),
    shortBreakDuration3: String(rawState.shortBreakDuration3 ?? ""),
    patternSequence: String(rawState.patternSequence ?? ""),
    shortBreakMode: rawState.shortBreakMode === "different" ? "different" : "same",
  };

  if (!allowedCrewCounts.includes(Number(normalized.crewCount))) {
    throw new Error("Import file has an unsupported crew count.");
  }

  if (!Number.isFinite(Number(normalized.rounds)) || Number(normalized.rounds) < 1) {
    throw new Error("Import file has an invalid break count.");
  }

  return normalized;
}

function applyImportedPayload(payload) {
  if (!payload || payload.type !== "crew-rest-transfer") {
    throw new Error("This file is not a Crew Rest transfer file.");
  }

  const importedState = sanitizeImportedFormState(payload.formState);
  const importedThemeMode = sanitizeThemeMode(payload.themeMode);

  applyFormState(importedState);
  writeThemeMode(importedThemeMode);
  applyTheme(importedThemeMode);
  runCalculation();
  lastAcceptedState = captureFormState();
  saveFormState(lastAcceptedState);
}

async function exportCurrentData() {
  try {
    const { fileName, fileText } = buildTransferFileParts();
    const downloadUrl = URL.createObjectURL(
      new Blob([fileText], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
    }, 1000);
  } catch (err) {
    setTransferStatus("Could not export data.", "error");
  }
}

function importSelectedFile(file) {
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(String(reader.result || ""));
      applyImportedPayload(payload);
      setTransferStatus("Data imported successfully.", "success");
    } catch (err) {
      setTransferStatus(err.message || "Could not import that file.", "error");
    } finally {
      importDataFileInput.value = "";
    }
  });
  reader.addEventListener("error", () => {
    setTransferStatus("Could not read that file.", "error");
    importDataFileInput.value = "";
  });
  reader.readAsText(file);
}

function bindTransferControls() {
  updateExportButtonState();

  if (exportDataButton) {
    exportDataButton.addEventListener("click", exportCurrentData);
  }

  if (importDataButton && importDataFileInput) {
    importDataButton.addEventListener("click", () => {
      importDataFileInput.click();
    });
    importDataFileInput.addEventListener("change", () => {
      importSelectedFile(importDataFileInput.files?.[0]);
    });
  }
}

function saveFormState(state) {
  try {
    localStorage.setItem(formStateStorageKey, JSON.stringify(state));
  } catch (err) {
    // Ignore storage errors (private mode, disabled storage, etc).
  }
}

function loadFormState() {
  try {
    const serialized = localStorage.getItem(formStateStorageKey);
    if (!serialized) {
      return null;
    }

    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const normalized = {
      shiftStart: String(parsed.shiftStart ?? ""),
      shiftEnd: String(parsed.shiftEnd ?? ""),
      crewCount: String(parsed.crewCount ?? ""),
      rounds: String(parsed.rounds ?? ""),
      shortBreakDuration1: String(parsed.shortBreakDuration1 ?? ""),
      shortBreakDuration2: String(parsed.shortBreakDuration2 ?? ""),
      shortBreakDuration3: String(parsed.shortBreakDuration3 ?? ""),
      patternSequence: String(parsed.patternSequence ?? ""),
      shortBreakMode: parsed.shortBreakMode === "different" ? "different" : "same",
    };

    if (!allowedCrewCounts.includes(Number(normalized.crewCount))) {
      return null;
    }

    if (!Number.isFinite(Number(normalized.rounds)) || Number(normalized.rounds) < 1) {
      return null;
    }

    return normalized;
  } catch (err) {
    return null;
  }
}

function sanitizeThemeMode(mode) {
  return ["day", "night", "auto"].includes(mode) ? mode : defaultThemeMode;
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

function resolveAppliedTheme(mode) {
  const normalized = sanitizeThemeMode(mode);
  if (normalized === "auto") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "day";
  }
  return normalized;
}

function applyTheme(mode = readThemeMode()) {
  const normalized = sanitizeThemeMode(mode);
  const appliedTheme = resolveAppliedTheme(normalized);
  const rootEl = document.documentElement;
  if (rootEl?.dataset) {
    rootEl.dataset.themeMode = normalized;
    rootEl.dataset.theme = appliedTheme;
  }

  const themeEl = document.querySelector("#theme-mode");
  if (themeEl && themeEl.value !== normalized) {
    themeEl.value = normalized;
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
  const themeEl = document.querySelector("#theme-mode");
  if (!themeEl) {
    return;
  }

  themeEl.value = readThemeMode();
  themeEl.addEventListener("change", () => {
    const mode = sanitizeThemeMode(themeEl.value);
    writeThemeMode(mode);
    applyTheme(mode);
  });
}

function bindThemeAutoUpdates() {
  const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mediaQuery) {
    return;
  }

  const syncAutoTheme = () => {
    if (readThemeMode() === "auto") {
      applyTheme("auto");
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", syncAutoTheme);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(syncAutoTheme);
  }
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

function isEvenPatternSelected() {
  return String(input.patternSequence.value).trim() === evenPatternValue;
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

function shortBreakFieldForCrew(crew) {
  if (crew === 1) {
    return input.shortBreakDuration1;
  }
  if (crew === 2) {
    return input.shortBreakDuration2;
  }
  return input.shortBreakDuration3;
}

function getShortBreakMode() {
  return input.shortBreakSyncToggle.dataset.mode || "same";
}

function syncShortBreaksFromCrew1() {
  const crewCount = Number(input.crewCount.value);
  const value = input.shortBreakDuration1.value;
  for (let crew = 2; crew <= crewCount; crew += 1) {
    shortBreakFieldForCrew(crew).value = value;
  }
}

function setShortBreakMode(mode, options = {}) {
  const { copyFromCrew1 = true } = options;
  const normalizedMode = mode === "different" ? "different" : "same";
  const sameMode = normalizedMode === "same";
  const crewCount = Number(input.crewCount.value);

  input.shortBreakSyncToggle.dataset.mode = normalizedMode;
  input.shortBreakSyncToggle.textContent = sameMode ? "Same" : "Different";
  input.shortBreakSyncToggle.setAttribute("aria-pressed", sameMode ? "true" : "false");

  input.shortBreakDuration2.disabled = sameMode;
  input.shortBreakDuration3.disabled = sameMode || crewCount < 3;

  if (sameMode && copyFromCrew1) {
    syncShortBreaksFromCrew1();
  }
}

function readShortBreakDurationsByCrew(crewCount, shortBreakMode) {
  const byCrew = {};

  if (shortBreakMode === "same") {
    const shared = parseDuration(input.shortBreakDuration1.value, "Crew 1 short break");
    for (let crew = 1; crew <= crewCount; crew += 1) {
      byCrew[crew] = shared;
    }
  } else {
    for (let crew = 1; crew <= crewCount; crew += 1) {
      byCrew[crew] = parseDuration(
        shortBreakFieldForCrew(crew).value,
        `Crew ${crew} short break`
      );
    }
  }

  const values = Object.values(byCrew);
  if (values.some((minutes) => minutes <= 0)) {
    throw new Error("Crew short break durations must be greater than 0.");
  }

  return byCrew;
}

function readPatternGenerationConfig() {
  const rounds = Number(input.rounds.value);
  const crewCount = Number(input.crewCount.value);
  const config = {
    shiftStart: parseClock(input.shiftStart.value, "Off"),
    shiftEnd: parseClock(input.shiftEnd.value, "All on"),
    crewCount,
    rounds,
    shortBreakDurationsByCrew: null,
    patternTokens: null,
  };

  if (!allowedCrewCounts.includes(crewCount) || rounds < 1) {
    throw new Error("Crew count must be 2 or 3. Check rounds and break duration settings.");
  }

  if (rounds > 1) {
    config.shortBreakDurationsByCrew = readShortBreakDurationsByCrew(
      crewCount,
      getShortBreakMode()
    );
  }

  return config;
}

function generateEqualRestPatternOptions(config) {
  if (config.rounds <= 1) {
    return { options: [], truncated: false };
  }

  if (config.shortBreakDurationsByCrew && breakWindowLengthNotDivisible(config)) {
    return { options: [], truncated: false };
  }

  const order = crewOrder(config.crewCount, config.rounds);
  const slotIndexesByCrew = Array.from({ length: config.crewCount }, () => []);
  for (let slotIndex = 0; slotIndex < order.length; slotIndex += 1) {
    slotIndexesByCrew[order[slotIndex] - 1].push(slotIndex);
  }

  const patternTokens = Array(order.length).fill("L");
  const options = [];
  let candidatesChecked = 0;
  let truncated = false;

  function evaluateCandidate() {
    if (truncated) {
      return false;
    }

    candidatesChecked += 1;
    if (candidatesChecked > maxPatternCandidates) {
      truncated = true;
      return false;
    }

    try {
      const results = calculateSchedule({
        ...config,
        patternTokens: [...patternTokens],
      });
      const totals = calculateCrewRestTotals(results, config.crewCount);
      if (new Set(totals).size === 1) {
        options.push(patternTokens.join(","));
        if (options.length >= maxPatternOptions) {
          truncated = true;
          return false;
        }
      }
    } catch (err) {
      // Skip invalid combinations.
    }

    return true;
  }

  function assignCrewPattern(crewIndex, shortCountPerCrew) {
    if (truncated) {
      return false;
    }

    if (crewIndex >= config.crewCount) {
      return evaluateCandidate();
    }

    const crewSlots = slotIndexesByCrew[crewIndex];
    const chosenSlots = [];

    function chooseSlots(startIndex, picksRemaining) {
      if (truncated) {
        return false;
      }

      if (picksRemaining === 0) {
        for (const slotIndex of chosenSlots) {
          patternTokens[slotIndex] = "S";
        }

        const recurse = assignCrewPattern(crewIndex + 1, shortCountPerCrew);

        for (const slotIndex of chosenSlots) {
          patternTokens[slotIndex] = "L";
        }

        return recurse;
      }

      const maxStart = crewSlots.length - picksRemaining;
      for (let i = startIndex; i <= maxStart; i += 1) {
        chosenSlots.push(crewSlots[i]);
        const shouldContinue = chooseSlots(i + 1, picksRemaining - 1);
        chosenSlots.pop();
        if (!shouldContinue) {
          return false;
        }
      }

      return true;
    }

    return chooseSlots(0, shortCountPerCrew);
  }

  for (let shortCountPerCrew = 1; shortCountPerCrew < config.rounds; shortCountPerCrew += 1) {
    if (!assignCrewPattern(0, shortCountPerCrew)) {
      break;
    }
  }

  return { options, truncated };
}

function calculateBreakWindowLength(shiftStart, shiftEnd) {
  let normalizedEnd = shiftEnd;
  if (normalizedEnd <= shiftStart) {
    normalizedEnd += 24 * 60;
  }
  return normalizedEnd - shiftStart;
}

function breakWindowLengthNotDivisible(config) {
  const breakWindowLength = calculateBreakWindowLength(
    config.shiftStart,
    config.shiftEnd
  );
  return breakWindowLength % config.crewCount !== 0;
}

function setPatternOptions(options, truncated) {
  const previousValue = input.patternSequence.value;
  input.patternSequence.innerHTML = "";

  const allOptions = [
    { value: evenPatternValue, label: evenPatternLabel },
    ...options.map((pattern) => ({ value: pattern, label: pattern })),
  ];

  for (const pattern of allOptions) {
    const option = document.createElement("option");
    option.value = pattern.value;
    option.textContent = pattern.label;
    input.patternSequence.append(option);
  }

  const optionValues = allOptions.map((option) => option.value);
  if (optionValues.includes(previousValue)) {
    input.patternSequence.value = previousValue;
  } else {
    input.patternSequence.value = allOptions[0].value;
  }

  if (isEvenPatternSelected()) {
    input.patternSequence.title = "Applies evenly distributed break durations for all crews.";
  } else {
    input.patternSequence.title = truncated
      ? "Showing the first equal-rest patterns. Reduce rounds for the full list."
      : "Choose a pattern option that keeps total rest equal across crews";
  }
}

function refreshPatternOptions() {
  const rounds = Number(input.rounds.value);
  if (rounds <= 1) {
    input.patternSequence.innerHTML = "";
    return;
  }

  let options = [];
  let truncated = false;

  try {
    const config = readPatternGenerationConfig();
    ({ options, truncated } = generateEqualRestPatternOptions(config));
  } catch (err) {
    options = [];
    truncated = false;
  }

  setPatternOptions(options, truncated);
}

function updateBreakInputsVisibility() {
  const rounds = Number(input.rounds.value);
  const crewCount = Number(input.crewCount.value);
  const multiBreak = rounds > 1;
  input.patternWrap.hidden = !multiBreak;
  input.patternSequence.required = multiBreak;
  input.shortBreakSyncToggle.disabled = !multiBreak;

  input.shortBreakDuration1Wrap.hidden = !multiBreak;
  input.shortBreakDuration2Wrap.hidden = !multiBreak;
  input.shortBreakDuration3Wrap.hidden = !multiBreak || crewCount < 3;
  input.shortBreakDuration1.required = false;
  input.shortBreakDuration2.required = false;
  input.shortBreakDuration3.required = false;

  setShortBreakMode(getShortBreakMode(), { copyFromCrew1: multiBreak });

  if (multiBreak) {
    try {
      refreshPatternOptions();
    } catch (err) {
      // Keep the current options while inputs are mid-edit.
    }
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

function buildSlotDurations(config, breakWindowLength, order) {
  const slotCount = config.crewCount * config.rounds;

  if (config.rounds > 1 && config.patternTokens) {
    const durations = Array(slotCount).fill(0);
    const eachCrewTarget = breakWindowLength / config.crewCount;
    if (!Number.isInteger(eachCrewTarget)) {
      throw new Error(
        "Break window cannot be split into equal whole-minute totals across crews."
      );
    }

    const slotIndexesByCrew = Array.from({ length: config.crewCount }, () => []);
    for (let i = 0; i < slotCount; i += 1) {
      slotIndexesByCrew[order[i] - 1].push(i);
    }

    for (let i = 0; i < slotCount; i += 1) {
      const token = config.patternTokens[i];
      if (token === "S") {
        if (!config.shortBreakDurationsByCrew) {
          throw new Error("Short break duration settings are required for this pattern.");
        }
        durations[i] = config.shortBreakDurationsByCrew[order[i]];
      }
    }

    for (let crew = 1; crew <= config.crewCount; crew += 1) {
      const crewSlotIndexes = slotIndexesByCrew[crew - 1];
      const longSlotIndexes = crewSlotIndexes.filter(
        (slotIndex) => config.patternTokens[slotIndex] === "L"
      );
      let crewShortTotal = 0;
      for (const slotIndex of crewSlotIndexes) {
        if (config.patternTokens[slotIndex] === "S") {
          crewShortTotal += durations[slotIndex];
        }
      }

      const longTotalNeeded = eachCrewTarget - crewShortTotal;
      if (longTotalNeeded < 0) {
        throw new Error(
          `Crew ${crew} short breaks exceed the equal-rest target for this shift.`
        );
      }

      if (!longSlotIndexes.length) {
        if (longTotalNeeded !== 0) {
          throw new Error("Pattern cannot produce equal total rest across crews.");
        }
        continue;
      }

      const longBase = Math.floor(longTotalNeeded / longSlotIndexes.length);
      let longRemainder = longTotalNeeded - longBase * longSlotIndexes.length;
      for (const slotIndex of longSlotIndexes) {
        durations[slotIndex] = longBase;
        if (longRemainder > 0) {
          durations[slotIndex] += 1;
          longRemainder -= 1;
        }
      }
    }

    return durations;
  }

  const baseSlotMinutes = Math.floor(breakWindowLength / slotCount);
  const remainder = breakWindowLength - baseSlotMinutes * slotCount;
  const durations = Array(slotCount).fill(baseSlotMinutes);

  const extrasByCrew = Array(config.crewCount).fill(
    Math.floor(remainder / config.crewCount)
  );
  for (let crew = 0; crew < remainder % config.crewCount; crew += 1) {
    extrasByCrew[crew] += 1;
  }

  const assignedExtrasByCrew = Array(config.crewCount).fill(0);
  for (let i = 0; i < slotCount; i += 1) {
    const crewIndex = order[i] - 1;
    if (assignedExtrasByCrew[crewIndex] < extrasByCrew[crewIndex]) {
      durations[i] += 1;
      assignedExtrasByCrew[crewIndex] += 1;
    }
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

  const order = crewOrder(config.crewCount, config.rounds);
  const slotCount = config.crewCount * config.rounds;
  const slotDurations = buildSlotDurations(config, breakWindowLength, order);
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
  const selectedPatternValue = String(input.patternSequence.value).trim();
  const evenMode = multiBreak && selectedPatternValue === evenPatternValue;
  const patternTokens =
    multiBreak && !evenMode
      ? parsePatternTokens(selectedPatternValue, slotCount)
      : null;
  const patternUsesShortDurations = Boolean(
    patternTokens && patternTokens.includes("S")
  );
  const config = {
    shiftStart: parseClock(input.shiftStart.value, "Off"),
    shiftEnd: parseClock(input.shiftEnd.value, "All on"),
    crewCount,
    rounds,
    shortBreakDurationsByCrew: null,
    patternTokens,
  };

  if (
    !allowedCrewCounts.includes(config.crewCount) ||
    config.rounds < 1
  ) {
    throw new Error(
      "Crew count must be 2 or 3. Check rounds and break duration settings."
    );
  }

  if (multiBreak && !evenMode && !patternTokens) {
    throw new Error(
      "No equal-rest pattern is available for the current inputs. Adjust crew settings and try again."
    );
  }

  if (patternUsesShortDurations) {
    config.shortBreakDurationsByCrew = readShortBreakDurationsByCrew(
      crewCount,
      getShortBreakMode()
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
      refreshPatternOptions();
      if (String(input.patternSequence.value).trim() && !isEvenPatternSelected()) {
        if (getShortBreakMode() === "same") {
          applyDurationNormalization(input.shortBreakDuration1);
          syncShortBreaksFromCrew1();
        } else {
          const crewCount = Number(input.crewCount.value);
          for (let crew = 1; crew <= crewCount; crew += 1) {
            applyDurationNormalization(shortBreakFieldForCrew(crew));
          }
        }
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

function captureFormState() {
  return {
    shiftStart: input.shiftStart.value,
    shiftEnd: input.shiftEnd.value,
    crewCount: input.crewCount.value,
    rounds: input.rounds.value,
    shortBreakDuration1: input.shortBreakDuration1.value,
    shortBreakDuration2: input.shortBreakDuration2.value,
    shortBreakDuration3: input.shortBreakDuration3.value,
    patternSequence: input.patternSequence.value,
    shortBreakMode: getShortBreakMode(),
  };
}

function formStatesMatch(a, b) {
  if (!a || !b) {
    return false;
  }

  return Object.keys(a).every((key) => a[key] === b[key]);
}

function applyFormState(state) {
  if (!state) {
    return;
  }

  input.shiftStart.value = state.shiftStart;
  input.shiftEnd.value = state.shiftEnd;
  input.crewCount.value = state.crewCount;
  input.rounds.value = state.rounds;
  input.shortBreakDuration1.value = state.shortBreakDuration1;
  input.shortBreakDuration2.value = state.shortBreakDuration2;
  input.shortBreakDuration3.value = state.shortBreakDuration3;
  input.patternSequence.value = state.patternSequence;

  setShortBreakMode(state.shortBreakMode, { copyFromCrew1: false });
  updateBreakInputsVisibility();

  input.shortBreakDuration1.value = state.shortBreakDuration1;
  input.shortBreakDuration2.value = state.shortBreakDuration2;
  input.shortBreakDuration3.value = state.shortBreakDuration3;
  input.patternSequence.value = state.patternSequence;
  setShortBreakMode(state.shortBreakMode, { copyFromCrew1: false });
  if (state.shortBreakMode === "same") {
    syncShortBreaksFromCrew1();
  }
}

function calculateCrewRestTotals(results, crewCount) {
  const totals = Array(crewCount).fill(0);
  for (const slot of results.slots) {
    totals[slot.crew - 1] += slot.duration;
  }
  return totals;
}

function buildUnevenRestWarning(totals) {
  const lines = totals
    .map((minutes, index) => `Crew ${index + 1}: ${formatDuration(minutes)}`)
    .join("\n");
  return `Warning: this selection gives crews different total rest periods.\n\n${lines}\n\nPress OK to keep this selection, or Cancel to undo it so you can correct the selection.`;
}

function guardSelectionChange() {
  if (isRevertingSelection) {
    return;
  }

  if (Number(input.rounds.value) > 1) {
    try {
      refreshPatternOptions();
    } catch (err) {
      runCalculation();
      return;
    }
  }

  const currentState = captureFormState();
  if (formStatesMatch(currentState, lastAcceptedState)) {
    runCalculation();
    return;
  }

  try {
    const config = readConfig();
    const results = calculateSchedule(config);
    const totals = calculateCrewRestTotals(results, config.crewCount);
    const isUneven = new Set(totals).size > 1;

    if (isUneven) {
      const keepSelection = window.confirm(buildUnevenRestWarning(totals));
      if (!keepSelection) {
        isRevertingSelection = true;
        applyFormState(lastAcceptedState);
        isRevertingSelection = false;
        runCalculation();
        return;
      }
    }

    lastAcceptedState = currentState;
    saveFormState(lastAcceptedState);
    runCalculation();
  } catch (err) {
    runCalculation();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  guardSelectionChange();
});

input.crewCount.addEventListener("change", () => {
  updateBreakInputsVisibility();
  guardSelectionChange();
});
input.rounds.addEventListener("change", () => {
  updateBreakInputsVisibility();
  guardSelectionChange();
});
input.shortBreakSyncToggle.addEventListener("click", () => {
  const nextMode = getShortBreakMode() === "same" ? "different" : "same";
  setShortBreakMode(nextMode);
  guardSelectionChange();
});
input.shiftStart.addEventListener("blur", () => {
  applyTimeNormalization(input.shiftStart);
  guardSelectionChange();
});
input.shiftEnd.addEventListener("blur", () => {
  applyTimeNormalization(input.shiftEnd);
  guardSelectionChange();
});
input.shortBreakDuration1.addEventListener("input", () => {
  if (getShortBreakMode() === "same") {
    syncShortBreaksFromCrew1();
  }
});
input.shortBreakDuration1.addEventListener("blur", () => {
  applyDurationNormalization(input.shortBreakDuration1);
  if (getShortBreakMode() === "same") {
    syncShortBreaksFromCrew1();
  }
  guardSelectionChange();
});
input.shortBreakDuration2.addEventListener("blur", () => {
  applyDurationNormalization(input.shortBreakDuration2);
  guardSelectionChange();
});
input.shortBreakDuration3.addEventListener("blur", () => {
  applyDurationNormalization(input.shortBreakDuration3);
  guardSelectionChange();
});
input.patternSequence.addEventListener("change", () => {
  guardSelectionChange();
});

applyTheme();
bindThemeControls();
bindThemeAutoUpdates();
bindTransferControls();

const persistedState = loadFormState();
if (persistedState) {
  applyFormState(persistedState);
} else {
  updateBreakInputsVisibility();
}
runCalculation();
lastAcceptedState = captureFormState();
saveFormState(lastAcceptedState);
registerServiceWorker();

window.addEventListener("beforeunload", () => {
  saveFormState(captureFormState());
});
