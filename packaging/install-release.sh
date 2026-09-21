#!/bin/sh
set -eu

REPOSITORY="IlyaBikmeev/rectifier"

fail() {
  echo "Ошибка: $*" >&2
  exit 1
}

for command_name in curl tar sha256sum mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || fail "не найдена команда $command_name"
done

[ "$(uname -s)" = "Linux" ] || fail "поддерживается только Linux"

case "$(uname -m)" in
  aarch64|arm64) ;;
  *) fail "поддерживается только архитектура arm64 (aarch64)" ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || fail "для установки требуется sudo"
fi

if [ "$#" -gt 1 ]; then
  fail "использование: install-release.sh [vX.Y.Z|X.Y.Z]"
fi

if [ "$#" -eq 1 ]; then
  requested_version=$1
  case "$requested_version" in
    v[0-9]*.[0-9]*.[0-9]*|[0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "некорректная версия: $requested_version" ;;
  esac
  version=${requested_version#v}
  tag="v$version"
else
  latest_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' \
    "https://github.com/$REPOSITORY/releases/latest") || fail "не удалось определить последний релиз"
  tag=${latest_url##*/}
  case "$tag" in
    v[0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "GitHub вернул некорректный тег последнего релиза: $tag" ;;
  esac
  version=${tag#v}
fi

# Shell patterns above check the shape; this rejects extra characters accepted by '*'.
case "$version" in
  *[!0-9.]*|*.*.*.*|.*|*.) fail "некорректная версия: $version" ;;
esac
old_ifs=$IFS
IFS=.
set -- $version
IFS=$old_ifs
[ "$#" -eq 3 ] && [ -n "$1" ] && [ -n "$2" ] && [ -n "$3" ] || fail "некорректная версия: $version"

archive="rectifier_${version}_linux_arm64.tar.gz"
checksum="$archive.sha256"
download_url="https://github.com/$REPOSITORY/releases/download/$tag"
temp_dir=$(mktemp -d) || fail "не удалось создать временный каталог"
trap 'rm -rf "$temp_dir"' 0 HUP INT TERM

echo "Загрузка Rectifier $tag..."
curl -fL "$download_url/$archive" -o "$temp_dir/$archive" || fail "не удалось скачать $archive"
curl -fL "$download_url/$checksum" -o "$temp_dir/$checksum" || fail "не удалось скачать $checksum"

(
  cd "$temp_dir"
  sha256sum --check "$checksum"
) || fail "проверка SHA256 завершилась ошибкой"

mkdir "$temp_dir/release"
tar -xzf "$temp_dir/$archive" -C "$temp_dir/release" || fail "не удалось распаковать архив"
[ -f "$temp_dir/release/install.sh" ] || fail "в архиве нет install.sh"

echo "SHA256 проверен. Запуск системной установки..."
if [ "$(id -u)" -eq 0 ]; then
  sh "$temp_dir/release/install.sh"
else
  sudo sh "$temp_dir/release/install.sh"
fi
