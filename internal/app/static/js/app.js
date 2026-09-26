import {
  createBatch,
  createRun,
  getBatches,
  getProcess,
  getRunMeasurements,
  getSensorStatus,
  stopRun,
  updateSensor,
} from "./api.js";
import { initRouter } from "./router.js";

const routes = new Map([
  ["#/", document.getElementById("home-view")],
  ["#/history", document.getElementById("history-view")],
]);
const navigation = document.getElementById("main-navigation");
initRouter({ routes, navigationElement: navigation });

const statusPollingInterval = 5000;
const lastReadFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const sensorMetadata = new Map();
let latestSensors = [];
let runSensorAvailabilityWarning = "";

const processCard = document.getElementById("process-card");
const processStopped = document.getElementById("process-stopped");
const processRunning = document.getElementById("process-running");
const processSyncWarning = document.getElementById(
  "process-sync-warning",
);
const startRunButton = document.getElementById("open-start-run");
const stopRunButton = document.getElementById("stop-run-button");
const stopRunModalElement = document.getElementById("stop-run-modal");
const stopRunModal =
  window.bootstrap.Modal.getOrCreateInstance(stopRunModalElement);
const stopRunSubmit = document.getElementById("submit-stop-run");
const stopRunDisabledReason = document.getElementById(
  "stop-run-disabled-reason",
);
const stopRunError = document.getElementById("stop-run-error");
const startRunModalElement = document.getElementById("start-run-modal");
const startRunModal =
  window.bootstrap.Modal.getOrCreateInstance(startRunModalElement);
const startRunForm = document.getElementById("start-run-form");
const startRunSubmit = document.getElementById("submit-start-run");
const startRunDisabledReason = document.getElementById(
  "start-run-disabled-reason",
);
const startRunError = document.getElementById("start-run-error");
const batchLoadStatus = document.getElementById("batch-load-status");
const batchLoadError = document.getElementById("batch-load-error");
const batchOptions = document.getElementById("batch-options");
const batchSelect = document.getElementById("batch-select");
const newBatchFields = document.getElementById("new-batch-fields");
const newBatchName = document.getElementById("new-batch-name");
const newBatchComment = document.getElementById("new-batch-comment");
const runSensorsError = document.getElementById("run-sensors-error");
let confirmedProcess = { status: "STOPPED", active_run: null };
let serverClockOffset = 0;
let processSynchronized = false;
let statusSynchronized = false;
let batchesLoaded = false;
let batchesLoading = false;
let startRunSubmitting = false;
let stopRunSubmitting = false;
const runChartPanel = document.getElementById("run-chart-panel");
const runChartLoading = document.getElementById("run-chart-loading");
const runChartEmpty = document.getElementById("run-chart-empty");
const runChartContainer = document.getElementById(
  "run-chart-container",
);
const runChartError = document.getElementById("run-chart-error");
const runChartCanvas = document.getElementById("run-chart");
const runChartColors = [
  "#0d6efd",
  "#dc3545",
  "#198754",
  "#fd7e14",
  "#6f42c1",
  "#0aa2c0",
];
const runChartPointStyles = [
  "circle",
  "rect",
  "triangle",
  "rectRot",
  "crossRot",
  "star",
];
const chartAbsoluteTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
let runChart = null;
let runChartRunID = null;
let runChartRequestVersion = 0;
let runChartHasResponse = false;
const runChartHiddenSensorIDs = new Set();

function destroyRunChart() {
  if (runChart) {
    runChart.destroy();
    runChart = null;
  }
}

function hideRunChart() {
  runChartRequestVersion += 1;
  runChartRunID = null;
  runChartHasResponse = false;
  runChartHiddenSensorIDs.clear();
  destroyRunChart();
  runChartPanel.classList.add("d-none");
  runChartError.classList.add("d-none");
  runChartLoading.classList.remove("d-none");
  runChartEmpty.classList.add("d-none");
  runChartContainer.classList.add("d-none");
}

function showRunChart(runID) {
  if (runChartRunID !== runID) {
    runChartRequestVersion += 1;
    runChartRunID = runID;
    runChartHasResponse = false;
    runChartHiddenSensorIDs.clear();
    destroyRunChart();
    runChartError.classList.add("d-none");
    runChartLoading.classList.remove("d-none");
    runChartEmpty.classList.add("d-none");
    runChartContainer.classList.add("d-none");
  }
  runChartPanel.classList.remove("d-none");
}

