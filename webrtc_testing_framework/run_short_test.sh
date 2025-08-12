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

# Run tests using the docker-compose automation service with custom config
echo "Running diverse test suite (8 test cases)..."
docker-compose run --rm automation node -e '
// Create a custom test config for diverse testing
const customConfig = {
  architectures: ["P2P", "SFU"],
  numViewers: [1, 5],
  packetLossRates: [0, 5], 
  presenterBandwidths: ["5mbit"],
  testDurationMs: 15000, // 15 seconds
  repetitions: 1,
  baseUrl: process.env.BASE_URL || "http://client:3000"
};

// Modify the TEST_CONFIG at the module level before requiring
const fs = require("fs");
let content = fs.readFileSync("./run_tests.js", "utf8");
content = content.replace(
  /const TEST_CONFIG = \{[^}]+\};/s,
  `const TEST_CONFIG = ${JSON.stringify(customConfig)};`
);
fs.writeFileSync("./run_tests_custom.js", content);

const { TestRunner } = require("./run_tests_custom.js");
const runner = new TestRunner();

runner.initialize().then(() => {
  return runner.runAllTests();
}).catch(console.error).finally(() => {
  return runner.cleanup();
});
'

echo "Debug test complete"

# Run data analysis to generate plots
echo "Running data analysis..."
docker-compose run --rm \
  -v "$(pwd)/results:/app/data" \
  -v "$(pwd)/plots:/app/plots" \
  data_analysis

echo "Data analysis complete"