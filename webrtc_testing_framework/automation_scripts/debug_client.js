#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function debugClient() {
  console.log('Starting debug session...');
  
  const browser = await puppeteer.launch({
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

  try {
    const page = await browser.newPage();
    
    // Enable console logging from the page
    page.on('console', (msg) => {
      console.log('PAGE LOG:', msg.text());
    });
    
    page.on('pageerror', (error) => {
      console.log('PAGE ERROR:', error.message);
    });
    
    console.log('Navigating to client...');
    await page.goto('http://client:3000?mode=P2P&role=presenter&roomId=debug-test', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    console.log('Page loaded, waiting for React to render...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('Getting page content...');
    const content = await page.content();
    console.log('HTML length:', content.length);
    
    console.log('Looking for buttons...');
    const buttons = await page.$$('button');
    console.log('Found', buttons.length, 'buttons');
    
    if (buttons.length > 0) {
      const buttonText = await page.evaluate((btn) => btn.textContent, buttons[0]);
      console.log('First button text:', buttonText);
    }
    
    console.log('Checking for React app root...');
    const rootContent = await page.$eval('#root', el => el.innerHTML).catch(e => 'NOT FOUND');
    console.log('Root content length:', rootContent.length);
    
    // Try to wait for the Connect button specifically
    console.log('Waiting for Connect button...');
    try {
      await page.waitForSelector('button:contains("Connect")', { timeout: 15000 });
      console.log('Found Connect button!');
    } catch (error) {
      console.log('Connect button not found, trying generic button...');
      try {
        await page.waitForSelector('button', { timeout: 15000 });
        console.log('Found generic button!');
        const allButtonsText = await page.$$eval('button', buttons => 
          buttons.map(btn => btn.textContent)
        );
        console.log('All button texts:', allButtonsText);
      } catch (error2) {
        console.log('No buttons found at all:', error2.message);
      }
    }
    
  } catch (error) {
    console.error('Debug failed:', error);
  } finally {
    await browser.close();
  }
}

// Install puppeteer if not available
debugClient().catch(console.error);