function selectedRunSensorIDs() {
  return [
    ...startRunForm.querySelectorAll(
      'input[name="sensor_hardware_ids"]:checked:not(:disabled)',
    ),
  ].map((input) => input.value);
}

function updateStartRunAvailability() {
  const isNewBatch = batchSelect.value === "new";
  const hasBatch = isNewBatch
    ? newBatchName.value.trim().length > 0
    : batchSelect.value.length > 0;
  const hasSensor = selectedRunSensorIDs().length > 0;
  let reason = "";

  if (startRunSubmitting) reason = "Начинаем запись…";
  else if (batchesLoading) reason = "Загружаем партии…";
  else if (!processSynchronized || !statusSynchronized) {
    reason = "Нет связи с сервисом. Ожидаем синхронизацию…";
  } else if (confirmedProcess.status !== "STOPPED") {
    reason = "Запись уже запущена.";
  } else if (!batchesLoaded) reason = "Не удалось загрузить партии.";
  else if (!hasBatch)
    reason = "Выберите партию или введите название новой.";
  else if (!hasSensor) reason = "Выберите хотя бы один доступный датчик.";

  startRunSubmit.disabled = Boolean(reason);
  startRunSubmit.innerHTML = startRunSubmitting
    ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Начинаем запись…'
    : "Начать запись";
  startRunDisabledReason.textContent = reason || "Всё готово к запуску.";
  for (const button of startRunModalElement.querySelectorAll(
    '[data-bs-dismiss="modal"]',
  )) {
    button.disabled = startRunSubmitting;
  }
  startRunButton.disabled =
    !processSynchronized || confirmedProcess.status !== "STOPPED";
}

function updateStopRunAvailability() {
  let reason = "";

  if (stopRunSubmitting) reason = "Останавливаем запись…";
  else if (!processSynchronized) {
    reason = "Нет связи с сервисом. Ожидаем синхронизацию…";
  } else if (
    confirmedProcess.status !== "RUNNING" ||
    !confirmedProcess.active_run
  ) {
    reason = "Активная запись не найдена.";
  }

  stopRunButton.disabled = Boolean(reason);
  stopRunSubmit.disabled = Boolean(reason);
  stopRunSubmit.innerHTML = stopRunSubmitting
    ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Останавливаем запись…'
    : "Остановить запись";
  stopRunDisabledReason.textContent =
    reason || "Запись готова к остановке.";
  for (const button of stopRunModalElement.querySelectorAll(
    '[data-bs-dismiss="modal"]',
  )) {
    button.disabled = stopRunSubmitting;
  }
}

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

function formatChartTick(elapsedMilliseconds, runDuration) {
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

function renderRunMeasurements(payload) {
  const from = new Date(payload.from).getTime();
  const to = new Date(payload.to).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new Error("Unexpected measurement bounds");
  }

  const duration = Math.max(to - from, 1000);
  if (runChart) {
    runChart.data.datasets.forEach((dataset, index) => {
      if (runChart.isDatasetVisible(index)) {
        runChartHiddenSensorIDs.delete(dataset.sensorHardwareID);
      } else {
        runChartHiddenSensorIDs.add(dataset.sensorHardwareID);
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
      if (!Number.isFinite(measuredAt) || !Number.isFinite(measurement.value)) {
        throw new Error("Unexpected measurement point");
      }
      return {
        x: measuredAt - from,
        y: measurement.value,
        measuredAt,
      };
    });
    pointCount += data.length;
    const paletteIndex = index % runChartColors.length;
    return {
      label: sensor.name,
      sensorHardwareID: sensor.hardware_id,
      data,
      parsing: false,
      borderColor: runChartColors[paletteIndex],
      backgroundColor: runChartColors[paletteIndex],
      pointStyle: runChartPointStyles[paletteIndex],
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.15,
      fill: false,
      hidden: runChartHiddenSensorIDs.has(sensor.hardware_id),
    };
  });

  runChartHasResponse = true;
  runChartLoading.classList.add("d-none");
  runChartEmpty.classList.toggle("d-none", pointCount > 0);
  runChartContainer.classList.toggle("d-none", pointCount === 0);

  if (pointCount === 0) {
    destroyRunChart();
    return;
  }

  if (runChart) {
    runChart.data.datasets = datasets;
    runChart.options.scales.x.max = duration;
    runChart.options.scales.x.ticks.callback = (value) =>
      formatChartTick(Number(value), duration);
    runChart.update("none");
    return;
  }

  runChart = new window.Chart(runChartCanvas, {
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
            callback: (value) => formatChartTick(Number(value), duration),
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
              return `${formatDuration(point.x)} · ${chartAbsoluteTimeFormatter.format(new Date(point.measuredAt))}`;
            },
            label: (context) =>
              `${context.dataset.label}: ${context.parsed.y.toFixed(1)} °C`,
          },
        },
      },
    },
  });
}

