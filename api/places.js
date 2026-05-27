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

    if (!vendorName || vendorName.length < 2) {
      console.log('Places: no vendor name');
      return res.status(200).json(null);
    }

    const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY;
    if (!GOOGLE_KEY) {
      console.log('Places: no API key');
      return res.status(200).json(null);
    }

    // Build search query - try multiple approaches
    const cityMatch = reportText && reportText.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?),?\s*(ON|Ontario|BC|British Columbia|Alberta|AB|Quebec|QC|MB|SK|NS|NB|Canada)\b/);
    const location = cityMatch ? cityMatch[0] : '';
    const searchQuery = vendorName + (location ? ' ' + location : '');

    console.log('Places searching:', searchQuery);

    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&key=${GOOGLE_KEY}`;
    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();

    console.log('Places API status:', searchData.status, 'results:', searchData.results?.length || 0);

    // If no results, try without location
    let place = null;
    if (searchData.results && searchData.results.length > 0) {
      place = searchData.results[0];
    } else if (location) {
      // retry without location
      const retryUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(vendorName)}&key=${GOOGLE_KEY}`;
      const retryResp = await fetch(retryUrl);
      const retryData = await retryResp.json();
      console.log('Places retry status:', retryData.status, 'results:', retryData.results?.length || 0);
      if (retryData.results && retryData.results.length > 0) {
        place = retryData.results[0];
      }
    }

    if (!place) {
      console.log('Places: no results found for', vendorName);
      return res.status(200).json(null);
    }

    console.log('Places found:', place.name, place.formatted_address);

    // Get full details including reviews
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,rating,user_ratings_total,formatted_address,formatted_phone_number,website,reviews,types&key=${GOOGLE_KEY}`;
    const detailResp = await fetch(detailUrl);
    const detailData = await detailResp.json();
    const details = detailData.result || {};

    console.log('Places detail status:', detailData.status, 'reviews:', details.reviews?.length || 0);

    return res.status(200).json({
      name: details.name || place.name,
      rating: details.rating || place.rating || 0,
      reviews: details.user_ratings_total || place.user_ratings_total || 0,
      address: details.formatted_address || place.formatted_address,
      phone: details.formatted_phone_number || null,
      website: details.website || null,
      placeId: place.place_id,
      topReviews: (details.reviews || []).slice(0, 3),
      types: details.types || place.types || []
    });

  } catch(err) {
    console.error('Places error:', err.message);
    return res.status(200).json(null);
  }
}
