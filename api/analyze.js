export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      console.error('Bad request - messages:', JSON.stringify(body.messages));
      return res.status(400).json({ error: 'Messages array is empty or missing' });
    }

    const part = body.part || 1;
    const mode = body.mode || 'single';

    const part1Sections = `## BOTTOM LINE
## MARKET PRICE CHECK
## QUOTE 1 BREAKDOWN
${mode === 'compare' ? '## QUOTE 2 BREAKDOWN\n## COMPARISON DECISION' : '## DECISION'}
## TIMELINE
## PAYMENT TERMS
## WARRANTY
## PRICE FAIRNESS`;

    const part2Sections = `## VENDOR 1 NAME
## VENDOR 2 NAME
## VENDOR 1 GOOGLE CHECK
${mode === 'compare' ? '## VENDOR 2 GOOGLE CHECK' : ''}
## WHATS INCLUDED
## WHATS MISSING
## RED FLAGS
## QUESTIONS TO ASK
## BEST NEXT ACTION`;

    const sections = part === 1 ? part1Sections : part2Sections;

    const messages = body.messages.map((m, i) => {
      if (i === body.messages.length - 1 && m.role === 'user') {
        const contentArr = Array.isArray(m.content)
          ? m.content
          : [{ type: 'text', text: m.content }];
        const lastItem = contentArr[contentArr.length - 1];
        const updatedLast = {
          ...lastItem,
          text: (lastItem.text || '') + '\n\nProvide ONLY these sections, 3-5 sentences each, be concise:\n' + sections
        };
        return { ...m, content: [...contentArr.slice(0, -1), updatedLast] };
      }
      return m;
    });

    console.log('Sending to Anthropic - messages count:', messages.length, 'part:', part);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1800,
        messages
      })
    });

    const data = await response.json();
    if (!response.ok) console.error('Anthropic error:', JSON.stringify(data));
    return res.status(response.status).json(data);

  } catch (err) {
    console.error('Analyze error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
