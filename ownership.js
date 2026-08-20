import crypto from 'crypto';
import { pool } from './db.js';

const VERIFICATION_TTL_DAYS = 90;
const WELL_KNOWN_PATH = '/.well-known/verify-qa-challenge.txt';

/**
 * Normalizes a hostname so that a verification of "example.com" also
 * covers "www.example.com" and vice versa — these are almost always the
 * same operator, and treating them as distinct would just create
 * confusing re-verification prompts without adding real security.
 */
function normalizeDomain(hostname) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function extractDomain(rawUrl) {
  const parsed = new URL(rawUrl);
  return normalizeDomain(parsed.hostname);
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Step 1 of verification: issue (or re-issue) a token for a domain+email
 * pair. Does NOT mark anything verified — that only happens in
 * confirmVerification() after we've actually fetched the well-known file
 * and matched the token server-side.
 */
export async function startVerification(rawUrl, email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid email address is required to start verification.');
  }
  const domain = extractDomain(rawUrl);
  const token = generateToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO domain_verifications (domain, email, token, verified, verified_at, expires_at)
     VALUES ($1, $2, $3, FALSE, NULL, $4)
     ON CONFLICT (domain, email)
     DO UPDATE SET token = EXCLUDED.token, verified = FALSE, verified_at = NULL, expires_at = EXCLUDED.expires_at`,
    [domain, email, token, expiresAt]
  );

  return {
    domain,
    token,
    filePath: WELL_KNOWN_PATH,
    instructions: `Create a publicly accessible file at https://${domain}${WELL_KNOWN_PATH} containing exactly this token: ${token}`
  };
}

/**
 * Step 2 of verification: fetch the well-known file from the target
 * domain ourselves (server-side — never trust a client-supplied "yes I
 * did it") and confirm the token matches what we issued.
 */
export async function confirmVerification(rawUrl, email) {
  const domain = extractDomain(rawUrl);

  const { rows } = await pool.query(
    `SELECT * FROM domain_verifications WHERE domain = $1 AND email = $2`,
    [domain, email]
  );
  const record = rows[0];

  if (!record) {
    throw new Error('No verification has been started for this domain/email. Call start-verification first.');
  }

  const challengeUrl = `https://${domain}${WELL_KNOWN_PATH}`;
  let body;
  try {
    const response = await fetch(challengeUrl, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Received HTTP ${response.status} fetching ${challengeUrl}`);
    }
    body = (await response.text()).trim();
  } catch (err) {
    throw new Error(`Could not fetch ${challengeUrl}: ${err.message}`);
  }

  if (body !== record.token) {
    throw new Error(
      `Token mismatch at ${challengeUrl}. Expected the file to contain exactly the token issued in step 1. ` +
      `Note: this fetch has no cookies/session — the file must be publicly accessible with no auth required.`
    );
  }

  await pool.query(
    `UPDATE domain_verifications SET verified = TRUE, verified_at = now() WHERE domain = $1 AND email = $2`,
    [domain, email]
  );

  return { domain, verified: true, expiresAt: record.expires_at };
}

/**
 * The actual gate — call this before launching any scan. Throws with a
 * clear, actionable message if the domain isn't verified for this email,
 * or if the verification has expired.
 */
export async function assertVerifiedOwnership(rawUrl, email) {
  if (!email) {
    throw new Error(
      'An email is required to run a scan. Verify domain ownership first via /api/verify/start and /api/verify/confirm.'
    );
  }
  const domain = extractDomain(rawUrl);

  const { rows } = await pool.query(
    `SELECT * FROM domain_verifications WHERE domain = $1 AND email = $2`,
    [domain, email]
  );
  const record = rows[0];

  if (!record || !record.verified) {
    throw new Error(
      `Domain "${domain}" has not been verified for ${email}. Before scanning any target, prove you control it: ` +
      `POST /api/verify/start with { url, email } to get a token, place it at https://${domain}${WELL_KNOWN_PATH}, ` +
      `then POST /api/verify/confirm with the same { url, email }.`
    );
  }

  if (record.expires_at && new Date(record.expires_at) < new Date()) {
    throw new Error(
      `Verification for "${domain}" expired on ${new Date(record.expires_at).toISOString()}. Please re-verify — ` +
      `POST /api/verify/start with { url, email } to get a new token.`
    );
  }

  return true;
}
