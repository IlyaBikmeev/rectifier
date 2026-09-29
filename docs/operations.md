# Эксплуатация и диагностика

## Сервис и логи

```bash
systemctl status rectifier --no-pager
journalctl -u rectifier -f
sudo systemctl restart rectifier
```

Неожиданные ошибки API записываются структурированными сообщениями уровня
`ERROR` с идентификатором связанного датчика, Run или партии, когда он известен.
Клиент при этом получает общее сообщение `internal server error`: подробности
ошибки SQLite доступны только в журнале сервиса. Ошибки отправки уже начатого
HTTP-ответа также остаются в журнале и не создают повторный ответ клиенту.
Успешное изменение настроек датчика, создание партии и создание, изменение или
удаление метки Run записываются на уровне `INFO`. Произвольные пользовательские
тексты — названия, комментарии и содержимое меток — в журнал не записываются.

Бинарник находится в `/usr/local/bin/rectifier`, unit — в
`/etc/systemd/system/rectifier.service`, данные — в
`/var/lib/rectifier/rectifier.db`. Рядом с БД во время работы могут быть WAL- и
SHM-файлы; это нормально.

## Резервная копия SQLite

Не копируйте только открытый `.db` во время записи. Для согласованного snapshot
остановите сервис:

```bash
sudo systemctl stop rectifier
sudo cp -a /var/lib/rectifier/rectifier.db /var/lib/rectifier/rectifier.db.backup
sudo systemctl start rectifier
```

Скопируйте backup на другой компьютер. Для восстановления:

```bash
sudo systemctl stop rectifier
sudo cp -a /var/lib/rectifier/rectifier.db /var/lib/rectifier/rectifier.db.before-restore
sudo install -o rectifier -g rectifier -m 0640 /путь/к/rectifier.db.backup /var/lib/rectifier/rectifier.db
sudo systemctl start rectifier
```

## Обновление и откат

Для обновления до последнего релиза повторно выполните:

```bash
curl -fsSL https://github.com/IlyaBikmeev/rectifier/releases/latest/download/install-release.sh | sh
```

Установщик обновит бинарник и systemd unit; база останется на месте. Перед
откатом обязательно сделайте backup SQLite по инструкции выше: миграции БД могут
быть несовместимы со старым бинарником. Затем укажите точный старый тег:

```bash
curl -fsSL https://github.com/IlyaBikmeev/rectifier/releases/latest/download/install-release.sh | sh -s -- v0.1.0
```

## Удаление

Приложение и данные удаляются отдельно:

```bash
sudo systemctl disable --now rectifier
sudo rm /etc/systemd/system/rectifier.service /usr/local/bin/rectifier
sudo systemctl daemon-reload
```

База при этом сохраняется. Только если вы осознанно хотите удалить всю историю:

```bash
sudo rm -r /var/lib/rectifier
sudo userdel rectifier
```

## Частые проблемы

- Нет каталога `/sys/bus/w1/devices`: включите 1-Wire, проверьте
  `/boot/firmware/config.txt` и перезагрузите Raspberry Pi.
- Нет каталогов `28-*`: отключите питание и проверьте GPIO4, общую землю,
  питание 3,3 В и подтяжку 4,7 кОм.
- В `w1_slave` нет `YES`, в UI ошибка чтения: это CRC error. Проверьте контакты,
  длину кабеля и питание; подробности смотрите через `journalctl`.
- `permission denied` для БД: выполните
  `sudo chown -R rectifier:rectifier /var/lib/rectifier` и перезапустите сервис.
- Порт 8080 занят: найдите процесс командой `sudo ss -ltnp 'sport = :8080'`.
  Порт Rectifier в текущей версии не настраивается.
- UI работает, но не показывает датчики: проверьте, что
  `ls /sys/bus/w1/devices/28-*/w1_slave` находит хотя бы один датчик. Если сам
  каталог `/sys/bus/w1/devices` недоступен, сервис завершится с ошибкой
  discovery. Runtime rescan пока не реализован — после подключения нового
  датчика перезапустите сервис.
