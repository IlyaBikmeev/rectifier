package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type BatchRepository interface {
	All(ctx context.Context) ([]Batch, error)
	Create(ctx context.Context, batch Batch) (Batch, error)
}

type Batch struct {
	ID        int
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
	Comment   string
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
