import { getBatches } from "./api.js";

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
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

function parseDate(value, field) {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Unexpected ${field}`);
  }
  return milliseconds;
}

function normalizeRun(run) {
  if (
    run === null ||
    typeof run !== "object" ||
    !Number.isInteger(run.id) ||
    run.id <= 0 ||
    !["stripping", "rectification"].includes(run.type) ||
    !["RUNNING", "STOPPED"].includes(run.status)
  ) {
    throw new Error("Unexpected run response format");
  }

  const startedAt = parseDate(run.started_at, "run started_at");
  let stoppedAt = null;
  if (run.status === "STOPPED") {
    stoppedAt = parseDate(run.stopped_at, "run stopped_at");
    if (stoppedAt < startedAt) {
      throw new Error("Unexpected run duration");
    }
  } else if (run.stopped_at !== null) {
    throw new Error("Unexpected active run stopped_at");
  }

  return { ...run, startedAt, stoppedAt };
}

function normalizeBatches(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("Unexpected batches response format");
  }

  return payload.map((batch) => {
    if (
      batch === null ||
      typeof batch !== "object" ||
      !Number.isInteger(batch.id) ||
      batch.id <= 0 ||
      typeof batch.name !== "string"
    ) {
      throw new Error("Unexpected batch response format");
    }

    const runs = batch.runs === undefined ? [] : batch.runs;
    if (!Array.isArray(runs)) {
      throw new Error("Unexpected batch runs response format");
    }

    return {
      ...batch,
      updatedAt: parseDate(batch.updated_at, "batch updated_at"),
      runs: runs.map(normalizeRun),
    };
  });
}

function deduplicateBatches(batches) {
  const seen = new Set();
  return batches.filter((batch) => {
    if (seen.has(batch.id)) return false;
    seen.add(batch.id);
    return true;
  });
}

export function initHistory({ chart, runEvents, pollingInterval, pageSize }) {
  const elements = {
    view: document.getElementById("history-view"),
    loading: document.getElementById("history-loading"),
    error: document.getElementById("history-error"),
    empty: document.getElementById("history-empty"),
    list: document.getElementById("history-list"),
    pagination: document.getElementById("history-pagination"),
    pageError: document.getElementById("history-page-error"),
    more: document.getElementById("history-more"),
    batchTemplate: document.getElementById("history-batch-template"),
    runTemplate: document.getElementById("history-run-template"),
    chartPanel: document.getElementById("history-chart-panel"),
    addRunEvent: document.getElementById("add-history-run-event"),
    addRunEventReason: document.getElementById("history-add-event-reason"),
  };

  const state = {
    batches: [],
    nextOffset: 0,
    hasMore: true,
    active: false,
    loading: false,
    selectedRunID: null,
  };

  let initialized = false;
  let initialLoadFailed = false;
  let pageLoadFailed = false;
  let loadingPage = false;
  let requestVersion = 0;
  let durationTimer = null;
  let pollingTimer = null;
  let chartReady = false;

  function updateAddEventAvailability() {
    const selectedRun = findRun(state.selectedRunID);
    const canAdd =
      selectedRun !== null &&
      (selectedRun.status === "RUNNING" || chartReady);
    elements.addRunEvent.disabled = !canAdd;
    elements.addRunEventReason.textContent = selectedRun === null
      ? ""
      : canAdd
        ? ""
        : "Добавление станет доступно после появления измерений.";
    elements.addRunEventReason.classList.toggle(
      "d-none",
      elements.addRunEventReason.textContent === "",
    );
  }

  chart.onAvailabilityChanged((available) => {
    chartReady = available;
    updateAddEventAvailability();
  });

  function findRun(runID) {
    for (const batch of state.batches) {
      const run = batch.runs.find((candidate) => candidate.id === runID);
      if (run) return run;
    }
    return null;
  }

  function runDuration(run, now = Date.now()) {
    const end = run.status === "RUNNING" ? now : run.stoppedAt;
    return end - run.startedAt;
  }

  function setMoreLoading(loading) {
    elements.more.disabled = loading;
    elements.more.querySelector("[data-spinner]").classList.toggle("d-none", !loading);
    elements.more.querySelector("[data-label]").textContent = loading
      ? "Загружаем"
      : "Показать ещё";
  }

  function updatePageControls() {
    const hasBatches = state.batches.length > 0;
    elements.pagination.classList.toggle(
      "d-none",
      !hasBatches || (!state.hasMore && !pageLoadFailed),
    );
    elements.pageError.classList.toggle("d-none", !pageLoadFailed);
    elements.more.classList.toggle("d-none", !state.hasMore);
    setMoreLoading(loadingPage);
  }

  function updateDurations() {
    if (!state.active) return;

    const now = Date.now();
    for (const duration of elements.list.querySelectorAll(
      "[data-run-duration]",
    )) {
      const run = findRun(Number(duration.dataset.runDuration));
      if (run) duration.textContent = formatDuration(runDuration(run, now));
    }
  }

  function renderRun(run) {
    const fragment = elements.runTemplate.content.cloneNode(true);
    const row = fragment.querySelector("[data-run-row]");
    const type = fragment.querySelector('[data-field="run-type"]');
    const status = fragment.querySelector('[data-field="run-status"]');
    const indicator = fragment.querySelector('[data-field="run-indicator"]');
    const started = fragment.querySelector('[data-field="run-started"]');
    const duration = fragment.querySelector('[data-field="run-duration"]');
    const toggle = fragment.querySelector(
      '[data-action="toggle-history-chart"]',
    );

    row.dataset.runId = String(run.id);
    row.dataset.status = run.status;
    type.textContent =
      run.type === "stripping" ? "Первый перегон" : "Ректификация";
    status.textContent = run.status === "RUNNING" ? "В процессе" : "Завершён";
    status.classList.add(
      run.status === "RUNNING" ? "text-bg-success" : "text-bg-secondary",
    );
    indicator.classList.toggle("d-none", run.status !== "RUNNING");
    if (run.status === "RUNNING") {
      row.classList.add("border-start", "border-4", "border-success");
    }

    const startedDate = new Date(run.startedAt);
    started.dateTime = startedDate.toISOString();
    started.textContent = `Начало ${dateTimeFormatter.format(startedDate)}`;
    duration.dataset.runDuration = String(run.id);
    duration.textContent = formatDuration(runDuration(run));
    toggle.dataset.runId = String(run.id);

    return fragment;
  }

  function renderBatch(batch) {
    const fragment = elements.batchTemplate.content.cloneNode(true);
    const name = fragment.querySelector('[data-field="batch-name"]');
    const updated = fragment.querySelector('[data-field="batch-updated"]');
    const runs = fragment.querySelector('[data-field="runs"]');

    name.textContent = batch.name;
    const updatedDate = new Date(batch.updatedAt);
    updated.dateTime = updatedDate.toISOString();
    updated.textContent = `Обновлено ${dateTimeFormatter.format(updatedDate)}`;

    if (batch.runs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "list-group-item py-4 text-secondary";
      empty.textContent = "Перегонов пока нет";
      runs.append(empty);
    } else {
      for (const run of batch.runs) runs.append(renderRun(run));
    }

    return fragment;
  }

  function restoreSelectedChart() {
    if (state.selectedRunID === null) return;

    const row = Array.from(
      elements.list.querySelectorAll("[data-run-row]"),
    ).find((candidate) => Number(candidate.dataset.runId) === state.selectedRunID);

    if (!row) {
      state.selectedRunID = null;
      chart.hide();
      return;
    }

    const toggle = row.querySelector('[data-action="toggle-history-chart"]');
    toggle.setAttribute("aria-expanded", "true");
    toggle.querySelector("[data-label]").textContent = "Скрыть график";
    row.append(elements.chartPanel);
  }

  function render() {
    const hasBatches = state.batches.length > 0;
    elements.loading.classList.toggle(
      "d-none",
      !state.loading || hasBatches || initialLoadFailed,
    );
    elements.error.classList.toggle("d-none", !initialLoadFailed);
    elements.empty.classList.toggle(
      "d-none",
      state.loading || initialLoadFailed || hasBatches,
    );
    elements.list.classList.toggle("d-none", !hasBatches);
    elements.list.replaceChildren();

    for (const batch of state.batches) {
      elements.list.append(renderBatch(batch));
    }

    restoreSelectedChart();
    updateAddEventAvailability();
    updatePageControls();
  }

  function reset() {
    state.batches = [];
    state.nextOffset = 0;
    state.hasMore = true;
    state.selectedRunID = null;
    chartReady = false;
    initialLoadFailed = false;
    pageLoadFailed = false;
    chart.hide();
  }

  async function loadFirstPage({ preserveExisting }) {
    if (!state.active || state.loading) return;

    const version = requestVersion;
    state.loading = true;
    initialLoadFailed = false;
    render();

    try {
      const payload = await getBatches({
        includeRuns: true,
        limit: pageSize,
        offset: 0,
      });
      const batches = normalizeBatches(payload);
      if (!state.active || version !== requestVersion) return;

      if (preserveExisting) {
        const refreshedIDs = new Set(batches.map((batch) => batch.id));
        state.batches = deduplicateBatches([
          ...batches,
          ...state.batches.filter((batch) => !refreshedIDs.has(batch.id)),
        ]);
      } else {
        state.batches = batches;
        state.nextOffset = batches.length;
        state.hasMore = batches.length === pageSize;
      }
      initialLoadFailed = false;
    } catch (error) {
      if (!state.active || version !== requestVersion) return;
      console.error("Failed to load run history:", error);
      if (!preserveExisting || state.batches.length === 0) {
        initialLoadFailed = true;
      }
    } finally {
      if (state.active && version === requestVersion) {
        state.loading = false;
        render();
      }
    }
  }

  async function loadMore() {
    if (!state.active || state.loading || !state.hasMore) return;

    const version = requestVersion;
    state.loading = true;
    loadingPage = true;
    pageLoadFailed = false;
    updatePageControls();

    try {
      const payload = await getBatches({
        includeRuns: true,
        limit: pageSize,
        offset: state.nextOffset,
      });
      const batches = normalizeBatches(payload);
      if (!state.active || version !== requestVersion) return;

      state.nextOffset += batches.length;
      state.hasMore = batches.length === pageSize;
      state.batches = deduplicateBatches([...state.batches, ...batches]);
    } catch (error) {
      if (!state.active || version !== requestVersion) return;
      console.error("Failed to load more run history:", error);
      pageLoadFailed = true;
    } finally {
      if (state.active && version === requestVersion) {
        state.loading = false;
        loadingPage = false;
        render();
      }
    }
  }

  async function poll() {
    if (
      !state.active ||
      state.loading ||
      !state.batches.some((batch) =>
        batch.runs.some((run) => run.status === "RUNNING"),
      )
    ) {
      return;
    }

    await loadFirstPage({ preserveExisting: true });
    const selectedRun = findRun(state.selectedRunID);
    if (selectedRun?.status === "RUNNING") await chart.refresh();
  }

  function closeChart(toggle) {
    chart.hide();
    state.selectedRunID = null;
    chartReady = false;
    toggle.setAttribute("aria-expanded", "false");
    toggle.querySelector("[data-label]").textContent = "Показать график";
    toggle.focus();
  }

  function toggleChart(toggle) {
    const runID = Number(toggle.dataset.runId);
    if (runID === state.selectedRunID) {
      closeChart(toggle);
      return;
    }

    const previous = elements.list.querySelector('[aria-expanded="true"]');
    if (previous) {
      previous.setAttribute("aria-expanded", "false");
      previous.querySelector("[data-label]").textContent = "Показать график";
    }

    state.selectedRunID = runID;
    chartReady = false;
    updateAddEventAvailability();
    toggle.setAttribute("aria-expanded", "true");
    toggle.querySelector("[data-label]").textContent = "Скрыть график";
    toggle.closest("[data-run-row]").append(elements.chartPanel);
    chart.show(runID);
    chart.refresh();
  }

  elements.view.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;

    switch (action.dataset.action) {
      case "retry-history":
        loadFirstPage({ preserveExisting: false });
        break;
      case "load-more-history":
      case "retry-history-page":
        loadMore();
        break;
      case "toggle-history-chart":
        toggleChart(action);
        break;
    }
  });

  elements.addRunEvent.addEventListener("click", () => {
    const run = findRun(state.selectedRunID);
    if (!run || (run.status === "STOPPED" && !chartReady)) return;
    runEvents.open({ runID: run.id, status: run.status, chart });
  });

  function setActive(active) {
    if (!active) {
      if (!state.active) return;
      state.active = false;
      state.loading = false;
      loadingPage = false;
      state.selectedRunID = null;
      requestVersion += 1;
      clearInterval(durationTimer);
      clearInterval(pollingTimer);
      durationTimer = null;
      pollingTimer = null;
      chart.hide();
      return;
    }

    if (!state.active) {
      state.active = true;
      durationTimer = window.setInterval(updateDurations, 1000);
      pollingTimer = window.setInterval(poll, pollingInterval);
    }

    if (!initialized) {
      initialized = true;
      reset();
      render();
      loadFirstPage({ preserveExisting: false });
      return;
    }

    loadFirstPage({ preserveExisting: true });
  }

  return { setActive };
}
