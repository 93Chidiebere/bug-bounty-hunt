// DOM Elements
const auditForm = document.getElementById('audit-form');
const targetUrlInput = document.getElementById('target-url');
const aiProviderInput = document.getElementById('ai-provider');
const apiKeyInput = document.getElementById('api-key');
const geminiKeyGroup = document.getElementById('gemini-key-group');
const modelNameInput = document.getElementById('model-name');
const maxPagesInput = document.getElementById('max-pages');
const maxPagesVal = document.getElementById('max-pages-val');
const loginUrlInput = document.getElementById('login-url');
const loginUserInput = document.getElementById('login-user');
const loginPassInput = document.getElementById('login-pass');
const ownerEmailInput = document.getElementById('owner-email');
const startVerifyBtn = document.getElementById('start-verify-btn');
const confirmVerifyBtn = document.getElementById('confirm-verify-btn');
const verifyInstructions = document.getElementById('verify-instructions');
const verifyFilePath = document.getElementById('verify-file-path');
const verifyToken = document.getElementById('verify-token');
const verifyStatus = document.getElementById('verify-status');
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

// Tab & observations elements
const tabBugsBtn = document.getElementById('tab-bugs-btn');
const tabPagesBtn = document.getElementById('tab-pages-btn');
const tabContentBugs = document.getElementById('tab-content-bugs');
const tabContentPages = document.getElementById('tab-content-pages');
const pagesContainer = document.getElementById('pages-container');
const pagesEmptyState = document.getElementById('pages-empty-state');
const bugsCount = document.getElementById('bugs-count');
const pagesCount = document.getElementById('pages-count');
const testScenarioInput = document.getElementById('test-scenario');
const fuzzInputsInput = document.getElementById('fuzz-inputs');
const scaDropzone = document.getElementById('sca-dropzone');
const scaFileInput = document.getElementById('sca-file-input');
const scaFileName = document.getElementById('sca-file-name');

// Platform Selection Elements
const platformRadios = document.querySelectorAll('input[name="platform"]');
const webInputGroup = document.getElementById('web-input-group');
const nativeInputGroup = document.getElementById('native-input-group');
const nativeDropzone = document.getElementById('native-dropzone');
const nativeFileInput = document.getElementById('native-file-input');
const nativeFileName = document.getElementById('native-file-name');
let nativeFileData = null;

let scaFileData = { name: '', content: '' };

let activeEventSource = null;
let foundBugs = [];
let auditedPages = [];
let targetUrl = '';

// Update page slider indicator
maxPagesInput.addEventListener('input', (e) => {
  maxPagesVal.textContent = `${e.target.value} page${e.target.value > 1 ? 's' : ''}`;
});

// Tab navigation listeners
tabBugsBtn.addEventListener('click', () => {
  tabBugsBtn.classList.add('active');
  tabPagesBtn.classList.remove('active');
  tabContentBugs.classList.remove('hidden');
  tabContentPages.classList.add('hidden');
});

tabPagesBtn.addEventListener('click', () => {
  tabPagesBtn.classList.add('active');
  tabBugsBtn.classList.remove('active');
  tabContentPages.classList.remove('hidden');
  tabContentBugs.classList.add('hidden');
});

// SCA File Dropzone Logic
scaDropzone.addEventListener('click', () => scaFileInput.click());

scaDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  scaDropzone.style.backgroundColor = '#f4f4f5';
  scaDropzone.style.borderColor = '#18181b';
});

scaDropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  scaDropzone.style.backgroundColor = '#fafafa';
  scaDropzone.style.borderColor = 'var(--border-color)';
});

scaDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  scaDropzone.style.backgroundColor = '#fafafa';
  scaDropzone.style.borderColor = 'var(--border-color)';
  
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleScaFile(e.dataTransfer.files[0]);
  }
});

scaFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleScaFile(e.target.files[0]);
  }
});

function handleScaFile(file) {
  if (!file) return;
  scaFileName.textContent = file.name;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    scaFileData = {
      name: file.name,
      content: e.target.result
    };
  };
  reader.readAsText(file);
}

