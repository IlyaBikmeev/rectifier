package sensor

import (
	"context"
	"math/rand/v2"
)

type Fake struct {
	id   string
	name string
}

func NewFake(id string, name string) *Fake {
	return &Fake{id: id, name: name}
}

func (f *Fake) ID() string {
	return f.id
}

func (f *Fake) Name() string {
	return f.name
}

func (f *Fake) ReadTemperature(ctx context.Context) (float64, error) {
	return rand.Float64() * 70, nil
}
