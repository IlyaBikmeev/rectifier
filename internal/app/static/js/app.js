import { createRunChart } from "./chart.js";
import { initAutoSwitch } from "./auto-switch.js";
import { initCamera } from "./camera.js";
import { initHistory } from "./history.js";
import { initRouter } from "./router.js";
import { initRunEvents } from "./run-events.js";
import { initRuns } from "./runs.js";
import { initSensors } from "./sensors.js";

const pollingInterval = 5000;
const runEvents = initRunEvents();

const chart = createRunChart({
  panel: document.getElementById("run-chart-panel"),
  loading: document.getElementById("run-chart-loading"),
  empty: document.getElementById("run-chart-empty"),
  container: document.getElementById("run-chart-container"),
  error: document.getElementById("run-chart-error"),
  canvas: document.getElementById("run-chart"),
  viewportControls: document.getElementById("run-chart-viewport-controls"),
  selectionHint: document.getElementById("run-chart-pick-hint"),
  markerDetails: document.getElementById("run-chart-marker-details"),
  onEditMarker: (event) => runEvents.openEdit(event, chart),
  onDeleteMarker: (event) => runEvents.openDelete(event, chart),
  fitViewport: true,
});

const camera = initCamera({ onProcessShown: chart.fitToViewport });
const autoSwitch = initAutoSwitch({ camera });

let resizeFrame = null;
window.addEventListener("resize", () => {
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    chart.fitToViewport();
    camera.resize();
  });
});

const runs = initRuns({
  chart,
  runEvents,
  pollingInterval,
});

const historyChart = createRunChart({
  panel: document.getElementById("history-chart-panel"),
  loading: document.getElementById("history-chart-loading"),
  empty: document.getElementById("history-chart-empty"),
  container: document.getElementById("history-chart-container"),
  error: document.getElementById("history-chart-error"),
  canvas: document.getElementById("history-chart"),
  viewportControls: document.getElementById("history-chart-viewport-controls"),
  selectionHint: document.getElementById("history-chart-pick-hint"),
  markerDetails: document.getElementById("history-chart-marker-details"),
  onEditMarker: (event) => runEvents.openEdit(event, historyChart),
  onDeleteMarker: (event) => runEvents.openDelete(event, historyChart),
});

const history = initHistory({
  chart: historyChart,
  runEvents,
  pollingInterval,
  pageSize: 10,
});

initRouter({
  routes: new Map([
    ["#/", document.getElementById("home-view")],
    ["#/history", document.getElementById("history-view")],
  ]),
  navigationElement: document.getElementById("main-navigation"),
  onRouteChanged: (route) => {
    history.setActive(route === "#/history");
    camera.setActive(route === "#/");
    autoSwitch.setRouteActive(route === "#/");
  },
});

initSensors({
  pollingInterval,
  onSensorsChanged: runs.setSensors,
  onSyncChanged: runs.setSensorsSynchronized,
});
