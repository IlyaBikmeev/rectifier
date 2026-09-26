import { getRunMeasurements } from "./api.js";

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

export function createRunChart({
  panel,
  loading,
  empty,
  container,
  error,
  canvas,
}) {
  let chart = null;
  let runID = null;
  let requestVersion = 0;
  let hasResponse = false;
  const hiddenSensorIDs = new Set();

  function destroyChart() {
    if (!chart) return;
    chart.destroy();
    chart = null;
  }

  function destroy() {
    requestVersion += 1;
    runID = null;
    hasResponse = false;
    hiddenSensorIDs.clear();
    destroyChart();
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
        pointHoverRadius: 4,
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
      chart.update("none");
      return;
    }

    chart = new window.Chart(canvas, {
      type: "line",
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
  }

  async function refresh() {
    if (runID === null) return;

    const requestedRunID = runID;
    const requestedVersion = ++requestVersion;
    if (!hasResponse) loading.classList.remove("d-none");

    try {
      const payload = await getRunMeasurements(requestedRunID);
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
      render(payload);
      error.classList.add("d-none");
    } catch (refreshError) {
      if (
        requestedVersion !== requestVersion ||
        requestedRunID !== runID
      ) {
        return;
      }
      console.error("Failed to load run measurements:", refreshError);
      loading.classList.add("d-none");
      error.classList.remove("d-none");
      if (!hasResponse) empty.classList.remove("d-none");
    }
  }

  return { show, refresh, hide, destroy };
}
