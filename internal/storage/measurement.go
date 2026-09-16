package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Measurement struct {
	RunID            int
	SensorHardwareID string
	MeasuredAt       time.Time
	Value            float64
}

type MeasurementRepository interface {
	Save(ctx context.Context, measurements []Measurement) error
}

type SQLiteMeasurementRepository struct {
	db *sql.DB
}

var _ MeasurementRepository = (*SQLiteMeasurementRepository)(nil)

func NewSQLiteMeasurementRepository(
	db *sql.DB,
) *SQLiteMeasurementRepository {
	return &SQLiteMeasurementRepository{db: db}
}

func (mr *SQLiteMeasurementRepository) Save(ctx context.Context, measurements []Measurement) error {
	if len(measurements) == 0 {
		return nil
	}

	tx, err := mr.db.BeginTx(ctx, nil)

	if err != nil {
		return fmt.Errorf("begin transaction in save measurements: %w", err)
	}
	defer tx.Rollback()

	const query = `
		INSERT INTO measurements(run_id, sensor_id, measured_at, value)
		SELECT
			rs.run_id,
			rs.sensor_id,
			?,
			?
		FROM run_sensors rs
		INNER JOIN sensors s ON s.id = rs.sensor_id
		INNER JOIN runs r ON r.id = rs.run_id
		WHERE rs.run_id = ?
			AND s.hardware_id = ?
			AND r.stopped_at IS NULL
	`

	for _, measurement := range measurements {
		result, err := tx.ExecContext(
			ctx,
			query,
			measurement.MeasuredAt,
			measurement.Value,
			measurement.RunID,
			measurement.SensorHardwareID,
		)
		if err != nil {
			return fmt.Errorf(
				"insert measurement for run %d and sensor %q: %w",
				measurement.RunID,
				measurement.SensorHardwareID,
				err,
			)
		}

		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf(
				"get affected rows for run %d and sensor %q: %w",
				measurement.RunID,
				measurement.SensorHardwareID,
				err,
			)
		}

		if affected != 1 {
			return fmt.Errorf(
				"run %d is stopped or sensor %q is not selected",
				measurement.RunID,
				measurement.SensorHardwareID,
			)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf(
			"commit save measurements transaction: %w",
			err,
		)
	}

	return nil
}