async function loadRunMeasurements(process) {
  const runID = process.active_run.id;
  showRunChart(runID);
  const requestVersion = ++runChartRequestVersion;
  if (!runChartHasResponse) runChartLoading.classList.remove("d-none");

  try {
    const payload = await getRunMeasurements(runID);
    if (
      payload.run_id !== runID ||
      !Array.isArray(payload.sensors)
    ) {
      throw new Error("Unexpected measurements response format");
    }
    if (
      requestVersion !== runChartRequestVersion ||
      runID !== runChartRunID
    ) {
      return;
    }
    renderRunMeasurements(payload);
    runChartError.classList.add("d-none");
  } catch (error) {
    if (
      requestVersion !== runChartRequestVersion ||
      runID !== runChartRunID
    ) {
      return;
    }
    console.error("Failed to load run measurements:", error);
    runChartLoading.classList.add("d-none");
    runChartError.classList.remove("d-none");
    if (!runChartHasResponse) runChartEmpty.classList.remove("d-none");
  }
}

function formatSensorCount(count) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${count} датчиков`;
  }
  if (lastDigit === 1) return `${count} датчик`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} датчика`;
  return `${count} датчиков`;
}

function updateProcessTimer() {
  if (
    confirmedProcess.status !== "RUNNING" ||
    !confirmedProcess.active_run
  )
    return;
  const duration = formatDuration(
    Date.now() +
      serverClockOffset -
      new Date(confirmedProcess.active_run.started_at).getTime(),
  );
  document.getElementById("process-timer").textContent = duration;
  document.querySelector("[data-stop-duration]").textContent = duration;
}

function renderProcess(process) {
  const status = process.status;
  const isStopped = status === "STOPPED";
  const isRunning = status === "RUNNING";
  const isTransition = status === "STARTING" || status === "STOPPING";

  processCard.dataset.processStatus = status;
  confirmedProcess = process;
  if (process.server_time) {
    serverClockOffset =
      new Date(process.server_time).getTime() - Date.now();
  }
  processStopped.classList.toggle(
    "d-none",
    !(isStopped || status === "STARTING"),
  );
  processRunning.classList.toggle(
    "d-none",
    !(isRunning || status === "STOPPING"),
  );
  processCard.classList.toggle(
    "border-success",
    isRunning || status === "STOPPING",
  );
  processCard.classList.toggle(
    "border-secondary",
    !(isRunning || status === "STOPPING"),
  );

  const badgeText = isRunning
    ? "Идёт запись"
    : isTransition
      ? status === "STARTING"
        ? "Запись запускается"
        : "Запись останавливается"
      : "Запись остановлена";
  for (const badge of document.querySelectorAll("[data-process-badge]")) {
    badge.textContent = badgeText;
    badge.classList.toggle("text-bg-success", isRunning);
    badge.classList.toggle("text-bg-warning", isTransition);
    badge.classList.toggle(
      "text-bg-secondary",
      !isRunning && !isTransition,
    );
  }

  startRunButton.disabled = !processSynchronized || status !== "STOPPED";
  startRunButton.innerHTML =
    status === "STARTING"
      ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Начинаем запись…'
      : "Настроить запись";
  stopRunButton.textContent = "Остановить запись";

  if ((isRunning || status === "STOPPING") && process.active_run) {
    const run = process.active_run;
    showRunChart(run.id);
    document.getElementById("active-run-batch").textContent =
      run.batch.name;
    document.getElementById("active-run-type").textContent =
      run.type === "stripping" ? "Первый перегон" : "Ректификация";
    document.getElementById("active-run-started").textContent =
      `Старт ${lastReadFormatter.format(new Date(run.started_at))}`;
    document.getElementById("active-run-sensors").textContent =
      formatSensorCount(run.sensor_count);
    document.querySelector("[data-stop-batch]").textContent =
      run.batch.name;
    updateProcessTimer();
  } else {
    hideRunChart();
  }
  updateStartRunAvailability();
  updateStopRunAvailability();
}

