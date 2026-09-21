# Установка на Raspberry Pi 5

Проверенная конфигурация: Raspberry Pi 5,
[Raspberry Pi OS Lite 64-bit Trixie](https://www.raspberrypi.com/software/operating-systems/)
и датчики DS18B20 на стандартной 1-Wire шине GPIO4. Go на Raspberry Pi не нужен.

> Rectifier не управляет ТЭНом, клапанами или физическим процессом. Он только
> показывает температуры и ведёт журнал измерений.

## 1. Подготовьте Raspberry Pi OS

В Raspberry Pi Imager выберите **Raspberry Pi OS Lite (64-bit)**, задайте имя
устройства, Wi-Fi и SSH, затем запишите карту памяти и загрузите Raspberry Pi.
Подключитесь к ней:

```bash
ssh <пользователь>@<имя-raspberry>.local
```

Обновите систему:

```bash
sudo apt update
sudo apt full-upgrade -y
```

## 2. Подключите DS18B20

Перед подключением полностью отключите питание Raspberry Pi. Для трёхпроводного
DS18B20 используйте:

```text
Raspberry Pi 5                 DS18B20
3.3 V  (physical pin 1) ------ VDD
GND    (physical pin 6) ------ GND
GPIO4  (physical pin 7) ------ DATA
        4.7 kΩ между 3.3 V и DATA
```

Все датчики подключаются параллельно; для общей шины достаточно одного
резистора 4,7 кОм. Не подавайте 5 В на GPIO.

Включите 1-Wire:

```bash
sudo raspi-config
```

Выберите `Interface Options` → `1-Wire` → `Enable`, затем перезагрузитесь:

```bash
sudo reboot
```

После повторного входа проверьте датчики:

```bash
ls /sys/bus/w1/devices/28-*/w1_slave
cat /sys/bus/w1/devices/28-*/w1_slave
```

Если пункта 1-Wire нет, добавьте `dtoverlay=w1-gpio,gpiopin=4` в
`/boot/firmware/config.txt` и перезагрузитесь.
[Официальная документация Raspberry Pi](https://www.raspberrypi.com/documentation/computers/configuration.html)
описывает текущее расположение boot-конфигурации.

## 3. Установите Rectifier

Основной способ устанавливает последний релиз одной командой:

```bash
curl -fsSL https://github.com/IlyaBikmeev/rectifier/releases/latest/download/install-release.sh | sh
```

Bootstrap-скрипт проверит Linux и ARM64, определит последний тег, скачает архив
и SHA256 во временный каталог и проверит целостность. Только после успешной
проверки он запустит вложенный `install.sh` через `sudo`. Go и `jq` не нужны.

Для воспроизводимой установки можно явно указать версию с `v` или без него:

```bash
curl -fsSL https://github.com/IlyaBikmeev/rectifier/releases/latest/download/install-release.sh | sh -s -- v0.1.0
```

Команда `curl | sh` доверяет скрипту, опубликованному в GitHub Release проекта.
Если хотите изучить его до запуска, сначала скачайте, прочитайте и выполните:

```bash
curl -fLO https://github.com/IlyaBikmeev/rectifier/releases/latest/download/install-release.sh
less install-release.sh
sh install-release.sh
```

### Ручная установка

Откройте страницу Releases проекта, скопируйте ссылки на архив ARM64 и файл
`.sha256`, затем выполните (подставьте версию вместо `VERSION`):

```bash
VERSION=0.1.0
wget "https://github.com/IlyaBikmeev/rectifier/releases/download/v${VERSION}/rectifier_${VERSION}_linux_arm64.tar.gz"
wget "https://github.com/IlyaBikmeev/rectifier/releases/download/v${VERSION}/rectifier_${VERSION}_linux_arm64.tar.gz.sha256"
sha256sum --check "rectifier_${VERSION}_linux_arm64.tar.gz.sha256"
tar -xzf "rectifier_${VERSION}_linux_arm64.tar.gz"
sudo ./install.sh
```

Установщик можно запускать повторно: он обновляет бинарник и unit, но не удаляет
и не перезаписывает `/var/lib/rectifier/rectifier.db`.

## 4. Проверьте работу

```bash
systemctl status rectifier --no-pager
journalctl -u rectifier -n 50 --no-pager
```

С другого устройства в той же локальной сети откройте:

```text
http://<имя-raspberry>.local:8080
```

Метрики доступны по адресу `http://<имя-raspberry>.local:8080/metrics`.

Проверьте автозапуск:

```bash
sudo reboot
```

После загрузки снова откройте UI и выполните `systemctl status rectifier`.
Сервис автономен: UI, запись и SQLite работают без интернета.

> В сервисе пока нет авторизации и TLS. Не перенаправляйте порт 8080 из
> интернета и не выставляйте его напрямую в публичную сеть.
