const puppeteer = require('puppeteer');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs-extra');
const NetworkController = require('./network_control');
const MetricsCollector = require('./metrics_collector');

// Test configuration - FULL PRODUCTION VERSION
const TEST_CONFIG = {
  architectures: ['P2P'],
  numViewers: [1],
  packetLossRates: [0],
  presenterBandwidths: ['5mbit'],
  testDurationMs: 15000, // 15 seconds for minimal test
  repetitions: 1,
  
  // URLs - use container network name for Docker environment
  baseUrl: process.env.BASE_URL || 'http://client:3000'
};

class TestRunner {
  constructor() {
    this.results = [];
    this.browser = null;
    this.networkController = new NetworkController();
    this.csvWriter = createCsvWriter({
      path: '/app/results/results.csv',
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
        { id: 'avgJitter', title: 'Avg_Jitter_Ms' },
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
      protocolTimeout: 300000, // 5 minutes timeout for protocol operations
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
      presenterCpuAvg: metrics.cpu.average || 0,
      presenterCpuMax: metrics.cpu.max || 0,
      presenterBandwidthUsage: metrics.bandwidth.average || 0,
      avgLatency: metrics.latency.average || 0,
      minLatency: metrics.latency.min || 0,
      maxLatency: metrics.latency.max || 0,
      avgJitter: metrics.jitter.average || 0,
      textLegibilityScore: metrics.textLegibility || 0,
      testDuration: TEST_CONFIG.testDurationMs
    };
  }

  async setupPresenterPage(page, architecture, roomId) {
    // Mock WebRTC APIs BEFORE navigating to the page
    await page.evaluateOnNewDocument(() => {
      // Ensure navigator.mediaDevices exists
      if (!navigator.mediaDevices) {
        navigator.mediaDevices = {};
      }
      
      // Mock getDisplayMedia for presenter
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
      
      // Mock getUserMedia
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        return canvas.captureStream(30);
      };
      
      // Mock other MediaDevices APIs
      navigator.mediaDevices.enumerateDevices = async () => [];
      navigator.mediaDevices.getSupportedConstraints = () => ({});
      
      // Add console logging to debug connection process
      const originalLog = console.log;
      console.log = function(...args) {
        originalLog.apply(console, ['[WebRTC Debug]', ...args]);
      };
      
      const originalError = console.error;
      console.error = function(...args) {
        originalError.apply(console, ['[WebRTC Error]', ...args]);
      };

      // Monkey-patch RTCPeerConnection to capture instances
      window.allPeerConnections = window.allPeerConnections || [];
      const OriginalRTCPeerConnection = window.RTCPeerConnection;
      
      console.log('[WebRTC Debug] Setting up RTCPeerConnection monkey-patch, original exists:', !!OriginalRTCPeerConnection);
      
      window.RTCPeerConnection = function(...args) {
        console.log('[WebRTC Debug] RTCPeerConnection constructor called with args:', args);
        const pc = new OriginalRTCPeerConnection(...args);
        window.allPeerConnections.push(pc);
        console.log('[WebRTC Debug] RTCPeerConnection created, total connections:', window.allPeerConnections.length);
        
        // Add event listeners to track connection state
        pc.addEventListener('connectionstatechange', () => {
          console.log('[WebRTC Debug] Connection state changed to:', pc.connectionState);
        });
        
        return pc;
      };
      // Copy static methods and properties
      Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnection);
      Object.defineProperty(window.RTCPeerConnection, 'prototype', {
        value: OriginalRTCPeerConnection.prototype
      });
    });
    
    const url = `${TEST_CONFIG.baseUrl}?mode=${architecture}&role=presenter&roomId=${roomId}`;
    
    // Listen to console messages with more detail
    page.on('console', msg => {
      console.log('[BROWSER CONSOLE]', msg.type(), msg.text());
    });
    
    page.on('pageerror', error => {
      console.error('[BROWSER PAGE ERROR]', error.message);
    });
    
    page.on('requestfailed', request => {
      console.error('[REQUEST FAILED]', request.url(), request.failure()?.errorText);
    });
    
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // Wait for page to load and click connect
    console.log('[PRESENTER] Navigating to URL:', url);
    console.log('[PRESENTER] Page loaded. Waiting for connect button...');
    try {
      await page.waitForSelector('button', { timeout: 30000 });
      console.log('[PRESENTER] Button found. Attempting click...');
      
      // Try different approaches to click the button
      try {
        // First try a simple click
        await page.click('button', { timeout: 5000 });
      } catch (clickError) {
        console.log('Simple click failed, trying evaluate click...');
        try {
          // If that fails, try using evaluate to click
          await page.evaluate(() => {
            const button = document.querySelector('button');
            if (button) {
              button.click();
            }
          });
        } catch (evaluateError) {
          console.log('Evaluate click also failed:', evaluateError.message);
          throw evaluateError;
        }
      }
      
      // Wait for the connection to be established by checking the React app state
      console.log('[PRESENTER] Click complete. Waiting for isConnected state...');
      
      // First, let's debug what's actually happening
      const debugInfo = await page.evaluate(() => {
        return {
          isConnected: window.isConnected,
          hasWebrtcService: !!window.webrtcService,
          buttonText: document.querySelector('button')?.textContent,
          consoleErrors: window._debugErrors || []
        };
      });
      console.log('Current state before wait:', JSON.stringify(debugInfo, null, 2));
      
      try {
        await page.waitForFunction(() => {
          return window.isConnected === true;
        }, { timeout: 30000 }); // Reduced timeout to 30 seconds
      } catch (timeoutError) {
        console.log('Connection timeout. Getting final debug state...');
        const finalDebug = await page.evaluate(() => {
          return {
            isConnected: window.isConnected,
            hasWebrtcService: !!window.webrtcService,
            buttonText: document.querySelector('button')?.textContent,
            pageTitle: document.title,
            errors: window._debugErrors || []
          };
        });
        console.log('Final state:', JSON.stringify(finalDebug, null, 2));
        throw timeoutError;
      }
      
      console.log('[PRESENTER] isConnected is true. Connection established.');
      
      // Wait additional time for ICE candidate exchange to complete
      console.log('[PRESENTER] Waiting for ICE candidate exchange...');
      await this.sleep(2000);
    } catch (error) {
      console.log('Button wait failed:', error.message);
      // Log page content for debugging
      const content = await page.content();
      console.log('Page content length:', content.length);
      const buttons = await page.$$('button');
      console.log('Number of buttons found:', buttons.length);
      throw error;
    }
    