async function loadProcess() {
  try {
    const process = await getProcess();
    const supportedStatuses = [
      "STOPPED",
      "STARTING",
      "RUNNING",
      "STOPPING",
    ];
    if (!supportedStatuses.includes(process.status)) {
      throw new Error("Unexpected process status");
    }
    if (
      (process.status === "RUNNING" || process.status === "STOPPING") &&
      !process.active_run
    ) {
      throw new Error("Active run is missing");
    }

    renderProcess(process);
    processSynchronized = true;
    processSyncWarning.classList.add("d-none");
    updateStartRunAvailability();
    updateStopRunAvailability();
    if (
      (process.status === "RUNNING" || process.status === "STOPPING") &&
      process.active_run
    ) {
      loadRunMeasurements(process);
    }
    return process;
  } catch (error) {
    console.error("Failed to load process:", error);
    processSynchronized = false;
    processSyncWarning.classList.remove("d-none");
    updateStartRunAvailability();
    updateStopRunAvailability();
    return null;
  }
}

renderProcess({ status: "STOPPED", active_run: null });
startRunButton.disabled = true;
stopRunButton.disabled = true;
loadProcess();
setInterval(loadProcess, statusPollingInterval);
setInterval(updateProcessTimer, 1000);

stopRunModalElement.addEventListener("show.bs.modal", (event) => {
  if (
    !processSynchronized ||
    confirmedProcess.status !== "RUNNING" ||
    !confirmedProcess.active_run
  ) {
    event.preventDefault();
    return;
  }

  stopRunError.textContent = "";
  stopRunError.classList.add("d-none");
  updateProcessTimer();
  updateStopRunAvailability();
});

stopRunModalElement.addEventListener("hide.bs.modal", (event) => {
  if (stopRunSubmitting) event.preventDefault();
});

stopRunSubmit.addEventListener("click", async () => {
  if (
    stopRunSubmitting ||
    !processSynchronized ||
    confirmedProcess.status !== "RUNNING" ||
    !confirmedProcess.active_run
  )
    return;

  const runID = confirmedProcess.active_run.id;
  stopRunSubmitting = true;
  stopRunError.textContent = "";
  stopRunError.classList.add("d-none");
  updateStopRunAvailability();

  try {
    await stopRun(runID);
    stopRunSubmitting = false;
    renderProcess({ status: "STOPPED", active_run: null });
    stopRunModal.hide();
    await loadProcess();
    return;
  } catch (error) {
    if (error.status === 409) {
      const process = await loadProcess();
      stopRunSubmitting = false;
      updateStopRunAvailability();
      if (process?.status === "STOPPED") {
        stopRunModal.hide();
        return;
      }
    }
    console.error("Failed to stop run:", error);
    stopRunSubmitting = false;
    stopRunError.textContent =
      "Не удалось остановить запись. Проверьте связь и попробуйте ещё раз.";
    stopRunError.classList.remove("d-none");
    updateStopRunAvailability();
    await loadProcess();
  }
});

for (const card of document.querySelectorAll(".sensor-card")) {
  sensorMetadata.set(card.dataset.sensorId, {
    name: card.dataset.sensorName,
    measurement_type: card.dataset.measurementType,
    unit: card.dataset.unit,
    enabled: card.dataset.enabled === "true",
  });
}

function mergeSensorMetadata(sensor) {
  const metadata = sensorMetadata.get(sensor.id);
  return metadata ? { ...sensor, ...metadata } : sensor;
}

function hasSuccessfulRead(sensor) {
  return (
    sensor.last_successful_read &&
    !sensor.last_successful_read.startsWith("0001-")
  );
}

