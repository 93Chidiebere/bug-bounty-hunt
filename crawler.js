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
  model = 'gemini-3.7-flash', 
  loginUrl = '',
  loginUser = '',
  loginPass = '',
  testScenario = '',
  fuzzInputs = false,
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

    const queue = [startUrl];
    const visited = new Set();
    const origin = new URL(startUrl).origin;
    const targetHost = new URL(startUrl).hostname.replace('www.', '');
    let pagesCrawledCount = 0;

    // Reuse a single page tab to preserve sessionStorage, login state, and optimize performance
    const page = await context.newPage();

    const consoleLogs = [];
    const pageErrors = [];
    const networkErrors = [];
    const scriptUrls = [];

    // Intercept and record loaded scripts (Static Secret Scanner)
    page.on('response', response => {
      const url = response.url();
      const request = response.request();
      if (request.resourceType() === 'script' && url.startsWith(origin)) {
        scriptUrls.push(url);
      }
    });

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

    // Authenticate the main page directly if credentials are provided
    if (loginUrl && loginUser) {
      try {
        await performLogin(page, loginUrl, loginUser, loginPass, onLog);
        const finalLoginUrl = page.url();
        if (!queue.includes(finalLoginUrl)) {
          queue.push(finalLoginUrl);
        }
        // Capture authenticated session storage state (cookies + local storage)
        const statePath = 'auth_state.json';
        await context.storageState({ path: statePath });
        onLog(`[SYS] Authenticated storage state successfully serialized to ${statePath}`);
      } catch (err) {
        onLog(`[WARNING] Login failed: ${err.message}. Auditing site without session auth.`);
      }
    }

    // Run Custom Step-by-Step Scenario Script or Goal-Driven Agentic QA directly on the same page tab
    if (testScenario) {
      try {
        // Differentiate if the input represents a structured script or a natural language goal
        const isScripted = testScenario.split('\n').some(line => {
          const l = line.trim().toLowerCase();
          return l.startsWith('navigate ') || l.startsWith('fill ') || l.startsWith('click ') || l.startsWith('wait ') || l.startsWith('assert ');
        });

        if (isScripted) {
          onLog(`[SYS] Detected structured scenario script. Running custom script runner...`);
          await executeCustomScenario(page, testScenario, onLog, onBugFound);
        } else {
          onLog(`[SYS] Detected natural language objective. Running autonomous Agentic QA Loop...`);
          await executeAgenticScenario(page, testScenario, loginUser, loginPass, onLog, onBugFound, ai, provider, model);
        }

        const finalUrl = page.url();
        if (!queue.includes(finalUrl)) {
          onLog(`[SYS] Adding scenario final destination to crawl queue: ${finalUrl}`);
          queue.unshift(finalUrl);
        }
      } catch (err) {
        onLog(`[WARNING] Scenario execution aborted. Resuming default crawl.`);
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
      
      // Clear logs and assets from previous page crawl iteration
      consoleLogs.length = 0;
      pageErrors.length = 0;
      networkErrors.length = 0;
      scriptUrls.length = 0;

      try {
        // Load page, waiting for DOM content (ignoring slow CDNs/fonts/scripts)
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        onLog(`[CRAWL] Page DOM content loaded. Injecting user activity interactions...`);

        // Wait a small amount for dynamic JS rendering
        await page.waitForTimeout(3000);

        // Actively interact with buttons, likes, comments to check runtime stability
        await interactWithPageElements(page, onLog);
        
        // Perform boundary fuzzing on discovered input forms if enabled (Phase 2)
        if (fuzzInputs) {
          await executeFunctionalInputFuzzer(page, onLog);
        }
        
        const pageTitle = await page.title().catch(() => 'Untitled Page');

        // Take highly compressed JPEG screen capture to prevent Ollama timeouts/OOMs
        onLog(`[SYS] Capturing page layout screenshot (compressed JPEG)...`);
        const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 60 });
        const base64Image = screenshotBuffer.toString('base64');
        const dataUriScreenshot = `data:image/jpeg;base64,${base64Image}`;

        // 1. Check for "Blank Screen" startup crash (React rendering check)
        const innerText = await page.evaluate(() => document.body.innerText).catch(() => '');
        if (innerText.trim().length === 0) {
          onLog(`[CRITICAL] Blank Page Crash detected on: ${currentUrl}`);
          onBugFound({
            url: currentUrl,
            screenshot: dataUriScreenshot,
            type: 'functional',
            severity: 'critical',
            title: 'Blank Screen / React Mount Crash',
            description: `The page loaded successfully (HTTP 200 OK) but rendered a completely blank screen (body contains no text). This typically indicates that an uncaught JavaScript error crashed the application during mounting.`,
            reproductionSteps: `1. Visit page: ${currentUrl}\n2. Verify that the viewport remains entirely empty and displays no layout components.`,
            suggestedFix: `Inspect the browser console logs for uncaught exceptions, module path resolution errors, or React/Next.js hydration mismatch failures.`
          });
        }

        // 2. Scan public loaded script bundles for exposed secret keys (Static Script Secrets Auditor)
        if (scriptUrls.length > 0) {
          onLog(`[SYS] Auditing ${scriptUrls.length} public JavaScript bundle(s) for exposed credentials...`);
          for (const sUrl of scriptUrls) {
            try {
              const scriptRes = await fetch(sUrl).catch(() => null);
              if (scriptRes && scriptRes.ok) {
                const text = await scriptRes.text();
                const patterns = [
                  { name: 'Paystack Secret Key', regex: /sk_(live|test)_[a-fA-F0-9]{40}/g },
                  { name: 'Flutterwave Secret Key', regex: /FLWSECK(_TEST)?-[a-fA-F0-9]{32}-X/g },
                  { name: 'Stripe Secret Key', regex: /sk_(live|test)_[0-9a-zA-Z]{24}/g },
                  { name: 'Google Cloud/Studio API Key', regex: /AIzaSy[0-9a-zA-Z-_]{33}/g }
                ];

                for (const pattern of patterns) {
                  const matches = text.match(pattern.regex);
                  if (matches) {
                    onLog(`[CRITICAL] Security Alert: Exposed ${pattern.name} detected in script: ${sUrl}`);
                    for (const match of matches) {
                      const redacted = match.substring(0, 8) + '...' + match.substring(match.length - 4);
                      onBugFound({
                        url: currentUrl,
                        screenshot: dataUriScreenshot,
                        type: 'functional',
                        severity: 'critical',
                        title: `Exposed Private API Secret Key`,
                        description: `A private backend API credential (${pattern.name}: ${redacted}) was found exposed in the public frontend JavaScript bundle: ${sUrl}. An attacker can harvest this key and perform unauthorized API actions.`,
                        reproductionSteps: `1. Open source code of script: ${sUrl}\n2. Search for pattern matching: ${pattern.name}`,
                        suggestedFix: `Immediately revoke/rotate the leaked key. Do not reference private keys (starting with sk_) in client-side code. Route transactions through secure server-side controllers and use public keys (starting with pk_) for client integrations.`
                      });
                    }
                  }
                }
              }
            } catch (scriptErr) {
              // Ignore network or parsing failures
            }
          }
        }

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
            const response = await callGeminiWithFallback(
              ai,
              model || 'gemini-3.7-flash',
              [
                {
                  inlineData: {
                    data: base64Image,
                    mimeType: 'image/jpeg'
                  }
                },
                promptText
              ],
              {
                responseMimeType: 'application/json'
              },
              onLog
            );

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
      }
    }

    await page.close().catch(() => {});

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
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    onLog(`[SYS] Probing login form structure (checking for single-step or progressive authentication)...`);

    // 1. Identify user/email field (always present upfront)
    let userField;
    const userLocators = [
      page.getByPlaceholder(/email/i),
      page.getByPlaceholder(/username/i),
      page.getByPlaceholder(/identifier/i),
      page.getByLabel(/email/i),
      page.getByLabel(/username/i),
      page.locator('input[type="email"]'),
      page.locator('input[type="text"][name*="email"]'),
      page.locator('input[type="text"][name*="user"]')
    ];

    for (const loc of userLocators) {
      try {
        if (await loc.count() > 0 && await loc.first().isVisible()) {
          userField = loc.first();
          break;
        }
      } catch (e) {}
    }

    if (!userField) {
      userField = await page.waitForSelector('input[type="email"], input[type="text"]', { state: 'visible', timeout: 6000 })
        .catch(() => null);
    }

    // Heuristic Fallback: If no username field is found, check if there is an entry button (e.g. "Start Teaching", "Sign In", "Log In") on screen to navigate to the auth page
    if (!userField) {
      onLog(`[SYS] No inputs found on current page. Probing page for entry/login button triggers...`);
      const entryTriggers = [
        page.getByRole('button', { name: /start teaching/i }),
        page.getByRole('button', { name: /log in/i }),
        page.getByRole('button', { name: /sign in/i }),
        page.getByRole('button', { name: /get started/i }),
        page.locator('button:has-text("Sign In")'),
        page.locator('button:has-text("Log In")'),
        page.locator('button:has-text("Start Teaching")'),
        page.locator('a:has-text("Sign In")'),
        page.locator('a:has-text("Log In")'),
        page.locator('a:has-text("Start Teaching")')
      ];

      let entryBtn = null;
      for (const trigger of entryTriggers) {
        try {
          if (await trigger.count() > 0 && await trigger.first().isVisible()) {
            entryBtn = trigger.first();
            break;
          }
        } catch (e) {}
      }

      if (entryBtn) {
        onLog(`[SYS] Entry trigger button found ("${await entryBtn.innerText().catch(() => 'Button')}"). Clicking to open form...`);
        await entryBtn.click();
        await page.waitForTimeout(4000);

        // Re-probe for user input field
        for (const loc of userLocators) {
          try {
            if (await loc.count() > 0 && await loc.first().isVisible()) {
              userField = loc.first();
              break;
            }
          } catch (e) {}
        }
        if (!userField) {
          userField = await page.waitForSelector('input[type="email"], input[type="text"]', { state: 'visible', timeout: 10000 })
            .catch(() => null);
        }
      }
    }

    if (!userField) {
      throw new Error('Unable to find username/email input field on screen.');
    }

    // 2. Check if the password field is immediately visible (Single-Step Form Heuristic)
    let passField = page.locator('input[type="password"]').first();
    const isSingleStep = passField && await passField.isVisible().catch(() => false);

    if (isSingleStep) {
      onLog(`[SYS] Single-step login form isolated. Filling credentials...`);
      await userField.fill(username);
      await passField.fill(password);
    } 
    else {
      // 3. Progressive Multi-Step Login Recovery Ladder
      onLog(`[SYS] Password field hidden. Executing progressive step-1 (Username/Email submission)...`);
      await userField.fill(username);

      // Search for Next / Continue triggers
      const nextLocators = [
        page.getByRole('button', { name: /continue/i }),
        page.getByRole('button', { name: /next/i }),
        page.getByRole('button', { name: /sign in/i }),
        page.getByRole('button', { name: /log in/i }),
        page.locator('button[type="submit"]'),
        page.locator('button:has-text("Next")'),
        page.locator('button:has-text("Continue")')
      ];

      let nextBtn = null;
      for (const loc of nextLocators) {
        try {
          if (await loc.count() > 0 && await loc.first().isVisible()) {
            nextBtn = loc.first();
            break;
          }
        } catch (e) {}
      }

      if (nextBtn) {
        onLog(`[SYS] Clicking progressive Next/Continue button...`);
        await nextBtn.click();
      } else {
        onLog(`[SYS] No progressive button found. Pressing Enter on identifier field...`);
        await userField.press('Enter');
      }

      onLog(`[SYS] Step 1 submitted. Waiting for password input field to render...`);
      passField = await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 25000 })
        .catch(() => null);

      if (passField) {
        onLog(`[SYS] Password field rendered. Filling password...`);
        await passField.fill(password);
      } else {
        // Double fallback: check if we need to click a secondary login option
        onLog(`[SYS] Password field failed to render. Probing for alternative Sign In modal/tab triggers...`);
        const modalTriggers = [
          page.getByText(/sign in with email/i),
          page.getByRole('button', { name: /sign in/i })
        ];
        
        for (const trigger of modalTriggers) {
          try {
            if (await trigger.count() > 0 && await trigger.first().isVisible()) {
              await trigger.first().click();
              await page.waitForTimeout(3000);
              break;
            }
          } catch (e) {}
        }
        
        passField = await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 15000 });
        await passField.fill(password);
      }
    }

    // 4. Submit completed form
    onLog(`[SYS] Submitting completed login credentials...`);
    const submitLocators = [
      page.getByRole('button', { name: /log in/i }),
      page.getByRole('button', { name: /sign in/i }),
      page.getByRole('button', { name: /submit/i }),
      page.locator('button[type="submit"]'),
      page.locator('input[type="submit"]')
    ];

    let submitBtn;
    for (const loc of submitLocators) {
      try {
        if (await loc.count() > 0 && await loc.first().isVisible()) {
          submitBtn = loc.first();
          break;
        }
      } catch (e) {}
    }

    if (!submitBtn) {
      onLog(`[SYS] Submit button not visible. Sending Enter key press on password field...`);
      await passField.press('Enter');
    } else {
      await submitBtn.click();
    }

    // 5. Verify authorization redirect
    onLog(`[SYS] Waiting for authorization redirect...`);
    await page.waitForTimeout(6000);
    
    const currentUrl = page.url();
    if (currentUrl.includes(loginUrl) && await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
      throw new Error(`Browser remained on login page. Session authorization might have failed. Consider using the 'Custom QA Scenario' field to write custom login interactions if this app uses CAPTCHAs or OTP gates.`);
    } else {
      onLog(`[SYS] Authorization completed. Redirected to: ${currentUrl}`);
    }
  } catch (err) {
    onLog(`[ERROR] Automated login failed: ${err.message}`);
    
    // Capture login failure screen state for troubleshooting
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50 }).catch(() => null);
    if (screenshotBuffer) {
      onLog(`[SYS] Captured automated login failure state diagnostic.`);
    }
    
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
        
        let el;
        // Check if selector is written as a user-visible string (e.g. "Email Address")
        if (selector.startsWith('"') && selector.endsWith('"')) {
          const labelVal = selector.slice(1, -1);
          el = page.getByPlaceholder(labelVal).first();
          if (await el.count() === 0) {
            el = page.getByLabel(labelVal).first();
          }
        }
        
        if (!el || await el.count() === 0) {
          el = page.locator(selector).first();
        }
        
        await el.waitFor({ state: 'visible', timeout: 20000 });
        await el.fill(value);
      } 
      else if (line.startsWith('click ')) {
        const selector = line.replace('click ', '').trim();
        onLog(`[SCENARIO] Clicking selector: "${selector}"`);
        
        let el;
        // Check if selector is written as a user-visible button string (e.g. "Submit")
        if (selector.startsWith('"') && selector.endsWith('"')) {
          const textVal = selector.slice(1, -1);
          el = page.getByRole('button', { name: new RegExp(textVal, 'i') }).first();
          if (await el.count() === 0) {
            el = page.getByText(textVal).first();
          }
        }
        
        if (!el || await el.count() === 0) {
          el = page.locator(selector).first();
        }
        
        await el.waitFor({ state: 'visible', timeout: 20000 });
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

/**
 * Automatically discovers form inputs and injects boundary values (Phase 2 - Boundary Fuzzing)
 * to test server validation limits and check for runtime errors.
 */
async function executeFunctionalInputFuzzer(page, onLog) {
  onLog(`[SYS] Initiating functional input boundary audits...`);
  try {
    const forms = await page.$$('form');
    if (forms.length === 0) {
      onLog(`[SYS] No forms discovered on this page layout.`);
      return;
    }

    onLog(`[SYS] Discovered ${forms.length} form(s) to audit.`);
    
    // Audit the primary/first form on the page to maintain crawl efficiency
    const form = forms[0];
    const inputs = await form.$$('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"])');
    
    if (inputs.length === 0) {
      onLog(`[SYS] Form contains no editable input elements.`);
      return;
    }

    onLog(`[SYS] Fuzzing ${inputs.length} input field(s) with boundary values...`);

    for (const input of inputs) {
      try {
        const type = await input.getAttribute('type').catch(() => 'text') || 'text';
        const name = await input.getAttribute('name').catch(() => '') || 'input';
        
        if (type === 'number') {
          onLog(`[SYS] Fuzzing numeric field "${name}" with letters (NotANumber)...`);
          await input.fill('NotANumber');
        } else if (type === 'email') {
          onLog(`[SYS] Fuzzing email field "${name}" with invalid address syntax...`);
          await input.fill('not-a-valid-email');
        } else {
          onLog(`[SYS] Fuzzing text field "${name}" with 350-character string overflow...`);
          await input.fill('A'.repeat(350));
        }
      } catch (inputErr) {
        // Ignore single field errors (element hidden or readonly)
      }
    }

    // Attempt to submit the form
    const submitBtn = await form.$('button[type="submit"], input[type="submit"]').catch(() => null);
    if (submitBtn) {
      onLog(`[SYS] Submitting fuzzed form inputs...`);
      await submitBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      onLog(`[SYS] No submit button found. Sending Enter key press on input...`);
      if (inputs.length > 0) {
        await inputs[0].press('Enter').catch(() => {});
        await page.waitForTimeout(2000);
      }
    }
  } catch (err) {
    onLog(`[WARNING] Input fuzzer encountered error: ${err.message}`);
  }
}

/**
 * Executes a goal-driven autonomous user navigation sequence (Agentic Loop).
 * Uses VLM (Gemini Cloud or Ollama Local) to reason about layout coordinates and click/type.
 */
async function executeAgenticScenario(page, goal, username, password, onLog, onBugFound, ai, provider, model) {
  onLog(`[AGENT] Starting autonomous goal-driven session: "${goal}"`);
  
  let steps = 0;
  const maxSteps = 12;
  let isComplete = false;

  while (!isComplete && steps < maxSteps) {
    steps++;
    onLog(`[AGENT] Step ${steps}: Perceiving page layout...`);

    // Capture current screenshot to feed to the VLM
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50 }).catch(() => null);
    const base64Image = screenshotBuffer ? screenshotBuffer.toString('base64') : '';

    // Extract interactive elements from DOM to compile clear instructions for VLM
    const elementsInfo = await page.evaluate(() => {
      const interactables = Array.from(document.querySelectorAll('input, button, a, [role="button"]'));
      return interactables.map((el, i) => {
        const text = el.innerText || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute('type') || '';
        const id = el.id || '';
        const className = el.className || '';
        
        let selector = '';
        if (id) {
          selector = `#${id}`;
        } else if (tag === 'input' && el.getAttribute('name')) {
          selector = `input[name="${el.getAttribute('name')}"]`;
        } else if (text.trim()) {
          selector = `${tag}:has-text("${text.trim().substring(0, 30)}")`;
        } else {
          selector = `${tag}.${className.split(' ').filter(Boolean).join('.')}`;
        }

        return {
          index: i,
          tag,
          type,
          text: text.trim().substring(0, 60),
          selector
        };
      }).filter(el => el.text || el.tag === 'input');
    });

    const currentUrl = page.url();
    const promptText = `You are an autonomous QA agent testing the website: ${currentUrl}.
Your objective: "${goal}"
Credentials you can use if needed:
- Username/Email: ${username}
- Password: ${password}

Here is a list of interactive elements discovered on the page:
${JSON.stringify(elementsInfo, null, 2)}

Choose the single next logical action to reach the objective. You must return your choice in a strict JSON format matching this schema:
{
  "action": "click" | "fill" | "wait" | "complete" | "fail",
  "selector": "exact selector string from list",
  "value": "text to fill (only for fill action)",
  "reason": "brief explanation of your decision"
}

Notes:
- Use "complete" when the objective is fully satisfied (e.g. dashboard is visible, final screen loaded).
- Use "fail" if the page contains a crash, an error message blocking the objective, or you get stuck.
- Return ONLY the raw JSON block. No markdown, no explainers.`;

    let actionJson = null;
    try {
      if (provider === 'ollama') {
        onLog(`[AGENT] Requesting local reasoning from Ollama (llava)...`);
        const payload = {
          model: 'llava',
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

        const res = await fetch('http://127.0.0.1:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error(`Ollama connection error: ${res.statusText}`);
        }

        const data = await res.json();
        const text = data.message?.content || '';
        actionJson = JSON.parse(text.trim());
      } else {
        if (!ai) {
          throw new Error('Cloud AI provider (Gemini) is required but not initialized.');
        }
        onLog(`[AGENT] Requesting cloud reasoning from Gemini (${model})...`);
        const response = await callGeminiWithFallback(
          ai,
          model || 'gemini-3.7-flash',
          [
            {
              inlineData: {
                data: base64Image,
                mimeType: 'image/jpeg'
              }
            },
            {
              text: promptText
            }
          ],
          {
            responseMimeType: 'application/json'
          },
          onLog
        );

        const rawText = response.text || '';
        actionJson = JSON.parse(rawText.trim());
      }
    } catch (aiErr) {
      onLog(`[ERROR] Agent planning failed: ${aiErr.message}`);
      break;
    }

    if (!actionJson) {
      onLog(`[ERROR] Agent returned invalid action JSON.`);
      break;
    }

    onLog(`[AGENT] Plan: ${actionJson.reason}`);

    if (actionJson.action === 'complete') {
      onLog(`[AGENT] Goal successfully completed!`);
      isComplete = true;
      break;
    }

    if (actionJson.action === 'fail') {
      onLog(`[CRITICAL] Agent declared goal failure: ${actionJson.reason}`);
      onBugFound({
        url: currentUrl,
        screenshot: base64Image ? `data:image/jpeg;base64,${base64Image}` : '',
        type: 'functional',
        severity: 'high',
        title: `Autonomous Scenario Failure`,
        description: `The autonomous agent failed to complete the goal: "${goal}". Reason: ${actionJson.reason}`,
        reproductionSteps: `Run goal-driven agent with objective: "${goal}"`,
        suggestedFix: `Inspect target page elements to ensure standard layout semantics or fix functional defects blocking user flows.`
      });
      break;
    }

    try {
      if (actionJson.action === 'click') {
        onLog(`[AGENT] Action: Clicking element: ${actionJson.selector}`);
        try {
          await page.click(actionJson.selector, { timeout: 15000 });
          await page.waitForTimeout(2000);
        } catch (clickErr) {
          onLog(`[AGENT] Click failed. Running recovery: Pausing 3s for animations and retrying...`);
          await page.waitForTimeout(3000);
          await page.click(actionJson.selector, { timeout: 15000 });
          await page.waitForTimeout(2000);
        }
      } 
      else if (actionJson.action === 'fill') {
        onLog(`[AGENT] Action: Filling input: ${actionJson.selector}`);
        try {
          const field = page.locator(actionJson.selector).first();
          await field.focus();
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await field.fill(actionJson.value, { timeout: 15000 });
        } catch (fillErr) {
          onLog(`[AGENT] Fill failed. Running recovery: Re-focusing and typing slowly...`);
          const field = page.locator(actionJson.selector).first();
          await field.focus();
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.type(actionJson.selector, actionJson.value, { delay: 100 });
        }
      } 
      else if (actionJson.action === 'wait') {
        const waitMs = parseInt(actionJson.value) || 3000;
        onLog(`[AGENT] Action: Waiting for ${waitMs}ms...`);
        await page.waitForTimeout(waitMs);
      }
    } catch (execErr) {
      onLog(`[WARNING] Action execution failed: ${execErr.message}. Retrying next step.`);
    }
  }

  if (!isComplete && steps >= maxSteps) {
    onLog(`[WARNING] Agent reached maximum step execution limit (${maxSteps}) before achieving goal.`);
  }
}

/**
 * Robust helper that attempts to call the primary model,
 * and rolls back to standard alternatives on error.
 */
async function callGeminiWithFallback(ai, primaryModel, contents, config, onLog) {
  const fallbacks = [
    primaryModel,
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;
  for (const modelName of fallbacks) {
    try {
      if (modelName !== primaryModel) {
        onLog(`[AI] Primary model failed or unavailable. Retrying with fallback: ${modelName}...`);
      }
      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config
      });
      return response;
    } catch (err) {
      lastError = err;
      onLog(`[WARNING] Gemini model ${modelName} call failed: ${err.message}`);
    }
  }
  throw lastError || new Error('All fallback models exhausted.');
}
