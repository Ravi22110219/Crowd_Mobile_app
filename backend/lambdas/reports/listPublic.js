const { json, publicReport, scanAll } = require('../shared/http');

exports.handler = async () => {
  try {
    const items = await scanAll(process.env.REPORTS_TABLE);
    const visible = items
      .filter((item) => item.verification_status !== 'invalid')
      .filter((item) => item.gps?.lat != null && item.gps?.lon != null)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
      .map(publicReport);

    return json(200, {
      count: visible.length,
      items: visible
    });
  } catch (error) {
    console.error(error);
    return json(500, { error: 'Could not load public reports' });
  }
};
