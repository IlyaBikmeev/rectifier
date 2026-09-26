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
    const previous = chart.$hoveredRunMarker;
    chart.$hoveredRunMarker = null;
    if (
      !chart.$pointSelectionActive &&
      args.event.type === "mousemove" &&
      chart.chartArea
    ) {
      chart.$hoveredRunMarker = (chart.$runMarkers || []).find((marker) =>
        Math.abs(chart.scales.x.getPixelForValue(marker.x) - args.event.x) <= 6 &&
        args.event.y >= chart.chartArea.top &&
        args.event.y <= chart.chartArea.bottom,
      ) || null;
    }
    if (previous !== chart.$hoveredRunMarker) args.changed = true;
  },
  afterDraw(chart) {
    const markers = chart.$runMarkers || [];
    const { ctx, chartArea } = chart;
    if (!chartArea) return;

    ctx.save();
    ctx.font = "11px sans-serif";
    const laneEnds = [-Infinity, -Infinity, -Infinity];
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
      const label = truncateLabel(ctx, marker.text, 110);
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
  let pointSelection = null;
  let previousCanvasTouchAction = null;
  let suppressCanvasClickUntil = 0;
  let markers = [];
  const availabilityListeners = new Set();
  const hiddenSensorIDs = new Set();

  function destroyChart() {
    if (!chart) return;
    chart.destroy();
    chart = null;
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
    chart.$runMarkers = markers;
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
      chart.$runMarkers = markers;
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
    if (notify) cancelled();
  }

  function beginPointSelection(onSelected, onCancelled) {
    if (!canSelectPoint()) return false;
    cancelPointSelection(false);
    pointSelection = { onSelected, onCancelled };
    chart.$pointSelectionPreview = null;
    chart.$pointSelectionActive = true;
    setTouchSelectionEnabled(true);
    setTemperatureInteractionEnabled(false);
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

  function show(nextRunID) {
    if (runID !== nextRunID) {
      destroy();
      runID = nextRunID;
      resetView();
    }
    panel.classList.remove("d-none");
  }

  function render(payload) {
    const from = new Date(payload.from).getTime();
    const to = new Date(payload.to).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      throw new Error("Unexpected measurement bounds");
    }

    const duration = Math.max(to - from, 1000);
    runStartedAt = from;
    runEndedAt = to;
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
          x: measuredAt - from,
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
      destroyChart();
      return;
    }

    if (chart) {
      chart.data.datasets = datasets;
      chart.options.scales.x.max = duration;
      chart.options.scales.x.ticks.callback = (value) =>
        formatTick(Number(value), duration, from);
      chart.$runMarkers = markers;
      chart.update("none");
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
              callback: (value) =>
                formatTick(Number(value), duration, from),
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
    chart.$runMarkers = markers;
    chart.draw();
    notifyAvailability();
  }

  function normalizeEvents(payload, expectedRunID, from) {
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
      return { id: event.id, text: event.text, occurredAt, x: occurredAt - from };
    });
  }

  async function refresh() {
    if (runID === null) return;

    const requestedRunID = runID;
    const requestedVersion = ++requestVersion;
    if (!hasResponse) loading.classList.remove("d-none");

    try {
      const [measurementsResult, eventsResult] = await Promise.allSettled([
        getRunMeasurements(requestedRunID),
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
          markers = normalizeEvents(
            eventsResult.value,
            requestedRunID,
            new Date(payload.from).getTime(),
          );
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
    const bounds = canvas.getBoundingClientRect();
    const pixel = event.clientX - bounds.left;
    const pixelY = event.clientY - bounds.top;
    if (
      pixel < chart.chartArea.left ||
      pixel > chart.chartArea.right ||
      pixelY < chart.chartArea.top ||
      pixelY > chart.chartArea.bottom
    ) return;
    if (!pointSelection) {
      const marker = markers.find(
        (candidate) =>
          Math.abs(chart.scales.x.getPixelForValue(candidate.x) - pixel) <= 12,
      );
      if (marker) showMarkerDetails(marker);
      return;
    }
    completePointSelection(chart.scales.x.getValueForPixel(pixel));
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (!pointSelection) return;
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!pointSelection || !chart || runStartedAt === null) return;
    const bounds = canvas.getBoundingClientRect();
    const pixel = Math.min(
      chart.chartArea.right,
      Math.max(chart.chartArea.left, event.clientX - bounds.left),
    );
    const value = Number.isFinite(chart.$pointSelectionPreview)
      ? chart.$pointSelectionPreview
      : chart.scales.x.getValueForPixel(pixel);
    suppressCanvasClickUntil = Date.now() + 1000;
    completePointSelection(value);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointSelection || !chart || runStartedAt === null) return;
    const bounds = canvas.getBoundingClientRect();
    const pixel = event.clientX - bounds.left;
    if (pixel < chart.chartArea.left || pixel > chart.chartArea.right) return;
    const value = Math.min(
      chart.scales.x.max,
      Math.max(chart.scales.x.min, chart.scales.x.getValueForPixel(pixel)),
    );
    chart.$pointSelectionPreview = value;
    selectionHint.querySelector("[data-event-pick-label]").textContent =
      `Выбрано ${absoluteTimeFormatter.format(new Date(runStartedAt + value))}. Отпустите, чтобы подтвердить.`;
    chart.draw();
  });
  selectionHint.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="cancel-event-pick"]')) cancelPointSelection();
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
