const puppeteer = require('puppeteer');

async function simpleConnectionTest() {
  console.log('Starting simple WebRTC connection test...');
  
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 60000,
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

  try {
    const page = await browser.newPage();
    
    // Capture console messages for debugging
    page.on('console', msg => {
      console.log('Browser console:', msg.type(), '-', msg.text());
    });
    
    page.on('pageerror', error => {
      console.error('Page error:', error.message);
    });
    
    page.on('requestfailed', request => {
      console.log('Request failed:', request.url(), request.failure()?.errorText);
    });
    
    // Mock WebRTC APIs
    await page.evaluateOnNewDocument(() => {
      // Ensure navigator and mediaDevices exist
      if (!navigator.mediaDevices) {
        navigator.mediaDevices = {};
      }
      
      navigator.mediaDevices.getDisplayMedia = async () => {
        console.log('Mock getDisplayMedia called');
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        
        // Draw something visible
        ctx.fillStyle = 'blue';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = '48px Arial';
        ctx.fillText('Test Screen Share', 100, 100);
        
        return canvas.captureStream(30);
      };
      
      navigator.mediaDevices.getUserMedia = async () => {
        console.log('Mock getUserMedia called');
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        
        // Draw something visible
        ctx.fillStyle = 'green';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        return canvas.captureStream(30);
      };
      
      // Mock other APIs that might be needed
      if (!navigator.permissions) {
        navigator.permissions = {
          query: async () => ({ state: 'granted' })
        };
      }
    });
    
    // Navigate to the client in P2P mode
    const url = 'http://client:3000?mode=P2P&role=presenter&roomId=simple-test';
    console.log('Navigating to:', url);
    
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    console.log('Page loaded successfully');
    
    // Check if button exists
    const buttons = await page.$$('button');
    console.log('Number of buttons found:', buttons.length);
    
    if (buttons.length > 0) {
      const buttonText = await page.evaluate(() => {
        const btn = document.querySelector('button');
        return btn ? btn.textContent : 'No button';
      });
      console.log('Button text:', buttonText);
      
      // Try to click using evaluate with a timeout
      console.log('Attempting to click connect button...');
      try {
        await page.evaluate(() => {
          const button = document.querySelector('button');
          if (button) {
            button.click();
            return 'clicked';
          }
          return 'no-button';
        });
        console.log('Button click completed');
      } catch (clickError) {
        console.log('Click evaluation timed out:', clickError.message);
        // Continue anyway to see if the state changed
      }
      
      // Wait a bit and check the state with timeout protection
      console.log('Waiting 3 seconds before checking state...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      try {
        const finalState = await Promise.race([
          page.evaluate(() => {
            return {
              isConnected: window.isConnected,
              buttonText: document.querySelector('button')?.textContent,
              hasWebrtcService: !!window.webrtcService,
              timestamp: Date.now()
            };
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('State check timeout')), 5000))
        ]);
        
        console.log('Final state:', JSON.stringify(finalState, null, 2));
        
        if (finalState.isConnected) {
          console.log('✅ SUCCESS: WebRTC connection established!');
          return true;
        } else if (finalState.buttonText === 'Disconnect') {
          console.log('✅ SUCCESS: Button changed to Disconnect (connection likely successful)');
          return true;
        } else {
          console.log('⚠️  Connection not established, but test completed without hanging');
          return false;
        }
      } catch (stateError) {
        console.log('State check failed:', stateError.message);
        console.log('⚠️  Could not verify final state, but click was attempted');
        return false;
      }
    } else {
      console.log('❌ ERROR: No buttons found on page');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  simpleConnectionTest()
    .then(success => {
      console.log('Test result:', success ? 'PASS' : 'FAIL');
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = { simpleConnectionTest };