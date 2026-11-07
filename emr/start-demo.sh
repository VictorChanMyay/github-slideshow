#!/bin/sh
# Run on macOS or Linux:  sh start-demo.sh   (starts the EMR demo with fake data only)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Please install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
echo "Starting the demo. When you see 'EMR prototype is running', open http://localhost:3000 in your browser."
exec node server.js --demo
