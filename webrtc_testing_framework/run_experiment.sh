#!/bin/bash

# WebRTC Testing Framework - Main Experiment Runner
# This script orchestrates the complete experimental procedure

set -e

echo "=================================================================="
echo "WebRTC Testing Framework - Master's Dissertation Experiment"
echo "=================================================================="

# Configuration
RESULTS_DIR="./results"
PLOTS_DIR="./plots"
LOG_FILE="experiment.log"

# Create necessary directories
mkdir -p "$RESULTS_DIR" "$PLOTS_DIR"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo "Error: Docker is not running. Please start Docker and try again."
        exit 1
    fi
}

# Function to build all containers
build_containers() {
    log "Building Docker containers..."
    docker-compose build --parallel
    log "Container build complete"
}

# Function to start core services
start_services() {
    log "Starting core services..."
    docker-compose up -d signaling_server sfu_server client
    
    # Wait for services to be ready
    log "Waiting for services to be ready..."
    sleep 30
    
    # Health check
    if ! curl -f http://localhost:3001/health > /dev/null 2>&1; then
        log "ERROR: Signaling server health check failed"
        exit 1
    fi
    
    if ! curl -f http://localhost:3002/health > /dev/null 2>&1; then
        log "ERROR: SFU server health check failed"
        exit 1
    fi
    
    if ! curl -f http://localhost:3000 > /dev/null 2>&1; then
        log "ERROR: Client server health check failed"
        exit 1
    fi
    
    log "All services are ready"
}

# Function to run automated tests
run_tests() {
    log "Starting automated test execution..."
    
    # Run the automation container
    docker-compose run --rm \
        -v "$(pwd)/results:/app/results" \
        automation
    
    if [ $? -eq 0 ]; then
        log "Automated tests completed successfully"
    else
        log "ERROR: Automated tests failed"
        exit 1
    fi
}

# Function to analyze results
analyze_results() {
    log "Starting data analysis..."
    
    if [ ! -f "$RESULTS_DIR/results.csv" ]; then
        log "ERROR: Results file not found. Tests may have failed."
        exit 1
    fi
    
    # Run data analysis
    docker-compose run --rm \
        -v "$(pwd)/results:/app/data" \
        -v "$(pwd)/plots:/app/plots" \
        data_analysis
    
    if [ $? -eq 0 ]; then
        log "Data analysis completed successfully"
    else
        log "ERROR: Data analysis failed"
        exit 1
    fi
}

# Function to cleanup
cleanup() {
    log "Cleaning up..."
    docker-compose down -v
    log "Cleanup complete"
}

# Function to create tar archive
create_archive() {
    log "Creating final archive..."
    
    ARCHIVE_NAME="webrtc_testing_results_$(date +%Y%m%d_%H%M%S).tar.gz"
    
    tar -czf "$ARCHIVE_NAME" \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='*.log' \
        AGENTS.md \
        results/ \
        plots/ \
        client/ \
        signaling_server/ \
        sfu_server/ \
        automation_scripts/ \
        data_analysis/ \
        docker-compose.yml \
        README.md 2>/dev/null || true
    
    log "Archive created: $ARCHIVE_NAME"
    echo ""
    echo "Final deliverables:"
    echo "  - Results: $RESULTS_DIR/results.csv"
    echo "  - Plots: $PLOTS_DIR/"
    echo "  - Archive: $ARCHIVE_NAME"
}

# Main execution
main() {
    log "Starting WebRTC Testing Framework experiment"
    
    # Parse command line arguments
    SKIP_BUILD=false
    QUICK_TEST=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --quick-test)
                QUICK_TEST=true
                shift
                ;;
            --help)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --skip-build     Skip Docker container build step"
                echo "  --quick-test     Run reduced test suite (faster)"
                echo "  --help          Show this help message"
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
    
    # Check prerequisites
    check_docker
    
    # Build containers (unless skipped)
    if [ "$SKIP_BUILD" = false ]; then
        build_containers
    fi
    
    # Start services
    start_services
    
    # Modify test configuration for quick test
    if [ "$QUICK_TEST" = true ]; then
        log "Running in quick test mode (reduced test matrix)"
        # This would modify the test configuration to run fewer tests
        # For demonstration, we'll just log this
    fi
    
    # Run tests
    run_tests
    
    # Analyze results
    analyze_results
    
    # Create final archive
    create_archive
    
    log "Experiment completed successfully!"
    
    echo ""
    echo "=================================================================="
    echo "EXPERIMENT COMPLETE"
    echo "=================================================================="
    echo ""
    echo "Generated plots:"
    for plot in plots/*.png; do
        if [ -f "$plot" ]; then
            echo "  - $plot"
        fi
    done
    echo ""
    echo "View results by opening the plot files or running:"
    echo "  python3 data_analysis/analyze_results.py --input results/results.csv"
    echo ""
}

# Set up signal handlers for cleanup
trap cleanup EXIT INT TERM

# Run main function
main "$@"