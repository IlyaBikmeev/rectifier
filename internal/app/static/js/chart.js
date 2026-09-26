import { getRunMeasurements } from "./api.js";

const colors = [
  "#0d6efd",
  "#dc3545",
  "#198754",
  "#fd7e14",
  "#6f42c1",
  "#0aa2c0",
];
const pointStyles = [
  "circle",
  "rect",
  "triangle",
  "rectRot",
  "crossRot",
  "star",
];
const absoluteTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
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

function formatTick(elapsedMilliseconds, runDuration) {
  const totalMinutes = Math.max(
    0,
    Math.floor(elapsedMilliseconds / 60000),
  );
  const seconds = String(
    Math.max(0, Math.floor(elapsedMilliseconds / 1000)) % 60,
  ).padStart(2, "0");
  if (runDuration < 3600000) {
    return `${String(totalMinutes).padStart(2, "0")}:${seconds}`;
  }
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
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
    const datasets = payload.sensors.map((sensor, index) => {
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
      const paletteIndex = index % colors.length;
      return {
        label: sensor.name,
        sensorHardwareID: sensor.hardware_id,
        data,
        parsing: false,
        borderColor: colors[paletteIndex],
        backgroundColor: colors[paletteIndex],
        pointStyle: pointStyles[paletteIndex],
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        tension: 0.15,
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
        formatTick(Number(value), duration);
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
        interaction: { mode: "nearest", intersect: false },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: duration,
            title: { display: true, text: "Время от начала перегона" },
            ticks: {
              callback: (value) => formatTick(Number(value), duration),
            },
          },
          y: {
            title: { display: true, text: "Температура, °C" },
          },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                if (items.length === 0) return "";
                const point = items[0].raw;
                return `${formatDuration(point.x)} · ${absoluteTimeFormatter.format(new Date(point.measuredAt))}`;
              },
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
