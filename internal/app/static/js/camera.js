const cameraPort = "8081";

export function initCamera({ preferences, initiallyActive = true }) {
  const homeView = document.getElementById("home-view");
  const tabButtons = [...document.querySelectorAll("[data-home-tab]")];
  const panels = new Map(
    ["sensors", "process", "camera"]
      .map((name) => [name, document.getElementById(`${name}-tab-panel`)])
      .filter(([, panel]) => panel),
  );
  const cameraPanel = panels.get("camera");
  const cameraCapabilityElements = [
    ...document.querySelectorAll("[data-camera-capability]"),
  ];
  const cameraContent = document.getElementById("camera-content");
  const stream = document.getElementById("camera-stream");
  const streamButton = document.getElementById("open-camera-modal");
  const error = document.getElementById("camera-error");
  const retryButton = document.getElementById("retry-camera");
  const modalElement = document.getElementById("camera-modal");
  const modalBody = document.getElementById("camera-modal-body");
  const closeViewerButton = document.getElementById("close-camera-viewer");
  const modal = modalElement
    ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
    : null;

  let cameraAvailable = false;
  const initialPreferences = preferences.get();
  let selectedTab = "process";
  const scrollPositions = new Map(
    [...panels.keys()].map((tab) => [
      tab,
      initialPreferences.scrollPositions[tab],
    ]),
  );
  let routeActive = initiallyActive;
  let retryNumber = 0;
  let viewerOpen = false;
  let nativeFullscreenActive = false;
  let viewerOpener = null;

  function cameraStreamURL() {
    const url = new URL(window.location.href);
    url.port = cameraPort;
    url.pathname = "/stream";
    url.search = "";
    url.hash = "";
    return url;
  }

  function streamURLForAttempt() {
    const url = cameraStreamURL();
    if (retryNumber > 0) url.searchParams.set("camera_retry", retryNumber);
    return url.href;
  }

  function revealCameraCapability() {
    if (cameraAvailable) return;
    cameraAvailable = true;
    for (const element of cameraCapabilityElements) {
      element.classList.remove("d-none");
      if (element.tagName === "DIV") element.classList.add("d-flex");
    }
    document.dispatchEvent(new CustomEvent("rectifier:camera-available"));
    if (preferences.get().selectedTab === "camera") {
      selectTab("camera", { captureCurrentScroll: false });
    }
  }

  function detectCamera() {
    if (!cameraPanel || !stream) return;

    const probe = new Image();
    const cleanup = () => {
      probe.onload = null;
      probe.onerror = null;
      probe.removeAttribute("src");
    };

    probe.onload = () => {
      cleanup();
      revealCameraCapability();
    };
    probe.onerror = cleanup;
    probe.src = cameraStreamURL().href;
  }

  function disconnect() {
    stream?.removeAttribute("src");
  }

  function connect() {
    if (!cameraAvailable || !routeActive || selectedTab !== "camera") return;
    error.classList.add("d-none");
    streamButton.classList.remove("d-none");
    if (!stream.hasAttribute("src")) stream.src = streamURLForAttempt();
  }

  function resize() {
    if (!cameraAvailable) return;
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

  function restoreScrollPosition(y) {
    const rootStyle = document.documentElement.style;
    const scrollBehavior = rootStyle.getPropertyValue("scroll-behavior");
    const scrollBehaviorPriority = rootStyle.getPropertyPriority("scroll-behavior");
    rootStyle.setProperty("scroll-behavior", "auto", "important");
    try {
      window.scrollTo(window.scrollX, y);
    } finally {
      if (scrollBehavior) {
        rootStyle.setProperty(
          "scroll-behavior",
          scrollBehavior,
          scrollBehaviorPriority,
        );
      } else {
        rootStyle.removeProperty("scroll-behavior");
      }
    }
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

  function selectTab(
    tab,
    {
      captureCurrentScroll = true,
      persistSelection = true,
      restore = false,
    } = {},
  ) {
    if (!panels.has(tab)) return false;
    if (tab === "camera" && !cameraAvailable) return false;
    const changingTab = selectedTab !== tab;
    if (changingTab && captureCurrentScroll) {
      scrollPositions.set(selectedTab, window.scrollY);
      preferences.setScrollPosition(selectedTab, window.scrollY);
    }
    selectedTab = tab;
    if (persistSelection) preferences.setSelectedTab(tab);

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
    if (changingTab || restore) {
      requestAnimationFrame(() => {
        if (selectedTab !== tab) return;
        restoreScrollPosition(scrollPositions.get(tab));
      });
    }

    document.dispatchEvent(
      new CustomEvent("rectifier:home-tab-changed", { detail: { tab } }),
    );
    return true;
  }

  for (const button of tabButtons) {
    button.addEventListener("click", () => selectTab(button.dataset.homeTab));
  }

  if (cameraPanel && stream && streamButton && error && retryButton && modalElement && modalBody && closeViewerButton && modal) {
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

  window.addEventListener("pagehide", () => {
    scrollPositions.set(selectedTab, window.scrollY);
    preferences.setScrollPosition(selectedTab, window.scrollY);
  });

  const initialTab =
    initialPreferences.selectedTab === "camera"
      ? "process"
      : initialPreferences.selectedTab;
  selectTab(initialTab, { persistSelection: false, restore: true });
  detectCamera();

  return {
    resize,
    selectTab,
    getSelectedTab() {
      return selectedTab;
    },
    isAvailable() {
      return cameraAvailable;
    },
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
