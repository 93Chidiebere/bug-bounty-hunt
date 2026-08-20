import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('https://purpleschool.org', { waitUntil: 'networkidle', timeout: 30000 });
    
    // Find elements containing "Start Teaching"
    const elements = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*'))
        .filter(el => (el.innerText || "").includes("Start Teaching Now"))
        .map(el => ({
          tag: el.tagName.toLowerCase(),
          id: el.id,
          className: el.className,
          outerHTML: el.outerHTML.substring(0, 300)
        }));
    });
    
    console.log("Matching elements:\n", JSON.stringify(elements, null, 2));

    // Let's click "Start Teaching Now" and print the URL after clicking!
    console.log("Clicking 'Start Teaching Now'...");
    await page.click('text="Start Teaching Now"');
    await page.waitForTimeout(5000);
    console.log("Redirected URL after click:", page.url());

    // Capture screenshot of new screen
    await page.screenshot({ path: 'C:/Users/Chidiebere/Documents/bug-hunting-agent/scratch/after_click.png' });
    console.log("Saved screenshot of redirect screen at scratch/after_click.png");

    // Print all inputs on this redirected page
    const redirectedInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(el => ({
        type: el.type,
        id: el.id,
        name: el.name,
        placeholder: el.placeholder,
        isVisible: el.offsetWidth > 0 && el.offsetHeight > 0
      }));
    });
    console.log("Inputs on redirected page:", JSON.stringify(redirectedInputs, null, 2));

  } catch (err) {
    console.error("Error during click simulation:", err);
  } finally {
    await browser.close();
  }
}

main();
