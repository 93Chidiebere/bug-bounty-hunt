// DOM Elements
const auditForm = document.getElementById('audit-form');
const targetUrlInput = document.getElementById('target-url');
const apiKeyInput = document.getElementById('api-key');
const maxPagesInput = document.getElementById('max-pages');
const maxPagesVal = document.getElementById('max-pages-val');
const submitBtn = document.getElementById('submit-btn');
const submitSpinner = submitBtn.querySelector('.spinner');
const submitText = submitBtn.querySelector('span:first-child');
const consoleLogs = document.getElementById('console-logs');
const statusDot = document.getElementById('status-dot');
const bugsContainer = document.getElementById('bugs-container');
const emptyState = document.getElementById('empty-state');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const bugModal = document.getElementById('bug-modal');
const modalBodyContent = document.getElementById('modal-body-content');
const printBugsList = document.getElementById('print-bugs-list');
const printMetaText = document.getElementById('print-meta-text');

let activeEventSource = null;
let foundBugs = [];
let targetUrl = '';

// Update page slider indicator
maxPagesInput.addEventListener('input', (e) => {
  maxPagesVal.textContent = `${e.target.value} page${e.target.value > 1 ? 's' : ''}`;
});

// Start Audit submit handler
auditForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Clean up previous scan states
  if (activeEventSource) {
    activeEventSource.close();
  }
  
  foundBugs = [];
  targetUrl = targetUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  const maxPages = maxPagesInput.value;
  
  // UI resets
  consoleLogs.innerHTML = '';
  // Remove existing bug cards, leave empty state hidden
  const bugCards = bugsContainer.querySelectorAll('.bug-card');
  bugCards.forEach(card => card.remove());
  emptyState.classList.add('hidden');
  
  // Set console status to active
  statusDot.className = 'console-status-dot active';
  
  // Disable Form inputs
  setFormDisabled(true);
  
  addLogMessage('[SYS] Requesting scan creation from backend...', 'sys');
  
  try {
    const response = await fetch('/api/start-scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: targetUrl, apiKey, maxPages })
    });
    
    const result = await response.json();
    
    if (!response.ok || result.error) {
      throw new Error(result.error || 'Failed to start audit.');
    }
    
    const scanId = result.scanId;
    addLogMessage(`[SYS] Session initialized: ID ${scanId}. Starting event listener...`, 'sys');
    
    // Subscribe to SSE stream
    setupSSE(scanId);
    
  } catch (err) {
    addLogMessage(`[CRITICAL] Initialisation failed: ${err.message}`, 'critical');
    statusDot.className = 'console-status-dot failed';
    setFormDisabled(false);
    emptyState.classList.remove('hidden');
  }
});

// Establish SSE connection
function setupSSE(scanId) {
  activeEventSource = new EventSource(`/api/scan-status?scanId=${scanId}`);
  
  activeEventSource.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    
    // Categorize log line style
    let category = 'sys';
    if (data.message.includes('[CRAWL]')) category = 'crawl';
    else if (data.message.includes('[AI]')) category = 'ai';
    else if (data.message.includes('[ERROR]')) category = 'error';
    else if (data.message.includes('[CRITICAL]')) category = 'critical';
    
    addLogMessage(data.message, category);
  });
  
  activeEventSource.addEventListener('bug', (e) => {
    const bug = JSON.parse(e.data);
    foundBugs.push(bug);
    
    // Hide empty state
    emptyState.classList.add('hidden');
    
    // Render the bug card
    renderBugCard(bug);
    
    // Enable PDF button
    exportPdfBtn.removeAttribute('disabled');
  });
  
  activeEventSource.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    if (data.status === 'completed') {
      addLogMessage('[SYS] Audit scan successfully completed.', 'sys');
      statusDot.className = 'console-status-dot idle';
      finalizeScan();
    } else if (data.status === 'failed') {
      addLogMessage(`[CRITICAL] Audit scan aborted: ${data.error || 'Internal error'}`, 'critical');
      statusDot.className = 'console-status-dot failed';
      finalizeScan();
    }
  });
  
  activeEventSource.onerror = (err) => {
    // SSE will automatically try to reconnect or close when server terminates session
    activeEventSource.close();
  };
}

