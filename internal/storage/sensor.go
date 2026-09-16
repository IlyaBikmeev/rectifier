package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type SensorRepository interface {
	FindByHardwareIDs(ctx context.Context, hardwareIDs []string) ([]Sensor, error)
	Save(ctx context.Context, sensor Sensor) (Sensor, error)
}

type SQLiteSensorRepository struct {
	db *sql.DB
}

var _ SensorRepository = (*SQLiteSensorRepository)(nil)

type Sensor struct {
	ID              int
	HardwareID      string
	Name            string
	MeasurementType string
	Unit            string
	Enabled         bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func NewSQLiteSensorRepository(db *sql.DB) *SQLiteSensorRepository {
	return &SQLiteSensorRepository{db: db}
}

func (sr *SQLiteSensorRepository) FindByHardwareIDs(ctx context.Context, hardwareIDs []string) ([]Sensor, error) {
	if len(hardwareIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(hardwareIDs))
	args := make([]any, len(hardwareIDs))

	for i, hardwareID := range hardwareIDs {
		placeholders[i] = "?"
		args[i] = hardwareID
	}

	query := fmt.Sprintf(`
		SELECT id, hardware_id, name, measurement_type, unit, enabled, created_at, updated_at 
		FROM sensors WHERE hardware_id in (%s)
	`, strings.Join(placeholders, ", "))

	rows, err := sr.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("select sensors by hardware IDs: %w", err)
	}
	defer rows.Close()

	sensors := make([]Sensor, 0, len(hardwareIDs))

	for rows.Next() {
		var sensor Sensor

		err := rows.Scan(
			&sensor.ID,
			&sensor.HardwareID,
			&sensor.Name,
			&sensor.MeasurementType,
			&sensor.Unit,
			&sensor.Enabled,
			&sensor.CreatedAt,
			&sensor.UpdatedAt,
		)

		if err != nil {
			return nil, fmt.Errorf("scan sensor: %w", err)
		}

		sensors = append(sensors, sensor)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sensors: %w", err)
	}

	return sensors, nil
}

func (sr *SQLiteSensorRepository) Save(ctx context.Context, sensor Sensor) (Sensor, error) {
	var savedSensor Sensor

	now := time.Now().UTC()

	err := sr.db.QueryRowContext(ctx, `
		INSERT INTO sensors(
			hardware_id,
			name,
			measurement_type,
			unit,
			enabled,
			created_at,
			updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (hardware_id) DO UPDATE SET
			name = excluded.name,
			measurement_type = excluded.measurement_type,
			unit = excluded.unit,
			enabled = excluded.enabled,
			updated_at = excluded.updated_at
		RETURNING
			id,
			hardware_id,
			name,
			measurement_type,
			unit,
			enabled,
			created_at,
			updated_at
	`, sensor.HardwareID, sensor.Name, sensor.MeasurementType, sensor.Unit, sensor.Enabled, now, now).Scan(
		&savedSensor.ID,
		&savedSensor.HardwareID,
		&savedSensor.Name,
		&savedSensor.MeasurementType,
		&savedSensor.Unit,
		&savedSensor.Enabled,
		&savedSensor.CreatedAt,
		&savedSensor.UpdatedAt,
	)

	if err != nil {
		return Sensor{}, fmt.Errorf("save sensor %q: %w", sensor.HardwareID, err)
	}

	return savedSensor, nil
}
