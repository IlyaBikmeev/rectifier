package sensor

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type DS18B20 struct {
	id          string
	w1SlavePath string
}

func NewDS18B20(id string, w1SlavePath string) *DS18B20 {
	return &DS18B20{
		id:          id,
		w1SlavePath: w1SlavePath,
	}
}

func (ds *DS18B20) ID() string {
	return ds.id
}

// TODO возвращать реальное имя
func (ds *DS18B20) Name() string {
	return "DS18B20"
}

func (ds *DS18B20) ReadTemperature(ctx context.Context) (float64, error) {
	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	default:
	}

	data, err := os.ReadFile(ds.w1SlavePath)
	if err != nil {
		return 0, fmt.Errorf("read sensor %s: %w", ds.id, err)
	}

	content := string(data)

	if !strings.Contains(content, "YES") {
		return 0, fmt.Errorf("sensor %s: CRC check failed", ds.id)
	}

	position := strings.LastIndex(content, "t=")

	if position == -1 {
		return 0, fmt.Errorf("sensor %s: temperature data not found", ds.id)
	}

	rawTemperature := strings.TrimSpace(
		content[position+2:],
	)

	milliDegrees, err := strconv.ParseInt(
		rawTemperature,
		10,
		64,
	)

	if err != nil {
		return 0, fmt.Errorf(
			"parse sensor %s temperature: %w",
			ds.id,
			err,
		)
	}
	return float64(milliDegrees) / 1000, nil
}

func DiscoverDS18B20Sensors(devicesPath string) ([]TemperatureSensor, error) {
	files, err := os.ReadDir(devicesPath)
	if err != nil {
		return nil, fmt.Errorf("read devices directory: %w", err)
	}

	sensors := make([]TemperatureSensor, 0, len(files))

	for _, file := range files {
		if strings.HasPrefix(file.Name(), "28-") {
			path := filepath.Join(devicesPath, file.Name(), "w1_slave")

			sensors = append(sensors, NewDS18B20(
				file.Name(),
				path,
			))
		}
	}
	return sensors, nil
}
