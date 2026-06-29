#!/usr/bin/env bash

set -e

echo "Node: $(node -v)"
echo "npm: $(npm -v)"
echo "pnpm: $(pnpm -v)"
echo "git: $(git --version)"
echo "mysql: $(mysql --version)"

if command -v redis-server >/dev/null 2>&1; then
  echo "redis: $(redis-server --version)"
else
  echo "redis: not installed"
fi
