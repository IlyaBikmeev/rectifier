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

export function initSensors({
  pollingInterval,
  onSensorsChanged,
  onSyncChanged,
}) {
  let latestSensors = [];

  const sensorList = document.getElementById("sensor-list");
  const sensorCount = document.getElementById("sensor-count");
  const sensorLoading = document.getElementById("sensor-loading");
  const sensorEmpty = document.getElementById("sensor-empty");
  const sensorCardTemplate = document.getElementById("sensor-card-template");
  const temperatureSummary = document.getElementById("temperature-summary");
  const statusError = document.getElementById("status-error");
  const settingsModalElement = document.getElementById(
    "sensor-settings-modal",
  );
  const settingsModal = new window.bootstrap.Modal(settingsModalElement);
  const settingsForm = document.getElementById("sensor-settings-form");
  const hardwareIDInput = document.getElementById("sensor-hardware-id");
  const nameInput = document.getElementById("sensor-name");
  const settingsError = document.getElementById("sensor-settings-error");

  function renderSensors(sensors) {
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
    sensorLoading.classList.add("d-none");
    sensorEmpty.classList.toggle("d-none", sensors.length !== 0);
    sensorList.classList.toggle("d-none", sensors.length === 0);
  }

  function renderTemperatureSummary(sensors, synchronized = true) {
    const items = document.createDocumentFragment();

    if (sensors.length === 0) {
      const empty = document.createElement("span");
      empty.className = "text-secondary";
      empty.textContent = "Датчики не подключены";
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
        value.textContent = `${sensor.temperature.toFixed(1)} °C`;
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

  async function refresh() {
    try {
      const sensors = await getSensorStatus();
      if (!Array.isArray(sensors)) {
        throw new Error("Unexpected status response format");
      }

      latestSensors = sensors.map(withAvailability);
      publishSensors();
      statusError.classList.add("d-none");
      onSyncChanged(true);
    } catch (error) {
      console.error("Failed to load status:", error);
      statusError.classList.remove("d-none");
      sensorLoading.classList.add("d-none");
      renderTemperatureSummary(latestSensors, false);
      onSyncChanged(false);
    }
  }

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
    const sensor = latestSensors.find((sensor) => sensor.id === hardwareID);
    if (!sensor) return;

    hardwareIDInput.value = hardwareID;
    nameInput.value = sensor.name;
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

    try {
      const updatedSensor = await updateSensor(hardwareID, {
        name,
        measurement_type: sensor.measurement_type,
        unit: sensor.unit,
        enabled: sensor.enabled,
      });
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
    } catch (error) {
      console.error("Failed to update sensor:", error);
      showSettingsError(
        "Не удалось сохранить название. Попробуйте ещё раз.",
      );
    } finally {
      submitButton.disabled = false;
    }
  });

  refresh();
  setInterval(refresh, pollingInterval);

  return { refresh };
}
