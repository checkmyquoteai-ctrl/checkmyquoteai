export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const rawBody = await getRawBody(req);
    const event = JSON.parse(rawBody.toString());

    console.log('Stripe webhook received:', event.type);

    if (event.type !== 'checkout.session.completed') {
      return res.status(200).json({ received: true });
    }

    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    const orderId = session.id;
    const amount = session.amount_total;

    console.log('Session email:', email, 'amount_total:', amount, 'orderId:', orderId);

    if (!email) {
      console.error('No email found in session');
      return res.status(200).json({ received: true });
    }

    // Add credits for bundle ($25 = 2500 cents, allow for tax so use >1500)
    if (amount >= 1500) {
      console.log('Adding bundle credits for:', email);

      // Use Google Sheets API directly instead of calling /api/credits
      // to avoid internal fetch issues
      const SHEET_ID = '14J5DDeocZm_qEE-jve5n0BqgrSey6SAM7x7Px9gQM8M';
      const SHEET_NAME = 'Credit';
      const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
      const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;

      if (!key || !clientEmail) {
        console.error('Missing Google credentials');
        return res.status(200).json({ received: true });
      }

      // Get access token
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };

      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signingInput = `${header}.${body}`;

      const pemKey = key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
      const keyData = Buffer.from(pemKey, 'base64');
      const cryptoKey = await crypto.subtle.importKey(
        'pkcs8', keyData,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['sign']
      );
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
        console.error('Failed to get token:', JSON.stringify(tokenData));
        return res.status(200).json({ received: true });
      }

      // Read sheet to check if email exists
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:E`;
      const readResp = await fetch(readUrl, { headers: { 'Authorization': `Bearer ${token}` } });
      const readData = await readResp.json();
      const rows = readData.values || [];

      console.log('Sheet rows:', rows.length);

      let userRowIndex = -1;
      let userRow = null;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] && rows[i][0].toLowerCase() === email.toLowerCase()) {
          userRowIndex = i + 1;
          userRow = rows[i];
          break;
        }
      }

      if (userRow) {
        // Update existing row
        const single = (parseInt(userRow[1]) || 0) + 5;
        const compare = (parseInt(userRow[2]) || 0) + 5;
        const range = `${SHEET_NAME}!B${userRowIndex}:C${userRowIndex}`;
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[single, compare]] })
        });
        console.log('Updated existing row for:', email, 'single:', single, 'compare:', compare);
      } else {
        // Add new row
        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:E:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
        await fetch(appendUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[email, 5, 5, new Date().toISOString().split('T')[0], orderId]] })
        });
        console.log('Added new row for:', email);
      }
    } else {
      console.log('Amount too low for bundle credits:', amount);
    }

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error('Webhook error:', err.message, err.stack);
    return res.status(200).json({ received: true }); // Always return 200 to Stripe
  }
}
