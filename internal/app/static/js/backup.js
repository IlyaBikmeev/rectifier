import { getBackup } from "./api.js";

export function initBackup() {
  const button = document.getElementById("download-backup");
  const spinner = button.querySelector("[data-backup-spinner]");
  const icon = button.querySelector("[data-backup-icon]");
  const successIcon = button.querySelector("[data-backup-success-icon]");
  const label = button.querySelector("[data-backup-label]");
  const message = document.getElementById("backup-message");

  function hideMessage() {
    message.textContent = "";
    message.className = "alert d-none py-2 mb-3";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
  }

  function showError(text) {
    message.textContent = text;
    message.className = "alert alert-warning py-2 mb-3";
    message.setAttribute("role", "alert");
    message.setAttribute("aria-live", "assertive");
  }

  function setButtonState(state) {
    const pending = state === "pending";
    const success = state === "success";

    button.disabled = state !== "idle";
    button.setAttribute("aria-busy", String(pending));
    spinner.classList.toggle("d-none", !pending);
    icon.classList.toggle("d-none", state !== "idle");
    successIcon.classList.toggle("d-none", !success);

    if (pending) {
      label.textContent = "Создаём копию…";
    } else if (success) {
      label.textContent = "Готово";
    } else {
      label.textContent = "Скачать резервную копию";
    }
  }

  button.addEventListener("click", async () => {
    hideMessage();
    setButtonState("pending");

    try {
      const { blob, filename } = await getBackup();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);

      setButtonState("success");
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } catch (error) {
      console.error("Download backup failed", error);
      showError("Не удалось создать резервную копию. Попробуйте ещё раз.");
    } finally {
      setButtonState("idle");
    }
  });
}
