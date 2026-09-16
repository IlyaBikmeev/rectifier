package storage

import (
	"context"
	"database/sql"
	"errors"
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
	RunMeasurements(ctx context.Context, runID int, from, to *time.Time) (*RunMeasurements, error)
}

var ErrRunNotFound = errors.New("run not found")

type MeasurementPoint struct {
	MeasuredAt time.Time
	Value      float64
}

type RunSensorMeasurements struct {
	HardwareID      string
	Name            string
	MeasurementType string
	Unit            string
	Measurements    []MeasurementPoint
}

type RunMeasurements struct {
	RunID   int
	From    time.Time
	To      time.Time
	Sensors []RunSensorMeasurements
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

func (mr *SQLiteMeasurementRepository) RunMeasurements(
	ctx context.Context,
	runID int,
	from, to *time.Time,
) (*RunMeasurements, error) {
	var startedAt time.Time
	var stoppedAt sql.NullTime

	err := mr.db.QueryRowContext(ctx, `
		SELECT started_at, stopped_at
		FROM runs
		WHERE id = ?
	`, runID).Scan(&startedAt, &stoppedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrRunNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("select run %d measurement bounds: %w", runID, err)
	}

	appliedFrom := startedAt.UTC()
	if from != nil {
		appliedFrom = from.UTC()
	}

	appliedTo := time.Now().UTC()
	if stoppedAt.Valid {
		appliedTo = stoppedAt.Time.UTC()
	}
	if to != nil {
		appliedTo = to.UTC()
	}

	result := &RunMeasurements{
		RunID:   runID,
		From:    appliedFrom,
		To:      appliedTo,
		Sensors: make([]RunSensorMeasurements, 0),
	}

	rows, err := mr.db.QueryContext(ctx, `
		SELECT
			s.hardware_id,
			rs.sensor_name,
			s.measurement_type,
			s.unit,
			m.measured_at,
			m.value
		FROM run_sensors rs
		INNER JOIN sensors s ON s.id = rs.sensor_id
		LEFT JOIN measurements m
			ON m.run_id = rs.run_id
			AND m.sensor_id = rs.sensor_id
			AND m.measured_at >= ?
			AND m.measured_at < ?
		WHERE rs.run_id = ?
		ORDER BY rs.sensor_name, s.hardware_id, m.measured_at, m.id
	`, appliedFrom, appliedTo, runID)
	if err != nil {
		return nil, fmt.Errorf("select measurements for run %d: %w", runID, err)
	}
	defer rows.Close()

	for rows.Next() {
		var hardwareID, name, measurementType, unit string
		var measuredAt sql.NullTime
		var value sql.NullFloat64

		if err := rows.Scan(
			&hardwareID,
			&name,
			&measurementType,
			&unit,
			&measuredAt,
			&value,
		); err != nil {
			return nil, fmt.Errorf("scan measurements for run %d: %w", runID, err)
		}

		if len(result.Sensors) == 0 || result.Sensors[len(result.Sensors)-1].HardwareID != hardwareID {
			result.Sensors = append(result.Sensors, RunSensorMeasurements{
				HardwareID:      hardwareID,
				Name:            name,
				MeasurementType: measurementType,
				Unit:            unit,
				Measurements:    make([]MeasurementPoint, 0),
			})
		}

		if measuredAt.Valid {
			sensor := &result.Sensors[len(result.Sensors)-1]
			sensor.Measurements = append(sensor.Measurements, MeasurementPoint{
				MeasuredAt: measuredAt.Time.UTC(),
				Value:      value.Float64,
			})
		}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate measurements for run %d: %w", runID, err)
	}

	return result, nil
}
