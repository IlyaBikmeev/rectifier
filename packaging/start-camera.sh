#!/bin/sh
set -eu

for command_name in v4l2-ctl ustreamer grep; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Camera startup failed: command not found: $command_name" >&2
    exit 1
  }
done

for device in /dev/v4l/by-id/*-video-index*; do
  [ -e "$device" ] || continue

  if v4l2-ctl --list-formats-ext -d "$device" 2>/dev/null | grep -q "'MJPG'"; then
    echo "Using camera: $device"
    exec ustreamer \
      --device="$device" \
      --format=MJPEG \
      --resolution=1280x720 \
      --desired-fps=15 \
      --host=0.0.0.0 \
      --port=8081
  fi
done

echo "Camera startup failed: no MJPEG camera found" >&2
exit 1
