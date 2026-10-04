export function initAutoSwitch({ camera, preferences, initiallyActive = true }) {
  const enabledInput = document.getElementById("auto-switch-enabled");
  const intervalSelect = document.getElementById("auto-switch-interval");
  if (!enabledInput || !intervalSelect) {
    return { setRouteActive() {} };
  }

  const initialPreferences = preferences.get();
  enabledInput.checked = initialPreferences.autoSwitchEnabled;
  intervalSelect.value = String(
    initialPreferences.autoSwitchIntervalSeconds,
  );

  let selectedTab = camera.getSelectedTab();
  let routeActive = initiallyActive;
  let viewerOpen = false;
  let timer = null;
  const openModals = new Set();

  function clearTimer() {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  }

  function isPaused() {
    return (
      !routeActive ||
      viewerOpen ||
      openModals.size > 0 ||
      document.hidden
    );
  }

  function schedule() {
    clearTimer();
    if (!enabledInput.checked || !camera.isAvailable() || isPaused()) return;

    const delay = Number(intervalSelect.value) * 1000;
    timer = window.setTimeout(() => {
      timer = null;
      const nextTab = {
        sensors: "process",
        process: "camera",
        camera: "sensors",
      }[selectedTab];
      camera.selectTab(nextTab);
    }, delay);
  }

  enabledInput.addEventListener("change", () => {
    preferences.setAutoSwitchEnabled(enabledInput.checked);
    schedule();
  });
  intervalSelect.addEventListener("change", () => {
    preferences.setAutoSwitchIntervalSeconds(Number(intervalSelect.value));
    schedule();
  });
  document.addEventListener("rectifier:home-tab-changed", (event) => {
    selectedTab = event.detail.tab;
    schedule();
  });
  document.addEventListener("show.bs.modal", (event) => {
    openModals.add(event.target);
    if (event.target.id === "camera-modal") viewerOpen = true;
    schedule();
  });
  document.addEventListener("hidden.bs.modal", (event) => {
    openModals.delete(event.target);
    if (event.target.id === "camera-modal") viewerOpen = false;
    schedule();
  });
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("rectifier:camera-available", schedule);

  schedule();

  return {
    setRouteActive(active) {
      routeActive = active;
      schedule();
    },
  };
}
