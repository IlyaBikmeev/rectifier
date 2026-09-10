package registry

import (
	"context"
	"fmt"
	"rectifier/internal/sensor"
)

type InMemoryRegistry struct {
	sensors []sensor.TemperatureSensor
}

func New(sensors ...sensor.TemperatureSensor) *InMemoryRegistry {
	return &InMemoryRegistry{
		sensors: sensors,
	}
}

func (r *InMemoryRegistry) Sensors() ([]sensor.TemperatureSensor, error) {
	return r.sensors, nil
}

func (r *InMemoryRegistry) ReadTemperature(ctx context.Context, deviceID string) (float64, error) {
	for _, s := range r.sensors {
		if s.ID() == deviceID {
			return s.ReadTemperature(ctx)
		}
	}
	return 0, fmt.Errorf("sensor not found: %s", deviceID)
}
