import { createRunEvent } from "./api.js";

const eventTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
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

export function initRunEvents() {
  const modalElement = document.getElementById("run-event-modal");
  const modal = window.bootstrap.Modal.getOrCreateInstance(modalElement);
  const form = document.getElementById("run-event-form");
  const text = document.getElementById("run-event-text");
  const time = document.getElementById("run-event-time-description");
  const elapsed = document.getElementById("run-event-elapsed");
  const adjustments = document.getElementById("run-event-adjustments");
  const adjustmentButtons = [
    ...adjustments.querySelectorAll("[data-event-time-offset]"),
  ];
  const resetTime = document.getElementById("reset-run-event-time");
  const pick = document.getElementById("pick-run-event-time");
  const pickUnavailable = document.getElementById("run-event-pick-unavailable");
  const submit = document.getElementById("submit-run-event");
  const disabledReason = document.getElementById("run-event-disabled-reason");
  const error = document.getElementById("run-event-error");
  const successToast = window.bootstrap.Toast.getOrCreateInstance(
    document.getElementById("run-event-success"),
    { delay: 3000 },
  );

  let target = null;
  let occurredAt = null;
  let submitting = false;
  let choosingPoint = false;
  let focusTextOnShow = false;

  function update() {
    const completed = target?.status === "STOPPED";
    const canPick = Boolean(target?.chart.canSelectPoint());
    const needsPoint = completed && occurredAt === null;
    const bounds = target?.chart.getTimeBounds();
    const occurredAtMilliseconds = occurredAt
      ? new Date(occurredAt).getTime()
      : null;

    time.textContent = occurredAt
      ? eventTimeFormatter.format(new Date(occurredAt))
      : completed
        ? "Выберите момент на графике"
        : "Сейчас";
    adjustments.classList.toggle("d-none", occurredAt === null);
    elapsed.classList.toggle("d-none", occurredAt === null || !bounds);
    elapsed.textContent =
      occurredAt !== null && bounds
        ? `От старта ${formatDuration(occurredAtMilliseconds - bounds.from)}`
        : "";
    resetTime.classList.toggle(
      "d-none",
      completed || occurredAt === null,
    );
    resetTime.disabled = submitting;
    for (const button of adjustmentButtons) {
      const offset = Number(button.dataset.eventTimeOffset);
      const adjustedTime = occurredAtMilliseconds + offset;
      button.disabled =
        submitting ||
        occurredAt === null ||
        !bounds ||
        adjustedTime < bounds.from ||
        adjustedTime > bounds.to;
    }
    pick.disabled = submitting || !canPick;
    pickUnavailable.classList.toggle("d-none", canPick);
    submit.disabled = submitting || needsPoint;
    submit.innerHTML = submitting
      ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Добавляем…'
      : "Добавить";
    disabledReason.textContent = needsPoint
      ? "Для завершённого перегона сначала выберите время на графике."
      : "";
    text.disabled = submitting;
    for (const button of modalElement.querySelectorAll(
      '[data-bs-dismiss="modal"]',
    )) {
      button.disabled = submitting;
    }
  }

  function open(nextTarget) {
    target?.chart.cancelPointSelection();
    target = nextTarget;
    occurredAt = null;
    choosingPoint = false;
    submitting = false;
    focusTextOnShow = true;
    form.reset();
    text.classList.remove("is-invalid");
    error.classList.add("d-none");
    error.textContent = "";
    update();
    modal.show();
  }

  pick.addEventListener("click", () => {
    if (submitting || !target?.chart.canSelectPoint()) return;

    choosingPoint = true;
    modal.hide();
    target.chart.beginPointSelection(
      (selectedTime) => {
        occurredAt = selectedTime;
        choosingPoint = false;
        update();
        modal.show();
      },
      () => {
        choosingPoint = false;
        update();
        modal.show();
      },
    );
  });

  adjustments.addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-time-offset]");
    if (!button || button.disabled || occurredAt === null) return;
    occurredAt = new Date(
      new Date(occurredAt).getTime() + Number(button.dataset.eventTimeOffset),
    ).toISOString();
    update();
  });

  resetTime.addEventListener("click", () => {
    if (submitting || target?.status !== "RUNNING") return;
    occurredAt = null;
    update();
  });

  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    if (submitting || !target) return;

    const trimmedText = text.value.trim();
    text.classList.toggle("is-invalid", trimmedText.length === 0);
    if (trimmedText.length === 0 || trimmedText.length > 200) return;
    if (target.status === "STOPPED" && occurredAt === null) return;

    submitting = true;
    error.classList.add("d-none");
    update();
    try {
      const payload = { text: trimmedText };
      if (occurredAt !== null) payload.occurred_at = occurredAt;
      await createRunEvent(target.runID, payload);
      const completedTarget = target;
      target = null;
      occurredAt = null;
      submitting = false;
      modal.hide();
      await completedTarget.chart.refresh();
      successToast.show();
    } catch (submitError) {
      console.error("Failed to create run event:", submitError);
      submitting = false;
      error.textContent =
        submitError.status === 400
          ? "Не удалось добавить метку: проверьте текст и выбранное время."
          : "Не удалось добавить метку. Проверьте связь и попробуйте ещё раз.";
      error.classList.remove("d-none");
      update();
    }
  });

  text.addEventListener("input", () => {
    if (text.value.trim().length > 0) text.classList.remove("is-invalid");
  });
  modalElement.addEventListener("shown.bs.modal", () => {
    if (!focusTextOnShow) return;
    focusTextOnShow = false;
    text.focus();
  });
  modalElement.addEventListener("hide.bs.modal", (event) => {
    if (submitting) event.preventDefault();
  });
  modalElement.addEventListener("hidden.bs.modal", () => {
    if (!choosingPoint && !submitting) target = null;
  });

  return { open };
}
