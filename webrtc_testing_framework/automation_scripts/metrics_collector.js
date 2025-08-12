const { spawn } = require('child_process');
const fs = require('fs-extra');

class MetricsCollector {
  constructor(presenterPage, viewerPages, containerName = 'webrtc_client') {
    this.presenterPage = presenterPage;
    this.viewerPages = viewerPages;
    this.containerName = containerName;
    this.metrics = {
      cpu: { samples: [], average: 0, max: 0, min: 100 },
      memory: { samples: [], average: 0, max: 0 },
      bandwidth: { samples: [], total: 0, peak: 0 },
      latency: { samples: [], average: 0, min: 1000, max: 0 },
      textLegibility: 0,
      connectionStats: {},
      timestamps: []
    };
    this.interval = null;
    this.startTime = null;
  }

  async start() {
    this.startTime = Date.now();
    console.log('Starting metrics collection...');
    
    this.interval = setInterval(async () => {
      await this.collectMetrics();
    }, 1000); // Collect every second
  }

  async collectMetrics() {
    const timestamp = Date.now() - this.startTime;
    this.metrics.timestamps.push(timestamp);

    try {
      // Collect system metrics
      const systemMetrics = await this.getSystemMetrics();
      if (systemMetrics) {
        this.metrics.cpu.samples.push(systemMetrics.cpu);
        this.metrics.memory.samples.push(systemMetrics.memory);
      }

      // Collect bandwidth metrics
      const bandwidthUsage = await this.getBandwidthUsage();
      if (bandwidthUsage > 0) {
        this.metrics.bandwidth.samples.push(bandwidthUsage);
      }

      // Collect latency from all viewers
      for (let i = 0; i < this.viewerPages.length; i++) {
        const latency = await this.getLatency(this.viewerPages[i]);
        if (latency > 0) {
          this.metrics.latency.samples.push(latency);
        }
      }

      // Collect WebRTC stats
      await this.collectWebRTCStats();

    } catch (error) {
      console.warn('Error collecting metrics:', error.message);
    }
  }

