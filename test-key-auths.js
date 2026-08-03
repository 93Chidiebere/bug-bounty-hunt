import dotenv from 'dotenv';

dotenv.config();

const rawKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';

const payload = {
  contents: [{ parts: [{ text: 'Hello, respond with "SUCCESS"' }] }]
};

async function testQueryParam() {
  console.log('\n--- 1. Testing ?key= query parameter ---');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${rawKey}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('Result:', res.ok ? 'SUCCESS' : 'FAILED', JSON.stringify(data));
  } catch (err) {
    console.log('Error:', err.message);
  }
}

async function testHeaderApiKey() {
  console.log('\n--- 2. Testing x-goog-api-key header ---');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': rawKey
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('Result:', res.ok ? 'SUCCESS' : 'FAILED', JSON.stringify(data));
  } catch (err) {
    console.log('Error:', err.message);
  }
}

async function testHeaderBearer() {
  console.log('\n--- 3. Testing Authorization: Bearer header ---');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawKey}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('Result:', res.ok ? 'SUCCESS' : 'FAILED', JSON.stringify(data));
  } catch (err) {
    console.log('Error:', err.message);
  }
}

async function run() {
  await testQueryParam();
  await testHeaderApiKey();
  await testHeaderBearer();
}

run();
