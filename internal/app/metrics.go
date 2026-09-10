package app

import (
	"context"
	"fmt"
	"math"
	"rectifier/internal/registry"

	"github.com/prometheus/client_golang/prometheus"
)

func registerSensorMetrics(sensorRegistry registry.SensorRegistry) error {
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
				temperature, err := temperatureSensor.ReadTemperature(context.Background())
				if err != nil {
					fmt.Printf("Read sensor %s for metrics: %v\n", temperatureSensor.ID(), err)
					return math.NaN()
				}
				return temperature
			},
		)

		if err := prometheus.Register(metric); err != nil {
			return fmt.Errorf("register metric for sensor %s: %w", temperatureSensor.ID(), err)
		}
	}
	return nil
}
