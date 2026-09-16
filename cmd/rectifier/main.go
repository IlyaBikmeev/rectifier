package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"rectifier/internal/app"
	"rectifier/internal/registry"
	"rectifier/internal/sensor"
	"rectifier/internal/storage"
	"time"

	_ "modernc.org/sqlite"
)

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

	app.Run(sensorRegistry, sensorRepository)
}
