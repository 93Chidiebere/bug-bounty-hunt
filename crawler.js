import { chromium } from 'playwright';
import { GoogleGenAI } from '@google/genai';

/**
 * Executes the autonomous crawling and QA testing flow.
 * @param {Object} params
 * @param {string} params.startUrl - The initial URL to crawl.
 * @param {string} params.geminiApiKey - The API key for Gemini.
 * @param {function(string)} params.onLog - Log stream callback.
 * @param {function(Object)} params.onBugFound - Triggered when a bug is found.
 * @param {number} [params.maxPages] - Max pages to crawl.
 */
export async function runQAEngine({ 
  startUrl, 
  geminiApiKey, 
  provider = 'gemini', 
  model = 'gemini-1.5-flash', 
  loginUrl = '',
  loginUser = '',
  loginPass = '',
  testScenario = '',
  onLog, 
  onBugFound, 
  onPageAudited,
  maxPages = 5 
}) {
  let browser;
  try {
    let ai;
    if (provider === 'gemini') {
      onLog(`[SYS] Initializing Gemini AI client...`);
      ai = new GoogleGenAI({ apiKey: geminiApiKey });
    }

    onLog(`[SYS] Launching headless browser...`);
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 B2B-QA-Agent/1.0'
    });

    // Optimize page speeds in low-bandwidth environments (abort video, fonts, and trackers)
    await context.route('**/*', (route) => {
      const request = route.request();
      const type = request.resourceType();
      const url = request.url().toLowerCase();
      if (
        type === 'media' || // Abort video/audio
        type === 'font' ||  // Abort web fonts (use native fallback)
        url.includes('analytics') ||
        url.includes('google-analytics') ||
        url.includes('googletagmanager') ||
        url.includes('facebook') ||
        url.includes('pixel') ||
        url.includes('hotjar') ||
        url.includes('mixpanel') ||
        url.includes('doubleclick')
      ) {
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    });

    // Authenticate context if credentials are provided
    if (loginUrl && loginUser) {
      const loginPage = await context.newPage();
      try {
        await performLogin(loginPage, loginUrl, loginUser, loginPass, onLog);
      } catch (err) {
        onLog(`[WARNING] Login failed: ${err.message}. Auditing site without session auth.`);
      } finally {
        await loginPage.close();
      }
    }

    const queue = [startUrl];
    const visited = new Set();
    const origin = new URL(startUrl).origin;
    const targetHost = new URL(startUrl).hostname.replace('www.', '');
    let pagesCrawledCount = 0;

    // Run Custom Step-by-Step Scenario Script if provided
    if (testScenario) {
      const scenarioPage = await context.newPage();
      try {
        await executeCustomScenario(scenarioPage, testScenario, onLog, onBugFound);
        const finalUrl = scenarioPage.url();
        if (!queue.includes(finalUrl)) {
          onLog(`[SYS] Adding scenario final destination to crawl queue: ${finalUrl}`);
          queue.unshift(finalUrl);
        }
      } catch (err) {
        onLog(`[WARNING] Scenario execution aborted. Resuming default crawl.`);
      } finally {
        await scenarioPage.close();
      }
    }

    onLog(`[SYS] Starting analysis scan on target: ${startUrl}`);

    while (queue.length > 0 && pagesCrawledCount < maxPages) {
      const currentUrl = queue.shift();

      // Normalize URL (strip trailing slashes, hashes)
      let normUrl = currentUrl.split('#')[0];
      if (normUrl.endsWith('/')) {
        normUrl = normUrl.slice(0, -1);
      }

      if (visited.has(normUrl)) {
        continue;
      }
      visited.add(normUrl);
      pagesCrawledCount++;

      onLog(`[CRAWL] Navigating to: ${currentUrl} (${pagesCrawledCount}/${maxPages})`);
      const page = await context.newPage();

      const consoleLogs = [];
      const pageErrors = [];
      const networkErrors = [];

      // Attach browser event listeners
      page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error' || msg.type() === 'warning' || text.toLowerCase().includes('failed')) {
          consoleLogs.push(`[${msg.type().toUpperCase()}] ${text}`);
        }
      });

      page.on('pageerror', err => {
        pageErrors.push(err.stack || err.message);
      });

      page.on('requestfailed', req => {
        const failure = req.failure();
        const url = req.url();
        if (!url.includes('analytics') && !url.includes('google-analytics') && !url.includes('facebook')) {
          networkErrors.push(`${req.method()} ${url} - Reason: ${failure?.errorText || 'Unknown Connection Error'}`);
        }
      });

      try {
        // Load page, waiting for DOM content (ignoring slow CDNs/fonts/scripts)
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        onLog(`[CRAWL] Page DOM content loaded. Injecting user activity interactions...`);

        // Wait a small amount for dynamic JS rendering
        await page.waitForTimeout(3000);

        // Actively interact with buttons, likes, comments to check runtime stability
        await interactWithPageElements(page, onLog);
        
        const pageTitle = await page.title().catch(() => 'Untitled Page');

        // Take highly compressed JPEG screen capture to prevent Ollama timeouts/OOMs
        onLog(`[SYS] Capturing page layout screenshot (compressed JPEG)...`);
        const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 60 });
        const base64Image = screenshotBuffer.toString('base64');
        const dataUriScreenshot = `data:image/jpeg;base64,${base64Image}`;

        // 1. Auto-flag deterministic bugs (exceptions and failed network requests)
        let autoBugsCount = 0;
        
        if (pageErrors.length > 0) {
          for (const errText of pageErrors) {
            onBugFound({
              url: currentUrl,
              screenshot: dataUriScreenshot,
              type: 'functional',
              severity: 'critical',
              title: 'Uncaught JavaScript Exception',
              description: `An uncaught exception occurred in the page script context: "${errText.substring(0, 200)}...". This represents a serious structural failure that can block application workflows.`,
              reproductionSteps: `1. Visit page: ${currentUrl}\n2. Open browser console to observe exception stack trace.`,
              suggestedFix: `Check the console stack trace. Wrap risky asynchronous calls or property access in try-catch statements and verify variable definitions before reading fields.`
            });
            autoBugsCount++;
          }
        }

        if (networkErrors.length > 0) {
          for (const reqErr of networkErrors) {
            onBugFound({
              url: currentUrl,
              screenshot: dataUriScreenshot,
              type: 'network',
              severity: 'high',
              title: 'Failed API/Network Request',
              description: `A network request failed on the client side: "${reqErr}". This blocks page components from retrieving backend payloads.`,
              reproductionSteps: `1. Visit page: ${currentUrl}\n2. Inspect failed HTTP calls inside browser DevTools (Network tab).`,
              suggestedFix: `Ensure correct API routing and headers (e.g. CORS). Add error-boundary wrappers to handle offline/failed connections gracefully.`
            });
            autoBugsCount++;
          }
        }

        if (autoBugsCount > 0) {
          onLog(`[SYS] Deterministic analysis identified ${autoBugsCount} technical bug(s) immediately.`);
        }

        // Extract internal links for subsequent queue (handling subdomain shifts like www. redirects)
        if (pagesCrawledCount < maxPages) {
          const pageLinks = await page.evaluate((targetHost) => {
            return Array.from(document.querySelectorAll('a'))
              .map(a => a.href)
              .filter(href => {
                try {
                  const urlObj = new URL(href);
                  const linkHost = urlObj.hostname.replace('www.', '');
                  return linkHost === targetHost && !href.includes('#');
                } catch (e) {
                  return false;
                }
              });
          }, targetHost);

          onLog(`[SYS] Discovered ${pageLinks.length} internal link(s) on page.`);

          for (const link of pageLinks) {
            let normLink = link.split('#')[0];
            if (normLink.endsWith('/')) normLink = normLink.slice(0, -1);
            if (!visited.has(normLink) && !queue.includes(link)) {
              queue.push(link);
            }
          }
        }

        const promptText = `You are a professional B2B QA engineer conducting an audit of the webpage: ${currentUrl}.
Inspect the provided screenshot and technical logs recorded during the crawl.

Technical Logs:
- Console warnings/errors:
${consoleLogs.length ? consoleLogs.join('\n') : 'No errors found.'}

- Uncaught JavaScript Page Errors:
${pageErrors.length ? pageErrors.join('\n') : 'No uncaught exceptions.'}

- Failed Network Requests:
${networkErrors.length ? networkErrors.join('\n') : 'No network request failures.'}

Analyze and identify any bugs. Categorize them exactly into these types:
1. "functional": Javascript console errors, crash exceptions, non-working buttons, broken flows.
2. "visual": Text overlapping, misaligned layouts, broken graphics/image icons, container clipping, poor text readability or elements cut off.
3. "network": API request failures (500 errors, bad gateways, blocked backend endpoints).

Only report clear, genuine bugs that hurt credibility or user experience. Avoid minor subjective styling opinions (e.g. "spacing could be slightly tighter").
If no bugs are found, set "hasBugs" to false and return an empty array for "bugs".

You must respond in JSON matching the following structure (ensure it is valid JSON):
{
  "hasBugs": boolean,
  "bugs": [
    {
      "type": "functional" | "visual" | "network",
      "severity": "low" | "medium" | "high" | "critical",
      "title": "Short descriptive title of the bug",
      "description": "Clear and professional description explaining the issue and its business impact.",
      "reproductionSteps": "1. Navigate to page\\n2. Observe...\\n3. ...",
      "suggestedFix": "Detailed recommendations to resolve the issue (e.g., CSS patches, script modifications, or backend adjustments)."
    }
  ]
}`;

        // 2. AI visual reasoning analysis (wrapped in a try-catch block for complete resilience)
        try {
          onLog(`[AI] Dispatching visual layout analysis for ${currentUrl}...`);
          let resultJson;

          if (provider === 'ollama') {
            onLog(`[AI] Requesting local analysis from Ollama (${model})...`);
            
            const payload = {
              model: model || 'llama3.2-vision',
              messages: [
                {
                  role: 'user',
                  content: promptText,
                  images: [base64Image]
                }
              ],
              stream: false,
              format: 'json'
            };

            // Set request abort controller for timeout control (2 minutes max for local inference)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);

            const res = await fetch('http://127.0.0.1:11434/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
              const errText = await res.text();
              throw new Error(`Ollama connection error: ${res.statusText} - ${errText}`);
            }

            const responseData = await res.json();
            const cleanText = responseData.message?.content || '';
            resultJson = JSON.parse(cleanText);

          } else {
            onLog(`[AI] Requesting cloud analysis from Gemini (${model})...`);
            const response = await ai.models.generateContent({
              model: model || 'gemini-1.5-flash',
              contents: [
                {
                  inlineData: {
                    data: base64Image,
                    mimeType: 'image/jpeg'
                  }
                },
                promptText
              ],
              config: {
                responseMimeType: 'application/json'
              }
            });

            resultJson = JSON.parse(response.text);
          }

          if (resultJson.hasBugs && Array.isArray(resultJson.bugs)) {
            onLog(`[AI] Found ${resultJson.bugs.length} bug(s) on ${currentUrl}`);
            for (const bug of resultJson.bugs) {
              onBugFound({
                url: currentUrl,
                screenshot: dataUriScreenshot,
                ...bug
              });
            }
          } else {
            onLog(`[AI] No bugs detected on ${currentUrl}`);
          }
        } catch (aiErr) {
          onLog(`[WARNING] Visual AI analysis failed: ${aiErr.message}. The audit continues using deterministic logs.`);
        }

        // 3. Register Page Observation (Save record of visited page & screenshot for PDF output)
        if (onPageAudited) {
          onPageAudited({
            url: currentUrl,
            title: pageTitle,
            screenshot: dataUriScreenshot,
            consoleLogs,
            pageErrors,
            networkErrors
          });
        }

      } catch (err) {
        let friendlyError = err.message;
        
        // Parse Google API JSON errors to provide clean, action-oriented warnings
        if (err.message.includes('API_KEY_INVALID') || err.message.includes('UNAUTHENTICATED')) {
          friendlyError = 'Invalid Gemini API Key. Please verify the key in your .env or input field.';
        } else if (err.message.includes('API_KEY_SERVICE_BLOCKED') || err.message.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')) {
          friendlyError = 'Gemini API Key blocked or Generative Language API is disabled for this project in Google Cloud Console.';
        } else if (err.message.includes('RESOURCE_EXHAUSTED')) {
          friendlyError = 'Gemini API quota exceeded. Please wait a minute or upgrade your plan.';
        }
        
        onLog(`[ERROR] Failed to audit page ${currentUrl}: ${friendlyError}`);
      } finally {
        await page.close();
      }
    }

    onLog(`[SYS] Scan completed successfully. Visited ${pagesCrawledCount} pages.`);
  } catch (err) {
    onLog(`[CRITICAL] Crawler crashed: ${err.message}`);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Automates login on a target page.
 */
async function performLogin(page, loginUrl, username, password, onLog) {
  onLog(`[SYS] Starting automated login at: ${loginUrl}`);
  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    // Try to find email/username input
    const userSelectors = [
      'input[type="email"]',
      'input[type="text"][name*="email"]',
      'input[type="text"][name*="user"]',
      'input[name*="login"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="username" i]'
    ];
    
    let userField;
    for (const selector of userSelectors) {
      try {
        const el = await page.$(selector);
        if (el && await el.isVisible()) {
          userField = el;
          break;
        }
      } catch (e) {}
    }

    // Try to find password input
    const passField = await page.$('input[type="password"]');

    if (!userField || !passField) {
      throw new Error('Could not identify login inputs. Ensure the page has standard username and password fields.');
    }

    // Fill inputs
    await userField.fill(username);
    await passField.fill(password);
    onLog(`[SYS] Entered credentials. Submitting form...`);

    // Look for submit button
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'button:has-text("Login")',
      'button:has-text("Signin")',
      'a:has-text("Log in")',
      'a:has-text("Sign in")'
    ];

    let submitBtn;
    for (const selector of submitSelectors) {
      try {
        const el = await page.$(selector);
        if (el && await el.isVisible()) {
          submitBtn = el;
          break;
        }
      } catch (e) {}
    }

    if (!submitBtn) {
      onLog(`[SYS] Submit button not visible. Sending Enter key on password field...`);
      await passField.press('Enter');
    } else {
      await submitBtn.click();
    }

    // Wait for redirect or cookies to settle
    onLog(`[SYS] Waiting for authorization redirect...`);
    await page.waitForTimeout(5000);
    
    const currentUrl = page.url();
    if (currentUrl.includes(loginUrl) && await page.$('input[type="password"]')) {
      onLog(`[WARNING] Browser remained on login page. Session authorization might have failed.`);
    } else {
      onLog(`[SYS] Authorization completed. Redirected to: ${currentUrl}`);
    }
  } catch (err) {
    onLog(`[ERROR] Automated login failed: ${err.message}`);
    throw err;
  }
}

