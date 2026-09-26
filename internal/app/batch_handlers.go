package app

import (
	"encoding/json"
	"net/http"
	"rectifier/internal/storage"
	"strings"
	"time"
)

type createBatchRequest struct {
	Name    *string `json:"name"`
	Comment string  `json:"comment"`
}

type batchResponse struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func handleBatches(w http.ResponseWriter, r *http.Request, batchRepository storage.BatchRepository) {
	batches, err := batchRepository.All(r.Context())

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var response = make([]batchResponse, 0, len(batches))

	for _, batch := range batches {
		response = append(response, batchResponse{
			ID:        batch.ID,
			Name:      batch.Name,
			Comment:   batch.Comment,
			CreatedAt: batch.CreatedAt,
			UpdatedAt: batch.UpdatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

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
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
