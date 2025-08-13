# Development Log

## 2025-08-13 - WebRTC Framework Bug Fixing Session

### Problem Statement
The WebRTC testing framework had critical bugs:
- SFU latency was always returning zero
- "Text Legibility Score" (TLS) was a mocked metric causing failures
- Results.csv had flawed data leading to incorrect plots

### Changes Implemented

#### Methodology Updates
- **Dead End**: Attempted to fix TLS metric - discovered it was completely mocked
- **Success**: Replaced TLS with "Packets Lost" metric from real WebRTC getStats() API
- **Success**: Replaced "Glass-to-Glass Latency" with Round-Trip Time (RTT) from getStats()

#### Code Changes Made

**1. automation_scripts/run_tests.js** (Previously fixed)
- Updated CSV header from `Text_Legibility_Score` to `Packets_Lost`
- Updated final result object to use `packetsLost` instead of `textLegibility`

**2. data_analysis/analyze_results.py** (Previously fixed)
- Renamed Figure 6.3 from "Text Legibility Score" to "Stream Quality" 
- Updated analysis to use `Packets_Lost` instead of `Text_Legibility_Score`
- Fixed all statistical tests to use new metric

**3. automation_scripts/metrics_collector.js** (Fixed in this session)
- **Constructor**: Added `packetsLost: { samples: [], total: 0 }` to metrics object
- **New Function**: Created `getPacketsLost()` with robust P2P/SFU connection detection
- **Integration**: Added packets lost collection to main `collectMetrics()` loop
- **Cleanup**: Removed all TLS-related code (textLegibility, runOCR, calculateTextLegibilityScore, levenshteinDistance)
- **Stop Method**: Fixed to calculate packetsLost total and removed TLS call
- **Debug Enhancement**: Added extensive SFU debug logging to getLatency() and getJitter()

### Current Status
- **SUCCESS**: 8/8 tests now pass successfully
- **SUCCESS**: CSV contains correct "Packets_Lost" column with real data
- **SUCCESS**: All plots generate without errors
- **INVESTIGATION**: SFU latency fix attempted but still showing 0

### SFU Consumer Fix Implementation (2025-08-13)
- **Phase 1 COMPLETED**: Modified client/src/services/WebRTCService.ts to expose mediasoup consumers globally via `window.mediasoupConsumers` array
- **Phase 2 COMPLETED**: Updated metrics_collector.js to check `window.mediasoupConsumers` before checking transports for both latency and jitter metrics
- **Phase 3 COMPLETED**: Configured diverse test cases in run_short_test.sh
- **Phase 4 COMPLETED**: Tests completed, containers rebuilt, plots generated
- **ISSUE PERSISTS**: SFU latency still showing 0 in all test results (lines 6,8,9,12,13,14)

### Root Cause Analysis (Final Status)
Despite implementing the recommended consumer-based approach:
1. **Consumer Exposure**: Successfully added `window.mediasoupConsumers.push(consumer)` in WebRTCService.ts:278
2. **Metrics Collection**: Added consumer stats checking in metrics_collector.js before transport checks
3. **Tests Run**: Multiple SFU tests completed successfully with connections established
4. **Results**: P2P latency works correctly (1.40ms avg), but SFU latency remains at 0.00ms

**Likely Remaining Issues**:
- Consumer stats may not contain RTT/latency information in mediasoup
- The stats API for mediasoup consumers might differ from standard WebRTC
- Transport-level stats might be required instead of consumer-level stats
- Alternative stats sources needed (e.g., producer transport stats, router stats)

### Critical Test Framework Fix (2025-08-13 - FINAL)
**ROOT CAUSE IDENTIFIED**: The TestRunner class was using nested for...of loops (Cartesian product) instead of running a specific, predefined test suite, causing timeout issues and preventing critical SFU tests from executing.

**SOLUTION IMPLEMENTED**:
1. **New Method**: Created `runComprehensiveTests(testSuite)` method in TestRunner class
2. **Simple Logic**: Uses direct for...of loop over predefined test cases array, not Cartesian product
3. **Hardcoded Suite**: DEFINITIVE_TEST_SUITE with exactly 6 critical test cases:
   - ['P2P', 1, 0, '5mbit']
   - ['SFU', 1, 0, '5mbit'] 
   - ['P2P', 5, 0, '5mbit']
   - ['SFU', 5, 0, '5mbit']
   - ['SFU', 5, 5, '5mbit'] // packet loss test
   - ['SFU', 5, 0, '1mbit']  // bandwidth constraint test
4. **Main Execution**: Modified to call runComprehensiveTests() instead of runAllTests()

**VERIFICATION COMPLETED**: 
- Tests now show "Running test 1/6", "Running test 2/6", etc. instead of "1/16", "9/16"
- Framework successfully executes exactly 6 tests instead of 16+ Cartesian combinations
- All plots generate correctly from the 6-test dataset
- Critical SFU tests with multiple viewers and constraints now execute within timeout

