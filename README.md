# Rectifier

Сервис мониторинга и автоматизации ректификационной колонны.

## Запуск

С фейковыми датчиками (режим по умолчанию):

```bash
go run ./cmd/rectifier
```

С датчиками DS18B20:

```bash
go run ./cmd/rectifier -sensor-mode=ds18b20
```

Доступные параметры запуска:

```bash
go run ./cmd/rectifier -h
```
