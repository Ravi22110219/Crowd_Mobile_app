const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { broadcast, dynamo, json, s3 } = require('../shared/http');

exports.handler = async (event) => {
  try {
    const id = event.pathParameters?.id;
    if (!id) return json(400, { error: 'Report id is required' });

    const existing = await dynamo.send(new GetCommand({
      TableName: process.env.REPORTS_TABLE,
      Key: { id }
    }));

    if (!existing.Item) return json(404, { error: 'Report not found' });

    await dynamo.send(new DeleteCommand({
      TableName: process.env.REPORTS_TABLE,
      Key: { id }
    }));

    if (existing.Item.photo_key) {
      await s3.send(new DeleteObjectCommand({
        Bucket: process.env.PHOTOS_BUCKET,
        Key: existing.Item.photo_key
      }));
    }

    await broadcast({
      type: 'report_deleted',
      id
    });

    return json(200, { ok: true, deleted: id });
  } catch (error) {
    console.error(error);
    return json(500, { error: 'Could not delete report' });
  }
};
