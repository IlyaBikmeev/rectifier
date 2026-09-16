package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type BatchRepository interface {
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
