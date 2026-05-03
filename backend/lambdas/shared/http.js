const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const s3 = new S3Client({});

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  return JSON.parse(body);
}

function signCaptcha({ challengeId, answer, expiresAt }) {
  return crypto
    .createHmac('sha256', process.env.CAPTCHA_SECRET)
    .update(`${challengeId}.${answer}.${expiresAt}`)
    .digest('hex');
}

function createCaptcha() {
  const a = crypto.randomInt(10, 99);
  const b = crypto.randomInt(10, 99);
  const challengeId = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const answer = String(a + b);
  return {
    question: `${a} + ${b} = ?`,
    challengeId,
    expiresAt,
    token: signCaptcha({ challengeId, answer, expiresAt })
  };
}

function verifyCaptcha(captcha, event) {
  if (captcha?.provider === 'turnstile') {
    return verifyTurnstile(captcha, event);
  }

  if (!captcha?.challengeId || !captcha?.token || !captcha?.expiresAt || captcha?.answer == null) {
    return false;
  }
  if (Date.now() > Number(captcha.expiresAt)) return false;
  const answer = String(captcha.answer).trim();
  const expected = signCaptcha({
    challengeId: captcha.challengeId,
    answer,
    expiresAt: captcha.expiresAt
  });
  if (expected.length !== String(captcha.token).length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(captcha.token));
}

async function verifyTurnstile(captcha, event) {
  const token = String(captcha?.token || captcha?.response || '').trim();
  const secret = process.env.TURNSTILE_PRIVATE_KEY || process.env.TURNSTILE_SECRET_KEY || '';

  if (!secret) {
    console.warn('Turnstile secret is missing.');
    return false;
  }

  if (!token || token.length > 2048) {
    return false;
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: getClientIp(event),
        idempotency_key: crypto.randomUUID()
      })
    });

    const result = await response.json();
    if (!result.success) {
      console.warn('Turnstile verification failed', result['error-codes']);
    }
    return Boolean(result.success);
  } catch (error) {
    console.error('Turnstile verification error', error);
    return false;
  }
}

function getClientIp(event) {
  const headers = event?.headers || {};
  const forwardedFor = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (forwardedFor) return String(forwardedFor).split(',')[0].trim();

  return event?.requestContext?.http?.sourceIp || event?.requestContext?.identity?.sourceIp || undefined;
}

function clampDepthCm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(Math.max(0, Math.min(200, numeric)).toFixed(1));
}

function safeString(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

async function scanAll(tableName) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await dynamo.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey
    }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function attachPhotoUrls(items) {
  return Promise.all((items || []).map(async (item) => {
    if (!item.photo_key) return item;
    const command = new GetObjectCommand({
      Bucket: process.env.PHOTOS_BUCKET,
      Key: item.photo_key
    });
    const photoUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return {
      ...item,
      photo_url: photoUrl,
      thumbnail_url: photoUrl
    };
  }));
}

function publicReport(item) {
  return {
    id: item.id,
    name: item.name,
    street: item.street,
    zone: item.zone,
    vehicle_type: item.vehicle_type,
    flood_depth_cm: item.flood_depth_cm,
    remarks: item.remarks,
    gps: item.gps,
    received_at: item.received_at,
    verification_status: item.verification_status
  };
}

async function broadcast(message) {
  if (!process.env.WS_ENDPOINT) return;
  const connections = await scanAll(process.env.CONNECTIONS_TABLE);
  if (!connections.length) return;

  const client = new ApiGatewayManagementApiClient({ endpoint: process.env.WS_ENDPOINT });
  const payload = Buffer.from(JSON.stringify(message));

  await Promise.all(connections.map(async (connection) => {
    try {
      await client.send(new PostToConnectionCommand({
        ConnectionId: connection.connectionId,
        Data: payload
      }));
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 410 || error?.name === 'GoneException') {
        await dynamo.send(new DeleteCommand({
          TableName: process.env.CONNECTIONS_TABLE,
          Key: { connectionId: connection.connectionId }
        }));
      }
    }
  }));
}

module.exports = {
  attachPhotoUrls,
  broadcast,
  clampDepthCm,
  createCaptcha,
  dynamo,
  json,
  parseBody,
  publicReport,
  safeString,
  scanAll,
  s3,
  verifyCaptcha,
  verifyTurnstile
};
