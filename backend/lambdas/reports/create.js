const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const {
  attachPhotoUrls,
  broadcast,
  clampDepthCm,
  dynamo,
  json,
  parseBody,
  publicReport,
  safeString,
  s3,
  verifyCaptcha
} = require('../shared/http');

exports.handler = async (event) => {
  try {
    const body = parseBody(event);
    if (!(await verifyCaptcha(body.captcha, event))) {
      return json(400, { error: 'Captcha verification failed' });
    }

    const id = crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    let photoKey = null;

    if (body.photo?.base64) {
      photoKey = `reports/${id}.jpg`;
      await s3.send(new PutObjectCommand({
        Bucket: process.env.PHOTOS_BUCKET,
        Key: photoKey,
        Body: Buffer.from(body.photo.base64, 'base64'),
        ContentType: body.photo.contentType || 'image/jpeg',
        Metadata: {
          source: 'react-native'
        }
      }));
    }

    const item = {
      id,
      name: safeString(body.name, 120),
      phone: safeString(body.phone, 32),
      street: safeString(body.street, 180),
      zone: safeString(body.zone, 180),
      vehicle_type: safeString(body.vehicle_type || 'car', 40),
      flood_depth_cm: clampDepthCm(body.flood_depth_cm),
      remarks: safeString(body.remarks, 1000),
      person_height_cm: body.person_height_cm == null ? null : Number(body.person_height_cm),
      gps: {
        lat: body.gps?.lat == null ? null : Number(body.gps.lat),
        lon: body.gps?.lon == null ? null : Number(body.gps.lon),
        accuracy: body.gps?.accuracy == null ? null : Number(body.gps.accuracy)
      },
      photo_key: photoKey,
      received_at: receivedAt,
      verification_status: 'pending',
      verified_at: null
    };

    await dynamo.send(new PutCommand({
      TableName: process.env.REPORTS_TABLE,
      Item: item
    }));

    const [withPhotoUrl] = await attachPhotoUrls([item]);
    await broadcast({
      type: 'new_submission',
      report: publicReport(withPhotoUrl)
    });

    return json(201, {
      ok: true,
      id,
      item: withPhotoUrl
    });
  } catch (error) {
    console.error(error);
    return json(500, { error: 'Could not submit report' });
  }
};
