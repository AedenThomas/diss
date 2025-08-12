# WebRTC Testing Framework

A comprehensive framework for empirically comparing P2P Mesh and SFU architectures for WebRTC-based screen sharing applications.

## Overview

This framework automates the entire testing process to measure key performance indicators including:

- **Presenter CPU and Bandwidth Utilization**
- **Glass-to-Glass (G2G) Latency** 
- **Text Legibility Score (TLS)**

The framework tests various network conditions and viewer counts to provide a complete performance comparison.

## Architecture

```
webrtc_testing_framework/
├── client/                 # React TypeScript application
├── signaling_server/       # Node.js signaling server with Socket.IO
├── sfu_server/            # mediasoup-based SFU implementation
├── automation_scripts/    # Puppeteer-based testing automation
├── data_analysis/         # Python scripts for analysis and visualization
├── results/               # Generated test results (CSV)
├── plots/                 # Generated visualization plots (PNG)
├── docker-compose.yml     # Container orchestration
├── run_experiment.sh      # Main experiment runner
└── AGENTS.md             # Development log and knowledge base
```

## Quick Start

### Prerequisites

- **Docker & Docker Compose** (v20.10+)
- **Linux environment** with root access (for network emulation)
- **At least 8GB RAM** and **4 CPU cores** recommended

### Running the Complete Experiment

```bash
# Clone/navigate to the framework directory
cd webrtc_testing_framework/

# Run the complete experiment
./run_experiment.sh

# For a quicker test (reduced test matrix)
./run_experiment.sh --quick-test

# Skip Docker build step if containers already exist
./run_experiment.sh --skip-build
```

### Manual Execution

If you prefer to run components manually:

```bash
# 1. Build containers
docker-compose build

# 2. Start core services
docker-compose up -d signaling_server sfu_server client

# 3. Run automated tests
docker-compose run --rm -v $(pwd)/results:/app/results automation

# 4. Analyze results
docker-compose run --rm \
    -v $(pwd)/results:/app/data \
    -v $(pwd)/plots:/app/plots \
    data_analysis

# 5. Cleanup
docker-compose down
```

## Test Configuration

The framework tests all combinations of:

- **Architectures**: P2P Mesh, SFU
- **Number of Viewers**: 1, 2, 5, 10
- **Packet Loss Rates**: 0%, 1%, 2%, 5%
- **Presenter Bandwidth**: 5Mbps, 2Mbps, 1Mbps
- **Repetitions**: 5 per configuration (for statistical reliability)

**Total Tests**: 2 × 4 × 4 × 3 × 5 = **480 test runs**

Each test runs for 60 seconds with metrics collected every second.

## Generated Outputs

### 1. Raw Data
- `results/results.csv` - Complete test results with all metrics

### 2. Visualizations
- `plots/presenter_cpu_vs_viewers.png` - **Figure 6.1**
- `plots/latency_vs_packet_loss.png` - **Figure 6.2** 
- `plots/tls_vs_bandwidth.png` - **Figure 6.3**
- `plots/summary_statistics.csv` - Statistical summaries

### 3. Archive
- `webrtc_testing_results_YYYYMMDD_HHMMSS.tar.gz` - Complete deliverable

## Key Features

### Automated Network Emulation
- Uses Linux Traffic Control (`tc`) with `netem` for realistic network conditions
- Programmable bandwidth limiting and packet loss simulation

### Advanced Metrics Collection
- **CPU Utilization**: Real-time monitoring of presenter browser processes
- **G2G Latency**: Timestamp embedding in video streams for precise measurement
- **Text Legibility**: OCR-based analysis of received video quality

### Container Orchestration
- Fully containerized for reproducibility
- Automated health checks and service coordination
- Isolated network environments

### Comprehensive Analysis
- Statistical analysis with confidence intervals
- Professional publication-quality plots
- Automated summary statistics

## Expected Results

Based on theoretical analysis, the framework should demonstrate:

### Figure 6.1: CPU vs Viewers
- **P2P**: Linear increase in CPU usage with viewer count
- **SFU**: Flat, low CPU usage regardless of viewer count

### Figure 6.2: Latency vs Packet Loss  
- **P2P**: Lower initial latency but degrades sharply with packet loss
- **SFU**: Slightly higher initial latency but more resilient to packet loss

### Figure 6.3: Text Legibility vs Bandwidth
- **Both architectures**: Good performance at high bandwidth
- **P2P**: More rapid quality degradation at low bandwidth
- **SFU**: Better quality preservation under bandwidth constraints

## Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 3000, 3001, 3002 are available
2. **Docker permissions**: Run with appropriate Docker permissions
3. **Network emulation fails**: Requires privileged container access
4. **Chrome crashes**: Increase Docker memory limits if needed

### Debug Mode

```bash
# View service logs
docker-compose logs signaling_server
docker-compose logs sfu_server
docker-compose logs client

# Run analysis in verbose mode
docker-compose run --rm data_analysis python analyze_results.py --verbose

# Health check services
curl http://localhost:3001/health  # Signaling server
curl http://localhost:3002/health  # SFU server
curl http://localhost:3000         # Client
```

### Manual Testing

For development and debugging, you can test individual components:

```bash
# Start services
docker-compose up -d signaling_server sfu_server client

# Open browser to test manually
# Presenter: http://localhost:3000?mode=P2P&role=presenter&roomId=test123
# Viewer: http://localhost:3000?mode=P2P&role=viewer&roomId=test123
```

## Development

### Architecture Components

1. **Client**: React app with dual P2P/SFU WebRTC implementation
2. **Signaling Server**: Socket.IO-based signaling for both architectures  
3. **SFU Server**: mediasoup-based selective forwarding unit
4. **Automation**: Puppeteer-driven browser automation for testing
5. **Analysis**: Python-based statistical analysis and visualization

### Key Technologies
- **Frontend**: React, TypeScript, WebRTC APIs, mediasoup-client
- **Backend**: Node.js, Express, Socket.IO, mediasoup
- **Testing**: Puppeteer, Docker
- **Analysis**: Python, pandas, matplotlib, seaborn
- **Infrastructure**: Docker, Docker Compose, Linux TC

## Contributing

This framework was developed as part of a Master's dissertation project. The modular design allows for:

- Additional WebRTC architectures (e.g., MCU)
- Extended metrics collection
- Different network conditions
- Alternative analysis approaches

See `AGENTS.md` for detailed development history and implementation notes.

## License

Academic research use only. Part of Master's dissertation work.

## Citation

```bibtex
@misc{webrtc-testing-framework,
  title={Empirical Comparison of P2P Mesh and SFU Architectures for WebRTC Screen Sharing},
  author={WebRTC Testing Framework},
  year={2025},
  note={Master's Dissertation Testing Framework}
}
```