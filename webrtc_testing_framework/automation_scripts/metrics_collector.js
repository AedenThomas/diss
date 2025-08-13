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
      latency: { samples: [], average: 0, min: 0, max: 0 },
      jitter: { samples: [], average: 0, min: 0, max: 0 },
      packetsLost: { samples: [], total: 0 },
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
      // Collect real system metrics only
      const systemMetrics = await this.getSystemMetrics();
      if (systemMetrics) {
        this.metrics.cpu.samples.push(systemMetrics.cpu);
        this.metrics.memory.samples.push(systemMetrics.memory);
      }

      // Collect real bandwidth metrics
      const bandwidthUsage = await this.getBandwidthUsage();
      if (bandwidthUsage > 0) {
        this.metrics.bandwidth.samples.push(bandwidthUsage);
      }

      // Collect real latency from all viewers
      for (let i = 0; i < this.viewerPages.length; i++) {
        const latency = await this.getLatency(this.viewerPages[i]);
        if (latency > 0) {
          this.metrics.latency.samples.push(latency);
        }
      }

      // Collect real jitter from all viewers
      for (let i = 0; i < this.viewerPages.length; i++) {
        const jitter = await this.getJitter(this.viewerPages[i]);
        if (jitter > 0) {
          this.metrics.jitter.samples.push(jitter);
        }
      }

      // Collect packets lost from all viewers
      for (let i = 0; i < this.viewerPages.length; i++) {
        const packetsLost = await this.getPacketsLost(this.viewerPages[i]);
        if (packetsLost >= 0) {
          this.metrics.packetsLost.samples.push(packetsLost);
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
      // Use Puppeteer's built-in metrics to calculate CPU usage over time
      const presenterMetrics = await this.presenterPage.metrics();
      
      if (presenterMetrics.TaskDuration !== undefined) {
        const currentTaskDuration = presenterMetrics.TaskDuration;
        const currentTime = Date.now();
        
        // Calculate CPU usage as change in TaskDuration over time interval
        if (this.lastMetrics) {
          const timeDiffSeconds = (currentTime - this.lastMetrics.time) / 1000;
          const taskDurationDiff = currentTaskDuration - this.lastMetrics.taskDuration;
          
          // CPU percentage = (time spent in tasks / total time) * 100
          const cpuPercentage = (taskDurationDiff / timeDiffSeconds) * 100;
          
          this.lastMetrics = { taskDuration: currentTaskDuration, time: currentTime };
          
          return {
            cpu: Math.min(100, Math.max(0, cpuPercentage)),
            memory: presenterMetrics.JSHeapUsedSize ? (presenterMetrics.JSHeapUsedSize / (1024 * 1024)) : 0
          };
        } else {
          // First measurement - store baseline and return 0
          this.lastMetrics = { taskDuration: currentTaskDuration, time: currentTime };
          return {
            cpu: 0,
            memory: presenterMetrics.JSHeapUsedSize ? (presenterMetrics.JSHeapUsedSize / (1024 * 1024)) : 0
          };
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Error getting system metrics:', error.message);
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
      // NEW APPROACH: For SFU mode, first try querying presenter page for RTT
      console.log('[METRICS DEBUG] Querying PRESENTER for SFU latency...');
      try {
        const presenterRTT = await this.presenterPage.evaluate(async () => {
          if (window.mediasoupSendTransport) {
            console.log('[METRICS DEBUG] Found mediasoup send transport on presenter');
            try {
              const stats = await window.mediasoupSendTransport.getStats();
              console.log('[METRICS DEBUG] Send transport stats report count:', stats.size);
              
              const reportTypes = [];
              for (const report of stats.values()) {
                reportTypes.push(report.type);
                // Look for remote-inbound-rtp reports - this is the stream received by the SFU
                if (report.type === 'remote-inbound-rtp' && report.roundTripTime !== undefined) {
                  console.log('[METRICS DEBUG] Found presenter-to-SFU RTT:', report.roundTripTime * 1000);
                  return report.roundTripTime * 1000; // Convert to milliseconds
                }
              }
              console.log('[METRICS DEBUG] Send transport available report types:', [...new Set(reportTypes)]);
            } catch (error) {
              console.log('[METRICS DEBUG] Error querying send transport stats:', error.message);
            }
          }
          return null; // No RTT found on presenter
        });
        
        if (presenterRTT !== null && presenterRTT > 0) {
          console.log('[METRICS DEBUG] Successfully got presenter-to-SFU RTT:', presenterRTT);
          return presenterRTT;
        }
      } catch (error) {
        console.log('[METRICS DEBUG] Error querying presenter page:', error.message);
      }
      
      // Fallback: Query viewer page (original logic)
      console.log('[METRICS DEBUG] Falling back to viewer page query...');
      return await viewerPage.evaluate(async () => {
        // Check for P2P connections first
        if (window.allPeerConnections && window.allPeerConnections.length > 0) {
          console.log('[METRICS DEBUG] Found', window.allPeerConnections.length, 'P2P connections');
          for (const pc of window.allPeerConnections) {
            if (pc && pc.getStats) {
              console.log('[METRICS DEBUG] Connection state:', pc.connectionState);
              const stats = await pc.getStats();
              console.log('[METRICS DEBUG] Stats report count:', stats.size);
              
              const reportTypes = [];
              for (const report of stats.values()) {
                reportTypes.push(report.type);
                if (report.type === 'remote-inbound-rtp' && report.roundTripTime !== undefined) {
                  console.log('[METRICS DEBUG] Found latency:', report.roundTripTime * 1000);
                  return report.roundTripTime * 1000; // Convert to milliseconds
                }
                
                if (report.type === 'candidate-pair' && report.currentRoundTripTime !== undefined && report.state === 'succeeded') {
                  console.log('[METRICS DEBUG] Found latency from candidate-pair:', report.currentRoundTripTime * 1000);
                  return report.currentRoundTripTime * 1000; // Convert to milliseconds
                }
              }
              console.log('[METRICS DEBUG] Available report types:', [...new Set(reportTypes)]);
            }
          }
        }
        
        // Check for mediasoup consumers first (likely source of RTT data)
        if (window.mediasoupConsumers && window.mediasoupConsumers.length > 0) {
          console.log('[METRICS DEBUG] Found', window.mediasoupConsumers.length, 'mediasoup consumers');
          for (const consumer of window.mediasoupConsumers) {
            if (consumer && consumer.getStats) {
              console.log('[METRICS DEBUG] Consumer state:', consumer.closed ? 'closed' : 'open');
              const stats = await consumer.getStats();
              console.log('[METRICS DEBUG] Consumer Stats report count:', stats.size);
              
              const reportTypes = [];
              const allReports = [];
              for (const report of stats.values()) {
                reportTypes.push(report.type);
                allReports.push({type: report.type, id: report.id, ...report});
                
                // Look for remote-outbound-rtp reports for round-trip time
                if (report.type === 'remote-outbound-rtp' && report.roundTripTime !== undefined) {
                  console.log('[METRICS DEBUG] Found latency from consumer remote-outbound-rtp:', report.roundTripTime * 1000);
                  return report.roundTripTime * 1000; // Convert to milliseconds
                }
                
                // Alternative: look for inbound-rtp reports with RTT
                if (report.type === 'inbound-rtp' && report.roundTripTime !== undefined) {
                  console.log('[METRICS DEBUG] Found latency from consumer inbound-rtp:', report.roundTripTime * 1000);
                  return report.roundTripTime * 1000; // Convert to milliseconds
                }
              }
              console.log('[METRICS DEBUG] Consumer Available report types:', [...new Set(reportTypes)]);
              console.log('[METRICS DEBUG] Consumer All reports:', allReports);
            }
          }
        }
        
        // Use the exposed mediasoup transports
        if (window.mediasoupTransports && window.mediasoupTransports.length > 0) {
          console.log('[METRICS DEBUG] Found', window.mediasoupTransports.length, 'mediasoup transports');
          for (const transport of window.mediasoupTransports) {
            if (transport && transport.getStats) {
              console.log('[METRICS DEBUG] SFU Transport state:', transport.connectionState);
              const stats = await transport.getStats();
              console.log('[METRICS DEBUG] SFU Stats report count:', stats.size);
              
              const reportTypes = [];
              const allReports = [];
              for (const report of stats.values()) {
                reportTypes.push(report.type);
                allReports.push({type: report.type, id: report.id, ...report});
                
                // Look for remote-inbound-rtp reports for round-trip time
                if (report.type === 'remote-inbound-rtp' && report.roundTripTime !== undefined) {
                  console.log('[METRICS DEBUG] Found latency from mediasoup remote-inbound-rtp:', report.roundTripTime * 1000);
                  return report.roundTripTime * 1000; // Convert to milliseconds
                }
                
                // Alternative: look for candidate-pair reports
                if (report.type === 'candidate-pair' && report.currentRoundTripTime !== undefined && report.state === 'succeeded') {
                  console.log('[METRICS DEBUG] Found latency from mediasoup candidate-pair:', report.currentRoundTripTime * 1000);
                  return report.currentRoundTripTime * 1000; // Convert to milliseconds
                }
              }
              console.log('[METRICS DEBUG] SFU Available report types:', [...new Set(reportTypes)]);
              console.log('[METRICS DEBUG] SFU All reports:', allReports);
            }
          }
        }
        
        console.log('[METRICS DEBUG] No latency data found');
        return 0;
      });
    } catch (error) {
      console.warn('Error getting latency:', error.message);
      return 0;
    }
  }

  async getJitter(viewerPage) {
    try {
      // For SFU mode, jitter is not typically measured on the sending side
      // Check if we're in SFU mode by querying presenter page
      try {
        const isSFU = await this.presenterPage.evaluate(() => {
          return window.mediasoupSendTransport !== undefined;
        });
        
        if (isSFU) {
          console.log('[JITTER DEBUG] SFU mode detected - jitter not measured on sender side');
          return 0; // SFU mode - return 0 for jitter
        }
      } catch (error) {
        console.log('[JITTER DEBUG] Error checking SFU mode:', error.message);
      }
      
      // P2P mode or fallback - query viewer page
      return await viewerPage.evaluate(async () => {
        // Check for P2P connections first
        if (window.allPeerConnections && window.allPeerConnections.length > 0) {
          console.log('[JITTER DEBUG] Found', window.allPeerConnections.length, 'P2P connections');
          for (const pc of window.allPeerConnections) {
            if (pc && pc.getStats) {
              const stats = await pc.getStats();
              
              for (const report of stats.values()) {
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                  console.log('[JITTER DEBUG] Found inbound-rtp video report');
                  // Use direct jitter property (in seconds, convert to ms)
                  if (report.jitter !== undefined) {
                    console.log('[JITTER DEBUG] Found jitter:', report.jitter * 1000);
                    return report.jitter * 1000; // Convert to milliseconds
                  }
                  
                  // Alternative: calculate from jitterBufferDelay
                  if (report.jitterBufferDelay !== undefined && report.packetsReceived > 0) {
                    const jitterMs = (report.jitterBufferDelay * 1000) / report.packetsReceived;
                    console.log('[JITTER DEBUG] Calculated jitter from buffer:', jitterMs);
                    return jitterMs;
                  }
                }
              }
            }
          }
        }
        
        // Check for mediasoup consumers first (likely source of jitter data)
        if (window.mediasoupConsumers && window.mediasoupConsumers.length > 0) {
          console.log('[JITTER DEBUG] Found', window.mediasoupConsumers.length, 'mediasoup consumers');
          for (const consumer of window.mediasoupConsumers) {
            if (consumer && consumer.getStats) {
              console.log('[JITTER DEBUG] Consumer state:', consumer.closed ? 'closed' : 'open');
              const stats = await consumer.getStats();
              console.log('[JITTER DEBUG] Consumer Stats report count:', stats.size);
              
              const reportTypes = [];
              const allReports = [];
              for (const report of stats.values()) {
                reportTypes.push(report.type);
                allReports.push({type: report.type, id: report.id, ...report});
                
                if (report.type === 'inbound-rtp' && report.kind === 'video') {
                  console.log('[JITTER DEBUG] Found inbound-rtp video report (Consumer):', report);
                  // Use direct jitter property (in seconds, convert to ms)
                  if (report.jitter !== undefined) {
                    console.log('[JITTER DEBUG] Found jitter from consumer:', report.jitter * 1000);
                    return report.jitter * 1000; // Convert to milliseconds
                  }
                  
                  // Alternative: calculate from jitterBufferDelay
                  if (report.jitterBufferDelay !== undefined && report.packetsReceived > 0) {
                    const jitterMs = (report.jitterBufferDelay * 1000) / report.packetsReceived;
                    console.log('[JITTER DEBUG] Calculated jitter from consumer buffer:', jitterMs);
                    return jitterMs;
                  }
                }
              }
              console.log('[JITTER DEBUG] Consumer Available report types:', [...new Set(reportTypes)]);
              console.log('[JITTER DEBUG] Consumer All reports:', allReports);
            }
          }
        }
        
        // Use the exposed mediasoup transports
        if (window.mediasoupTransports && window.mediasoupTransports.length > 0) {
          console.log('[JITTER DEBUG] Found', window.mediasoupTransports.length, 'mediasoup transports');
          for (const transport of window.mediasoupTransports) {
            if (transport && transport.getStats) {
              console.log('[JITTER DEBUG] SFU Transport state:', transport.connectionState);
              const stats = await transport.getStats();
              console.log('[JITTER DEBUG] SFU Stats report count:', stats.size);
              
              const reportTypes = [];
              const allReports = [];
              for (const report of stats.values()) {
                reportTypes.push(report.type);
                allReports.push({type: report.type, id: report.id, ...report});
                
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                  console.log('[JITTER DEBUG] Found inbound-rtp video report (SFU):', report);
                  // Use direct jitter property (in seconds, convert to ms)
                  if (report.jitter !== undefined) {
                    console.log('[JITTER DEBUG] Found jitter from mediasoup:', report.jitter * 1000);
                    return report.jitter * 1000; // Convert to milliseconds
                  }
                  
                  // Alternative: calculate from jitterBufferDelay
                  if (report.jitterBufferDelay !== undefined && report.packetsReceived > 0) {
                    const jitterMs = (report.jitterBufferDelay * 1000) / report.packetsReceived;
                    console.log('[JITTER DEBUG] Calculated jitter from mediasoup buffer:', jitterMs);
                    return jitterMs;
                  }
                }
              }
              console.log('[JITTER DEBUG] SFU Available report types:', [...new Set(reportTypes)]);
              console.log('[JITTER DEBUG] SFU All reports:', allReports);
            }
          }
        }
        
        console.log('[JITTER DEBUG] No jitter data found');
        return 0;
      });
    } catch (error) {
      console.warn('Error getting jitter:', error.message);
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

  async getPacketsLost(viewerPage) {
    try {
      return await viewerPage.evaluate(async () => {
        console.log('[PACKETS_LOST DEBUG] Starting packets lost collection');
        
        // Check for P2P connections first
        if (window.allPeerConnections && window.allPeerConnections.length > 0) {
          console.log('[PACKETS_LOST DEBUG] Found', window.allPeerConnections.length, 'P2P connections');
          for (const pc of window.allPeerConnections) {
            if (pc && pc.getStats) {
              console.log('[PACKETS_LOST DEBUG] P2P Connection state:', pc.connectionState);
              const stats = await pc.getStats();
              console.log('[PACKETS_LOST DEBUG] P2P Stats report count:', stats.size);
              
              const reportTypes = [];
              for (const report of stats.values()) {
                reportTypes.push(report.type);
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                  console.log('[PACKETS_LOST DEBUG] Found inbound-rtp video report:', report);
                  if (report.packetsLost !== undefined) {
                    console.log('[PACKETS_LOST DEBUG] Found packets lost (P2P):', report.packetsLost);
                    return report.packetsLost;
                  }
                }
              }
              console.log('[PACKETS_LOST DEBUG] P2P Available report types:', [...new Set(reportTypes)]);
            }
          }
        }
        
        // Check for SFU connections via mediasoup transports
        if (window.mediasoupTransports && window.mediasoupTransports.length > 0) {
          console.log('[PACKETS_LOST DEBUG] Found', window.mediasoupTransports.length, 'mediasoup transports');
          for (const transport of window.mediasoupTransports) {
            if (transport && transport.getStats) {
              console.log('[PACKETS_LOST DEBUG] SFU Transport state:', transport.connectionState);
              const stats = await transport.getStats();
              console.log('[PACKETS_LOST DEBUG] SFU Stats report count:', stats.size);
              
              const reportTypes = [];
              for (const report of stats.values()) {
                reportTypes.push(report.type);
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                  console.log('[PACKETS_LOST DEBUG] Found inbound-rtp video report (SFU):', report);
                  if (report.packetsLost !== undefined) {
                    console.log('[PACKETS_LOST DEBUG] Found packets lost (SFU):', report.packetsLost);
                    return report.packetsLost;
                  }
                }
              }
              console.log('[PACKETS_LOST DEBUG] SFU Available report types:', [...new Set(reportTypes)]);
            }
          }
        }
        
        // Also check window.webrtcService as a fallback
        if (window.webrtcService && window.webrtcService.peerConnections) {
          console.log('[PACKETS_LOST DEBUG] Found webrtcService with', window.webrtcService.peerConnections.size, 'peer connections');
          for (const [peerId, pc] of window.webrtcService.peerConnections) {
            if (pc && pc.getStats) {
              const stats = await pc.getStats();
              for (const report of stats.values()) {
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                  console.log('[PACKETS_LOST DEBUG] Found inbound-rtp video report (webrtcService):', report);
                  if (report.packetsLost !== undefined) {
                    console.log('[PACKETS_LOST DEBUG] Found packets lost (webrtcService):', report.packetsLost);
                    return report.packetsLost;
                  }
                }
              }
            }
          }
        }
        
        console.log('[PACKETS_LOST DEBUG] No packets lost data found, returning 0');
        return 0;
      });
    } catch (error) {
      console.warn('Error getting packets lost:', error.message);
      return 0;
    }
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

    // Calculate final jitter metrics
    if (this.metrics.jitter.samples.length > 0) {
      this.metrics.jitter.average = this.metrics.jitter.samples.reduce((a, b) => a + b, 0) / this.metrics.jitter.samples.length;
      this.metrics.jitter.min = Math.min(...this.metrics.jitter.samples);
      this.metrics.jitter.max = Math.max(...this.metrics.jitter.samples);
    }

    // Calculate final packets lost metrics
    if (this.metrics.packetsLost.samples.length > 0) {
      this.metrics.packetsLost.total = this.metrics.packetsLost.samples.reduce((a, b) => a + b, 0);
    }

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
        average: this.metrics.bandwidth.samples.length > 0 ? 
          this.metrics.bandwidth.total / this.metrics.bandwidth.samples.length : 0
      },
      latency: {
        average: this.metrics.latency.average,
        min: this.metrics.latency.min,
        max: this.metrics.latency.max
      },
      jitter: {
        average: this.metrics.jitter.average,
        min: this.metrics.jitter.min,
        max: this.metrics.jitter.max
      },
      packetsLost: {
        total: this.metrics.packetsLost.total
      },
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