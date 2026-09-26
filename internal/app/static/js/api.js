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

export function getBatches({ includeRuns = false, limit, offset } = {}) {
  const parameters = new URLSearchParams();
  if (includeRuns) parameters.set("include", "runs");
  if (limit !== undefined) parameters.set("limit", String(limit));
  if (offset !== undefined) parameters.set("offset", String(offset));

  const query = parameters.toString();
  const url = query === "" ? "/api/batches" : `/api/batches?${query}`;
  return requestJSON(url, { cache: "no-store" });
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

export function getRunEvents(runID) {
  return requestJSON(`/api/runs/${encodeURIComponent(runID)}/events`, {
    cache: "no-store",
  });
}

export function createRunEvent(runID, event) {
  return requestJSON(`/api/runs/${encodeURIComponent(runID)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
}

export function updateRunEvent(eventID, patch) {
  return requestJSON(`/api/events/${encodeURIComponent(eventID)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function deleteRunEvent(eventID) {
  return requestJSON(
    `/api/events/${encodeURIComponent(eventID)}`,
    { method: "DELETE" },
    204,
  );
}
