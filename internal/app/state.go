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

type ProcessStatus string

const (
	ProcessStatusStopped  ProcessStatus = "STOPPED"
	ProcessStatusStarting ProcessStatus = "STARTING"
	ProcessStatusRunning  ProcessStatus = "RUNNING"
	ProcessStatusStopping ProcessStatus = "STOPPING"
)

type ProcessState struct {
	status    ProcessStatus
	activeRun *ActiveRun
}

type ActiveRun struct {
	id                int
	batchID           int
	batchName         string
	runType           string
	startedAt         time.Time
	sensorHardwareIDs []string
}

type SensorState struct {
	name               string
	measurementType    string
	unit               string
	enabled            bool
	temperature        float64
	lastSuccessfulRead time.Time
	status             string // "OK", "ERROR"
}

func NewAppState() *AppState {
	return &AppState{
		mutex: sync.RWMutex{},
		process: ProcessState{
			status: ProcessStatusStopped,
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

func (appState *AppState) ProcessSnapshot() ProcessState {
	appState.mutex.RLock()
	defer appState.mutex.RUnlock()

	var activeRun *ActiveRun

	if appState.process.activeRun == nil {
		activeRun = nil
	} else {
		activeRun = &ActiveRun{
			id:                appState.process.activeRun.id,
			batchID:           appState.process.activeRun.batchID,
			batchName:         appState.process.activeRun.batchName,
			runType:           appState.process.activeRun.runType,
			startedAt:         appState.process.activeRun.startedAt,
			sensorHardwareIDs: append([]string(nil), appState.process.activeRun.sensorHardwareIDs...),
		}
	}

	return ProcessState{
		status:    appState.process.status,
		activeRun: activeRun,
	}
}

func (appState *AppState) SensorSnapshot(id string) (SensorState, bool) {
	appState.mutex.RLock()
	defer appState.mutex.RUnlock()

	if sensor, ok := appState.sensors[id]; ok && !sensor.lastSuccessfulRead.IsZero() {
		return sensor, true
	}

	return SensorState{}, false
}

func (appState *AppState) UpdateSensorMetadata(
	hardwareID string,
	name string,
	measurementType string,
	unit string,
	enabled bool,
) {
	appState.mutex.Lock()
	defer appState.mutex.Unlock()

	sensor, found := appState.sensors[hardwareID]
	if found {
		sensor.name = name
		sensor.measurementType = measurementType
		sensor.unit = unit
		sensor.enabled = enabled
		appState.sensors[hardwareID] = sensor
	} else {
		appState.sensors[hardwareID] = SensorState{
			name:            name,
			measurementType: measurementType,
			unit:            unit,
			enabled:         enabled,
		}
	}
}

func (appState *AppState) RestoreActiveRun(run ActiveRun) {
	appState.mutex.Lock()
	defer appState.mutex.Unlock()

	appState.process = ProcessState{
		status:    ProcessStatusRunning,
		activeRun: &run,
	}
}

func (appState *AppState) StopRun(id int) bool {
	appState.mutex.Lock()
	defer appState.mutex.Unlock()

	if appState.process.status != ProcessStatusRunning ||
		appState.process.activeRun == nil ||
		appState.process.activeRun.id != id {
		return false
	}

	appState.process = ProcessState{status: ProcessStatusStopped}
	return true
}
