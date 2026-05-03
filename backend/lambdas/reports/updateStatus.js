const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { attachPhotoUrls, broadcast, dynamo, json, parseBody, publicReport } = require('../shared/http');

exports.handler = async (event) => {
  try {
    const id = event.pathParameters?.id;
    const body = parseBody(event);
    const status = body.status;

    if (!id) return json(400, { error: 'Report id is required' });
    if (!['valid', 'invalid'].includes(status)) {
      return json(400, { error: 'Status must be valid or invalid' });
    }

    const existing = await dynamo.send(new GetCommand({
      TableName: process.env.REPORTS_TABLE,
      Key: { id }
    }));

    if (!existing.Item) return json(404, { error: 'Report not found' });

    const result = await dynamo.send(new UpdateCommand({
      TableName: process.env.REPORTS_TABLE,
      Key: { id },
      UpdateExpression: 'SET verification_status = :status, verified_at = :verifiedAt',
      ExpressionAttributeValues: {
        ':status': status,
        ':verifiedAt': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    }));

    const [withPhotoUrl] = await attachPhotoUrls([result.Attributes]);
    await broadcast({
      type: 'report_updated',
      report: publicReport(withPhotoUrl)
    });

    return json(200, {
      ok: true,
      item: withPhotoUrl
    });
  } catch (error) {
    console.error(error);
    return json(500, { error: 'Could not update report status' });
  }
};
