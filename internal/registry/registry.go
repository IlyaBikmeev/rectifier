package registry

import (
	"context"
	"rectifier/internal/sensor"
)

type SensorRegistry interface {
	Sensors() ([]sensor.TemperatureSensor, error)
	ReadTemperature(ctx context.Context, deviceID string) (float64, error)
}
