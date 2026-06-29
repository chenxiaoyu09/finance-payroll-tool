#!/usr/bin/env bash

set -e

if ! command -v redis-server >/dev/null 2>&1; then
  echo "redis-server not found. Please install Redis first."
  exit 1
fi

redis-server --port 6379
