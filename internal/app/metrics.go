package app

import (
	"fmt"
	"math"

	"github.com/prometheus/client_golang/prometheus"
)

type sensorCollector struct {
	appState    *AppState
	temperature *prometheus.Desc
}

var _ prometheus.Collector = (*sensorCollector)(nil)

func newSensorCollector(appState *AppState) *sensorCollector {
	return &sensorCollector{
		appState: appState,
		temperature: prometheus.NewDesc(
			"rectifier_temperature_celsius",
			"Current sensor temperature in Celsius",
			[]string{"sensor_id", "sensor_name"},
			nil,
		),
	}
}

func (collector *sensorCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- collector.temperature
}

func (collector *sensorCollector) Collect(ch chan<- prometheus.Metric) {
	sensors := collector.appState.SensorsSnapshot()

	for sensorID, sensor := range sensors {
		value := sensor.temperature

		if sensor.lastSuccessfulRead.IsZero() {
			value = math.NaN()
		}

		ch <- prometheus.MustNewConstMetric(
			collector.temperature,
			prometheus.GaugeValue,
			value,
			sensorID,
			sensor.name,
		)
	}
}

func registerSensorMetrics(appState *AppState) error {
	collector := newSensorCollector(appState)

	if err := prometheus.Register(collector); err != nil {
		return fmt.Errorf("register sensor collector: %w", err)
	}

	return nil
}
