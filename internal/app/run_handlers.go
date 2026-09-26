package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"rectifier/internal/storage"
	"strconv"
	"time"
)

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

type runMeasurementsResponse struct {
	RunID   int                             `json:"run_id"`
	From    time.Time                       `json:"from"`
	To      time.Time                       `json:"to"`
	Sensors []runSensorMeasurementsResponse `json:"sensors"`
}

type runSensorMeasurementsResponse struct {
	HardwareID      string                     `json:"hardware_id"`
	Name            string                     `json:"name"`
	MeasurementType string                     `json:"measurement_type"`
	Unit            string                     `json:"unit"`
	Measurements    []measurementPointResponse `json:"measurements"`
}

type measurementPointResponse struct {
	MeasuredAt time.Time `json:"measured_at"`
	Value      float64   `json:"value"`
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

func handleStopRun(
	w http.ResponseWriter,
	r *http.Request,
	appState *AppState,
	runRepository storage.RunRepository,
) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		http.Error(w, "invalid run id", http.StatusBadRequest)
		return
	}

	process := appState.ProcessSnapshot()
	if process.status != ProcessStatusRunning ||
		process.activeRun == nil ||
		process.activeRun.id != id {
		http.Error(w, "run is not active", http.StatusConflict)
		return
	}

	if err := runRepository.Stop(r.Context(), id); err != nil {
		if errors.Is(err, storage.ErrRunNotActive) {
			http.Error(w, "run is not active", http.StatusConflict)
			return
		}

		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if !appState.StopRun(id) {
		http.Error(w, "run state changed concurrently", http.StatusConflict)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleRunMeasurements(
	w http.ResponseWriter,
	r *http.Request,
	measurementRepository storage.MeasurementRepository,
) {
	runID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || runID <= 0 {
		http.Error(w, "invalid run id", http.StatusBadRequest)
		return
	}

	from, err := parseOptionalRFC3339(r.URL.Query().Get("from"))
	if err != nil {
		http.Error(w, "invalid from timestamp", http.StatusBadRequest)
		return
	}

	to, err := parseOptionalRFC3339(r.URL.Query().Get("to"))
	if err != nil {
		http.Error(w, "invalid to timestamp", http.StatusBadRequest)
		return
	}

	if from != nil && to != nil && !from.Before(*to) {
		http.Error(w, "from must be before to", http.StatusBadRequest)
		return
	}

	measurements, err := measurementRepository.RunMeasurements(r.Context(), runID, from, to)
	if errors.Is(err, storage.ErrRunNotFound) {
		http.Error(w, "run not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if !measurements.From.Before(measurements.To) {
		http.Error(w, "from must be before to", http.StatusBadRequest)
		return
	}

	response := runMeasurementsResponse{
		RunID:   measurements.RunID,
		From:    measurements.From.UTC(),
		To:      measurements.To.UTC(),
		Sensors: make([]runSensorMeasurementsResponse, 0, len(measurements.Sensors)),
	}
	for _, sensor := range measurements.Sensors {
		sensorResponse := runSensorMeasurementsResponse{
			HardwareID:      sensor.HardwareID,
			Name:            sensor.Name,
			MeasurementType: sensor.MeasurementType,
			Unit:            sensor.Unit,
			Measurements:    make([]measurementPointResponse, 0, len(sensor.Measurements)),
		}
		for _, measurement := range sensor.Measurements {
			sensorResponse.Measurements = append(sensorResponse.Measurements, measurementPointResponse{
				MeasuredAt: measurement.MeasuredAt.UTC(),
				Value:      measurement.Value,
			})
		}
		response.Sensors = append(response.Sensors, sensorResponse)
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		fmt.Printf("Encode run measurements response: %v\n", err)
	}
}

func parseOptionalRFC3339(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}

	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, err
	}

	parsed = parsed.UTC()
	return &parsed, nil
}
