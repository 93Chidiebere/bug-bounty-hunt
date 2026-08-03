import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const rawKey = process.env.GEMINI_API_KEY;
const trimmedKey = rawKey ? rawKey.trim() : '';

console.log('Raw Key Length:', rawKey ? rawKey.length : 0);
console.log('Trimmed Key Length:', trimmedKey.length);
console.log('Raw Key Ends with Carriage Return (\\r):', rawKey ? rawKey.endsWith('\r') : false);

async function testKey(key, label) {
  console.log(`\n--- Testing ${label} ---`);
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: 'Hello, respond with exactly "Key is working!"'
    });
    console.log(`${label} SUCCESS:`, response.text);
  } catch (err) {
    console.log(`${label} FAILED:`, err.message);
    if (err.stack) {
      console.log('Details:', err.stack.split('\n').slice(0, 3).join('\n'));
    }
  }
}

async function run() {
  await testKey(rawKey, 'Raw Key');
  if (rawKey !== trimmedKey) {
    await testKey(trimmedKey, 'Trimmed Key');
  }
}

run();
