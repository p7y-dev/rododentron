#!/bin/bash

export IMAGE_NAME=csakaszamok/rododentron:2

docker build -t "$IMAGE_NAME" .

docker push "$IMAGE_NAME"