// Platform Toggle Logic
platformRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    // Update styling
    document.querySelectorAll('.platform-btn').forEach(lbl => {
      lbl.style.borderColor = 'var(--border-color)';
      lbl.style.background = '#fff';
      lbl.style.color = 'var(--text-secondary)';
    });
    const activeLabel = e.target.parentElement;
    activeLabel.style.borderColor = '#000';
    activeLabel.style.background = '#fafafa';
    activeLabel.style.color = 'var(--text-primary)';

    if (e.target.value === 'web') {
      webInputGroup.style.display = 'block';
      nativeInputGroup.style.display = 'none';
      targetUrlInput.required = true;
    } else {
      webInputGroup.style.display = 'none';
      nativeInputGroup.style.display = 'block';
      targetUrlInput.required = false;
    }
  });
});

// Native File Dropzone Logic
nativeDropzone.addEventListener('click', () => nativeFileInput.click());

nativeDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  nativeDropzone.style.backgroundColor = '#f4f4f5';
  nativeDropzone.style.borderColor = '#18181b';
});

nativeDropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  nativeDropzone.style.backgroundColor = '#fafafa';
  nativeDropzone.style.borderColor = 'var(--border-color)';
});

nativeDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  nativeDropzone.style.backgroundColor = '#fafafa';
  nativeDropzone.style.borderColor = 'var(--border-color)';
  
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleNativeFile(e.dataTransfer.files[0]);
  }
});

nativeFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleNativeFile(e.target.files[0]);
  }
});

function handleNativeFile(file) {
  if (!file) return;
  nativeFileName.textContent = file.name;
  nativeFileName.style.color = '#10b981';
  nativeFileData = file;
}

// AI Provider changes visibility of API Key & resets default model
aiProviderInput.addEventListener('change', (e) => {
  if (e.target.value === 'ollama') {
    geminiKeyGroup.style.display = 'none';
    modelNameInput.value = 'llama3.2-vision';
    modelNameInput.placeholder = 'llama3.2-vision';
  } else {
    geminiKeyGroup.style.display = 'flex';
    modelNameInput.value = 'gemini-3.7-flash';
    modelNameInput.placeholder = 'gemini-3.7-flash';
  }
});

// Start Audit submit handler
// --- Domain ownership verification ---
// The scan button stays disabled until confirmVerification succeeds for the
// exact URL + email currently entered. Changing either one re-locks it,
// since verification is tied to that specific pair.
function lockScanButton() {
  // submitBtn.disabled = true;
  // submitBtn.title = 'Verify domain ownership first';
  if (confirmVerifyBtn) confirmVerifyBtn.classList.add('hidden');
  if (verifyInstructions) verifyInstructions.classList.add('hidden');
  if (verifyStatus) verifyStatus.textContent = '';
}

// targetUrlInput.addEventListener('input', lockScanButton);
// ownerEmailInput.addEventListener('input', lockScanButton);

startVerifyBtn.addEventListener('click', async () => {
  const url = targetUrlInput.value.trim();
  const email = ownerEmailInput.value.trim();
  if (!url) {
    verifyStatus.textContent = 'Enter the target URL above first.';
    return;
  }
  if (!email) {
    verifyStatus.textContent = 'Enter your email above first.';
    return;
  }

  verifyStatus.textContent = 'Requesting verification token...';
  try {
    const response = await fetch('/api/verify/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, email })
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      throw new Error(result.error || 'Failed to start verification.');
    }

    verifyFilePath.textContent = `https://${result.domain}${result.filePath}`;
    verifyToken.textContent = result.token;
    verifyInstructions.classList.remove('hidden');
    confirmVerifyBtn.classList.remove('hidden');
    verifyStatus.textContent = 'Place the file, then click "I\'ve added the file — Verify Now".';
  } catch (err) {
    verifyStatus.textContent = `Error: ${err.message}`;
  }
});

confirmVerifyBtn.addEventListener('click', async () => {
  const url = targetUrlInput.value.trim();
  const email = ownerEmailInput.value.trim();

  verifyStatus.textContent = 'Checking for the verification file...';
  try {
    const response = await fetch('/api/verify/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, email })
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      throw new Error(result.error || 'Verification failed.');
    }

    verifyStatus.textContent = `✓ Verified. Ownership confirmed for ${result.domain}.`;
    submitBtn.disabled = false;
    submitBtn.title = '';
  } catch (err) {
    verifyStatus.textContent = `✗ ${err.message}`;
  }
});

