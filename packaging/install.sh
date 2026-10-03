#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите установщик с правами root: sudo ./install.sh" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BINARY="$SCRIPT_DIR/rectifier"
UNIT="$SCRIPT_DIR/rectifier.service"
CAMERA_UNIT="$SCRIPT_DIR/rectifier-camera.service"
CAMERA_LAUNCHER="$SCRIPT_DIR/start-camera.sh"

if [ ! -f "$BINARY" ] || [ ! -f "$UNIT" ] || [ ! -f "$CAMERA_UNIT" ] || [ ! -f "$CAMERA_LAUNCHER" ]; then
  echo "В каталоге установщика отсутствуют необходимые файлы Rectifier" >&2
  exit 1
fi

if ! id rectifier >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/rectifier --shell /usr/sbin/nologin rectifier
fi

install -d -o rectifier -g rectifier -m 0750 /var/lib/rectifier
install -o root -g root -m 0755 "$BINARY" /usr/local/bin/rectifier
install -o root -g root -m 0644 "$UNIT" /etc/systemd/system/rectifier.service
install -d -o root -g root -m 0755 /usr/local/lib/rectifier
install -o root -g root -m 0755 "$CAMERA_LAUNCHER" /usr/local/lib/rectifier/start-camera.sh
install -o root -g root -m 0644 "$CAMERA_UNIT" /etc/systemd/system/rectifier-camera.service

systemctl daemon-reload
systemctl enable rectifier.service
systemctl restart rectifier.service

echo "Rectifier установлен. Статус: systemctl status rectifier --no-pager"