function renderSensors(sensors) {
  const sensorList = document.getElementById("sensor-list");
  const sensorCount = document.getElementById("sensor-count");
  const sensorCardTemplate = document.getElementById(
    "sensor-card-template",
  );
  const cards = document.createDocumentFragment();

  for (const sensor of sensors) {
    const card =
      sensorCardTemplate.content.firstElementChild.cloneNode(true);
    const successfulRead = hasSuccessfulRead(sensor);
    const status = card.querySelector('[data-field="status"]');

    card.dataset.sensorId = sensor.id;

    card.querySelector('[data-field="name"]').textContent = sensor.name;
    card.querySelector('[data-field="id"]').textContent = sensor.id;
    card.querySelector('[data-field="temperature"]').textContent =
      successfulRead && Number.isFinite(sensor.temperature)
        ? sensor.temperature.toFixed(1)
        : "—";

    status.textContent = sensor.status === "OK" ? "В сети" : "Ошибка";
    status.classList.add(
      sensor.status === "OK" ? "text-bg-success" : "text-bg-danger",
    );

    card.querySelector(
      '[data-field="last-successful-read"]',
    ).textContent = successfulRead
      ? `Последнее чтение: ${lastReadFormatter.format(
          new Date(sensor.last_successful_read),
        )}`
      : "Нет успешных измерений";

    cards.append(card);
  }

  sensorList.replaceChildren(cards);
  sensorCount.textContent = `${sensors.length} подключено`;
  renderRunSensorOptions(sensors);
}

function sensorIsAvailable(sensor) {
  return (
    sensor.enabled && sensor.status === "OK" && hasSuccessfulRead(sensor)
  );
}

