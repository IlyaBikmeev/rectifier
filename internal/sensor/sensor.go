package sensor

import "context"

type TemperatureSensor interface {
	ID() string
	Name() string
	ReadTemperature(ctx context.Context) (float64, error)
}
