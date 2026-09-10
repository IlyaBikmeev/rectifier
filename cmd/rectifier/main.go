package main

import (
	"flag"
	"log"
	"rectifier/internal/app"
	"rectifier/internal/registry"
	"rectifier/internal/sensor"
)

func main() {
	sensorMode := flag.String(
		"sensor-mode",
		"fake",
		"sensor mode: fake or ds18b20",
	)

	flag.Parse()

	var sensors []sensor.TemperatureSensor

	switch *sensorMode {
	case "fake":
		sensors = []sensor.TemperatureSensor{
			sensor.NewFake("28-fake-1", "Куб"),
			sensor.NewFake("28-fake-2", "Низ царги"),
			sensor.NewFake("28-fake-3", "Верх царги"),
		}

	case "ds18b20":
		var err error
		sensors, err = sensor.DiscoverDS18B20Sensors("/sys/bus/w1/devices")
		if err != nil {
			log.Fatalf("discover DS18B20 sensors: %v", err)
		}

	default:
		log.Fatalf("unknown sensor mode: %s", *sensorMode)
	}

	sensorRegistry := registry.New(sensors...)

	app.Run(sensorRegistry)
}
