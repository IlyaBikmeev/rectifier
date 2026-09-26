package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"rectifier/internal/storage"
	"strconv"
	"strings"
	"time"
)

type runEventRequest struct {
	Text       string     `json:"text"`
	OccurredAt *time.Time `json:"occurred_at"`
}

type runEventResponse struct {
	ID         int       `json:"id"`
	RunID      int       `json:"run_id"`
	Text       string    `json:"text"`
	OccurredAt time.Time `json:"occurred_at"`
	CreatedAt  time.Time `json:"created_at"`
}

func handleCreateEvent(w http.ResponseWriter, r *http.Request, runEventRepository storage.RunEventRepository) {
	runID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || runID <= 0 {
		http.Error(w, "invalid run id", http.StatusBadRequest)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	var request runEventRequest

	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	request.Text = strings.TrimSpace(request.Text)
	if request.Text == "" {
		http.Error(w, "text is required", http.StatusBadRequest)
		return
	}

	if len([]rune(request.Text)) > 200 {
		http.Error(w, "text length exceeded", http.StatusBadRequest)
		return
	}

	createdEvent, err := runEventRepository.Create(r.Context(), storage.RunEvent{
		RunID:      runID,
		Text:       request.Text,
		OccurredAt: request.OccurredAt,
	})

	if err != nil {
		if errors.Is(err, storage.ErrRunEventTimeOutOfRange) {
			http.Error(w, err.Error(), http.StatusBadRequest)
		} else if errors.Is(err, storage.ErrRunNotFound) {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			fmt.Printf("handle create event error: %v\n", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
		}

		return
	}

	response := runEventResponse{
		ID:         createdEvent.ID,
		RunID:      createdEvent.RunID,
		Text:       createdEvent.Text,
		OccurredAt: *createdEvent.OccurredAt,
		CreatedAt:  createdEvent.CreatedAt,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusCreated)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		fmt.Printf("Encode create event response: %v\n", err)
	}

}
