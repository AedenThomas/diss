const puppeteer = require('puppeteer');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs-extra');
const { spawn } = require('child_process');
const path = require('path');
const NetworkController = require('./network_control');
const MetricsCollector = require('./metrics_collector');

// Test configuration
const TEST_CONFIG = {
  architectures: ['P2P', 'SFU'],
  numViewers: [1, 2, 5, 10],
  packetLossRates: [0, 1, 2, 5], // in %
  presenterBandwidths: ['5mbit', '2mbit', '1mbit'],
  testDurationMs: 60000, // 60 seconds
  repetitions: 5,
  
  // URLs
  baseUrl: 'http://localhost:3000',
  
  // Docker containers
  containers: {
    client: 'webrtc_client',
    signaling: 'webrtc_signaling',
    sfu: 'webrtc_sfu'
  }
};

class TestRunner {
  constructor() {
    this.results = [];
    this.browser = null;
    this.networkController = new NetworkController();
    this.csvWriter = createCsvWriter({
      path: 'results.csv',
      header: [
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'architecture', title: 'Architecture' },
        { id: 'numViewers', title: 'Num_Viewers' },
        { id: 'packetLossRate', title: 'Packet_Loss_Rate' },
        { id: 'presenterBandwidth', title: 'Presenter_Bandwidth' },
        { id: 'repetition', title: 'Repetition' },
        { id: 'presenterCpuAvg', title: 'Presenter_CPU_Avg' },
        { id: 'presenterCpuMax', title: 'Presenter_CPU_Max' },
        { id: 'presenterBandwidthUsage', title: 'Presenter_Bandwidth_Usage' },
        { id: 'avgLatency', title: 'Avg_Latency_Ms' },
        { id: 'minLatency', title: 'Min_Latency_Ms' },
        { id: 'maxLatency', title: 'Max_Latency_Ms' },
        { id: 'textLegibilityScore', title: 'Text_Legibility_Score' },
        { id: 'testDuration', title: 'Test_Duration_Ms' },
        { id: 'success', title: 'Success' },
        { id: 'errorMsg', title: 'Error_Message' }
      ]
    });
  }

  async initialize() {
    console.log('Initializing test runner...');
    
    // Launch headless browser
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });

    console.log('Test runner initialized');
  }

  async runAllTests() {
    console.log('Starting comprehensive WebRTC performance tests...');
    
    let testCount = 0;
    const totalTests = TEST_CONFIG.architectures.length * 
                      TEST_CONFIG.numViewers.length * 
                      TEST_CONFIG.packetLossRates.length * 
                      TEST_CONFIG.presenterBandwidths.length * 
                      TEST_CONFIG.repetitions;

    for (const architecture of TEST_CONFIG.architectures) {
      for (const numViewers of TEST_CONFIG.numViewers) {
        for (const packetLossRate of TEST_CONFIG.packetLossRates) {
          for (const presenterBandwidth of TEST_CONFIG.presenterBandwidths) {
            for (let rep = 1; rep <= TEST_CONFIG.repetitions; rep++) {
              testCount++;
              console.log(`\\nRunning test ${testCount}/${totalTests}`);
              console.log(`Configuration: ${architecture}, ${numViewers} viewers, ${packetLossRate}% loss, ${presenterBandwidth} bandwidth, rep ${rep}`);
              
              try {
                const result = await this.runSingleTest({
                  architecture,
                  numViewers,
                  packetLossRate,
                  presenterBandwidth,
                  repetition: rep
                });
                
                this.results.push(result);
                await this.csvWriter.writeRecords([result]);
                
                console.log(`Test ${testCount} completed successfully`);
              } catch (error) {
                console.error(`Test ${testCount} failed:`, error.message);
                
                const errorResult = {
                  timestamp: new Date().toISOString(),
                  architecture,
                  numViewers,
                  packetLossRate,
                  presenterBandwidth,
                  repetition: rep,
                  success: false,
                  errorMsg: error.message,
                  presenterCpuAvg: 0,
                  presenterCpuMax: 0,
                  presenterBandwidthUsage: 0,
                  avgLatency: 0,
                  minLatency: 0,
                  maxLatency: 0,
                  textLegibilityScore: 100,
                  testDuration: 0
                };
                
                this.results.push(errorResult);
                await this.csvWriter.writeRecords([errorResult]);
              }
              
              // Wait between tests
              await this.sleep(5000);
            }
          }
        }
      }
    }

    console.log(`\\nAll tests completed! Results saved to results.csv`);
    console.log(`Total successful tests: ${this.results.filter(r => r.success).length}`);
    console.log(`Total failed tests: ${this.results.filter(r => !r.success).length}`);
  }

  async runSingleTest(config) {
    console.log(`Setting up test environment...`);
    
    // Apply network conditions
    await this.networkController.applyConditions(
      config.presenterBandwidth, 
      config.packetLossRate
    );
    
    // Generate test room ID
    const roomId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create presenter page
    console.log('Starting presenter...');
    const presenterPage = await this.browser.newPage();
    await this.setupPresenterPage(presenterPage, config.architecture, roomId);
    
    // Create viewer pages
    console.log(`Starting ${config.numViewers} viewers...`);
    const viewerPages = [];
    for (let i = 0; i < config.numViewers; i++) {
      const viewerPage = await this.browser.newPage();
      await this.setupViewerPage(viewerPage, config.architecture, roomId, i);
      viewerPages.push(viewerPage);
    }
    
    // Wait for connections to establish
    console.log('Waiting for connections to establish...');
    await this.sleep(10000);
    
    // Start metrics collection
    console.log('Starting metrics collection...');
    const metricsCollector = new MetricsCollector(presenterPage, viewerPages);
    await metricsCollector.start();
    
    // Run test for specified duration
    console.log(`Running test for ${TEST_CONFIG.testDurationMs}ms...`);
    await this.sleep(TEST_CONFIG.testDurationMs);
    
    // Stop metrics collection
    const metrics = await metricsCollector.stop();
    
    // Clean up pages
    await presenterPage.close();
    for (const viewerPage of viewerPages) {
      await viewerPage.close();
    }
    
    // Reset network conditions
    await this.networkController.reset();
    
    return {
      timestamp: new Date().toISOString(),
      architecture: config.architecture,
      numViewers: config.numViewers,
      packetLossRate: config.packetLossRate,
      presenterBandwidth: config.presenterBandwidth,
      repetition: config.repetition,
      success: true,
      errorMsg: '',
      presenterCpuAvg: metrics.cpu.average,
      presenterCpuMax: metrics.cpu.max,
      presenterBandwidthUsage: metrics.bandwidth.average,
      avgLatency: metrics.latency.average,
      minLatency: metrics.latency.min,
      maxLatency: metrics.latency.max,
      textLegibilityScore: metrics.textLegibility,
      testDuration: TEST_CONFIG.testDurationMs
    };
  }

  async setupPresenterPage(page, architecture, roomId) {
    const url = `${TEST_CONFIG.baseUrl}?mode=${architecture}&role=presenter&roomId=${roomId}`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // Wait for page to load and click connect
    await page.waitForSelector('button:contains("Connect")', { timeout: 10000 });
    await page.click('button:contains("Connect")');
    
    // Wait for screen share prompt and handle it
    await page.evaluateOnNewDocument(() => {
      // Mock getDisplayMedia for testing
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        
        // Draw test content
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'black';
        ctx.font = '12px monospace';
        
        const testCode = [
          'function calculateTotal(items) {',
          '  return items.reduce((sum, item) => {',
          '    return sum + (item.price * item.quantity);',
          '  }, 0);',
          '}',
          '',
          'const cart = [',
          '  { name: "Widget", price: 10.99, quantity: 2 },',
          '  { name: "Gadget", price: 15.50, quantity: 1 },',
          '  { name: "Tool", price: 8.25, quantity: 3 }',
          '];',
          '',
          'const total = calculateTotal(cart);',
          'console.log(`Total: $${total.toFixed(2)}`);'
        ];
        
        testCode.forEach((line, index) => {
          ctx.fillText(line, 50, 100 + (index * 20));
        });
        
        return canvas.captureStream(30);
      };
    });
    
    // Wait for connection
    await page.waitForSelector('p:contains("Connected")', { timeout: 30000 });
  }

  async setupViewerPage(page, architecture, roomId, viewerId) {
    const url = `${TEST_CONFIG.baseUrl}?mode=${architecture}&role=viewer&roomId=${roomId}`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // Wait for page to load and click connect
    await page.waitForSelector('button:contains("Connect")', { timeout: 10000 });
    await page.click('button:contains("Connect")');
    
    // Wait for connection and remote stream
    await page.waitForSelector('p:contains("Connected")', { timeout: 30000 });
  }

  async applyNetworkConditions(packetLossRate, bandwidth) {
    if (packetLossRate === 0 && bandwidth === '5mbit') {
      return; // No conditions to apply
    }
    
    console.log(`Applying network conditions: ${packetLossRate}% loss, ${bandwidth} bandwidth`);
    
    // Apply traffic control using tc (requires root privileges)
    const tcCommands = [
      'docker exec webrtc_client tc qdisc del dev eth0 root 2>/dev/null || true',
      `docker exec webrtc_client tc qdisc add dev eth0 root handle 1: netem delay 10ms loss ${packetLossRate}%`,
      `docker exec webrtc_client tc qdisc add dev eth0 parent 1: handle 2: tbf rate ${bandwidth} burst 32kbit latency 400ms`
    ];
    
    for (const cmd of tcCommands) {
      await this.executeCommand(cmd);
    }
  }

  async resetNetworkConditions() {
    console.log('Resetting network conditions...');
    await this.executeCommand('docker exec webrtc_client tc qdisc del dev eth0 root 2>/dev/null || true');
  }

  async executeCommand(command) {
    return new Promise((resolve, reject) => {
      const process = spawn('bash', ['-c', command]);
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          console.warn(`Command failed (code ${code}): ${command}`);
          console.warn(`stderr: ${stderr}`);
          resolve(''); // Continue anyway
        }
      });
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

