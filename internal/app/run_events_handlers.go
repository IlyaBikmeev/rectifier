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

type runEventRequest struct {
	Text       string     `json:"text"`
	OccurredAt *time.Time `json:"occurred_at"`
}

type updateRunEventRequest struct {
	Text       *string    `json:"text"`
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
			slog.Error("create run event failed", "run_id", runID, "error", err)
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
		slog.Error("encode create run event response failed", "run_id", runID, "event_id", createdEvent.ID, "error", err)
	}

}

func handleGetEvents(w http.ResponseWriter, r *http.Request, runEventRepository storage.RunEventRepository) {
	runID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || runID <= 0 {
		http.Error(w, "invalid run id", http.StatusBadRequest)
		return
	}

	runEvents, err := runEventRepository.All(r.Context(), runID)

	if err != nil {
		if errors.Is(err, storage.ErrRunNotFound) {
			http.Error(w, "run not found", http.StatusNotFound)
		} else {
			slog.Error("get run events failed", "run_id", runID, "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
		}
		return
	}

	responses := make([]runEventResponse, 0, len(runEvents))

	for _, event := range runEvents {
		response := runEventResponse{
			ID:         event.ID,
			RunID:      event.RunID,
			Text:       event.Text,
			OccurredAt: *event.OccurredAt,
			CreatedAt:  event.CreatedAt,
		}

		responses = append(responses, response)
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)

	if err := json.NewEncoder(w).Encode(responses); err != nil {
		slog.Error("encode run events response failed", "run_id", runID, "error", err)
	}
}

func handleDeleteEvent(w http.ResponseWriter, r *http.Request, runEventRepository storage.RunEventRepository) {
	eventID, err := strconv.Atoi(r.PathValue("eventID"))
	if err != nil || eventID <= 0 {
		http.Error(w, "invalid event id", http.StatusBadRequest)
		return
	}

	if err := runEventRepository.Delete(r.Context(), eventID); err != nil {
		if errors.Is(err, storage.ErrRunEventNotFound) {
			http.Error(w, "run event not found", http.StatusNotFound)
		} else {
			slog.Error("delete run event failed", "event_id", eventID, "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func handleUpdateEvent(w http.ResponseWriter, r *http.Request, runEventRepository storage.RunEventRepository) {
	eventID, err := strconv.Atoi(r.PathValue("eventID"))
	if err != nil || eventID <= 0 {
		http.Error(w, "invalid event id", http.StatusBadRequest)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	var request updateRunEventRequest
	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if request.Text == nil && request.OccurredAt == nil {
		http.Error(w, "text or occurred_at is required", http.StatusBadRequest)
		return
	}
	if request.Text != nil {
		trimmedText := strings.TrimSpace(*request.Text)
		if trimmedText == "" {
			http.Error(w, "text is required", http.StatusBadRequest)
			return
		}
		if len([]rune(trimmedText)) > 200 {
			http.Error(w, "text length exceeded", http.StatusBadRequest)
			return
		}
		request.Text = &trimmedText
	}

	updatedEvent, err := runEventRepository.Update(r.Context(), eventID, storage.RunEventUpdate{
		Text:       request.Text,
		OccurredAt: request.OccurredAt,
	})
	if err != nil {
		if errors.Is(err, storage.ErrRunEventTimeOutOfRange) {
			http.Error(w, err.Error(), http.StatusBadRequest)
		} else if errors.Is(err, storage.ErrRunEventNotFound) {
			http.Error(w, "run event not found", http.StatusNotFound)
		} else {
			slog.Error("update run event failed", "event_id", eventID, "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
		}
		return
	}

	response := runEventResponse{
		ID:         updatedEvent.ID,
		RunID:      updatedEvent.RunID,
		Text:       updatedEvent.Text,
		OccurredAt: *updatedEvent.OccurredAt,
		CreatedAt:  updatedEvent.CreatedAt,
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("encode update run event response failed", "event_id", eventID, "error", err)
	}
}
