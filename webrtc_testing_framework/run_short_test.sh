#!/bin/bash

# Short test script for debugging
set -e

echo "========================================================="
echo "WebRTC Testing Framework - Short Debug Test"
echo "========================================================="

# Ensure containers are running
echo "Starting core services..."
docker-compose up -d

# Wait for services
echo "Waiting for services..."
sleep 10

# Check service health
echo "Checking service health..."
docker-compose ps

# Run a single test
echo "Running single debug test..."
docker run --rm \
  --network webrtc_testing_framework_webrtc_network \
  -v "$(pwd)/automation_scripts:/app" \
  -v "$(pwd):/shared" \
  -e BASE_URL=http://client:3000 \
  -w /app \
  node:18 \
  bash -c "
    npm install && 
    node -e '
    const { TestRunner } = require(\"./run_tests.js\");
    const runner = new TestRunner();
    
    // Override config for single test
    runner.TEST_CONFIG = {
      architectures: [\"P2P\"],
      numViewers: [1],
      packetLossRates: [0], 
      presenterBandwidths: [\"5mbit\"],
      testDurationMs: 10000, // 10 seconds only
      repetitions: 1,
      baseUrl: process.env.BASE_URL || \"http://client:3000\"
    };
    
    runner.initialize().then(() => {
      return runner.runAllTests();
    }).catch(console.error).finally(() => {
      return runner.cleanup();
    });
    '
  "

echo "Debug test complete"