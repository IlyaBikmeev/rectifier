package app

import (
	"net/http"
	"rectifier/internal/storage"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func newRouter(
	version string,
	appState *AppState,
	sensorRepository storage.SensorRepository,
	batchRepository storage.BatchRepository,
	runRepository storage.RunRepository,
	measurementRepository storage.MeasurementRepository,
	runEventRepository storage.RunEventRepository,
) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /static/", handleStatic)
	mux.HandleFunc("GET /icon.png", handleIcon)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		handleIndex(w, r, appState, version)
	})
	mux.HandleFunc("GET /api/process", func(w http.ResponseWriter, r *http.Request) {
		handleProcess(w, r, appState)
	})
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		handleStatus(w, r, appState)
	})
	mux.HandleFunc("PUT /api/sensors/{hardwareID}", func(w http.ResponseWriter, r *http.Request) {
		handleUpdateSensor(w, r, appState, sensorRepository)
	})
	mux.HandleFunc("GET /api/batches", func(w http.ResponseWriter, r *http.Request) {
		handleBatches(w, r, batchRepository)
	})
	mux.HandleFunc("POST /api/batches", func(w http.ResponseWriter, r *http.Request) {
		handleCreateBatch(w, r, batchRepository)
	})
	mux.HandleFunc("POST /api/runs", func(w http.ResponseWriter, r *http.Request) {
		handleCreateRun(w, r, appState, runRepository)
	})
	mux.HandleFunc("GET /api/runs/{id}/measurements", func(w http.ResponseWriter, r *http.Request) {
		handleRunMeasurements(w, r, measurementRepository)
	})
	mux.HandleFunc("POST /api/runs/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		handleStopRun(w, r, appState, runRepository)
	})
	mux.HandleFunc("POST /api/runs/{id}/events", func(w http.ResponseWriter, r *http.Request) {
		handleCreateEvent(w, r, runEventRepository)
	})
	mux.HandleFunc("GET /api/runs/{id}/events", func(w http.ResponseWriter, r *http.Request) {
		handleGetEvents(w, r, runEventRepository)
	})
	mux.HandleFunc("DELETE /api/events/{eventID}", func(w http.ResponseWriter, r *http.Request) {
		handleDeleteEvent(w, r, runEventRepository)
	})
	mux.HandleFunc("PATCH /api/events/{eventID}", func(w http.ResponseWriter, r *http.Request) {
		handleUpdateEvent(w, r, runEventRepository)
	})

	mux.Handle("GET /metrics", promhttp.Handler())

	return mux
}
