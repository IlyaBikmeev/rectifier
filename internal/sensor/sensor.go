package sensor

import "context"

type TemperatureSensor interface {
	ReadTemperature(ctx context.Context) (float64, error)
}
