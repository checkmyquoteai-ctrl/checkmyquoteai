export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const SHEET_ID = '14J5DDeocZm_qEE-jve5n0BqgrSey6SAM7x7Px9gQM8M';
const SHEET_NAME = 'Credit';

async function getAccessToken() {
  const key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  // Create JWT
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;

  // Sign with private key using Web Crypto
  const pemKey = key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const keyData = Buffer.from(pemKey, 'base64');
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(signingInput)
  );

  const jwt = `${signingInput}.${Buffer.from(signature).toString('base64url')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

async function getSheetData(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:E`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  return data.values || [];
}

async function updateRow(token, rowIndex, singleCredits, compareCredits) {
  const range = `${SHEET_NAME}!B${rowIndex}:C${rowIndex}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
  await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[singleCredits, compareCredits]] })
  });
}

async function addRow(token, email, singleCredits, compareCredits, orderId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:E:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[email, singleCredits, compareCredits, new Date().toISOString().split('T')[0], orderId]] })
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { email, type, action } = body;

    if (!email) return res.status(400).json({ error: 'Missing email' });

    const token = await getAccessToken();
    const rows = await getSheetData(token);

    // Find row by email (skip header row)
    let userRowIndex = -1;
    let userRow = null;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] && rows[i][0].toLowerCase() === email.toLowerCase()) {
        userRowIndex = i + 1; // 1-indexed for Sheets API
        userRow = rows[i];
        break;
      }
    }

    if (action === 'check') {
      if (!userRow) return res.status(200).json({ hasCredits: false, single: 0, compare: 0 });
      const single = parseInt(userRow[1]) || 0;
      const compare = parseInt(userRow[2]) || 0;
      const hasCredits = type === 'single' ? single > 0 : compare > 0;
      return res.status(200).json({ hasCredits, single, compare });
    }

    if (action === 'deduct') {
      if (!userRow) return res.status(200).json({ success: false, error: 'No credits found' });
      let single = parseInt(userRow[1]) || 0;
      let compare = parseInt(userRow[2]) || 0;
      if (type === 'single' && single > 0) single--;
      else if (type === 'compare' && compare > 0) compare--;
      await updateRow(token, userRowIndex, single, compare);
      return res.status(200).json({ success: true, single, compare });
    }

    if (action === 'add') {
      // Called by Stripe webhook via Make or directly
      const { orderId, singleCredits = 5, compareCredits = 5 } = body;
      if (userRow) {
        // Update existing row
        const single = (parseInt(userRow[1]) || 0) + singleCredits;
        const compare = (parseInt(userRow[2]) || 0) + compareCredits;
        await updateRow(token, userRowIndex, single, compare);
      } else {
        await addRow(token, email, singleCredits, compareCredits, orderId || 'manual');
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch(err) {
    console.error('Credits error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
