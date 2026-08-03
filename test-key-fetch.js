import dotenv from 'dotenv';

dotenv.config();

const rawKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';

async function testFetch() {
  console.log('Testing direct HTTP fetch to Gemini API...');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${rawKey}`;
  
  const payload = {
    contents: [
      {
        parts: [
          { text: 'Hello, respond with exactly "HTTP fetch is working!"' }
        ]
      }
    ]
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      console.log('HTTP test FAILED:', JSON.stringify(data));
    } else {
      console.log('HTTP test SUCCESS:', data.candidates[0].content.parts[0].text);
    }
  } catch (err) {
    console.log('HTTP test ERROR:', err.message);
  }
}

testFetch();
