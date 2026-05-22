export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { to, report } = body;

    // Use EmailJS REST API server-side (no browser limits)
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE,
        template_id: process.env.EMAILJS_TEMPLATE,
        user_id: process.env.EMAILJS_KEY,
        template_params: {
          to_email: to,
          from_name: 'CheckMyQuote AI',
          reply_to: 'checkmyquoteai@gmail.com',
          subject: 'Your CheckMyQuote AI Analysis Report',
          message: report,
          email: to
        }
      })
    });

    const text = await response.text();
    if (response.ok || text === 'OK') {
      return res.status(200).json({ success: true });
    }
    return res.status(500).json({ error: text });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