// Log line helper
function addLogMessage(message, category) {
  const logRow = document.createElement('div');
  logRow.className = 'log-row';
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = new Date().toLocaleTimeString();
  
  const msgSpan = document.createElement('span');
  msgSpan.className = `log-msg-${category}`;
  msgSpan.textContent = message;
  
  logRow.appendChild(timeSpan);
  logRow.appendChild(msgSpan);
  consoleLogs.appendChild(logRow);
  
  // Auto-scroll to bottom of logs
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// Finalize and re-enable form
function finalizeScan() {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
  setFormDisabled(false);
  
  if (foundBugs.length === 0) {
    emptyState.classList.remove('hidden');
    exportPdfBtn.setAttribute('disabled', 'true');
  }
}

// Helper to disable form elements
function setFormDisabled(disabled) {
  targetUrlInput.disabled = disabled;
  apiKeyInput.disabled = disabled;
  maxPagesInput.disabled = disabled;
  
  if (disabled) {
    submitSpinner.classList.remove('hidden');
    submitText.textContent = 'Auditing Application...';
    submitBtn.style.opacity = '0.7';
    submitBtn.style.pointerEvents = 'none';
  } else {
    submitSpinner.classList.add('hidden');
    submitText.textContent = 'Run Security & Functional Audit';
    submitBtn.style.opacity = '1';
    submitBtn.style.pointerEvents = 'auto';
  }
}

// Render bug findings cards
function renderBugCard(bug) {
  const card = document.createElement('div');
  card.className = 'bug-card';
  
  // Setup click handler to view modal
  card.addEventListener('click', () => openBugModal(bug));
  
  const infoSection = document.createElement('div');
  infoSection.className = 'bug-main-info';
  
  const meta = document.createElement('div');
  meta.className = 'bug-meta';
  
  const typeBadge = document.createElement('span');
  typeBadge.className = 'badge badge-type';
  typeBadge.textContent = bug.type;
  
  const severityBadge = document.createElement('span');
  severityBadge.className = `badge severity-${bug.severity}`;
  severityBadge.textContent = bug.severity;
  
  meta.appendChild(typeBadge);
  meta.appendChild(severityBadge);
  
  const title = document.createElement('h3');
  title.className = 'bug-title';
  title.textContent = bug.title;
  
  const url = document.createElement('div');
  url.className = 'bug-url';
  url.textContent = bug.url;
  
  const desc = document.createElement('p');
  desc.className = 'bug-desc';
  desc.textContent = bug.description;
  
  infoSection.appendChild(meta);
  infoSection.appendChild(title);
  infoSection.appendChild(url);
  infoSection.appendChild(desc);
  
  const imgSection = document.createElement('div');
  
  const img = document.createElement('img');
  img.className = 'bug-preview-img';
  img.src = bug.screenshot;
  img.alt = bug.title;
  
  imgSection.appendChild(img);
  
  card.appendChild(infoSection);
  card.appendChild(imgSection);
  
  bugsContainer.appendChild(card);
}

// Open modal for a specific bug
function openBugModal(bug) {
  // Format reproduction steps
  const stepsHtml = bug.reproductionSteps
    .split('\n')
    .map(step => `<li>${escapeHtml(step.replace(/^\d+\.\s*/, ''))}</li>`)
    .join('');
    
  modalBodyContent.innerHTML = `
    <div class="detail-grid">
      <div class="detail-visual">
        <label>Visual Catch Screen Capture</label>
        <img class="detail-full-img" src="${bug.screenshot}" alt="${escapeHtml(bug.title)}">
      </div>
      <div class="detail-info">
        <div class="detail-header-info">
          <div class="bug-meta">
            <span class="badge badge-type">${escapeHtml(bug.type)}</span>
            <span class="badge severity-${bug.severity}">${escapeHtml(bug.severity)}</span>
          </div>
          <h3 class="detail-title">${escapeHtml(bug.title)}</h3>
          <div class="bug-url">${escapeHtml(bug.url)}</div>
        </div>
        
        <div class="detail-block">
          <h4>Description & Impact</h4>
          <p>${escapeHtml(bug.description)}</p>
        </div>
        
        <div class="detail-block">
          <h4>Steps to Reproduce</h4>
          <ol>${stepsHtml}</ol>
        </div>
        
        <div class="detail-block">
          <h4>Suggested Code Correction</h4>
          <pre class="code-block"><code>${escapeHtml(bug.suggestedFix)}</code></pre>
        </div>
      </div>
    </div>
  `;
  
  bugModal.classList.add('open');
}

function closeModal() {
  bugModal.classList.remove('open');
}

// Helper to escape HTML characters
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// PDF Print Export (Compiles bugs in paper-friendly formatting)
exportPdfBtn.addEventListener('click', () => {
  if (foundBugs.length === 0) return;
  
  // Set metadata
  printMetaText.textContent = `Target Domain: ${targetUrl} | Audit Date: ${new Date().toLocaleDateString()}`;
  
  printBugsList.innerHTML = '';
  
  foundBugs.forEach((bug, index) => {
    const bugItem = document.createElement('div');
    bugItem.className = 'print-bug-item';
    
    // Compile steps
    const steps = bug.reproductionSteps
      .split('\n')
      .map(step => `<li>${escapeHtml(step.replace(/^\d+\.\s*/, ''))}</li>`)
      .join('');
      
    bugItem.innerHTML = `
      <h3 class="print-bug-title">${index + 1}. ${escapeHtml(bug.title)}</h3>
      <div class="print-bug-meta">
        <strong>URL:</strong> ${escapeHtml(bug.url)} | 
        <strong>Type:</strong> ${escapeHtml(bug.type)} | 
        <strong>Severity:</strong> ${escapeHtml(bug.severity)}
      </div>
      <div class="print-bug-desc">
        <strong>Description:</strong> ${escapeHtml(bug.description)}
      </div>
      <div class="print-bug-desc">
        <strong>Reproduction Steps:</strong>
        <ol class="print-bug-steps">${steps}</ol>
      </div>
      <div>
        <strong>Suggested Remediation:</strong>
        <pre class="print-bug-fix"><code>${escapeHtml(bug.suggestedFix)}</code></pre>
      </div>
    `;
    
    printBugsList.appendChild(bugItem);
  });
  
  window.print();
});
