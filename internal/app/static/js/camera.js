export function initCamera() {
  const homeView = document.getElementById("home-view");
  const tabButtons = [...document.querySelectorAll("[data-home-tab]")];
  const panels = new Map(
    ["sensors", "process", "camera"]
      .map((name) => [name, document.getElementById(`${name}-tab-panel`)])
      .filter(([, panel]) => panel),
  );
  const cameraPanel = panels.get("camera");
  const hasCamera = Boolean(homeView?.dataset.cameraUrl && cameraPanel);

  const cameraContent = hasCamera
    ? document.getElementById("camera-content")
    : null;
  const stream = hasCamera ? document.getElementById("camera-stream") : null;
  const streamButton = hasCamera
    ? document.getElementById("open-camera-modal")
    : null;
  const error = hasCamera ? document.getElementById("camera-error") : null;
  const retryButton = hasCamera ? document.getElementById("retry-camera") : null;
  const modalElement = hasCamera
    ? document.getElementById("camera-modal")
    : null;
  const modalBody = hasCamera
    ? document.getElementById("camera-modal-body")
    : null;
  const closeViewerButton = hasCamera
    ? document.getElementById("close-camera-viewer")
    : null;
  const modal = hasCamera
    ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
    : null;

  let selectedTab = "process";
  const scrollPositions = new Map([...panels.keys()].map((tab) => [tab, 0]));
  let routeActive = true;
  let retryNumber = 0;
  let viewerOpen = false;
  let nativeFullscreenActive = false;
  let viewerOpener = null;

  function streamURLForAttempt() {
    const url = new URL(homeView.dataset.cameraUrl);
    if (retryNumber > 0) url.searchParams.set("camera_retry", retryNumber);
    return url.href;
  }

  function disconnect() {
    stream?.removeAttribute("src");
  }

  function connect() {
    if (!hasCamera || !routeActive || selectedTab !== "camera") return;
    error.classList.add("d-none");
    streamButton.classList.remove("d-none");
    if (!stream.hasAttribute("src")) stream.src = streamURLForAttempt();
  }

  function resize() {
    if (!hasCamera) return;
    const fitViewport = window.innerWidth >= 768 && window.innerHeight >= 500;
    if (!fitViewport) {
      cameraContent.style.removeProperty("height");
      return;
    }
    if (!routeActive || selectedTab !== "camera") return;

    const top = cameraContent.getBoundingClientRect().top;
    cameraContent.style.height = `${Math.max(160, window.innerHeight - top - 32)}px`;
  }

  function restoreViewerFocus() {
    const opener = viewerOpener;
    viewerOpener = null;
    requestAnimationFrame(() => opener?.focus());
  }

  function closeViewer() {
    if (!viewerOpen) return;
    viewerOpen = false;
    modal.hide();
    if (document.fullscreenElement === modalElement) {
      document.exitFullscreen().then(restoreViewerFocus).catch(restoreViewerFocus);
    }
  }

  function openViewer() {
    viewerOpen = true;
    nativeFullscreenActive = false;
    viewerOpener = document.activeElement;
    modal.show();

    if (typeof modalElement.requestFullscreen === "function") {
      modalElement.requestFullscreen().catch(() => {});
    }
  }

  function selectTab(tab) {
    if (!panels.has(tab)) return;
    const changingTab = selectedTab !== tab;
    if (changingTab) scrollPositions.set(selectedTab, window.scrollY);
    selectedTab = tab;

    for (const [name, panel] of panels) {
      panel.classList.toggle("d-none", name !== tab);
    }
    for (const button of tabButtons) {
      const selected = button.dataset.homeTab === tab;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    }

    if (tab !== "camera") {
      closeViewer();
      disconnect();
    }
    if (tab === "camera" && routeActive) {
      connect();
      requestAnimationFrame(resize);
    }
    if (changingTab) {
      requestAnimationFrame(() => {
        if (selectedTab !== tab) return;
        window.scrollTo(window.scrollX, scrollPositions.get(tab));
      });
    }

    document.dispatchEvent(
      new CustomEvent("rectifier:home-tab-changed", { detail: { tab } }),
    );
  }

  for (const button of tabButtons) {
    button.addEventListener("click", () => selectTab(button.dataset.homeTab));
  }

  if (hasCamera) {
    retryButton.addEventListener("click", () => {
      retryNumber += 1;
      disconnect();
      connect();
    });

    stream.addEventListener("load", () => {
      error.classList.add("d-none");
      streamButton.classList.remove("d-none");
    });

    stream.addEventListener("error", () => {
      if (
        !routeActive ||
        selectedTab !== "camera" ||
        !stream.hasAttribute("src")
      ) return;
      disconnect();
      closeViewer();
      streamButton.classList.add("d-none");
      error.classList.remove("d-none");
    });

    streamButton.addEventListener("click", openViewer);
    closeViewerButton.addEventListener("click", closeViewer);
    modalElement.addEventListener("show.bs.modal", () =>
      modalBody.append(stream),
    );
    modalElement.addEventListener("hidden.bs.modal", () => {
      viewerOpen = false;
      nativeFullscreenActive = false;
      streamButton.append(stream);
      if (document.fullscreenElement !== modalElement) restoreViewerFocus();
    });

    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement === modalElement) {
        nativeFullscreenActive = true;
        return;
      }
      if (viewerOpen && nativeFullscreenActive) closeViewer();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && viewerOpen) closeViewer();
    });
    window.addEventListener("beforeunload", disconnect);
  }

  selectTab("process");

  return {
    resize,
    selectTab,
    setActive(active) {
      routeActive = active;
      if (routeActive && selectedTab === "camera") {
        connect();
        requestAnimationFrame(resize);
      } else {
        closeViewer();
        disconnect();
      }
    },
  };
}
