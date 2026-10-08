#!/bin/bash
set -e

cd "$(dirname "$0")"

VERSION=$(tr -d '[:space:]' < VERSION)
if [ -z "$VERSION" ]; then
  echo "VERSION fájl üres" >&2
  exit 1
fi

export IMAGE_NAME=csakaszamok/rododentron:$VERSION

docker build -t "$IMAGE_NAME" .

docker push "$IMAGE_NAME"
