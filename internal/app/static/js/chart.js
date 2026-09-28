import { getRunEvents, getRunMeasurements } from "./api.js";

const colors = [
  "#3b78c8",
  "#4c9a5f",
  "#c58b20",
  "#d97732",
  "#8a60b0",
  "#2a98a6",
  "#6675b8",
  "#758f45",
];

const viewportStorageKey = "rectifier.chart.viewport.v1";
const defaultViewportSettings = { range: "all", yMode: "fixed" };
const supportedRanges = new Set([
  "all",
  "3600000",
  "1800000",
  "900000",
  "300000",
]);
const supportedYModes = new Set(["fixed", "auto"]);
const viewportListeners = new Set();
const minimumRangeSelectionPixels = 8;
const touchRangeSelectionAvailable =
  navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;

function isNarrowChartViewport() {
  return window.matchMedia("(max-width: 575.98px)").matches;
}

function loadViewportSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(viewportStorageKey));
    return {
      range: supportedRanges.has(saved?.range)
        ? saved.range
        : defaultViewportSettings.range,
      yMode: supportedYModes.has(saved?.yMode)
        ? saved.yMode
        : defaultViewportSettings.yMode,
    };
  } catch {
    return { ...defaultViewportSettings };
  }
}

let viewportSettings = loadViewportSettings();

function updateViewportSettings(patch) {
  viewportSettings = { ...viewportSettings, ...patch };
  try {
    window.localStorage.setItem(
      viewportStorageKey,
      JSON.stringify(viewportSettings),
    );
  } catch {
    // Keep the controls usable when browser storage is unavailable.
  }
  for (const listener of viewportListeners) listener(viewportSettings, patch);
}

function paletteIndexForHardwareID(hardwareID) {
  let hash = 2166136261;
  for (const character of hardwareID) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % colors.length;
}

function colorsByHardwareID(sensors) {
  const hardwareIDs = [...new Set(sensors.map((sensor) => sensor.hardware_id))]
    .sort();
  const baseIndexes = new Map(
    hardwareIDs.map((hardwareID) => [
      hardwareID,
      paletteIndexForHardwareID(hardwareID),
    ]),
  );
  const reservedIndexes = new Set(baseIndexes.values());
  const usedIndexes = new Set();
  const result = new Map();

  for (const hardwareID of hardwareIDs) {
    const baseIndex = baseIndexes.get(hardwareID);
    let paletteIndex = baseIndex;

    if (usedIndexes.has(paletteIndex) && usedIndexes.size < colors.length) {
      for (let offset = 1; offset < colors.length; offset += 1) {
        const candidate = (baseIndex + offset) % colors.length;
        if (!usedIndexes.has(candidate) && !reservedIndexes.has(candidate)) {
          paletteIndex = candidate;
          break;
        }
      }
    }

    if (usedIndexes.has(paletteIndex) && usedIndexes.size < colors.length) {
      for (let offset = 1; offset < colors.length; offset += 1) {
        const candidate = (baseIndex + offset) % colors.length;
        if (!usedIndexes.has(candidate)) {
          paletteIndex = candidate;
          break;
        }
      }
    }

    usedIndexes.add(paletteIndex);
    result.set(hardwareID, colors[paletteIndex]);
  }

  return result;
}

const absoluteTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const shortTickFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const longTickFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const multiDayTickFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const rangeTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const shortRangeTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const rangeDateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatDuration(totalMilliseconds) {
  const totalSeconds = Math.max(0, Math.floor(totalMilliseconds / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
    2,
    "0",
  );
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatTick(elapsedMilliseconds, runDuration, startedAt) {
  const measuredAt = new Date(startedAt + elapsedMilliseconds);
  if (runDuration < 3600000) {
    return shortTickFormatter.format(measuredAt);
  }
  if (runDuration < 86400000) return longTickFormatter.format(measuredAt);
  return multiDayTickFormatter.format(measuredAt);
}

function formatTooltipTitle(items) {
  if (items.length === 0) return "";

  const points = items
    .map((item) => item.raw)
    .sort((left, right) => left.measuredAt - right.measuredAt);
  const first = points[0];
  const last = points[points.length - 1];
  const firstAbsolute = absoluteTimeFormatter.format(
    new Date(first.measuredAt),
  );
  const lastAbsolute = absoluteTimeFormatter.format(
    new Date(last.measuredAt),
  );
  const elapsed =
    first.x === last.x
      ? formatDuration(first.x)
      : `${formatDuration(first.x)}–${formatDuration(last.x)}`;
  const absolute =
    first.measuredAt === last.measuredAt
      ? firstAbsolute
      : `${firstAbsolute}–${lastAbsolute}`;

  return [`От старта ${elapsed}`, absolute];
}

function formatVisibleRange(from, to) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const sameDay =
    fromDate.getFullYear() === toDate.getFullYear() &&
    fromDate.getMonth() === toDate.getMonth() &&
    fromDate.getDate() === toDate.getDate();
  if (!sameDay) {
    return `${rangeDateTimeFormatter.format(fromDate)} — ${rangeDateTimeFormatter.format(toDate)}`;
  }
  const formatter = to - from < 60000
    ? shortRangeTimeFormatter
    : rangeTimeFormatter;
  return `${formatter.format(fromDate)} — ${formatter.format(toDate)}`;
}

function truncateLabel(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function wrapLabel(context, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== "") lines.push(line);
    line = word;
    while (context.measureText(line).width > maxWidth && line.length > 1) {
      let splitAt = line.length - 1;
      while (
        splitAt > 1 &&
        context.measureText(line.slice(0, splitAt)).width > maxWidth
      ) {
        splitAt -= 1;
      }
      lines.push(line.slice(0, splitAt));
      line = line.slice(splitAt);
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

const runMarkersPlugin = {
  id: "runMarkers",
  afterEvent(chart, args) {
    if (!args.event || !["mousemove", "mouseout"].includes(args.event.type)) return;
    const previousCrosshair = chart.$crosshair;
    chart.$crosshair = null;
    const previous = chart.$hoveredRunMarker;
    chart.$hoveredRunMarker = null;
    if (
      !chart.$pointSelectionActive &&
      !chart.$rangeSelection &&
      args.event.type === "mousemove" &&
      chart.chartArea &&
      args.event.x >= chart.chartArea.left &&
      args.event.x <= chart.chartArea.right &&
      args.event.y >= chart.chartArea.top &&
      args.event.y <= chart.chartArea.bottom
    ) {
      chart.$crosshair = { x: args.event.x, y: args.event.y };
      chart.$hoveredRunMarker = (chart.$runMarkers || []).find((marker) =>
        Math.abs(chart.scales.x.getPixelForValue(marker.x) - args.event.x) <= 6 &&
        args.event.y >= chart.chartArea.top && args.event.y <= chart.chartArea.bottom,
      ) || null;
    }
    if (
      previous !== chart.$hoveredRunMarker ||
      previousCrosshair?.x !== chart.$crosshair?.x ||
      previousCrosshair?.y !== chart.$crosshair?.y
    ) args.changed = true;
  },
  afterDatasetsDraw(chart) {
    if (
      chart.$rangeSelection ||
      chart.$pointSelectionActive ||
      !chart.$crosshair ||
      !chart.chartArea
    ) return;

    const { ctx, chartArea } = chart;
    const { x, y } = chart.$crosshair;
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      chartArea.left,
      chartArea.top,
      chartArea.right - chartArea.left,
      chartArea.bottom - chartArea.top,
    );
    ctx.clip();
    ctx.strokeStyle = "rgba(108, 117, 125, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.restore();
  },
  afterDraw(chart) {
    const markers = chart.$runMarkers || [];
    const { ctx, chartArea } = chart;
    if (!chartArea) return;

    ctx.save();
    const rangeSelection = chart.$rangeSelection;
    if (rangeSelection?.active) {
      const left = Math.min(rangeSelection.startX, rangeSelection.currentX);
      const right = Math.max(rangeSelection.startX, rangeSelection.currentX);
      ctx.fillStyle = "rgba(13, 110, 253, 0.16)";
      ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
      ctx.strokeStyle = "rgba(13, 110, 253, 0.85)";
      ctx.lineWidth = 1;
      ctx.strokeRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
    }

    ctx.font = "11px sans-serif";
    const narrowViewport = chart.width < 576;
    const markerLabelWidth = narrowViewport ? 80 : 110;
    const laneEnds = Array(narrowViewport ? 2 : 3).fill(-Infinity);
    for (const marker of markers) {
      const x = chart.scales.x.getPixelForValue(marker.x);
      if (x < chartArea.left || x > chartArea.right) continue;
      const active =
        marker === chart.$hoveredRunMarker ||
        marker === chart.$selectedRunMarker;
      ctx.strokeStyle = active
        ? "rgba(13, 110, 253, 0.9)"
        : "rgba(33, 37, 41, 0.5)";
      ctx.lineWidth = active ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      const label = truncateLabel(ctx, marker.text, markerLabelWidth);
      const width = ctx.measureText(label).width + 8;
      const left = Math.min(Math.max(x + 3, chartArea.left), chartArea.right - width);
      const lane = laneEnds.findIndex((end) => left > end + 4);
      if (lane === -1) continue;
      laneEnds[lane] = left + width;
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.fillRect(left, chartArea.top + 3 + lane * 19, width, 17);
      ctx.fillStyle = active ? "#0d6efd" : "#212529";
      ctx.fillText(label, left + 4, chartArea.top + 15 + lane * 19);
    }

    if (Number.isFinite(chart.$pointSelectionPreview)) {
      const x = chart.scales.x.getPixelForValue(chart.$pointSelectionPreview);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(13, 110, 253, 0.9)";
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const hovered = chart.$hoveredRunMarker;
    if (hovered) {
      ctx.font = "12px sans-serif";
      const width = Math.min(320, chartArea.right - chartArea.left);
      const textLines = wrapLabel(ctx, hovered.text, width - 16);
      const timeLabel = absoluteTimeFormatter.format(new Date(hovered.occurredAt));
      const height = textLines.length * 17 + 29;
      const x = chart.scales.x.getPixelForValue(hovered.x);
      const left = Math.min(Math.max(x + 8, chartArea.left), chartArea.right - width);
      const top = chartArea.top + 25;
      ctx.fillStyle = "rgba(33, 37, 41, 0.94)";
      ctx.fillRect(left, top, width, height);
      ctx.fillStyle = "#fff";
      textLines.forEach((line, index) => {
        ctx.fillText(line, left + 8, top + 17 + index * 17);
      });
      ctx.fillStyle = "#dee2e6";
      ctx.fillText(timeLabel, left + 8, top + height - 9);
    }

    ctx.restore();
  },
};

export function createRunChart({
  panel,
  loading,
  empty,
  container,
  error,
  canvas,
  viewportControls,
  selectionHint,
  markerDetails,
  onEditMarker,
  onDeleteMarker,
}) {
  let chart = null;
  let runID = null;
  let requestVersion = 0;
  let hasResponse = false;
  let runStartedAt = null;
  let runEndedAt = null;
  let runIsActive = false;
  let responseFrom = null;
  let responseTo = null;
  let manualWindow = null;
  let rangeSelection = null;
  let touchRangeMode = false;
  let pointSelection = null;
  let previousCanvasTouchAction = null;
  let suppressCanvasClickUntil = 0;
  let markers = [];
  const availabilityListeners = new Set();
  const hiddenSensorIDs = new Set();
  const emptyLabel = empty.querySelector("[data-chart-empty-label]");
  const defaultEmptyLabel = emptyLabel.textContent;
  const touchRangePrompt = panel.querySelector(
    "[data-chart-touch-range-prompt]",
  );

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.clientWidth / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.clientHeight / bounds.height),
    };
  }

  function clampChartX(x) {
    return Math.min(chart.chartArea.right, Math.max(chart.chartArea.left, x));
  }

  function visibleXBounds() {
    if (
      runStartedAt === null ||
      responseFrom === null ||
      responseTo === null
    ) return null;
    return {
      min: responseFrom - runStartedAt,
      max: Math.max(
        responseTo - runStartedAt,
        responseFrom - runStartedAt + 1000,
      ),
    };
  }

  function autoYBounds(xBounds) {
    if (!chart || !xBounds) return null;
    let minimum = Infinity;
    let maximum = -Infinity;
    chart.data.datasets.forEach((dataset, index) => {
      if (!chart.isDatasetVisible(index)) return;
      for (const point of dataset.data) {
        if (point.x < xBounds.min || point.x > xBounds.max) continue;
        minimum = Math.min(minimum, point.y);
        maximum = Math.max(maximum, point.y);
      }
    });
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;

    const midpoint = (minimum + maximum) / 2;
    const range = Math.max((maximum - minimum) * 1.2, 0.5);
    return { min: midpoint - range / 2, max: midpoint + range / 2 };
  }

  function renderViewportControls() {
    for (const button of viewportControls.querySelectorAll(
      "[data-chart-range]",
    )) {
      const active =
        manualWindow === null &&
        button.dataset.chartRange === viewportSettings.range;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of viewportControls.querySelectorAll(
      "[data-chart-y-mode]",
    )) {
      const active = button.dataset.chartYMode === viewportSettings.yMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    const rangeLabel = viewportControls.querySelector(
      "[data-chart-visible-range]",
    );
    rangeLabel.textContent =
      responseFrom === null || responseTo === null
        ? "—"
        : formatVisibleRange(responseFrom, responseTo);

    const touchControls = viewportControls.querySelector(
      "[data-chart-touch-range-controls]",
    );
    touchControls.classList.toggle(
      "d-none",
      !touchRangeSelectionAvailable || touchRangeMode,
    );
    const touchButton = touchControls.querySelector(
      '[data-action="toggle-touch-range"]',
    );
    touchButton.setAttribute("aria-pressed", String(touchRangeMode));
    touchButton.disabled = pointSelection !== null || chart === null;
    touchRangePrompt.classList.toggle("d-none", !touchRangeMode);
  }

  function applyViewport() {
    renderViewportControls();
    if (!chart) return;

    const xBounds = visibleXBounds();
    chart.options.scales.x.min = xBounds.min;
    chart.options.scales.x.max = xBounds.max;

    const yBounds =
      viewportSettings.yMode === "auto"
        ? autoYBounds(xBounds)
        : { min: 0, max: 100 };
    chart.options.scales.y.min = yBounds?.min ?? 0;
    chart.options.scales.y.max = yBounds?.max ?? 100;
    chart.update("none");
  }

  viewportControls.addEventListener("click", (event) => {
    const rangeButton = event.target.closest("[data-chart-range]");
    if (rangeButton) {
      setTouchRangeMode(false);
      manualWindow = null;
      updateViewportSettings({ range: rangeButton.dataset.chartRange });
      return;
    }
    if (event.target.closest('[data-action="toggle-touch-range"]')) {
      setTouchRangeMode(!touchRangeMode);
      return;
    }
    if (event.target.closest('[data-action="cancel-touch-range"]')) {
      setTouchRangeMode(false);
      return;
    }
    const yModeButton = event.target.closest("[data-chart-y-mode]");
    if (yModeButton) {
      updateViewportSettings({ yMode: yModeButton.dataset.chartYMode });
    }
  });
  function viewportChanged(_settings, patch) {
    if (patch.range !== undefined) {
      setTouchRangeMode(false);
      manualWindow = null;
    }
    renderViewportControls();
    if (patch.range !== undefined && runID !== null) {
      refresh();
      return;
    }
    applyViewport();
  }

  viewportListeners.add(viewportChanged);
  renderViewportControls();

  function destroyChart() {
    if (!chart) return;
    setTouchRangeMode(false);
    chart.destroy();
    chart = null;
    renderViewportControls();
    notifyAvailability();
  }

  function destroy() {
    cancelPointSelection(false);
    hideMarkerDetails();
    requestVersion += 1;
    runID = null;
    hasResponse = false;
    hiddenSensorIDs.clear();
    markers = [];
    runStartedAt = null;
    runEndedAt = null;
    runIsActive = false;
    responseFrom = null;
    responseTo = null;
    manualWindow = null;
    cancelRangeSelection();
    destroyChart();
  }

  function canSelectPoint() {
    return chart !== null && runStartedAt !== null;
  }

  function getTimeBounds() {
    if (runStartedAt === null || runEndedAt === null) return null;
    return { from: runStartedAt, to: runEndedAt };
  }

  function notifyAvailability() {
    const available = canSelectPoint();
    for (const listener of availabilityListeners) listener(available);
  }

  function onAvailabilityChanged(listener) {
    availabilityListeners.add(listener);
    listener(canSelectPoint());
    return () => availabilityListeners.delete(listener);
  }

  function hideMarkerDetails() {
    markerDetails.classList.add("d-none");
    if (chart) {
      chart.$selectedRunMarker = null;
      chart.draw();
    }
  }

  function showMarkerDetails(marker) {
    chart.$selectedRunMarker = marker;
    markerDetails.querySelector("[data-marker-text]").textContent = marker.text;
    const markerTime = markerDetails.querySelector("[data-marker-time]");
    markerTime.dateTime = new Date(marker.occurredAt).toISOString();
    markerTime.textContent = absoluteTimeFormatter.format(
      new Date(marker.occurredAt),
    );
    markerDetails.classList.remove("d-none");
    chart.draw();
  }

  function deleteMarker(eventID) {
    markers = markers.filter((marker) => marker.id !== eventID);
    hideMarkerDetails();
    if (!chart) return;
    chart.$runMarkers = visibleMarkers();
    chart.draw();
  }

  function replaceMarker(event) {
    if (runID === null || runStartedAt === null) return false;
    const [replacement] = normalizeEvents([event], runID, runStartedAt);
    const index = markers.findIndex((marker) => marker.id === replacement.id);
    if (index === -1) return false;
    markers[index] = replacement;
    markers.sort(
      (left, right) => left.occurredAt - right.occurredAt || left.id - right.id,
    );
    if (chart) {
      chart.$runMarkers = visibleMarkers();
      showMarkerDetails(replacement);
    }
    return true;
  }

  function setTemperatureInteractionEnabled(enabled) {
    if (!chart) return;
    chart.options.plugins.tooltip.enabled = enabled;
    for (const dataset of chart.data.datasets) {
      dataset.pointHoverRadius = enabled ? 4 : 0;
    }
    if (!enabled) {
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
    }
    chart.update("none");
  }

  function cancelRangeSelection() {
    const interactionWasDisabled = rangeSelection !== null;
    rangeSelection = null;
    if (!chart) return;
    chart.$rangeSelection = null;
    if (interactionWasDisabled) setTemperatureInteractionEnabled(true);
    else chart.draw();
  }

  function setTouchSelectionEnabled(enabled) {
    if (enabled) {
      if (previousCanvasTouchAction === null) {
        previousCanvasTouchAction = canvas.style.touchAction;
      }
      canvas.style.touchAction = "none";
      return;
    }
    if (previousCanvasTouchAction === null) return;
    canvas.style.touchAction = previousCanvasTouchAction;
    previousCanvasTouchAction = null;
  }

  function setTouchRangeMode(enabled) {
    const next = Boolean(
      enabled && touchRangeSelectionAvailable && !pointSelection && chart,
    );
    if (touchRangeMode === next) {
      renderViewportControls();
      return;
    }
    if (!next) cancelRangeSelection();
    touchRangeMode = next;
    setTouchSelectionEnabled(next || pointSelection !== null);
    renderViewportControls();
  }

  function cancelPointSelection(notify = true) {
    if (!pointSelection) return;
    const cancelled = pointSelection.onCancelled;
    pointSelection = null;
    setTouchSelectionEnabled(false);
    if (chart) {
      chart.$pointSelectionPreview = null;
      chart.$pointSelectionActive = false;
      setTemperatureInteractionEnabled(true);
    }
    selectionHint.classList.add("d-none");
    renderViewportControls();
    if (notify) cancelled();
  }

  function beginPointSelection(onSelected, onCancelled) {
    if (!canSelectPoint()) return false;
    setTouchRangeMode(false);
    cancelPointSelection(false);
    pointSelection = { onSelected, onCancelled };
    chart.$crosshair = null;
    chart.$pointSelectionPreview = null;
    chart.$pointSelectionActive = true;
    setTouchSelectionEnabled(true);
    setTemperatureInteractionEnabled(false);
    renderViewportControls();
    // TODO: Adapt selection hints by pointer type: click for mouse, release for touch.
    selectionHint.querySelector("[data-event-pick-label]").textContent =
      "Текст сохранён. Коснитесь графика и проведите до нужного момента.";
    selectionHint.classList.remove("d-none");
    return true;
  }

  function completePointSelection(value) {
    if (
      !pointSelection ||
      !chart ||
      runStartedAt === null ||
      runEndedAt === null
    ) return;
    const clamped = Math.min(
      runEndedAt - runStartedAt,
      Math.max(chart.scales.x.min, value),
    );
    const selected = new Date(runStartedAt + clamped).toISOString();
    const callback = pointSelection.onSelected;
    pointSelection = null;
    setTouchSelectionEnabled(false);
    chart.$pointSelectionPreview = null;
    chart.$pointSelectionActive = false;
    setTemperatureInteractionEnabled(true);
    selectionHint.classList.add("d-none");
    renderViewportControls();
    callback(selected);
  }

  function resetView() {
    error.classList.add("d-none");
    loading.classList.remove("d-none");
    empty.classList.add("d-none");
    container.classList.add("d-none");
  }

  function hide() {
    destroy();
    panel.classList.add("d-none");
    resetView();
  }

  function show(run) {
    if (
      !Number.isInteger(run?.id) ||
      !Number.isFinite(run.startedAt) ||
      (run.stoppedAt != null && !Number.isFinite(run.stoppedAt)) ||
      (run.serverTime !== undefined && !Number.isFinite(run.serverTime))
    ) {
      throw new Error("Unexpected run chart metadata");
    }
    if (runID !== run.id) {
      destroy();
      runID = run.id;
      resetView();
    }
    runStartedAt = run.startedAt;
    runIsActive = run.stoppedAt == null;
    runEndedAt = run.stoppedAt ?? run.serverTime ?? Date.now();
    panel.classList.remove("d-none");
  }

  function render(payload) {
    const from = new Date(payload.from).getTime();
    const to = new Date(payload.to).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      throw new Error("Unexpected measurement bounds");
    }

    if (runIsActive && to > runEndedAt) runEndedAt = to;
    if (runStartedAt === null || from < runStartedAt || to > runEndedAt) {
      throw new Error("Measurement bounds are outside the run");
    }
    const duration = Math.max(to - from, 1000);
    responseFrom = from;
    responseTo = to;
    renderViewportControls();
    if (chart) {
      chart.data.datasets.forEach((dataset, index) => {
        if (chart.isDatasetVisible(index)) {
          hiddenSensorIDs.delete(dataset.sensorHardwareID);
        } else {
          hiddenSensorIDs.add(dataset.sensorHardwareID);
        }
      });
    }

    let pointCount = 0;
    const sensorColors = colorsByHardwareID(payload.sensors);
    const datasets = payload.sensors.map((sensor) => {
      if (!Array.isArray(sensor.measurements)) {
        throw new Error("Unexpected sensor measurements");
      }
      const data = sensor.measurements.map((measurement) => {
        const measuredAt = new Date(measurement.measured_at).getTime();
        if (
          !Number.isFinite(measuredAt) ||
          !Number.isFinite(measurement.value)
        ) {
          throw new Error("Unexpected measurement point");
        }
        return {
          x: measuredAt - runStartedAt,
          y: measurement.value,
          measuredAt,
        };
      });
      pointCount += data.length;
      const color = sensorColors.get(sensor.hardware_id);
      return {
        label: sensor.name,
        sensorHardwareID: sensor.hardware_id,
        data,
        parsing: false,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: pointSelection ? 0 : 4,
        pointHitRadius: 12,
        tension: 0,
        fill: false,
        hidden: hiddenSensorIDs.has(sensor.hardware_id),
      };
    });

    hasResponse = true;
    loading.classList.add("d-none");
    empty.classList.toggle("d-none", pointCount > 0);
    container.classList.toggle("d-none", pointCount === 0);

    if (pointCount === 0) {
      emptyLabel.textContent = manualWindow === null
        ? defaultEmptyLabel
        : "В выбранном диапазоне нет измерений";
      destroyChart();
      return;
    }

    if (chart) {
      chart.data.datasets = datasets;
      chart.options.scales.x.ticks.callback = (value) =>
        formatTick(Number(value), duration, runStartedAt);
      chart.$runMarkers = visibleMarkers();
      applyViewport();
      notifyAvailability();
      return;
    }

    chart = new window.Chart(canvas, {
      type: "line",
      plugins: [runMarkersPlugin],
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        normalized: true,
        interaction: { mode: "index", intersect: false, axis: "x" },
        onResize(resizedChart) {
          resizedChart.$crosshair = null;
          resizedChart.options.scales.x.ticks.maxTicksLimit =
            isNarrowChartViewport() ? 4 : undefined;
          cancelRangeSelection();
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: duration,
            border: { display: false },
            grid: {
              color: "rgba(108, 117, 125, 0.12)",
              tickLength: 4,
            },
            title: { display: true, text: "Время" },
            ticks: {
              color: "#6c757d",
              maxRotation: 0,
              maxTicksLimit: isNarrowChartViewport() ? 4 : undefined,
              callback: (value) =>
                formatTick(Number(value), duration, runStartedAt),
            },
          },
          y: {
            beginAtZero: false,
            grace: "5%",
            border: { display: false },
            grid: {
              color: "rgba(108, 117, 125, 0.12)",
              tickLength: 4,
            },
            title: { display: true, text: "Температура, °C" },
            ticks: { color: "#6c757d" },
          },
        },
        plugins: {
          legend: {
            position: "bottom",
            onClick(event, legendItem, legend) {
              window.Chart.defaults.plugins.legend.onClick(
                event,
                legendItem,
                legend,
              );
              applyViewport();
            },
            labels: {
              usePointStyle: true,
              pointStyle: "line",
              boxWidth: 28,
              boxHeight: 2,
              padding: 16,
              color: "#6c757d",
            },
          },
          tooltip: {
            position: "nearest",
            padding: 10,
            bodySpacing: 4,
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            callbacks: {
              title: formatTooltipTitle,
              label: (context) =>
                `${context.dataset.label}: ${context.parsed.y.toFixed(1)} °C`,
            },
          },
        },
      },
    });
    chart.$runMarkers = visibleMarkers();
    applyViewport();
    notifyAvailability();
  }

  function normalizeEvents(payload, expectedRunID) {
    if (!Array.isArray(payload)) throw new Error("Unexpected events response format");
    return payload.map((event) => {
      const occurredAt = new Date(event?.occurred_at).getTime();
      if (
        !Number.isInteger(event?.id) ||
        event.run_id !== expectedRunID ||
        typeof event.text !== "string" ||
        event.text.trim() === "" ||
        !Number.isFinite(occurredAt)
      ) {
        throw new Error("Unexpected run event");
      }
      return {
        id: event.id,
        text: event.text,
        occurredAt,
        x: occurredAt - runStartedAt,
      };
    });
  }

  function visibleMarkers() {
    if (responseFrom === null || responseTo === null) return [];
    return markers.filter(
      (marker) =>
        marker.occurredAt >= responseFrom && marker.occurredAt <= responseTo,
    );
  }

  function measurementWindow() {
    if (manualWindow !== null) {
      return {
        from: new Date(manualWindow.from).toISOString(),
        to: new Date(manualWindow.to).toISOString(),
      };
    }
    if (viewportSettings.range === "all") return {};
    if (runStartedAt === null || runEndedAt === null) return {};
    const to = runEndedAt;
    const from = Math.max(runStartedAt, to - Number(viewportSettings.range));
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    };
  }

  async function refresh({ poll = false } = {}) {
    if (runID === null) return;
    if (poll && manualWindow !== null && hasResponse) return;

    const requestedRunID = runID;
    const requestedVersion = ++requestVersion;
    if (!hasResponse) loading.classList.remove("d-none");

    try {
      const [measurementsResult, eventsResult] = await Promise.allSettled([
        getRunMeasurements(requestedRunID, measurementWindow()),
        getRunEvents(requestedRunID),
      ]);
      if (measurementsResult.status === "rejected") throw measurementsResult.reason;
      const payload = measurementsResult.value;
      if (
        payload.run_id !== requestedRunID ||
        !Array.isArray(payload.sensors)
      ) {
        throw new Error("Unexpected measurements response format");
      }
      if (
        requestedVersion !== requestVersion ||
        requestedRunID !== runID
      ) {
        return;
      }
      let eventsError = null;
      if (eventsResult.status === "fulfilled") {
        try {
          markers = normalizeEvents(eventsResult.value, requestedRunID);
        } catch (validationError) {
          eventsError = validationError;
        }
      } else {
        eventsError = eventsResult.reason;
      }
      render(payload);
      if (eventsError) {
        console.error("Failed to load run events:", eventsError);
        error.textContent = "Не удалось обновить метки. График и последние полученные метки сохранены.";
        error.classList.remove("d-none");
      } else {
        error.classList.add("d-none");
      }
    } catch (refreshError) {
      if (
        requestedVersion !== requestVersion ||
        requestedRunID !== runID
      ) {
        return;
      }
      console.error("Failed to load run measurements:", refreshError);
      error.textContent = "Не удалось обновить график. Показаны последние полученные данные.";
      loading.classList.add("d-none");
      error.classList.remove("d-none");
      if (!hasResponse) empty.classList.remove("d-none");
    }
  }

  canvas.addEventListener("click", (event) => {
    if (Date.now() < suppressCanvasClickUntil) {
      suppressCanvasClickUntil = 0;
      return;
    }
    if (!chart || runStartedAt === null) return;
    const { x: pixel, y: pixelY } = canvasPoint(event);
    if (
      pixel < chart.chartArea.left ||
      pixel > chart.chartArea.right ||
      pixelY < chart.chartArea.top ||
      pixelY > chart.chartArea.bottom
    ) return;
    if (!pointSelection) {
      const marker = visibleMarkers().find(
        (candidate) =>
          Math.abs(chart.scales.x.getPixelForValue(candidate.x) - pixel) <= 12,
      );
      if (marker) showMarkerDetails(marker);
      return;
    }
    completePointSelection(chart.scales.x.getValueForPixel(pixel));
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (pointSelection) {
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    const isMouseSelection = event.pointerType === "mouse" && event.button === 0;
    const isTouchSelection = event.pointerType === "touch" && touchRangeMode;
    if (
      (!isMouseSelection && !isTouchSelection) ||
      !chart ||
      !chart.chartArea
    ) return;
    const { x, y } = canvasPoint(event);
    if (
      x < chart.chartArea.left ||
      x > chart.chartArea.right ||
      y < chart.chartArea.top ||
      y > chart.chartArea.bottom
    ) return;
    const clampedX = clampChartX(x);
    rangeSelection = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: clampedX,
      startY: y,
      currentX: clampedX,
      active: false,
    };
    chart.$rangeSelection = rangeSelection;
    chart.$crosshair = null;
    chart.$hoveredRunMarker = null;
    setTemperatureInteractionEnabled(false);
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (pointSelection) {
      if (!chart || runStartedAt === null) return;
      const pixel = clampChartX(canvasPoint(event).x);
      const value = Number.isFinite(chart.$pointSelectionPreview)
        ? chart.$pointSelectionPreview
        : chart.scales.x.getValueForPixel(pixel);
      suppressCanvasClickUntil = Date.now() + 1000;
      completePointSelection(value);
      return;
    }
    if (
      !rangeSelection ||
      rangeSelection.pointerId !== event.pointerId ||
      !chart ||
      runStartedAt === null
    ) return;
    rangeSelection.currentX = clampChartX(canvasPoint(event).x);
    if (!rangeSelection.active) {
      cancelRangeSelection();
      const { x, y } = canvasPoint(event);
      if (
        x >= chart.chartArea.left &&
        x <= chart.chartArea.right &&
        y >= chart.chartArea.top &&
        y <= chart.chartArea.bottom
      ) {
        chart.$crosshair = { x, y };
        chart.draw();
      }
      return;
    }

    const fromValue = chart.scales.x.getValueForPixel(
      Math.min(rangeSelection.startX, rangeSelection.currentX),
    );
    const toValue = chart.scales.x.getValueForPixel(
      Math.max(rangeSelection.startX, rangeSelection.currentX),
    );
    // The X scale stores elapsed milliseconds from runStartedAt, not Unix time.
    const from = runStartedAt + fromValue;
    const to = runStartedAt + toValue;
    const completedTouchSelection = rangeSelection.pointerType === "touch";
    cancelRangeSelection();
    suppressCanvasClickUntil = Date.now() + 1000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;

    if (completedTouchSelection) setTouchRangeMode(false);

    manualWindow = { from, to };
    hideMarkerDetails();
    renderViewportControls();
    refresh();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pointSelection) {
      if (!chart || runStartedAt === null) return;
      const pixel = clampChartX(canvasPoint(event).x);
      const value = Math.min(
        chart.scales.x.max,
        Math.max(chart.scales.x.min, chart.scales.x.getValueForPixel(pixel)),
      );
      chart.$pointSelectionPreview = value;
      selectionHint.querySelector("[data-event-pick-label]").textContent =
        `Выбрано ${absoluteTimeFormatter.format(new Date(runStartedAt + value))}. Отпустите, чтобы подтвердить.`;
      chart.draw();
      return;
    }
    if (
      !rangeSelection ||
      rangeSelection.pointerId !== event.pointerId ||
      !chart
    ) return;
    rangeSelection.currentX = clampChartX(canvasPoint(event).x);
    const horizontalDelta = Math.abs(
      rangeSelection.currentX - rangeSelection.startX,
    );
    const verticalDelta = Math.abs(
      canvasPoint(event).y - rangeSelection.startY,
    );
    const directionAccepted =
      rangeSelection.pointerType === "mouse" || horizontalDelta > verticalDelta;
    if (
      !rangeSelection.active &&
      horizontalDelta >= minimumRangeSelectionPixels &&
      directionAccepted
    ) {
      rangeSelection.active = true;
    }
    if (rangeSelection.active) chart.draw();
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (rangeSelection?.pointerId === event.pointerId) cancelRangeSelection();
  });
  canvas.addEventListener("lostpointercapture", (event) => {
    if (rangeSelection?.pointerId === event.pointerId) cancelRangeSelection();
  });
  selectionHint.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="cancel-event-pick"]')) cancelPointSelection();
  });
  touchRangePrompt.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="cancel-touch-range"]')) {
      setTouchRangeMode(false);
    }
  });
  markerDetails.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="close-marker-details"]')) {
      hideMarkerDetails();
      return;
    }
    if (event.target.closest('[data-action="edit-marker"]')) {
      const marker = chart?.$selectedRunMarker;
      if (marker) onEditMarker(marker);
      return;
    }
    if (event.target.closest('[data-action="delete-marker"]')) {
      const marker = chart?.$selectedRunMarker;
      if (marker) onDeleteMarker(marker);
    }
  });

  return {
    show,
    refresh,
    hide,
    destroy,
    canSelectPoint,
    beginPointSelection,
    cancelPointSelection,
    onAvailabilityChanged,
    getTimeBounds,
    deleteMarker,
    replaceMarker,
  };
}
