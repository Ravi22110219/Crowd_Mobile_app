import * as Location from 'expo-location';

export async function getCurrentGps() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    return {
      gps: { lat: null, lon: null, accuracy: null },
      label: 'GPS permission denied',
      status: 'error'
    };
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest
  });

  const accuracy = position.coords.accuracy ?? null;
  const status = accuracy != null && accuracy <= 30 ? 'success' : 'warning';

  return {
    gps: {
      lat: Number(position.coords.latitude.toFixed(6)),
      lon: Number(position.coords.longitude.toFixed(6)),
      accuracy: accuracy == null ? null : Number(accuracy.toFixed(2))
    },
    label: accuracy == null ? 'GPS acquired' : `GPS accuracy +/-${Math.round(accuracy)}m`,
    status
  };
}
