package app

import (
	"context"
	"rectifier/internal/registry"
	"time"
)

const pollingInterval = 5 * time.Second

func runSensorPolling(ctx context.Context, appState *AppState, sensorRegistry registry.SensorRegistry) {
	pollSensors(ctx, appState, sensorRegistry)

	ticker := time.NewTicker(pollingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pollSensors(ctx, appState, sensorRegistry)
		}
	}
}

func pollSensors(ctx context.Context, appState *AppState, sensorRegistry registry.SensorRegistry) {
	sensors, err := sensorRegistry.Sensors()
	if err != nil {
		//TODO handle error
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
			sensorState.status = "ERROR"
			appState.sensors[discoveredSensor.ID()] = sensorState

			appState.mutex.Unlock()

			continue
		}

		appState.mutex.Lock()

		sensorState := appState.sensors[discoveredSensor.ID()]
		sensorState.lastSuccessfulRead = time.Now()
		sensorState.status = "OK"
		sensorState.temperature = temperature
		appState.sensors[discoveredSensor.ID()] = sensorState

		appState.mutex.Unlock()
	}
}
