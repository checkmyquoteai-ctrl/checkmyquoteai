export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { vendorName, reportText } = body;

    if (!vendorName || vendorName.length < 2) return res.status(200).json(null);

    const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY;
    if (!GOOGLE_KEY) return res.status(200).json(null);

    // Build query with location context
    const cityMatch = reportText && reportText.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?),?\s*(ON|Ontario|BC|British Columbia|Alberta|AB|Quebec|QC|MB|SK|NS|NB|Canada)\b/);
    const location = cityMatch ? cityMatch[0] : '';
    const searchQuery = vendorName + (location ? ' ' + location : '');

    console.log('Places (New API) searching:', searchQuery);

    // Use the NEW Places API (v1) which matches the key restriction
    const searchResp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.reviews,places.types'
      },
      body: JSON.stringify({ textQuery: searchQuery, maxResultCount: 1 })
    });

    const searchData = await searchResp.json();
    console.log('New Places API status:', searchResp.status, 'places:', searchData.places?.length || 0);

    if (!searchData.places || searchData.places.length === 0) {
      // Retry without location
      if (location) {
        const retry = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.reviews,places.types'
          },
          body: JSON.stringify({ textQuery: vendorName, maxResultCount: 1 })
        });
        const retryData = await retry.json();
        if (!retryData.places || retryData.places.length === 0) {
          console.log('No results found');
          return res.status(200).json(null);
        }
        searchData.places = retryData.places;
      } else {
        return res.status(200).json(null);
      }
    }

    const place = searchData.places[0];
    console.log('Found:', place.displayName?.text, place.formattedAddress);

    return res.status(200).json({
      name: place.displayName?.text || vendorName,
      rating: place.rating || 0,
      reviews: place.userRatingCount || 0,
      address: place.formattedAddress || '',
      phone: place.nationalPhoneNumber || null,
      website: place.websiteUri || null,
      placeId: place.id || null,
      topReviews: (place.reviews || []).slice(0, 3).map(r => ({
        author_name: r.authorAttribution?.displayName || 'Anonymous',
        rating: r.rating || 0,
        text: r.text?.text || ''
      })),
      types: place.types || []
    });

  } catch(err) {
    console.error('Places error:', err.message);
    return res.status(200).json(null);
  }
}
