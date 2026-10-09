package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type BatchRepository interface {
	All(ctx context.Context) ([]Batch, error)
	PageWithRuns(ctx context.Context, limit int, offset int) ([]Batch, error)
	Create(ctx context.Context, batch Batch) (Batch, error)
	Delete(ctx context.Context, id int) error
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

var ErrBatchNotFound = errors.New("batch not found")
var ErrBatchHasRuns = errors.New("batch has runs")

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

func (br *SQLiteBatchRepository) Delete(ctx context.Context, id int) error {
	query := `
		DELETE FROM batches
		WHERE id = ?
	`

	tx, err := br.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete batch transaction: %w", err)
	}
	defer tx.Rollback()

	hasRuns, err := hasRuns(ctx, tx, id)
	if err != nil {
		return fmt.Errorf("batch has runs query: %w", err)
	}

	if hasRuns {
		return ErrBatchHasRuns
	}

	res, err := tx.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("batch delete query: %w", err)
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("batch delete rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return ErrBatchNotFound
	}

	if err = tx.Commit(); err != nil {
		return fmt.Errorf("batch delete commit transaction: %w", err)
	}
	return nil
}

func hasRuns(ctx context.Context, tx *sql.Tx, id int) (bool, error) {
	query := `
		SELECT 1
		FROM batches b
		INNER JOIN runs r ON r.batch_id = b.id
		WHERE b.id = ?
	`

	res := tx.QueryRowContext(ctx, query, id)

	var has bool
	if err := res.Scan(&has); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("has runs scan: %w", err)
	}

	return has, nil
}
