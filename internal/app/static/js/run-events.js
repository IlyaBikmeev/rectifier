import { createRunEvent } from "./api.js";

const eventTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function initRunEvents() {
  const modalElement = document.getElementById("run-event-modal");
  const modal = window.bootstrap.Modal.getOrCreateInstance(modalElement);
  const form = document.getElementById("run-event-form");
  const text = document.getElementById("run-event-text");
  const time = document.getElementById("run-event-time-description");
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

  function update() {
    const completed = target?.status === "STOPPED";
    const canPick = Boolean(target?.chart.canSelectPoint());
    const needsPoint = completed && occurredAt === null;

    time.textContent = occurredAt
      ? eventTimeFormatter.format(new Date(occurredAt))
      : completed
        ? "Выберите момент на графике"
        : "Сейчас";
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
  modalElement.addEventListener("shown.bs.modal", () => text.focus());
  modalElement.addEventListener("hide.bs.modal", (event) => {
    if (submitting) event.preventDefault();
  });
  modalElement.addEventListener("hidden.bs.modal", () => {
    if (!choosingPoint && !submitting) target = null;
  });

  return { open };
}
