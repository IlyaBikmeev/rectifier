package app

import (
	"context"
	_ "embed"
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
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

//go:embed templates/index.html
var indexHTML string

var indexTemplate = template.Must(
	template.New("index").Parse(indexHTML),
)

type sensorView struct {
	ID          string
	Name        string
	Temperature float64
}

type sensorStatusResponse struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Temperature        float64   `json:"temperature"`
	LastSuccessfulRead time.Time `json:"last_successful_read"`
	Status             string    `json:"status"`
}

type indexView struct {
	Sensors []sensorView
}

func Run(sensorRegistry registry.SensorRegistry, sensorRepository storage.SensorRepository) {
	appState := NewAppState()
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	if err := registerSensorMetrics(appState, sensorRegistry); err != nil {
		fmt.Printf("Register sensor metrics: %v\n", err)
		return
	}

	if err := syncDiscoveredSensors(
		appCtx,
		sensorRegistry,
		sensorRepository,
	); err != nil {
		fmt.Printf("Sync discovered sensors: %v\n", err)
		return
	}

	//TODO handle pollingDone before exiting
	go runSensorPolling(appCtx, appState, sensorRegistry)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		handleIndex(w, r, appState)
	})
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		handleStatus(w, r, appState)
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

func syncDiscoveredSensors(
	ctx context.Context,
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

	sensorsMap := make(map[string]struct{})
	for _, sensorInDB := range sensorsInDB {
		sensorsMap[sensorInDB.HardwareID] = struct{}{}
	}

	for _, discoveredSensor := range sensors {
		if _, found := sensorsMap[discoveredSensor.ID()]; !found {
			fmt.Printf("sensor %q not found, saving in database ...\n", discoveredSensor.ID())
			_, err := sensorRepository.Save(ctx, storage.Sensor{
				HardwareID:      discoveredSensor.ID(),
				Name:            discoveredSensor.ID(),
				MeasurementType: "temperature",
				Unit:            "celsius",
				Enabled:         true,
			})

			if err != nil {
				return fmt.Errorf("saving sensor %q in database: %w", discoveredSensor.ID(), err)
			}
		}
	}

	return nil
}

func handleIndex(w http.ResponseWriter, r *http.Request, appState *AppState) {
	sensors := appState.SensorsSnapshot()

	data := indexView{
		Sensors: make([]sensorView, 0, len(sensors)),
	}

	for sensorID, discoveredSensor := range sensors {
		data.Sensors = append(data.Sensors, sensorView{
			ID:          sensorID,
			Name:        discoveredSensor.name,
			Temperature: discoveredSensor.temperature,
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
