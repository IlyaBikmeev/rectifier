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
  const metadata = new Map();
  let latestSensors = [];

  const sensorList = document.getElementById("sensor-list");
  const sensorCount = document.getElementById("sensor-count");
  const sensorCardTemplate = document.getElementById("sensor-card-template");
  const statusError = document.getElementById("status-error");
  const settingsModalElement = document.getElementById(
    "sensor-settings-modal",
  );
  const settingsModal = new window.bootstrap.Modal(settingsModalElement);
  const settingsForm = document.getElementById("sensor-settings-form");
  const hardwareIDInput = document.getElementById("sensor-hardware-id");
  const nameInput = document.getElementById("sensor-name");
  const settingsError = document.getElementById("sensor-settings-error");

  for (const card of document.querySelectorAll(".sensor-card")) {
    metadata.set(card.dataset.sensorId, {
      name: card.dataset.sensorName,
      measurement_type: card.dataset.measurementType,
      unit: card.dataset.unit,
      enabled: card.dataset.enabled === "true",
    });
  }

  function mergeMetadata(sensor) {
    const sensorMetadata = metadata.get(sensor.id);
    return withAvailability(
      sensorMetadata ? { ...sensor, ...sensorMetadata } : sensor,
    );
  }

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
  }

  function publishSensors() {
    renderSensors(latestSensors);
    onSensorsChanged(latestSensors);
  }

  async function refresh() {
    try {
      const sensors = await getSensorStatus();
      if (!Array.isArray(sensors)) {
        throw new Error("Unexpected status response format");
      }

      latestSensors = sensors.map(mergeMetadata);
      publishSensors();
      statusError.classList.add("d-none");
      onSyncChanged(true);
    } catch (error) {
      console.error("Failed to load status:", error);
      statusError.classList.remove("d-none");
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
    const sensorMetadata = metadata.get(hardwareID);
    if (!sensorMetadata) return;

    hardwareIDInput.value = hardwareID;
    nameInput.value = sensorMetadata.name;
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
    const sensorMetadata = metadata.get(hardwareID);
    const name = nameInput.value.trim();

    if (!name) {
      showSettingsError("Введите название датчика.");
      return;
    }
    if (!sensorMetadata) {
      showSettingsError("Не удалось найти данные датчика.");
      return;
    }

    const submitButton = settingsForm.querySelector('[type="submit"]');
    submitButton.disabled = true;

    try {
      const updatedSensor = await updateSensor(hardwareID, {
        name,
        measurement_type: sensorMetadata.measurement_type,
        unit: sensorMetadata.unit,
        enabled: sensorMetadata.enabled,
      });
      metadata.set(hardwareID, {
        name: updatedSensor.name,
        measurement_type: updatedSensor.measurement_type,
        unit: updatedSensor.unit,
        enabled: updatedSensor.enabled,
      });
      latestSensors = latestSensors.map(mergeMetadata);
      if (latestSensors.length > 0) {
        publishSensors();
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

  refresh();
  setInterval(refresh, pollingInterval);

  return { refresh };
}
