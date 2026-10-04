import { getSensorStatus, updateSensor } from "./api.js";

const lastReadFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function hasSuccessfulRead(sensor) {
  return (
    sensor.last_successful_read &&
    !sensor.last_successful_read.startsWith("0001-")
  );
}

function withAvailability(sensor) {
  return {
    ...sensor,
    available:
      sensor.enabled && sensor.status === "OK" && hasSuccessfulRead(sensor),
  };
}

function sensorCountLabel(count) {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  let noun = "датчиков";

  if (remainder100 < 11 || remainder100 > 14) {
    if (remainder10 === 1) noun = "датчик";
    else if (remainder10 >= 2 && remainder10 <= 4) noun = "датчика";
  }

  return `${count} ${noun}`;
}

function sensorUnitLabel(unit) {
  return unit === "celsius" ? "°C" : unit;
}

export function initSensors({
  pollingInterval,
  onSensorsChanged,
  onSyncChanged,
}) {
  let latestSensors = [];
  let hasLoadedSensors = false;
  let refreshPromise = null;
  let localRevision = 0;

  const sensorList = document.getElementById("sensor-list");
  const sensorCount = document.getElementById("sensor-count");
  const sensorLoading = document.getElementById("sensor-loading");
  const sensorEmpty = document.getElementById("sensor-empty");
  const sensorCardTemplate = document.getElementById("sensor-card-template");
  const temperatureSummary = document.getElementById("temperature-summary");
  const statusError = document.getElementById("status-error");
  const statusErrorMessage = document.getElementById("status-error-message");
  const statusRetryButton = document.getElementById("sensor-retry");
  const settingsModalElement = document.getElementById(
    "sensor-settings-modal",
  );
  const settingsModal = new window.bootstrap.Modal(settingsModalElement);
  const settingsForm = document.getElementById("sensor-settings-form");
  const hardwareIDInput = document.getElementById("sensor-hardware-id");
  const nameInput = document.getElementById("sensor-name");
  const settingsError = document.getElementById("sensor-settings-error");

  function updateSensorCard(card, sensor) {
    const successfulRead = hasSuccessfulRead(sensor);
    const status = card.querySelector('[data-field="status"]');

    card.dataset.sensorId = sensor.id;
    card.querySelector('[data-field="name"]').textContent = sensor.name;
    card.querySelector('[data-field="id"]').textContent = sensor.id;
    card.querySelector('[data-field="temperature"]').textContent =
      successfulRead && Number.isFinite(sensor.temperature)
        ? sensor.temperature.toFixed(1)
        : "—";
    card.querySelector('[data-field="unit"]').textContent =
      ` ${sensorUnitLabel(sensor.unit)} `;

    status.classList.remove(
      "text-bg-success",
      "text-bg-danger",
      "text-bg-secondary",
    );
    if (!sensor.enabled) {
      status.textContent = "Отключён";
      status.classList.add("text-bg-secondary");
    } else if (sensor.status === "OK") {
      status.textContent = "В сети";
      status.classList.add("text-bg-success");
    } else {
      status.textContent = "Ошибка";
      status.classList.add("text-bg-danger");
    }

    card.querySelector(
      '[data-field="last-successful-read"]',
    ).textContent = successfulRead
      ? `Последнее чтение: ${lastReadFormatter.format(
          new Date(sensor.last_successful_read),
        )}`
      : "Нет успешных измерений";
  }

  function renderSensors(sensors) {
    const renderedCards = Array.from(
      sensorList.querySelectorAll(".sensor-card"),
    );
    const sameSensors =
      renderedCards.length === sensors.length &&
      renderedCards.every(
        (card, index) => card.dataset.sensorId === sensors[index].id,
      );

    if (sameSensors) {
      sensors.forEach((sensor, index) => {
        updateSensorCard(renderedCards[index], sensor);
      });
    } else {
      const existingCards = new Map(
        renderedCards.map((card) => [card.dataset.sensorId, card]),
      );
      const cards = document.createDocumentFragment();

      for (const sensor of sensors) {
        const card =
          existingCards.get(sensor.id) ??
          sensorCardTemplate.content.firstElementChild.cloneNode(true);
        updateSensorCard(card, sensor);
        cards.append(card);
      }

      sensorList.replaceChildren(cards);
    }

    sensorCount.textContent = sensorCountLabel(sensors.length);
    sensorLoading.classList.add("d-none");
    sensorEmpty.classList.toggle("d-none", sensors.length !== 0);
    sensorList.classList.toggle("d-none", sensors.length === 0);
  }

  function renderTemperatureSummary(sensors, synchronized = true) {
    const items = document.createDocumentFragment();

    if (sensors.length === 0) {
      const empty = document.createElement("span");
      empty.className = synchronized ? "text-secondary" : "text-warning";
      empty.textContent = synchronized
        ? "Датчики не подключены"
        : "Обновление датчиков недоступно";
      temperatureSummary.replaceChildren(empty);
      return;
    }

    sensors.forEach((sensor, index) => {
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "text-secondary";
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "·";
        items.append(separator);
      }

      const item = document.createElement("span");
      const value = document.createElement("strong");
      item.textContent = `${sensor.name}: `;
      if (!synchronized) {
        value.textContent = "обновление недоступно";
        value.className = "text-warning";
      } else if (!sensor.enabled) {
        value.textContent = "отключён";
        value.className = "text-secondary";
      } else if (!sensor.available || !Number.isFinite(sensor.temperature)) {
        value.textContent = "недоступен";
        value.className = "text-danger";
      } else {
        value.textContent =
          `${sensor.temperature.toFixed(1)} ${sensorUnitLabel(sensor.unit)}`;
      }
      item.append(value);
      items.append(item);
    });

    temperatureSummary.replaceChildren(items);
  }

  function publishSensors() {
    renderSensors(latestSensors);
    renderTemperatureSummary(latestSensors);
    onSensorsChanged(latestSensors);
  }

  function showStatusError() {
    sensorLoading.classList.add("d-none");
    statusErrorMessage.textContent = hasLoadedSensors
      ? "Не удалось обновить датчики. Показаны последние полученные данные."
      : "Не удалось загрузить датчики. Проверьте подключение и повторите попытку.";
    statusError.classList.remove("d-none");

    if (!hasLoadedSensors) {
      sensorCount.textContent = "Недоступно";
      sensorEmpty.classList.add("d-none");
      sensorList.classList.add("d-none");
    }
  }

  function refresh() {
    if (refreshPromise) return refreshPromise;

    const requestedRevision = localRevision;
    statusRetryButton.disabled = true;
    statusRetryButton.textContent = "Загружаем…";
    refreshPromise = (async () => {
      try {
        const sensors = await getSensorStatus();
        if (!Array.isArray(sensors)) {
          throw new Error("Unexpected status response format");
        }

        if (requestedRevision !== localRevision) return;

        latestSensors = sensors.map(withAvailability);
        hasLoadedSensors = true;
        publishSensors();
        statusError.classList.add("d-none");
        onSyncChanged(true);
      } catch (error) {
        console.error("Failed to load status:", error);
        showStatusError();
        renderTemperatureSummary(latestSensors, false);
        onSyncChanged(false);
      } finally {
        statusRetryButton.disabled = false;
        statusRetryButton.textContent = "Повторить";
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  function showSettingsError(message) {
    settingsError.textContent = message;
    nameInput.classList.add("is-invalid");
  }

  function clearSettingsError() {
    settingsError.textContent = "";
    nameInput.classList.remove("is-invalid");
  }

  sensorList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="configure-sensor"]');
    if (!button) return;

    const card = button.closest(".sensor-card");
    const hardwareID = card.dataset.sensorId;
    const sensor = latestSensors.find((sensor) => sensor.id === hardwareID);
    if (!sensor) return;

    hardwareIDInput.value = hardwareID;
    nameInput.value = sensor.name;
    clearSettingsError();
    settingsModal.show();
  });

  statusError.addEventListener("click", (event) => {
    if (!event.target.closest('[data-action="reload-sensors"]')) return;
    refresh();
  });

  settingsModalElement.addEventListener("shown.bs.modal", () => {
    nameInput.focus();
    nameInput.select();
  });

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearSettingsError();

    const hardwareID = hardwareIDInput.value;
    const sensor = latestSensors.find((sensor) => sensor.id === hardwareID);
    const name = nameInput.value.trim();

    if (!name) {
      showSettingsError("Введите название датчика.");
      return;
    }
    if (!sensor) {
      showSettingsError("Не удалось найти данные датчика.");
      return;
    }

    const submitButton = settingsForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Сохраняем…";
    const pendingRefresh = refreshPromise;

    try {
      const updatedSensor = await updateSensor(hardwareID, {
        name,
        measurement_type: sensor.measurement_type,
        unit: sensor.unit,
        enabled: sensor.enabled,
      });
      localRevision += 1;
      latestSensors = latestSensors.map((current) =>
        current.id === hardwareID
          ? withAvailability({
              ...current,
              name: updatedSensor.name,
              measurement_type: updatedSensor.measurement_type,
              unit: updatedSensor.unit,
              enabled: updatedSensor.enabled,
            })
          : current,
      );
      publishSensors();
      settingsModal.hide();
      if (pendingRefresh) await pendingRefresh;
      await refresh();
    } catch (error) {
      console.error("Failed to update sensor:", error);
      showSettingsError(
        "Не удалось сохранить название. Попробуйте ещё раз.",
      );
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Сохранить";
    }
  });

  async function poll() {
    await refresh();
    window.setTimeout(poll, pollingInterval);
  }

  poll();

  return { refresh };
}
