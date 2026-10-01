export function initAutoSwitch({ camera }) {
  const enabledInput = document.getElementById("auto-switch-enabled");
  const intervalSelect = document.getElementById("auto-switch-interval");
  if (!enabledInput || !intervalSelect) {
    return { setRouteActive() {} };
  }

  let selectedTab = "process";
  let routeActive = true;
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
    if (!enabledInput.checked || isPaused()) return;

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

  enabledInput.addEventListener("change", schedule);
  intervalSelect.addEventListener("change", schedule);
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

  return {
    setRouteActive(active) {
      routeActive = active;
      schedule();
    },
  };
}