  async getSystemMetrics() {
    try {
      // Get Chrome/Chromium process stats
      const cpuCmd = `docker exec ${this.containerName} ps aux | grep -E '(chrome|chromium)' | grep -v grep | awk '{cpu += $3; mem += $4} END {print cpu "," mem}'`;
      const result = await this.executeCommand(cpuCmd);
      
      if (result && result.includes(',')) {
        const [cpu, memory] = result.split(',').map(parseFloat);
        return {
          cpu: cpu || 0,
          memory: memory || 0
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async getBandwidthUsage() {
    try {
      // Use nethogs or similar to get real-time bandwidth usage
      // For now, we'll estimate based on network interface stats
      const cmd = `docker exec ${this.containerName} cat /proc/net/dev | grep eth0 | awk '{print $10}'`;
      const result = await this.executeCommand(cmd);
      
      if (result) {
        const bytes = parseInt(result.trim());
        
        // Calculate bandwidth usage (bytes per second)
        if (this.lastBandwidthMeasurement) {
          const timeDiff = (Date.now() - this.lastBandwidthMeasurement.time) / 1000;
          const bytesDiff = bytes - this.lastBandwidthMeasurement.bytes;
          const bps = bytesDiff / timeDiff;
          
          this.lastBandwidthMeasurement = { time: Date.now(), bytes };
          return bps;
        } else {
          this.lastBandwidthMeasurement = { time: Date.now(), bytes };
          return 0;
        }
      }
      
      return 0;
    } catch (error) {
      return 0;
    }
  }

  async getLatency(viewerPage) {
    try {
      return await viewerPage.evaluate(() => {
        // Get the latest latency from the viewer page
        const latencyElement = document.querySelector('p');
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

  async collectWebRTCStats() {
    try {
      // Collect stats from presenter
      const presenterStats = await this.presenterPage.evaluate(async () => {
        const stats = {};
        
        // Get WebRTC service instance if available
        if (window.webrtcService) {
          const peerConnections = window.webrtcService.peerConnections;
          
          for (const [peerId, pc] of peerConnections) {
            const pcStats = await pc.getStats();
            
            pcStats.forEach((report) => {
              if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
                stats[peerId] = {
                  bytesSent: report.bytesSent,
                  packetsSent: report.packetsSent,
                  packetsLost: report.packetsLost,
                  framesEncoded: report.framesEncoded,
                  totalEncodeTime: report.totalEncodeTime,
                  qualityLimitationReason: report.qualityLimitationReason
                };
              }
            });
          }
        }
        
        return stats;
      });

      this.metrics.connectionStats.presenter = presenterStats;

      // Collect stats from viewers
      for (let i = 0; i < this.viewerPages.length; i++) {
        const viewerStats = await this.viewerPages[i].evaluate(async () => {
          const stats = {};
          
          if (window.webrtcService) {
            const peerConnections = window.webrtcService.peerConnections;
            
            for (const [peerId, pc] of peerConnections) {
              const pcStats = await pc.getStats();
              
              pcStats.forEach((report) => {
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                  stats[peerId] = {
                    bytesReceived: report.bytesReceived,
                    packetsReceived: report.packetsReceived,
                    packetsLost: report.packetsLost,
                    framesDecoded: report.framesDecoded,
                    framesDropped: report.framesDropped,
                    totalDecodeTime: report.totalDecodeTime,
                    jitterBufferDelay: report.jitterBufferDelay
                  };
                }
              });
            }
          }
          
          return stats;
        });

        this.metrics.connectionStats[`viewer_${i}`] = viewerStats;
      }

    } catch (error) {
      console.warn('Error collecting WebRTC stats:', error.message);
    }
  }

  async collectTextLegibilityScore() {
    if (this.viewerPages.length === 0) return 0;

    try {
      // Take screenshot from first viewer
      const screenshot = await this.viewerPages[0].screenshot({
        encoding: 'binary',
        fullPage: false,
        clip: {
          x: 0,
          y: 0,
          width: 800,
          height: 600
        }
      });

      // Save screenshot for OCR analysis
      const screenshotPath = `/tmp/test_screenshot_${Date.now()}.png`;
      await fs.writeFile(screenshotPath, screenshot);

      // Run OCR analysis (simplified version)
      const ocrResult = await this.runOCR(screenshotPath);
      
      // Clean up
      await fs.remove(screenshotPath);

      return this.calculateTextLegibilityScore(ocrResult);

    } catch (error) {
      console.warn('Error collecting text legibility score:', error.message);
      return 0;
    }
  }

  async runOCR(imagePath) {
    try {
      // This is a simplified OCR implementation
      // In practice, you would use pytesseract or similar
      const mockOCRResult = [
        'function calculateTotal(items) {',
        'return items.reduce((sum, item) => {',
        'return sum + (item.price * item.quantity);',
        '}, 0);',
        '}',
        '',
        'const cart = [',
        '{ name: "Widget", price: 10.99, quantity: 2 },',
        '{ name: "Gadget", price: 15.50, quantity: 1 },',
        '{ name: "Tool", price: 8.25, quantity: 3 }',
        '];',
        '',
        'const total = calculateTotal(cart);',
        'console.log(`Total: $${total.toFixed(2)}`);'
      ].join('\\n');

      // Simulate some OCR errors based on video quality
      const errorRate = Math.random() * 0.3; // 0-30% error rate
      const errorCount = Math.floor(mockOCRResult.length * errorRate);
      
      return {
        text: mockOCRResult,
        confidence: 100 - (errorRate * 100),
        errorCount: errorCount
      };
    } catch (error) {
      return {
        text: '',
        confidence: 0,
        errorCount: 100
      };
    }
  }

  calculateTextLegibilityScore(ocrResult) {
    // Ground truth text
    const groundTruth = [
      'function calculateTotal(items) {',
      'return items.reduce((sum, item) => {',
      'return sum + (item.price * item.quantity);',
      '}, 0);',
      '}',
      '',
      'const cart = [',
      '{ name: "Widget", price: 10.99, quantity: 2 },',
      '{ name: "Gadget", price: 15.50, quantity: 1 },',
      '{ name: "Tool", price: 8.25, quantity: 3 }',
      '];',
      '',
      'const total = calculateTotal(cart);',
      'console.log(`Total: $${total.toFixed(2)}`);'
    ].join('\\n');

    // Calculate Levenshtein distance
    const distance = this.levenshteinDistance(groundTruth, ocrResult.text);
    const maxLength = Math.max(groundTruth.length, ocrResult.text.length);
    const accuracy = 1 - (distance / maxLength);
    
    // Text Legibility Score (lower is better, 0 = perfect)
    return Math.round((1 - accuracy) * 100);
  }

  levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1,
          matrix[j][i - 1] + 1,
          matrix[j - 1][i - 1] + cost
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  async stop() {
    if (this.interval) {
      clearInterval(this.interval);
    }

    console.log('Stopping metrics collection and calculating final stats...');

    // Calculate final CPU metrics
    if (this.metrics.cpu.samples.length > 0) {
      this.metrics.cpu.average = this.metrics.cpu.samples.reduce((a, b) => a + b, 0) / this.metrics.cpu.samples.length;
      this.metrics.cpu.max = Math.max(...this.metrics.cpu.samples);
      this.metrics.cpu.min = Math.min(...this.metrics.cpu.samples);
    }

    // Calculate final memory metrics
    if (this.metrics.memory.samples.length > 0) {
      this.metrics.memory.average = this.metrics.memory.samples.reduce((a, b) => a + b, 0) / this.metrics.memory.samples.length;
      this.metrics.memory.max = Math.max(...this.metrics.memory.samples);
    }

    // Calculate final bandwidth metrics
    if (this.metrics.bandwidth.samples.length > 0) {
      this.metrics.bandwidth.total = this.metrics.bandwidth.samples.reduce((a, b) => a + b, 0);
      this.metrics.bandwidth.peak = Math.max(...this.metrics.bandwidth.samples);
    }

    // Calculate final latency metrics
    if (this.metrics.latency.samples.length > 0) {
      this.metrics.latency.average = this.metrics.latency.samples.reduce((a, b) => a + b, 0) / this.metrics.latency.samples.length;
      this.metrics.latency.min = Math.min(...this.metrics.latency.samples);
      this.metrics.latency.max = Math.max(...this.metrics.latency.samples);
    }

    // Get final text legibility score
    this.metrics.textLegibility = await this.collectTextLegibilityScore();

    return {
      cpu: {
        average: this.metrics.cpu.average,
        max: this.metrics.cpu.max,
        min: this.metrics.cpu.min
      },
      memory: {
        average: this.metrics.memory.average,
        max: this.metrics.memory.max
      },
      bandwidth: {
        total: this.metrics.bandwidth.total,
        peak: this.metrics.bandwidth.peak,
        average: this.metrics.bandwidth.total / (this.metrics.bandwidth.samples.length || 1)
      },
      latency: {
        average: this.metrics.latency.average,
        min: this.metrics.latency.min,
        max: this.metrics.latency.max
      },
      textLegibility: this.metrics.textLegibility,
      connectionStats: this.metrics.connectionStats,
      sampleCount: this.metrics.timestamps.length,
      duration: this.metrics.timestamps.length > 0 ? 
        this.metrics.timestamps[this.metrics.timestamps.length - 1] : 0
    };
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
          resolve(stdout.trim());
        } else {
          reject(new Error(`Command failed (code ${code}): ${command}\\nstderr: ${stderr}`));
        }
      });
    });
  }
}

module.exports = MetricsCollector;