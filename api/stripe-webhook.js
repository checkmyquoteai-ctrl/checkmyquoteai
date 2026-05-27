export const config = { api: { bodyParser: true } }; // Let Vercel parse it

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const event = req.body; // Already parsed by Vercel

    console.log('Stripe webhook type:', event?.type, 'keys:', Object.keys(event || {}).join(','));

    if (!event || event.type !== 'checkout.session.completed') {
      console.log('Not a checkout event, ignoring');
      return res.status(200).json({ received: true });
    }

    const session = event.data?.object;
    if (!session) {
      console.error('No session object in event');
      return res.status(200).json({ received: true });
    }

    const email = session.customer_details?.email || session.customer_email || null;
    const orderId = session.id;
    const amount = session.amount_total || 0;

    console.log('Session - email:', email, 'amount:', amount, 'orderId:', orderId);

    if (!email) {
      console.error('No email found');
      return res.status(200).json({ received: true });
    }

    if (amount < 1500) {
      console.log('Amount too low:', amount, '- not a bundle');
      return res.status(200).json({ received: true });
    }

    console.log('Processing bundle credits for:', email);

    const SHEET_ID = '14J5DDeocZm_qEE-jve5n0BqgrSey6SAM7x7Px9gQM8M';
    const SHEET_NAME = 'Credit';
    const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;

    if (!key || !clientEmail) {
      console.error('Missing Google creds - key length:', key.length, 'email:', clientEmail);
      return res.status(200).json({ received: true });
    }

    // JWT auth
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = { iss: clientEmail, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
    const signingInput = `${header}.${body}`;
    const pemKey = key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
    const keyData = Buffer.from(pemKey, 'base64');
    const cryptoKey = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, Buffer.from(signingInput));
    const jwt = `${signingInput}.${Buffer.from(signature).toString('base64url')}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    if (!token) {
      console.error('Token failed:', JSON.stringify(tokenData).substring(0, 200));
      return res.status(200).json({ received: true });
    }

    console.log('Got Google token, reading sheet...');

    // Read sheet
    const readResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:E`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const readData = await readResp.json();
    const rows = readData.values || [];
    console.log('Sheet rows:', rows.length);

    let userRowIndex = -1, userRow = null;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0]?.toLowerCase() === email.toLowerCase()) {
        userRowIndex = i + 1;
        userRow = rows[i];
        break;
      }
    }

    if (userRow) {
      const single = (parseInt(userRow[1]) || 0) + 5;
      const compare = (parseInt(userRow[2]) || 0) + 5;
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!B${userRowIndex}:C${userRowIndex}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[single, compare]] })
      });
      console.log('Updated row:', email, single, compare);
    } else {
      const appendResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:E:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[email, 5, 5, new Date().toISOString().split('T')[0], orderId]] })
      });
      const appendData = await appendResp.json();
      console.log('Added new row for:', email, 'result:', JSON.stringify(appendData).substring(0, 100));
    }

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ received: true });
  }
}
