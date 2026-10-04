const storageKey = "rectifier.home.view.v1";
const supportedTabs = new Set(["sensors", "process", "camera"]);
const supportedAutoSwitchIntervals = new Set([5, 10, 20, 30, 60]);
const defaults = {
  selectedTab: "process",
  scrollPositions: {
    sensors: 0,
    process: 0,
    camera: 0,
  },
  autoSwitchEnabled: false,
  autoSwitchIntervalSeconds: 20,
};

function validScrollPosition(value) {
  return Number.isFinite(value) && value >= 0;
}

function normalize(saved) {
  return {
    selectedTab: supportedTabs.has(saved?.selectedTab)
      ? saved.selectedTab
      : defaults.selectedTab,
    scrollPositions: Object.fromEntries(
      [...supportedTabs].map((tab) => [
        tab,
        validScrollPosition(saved?.scrollPositions?.[tab])
          ? saved.scrollPositions[tab]
          : defaults.scrollPositions[tab],
      ]),
    ),
    autoSwitchEnabled:
      typeof saved?.autoSwitchEnabled === "boolean"
        ? saved.autoSwitchEnabled
        : defaults.autoSwitchEnabled,
    autoSwitchIntervalSeconds: supportedAutoSwitchIntervals.has(
      saved?.autoSwitchIntervalSeconds,
    )
      ? saved.autoSwitchIntervalSeconds
      : defaults.autoSwitchIntervalSeconds,
  };
}

function load() {
  try {
    return normalize(JSON.parse(window.localStorage.getItem(storageKey)));
  } catch {
    return normalize(null);
  }
}

export function createHomeViewPreferences() {
  let state = load();

  function save() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Keep the home view usable when browser storage is unavailable.
    }
  }

  return {
    get() {
      return {
        ...state,
        scrollPositions: { ...state.scrollPositions },
      };
    },
    setSelectedTab(tab) {
      if (!supportedTabs.has(tab)) return;
      state = { ...state, selectedTab: tab };
      save();
    },
    setScrollPosition(tab, position) {
      if (!supportedTabs.has(tab) || !validScrollPosition(position)) return;
      state = {
        ...state,
        scrollPositions: { ...state.scrollPositions, [tab]: position },
      };
      save();
    },
    setAutoSwitchEnabled(enabled) {
      if (typeof enabled !== "boolean") return;
      state = { ...state, autoSwitchEnabled: enabled };
      save();
    },
    setAutoSwitchIntervalSeconds(interval) {
      if (!supportedAutoSwitchIntervals.has(interval)) return;
      state = { ...state, autoSwitchIntervalSeconds: interval };
      save();
    },
  };
}
