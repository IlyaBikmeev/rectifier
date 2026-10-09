package app

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"rectifier/internal/storage"
	"strconv"
	"strings"
	"time"
)

type createBatchRequest struct {
	Name    *string `json:"name"`
	Comment string  `json:"comment"`
}

type batchResponse struct {
	ID        int            `json:"id"`
	Name      string         `json:"name"`
	Comment   string         `json:"comment"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	Runs      *[]runResponse `json:"runs,omitempty"`
}

type runResponse struct {
	ID        int        `json:"id"`
	Type      string     `json:"type"`
	Status    string     `json:"status"`
	StartedAt time.Time  `json:"started_at"`
	StoppedAt *time.Time `json:"stopped_at"`
}

func handleBatches(w http.ResponseWriter, r *http.Request, batchRepository storage.BatchRepository) {
	query := r.URL.Query()
	include := query.Get("include")
	if include != "" && include != "runs" {
		http.Error(w, "unsupported include", http.StatusBadRequest)
		return
	}

	limit := 10
	if value := query.Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			http.Error(w, "invalid limit value", http.StatusBadRequest)
			return
		}
		limit = parsed
	}

	offset := 0
	if value := query.Get("offset"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 0 {
			http.Error(w, "invalid offset value", http.StatusBadRequest)
			return
		}
		offset = parsed
	}

	includeRuns := include == "runs"

	var (
		batches []storage.Batch
		err     error
	)

	if includeRuns {
		batches, err = batchRepository.PageWithRuns(r.Context(), limit, offset)
	} else {
		batches, err = batchRepository.All(r.Context())
	}

	if err != nil {
		slog.Error("get batches failed", "error", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	var response = make([]batchResponse, 0, len(batches))

	for _, batch := range batches {
		batchItem := batchResponse{
			ID:        batch.ID,
			Name:      batch.Name,
			Comment:   batch.Comment,
			CreatedAt: batch.CreatedAt,
			UpdatedAt: batch.UpdatedAt,
		}
		if includeRuns {
			runs := mapRuns(batch.Runs)
			batchItem.Runs = &runs
		}
		response = append(response, batchItem)
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("encode batches response failed", "error", err)
	}
}

func mapRuns(runs []storage.Run) []runResponse {
	response := make([]runResponse, 0, len(runs))

	for _, run := range runs {
		response = append(response, runResponse{
			ID:        run.ID,
			Type:      run.Type,
			Status:    run.Status,
			StartedAt: run.StartedAt,
			StoppedAt: run.StoppedAt,
		})
	}
	return response
}

func handleCreateBatch(w http.ResponseWriter, r *http.Request, batchRepository storage.BatchRepository) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	var request createBatchRequest

	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if request.Name == nil || strings.TrimSpace(*request.Name) == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	batch, err := batchRepository.Create(r.Context(), storage.Batch{
		Name:    strings.TrimSpace(*request.Name),
		Comment: strings.TrimSpace(request.Comment),
	})

	if err != nil {
		slog.Error("create batch failed", "error", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	slog.Info("batch created", "batch_id", batch.ID)

	response := batchResponse{
		ID:        batch.ID,
		Name:      batch.Name,
		Comment:   batch.Comment,
		CreatedAt: batch.CreatedAt,
		UpdatedAt: batch.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusCreated)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("encode create batch response failed", "batch_id", batch.ID, "error", err)
	}
}

func handleDeleteBatch(w http.ResponseWriter, r *http.Request, batchRepository storage.BatchRepository) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		http.Error(w, "invalid batch id", http.StatusBadRequest)
		return
	}

	err = batchRepository.Delete(r.Context(), id)
	if err != nil {
		if errors.Is(err, storage.ErrBatchHasRuns) {
			http.Error(w, "batch has runs", http.StatusConflict)
		} else if errors.Is(err, storage.ErrBatchNotFound) {
			http.Error(w, "batch not found", http.StatusNotFound)
		} else {
			slog.Error("delete batch failed", "batch_id", id, "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
		}
		return
	}

	slog.Info("batch deleted", "batch_id", id)
	w.WriteHeader(http.StatusNoContent)
}