// V2.0 Native Scanner (Backend Upload)
async function runMockNativeScan() {
  setFormDisabled(true);
  consoleLogs.innerHTML = '';
  bugsCount.textContent = '0';
  pagesCount.textContent = '0';
  bugsContainer.innerHTML = '';
  pagesContainer.innerHTML = '';
  emptyState.style.display = 'none';
  pagesEmptyState.style.display = 'none';
  tabContentBugs.classList.add('active');
  tabContentPages.classList.remove('active');
  tabBugsBtn.classList.add('active');
  tabPagesBtn.classList.remove('active');
  foundBugs = [];
  auditedPages = [];

  const formData = new FormData();
  formData.append('apkFile', nativeFileData);
  
  addLogMessage(`[SYS] Uploading ${nativeFileData.name} to Verification Engine...`, 'sys');

  try {
    const response = await fetch('/api/scan-native', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to start native scan');
    }
    
    const data = await response.json();
    connectToScanStream(data.scanId);
  } catch (err) {
    addLogMessage(`[ERROR] ${err.message}`, 'error');
    setFormDisabled(false);
  }
}

auditForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const selectedPlatform = document.querySelector('input[name="platform"]:checked').value;
  if (selectedPlatform === 'native') {
    if (!nativeFileData) {
      alert("Please upload a target application binary (.apk, .ipa, etc.) first.");
      return;
    }
    return runMockNativeScan();
  }
  
  // Clean up previous scan states
  if (activeEventSource) {
    activeEventSource.close();
  }
  
  foundBugs = [];
  auditedPages = [];
  targetUrl = targetUrlInput.value.trim();
  if (targetUrl && !targetUrl.startsWith('http')) {
    targetUrl = 'https://' + targetUrl;
  }
  
  const apiKey = apiKeyInput.value.trim();
  const provider = aiProviderInput.value;
  const model = modelNameInput.value.trim();
  const maxPages = maxPagesInput.value;
  
  let loginUrl = loginUrlInput.value.trim();
  if (loginUrl && !loginUrl.startsWith('http')) {
    loginUrl = 'https://' + loginUrl;
  }
  const loginUser = loginUserInput.value.trim();
  const loginPass = loginPassInput.value.trim();
  const testScenario = testScenarioInput.value.trim();
  const fuzzInputs = fuzzInputsInput.checked;
  
  // UI resets
  consoleLogs.innerHTML = '';
  bugsCount.textContent = '0';
  pagesCount.textContent = '0';
  
  // Remove dynamic elements
  bugsContainer.querySelectorAll('.bug-card').forEach(card => card.remove());
  pagesContainer.querySelectorAll('.page-card').forEach(card => card.remove());
  
  emptyState.classList.remove('hidden');
  pagesEmptyState.classList.remove('hidden');
  
  // Switch to Bugs tab by default at start
  tabBugsBtn.click();
  
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
      body: JSON.stringify({ 
        url: targetUrl, 
        email: ownerEmailInput.value.trim(),
        apiKey, 
        provider, 
        model, 
        maxPages,
        loginUrl,
        loginUser,
        loginPass,
        testScenario,
        fuzzInputs,
        scaFileName: scaFileData.name,
        scaFileContent: scaFileData.content
      })
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
  
  activeEventSource.addEventListener('page', (e) => {
    const pageObs = JSON.parse(e.data);
    auditedPages.push(pageObs);
    
    pagesCount.textContent = auditedPages.length;
    pagesEmptyState.classList.add('hidden');
    
    renderPageCard(pageObs);
    
    // Enable PDF report as long as pages are audited (observations exist)
    exportPdfBtn.removeAttribute('disabled');
  });
  
  activeEventSource.addEventListener('bug', (e) => {
    const bug = JSON.parse(e.data);
    foundBugs.push(bug);
    
    emptyState.classList.add('hidden');
    bugsCount.textContent = foundBugs.length;
    renderBugCard(bug);
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
  }
  if (auditedPages.length === 0) {
    pagesEmptyState.classList.remove('hidden');
    exportPdfBtn.setAttribute('disabled', 'true');
  }
}

