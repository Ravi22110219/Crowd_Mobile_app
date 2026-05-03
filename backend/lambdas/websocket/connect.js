const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamo, json } = require('../shared/http');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const ttl = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  await dynamo.send(new PutCommand({
    TableName: process.env.CONNECTIONS_TABLE,
    Item: {
      connectionId,
      connectedAt: new Date().toISOString(),
      ttl
    }
  }));

  return json(200, { ok: true });
};
