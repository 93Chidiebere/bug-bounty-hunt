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
export async function runQAEngine({ startUrl, geminiApiKey, onLog, onBugFound, maxPages = 5 }) {
  let browser;
  try {
    onLog(`[SYS] Initializing Gemini AI client...`);
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    onLog(`[SYS] Launching headless browser...`);
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 B2B-QA-Agent/1.0'
    });

    const queue = [startUrl];
    const visited = new Set();
    const origin = new URL(startUrl).origin;
    let pagesCrawledCount = 0;

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
        // Catch warning and error logs specifically
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
        // Ignore noise like analytics/tracking trackers that block commonly
        if (!url.includes('analytics') && !url.includes('google-analytics') && !url.includes('facebook')) {
          networkErrors.push(`${req.method()} ${url} - Reason: ${failure?.errorText || 'Unknown Connection Error'}`);
        }
      });

      try {
        // Load the page
        await page.goto(currentUrl, { waitUntil: 'load', timeout: 25000 });
        onLog(`[CRAWL] Page load completed. Injecting interactions...`);

        // Wait a small amount for dynamic JS rendering
        await page.waitForTimeout(3000);

        // Take screen capture
        onLog(`[SYS] Capturing page layout screenshot...`);
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        const base64Image = screenshotBuffer.toString('base64');

        // Extract internal links for subsequent queue
        if (pagesCrawledCount < maxPages) {
          const pageLinks = await page.evaluate((originUrl) => {
            return Array.from(document.querySelectorAll('a'))
              .map(a => a.href)
              .filter(href => {
                try {
                  const urlObj = new URL(href);
                  return urlObj.origin === originUrl && !href.includes('#');
                } catch (e) {
                  return false;
                }
              });
          }, origin);

          for (const link of pageLinks) {
            let normLink = link.split('#')[0];
            if (normLink.endsWith('/')) normLink = normLink.slice(0, -1);
            if (!visited.has(normLink) && !queue.includes(link)) {
              queue.push(link);
            }
          }
        }

        // Run Gemini Analysis
        onLog(`[AI] Running visual & logical analysis on ${currentUrl}...`);

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

You must respond in JSON matching the following structure:
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

        const response = await ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: [
            {
              inlineData: {
                data: base64Image,
                mimeType: 'image/png'
              }
            },
            promptText
          ],
          config: {
            responseMimeType: 'application/json'
          }
        });

        const resultJson = JSON.parse(response.text);

        if (resultJson.hasBugs && Array.isArray(resultJson.bugs)) {
          onLog(`[AI] Found ${resultJson.bugs.length} bug(s) on ${currentUrl}`);
          for (const bug of resultJson.bugs) {
            onBugFound({
              url: currentUrl,
              screenshot: `data:image/png;base64,${base64Image}`,
              ...bug
            });
          }
        } else {
          onLog(`[AI] No bugs detected on ${currentUrl}`);
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
