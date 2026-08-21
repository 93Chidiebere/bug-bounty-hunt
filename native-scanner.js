import fs from 'fs';
import AdmZip from 'adm-zip';

const SECRET_PATTERNS = {
  'Stripe Secret Key': /sk_live_[0-9a-zA-Z]{24,34}/g,
  'Stripe Restricted Key': /rk_live_[0-9a-zA-Z]{24,34}/g,
  'Paystack Secret Key': /sk_live_[0-9a-zA-Z]{40}/g,
  'Google Cloud/Firebase API Key': /AIza[0-9A-Za-z-_]{35}/g,
  'AWS Access Key': /AKIA[0-9A-Z]{16}/g,
  'Slack Token': /xox[baprs]-[0-9a-zA-Z]{10,48}/g,
  'SendGrid API Key': /SG\.[0-9a-zA-Z_-]{22}\.[0-9a-zA-Z_-]{43}/g,
  'Twilio API Key': /SK[0-9a-fA-F]{32}/g,
};

export async function runNativeScan(filePath, fileName, onLog, onBugFound) {
  onLog([SYS] Initializing VerifyQA Native Pipeline...);
  onLog([SYS] Received native binary:  + fileName);
  
  try {
    onLog([SYS] Unzipping and analyzing binary contents...);
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    
    let totalVulns = 0;

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      
      const ext = entry.entryName.split('.').pop()?.toLowerCase();
      // Scan classes.dex, .so files, AndroidManifest.xml, and generic JSON/XML resources
      if (['dex', 'xml', 'json', 'so', 'smali', 'properties'].includes(ext) || entry.entryName.includes('assets/')) {
        const buffer = entry.getData();
        const content = buffer.toString('utf8');
        
        for (const [keyName, regex] of Object.entries(SECRET_PATTERNS)) {
          const matches = content.match(regex);
          if (matches) {
            totalVulns += matches.length;
            const svgBase64 = Buffer.from(<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="100%" height="100%" fill="#fef2f2"/><text x="50%" y="50%" font-family="monospace" font-size="18" fill="#991b1b" dominant-baseline="middle" text-anchor="middle"> + entry.entryName + </text></svg>).toString('base64');
            
            const maskedKey = matches[0].substring(0, 8) + '...' + matches[0].substring(matches[0].length - 4);
            
            onBugFound({
              url: Binary Extraction:  + entry.entryName,
              screenshot: data:image/svg+xml;base64, + svgBase64,
              type: 'secret-leak',
              severity: 'critical',
              title: Hardcoded API Key ( + keyName + ),
              description: During bytecode reverse engineering, Verify QA detected an exposed  + keyName +  hardcoded directly into \` + entry.entryName + \. Attackers can decompile this binary and extract the key ( + maskedKey + ) to compromise your infrastructure.,
              reproductionSteps: 1. Run apktool d  + fileName + \n2. Search the decompiled source for ' + maskedKey.substring(0, 4) + '\n3. Observe the key in plain text.,
              suggestedFix: Never hardcode secrets into mobile apps. Fetch these keys securely at runtime from your backend.
            });
            
            onLog([VULNERABILITY] Found  + keyName +  in  + entry.entryName);
          }
        }
      }
    }
    
    onLog([SYS] Static analysis complete. Found  + totalVulns +  critical vulnerabilities.);
    onLog([SYS] (Appium Virtual Device routing scheduled for full V2.0 deployment));
  } catch (err) {
    onLog([ERROR] Failed to decompile binary:  + err.message);
  }
}
