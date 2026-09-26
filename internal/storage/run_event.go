package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type RunEventRepository interface {
	Create(ctx context.Context, event RunEvent) (RunEvent, error)
	All(ctx context.Context, runID int) ([]RunEvent, error)
	Delete(ctx context.Context, eventID int) error
}

type RunEvent struct {
	ID         int
	RunID      int
	Text       string
	OccurredAt *time.Time
	CreatedAt  time.Time
}

var (
	ErrRunEventNotFound       = errors.New("run event not found")
	ErrRunEventTimeOutOfRange = errors.New("run event time out of range")
)

type SQLiteRunEventRepository struct {
	db *sql.DB
}

var _ RunEventRepository = (*SQLiteRunEventRepository)(nil)

func NewRunEventRepository(db *sql.DB) *SQLiteRunEventRepository {
	return &SQLiteRunEventRepository{db: db}
}

func (s *SQLiteRunEventRepository) Create(ctx context.Context, event RunEvent) (RunEvent, error) {
	query := `
		INSERT INTO run_events(run_id, text, occurred_at, created_at)
		VALUES(?, ?, ?, ?)
		RETURNING id, run_id, text, occurred_at, created_at
	`

	now := time.Now().UTC()

	event.CreatedAt = now
	if event.OccurredAt == nil {
		event.OccurredAt = &now
	} else {
		occurredAt := event.OccurredAt.UTC()
		event.OccurredAt = &occurredAt
	}

	if err := s.validateOccurredAt(ctx, event.RunID, now, *event.OccurredAt); err != nil {
		return RunEvent{}, err
	}

	var savedEvent RunEvent

	err := s.db.QueryRowContext(ctx, query, event.RunID, event.Text, event.OccurredAt, event.CreatedAt).Scan(&savedEvent.ID, &savedEvent.RunID, &savedEvent.Text, &savedEvent.OccurredAt, &savedEvent.CreatedAt)
	if err != nil {
		return RunEvent{}, fmt.Errorf("insert into run events: %w", err)
	}

	return savedEvent, nil
}

func (s *SQLiteRunEventRepository) validateOccurredAt(ctx context.Context, runID int, now time.Time, occurredAt time.Time) error {
	var startedAt time.Time
	var stoppedAt *time.Time

	query := "SELECT started_at, stopped_at FROM runs WHERE id = ?"
	err := s.db.QueryRowContext(ctx, query, runID).Scan(&startedAt, &stoppedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrRunNotFound
		}

		return fmt.Errorf("validate occurred_at error: %w", err)
	}

	upperBound := now
	if stoppedAt != nil {
		upperBound = *stoppedAt
	}

	if occurredAt.Before(startedAt) || occurredAt.After(upperBound) {
		return ErrRunEventTimeOutOfRange
	}

	return nil
}

func (s *SQLiteRunEventRepository) All(ctx context.Context, runID int) ([]RunEvent, error) {
	var exists bool

	err := s.db.QueryRowContext(
		ctx,
		`SELECT EXISTS(SELECT 1 FROM runs WHERE id = ?)`,
		runID,
	).Scan(&exists)

	if err != nil {
		return nil, fmt.Errorf("check run existence: %w", err)
	}
	if !exists {
		return nil, ErrRunNotFound
	}

	query := `
		SELECT id, run_id, text, occurred_at, created_at
		FROM run_events
		WHERE run_id = ?
		ORDER BY occurred_at ASC, id ASC
	`

	rows, err := s.db.QueryContext(ctx, query, runID)

	if err != nil {
		return nil, fmt.Errorf("find all run events: %w", err)
	}

	runEvents := make([]RunEvent, 0)
	defer rows.Close()
	for rows.Next() {
		var runEvent RunEvent
		if err := rows.Scan(&runEvent.ID, &runEvent.RunID, &runEvent.Text, &runEvent.OccurredAt, &runEvent.CreatedAt); err != nil {
			return nil, fmt.Errorf("rows scan in find all run events: %w", err)
		}

		runEvents = append(runEvents, runEvent)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("err in rows in find all run events: %w", err)
	}

	return runEvents, nil
}

func (s *SQLiteRunEventRepository) Delete(ctx context.Context, eventID int) error {
	result, err := s.db.ExecContext(
		ctx,
		"DELETE FROM run_events WHERE id = ?",
		eventID,
	)
	if err != nil {
		return fmt.Errorf("delete run event %d: %w", eventID, err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get affected rows for run event %d: %w", eventID, err)
	}
	if affected != 1 {
		return ErrRunEventNotFound
	}

	return nil
}
