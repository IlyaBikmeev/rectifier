#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите установщик с правами root: sudo ./install.sh" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BINARY="$SCRIPT_DIR/rectifier"
UNIT="$SCRIPT_DIR/rectifier.service"

if [ ! -f "$BINARY" ] || [ ! -f "$UNIT" ]; then
  echo "В каталоге установщика нет rectifier или rectifier.service" >&2
  exit 1
fi

if ! id rectifier >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/rectifier --shell /usr/sbin/nologin rectifier
fi

install -d -o rectifier -g rectifier -m 0750 /var/lib/rectifier
install -o root -g root -m 0755 "$BINARY" /usr/local/bin/rectifier
install -o root -g root -m 0644 "$UNIT" /etc/systemd/system/rectifier.service

systemctl daemon-reload
systemctl enable rectifier.service
systemctl restart rectifier.service

echo "Rectifier установлен. Статус: systemctl status rectifier --no-pager"
