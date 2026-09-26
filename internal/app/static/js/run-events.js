import { createRunEvent, deleteRunEvent, updateRunEvent } from "./api.js";

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
  const title = document.getElementById("run-event-title");
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
  const successToastBody = document.querySelector(
    "#run-event-success .toast-body",
  );
  const deleteModalElement = document.getElementById("delete-run-event-modal");
  const deleteModal = window.bootstrap.Modal.getOrCreateInstance(
    deleteModalElement,
  );
  const deleteForm = document.getElementById("delete-run-event-form");
  const deleteText = document.getElementById("delete-run-event-text");
  const deleteError = document.getElementById("delete-run-event-error");
  const deleteSubmit = document.getElementById("submit-delete-run-event");

  let target = null;
  let editing = null;
  let occurredAt = null;
  let submitting = false;
  let choosingPoint = false;
  let focusTextOnShow = false;
  let deletion = null;
  let deleting = false;

  function showSuccess(message) {
    successToastBody.textContent = message;
    successToast.show();
  }

  function updateDelete() {
    deleteSubmit.disabled = deleting;
    deleteSubmit.innerHTML = deleting
      ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Удаляем…'
      : "Удалить";
    for (const button of deleteModalElement.querySelectorAll(
      '[data-bs-dismiss="modal"]',
    )) {
      button.disabled = deleting;
    }
  }

  function openDelete(event, chart) {
    if (deleting) return;
    deletion = { event, chart };
    deleteText.textContent = event.text;
    deleteError.textContent = "";
    deleteError.classList.add("d-none");
    updateDelete();
    deleteModal.show();
  }

  function update() {
    const isEditing = editing !== null;
    const completed = !isEditing && target?.status === "STOPPED";
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
    const timeChanged = isEditing && occurredAt !== editing.occurredAt;
    resetTime.classList.toggle(
      "d-none",
      isEditing ? !timeChanged : completed || occurredAt === null,
    );
    resetTime.textContent = isEditing
      ? "Вернуть исходное время"
      : "Вернуть сейчас";
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
    const textChanged = isEditing && text.value.trim() !== editing.text;
    submit.disabled =
      submitting || needsPoint || (isEditing && !textChanged && !timeChanged);
    submit.innerHTML = submitting
      ? `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${isEditing ? "Сохраняем…" : "Добавляем…"}`
      : isEditing
        ? "Сохранить"
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
    editing = null;
    occurredAt = null;
    choosingPoint = false;
    submitting = false;
    focusTextOnShow = true;
    form.reset();
    title.textContent = "Новая метка";
    text.classList.remove("is-invalid");
    error.classList.add("d-none");
    error.textContent = "";
    update();
    modal.show();
  }

  function openEdit(event, chart) {
    if (submitting) return;
    target?.chart.cancelPointSelection();
    const originalTime = new Date(event.occurredAt).toISOString();
    target = { chart };
    editing = { id: event.id, text: event.text.trim(), occurredAt: originalTime };
    occurredAt = originalTime;
    choosingPoint = false;
    submitting = false;
    focusTextOnShow = true;
    form.reset();
    text.value = event.text;
    title.textContent = "Изменить метку";
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
    if (submitting) return;
    if (editing) occurredAt = editing.occurredAt;
    else if (target?.status === "RUNNING") occurredAt = null;
    else return;
    update();
  });

  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    if (submitting || !target) return;

    const trimmedText = text.value.trim();
    text.classList.toggle("is-invalid", trimmedText.length === 0);
    if (trimmedText.length === 0 || trimmedText.length > 200) return;
    if (!editing && target.status === "STOPPED" && occurredAt === null) return;

    const textChanged = editing && trimmedText !== editing.text;
    const timeChanged = editing && occurredAt !== editing.occurredAt;
    if (editing && !textChanged && !timeChanged) return;

    submitting = true;
    error.classList.add("d-none");
    update();
    try {
      let updatedEvent = null;
      if (editing) {
        const patch = {};
        if (textChanged) patch.text = trimmedText;
        if (timeChanged) patch.occurred_at = occurredAt;
        updatedEvent = await updateRunEvent(editing.id, patch);
      } else {
        const payload = { text: trimmedText };
        if (occurredAt !== null) payload.occurred_at = occurredAt;
        await createRunEvent(target.runID, payload);
      }
      const completedTarget = target;
      const wasEditing = editing !== null;
      if (wasEditing) completedTarget.chart.replaceMarker(updatedEvent);
      target = null;
      editing = null;
      occurredAt = null;
      submitting = false;
      modal.hide();
      if (wasEditing) void completedTarget.chart.refresh();
      else await completedTarget.chart.refresh();
      showSuccess(wasEditing ? "Метка изменена" : "Метка добавлена");
    } catch (submitError) {
      console.error(
        editing
          ? "Failed to update run event:"
          : "Failed to create run event:",
        submitError,
      );
      submitting = false;
      if (editing && submitError.status === 404) {
        const staleTarget = target;
        const staleEventID = editing.id;
        target = null;
        editing = null;
        occurredAt = null;
        staleTarget.chart.deleteMarker(staleEventID);
        modal.hide();
        showSuccess("Метка уже удалена");
        return;
      }
      error.textContent =
        submitError.status === 400
          ? `Не удалось ${editing ? "изменить" : "добавить"} метку: проверьте текст и выбранное время.`
          : `Не удалось ${editing ? "изменить" : "добавить"} метку. Проверьте связь и попробуйте ещё раз.`;
      error.classList.remove("d-none");
      update();
    }
  });

  text.addEventListener("input", () => {
    if (text.value.trim().length > 0) text.classList.remove("is-invalid");
    update();
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
    if (!choosingPoint && !submitting) {
      target = null;
      editing = null;
    }
  });

  deleteForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    if (deleting || !deletion) return;

    deleting = true;
    deleteError.classList.add("d-none");
    updateDelete();
    try {
      let message = "Метка удалена";
      try {
        await deleteRunEvent(deletion.event.id);
      } catch (deleteRequestError) {
        if (deleteRequestError.status !== 404) throw deleteRequestError;
        message = "Метка уже удалена";
      }

      const completedDeletion = deletion;
      deletion = null;
      deleting = false;
      completedDeletion.chart.deleteMarker(completedDeletion.event.id);
      deleteModal.hide();
      void completedDeletion.chart.refresh();
      showSuccess(message);
    } catch (deleteRequestError) {
      console.error("Failed to delete run event:", deleteRequestError);
      deleting = false;
      deleteError.textContent =
        "Не удалось удалить метку. Проверьте связь и попробуйте ещё раз.";
      deleteError.classList.remove("d-none");
      updateDelete();
    }
  });
  deleteModalElement.addEventListener("hide.bs.modal", (event) => {
    if (deleting) event.preventDefault();
  });
  deleteModalElement.addEventListener("hidden.bs.modal", () => {
    if (!deleting) deletion = null;
  });

  return { open, openEdit, openDelete };
}