/**
 * Actively interacts with typical web elements (buttons, inputs, comments, likes)
 * to test application behavior under stress.
 */
async function interactWithPageElements(page, onLog) {
  onLog(`[SYS] Triggering user interaction sequence to audit dynamic actions...`);
  try {
    // Find all potential clickables (buttons, links that look like action items, likes/comments)
    const selectors = [
      'button:not([disabled])',
      '[role="button"]',
      'a.like-btn',
      'a.comment-btn',
      '.like-button',
      '.comment-button',
      '.post-card',
      '.post-item',
      '.card'
    ];

    let elements = [];
    for (const selector of selectors) {
      try {
        const found = await page.$$(selector);
        for (const el of found) {
          if (await el.isVisible() && await el.isEnabled()) {
            elements.push(el);
          }
        }
      } catch (e) {}
    }

    if (elements.length === 0) {
      onLog(`[SYS] No action buttons or clickables discovered on page layout.`);
      return;
    }

    onLog(`[SYS] Discovered ${elements.length} interactable element(s). Simulating clicks...`);

    // Click up to 4 elements
    const clickLimit = Math.min(elements.length, 4);
    for (let i = 0; i < clickLimit; i++) {
      const el = elements[i];
      try {
        const text = await el.innerText().catch(() => '');
        const tag = await el.evaluate(e => e.tagName.toLowerCase()).catch(() => 'element');
        const description = text.trim() ? `"${text.trim().substring(0, 30)}"` : `<${tag}>`;
        
        onLog(`[SYS] Simulating user click on element: ${description}`);
        
        // Use a soft timeout so a slow button click doesn't stall the crawler
        await el.click({ timeout: 5000 });
        
        // Wait briefly for network/JS events to process
        await page.waitForTimeout(2000);
      } catch (clickErr) {
        // If element is detached because of navigation, ignore and proceed
        if (clickErr.message.includes('detached') || clickErr.message.includes('navigation')) {
          onLog(`[SYS] Interaction triggered navigation or page change.`);
          break;
        }
      }
    }
  } catch (err) {
    onLog(`[WARNING] Interaction handler encountered minor error: ${err.message}`);
  }
}

