const { attachPhotoUrls, json, scanAll } = require('../shared/http');

exports.handler = async (event) => {
  try {
    const filter = event.queryStringParameters?.filter || 'all';
    const items = await scanAll(process.env.REPORTS_TABLE);
    const filtered = (filter === 'all'
      ? items
      : items.filter((item) => (item.verification_status || 'pending') === filter))
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at));

    const withUrls = await attachPhotoUrls(filtered);

    return json(200, {
      count: withUrls.length,
      items: withUrls
    });
  } catch (error) {
    console.error(error);
    return json(500, { error: 'Could not load admin reports' });
  }
};
