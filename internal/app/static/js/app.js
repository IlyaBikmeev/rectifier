import { createRunChart } from "./chart.js";
import { initRouter } from "./router.js";
import { initRuns } from "./runs.js";
import { initSensors } from "./sensors.js";

const pollingInterval = 5000;

initRouter({
  routes: new Map([
    ["#/", document.getElementById("home-view")],
    ["#/history", document.getElementById("history-view")],
  ]),
  navigationElement: document.getElementById("main-navigation"),
});

const chart = createRunChart({
  panel: document.getElementById("run-chart-panel"),
  loading: document.getElementById("run-chart-loading"),
  empty: document.getElementById("run-chart-empty"),
  container: document.getElementById("run-chart-container"),
  error: document.getElementById("run-chart-error"),
  canvas: document.getElementById("run-chart"),
});

const runs = initRuns({ chart, pollingInterval });

initSensors({
  pollingInterval,
  onSensorsChanged: runs.setSensors,
  onSyncChanged: runs.setSensorsSynchronized,
});
