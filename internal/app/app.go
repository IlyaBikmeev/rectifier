package app

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"os/signal"
	"rectifier/internal/registry"
	"rectifier/internal/storage"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

//go:embed templates/index.html
var indexHTML string

//go:embed templates/icon.png
var iconPNG []byte

//go:embed static
var staticFiles embed.FS

var indexTemplate = template.Must(
	template.New("index").Parse(indexHTML),
)

type sensorView struct {
	ID              string
	Name            string
	MeasurementType string
	Unit            string
	Enabled         bool
	Temperature     float64
}

type sensorStatusResponse struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Temperature        float64   `json:"temperature"`
	LastSuccessfulRead time.Time `json:"last_successful_read"`
	Status             string    `json:"status"`
}

type updateSensorRequest struct {
	Name            *string `json:"name"`
	MeasurementType *string `json:"measurement_type"`
	Unit            *string `json:"unit"`
	Enabled         *bool   `json:"enabled"`
}

type updateSensorResponse struct {
	HardwareID      string    `json:"hardware_id"`
	Name            string    `json:"name"`
	MeasurementType string    `json:"measurement_type"`
	Unit            string    `json:"unit"`
	Enabled         bool      `json:"enabled"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type createBatchRequest struct {
	Name    *string `json:"name"`
	Comment string  `json:"comment"`
}

type batchResponse struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type indexView struct {
	Sensors []sensorView
}

type processResponse struct {
	Status     string             `json:"status"`
	ServerTime time.Time          `json:"server_time"`
	ActiveRun  *activeRunResponse `json:"active_run"`
}

type activeRunResponse struct {
	ID          int                    `json:"id"`
	Batch       activeRunBatchResponse `json:"batch"`
	Type        string                 `json:"type"`
	StartedAt   time.Time              `json:"started_at"`
	SensorCount int                    `json:"sensor_count"`
}

type activeRunBatchResponse struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type createRunRequest struct {
	BatchID           int      `json:"batch_id"`
	Type              string   `json:"type"`
	SensorHardwareIDs []string `json:"sensor_hardware_ids"`
}

func Run(
	sensorRegistry registry.SensorRegistry,
	sensorRepository storage.SensorRepository,
	batchRepository storage.BatchRepository,
	runRepository storage.RunRepository,
) {
	appState := NewAppState()
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	if err := registerSensorMetrics(appState, sensorRegistry); err != nil {
		fmt.Printf("Register sensor metrics: %v\n", err)
		return
	}

	if err := syncDiscoveredSensors(
		appCtx,
		appState,
		sensorRegistry,
		sensorRepository,
	); err != nil {
		fmt.Printf("Sync discovered sensors: %v\n", err)
		return
	}

	if err := restoreActiveRun(
		appCtx,
		appState,
		runRepository,
	); err != nil {
		fmt.Printf("Restore active run: %v\n", err)
		return
	}

	//TODO handle pollingDone before exiting
	go runSensorPolling(appCtx, appState, sensorRegistry)

	mux := http.NewServeMux()
	staticHandler := http.FileServerFS(staticFiles)
	mux.Handle("GET /static/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=86400")
		staticHandler.ServeHTTP(w, r)
	}))
	mux.HandleFunc("GET /icon.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		if _, err := w.Write(iconPNG); err != nil {
			fmt.Printf("Error serving icon: %v\n", err)
		}
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		handleIndex(w, r, appState)
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

	mux.Handle("GET /metrics", promhttp.Handler())

	server := &http.Server{
		Addr:    ":8080",
		Handler: mux,
	}

	serverErrors := make(chan error, 1)

	go func() {
		fmt.Printf("Server started on %s\n", server.Addr)

		serverErrors <- server.ListenAndServe()

	}()

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(
		shutdownSignal,
		os.Interrupt,
		syscall.SIGTERM,
	)

	select {
	case sig := <-shutdownSignal:
		fmt.Printf("Received signal: %s\n", sig)

	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			fmt.Printf("Server error: %v\n", err)
		}
		return
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)
	defer cancel()

	fmt.Println("Shutting down server...")

	if err := server.Shutdown(ctx); err != nil {
		fmt.Printf("Error shutting down server: %v\n", err)
		return
	}

	fmt.Println("Server stopped")
}

func restoreActiveRun(
	ctx context.Context,
	appState *AppState,
	runRepository storage.RunRepository,
) error {
	run, err := runRepository.Active(ctx)
	if err != nil {
		return fmt.Errorf("select active run: %w", err)
	}

	if run == nil {
		return nil
	}

	appState.RestoreActiveRun(ActiveRun{
		id:                run.ID,
		batchID:           run.BatchID,
		batchName:         run.BatchName,
		runType:           run.Type,
		startedAt:         run.StartedAt,
		sensorHardwareIDs: run.SensorHardwareIDs,
	})

	return nil
}

func syncDiscoveredSensors(
	ctx context.Context,
	appState *AppState,
	sensorRegistry registry.SensorRegistry,
	sensorRepository storage.SensorRepository,
) error {
	sensors, err := sensorRegistry.Sensors()
	if err != nil {
		return fmt.Errorf("sync discovered sensors: %w", err)
	}

	hardwareIDs := make([]string, 0, len(sensors))
	for _, sensor := range sensors {
		hardwareIDs = append(hardwareIDs, sensor.ID())

	}

	sensorsInDB, err := sensorRepository.FindByHardwareIDs(ctx, hardwareIDs)

	if err != nil {
		return fmt.Errorf("find sensors by hardware ids: %w", err)
	}

	sensorsMap := make(map[string]storage.Sensor)
	for _, sensorInDB := range sensorsInDB {
		sensorsMap[sensorInDB.HardwareID] = sensorInDB
	}

	for _, discoveredSensor := range sensors {
		persistedSensor, found := sensorsMap[discoveredSensor.ID()]

		if !found {
			fmt.Printf("sensor %q not found, saving in database ...\n", discoveredSensor.ID())
			persistedSensor, err = sensorRepository.Save(ctx, storage.Sensor{
				HardwareID:      discoveredSensor.ID(),
				Name:            discoveredSensor.Name(),
				MeasurementType: "temperature",
				Unit:            "celsius",
				Enabled:         true,
			})

			if err != nil {
				return fmt.Errorf("saving sensor %q in database: %w", discoveredSensor.ID(), err)
			}
		}

		appState.UpdateSensorMetadata(
			persistedSensor.HardwareID,
			persistedSensor.Name,
			persistedSensor.MeasurementType,
			persistedSensor.Unit,
			persistedSensor.Enabled,
		)
	}

	return nil
}

func handleProcess(w http.ResponseWriter, r *http.Request, appState *AppState) {
	process := appState.ProcessSnapshot()

	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	response := processResponse{
		Status:     string(process.status),
		ServerTime: time.Now().UTC(),
	}

	if process.activeRun != nil {
		response.ActiveRun = &activeRunResponse{
			ID: process.activeRun.id,
			Batch: activeRunBatchResponse{
				ID:   process.activeRun.batchID,
				Name: process.activeRun.batchName,
			},
			Type:        process.activeRun.runType,
			StartedAt:   process.activeRun.startedAt,
			SensorCount: len(process.activeRun.sensorHardwareIDs),
		}
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func handleIndex(w http.ResponseWriter, r *http.Request, appState *AppState) {
	sensors := appState.SensorsSnapshot()

	data := indexView{
		Sensors: make([]sensorView, 0, len(sensors)),
	}

	for sensorID, discoveredSensor := range sensors {
		data.Sensors = append(data.Sensors, sensorView{
			ID:              sensorID,
			Name:            discoveredSensor.name,
			MeasurementType: discoveredSensor.measurementType,
			Unit:            discoveredSensor.unit,
			Enabled:         discoveredSensor.enabled,
			Temperature:     discoveredSensor.temperature,
		})
	}

	sort.Slice(data.Sensors, func(i, j int) bool {
		return data.Sensors[i].Name < data.Sensors[j].Name
	})

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	if err := indexTemplate.Execute(w, data); err != nil {
		fmt.Printf("Error rendering index: %v\n", err)
	}
}

func handleStatus(w http.ResponseWriter, r *http.Request, appState *AppState) {
	sensors := appState.SensorsSnapshot()

	response := make([]sensorStatusResponse, 0, len(sensors))

	for sensorID, discoveredSensor := range sensors {
		response = append(response, sensorStatusResponse{
			ID:                 sensorID,
			Name:               discoveredSensor.name,
			Temperature:        discoveredSensor.temperature,
			LastSuccessfulRead: discoveredSensor.lastSuccessfulRead,
			Status:             discoveredSensor.status,
		})
	}

	sort.Slice(response, func(i, j int) bool {
		return response[i].Name < response[j].Name
	})

	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func handleUpdateSensor(
	w http.ResponseWriter,
	r *http.Request,
	appState *AppState,
	sensorRepository storage.SensorRepository) {

	hardwareID := r.PathValue("hardwareID")
	exists, err := sensorRepository.ExistsByHardwareID(r.Context(), hardwareID)

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if !exists {
		http.Error(w, fmt.Sprintf("Sensor %q not found", hardwareID), http.StatusNotFound)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	var request updateSensorRequest

	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if request.Name == nil || strings.TrimSpace(*request.Name) == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	if request.Enabled == nil {
		http.Error(w, "enabled is required", http.StatusBadRequest)
		return
	}

	if request.MeasurementType == nil || strings.TrimSpace(*request.MeasurementType) == "" {
		http.Error(w, "measurement_type is required", http.StatusBadRequest)
		return
	}

	if request.Unit == nil || strings.TrimSpace(*request.Unit) == "" {
		http.Error(w, "unit is required", http.StatusBadRequest)
		return
	}

	sensor, err := sensorRepository.Save(r.Context(), storage.Sensor{
		HardwareID:      hardwareID,
		Name:            strings.TrimSpace(*request.Name),
		MeasurementType: strings.TrimSpace(*request.MeasurementType),
		Unit:            strings.TrimSpace(*request.Unit),
		Enabled:         *request.Enabled,
	})

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	appState.UpdateSensorMetadata(
		hardwareID,
		sensor.Name,
		sensor.MeasurementType,
		sensor.Unit,
		sensor.Enabled,
	)

	response := updateSensorResponse{
		HardwareID:      sensor.HardwareID,
		Name:            sensor.Name,
		MeasurementType: sensor.MeasurementType,
		Unit:            sensor.Unit,
		Enabled:         sensor.Enabled,
		CreatedAt:       sensor.CreatedAt,
		UpdatedAt:       sensor.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func handleBatches(w http.ResponseWriter, r *http.Request, batchRepository storage.BatchRepository) {
	batches, err := batchRepository.All(r.Context())

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var response = make([]batchResponse, 0, len(batches))

	for _, batch := range batches {
		response = append(response, batchResponse{
			ID:        batch.ID,
			Name:      batch.Name,
			Comment:   batch.Comment,
			CreatedAt: batch.CreatedAt,
			UpdatedAt: batch.UpdatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func handleCreateBatch(w http.ResponseWriter, r *http.Request, batchRepository storage.BatchRepository) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	var request createBatchRequest

	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if request.Name == nil || strings.TrimSpace(*request.Name) == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	batch, err := batchRepository.Create(r.Context(), storage.Batch{
		Name:    strings.TrimSpace(*request.Name),
		Comment: strings.TrimSpace(request.Comment),
	})

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := batchResponse{
		ID:        batch.ID,
		Name:      batch.Name,
		Comment:   batch.Comment,
		CreatedAt: batch.CreatedAt,
		UpdatedAt: batch.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusCreated)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func handleCreateRun(w http.ResponseWriter, r *http.Request, appState *AppState, runRepository storage.RunRepository) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	var request createRunRequest

	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if request.BatchID <= 0 {
		http.Error(w, "batch_id is required", http.StatusBadRequest)
		return
	}

	if request.Type != "stripping" &&
		request.Type != "rectification" {
		http.Error(w, "unsupported run type", http.StatusBadRequest)
		return
	}

	if len(request.SensorHardwareIDs) == 0 {
		http.Error(
			w,
			"at least one sensor is required",
			http.StatusBadRequest,
		)
		return
	}

	process := appState.ProcessSnapshot()
	if process.status != ProcessStatusStopped {
		http.Error(
			w,
			"run is already active",
			http.StatusConflict,
		)
		return
	}

	sensors := appState.SensorsSnapshot()

	for _, hardwareID := range request.SensorHardwareIDs {
		sensor, found := sensors[hardwareID]
		if !found {
			http.Error(
				w,
				fmt.Sprintf("sensor %q does not exist", hardwareID),
				http.StatusBadRequest,
			)
			return
		}

		if !sensor.enabled {
			http.Error(
				w,
				fmt.Sprintf("sensor %q is disabled", hardwareID),
				http.StatusBadRequest,
			)
			return
		}

		if sensor.status != "OK" {
			http.Error(
				w,
				fmt.Sprintf("sensor %q is unavailable", hardwareID),
				http.StatusBadRequest,
			)
			return
		}

		if sensor.lastSuccessfulRead.IsZero() {
			http.Error(
				w,
				fmt.Sprintf("sensor %q has no successful readings", hardwareID),
				http.StatusBadRequest,
			)
			return
		}
	}

	run, err := runRepository.Create(r.Context(), storage.Run{
		BatchID:           request.BatchID,
		Type:              request.Type,
		SensorHardwareIDs: request.SensorHardwareIDs,
	})

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	appState.RestoreActiveRun(ActiveRun{
		id:                run.ID,
		batchID:           run.BatchID,
		batchName:         run.BatchName,
		runType:           run.Type,
		startedAt:         run.StartedAt,
		sensorHardwareIDs: run.SensorHardwareIDs,
	})

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusCreated)

	response := activeRunResponse{
		ID: run.ID,
		Batch: activeRunBatchResponse{
			ID:   run.BatchID,
			Name: run.BatchName,
		},
		Type:        run.Type,
		StartedAt:   run.StartedAt,
		SensorCount: len(run.SensorHardwareIDs),
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		fmt.Printf("Encode create run response: %v\n", err)
	}
}
