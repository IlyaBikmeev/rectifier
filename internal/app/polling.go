package app

import (
	"context"
	"log/slog"
	"rectifier/internal/registry"
	"rectifier/internal/storage"
	"time"
)

const pollingInterval = 5 * time.Second

func runSensorPolling(ctx context.Context, appState *AppState, sensorRegistry registry.SensorRegistry, measurementRepository storage.MeasurementRepository) {
	pollSensors(ctx, appState, sensorRegistry, measurementRepository)

	ticker := time.NewTicker(pollingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pollSensors(ctx, appState, sensorRegistry, measurementRepository)
		}
	}
}

func pollSensors(ctx context.Context, appState *AppState, sensorRegistry registry.SensorRegistry, measurementRepository storage.MeasurementRepository) {
	process := appState.ProcessSnapshot()

	selectedSensors := make(map[string]struct{})
	if process.status == ProcessStatusRunning && process.activeRun != nil {
		for _, hardwareID := range process.activeRun.sensorHardwareIDs {
			selectedSensors[hardwareID] = struct{}{}
		}
	}
	measurements := make([]storage.Measurement, 0, len(selectedSensors))

	sensors, err := sensorRegistry.Sensors()
	if err != nil {
		slog.Warn("sensor discovery failed", "error", err)
		return
	}

	for _, discoveredSensor := range sensors {
		select {
		case <-ctx.Done():
			return
		default:
		}

		temperature, err := sensorRegistry.ReadTemperature(ctx, discoveredSensor.ID())
		if err != nil {
			if ctx.Err() != nil {
				return
			}

			appState.mutex.Lock()

			sensorState := appState.sensors[discoveredSensor.ID()]
			previousStatus := sensorState.status
			sensorState.status = "ERROR"
			appState.sensors[discoveredSensor.ID()] = sensorState

			appState.mutex.Unlock()

			if previousStatus != "ERROR" {
				slog.Warn("sensor read failed", "sensor_id", discoveredSensor.ID(), "error", err)
			}

			continue
		}

		measuredAt := time.Now().UTC()

		appState.mutex.Lock()

		sensorState := appState.sensors[discoveredSensor.ID()]
		previousStatus := sensorState.status
		sensorState.lastSuccessfulRead = measuredAt
		sensorState.status = "OK"
		sensorState.temperature = temperature
		appState.sensors[discoveredSensor.ID()] = sensorState

		appState.mutex.Unlock()

		if previousStatus == "ERROR" {
			slog.Info("sensor recovered", "sensor_id", discoveredSensor.ID())
		}

		if _, selected := selectedSensors[discoveredSensor.ID()]; selected {
			measurements = append(measurements, storage.Measurement{
				RunID:            process.activeRun.id,
				SensorHardwareID: discoveredSensor.ID(),
				MeasuredAt:       measuredAt,
				Value:            temperature,
			})
		}
	}

	if err := measurementRepository.Save(ctx, measurements); err != nil {
		attrs := []any{"error", err}
		if process.activeRun != nil {
			attrs = append(attrs, "run_id", process.activeRun.id)
		}
		slog.Error("save measurements failed", attrs...)
	}
}
