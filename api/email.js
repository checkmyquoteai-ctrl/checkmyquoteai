export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { to, report } = body;
    if (!to || !report) return res.status(400).json({ error: 'Missing to or report' });

    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) return res.status(500).json({ error: 'No API key configured' });

    // Log what we're sending for debugging
    console.log('Sending email to:', to);
    console.log('Key prefix:', RESEND_KEY.substring(0, 10));

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: [to],
        subject: 'Your CheckMyQuote AI Analysis Report',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;">
            <div style="background:#1a2e1a;padding:20px;border-radius:8px;margin-bottom:24px;">
              <h1 style="color:#fff;margin:0;font-size:22px;">CheckMyQuote AI</h1>
              <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">Your Quote Analysis Report</p>
            </div>
            <div style="background:#f9f9f6;border:1px solid #e0e0d8;border-radius:8px;padding:24px;">
              <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:13px;color:#2a2a2a;line-height:1.7;margin:0;">${report.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
            </div>
            <p style="font-size:11px;font-style:italic;color:#666;margin-top:16px;">Disclaimer: CheckMyQuote AI provides AI-generated analysis for informational purposes only. Not a substitute for professional advice. CheckMyQuote AI accepts no liability for decisions made based on this report.</p>
            <p style="font-size:11px;color:#999;text-align:center;">checkmyquoteai.com</p>
          </div>
        `
      })
    });

    const text = await response.text();
    console.log('Resend full response:', response.status, text);

    if (response.ok) return res.status(200).json({ success: true });
    return res.status(500).json({ error: text });

  } catch(err) {
    console.error('Email error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
