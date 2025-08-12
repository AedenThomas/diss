const { spawn } = require('child_process');

class NetworkController {
  constructor(containerName = 'webrtc_client') {
    this.containerName = containerName;
    this.interface = 'eth0';
  }

  async applyConditions(bandwidth, packetLoss, latency = '10ms') {
    console.log(`Applying network conditions: ${bandwidth} bandwidth, ${packetLoss}% loss, ${latency} latency`);
    
    try {
      // Clear existing rules
      await this.executeCommand(`docker exec ${this.containerName} tc qdisc del dev ${this.interface} root 2>/dev/null || true`);
      
      // Apply packet loss and latency with netem
      await this.executeCommand(
        `docker exec ${this.containerName} tc qdisc add dev ${this.interface} root handle 1: netem delay ${latency} loss ${packetLoss}%`
      );
      
      // Apply bandwidth limit with tbf (Token Bucket Filter)
      if (bandwidth !== 'unlimited') {
        await this.executeCommand(
          `docker exec ${this.containerName} tc qdisc add dev ${this.interface} parent 1: handle 2: tbf rate ${bandwidth} burst 32kbit latency 400ms`
        );
      }
      
      console.log('Network conditions applied successfully');
    } catch (error) {
      console.error('Failed to apply network conditions:', error.message);
      throw error;
    }
  }

  async reset() {
    console.log('Resetting network conditions...');
    try {
      await this.executeCommand(`docker exec ${this.containerName} tc qdisc del dev ${this.interface} root 2>/dev/null || true`);
      console.log('Network conditions reset successfully');
    } catch (error) {
      console.warn('Failed to reset network conditions:', error.message);
    }
  }

  async getCurrentStats() {
    try {
      const stats = await this.executeCommand(`docker exec ${this.containerName} tc -s qdisc show dev ${this.interface}`);
      return this.parseTrafficStats(stats);
    } catch (error) {
      console.warn('Failed to get network stats:', error.message);
      return null;
    }
  }

  parseTrafficStats(statsOutput) {
    const lines = statsOutput.split('\\n');
    const stats = {
      packets: { sent: 0, dropped: 0 },
      bytes: { sent: 0, received: 0 },
      rate: 0
    };

    for (const line of lines) {
      if (line.includes('Sent')) {
        const sentMatch = line.match(/Sent (\\d+) bytes (\\d+) pkt/);
        if (sentMatch) {
          stats.bytes.sent = parseInt(sentMatch[1]);
          stats.packets.sent = parseInt(sentMatch[2]);
        }
        
        const droppedMatch = line.match(/dropped (\\d+)/);
        if (droppedMatch) {
          stats.packets.dropped = parseInt(droppedMatch[1]);
        }
      }
    }

    return stats;
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

module.exports = NetworkController;