class MetricsCollector {
  constructor(presenterPage, viewerPages) {
    this.presenterPage = presenterPage;
    this.viewerPages = viewerPages;
    this.metrics = {
      cpu: { samples: [], average: 0, max: 0 },
      bandwidth: 0,
      latency: { samples: [], average: 0, min: 0, max: 0 },
      textLegibility: 0
    };
    this.interval = null;
  }

  start() {
    this.interval = setInterval(async () => {
      await this.collectMetrics();
    }, 1000); // Collect every second
  }

  async collectMetrics() {
    try {
      // Collect CPU metrics from presenter
      const cpuUsage = await this.getCPUUsage();
      if (cpuUsage > 0) {
        this.metrics.cpu.samples.push(cpuUsage);
      }

      // Collect latency from viewers
      for (const viewerPage of this.viewerPages) {
        const latency = await this.getLatency(viewerPage);
        if (latency > 0) {
          this.metrics.latency.samples.push(latency);
        }
      }

    } catch (error) {
      console.warn('Error collecting metrics:', error.message);
    }
  }

  async getCPUUsage() {
    try {
      // Get CPU usage of Chrome process
      const result = await this.executeCommand("ps -C chrome -o %cpu --no-headers | head -1");
      return parseFloat(result.trim()) || 0;
    } catch (error) {
      return 0;
    }
  }

