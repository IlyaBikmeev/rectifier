package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"rectifier/internal/registry"
	"rectifier/internal/storage"
	"sync"
	"syscall"
	"time"
)

func Run(
	version string,
	sensorRegistry registry.SensorRegistry,
	sensorRepository storage.SensorRepository,
	batchRepository storage.BatchRepository,
	runRepository storage.RunRepository,
	measurementRepository storage.MeasurementRepository,
	runEventRepository storage.RunEventRepository,
) {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))

	appState := NewAppState()
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	if err := registerSensorMetrics(appState); err != nil {
		slog.Error("register sensor metrics", "error", err)
		return
	}

	if err := syncDiscoveredSensors(
		appCtx,
		appState,
		sensorRegistry,
		sensorRepository,
	); err != nil {
		slog.Error("sync discovered sensors", "error", err)
		return
	}

	if err := restoreActiveRun(
		appCtx,
		appState,
		runRepository,
	); err != nil {
		slog.Error("restore active run", "error", err)
		return
	}

	var wg sync.WaitGroup

	wg.Add(1)
	go runSensorPolling(&wg, appCtx, appState, sensorRegistry, measurementRepository)

	router := newRouter(
		version,
		appState,
		sensorRepository,
		batchRepository,
		runRepository,
		measurementRepository,
		runEventRepository,
	)

	server := &http.Server{
		Addr:    ":8080",
		Handler: router,
	}

	serverErrors := make(chan error, 1)

	go func() {
		slog.Info(
			"server started",
			"addr", server.Addr,
			"version", version,
		)

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
		slog.Info("shutdown started", "signal", sig.String())

	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server stopped unexpectedly", "error", err)
		}

		cancelApp()
		wg.Wait()
		return
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)
	defer cancel()

	slog.Info("http server shutdown started")

	shutdownErr := server.Shutdown(ctx)
	cancelApp()
	wg.Wait()

	if shutdownErr != nil {
		slog.Error("http server shutdown failed", "error", shutdownErr)
		return
	}

	slog.Info("shutdown completed")
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
	slog.Info("active run restored", "run_id", run.ID, "batch_id", run.BatchID, "type", run.Type)

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
			slog.Info("sensor discovered", "sensor_id", discoveredSensor.ID())
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
