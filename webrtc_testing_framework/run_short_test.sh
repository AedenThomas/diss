#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "========================================================="
echo "WebRTC Testing Framework - Definitive Test Run"
echo "========================================================="

# Ensure we are in the script's directory
cd "$(dirname "$0")"

echo "Starting core services..."
docker-compose up -d --remove-orphans

# Wait a few seconds for services to initialize
sleep 10

echo "Running the definitive test suite..."
docker-compose run --rm automation

echo "Generating final plots and analysis..."
docker-compose run --rm \
  -v "$(pwd)/results:/app/data" \
  -v "$(pwd)/plots:/app/plots" \
  data_analysis

echo "Test run and analysis complete. Check the /plots directory."