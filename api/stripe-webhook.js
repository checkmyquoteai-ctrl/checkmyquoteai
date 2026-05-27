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

    console.log('Stripe event type:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details?.email || session.customer_email || null;
      const orderId = session.id;
      const amount = session.amount_total; // in cents

      console.log('Checkout completed - email:', email, 'amount:', amount, 'orderId:', orderId);

      if (!email) {
        console.error('No email in session');
        return res.status(200).json({ received: true });
      }

      // Only add credits for bundle purchases ($25 = 2500 cents)
      if (amount >= 2000) { // $20+ = bundle
        const creditsResp = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://checkmyquoteai.com'}/api/credits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            action: 'add',
            orderId,
            singleCredits: 5,
            compareCredits: 5
          })
        });

        const result = await creditsResp.json();
        console.log('Credits added:', JSON.stringify(result));
      }
    }

    return res.status(200).json({ received: true });

  } catch(err) {
    console.error('Webhook error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
