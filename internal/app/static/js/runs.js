import {
  createBatch,
  createRun,
  getBatches,
  getProcess,
  stopRun,
} from "./api.js";

export function initRuns({ chart, runEvents, pollingInterval }) {
  const lastReadFormatter = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  let runSensorAvailabilityWarning = "";

  const processCard = document.getElementById("process-card");
  const processStopped = document.getElementById("process-stopped");
  const processRunning = document.getElementById("process-running");
  const processSyncWarning = document.getElementById(
    "process-sync-warning",
  );
  const startRunButton = document.getElementById("open-start-run");
  const stopRunButton = document.getElementById("stop-run-button");
  const addRunEventButton = document.getElementById("add-active-run-event");
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
    addRunEventButton.disabled =
      stopRunSubmitting ||
      !processSynchronized ||
      confirmedProcess.status !== "RUNNING" ||
      !confirmedProcess.active_run;
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
      chart.show(run.id);
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
      chart.hide();
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
        chart.refresh();
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
  setInterval(loadProcess, pollingInterval);
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

  addRunEventButton.addEventListener("click", () => {
    if (
      addRunEventButton.disabled ||
      confirmedProcess.status !== "RUNNING" ||
      !confirmedProcess.active_run
    ) return;
    runEvents.open({
      runID: confirmedProcess.active_run.id,
      status: "RUNNING",
      chart,
    });
  });

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
      const available = sensor.available;
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

  function setSensors(sensors) {
    renderRunSensorOptions(sensors);
  }

  function setSensorsSynchronized(synchronized) {
    statusSynchronized = synchronized;
    updateStartRunAvailability();
  }

  return {
    refreshProcess: loadProcess,
    setSensors,
    setSensorsSynchronized,
  };
}
