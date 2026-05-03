import Constants from 'expo-constants';
import { Platform } from 'react-native';

const env = typeof process !== 'undefined' ? process.env || {} : {};
const expoExtra = Constants.expoConfig?.extra || Constants.manifest?.extra || {};

export const captchaConfig = {
  turnstilePublicKey: env.EXPO_PUBLIC_TURNSTILE_PUBLIC_KEY || expoExtra.TURNSTILE_PUBLIC_KEY || env.TURNSTILE_PUBLIC_KEY || ''
};

export function shouldUseTurnstile() {
  return Platform.OS === 'web' && Boolean(captchaConfig.turnstilePublicKey);
}
