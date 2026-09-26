package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"rectifier/internal/registry"
	"rectifier/internal/storage"
	"syscall"
	"time"
)

func Run(
	sensorRegistry registry.SensorRegistry,
	sensorRepository storage.SensorRepository,
	batchRepository storage.BatchRepository,
	runRepository storage.RunRepository,
	measurementRepository storage.MeasurementRepository,
) {
	appState := NewAppState()
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	if err := registerSensorMetrics(appState); err != nil {
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
	go runSensorPolling(appCtx, appState, sensorRegistry, measurementRepository)

	router := newRouter(
		appState,
		sensorRepository,
		batchRepository,
		runRepository,
		measurementRepository,
	)

	server := &http.Server{
		Addr:    ":8080",
		Handler: router,
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
