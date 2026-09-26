async function requestJSON(url, options = {}, expectedStatus = null) {
  const response = await fetch(url, options);

  const successful =
    expectedStatus === null
      ? response.ok
      : response.status === expectedStatus;
  if (!successful) {
    const message = (await response.text()).trim();
    const error = new Error(message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

export function getProcess() {
  return requestJSON("/api/process", { cache: "no-store" });
}

export function getSensorStatus() {
  return requestJSON("/api/status", { cache: "no-store" });
}

export function getBatches() {
  return requestJSON("/api/batches", { cache: "no-store" });
}

export function updateSensor(hardwareID, sensor) {
  return requestJSON(`/api/sensors/${encodeURIComponent(hardwareID)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sensor),
  });
}

export function createBatch(batch) {
  return requestJSON("/api/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  });
}

export function createRun(run) {
  return requestJSON("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(run),
  });
}

export function stopRun(runID) {
  return requestJSON(
    `/api/runs/${encodeURIComponent(runID)}/stop`,
    { method: "POST" },
    204,
  );
}

export function getRunMeasurements(runID) {
  return requestJSON(
    `/api/runs/${encodeURIComponent(runID)}/measurements`,
    { cache: "no-store" },
  );
}
