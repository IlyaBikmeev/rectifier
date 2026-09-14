package app

import (
	"fmt"
	"math"
	"rectifier/internal/registry"

	"github.com/prometheus/client_golang/prometheus"
)

func registerSensorMetrics(appState *AppState, sensorRegistry registry.SensorRegistry) error {
	sensors, err := sensorRegistry.Sensors()
	if err != nil {
		return fmt.Errorf("get sensors: %w", err)
	}

	for _, temperatureSensor := range sensors {
		metric := prometheus.NewGaugeFunc(
			prometheus.GaugeOpts{
				Name: "rectifier_temperature_celsius",
				Help: "Current sensor temperature in Celsius",
				ConstLabels: prometheus.Labels{
					"sensor_id":   temperatureSensor.ID(),
					"sensor_name": temperatureSensor.Name(),
				},
			},
			func() float64 {
				if sensor, ok := appState.SensorSnapshot(temperatureSensor.ID()); ok {
					return sensor.temperature
				}

				return math.NaN()
			},
		)

		if err := prometheus.Register(metric); err != nil {
			return fmt.Errorf("register metric for sensor %s: %w", temperatureSensor.ID(), err)
		}
	}
	return nil
}