function renderRunSensorOptions(sensors) {
  const container = document.getElementById("run-sensor-options");
  const previousInputs = [
    ...container.querySelectorAll('input[type="checkbox"]'),
  ];
  const previousSelection = new Set(
    previousInputs
      .filter((input) => input.checked)
      .map((input) => input.value),
  );
  const hadOptions = previousInputs.length > 0;
  const options = document.createDocumentFragment();

  for (const sensor of sensors) {
    const available = sensorIsAvailable(sensor);
    if (!available && previousSelection.has(sensor.id)) {
      runSensorAvailabilityWarning = `Датчик «${sensor.name}» стал недоступен и исключён из записи.`;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "form-check border rounded p-3";

    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = "checkbox";
    input.name = "sensor_hardware_ids";
    input.id = `run-sensor-${sensor.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    input.value = sensor.id;
    input.disabled = !available;
    input.checked =
      available && (!hadOptions || previousSelection.has(sensor.id));

    const label = document.createElement("label");
    label.className = "form-check-label d-block";
    label.htmlFor = input.id;
    const state = available
      ? "Доступен"
      : "Недоступен: нет успешного чтения";
    label.innerHTML = `<span class="fw-semibold"></span><span class="d-block small text-secondary"></span>`;
    label.children[0].textContent = sensor.name;
    label.children[1].textContent = `${sensor.id} · ${state}`;

    wrapper.append(input, label);
    options.append(wrapper);
  }

  if (sensors.length === 0) {
    const empty = document.createElement("p");
    empty.className = "text-secondary small mb-0";
    empty.textContent = "Подключённые датчики не найдены.";
    options.append(empty);
  }

  container.replaceChildren(options);
  const warning = document.getElementById("run-sensor-warning");
  warning.textContent = runSensorAvailabilityWarning;
  warning.classList.toggle("d-none", !runSensorAvailabilityWarning);
  updateStartRunAvailability();
}

async function loadStatus() {
  try {
    const sensors = await getSensorStatus();

    if (!Array.isArray(sensors)) {
      throw new Error("Unexpected status response format");
    }

    latestSensors = sensors.map(mergeSensorMetadata);
    renderSensors(latestSensors);
    statusSynchronized = true;
    document.getElementById("status-error").classList.add("d-none");
    updateStartRunAvailability();
  } catch (error) {
    console.error("Failed to load status:", error);
    statusSynchronized = false;
    document.getElementById("status-error").classList.remove("d-none");
    updateStartRunAvailability();
  }
}

loadStatus();
setInterval(loadStatus, statusPollingInterval);

const sensorList = document.getElementById("sensor-list");
const settingsModalElement = document.getElementById(
  "sensor-settings-modal",
);
const settingsModal = new window.bootstrap.Modal(settingsModalElement);
const settingsForm = document.getElementById("sensor-settings-form");
const hardwareIDInput = document.getElementById("sensor-hardware-id");
const nameInput = document.getElementById("sensor-name");
const settingsError = document.getElementById("sensor-settings-error");

function showSettingsError(message) {
  settingsError.textContent = message;
  nameInput.classList.add("is-invalid");
}

function clearSettingsError() {
  settingsError.textContent = "";
  nameInput.classList.remove("is-invalid");
}

function updateRenderedSensorName(hardwareID, name) {
  for (const card of sensorList.querySelectorAll(".sensor-card")) {
    if (card.dataset.sensorId !== hardwareID) continue;

    card.querySelector('[data-field="name"], .card-title').textContent =
      name;
    card.dataset.sensorName = name;
    return;
  }
}

sensorList.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="configure-sensor"]');
  if (!button) return;

  const card = button.closest(".sensor-card");
  const hardwareID = card.dataset.sensorId;
  const metadata = sensorMetadata.get(hardwareID);
  if (!metadata) return;

  hardwareIDInput.value = hardwareID;
  nameInput.value = metadata.name;
  clearSettingsError();
  settingsModal.show();
});

settingsModalElement.addEventListener("shown.bs.modal", () => {
  nameInput.focus();
  nameInput.select();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearSettingsError();

  const hardwareID = hardwareIDInput.value;
  const metadata = sensorMetadata.get(hardwareID);
  const name = nameInput.value.trim();

  if (!name) {
    showSettingsError("Введите название датчика.");
    return;
  }

  if (!metadata) {
    showSettingsError("Не удалось найти данные датчика.");
    return;
  }

  const submitButton = settingsForm.querySelector('[type="submit"]');
  submitButton.disabled = true;

  try {
    const updatedSensor = await updateSensor(hardwareID, {
      name,
      measurement_type: metadata.measurement_type,
      unit: metadata.unit,
      enabled: metadata.enabled,
    });
    sensorMetadata.set(hardwareID, {
      name: updatedSensor.name,
      measurement_type: updatedSensor.measurement_type,
      unit: updatedSensor.unit,
      enabled: updatedSensor.enabled,
    });
    latestSensors = latestSensors.map(mergeSensorMetadata);
    if (latestSensors.length > 0) {
      renderSensors(latestSensors);
    } else {
      updateRenderedSensorName(hardwareID, updatedSensor.name);
    }
    settingsModal.hide();
  } catch (error) {
    console.error("Failed to update sensor:", error);
    showSettingsError(
      "Не удалось сохранить название. Попробуйте ещё раз.",
    );
  } finally {
    submitButton.disabled = false;
  }
});

function showNewBatchFields(show) {
  newBatchFields.classList.toggle("d-none", !show);
  newBatchName.required = show;
  if (!show) newBatchName.classList.remove("is-invalid");
}

function renderBatchOptions(batches, selectNewBatch) {
  const options = document.createDocumentFragment();

  for (const batch of batches) {
    const option = document.createElement("option");
    option.value = String(batch.id);
    option.textContent = batch.name;
    options.append(option);
  }

  const newBatchOption = document.createElement("option");
  newBatchOption.value = "new";
  newBatchOption.textContent = "Новая партия…";
  options.append(newBatchOption);

  batchSelect.replaceChildren(options);
  batchSelect.value =
    selectNewBatch || batches.length === 0
      ? "new"
      : String(batches[0].id);
  showNewBatchFields(batchSelect.value === "new");
}

async function loadBatches(preserveSelection = false) {
  const keepNewBatch =
    preserveSelection &&
    batchSelect.value === "new" &&
    newBatchName.value.trim().length > 0;

  batchesLoading = true;
  batchesLoaded = false;
  batchLoadStatus.classList.remove("d-none");
  batchLoadError.classList.add("d-none");
  batchOptions.classList.add("d-none");
  updateStartRunAvailability();

  try {
    const batches = await getBatches();
    if (!Array.isArray(batches)) {
      throw new Error("Unexpected batches response format");
    }

    renderBatchOptions(batches, keepNewBatch);
    batchesLoaded = true;
    batchOptions.classList.remove("d-none");

    if (startRunModalElement.classList.contains("show")) {
      if (batchSelect.value === "new") {
        newBatchName.focus();
      } else {
        batchSelect.focus();
      }
    }
  } catch (error) {
    console.error("Failed to load batches:", error);
    batchesLoaded = false;
    renderBatchOptions([], true);
    showNewBatchFields(true);
    batchOptions.classList.remove("d-none");
    batchLoadError.classList.remove("d-none");
    if (startRunModalElement.classList.contains("show")) {
      newBatchName.focus();
    }
  } finally {
    batchesLoading = false;
    batchLoadStatus.classList.add("d-none");
    updateStartRunAvailability();
  }
}

function validateRunDraft() {
  const isNewBatch = batchSelect.value === "new";
  const hasBatch = isNewBatch
    ? newBatchName.value.trim().length > 0
    : batchSelect.value.length > 0;
  const hasSensor = startRunForm.querySelector(
    'input[name="sensor_hardware_ids"]:checked:not(:disabled)',
  );
  newBatchName.classList.toggle("is-invalid", isNewBatch && !hasBatch);
  if (!hasSensor) {
    runSensorsError.textContent =
      "Выберите хотя бы один доступный датчик.";
    runSensorsError.classList.remove("d-none");
  }
  updateStartRunAvailability();
  return hasBatch && Boolean(hasSensor);
}

batchSelect.addEventListener("change", () => {
  const isNewBatch = batchSelect.value === "new";
  showNewBatchFields(isNewBatch);
  if (isNewBatch) newBatchName.focus();
  updateStartRunAvailability();
});

batchLoadError.addEventListener("click", (event) => {
  if (!event.target.closest('[data-action="reload-batches"]')) return;
  loadBatches(true);
});

startRunForm.addEventListener("input", () => {
  if (newBatchName.classList.contains("is-invalid")) {
    newBatchName.classList.toggle(
      "is-invalid",
      newBatchName.value.trim().length === 0,
    );
  }
  if (
    startRunForm.querySelector(
      'input[name="sensor_hardware_ids"]:checked:not(:disabled)',
    )
  ) {
    runSensorsError.classList.add("d-none");
  }
  updateStartRunAvailability();
});

function showStartRunError(message) {
  startRunError.textContent = message;
  startRunError.classList.remove("d-none");
}

startRunForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (
    startRunSubmitting ||
    !validateRunDraft() ||
    startRunSubmit.disabled
  )
    return;

  startRunSubmitting = true;
  startRunError.classList.add("d-none");
  updateStartRunAvailability();

  let requestStage = "run";
  try {
    let batchID;
    if (batchSelect.value === "new") {
      requestStage = "batch";
      const batch = await createBatch({
        name: newBatchName.value.trim(),
        comment: newBatchComment.value.trim(),
      });
      if (!Number.isInteger(batch.id) || batch.id <= 0) {
        throw new Error(
          "Сервис вернул некорректный идентификатор партии.",
        );
      }

      const option = document.createElement("option");
      option.value = String(batch.id);
      option.textContent = batch.name;
      batchSelect.insertBefore(
        option,
        batchSelect.querySelector('option[value="new"]'),
      );
      batchSelect.value = option.value;
      showNewBatchFields(false);
      batchID = batch.id;
    } else {
      batchID = Number(batchSelect.value);
    }

    requestStage = "run";
    const run = await createRun({
      batch_id: batchID,
      type: startRunForm.querySelector('input[name="run-type"]:checked')
        .value,
      sensor_hardware_ids: selectedRunSensorIDs(),
    });

    renderProcess({
      status: "RUNNING",
      server_time: new Date(Date.now() + serverClockOffset).toISOString(),
      active_run: run,
    });
    startRunSubmitting = false;
    updateStartRunAvailability();
    startRunModal.hide();
    await loadProcess();
  } catch (error) {
    console.error("Failed to start run:", error);
    if (error.status === 409) {
      const process = await loadProcess();
      if (process?.status === "RUNNING") {
        startRunSubmitting = false;
        updateStartRunAvailability();
        startRunModal.hide();
        return;
      }
    }
    showStartRunError(
      error.status === 409
        ? "Запись уже запускается или активна. Не удалось подтвердить состояние."
        : requestStage === "batch"
          ? "Не удалось создать партию. Проверьте данные и попробуйте ещё раз."
          : "Не удалось начать запись. Проверьте данные и попробуйте ещё раз.",
    );
  } finally {
    startRunSubmitting = false;
    updateStartRunAvailability();
  }
});

startRunModalElement.addEventListener("shown.bs.modal", () => {
  startRunError.classList.add("d-none");
  loadBatches();
});
startRunModalElement.addEventListener("hide.bs.modal", (event) => {
  if (startRunSubmitting) event.preventDefault();
});
startRunModalElement.addEventListener("hidden.bs.modal", () => {
  runSensorAvailabilityWarning = "";
  document.getElementById("run-sensor-warning").classList.add("d-none");
  startRunError.classList.add("d-none");
});
