package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"net/url"
	"rectifier/internal/app"
	"rectifier/internal/registry"
	"rectifier/internal/sensor"
	"rectifier/internal/storage"
	"time"

	_ "modernc.org/sqlite"
)

var version = "dev"

func main() {
	sensorMode := flag.String(
		"sensor-mode",
		"fake",
		"sensor mode: fake or ds18b20",
	)

	dbPath := flag.String(
		"db-path",
		"./rectifier.db",
		"DB path",
	)

	cameraURL := flag.String(
		"camera-url",
		"",
		"MJPEG camera stream URL (HTTP or HTTPS)",
	)

	flag.Parse()

	if err := validateCameraURL(*cameraURL); err != nil {
		log.Fatalf("invalid camera URL: %v", err)
	}

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

	startupCtx, cancelStartup := context.WithTimeout(
		context.Background(), 10*time.Second,
	)
	defer cancelStartup()

	dsn := fmt.Sprintf(
		"file:%s?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000",
		*dbPath,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		log.Fatalf("open SQLite database %q: %v", *dbPath, err)
	}
	defer db.Close()

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.PingContext(startupCtx); err != nil {
		log.Fatalf("connect to SQLite database %q: %v", *dbPath, err)
	}

	if err := storage.Migrate(startupCtx, db); err != nil {
		log.Fatalf("migrate database: %v", err)
	}

	sensorRepository := storage.NewSQLiteSensorRepository(db)
	batchRepository := storage.NewSQLiteBatchRepository(db)
	runRepository := storage.NewSQLiteRunRepository(db)
	measurementRepository := storage.NewSQLiteMeasurementRepository(db)
	runEventRepository := storage.NewRunEventRepository(db)

	app.Run(version, *cameraURL, sensorRegistry, sensorRepository, batchRepository, runRepository, measurementRepository, runEventRepository)
}

func validateCameraURL(rawURL string) error {
	if rawURL == "" {
		return nil
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("parse URL: %w", err)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("scheme must be http or https")
	}
	if parsedURL.Host == "" {
		return fmt.Errorf("host must not be empty")
	}

	return nil
}
