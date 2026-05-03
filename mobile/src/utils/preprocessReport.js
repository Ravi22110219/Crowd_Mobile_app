import * as ImageManipulator from 'expo-image-manipulator';
import { clampDepthCm } from './depth';

export async function imageToBase64(asset) {
  if (!asset?.uri) return null;
  const manipulated = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: 1280 } }],
    {
      compress: 0.78,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true
    }
  );

  return {
    base64: manipulated.base64,
    contentType: 'image/jpeg',
    width: manipulated.width,
    height: manipulated.height
  };
}

export async function preprocessReport(form, photoAsset) {
  const photo = await imageToBase64(photoAsset);
  const depthCm = clampDepthCm(form.flood_depth_cm);

  return {
    name: String(form.name || '').trim(),
    phone: String(form.phone || '').trim(),
    street: String(form.street || '').trim(),
    zone: String(form.zone || '').trim(),
    vehicle_type: form.vehicle_type || 'car',
    flood_depth_cm: depthCm,
    remarks: String(form.remarks || '').trim(),
    person_height_cm: form.vehicle_type === 'person' ? Number(form.person_height_cm || 183) : null,
    gps: {
      lat: form.gps?.lat ?? null,
      lon: form.gps?.lon ?? null,
      accuracy: form.gps?.accuracy ?? null
    },
    captcha: form.captcha,
    photo
  };
}