// Helper to disable form elements
function setFormDisabled(disabled) {
  targetUrlInput.disabled = disabled;
  aiProviderInput.disabled = disabled;
  apiKeyInput.disabled = disabled;
  modelNameInput.disabled = disabled;
  maxPagesInput.disabled = disabled;
  loginUrlInput.disabled = disabled;
  loginUserInput.disabled = disabled;
  loginPassInput.disabled = disabled;
  testScenarioInput.disabled = disabled;
  fuzzInputsInput.disabled = disabled;
  ownerEmailInput.disabled = disabled;
  
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

// Render audited page observation card
function renderPageCard(pageObs) {
  const card = document.createElement('div');
  card.className = 'page-card';
  
  const imgWrapper = document.createElement('div');
  imgWrapper.className = 'page-card-img-wrapper';
  
  const img = document.createElement('img');
  img.className = 'page-card-img';
  img.src = pageObs.screenshot;
  img.alt = pageObs.title;
  imgWrapper.appendChild(img);
  
  const body = document.createElement('div');
  body.className = 'page-card-body';
  
  const title = document.createElement('div');
  title.className = 'page-card-title';
  title.textContent = pageObs.title || 'Untitled Page';
  
  const url = document.createElement('div');
  url.className = 'page-card-url';
  url.textContent = pageObs.url;
  
  const meta = document.createElement('div');
  meta.className = 'page-card-meta';
  
  // Calculate status indicator
  const errorsCount = pageObs.pageErrors.length + pageObs.networkErrors.length;
  const indicator = document.createElement('div');
  indicator.className = 'page-logs-indicator';
  
  if (errorsCount > 0) {
    indicator.innerHTML = `
      <span class="logs-indicator-error">●</span>
      <span>${errorsCount} Technical Error${errorsCount > 1 ? 's' : ''}</span>
    `;
  } else if (pageObs.consoleLogs.length > 0) {
    indicator.innerHTML = `
      <span class="logs-indicator-warning">●</span>
      <span>Warnings Only</span>
    `;
  } else {
    indicator.innerHTML = `
      <span class="logs-indicator-success">●</span>
      <span>Clean Session</span>
    `;
  }
  
  const viewLogsBtn = document.createElement('button');
  viewLogsBtn.className = 'btn-view-logs';
  viewLogsBtn.textContent = 'View Technical Logs';
  viewLogsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openPageLogsModal(pageObs);
  });
  
  meta.appendChild(indicator);
  meta.appendChild(viewLogsBtn);
  
  body.appendChild(title);
  body.appendChild(url);
  body.appendChild(meta);
  
  card.appendChild(imgWrapper);
  card.appendChild(body);
  
  pagesContainer.appendChild(card);
}

// Open modal showing audited page logs
function openPageLogsModal(pageObs) {
  const allLogs = [
    ...pageObs.pageErrors.map(e => `[EXCEPTION] ${e}`),
    ...pageObs.networkErrors.map(n => `[NETWORK FAILURE] ${n}`),
    ...pageObs.consoleLogs
  ];

  modalBodyContent.innerHTML = `
    <div class="detail-grid">
      <div class="detail-visual">
        <label>Page Audit Screen Capture</label>
        <img class="detail-full-img" src="${pageObs.screenshot}" alt="${escapeHtml(pageObs.title)}">
      </div>
      <div class="detail-info">
        <div class="detail-header-info">
          <h3 class="detail-title">${escapeHtml(pageObs.title || 'Untitled Page')}</h3>
          <div class="bug-url">${escapeHtml(pageObs.url)}</div>
        </div>
        
        <div class="detail-block">
          <h4>Console & Network Log Stream</h4>
          <pre class="code-block" style="max-height: 400px; overflow-y: auto;"><code>${allLogs.length > 0 ? escapeHtml(allLogs.join('\n')) : 'No console errors or network warnings recorded during this session.'}</code></pre>
        </div>
      </div>
    </div>
  `;
  
  bugModal.classList.add('open');
}

// Open bug detail modal
function openBugModal(bug) {
  const stepsHtml = bug.reproductionSteps
    .split('\n')
    .map(step => `<li>${escapeHtml(step.replace(/^\d+\.\s*/, ''))}</li>`)
    .join('');

  modalBodyContent.innerHTML = `
    <div class="detail-grid">
      <div class="detail-visual">
        <label>Visual Bug Highlight Location</label>
        <img class="detail-full-img" src="${bug.screenshot}" alt="${escapeHtml(bug.title)}">
      </div>
      <div class="detail-info">
        <div class="detail-header-info">
          <span class="badge severity-${escapeHtml(bug.severity)}" style="margin-bottom: 0.5rem; display: inline-block;">
            ${escapeHtml(bug.severity)} SEVERITY
          </span>
          <h3 class="detail-title">${escapeHtml(bug.title)}</h3>
          <div class="bug-url" style="font-family: var(--font-mono); font-size: 0.85rem;">
            ${escapeHtml(bug.url)}
          </div>
        </div>
        
        <div class="detail-block">
          <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 0.25rem; letter-spacing: 0.05em;">Vulnerability Details</h4>
          <p style="font-size: 0.9rem; line-height: 1.5; color: var(--text-primary); margin-bottom: 1.5rem;">
            ${escapeHtml(bug.description)}
          </p>
        </div>
        
        <div class="detail-block">
          <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 0.25rem; letter-spacing: 0.05em;">How to Reproduce</h4>
          <ol style="font-size: 0.9rem; line-height: 1.6; color: var(--text-primary); padding-left: 1.5rem; margin-bottom: 1.5rem;">
            ${stepsHtml}
          </ol>
        </div>
        
        <div class="detail-block">
          <h4 style="font-size: 0.85rem; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 0.25rem; letter-spacing: 0.05em;">Suggested Engineering Fix</h4>
          <pre class="code-block" style="background-color: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 0.75rem; overflow-x: auto; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-primary); line-height: 1.4;"><code>${escapeHtml(bug.suggestedFix)}</code></pre>
        </div>
      </div>
    </div>
  `;
  
  bugModal.classList.add('open');
}