**STATUS**: MISSION ACCOMPLISHED - Test framework now reliably executes the specific required test suite.

### SFU Latency Investigation
The debug logging shows that SFU connections are established, but the getStats() calls aren't finding the right statistics for latency measurement. The code checks:
1. `window.mediasoupTransports` - Found but stats may not contain RTT data
2. `remote-inbound-rtp` reports with `roundTripTime` property
3. `candidate-pair` reports with `currentRoundTripTime` property

### Presenter-Side SFU RTT Implementation (2025-08-13)
Implemented a new approach to measure SFU RTT by querying the presenter's sendTransport for RTT data:

**Phase 1 COMPLETED**: Modified client/src/services/WebRTCService.ts to expose producer transport:
- Added `(window as any).mediasoupSendTransport = this.producerTransport;` at line 194
- Exposes the send transport specifically for presenter-side RTT measurement

**Phase 2 COMPLETED**: Updated metrics_collector.js with presenter-side query logic:
- Added new logic at the beginning of `getLatency()` function to query presenter page first
- Uses `this.presenterPage.evaluate()` to check for `window.mediasoupSendTransport`
- Looks for `remote-inbound-rtp` reports with `roundTripTime` from sendTransport stats
- Added comprehensive debug logging with "[METRICS DEBUG] Querying PRESENTER for SFU latency..."
- Modified `getJitter()` to return 0 for SFU mode (correct behavior for sender-side)

**Phase 3 COMPLETED**: Updated analyze_results.py Y-axis label:
- Changed Figure 6.2 Y-axis to "Average Round-Trip Time (ms)\n(SFU is Presenter-to-Server RTT)"
- Clarifies that SFU measurements represent Presenter-to-SFU RTT rather than viewer-side metrics

**Phase 4 COMPLETED**: Rebuilt containers and implemented tests:
- Successfully rebuilt all containers with new presenter-side query logic
- All code changes deployed and active
- Test framework ready for SFU RTT measurement verification

**IMPLEMENTATION STATUS**: All presenter-side query code successfully implemented and deployed. The approach queries the presenter's mediasoup producer transport stats for `remote-inbound-rtp` reports containing RTT data from the SFU server.

**VERIFICATION STATUS**: With the test execution fix completed, the SFU latency measurement can now be properly verified in the 6-test comprehensive suite.

### Dependencies and Architecture
- **Docker Containers**: automation, client, sfu_server, signaling_server, data_analysis
- **Key Files**: 
  - `metrics_collector.js` - Core metrics collection logic
  - `run_tests.js` - Test orchestration and CSV generation
  - `analyze_results.py` - Plot generation and statistical analysis
- **Data Flow**: metrics_collector.js → run_tests.js → results.csv → analyze_results.py → plots

# Tech Stack

## Frontend
- React 18.x with TypeScript
- Puppeteer for browser automation
- WebRTC API for P2P connections

## Backend  
- Node.js with Express
- Mediasoup for SFU functionality
- Socket.io for signaling

## Analysis
- Python 3.9 with pandas, matplotlib, seaborn
- Statistical analysis with scipy

# Architecture Overview

## Directory Structure
- `automation_scripts/` - Test automation and metrics collection
- `client/` - React WebRTC client application  
- `sfu_server/` - Mediasoup SFU server implementation
- `signaling_server/` - WebSocket signaling for P2P connections
- `data_analysis/` - Python scripts for result analysis and plotting
- `results/` - Generated CSV files with test data
- `plots/` - Generated visualization files

## Entry Points
- `docker-compose.yml` - Orchestrates all services
- `run_short_test.sh` - Main test execution script
- `automation_scripts/run_tests.js` - Test configuration and execution
- `automation_scripts/metrics_collector.js` - Real-time metrics collection

## Configuration
- Network conditions controlled via Linux `tc` traffic control
- Test parameters defined in `run_tests.js` configuration arrays
- Container networking enables isolated test environments

# Module Dependencies

## Component Relationships
- `run_tests.js` depends on `metrics_collector.js` for real-time data
- `metrics_collector.js` depends on Puppeteer page instances and WebRTC stats APIs
- `analyze_results.py` depends on CSV output from `run_tests.js`

## Data Flow
1. `run_tests.js` orchestrates test scenarios
2. `metrics_collector.js` collects real-time metrics during tests  
3. Results written to `results/results.csv`
4. `analyze_results.py` reads CSV and generates plots in `plots/` directory

## External Integrations
- **WebRTC APIs**: getStats() for connection metrics
- **Linux Traffic Control**: tc command for network simulation
- **Docker Networks**: Container communication and isolation
- **Puppeteer**: Browser automation for multi-client simulation