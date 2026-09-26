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
SQLite → repository → AppState → HTTP API → ES modules/UI
```

- `cmd/rectifier` разбирает параметры, открывает SQLite, применяет миграции и
  собирает зависимости.
- `internal/sensor` изолирует fake- и DS18B20-реализации.
- `internal/registry` предоставляет общий доступ к обнаруженным датчикам.
- `internal/storage` содержит модели, SQLite repositories и встроенные SQL
  migrations.
- `internal/app` содержит потокобезопасный оперативный снимок, polling,
  HTTP API, метрики и встроенный UI.

Frontend не требует package manager или сборки. `index.html` подключает
локальные Bootstrap, Chart.js и единственную пользовательскую точку входа
`/static/js/app.js`. Пользовательский код разделён по ответственности:

| Файл | Ответственность |
|---|---|
| `app.js` | Инициализация приложения и связывание модулей |
| `api.js` | HTTP-запросы без DOM/UI-логики |
| `router.js` | Hash routing и переключение views |
| `sensors.js` | Polling, карточки и настройки датчиков |
| `runs.js` | Process state, Batch, Start/Stop и таймер Run |
| `run-events.js` | Modal, валидация и создание ручных меток Run |
| `chart.js` | Chart.js, measurements, метки и выбор времени на графике |
| `history.js` | История партий и Runs, пагинация и live-обновление |

Пользовательские стили находятся в `/static/css/app.css`. Все frontend-assets
встраиваются в Go-бинарник через `go:embed`, поэтому UI работает без интернета.

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
| GET | `/api/runs/{id}/events` | Ручные метки Run в хронологическом порядке |
| POST | `/api/runs/{id}/events` | Создание ручной метки Run |
| DELETE | `/api/events/{eventID}` | Удаление ручной метки Run |
| GET | `/metrics` | Prometheus-совместимые метрики |

`GET /api/batches` без query-параметров сохраняет полный список партий для
формы запуска. История использует:

```http
GET /api/batches?include=runs&limit=10&offset=0
```

Ответ в обоих случаях остаётся JSON-массивом; поля `total` нет. Параметр
`include=runs` добавляет Runs каждой партии, а `limit` и `offset` применяются к
партиям, поэтому одна партия не разделяется между страницами. Клиент определяет
наличие следующей страницы по размеру ответа: если элементов меньше `limit`,
история закончилась.

`POST /api/runs/{id}/events` принимает обязательный `text` длиной до 200
символов после trim и необязательный `occurred_at` в RFC3339. Без
`occurred_at` repository назначает текущее серверное время. Явное время должно
попадать между `started_at` и текущим временем активного Run либо между
`started_at` и `stopped_at` завершённого Run.

`DELETE /api/events/{eventID}` удаляет событие по его глобально уникальному
идентификатору. Успешный ответ имеет статус `204`, неизвестная метка возвращает
`404`.

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
node --check internal/app/static/js/*.js
go test ./...
git diff --check
```

Автоматических тестов пока нет: `go test ./...` проверяет компиляцию пакетов.
Для сквозного изменения вручную проверяйте SQLite, API, затронутые ES modules и
UI. Не добавляйте framework, package manager, build step или dependency, если
задачу решают Go standard library и существующий vanilla JavaScript. Сохраняйте
hardware-логику отдельно от жизненного цикла Run.

Если изменение затрагивает архитектуру, поведение, API, структуру каталогов,
запуск или процесс разработки, одновременно обновляйте связанные документы и
`AGENTS.md`.
