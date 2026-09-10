package main

import (
	"rectifier/internal/app"
	"rectifier/internal/registry"
	"rectifier/internal/sensor"
)

func main() {
	sensorRegistry := registry.New(
		sensor.NewFake("28-fake-1", "Куб"),
		sensor.NewFake("28-fake-2", "Низ царги"),
		sensor.NewFake("28-fake-3", "Верх царги"),
	)

	app.Run(sensorRegistry)
}
