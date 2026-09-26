import { createRunChart } from "./chart.js";
import { initHistory } from "./history.js";
import { initRouter } from "./router.js";
import { initRuns } from "./runs.js";
import { initSensors } from "./sensors.js";

const pollingInterval = 5000;

const chart = createRunChart({
  panel: document.getElementById("run-chart-panel"),
  loading: document.getElementById("run-chart-loading"),
  empty: document.getElementById("run-chart-empty"),
  container: document.getElementById("run-chart-container"),
  error: document.getElementById("run-chart-error"),
  canvas: document.getElementById("run-chart"),
});

const runs = initRuns({ chart, pollingInterval });

const historyChart = createRunChart({
  panel: document.getElementById("history-chart-panel"),
  loading: document.getElementById("history-chart-loading"),
  empty: document.getElementById("history-chart-empty"),
  container: document.getElementById("history-chart-container"),
  error: document.getElementById("history-chart-error"),
  canvas: document.getElementById("history-chart"),
});

const history = initHistory({
  chart: historyChart,
  pollingInterval,
  pageSize: 10,
});

initRouter({
  routes: new Map([
    ["#/", document.getElementById("home-view")],
    ["#/history", document.getElementById("history-view")],
  ]),
  navigationElement: document.getElementById("main-navigation"),
  onRouteChanged: (route) => history.setActive(route === "#/history"),
});

initSensors({
  pollingInterval,
  onSensorsChanged: runs.setSensors,
  onSyncChanged: runs.setSensorsSynchronized,
});
