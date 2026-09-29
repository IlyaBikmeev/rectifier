package app

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

type processResponse struct {
	Status     string             `json:"status"`
	ServerTime time.Time          `json:"server_time"`
	ActiveRun  *activeRunResponse `json:"active_run"`
}

func handleProcess(w http.ResponseWriter, r *http.Request, appState *AppState) {
	process := appState.ProcessSnapshot()

	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	response := processResponse{
		Status:     string(process.status),
		ServerTime: time.Now().UTC(),
	}

	if process.activeRun != nil {
		response.ActiveRun = &activeRunResponse{
			ID: process.activeRun.id,
			Batch: activeRunBatchResponse{
				ID:   process.activeRun.batchID,
				Name: process.activeRun.batchName,
			},
			Type:        process.activeRun.runType,
			StartedAt:   process.activeRun.startedAt,
			SensorCount: len(process.activeRun.sensorHardwareIDs),
		}
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("encode process response failed", "error", err)
	}
}
