# Разработка

## Подготовка и запуск

Нужен Go 1.26.4 (версия зафиксирована в `go.mod`).

```bash
git clone https://github.com/IlyaBikmeev/rectifier.git
cd rectifier
go mod download
go run ./cmd/rectifier
```

Fake-режим включён по умолчанию и создаёт три датчика. UI доступен на
`http://localhost:8080`, метрики — на `http://localhost:8080/metrics`. Для
реальных датчиков используйте `-sensor-mode=ds18b20`. Путь к БД задаётся через
`-db-path` и по умолчанию равен `./rectifier.db`.

## Архитектура

Основной поток изменения данных:

```text
SQLite → repository → AppState → HTTP API → inline JavaScript/UI
```

- `cmd/rectifier` разбирает параметры, открывает SQLite, применяет миграции и
  собирает зависимости.
- `internal/sensor` изолирует fake- и DS18B20-реализации.
- `internal/registry` предоставляет общий доступ к обнаруженным датчикам.
- `internal/storage` содержит модели, SQLite repositories и встроенные SQL
  migrations.
- `internal/app` содержит потокобезопасный оперативный снимок, polling,
  HTTP API, метрики и встроенный UI.

SQLite — источник истины для длительного состояния. `AppState` — оперативный
потокобезопасный снимок. Команда сначала должна успешно сохраниться в SQLite и
только затем менять `AppState`.

## HTTP API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/status` | Текущие показания датчиков |
| GET | `/api/process` | Состояние записи и активный Run |
| PUT | `/api/sensors/{hardwareID}` | Метаданные датчика |
| GET, POST | `/api/batches` | Список и создание партий |
| POST | `/api/runs` | Запуск записи |
| POST | `/api/runs/{id}/stop` | Остановка записи |
| GET | `/api/runs/{id}/measurements` | Измерения и границы графика |
| GET | `/metrics` | Prometheus-совместимые метрики |

## Миграции и проверки

SQL-файлы в `internal/storage/migrations` имеют числовой префикс и встраиваются
в бинарник. Новая миграция должна иметь следующий номер. Версия хранится в
`PRAGMA user_version`; миграции выполняются последовательно и транзакционно.

Перед изменением:

```bash
go test ./...
```

Перед отправкой изменения:

```bash
gofmt -w <изменённые-go-файлы>
go test ./...
git diff --check
```

Автоматических тестов пока нет: `go test ./...` проверяет компиляцию пакетов.
Для сквозного изменения вручную проверяйте SQLite, API, inline JavaScript и UI.
Не добавляйте framework или dependency, если задачу решает стандартная
библиотека. Сохраняйте hardware-логику отдельно от жизненного цикла Run.
