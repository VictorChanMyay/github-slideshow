#!/bin/sh
cd "$(dirname "$0")" && node --no-warnings tools/backup.js "$@"
