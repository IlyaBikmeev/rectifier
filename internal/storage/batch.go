package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type BatchRepository interface {
	All(ctx context.Context) ([]Batch, error)
	PageWithRuns(ctx context.Context, limit int, offset int) ([]Batch, error)
	Create(ctx context.Context, batch Batch) (Batch, error)
}

type Batch struct {
	ID        int
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
	Comment   string
	Runs      []Run
}

type SQLiteBatchRepository struct {
	db *sql.DB
}

var _ BatchRepository = (*SQLiteBatchRepository)(nil)

func NewSQLiteBatchRepository(db *sql.DB) *SQLiteBatchRepository {
	return &SQLiteBatchRepository{db: db}
}

func (br *SQLiteBatchRepository) All(ctx context.Context) ([]Batch, error) {

	rows, err := br.db.QueryContext(ctx, `
		SELECT id, name, created_at, updated_at, COALESCE(comment, '')
		FROM batches
		ORDER BY updated_at DESC
	`)

	if err != nil {
		return nil, fmt.Errorf("select all batches: %w", err)
	}
	defer rows.Close()

	batches := make([]Batch, 0)

	for rows.Next() {
		var batch Batch

		err := rows.Scan(
			&batch.ID,
			&batch.Name,
			&batch.CreatedAt,
			&batch.UpdatedAt,
			&batch.Comment,
		)

		if err != nil {
			return nil, fmt.Errorf("scan batch: %w", err)
		}

		batches = append(batches, batch)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate batches: %w", err)
	}

	return batches, nil
}

func (br *SQLiteBatchRepository) PageWithRuns(ctx context.Context, limit int, offset int) ([]Batch, error) {
	query := `
		WITH batch_page AS (
			SELECT id, name, created_at, updated_at, COALESCE(comment, '') AS comment
			FROM batches
			ORDER BY updated_at DESC, id DESC
			LIMIT ? OFFSET ?
		)
		SELECT
			b.id,
			b.name,
			b.created_at,
			b.updated_at,
			b.comment,
			r.id,
			r.type,
			r.status,
			r.started_at,
			r.stopped_at
		FROM batch_page b
		LEFT JOIN runs r ON r.batch_id = b.id
		ORDER BY
			b.updated_at DESC,
			b.id DESC,
			r.started_at DESC,
			r.id DESC
	`

	rows, err := br.db.QueryContext(ctx, query, limit, offset)

	if err != nil {
		return []Batch{}, fmt.Errorf("selecting batch page with runs: %w", err)
	}

	defer rows.Close()

	batches := make([]Batch, 0)

	for rows.Next() {
		var batch Batch
		var runID *int
		var runType *string
		var runStatus *string
		var runStartedAt *time.Time
		var runStoppedAt *time.Time

		if err := rows.Scan(
			&batch.ID,
			&batch.Name,
			&batch.CreatedAt,
			&batch.UpdatedAt,
			&batch.Comment,
			&runID,
			&runType,
			&runStatus,
			&runStartedAt,
			&runStoppedAt,
		); err != nil {
			return nil, fmt.Errorf("scan batch page with runs: %w", err)
		}

		if len(batches) == 0 || batches[len(batches)-1].ID != batch.ID {
			batch.Runs = make([]Run, 0)
			batches = append(batches, batch)
		}

		savedBatch := &batches[len(batches)-1]

		if runID != nil {
			savedBatch.Runs = append(savedBatch.Runs, Run{
				ID:        *runID,
				BatchID:   batch.ID,
				Type:      *runType,
				Status:    *runStatus,
				StartedAt: *runStartedAt,
				StoppedAt: runStoppedAt,
			})
		}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate batch page with runs: %w", err)
	}

	return batches, nil
}

func (br *SQLiteBatchRepository) Create(ctx context.Context, batch Batch) (Batch, error) {
	var savedBatch Batch
	now := time.Now().UTC()

	err := br.db.QueryRowContext(ctx, `
		INSERT INTO batches(
			name,
			created_at,
			updated_at,
			comment
		) VALUES(?, ?, ?, ?) RETURNING id, name, created_at, updated_at, comment
	`, batch.Name, now, now, batch.Comment).Scan(&savedBatch.ID, &savedBatch.Name, &savedBatch.CreatedAt, &savedBatch.UpdatedAt, &savedBatch.Comment)

	if err != nil {
		return Batch{}, fmt.Errorf("creating batch %q: %w", batch.Name, err)
	}

	return savedBatch, nil
}
