package sensor

import (
	"context"
	"math/rand/v2"
)

type Fake struct {
}

func (f *Fake) ReadTemperature(ctx context.Context) (float64, error) {
	return rand.Float64() * 70, nil
}
