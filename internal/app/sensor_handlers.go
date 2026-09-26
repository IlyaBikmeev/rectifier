package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"rectifier/internal/storage"
	"sort"
	"strings"
	"time"
)

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
