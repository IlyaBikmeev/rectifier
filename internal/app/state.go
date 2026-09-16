package app

import (
	"sync"
	"time"
)

type AppState struct {
	mutex   sync.RWMutex
	process ProcessState
	sensors map[string]SensorState
}

type ProcessState struct {
	status       string // "STOPPED", "RUNNING", "ERROR"
	currentRunID string
	startedAt    time.Time
}

type SensorState struct {
	name               string
	enabled            bool
	temperature        float64
	lastSuccessfulRead time.Time
	status             string // "OK", "ERROR"
}

func NewAppState() *AppState {
	return &AppState{
		mutex: sync.RWMutex{},
		process: ProcessState{
			status: "STOPPED",
		},
		sensors: make(map[string]SensorState),
	}
}

func (appState *AppState) SensorsSnapshot() map[string]SensorState {
	appState.mutex.RLock()
	defer appState.mutex.RUnlock()
	snapshot := make(map[string]SensorState)

	for sensorId, sensor := range appState.sensors {
		snapshot[sensorId] = sensor
	}

	return snapshot
}

func (appState *AppState) SensorSnapshot(id string) (SensorState, bool) {
	appState.mutex.RLock()
	defer appState.mutex.RUnlock()

	if sensor, ok := appState.sensors[id]; ok && !sensor.lastSuccessfulRead.IsZero() {
		return sensor, true
	}

	return SensorState{}, false
}

func (appState *AppState) UpdateSensorMetadata(hardwareID string, name string, enabled bool) {
	appState.mutex.Lock()
	defer appState.mutex.Unlock()

	sensor, found := appState.sensors[hardwareID]
	if found {
		sensor.name = name
		sensor.enabled = enabled
		appState.sensors[hardwareID] = sensor
	} else {
		appState.sensors[hardwareID] = SensorState{
			name:    name,
			enabled: enabled,
		}
	}
}