/**
 * Executes a step-by-step custom scenario instruction script.
 */
async function executeCustomScenario(page, script, onLog, onBugFound) {
  onLog(`[SYS] Initiating custom scenario script execution...`);
  const lines = script.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
  
  for (const line of lines) {
    try {
      if (line.startsWith('navigate ')) {
        const url = line.replace('navigate ', '').trim();
        onLog(`[SCENARIO] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(2000);
      } 
      else if (line.startsWith('fill ') && line.includes(' with ')) {
        const parts = line.replace('fill ', '').split(' with ');
        const selector = parts[0].trim();
        const value = parts[1].trim();
        onLog(`[SCENARIO] Filling selector "${selector}" with "${value}"`);
        const el = await page.waitForSelector(selector, { timeout: 8000 });
        await el.fill(value);
      } 
      else if (line.startsWith('click ')) {
        const selector = line.replace('click ', '').trim();
        onLog(`[SCENARIO] Clicking selector: "${selector}"`);
        const el = await page.waitForSelector(selector, { timeout: 8000 });
        await el.click();
        await page.waitForTimeout(1500);
      } 
      else if (line.startsWith('wait ')) {
        const msStr = line.replace('wait ', '').replace('ms', '').trim();
        const ms = parseInt(msStr) || 2000;
        onLog(`[SCENARIO] Waiting for ${ms}ms`);
        await page.waitForTimeout(ms);
      } 
      else if (line.startsWith('assert ')) {
        const expectedText = line.replace('assert ', '').trim();
        onLog(`[SCENARIO] Asserting text visibility: "${expectedText}"`);
        const content = await page.textContent('body');
        if (!content.includes(expectedText)) {
          throw new Error(`Assertion failed: Expected text "${expectedText}" not found in page body.`);
        }
        onLog(`[SCENARIO] Assertion passed: "${expectedText}" verified.`);
      } 
      else {
        onLog(`[WARNING] Unknown scenario instruction skipped: "${line}"`);
      }
    } catch (stepErr) {
      onLog(`[ERROR] Step failed: "${line}" - ${stepErr.message}`);
      // Record a functional bug for scenario failure
      const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null);
      const dataUri = screenshotBuffer ? `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}` : '';
      
      onBugFound({
        url: page.url(),
        screenshot: dataUri,
        type: 'functional',
        severity: 'high',
        title: `Custom Test Script Step Failure`,
        description: `The custom QA scenario instruction failed at step: "${line}". Error: ${stepErr.message}. This indicates a broken user path or functional logic failure.`,
        reproductionSteps: `Run custom script:\n${script}`,
        suggestedFix: `Inspect elements on the page matching selector or text assertions. Check page state transitions to ensure the element is visible and interactive at this step.`
      });
      throw stepErr; // Halt script execution on failure
    }
  }
  onLog(`[SYS] Custom scenario script executed successfully.`);
}
