package app

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"os/signal"
	"rectifier/internal/registry"
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

type indexView struct {
	Sensors []sensorView
}

func Run(sensorRegistry registry.SensorRegistry) {
	appState := NewAppState()
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	if err := registerSensorMetrics(sensorRegistry); err != nil {
		fmt.Printf("Register sensor metrics: %v\n", err)
		return
	}

	//TODO handle pollingDone before exiting
	go runSensorPolling(appCtx, appState, sensorRegistry)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		handleIndex(w, r, appState)
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

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	if err := indexTemplate.Execute(w, data); err != nil {
		fmt.Printf("Error rendering index: %v\n", err)
	}
}