// PDF Print Export (Compiles bugs in paper-friendly formatting)
exportPdfBtn.addEventListener('click', () => {
  if (auditedPages.length === 0) return;
  
  // Set metadata
  printMetaText.textContent = `Target Domain: ${targetUrl} | Audit Date: ${new Date().toLocaleDateString()}`;
  
  printBugsList.innerHTML = '';

  // 1. Compile Vulnerabilities
  const sectionBugs = document.createElement('h2');
  sectionBugs.style.borderBottom = '2px solid #18181b';
  sectionBugs.style.paddingBottom = '6px';
  sectionBugs.style.marginBottom = '20px';
  sectionBugs.textContent = '1. Vulnerabilities & Defect Findings';
  printBugsList.appendChild(sectionBugs);
  
  if (foundBugs.length === 0) {
    const noBugsMsg = document.createElement('p');
    noBugsMsg.style.fontStyle = 'italic';
    noBugsMsg.style.color = '#52525b';
    noBugsMsg.textContent = 'No critical layout defects or runtime vulnerabilities were isolated by the AI visual auditor.';
    printBugsList.appendChild(noBugsMsg);
  } else {
    foundBugs.forEach((bug, index) => {
      const bugItem = document.createElement('div');
      bugItem.className = 'print-bug-item';
      
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
  }

  // 2. Compile Page Observations
  const sectionPages = document.createElement('h2');
  sectionPages.style.borderBottom = '2px solid #18181b';
  sectionPages.style.paddingBottom = '6px';
  sectionPages.style.marginTop = '40px';
  sectionPages.style.marginBottom = '20px';
  sectionPages.textContent = '2. Page Observations & Technical Snapshots';
  printBugsList.appendChild(sectionPages);

  auditedPages.forEach((p, index) => {
    const pageItem = document.createElement('div');
    pageItem.className = 'print-bug-item';
    pageItem.style.display = 'grid';
    pageItem.style.gridTemplateColumns = '240px 1fr';
    pageItem.style.gap = '20px';
    pageItem.style.pageBreakInside = 'avoid';

    const allLogs = [
      ...p.pageErrors.map(e => `[EXCEPTION] ${e}`),
      ...p.networkErrors.map(n => `[NETWORK FAILURE] ${n}`),
      ...p.consoleLogs
    ];

    pageItem.innerHTML = `
      <div>
        <img src="${p.screenshot}" style="width:100%; border:1px solid #e4e4e7; border-radius:4px;">
      </div>
      <div>
        <h3 style="font-size:12pt; font-weight:bold; margin:0 0 5px 0;">Observation #${index + 1}: ${escapeHtml(p.title || 'Untitled Page')}</h3>
        <div style="font-family:monospace; font-size:8pt; color:#71717a; margin-bottom:10px; word-break:break-all;">URL: ${escapeHtml(p.url)}</div>
        <div style="font-size:9pt; margin-top:5px;">
          <strong>Console logs:</strong>
          <pre class="print-bug-fix" style="max-height:180px; overflow-y:auto; font-size:7.5pt; margin-top:5px;"><code>${allLogs.length > 0 ? escapeHtml(allLogs.join('\n')) : 'No console errors or exceptions recorded.'}</code></pre>
        </div>
      </div>
    `;
    printBugsList.appendChild(pageItem);
  });
  
  window.print();
});

function closeModal() {
  bugModal.classList.remove('open');
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
