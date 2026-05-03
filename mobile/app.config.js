const dotenv = require('dotenv');
const path = require('path');
const appJson = require('./app.json');

dotenv.config({ path: path.join(__dirname, '.env') });

module.exports = ({ config }) => {
  const expoConfig = appJson.expo || {};

  return {
    ...config,
    ...expoConfig,
    extra: {
      ...(config.extra || {}),
      ...(expoConfig.extra || {}),
      GOOGLE_MAP_API: process.env.GOOGLE_MAP_API || process.env.EXPO_PUBLIC_GOOGLE_MAP_API || '',
      TURNSTILE_PUBLIC_KEY: process.env.TURNSTILE_PUBLIC_KEY || process.env.EXPO_PUBLIC_TURNSTILE_PUBLIC_KEY || ''
    }
  };
};
