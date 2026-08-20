/**
 * Software Composition Analysis (SCA) module.
 * Parses package.json / package-lock.json and queries the Google OSV API.
 */

function stripVersion(versionStr) {
  // Removes ^, ~, >, <, = and other semver range modifiers to get a base version
  return versionStr.replace(/^[^\d]+/, '');
}

function parseManifest(fileName, fileContent) {
  let parsed;
  try {
    parsed = JSON.parse(fileContent);
  } catch (err) {
    throw new Error(`Failed to parse ${fileName} as JSON: ${err.message}`);
  }

  const packages = [];

  // package-lock.json v3/v2
  if (parsed.packages) {
    for (const [path, details] of Object.entries(parsed.packages)) {
      if (path === '') continue; // root
      const nameMatch = path.match(/node_modules\/([^/]+)$/) || path.match(/node_modules\/(@[^/]+\/[^/]+)$/);
      const name = nameMatch ? nameMatch[1] : path;
      if (details.version) {
        packages.push({ name, version: stripVersion(details.version) });
      }
    }
  } 
  // package-lock.json v1 or yarn.lock fallback (very basic JSON parsing fallback)
  else if (parsed.dependencies && typeof parsed.dependencies === 'object') {
    const extractDeps = (depsObj) => {
      for (const [name, details] of Object.entries(depsObj)) {
        if (typeof details === 'object' && details.version) {
          packages.push({ name, version: stripVersion(details.version) });
        } else if (typeof details === 'string') {
          // package.json standard deps
          packages.push({ name, version: stripVersion(details) });
        }
      }
    };
    if (parsed.dependencies) extractDeps(parsed.dependencies);
    if (parsed.devDependencies) extractDeps(parsed.devDependencies);
  }

  // Deduplicate
  const unique = [];
  const seen = new Set();
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(pkg);
    }
  }

  return unique;
}

export async function runSCA(fileName, fileContent, onBugFound, onLog) {
  onLog(`[SYS] Starting Software Composition Analysis (SCA) on ${fileName}...`);
  
  let packages;
  try {
    packages = parseManifest(fileName, fileContent);
  } catch (err) {
    onLog(`[ERROR] SCA Parsing failed: ${err.message}`);
    return;
  }

  if (packages.length === 0) {
    onLog(`[SYS] SCA: No dependencies found to scan in ${fileName}.`);
    return;
  }

  onLog(`[SYS] SCA: Extracted ${packages.length} unique dependencies. Querying Google OSV API...`);

  // OSV API recommends batching in chunks of 1000
  const chunkSize = 1000;
  let totalVulnsFound = 0;

  for (let i = 0; i < packages.length; i += chunkSize) {
    const chunk = packages.slice(i, i + chunkSize);
    const queries = chunk.map(pkg => ({
      package: { name: pkg.name, ecosystem: 'npm' },
      version: pkg.version
    }));

    try {
      const response = await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries })
      });

      if (!response.ok) {
        onLog(`[ERROR] OSV API returned ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      // The response is an object with a "results" array that maps 1:1 to the queries
      if (data && data.results) {
        data.results.forEach((result, index) => {
          if (result.vulns && result.vulns.length > 0) {
            const pkg = chunk[index];
            result.vulns.forEach(vuln => {
              totalVulnsFound++;
              const cveId = vuln.aliases ? vuln.aliases.find(a => a.startsWith('CVE-')) || vuln.id : vuln.id;
              
              onBugFound({
                url: `SCA Analysis: ${fileName}`,
                screenshot: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="100%" height="100%" fill="%23fee2e2"/><text x="50%" y="50%" font-family="monospace" font-size="20" fill="%23991b1b" dominant-baseline="middle" text-anchor="middle">SCA / Dependency Vulnerability</text></svg>',
                type: 'dependency-cve',
                severity: 'high',
                title: `Vulnerable Package: ${pkg.name}@${pkg.version} (${cveId})`,
                description: `The uploaded manifest references a package with a known vulnerability.\n\nDetails: ${vuln.details || vuln.summary || 'See OSV advisory for details.'}`,
                reproductionSteps: `1. Check your ${fileName} for the dependency '${pkg.name}' at version '${pkg.version}'.\n2. Run 'npm audit' or check the OSV advisory: https://osv.dev/vulnerability/${vuln.id}`,
                suggestedFix: `Update ${pkg.name} to a secure patched version as recommended by the advisory.`
              });
            });
          }
        });
      }
    } catch (err) {
      onLog(`[ERROR] SCA API Request failed: ${err.message}`);
    }
  }

  onLog(`[SYS] SCA Completed. Found ${totalVulnsFound} vulnerabilities.`);
}
