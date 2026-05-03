const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamo, json } = require('../shared/http');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  await dynamo.send(new DeleteCommand({
    TableName: process.env.CONNECTIONS_TABLE,
    Key: { connectionId }
  }));

  return json(200, { ok: true });
};