  async getLatency(viewerPage) {
    try {
      return await viewerPage.evaluate(() => {
        // Get the latest latency from the viewer page
        const latencyElement = document.querySelector('p:contains("Latest:")');
        if (latencyElement) {
          const text = latencyElement.textContent;
          const match = text.match(/Latest: (\\d+\\.\\d+)ms/);
          return match ? parseFloat(match[1]) : 0;
        }
        return 0;
      });
    } catch (error) {
      return 0;
    }
  }

  async executeCommand(command) {
    return new Promise((resolve) => {
      const process = spawn('bash', ['-c', command]);
      
      let stdout = '';
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.on('close', () => {
        resolve(stdout);
      });
    });
  }

  async stop() {
    if (this.interval) {
      clearInterval(this.interval);
    }

    // Calculate final metrics
    if (this.metrics.cpu.samples.length > 0) {
      this.metrics.cpu.average = this.metrics.cpu.samples.reduce((a, b) => a + b, 0) / this.metrics.cpu.samples.length;
      this.metrics.cpu.max = Math.max(...this.metrics.cpu.samples);
    }

    if (this.metrics.latency.samples.length > 0) {
      this.metrics.latency.average = this.metrics.latency.samples.reduce((a, b) => a + b, 0) / this.metrics.latency.samples.length;
      this.metrics.latency.min = Math.min(...this.metrics.latency.samples);
      this.metrics.latency.max = Math.max(...this.metrics.latency.samples);
    }

    // Text legibility score (simplified - in real implementation would use OCR)
    this.metrics.textLegibility = Math.random() * 10; // Mock score for now

    return this.metrics;
  }
}

// Main execution
async function main() {
  const testRunner = new TestRunner();
  
  try {
    await testRunner.initialize();
    await testRunner.runAllTests();
  } catch (error) {
    console.error('Test execution failed:', error);
  } finally {
    await testRunner.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { TestRunner, MetricsCollector };