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
	Create(ctx context.Context, run Run) (*Run, error)
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

func (rr *SQLiteRunRepository) Create(ctx context.Context, run Run) (*Run, error) {
	const runQuery = `
		INSERT INTO runs(
			batch_id,
			type,
			started_at,
			status
		) VALUES (?, ?, ?, ?) RETURNING id
	`

	const runSensorsQuery = `
		INSERT INTO run_sensors(
			run_id,
			sensor_id,
			sensor_name
		)
		SELECT
			?,
			id,
			name
		FROM sensors
		WHERE hardware_id = ?
			AND enabled = TRUE
	`

	if len(run.SensorHardwareIDs) == 0 {
		return nil, errors.New(
			"create run: at least one sensor is required",
		)
	}

	run.StartedAt = time.Now().UTC()
	run.Status = "RUNNING"

	tx, err := rr.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin create run transaction: %w", err)
	}
	defer tx.Rollback()

	err = tx.QueryRowContext(
		ctx,
		"SELECT name FROM batches WHERE id = ?",
		run.BatchID,
	).Scan(&run.BatchName)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("batch with id %d does not exist", run.BatchID)
	}

	if err != nil {
		return nil, fmt.Errorf("select batch for run: %w", err)
	}

	err = tx.QueryRowContext(ctx, runQuery, run.BatchID, run.Type, run.StartedAt, run.Status).Scan(&run.ID)

	if err != nil {
		return nil, fmt.Errorf("insert run: %w", err)
	}

	for _, hardwareID := range run.SensorHardwareIDs {
		result, err := tx.ExecContext(
			ctx,
			runSensorsQuery,
			run.ID,
			hardwareID,
		)

		if err != nil {
			return nil, fmt.Errorf(
				"insert sensor %q into run %d: %w",
				hardwareID,
				run.ID,
				err,
			)
		}

		affected, err := result.RowsAffected()
		if err != nil {
			return nil, fmt.Errorf(
				"get affected rows for sensor %q: %w",
				hardwareID,
				err,
			)
		}

		if affected == 0 {
			return nil, fmt.Errorf(
				"sensor %q does not exist or is disabled",
				hardwareID,
			)
		}

	}

	_, err = tx.ExecContext(
		ctx,
		"UPDATE batches SET updated_at = ? WHERE id = ?",
		run.StartedAt,
		run.BatchID,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"update batch %d timestamp: %w",
			run.BatchID,
			err,
		)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit create run transaction: %w", err)
	}

	return &run, nil
}
