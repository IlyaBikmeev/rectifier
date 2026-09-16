package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type SensorRepository interface {
	FindByHardwareID(ctx context.Context, hardwareID string) (Sensor, error)
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

func NewSensorRepository(db *sql.DB) *SQLiteSensorRepository {
	return &SQLiteSensorRepository{db: db}
}

func (sr *SQLiteSensorRepository) FindByHardwareID(ctx context.Context, hardwareID string) (Sensor, error) {
	var sensor Sensor

	row := sr.db.QueryRowContext(ctx, `
		SELECT id, hardware_id, name, measurement_type, unit, enabled, created_at, updated_at 
		FROM sensors WHERE hardware_id = ?
	`, hardwareID)

	err := row.Scan(
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
		return Sensor{}, fmt.Errorf("find by hardware id: %w", err)
	}

	return sensor, nil
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