    // Wait for connection to stabilize
    await this.sleep(5000);
  }

  async setupViewerPage(page, architecture, roomId, viewerId) {
    // Mock WebRTC APIs BEFORE navigating to the page
    await page.evaluateOnNewDocument(() => {
      // Ensure navigator.mediaDevices exists
      if (!navigator.mediaDevices) {
        navigator.mediaDevices = {};
      }
      
      // Mock getUserMedia
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        return canvas.captureStream(30);
      };
      
      // Mock other MediaDevices APIs
      navigator.mediaDevices.enumerateDevices = async () => [];
      navigator.mediaDevices.getSupportedConstraints = () => ({});

      // Monkey-patch RTCPeerConnection to capture instances
      window.allPeerConnections = window.allPeerConnections || [];
      const OriginalRTCPeerConnection = window.RTCPeerConnection;
      
      console.log('[WebRTC Debug] Setting up RTCPeerConnection monkey-patch, original exists:', !!OriginalRTCPeerConnection);
      
      window.RTCPeerConnection = function(...args) {
        console.log('[WebRTC Debug] RTCPeerConnection constructor called with args:', args);
        const pc = new OriginalRTCPeerConnection(...args);
        window.allPeerConnections.push(pc);
        console.log('[WebRTC Debug] RTCPeerConnection created, total connections:', window.allPeerConnections.length);
        
        // Add event listeners to track connection state
        pc.addEventListener('connectionstatechange', () => {
          console.log('[WebRTC Debug] Connection state changed to:', pc.connectionState);
        });
        
        return pc;
      };
      // Copy static methods and properties
      Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnection);
      Object.defineProperty(window.RTCPeerConnection, 'prototype', {
        value: OriginalRTCPeerConnection.prototype
      });
    });

    const url = `${TEST_CONFIG.baseUrl}?mode=${architecture}&role=viewer&roomId=${roomId}`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // Wait for page to load and click connect
    console.log(`[VIEWER ${viewerId}] Navigating to URL:`, url);
    console.log(`[VIEWER ${viewerId}] Page loaded. Waiting for connect button...`);
    try {
      await page.waitForSelector('button', { timeout: 30000 });
      console.log(`[VIEWER ${viewerId}] Button found. Attempting click...`);
      
      // Try different approaches to click the button
      try {
        // First try a simple click
        await page.click('button', { timeout: 5000 });
      } catch (clickError) {
        console.log(`Simple click failed for viewer ${viewerId}, trying evaluate click...`);
        try {
          // If that fails, try using evaluate to click
          await page.evaluate(() => {
            const button = document.querySelector('button');
            if (button) {
              button.click();
            }
          });
        } catch (evaluateError) {
          console.log(`Evaluate click also failed for viewer ${viewerId}:`, evaluateError.message);
          throw evaluateError;
        }
      }
      
      // Wait for the connection to be established by checking the React app state
      console.log(`[VIEWER ${viewerId}] Click complete. Waiting for isConnected state...`);
      
      try {
        await page.waitForFunction(() => {
          return window.isConnected === true;
        }, { timeout: 30000 }); // Reduced timeout to 30 seconds
      } catch (timeoutError) {
        console.log(`Connection timeout for viewer ${viewerId}.`);
        throw timeoutError;
      }
      
      console.log(`[VIEWER ${viewerId}] isConnected is true. Connection established.`);
      
      // Wait additional time for ICE candidate exchange to complete
      console.log(`[VIEWER ${viewerId}] Waiting for ICE candidate exchange...`);
      await this.sleep(2000);
    } catch (error) {
      console.log(`Button wait failed for viewer ${viewerId}:`, error.message);
      // Log page content for debugging
      const content = await page.content();
      console.log('Page content length:', content.length);
      const buttons = await page.$('button');
      console.log('Number of buttons found:', buttons.length);
      throw error;
    }
    
    // Wait for connection and remote stream to stabilize
    await this.sleep(5000);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
    await this.networkController.reset();
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

module.exports = { TestRunner };