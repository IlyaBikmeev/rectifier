package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type RunRepository interface {
	Active(ctx context.Context) (*Run, error)
}

type SQLiteRunRepository struct {
	db *sql.DB
}

var _ RunRepository = (*SQLiteRunRepository)(nil)

func NewSQLiteRunRepository(db *sql.DB) *SQLiteRunRepository {
	return &SQLiteRunRepository{db: db}
}

type Run struct {
	ID                int
	BatchID           int
	BatchName         string
	Type              string
	StartedAt         time.Time
	StoppedAt         time.Time
	Status            string
	SensorHardwareIDs []string
}

func (rr *SQLiteRunRepository) Active(ctx context.Context) (*Run, error) {
	const query = `
		SELECT r.id, r.batch_id, r.type, r.started_at, r.status, b.name
		FROM runs r
		INNER JOIN batches b ON b.id = r.batch_id
		WHERE status = 'RUNNING'
			AND stopped_at IS NULL
		ORDER BY started_at DESC
		LIMIT 1
	`

	var run Run

	err := rr.db.QueryRowContext(ctx, query).Scan(
		&run.ID,
		&run.BatchID,
		&run.Type,
		&run.StartedAt,
		&run.Status,
		&run.BatchName,
	)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("select active run: %w", err)
	}

	const sensorsQuery = `
		SELECT s.hardware_id
		FROM run_sensors rs
		INNER JOIN sensors s ON s.id = rs.sensor_id
		WHERE rs.run_id = ?
		ORDER BY rs.sensor_name
	`

	rows, err := rr.db.QueryContext(ctx, sensorsQuery, run.ID)
	if err != nil {
		return nil, fmt.Errorf(
			"select sensors for active run %d: %w",
			run.ID,
			err,
		)
	}
	defer rows.Close()

	run.SensorHardwareIDs = make([]string, 0)

	for rows.Next() {
		var hardwareID string

		if err := rows.Scan(&hardwareID); err != nil {
			return nil, fmt.Errorf(
				"scan sensor for active run %d: %w",
				run.ID,
				err,
			)
		}

		run.SensorHardwareIDs = append(run.SensorHardwareIDs, hardwareID)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf(
			"iterate sensors for active run %d: %w",
			run.ID,
			err,
		)
	}

	return &run, nil
}
