-- Партия сырья
CREATE TABLE batches (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    comment TEXT
);

-- Конкретный перегон внутри партии
CREATE TABLE runs(
    id INTEGER PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    type TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL,
    stopped_at TIMESTAMP,
    status TEXT NOT NULL
);

-- Известные физические датчики
CREATE TABLE sensors(
    id INTEGER PRIMARY KEY,
    hardware_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    measurement_type TEXT NOT NULL,
    unit TEXT NOT NULL,
    enabled BOOLEAN NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

-- снимок состава и названий датчиков для конкретного перегона
CREATE TABLE run_sensors(
    run_id INTEGER NOT NULL REFERENCES runs(id),
    sensor_id INTEGER NOT NULL REFERENCES sensors(id),
    sensor_name TEXT NOT NULL,
    PRIMARY KEY (run_id, sensor_id)
);

-- Измерения с датчиков во время перегона
CREATE TABLE measurements(
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id),
    sensor_id INTEGER NOT NULL REFERENCES sensors(id),
    measured_at TIMESTAMP NOT NULL,
    value REAL NOT NULL
);

CREATE INDEX idx_measurements_run_sensor_time
    ON measurements(run_id, sensor_id, measured_at);