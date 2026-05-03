export const awsConfig = {
  region: process.env.EXPO_PUBLIC_AWS_REGION || 'ap-south-1',
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || '',
  wsUrl: process.env.EXPO_PUBLIC_WS_URL || '',
  userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID || '',
  userPoolClientId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID || ''
};

export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: awsConfig.userPoolId,
      userPoolClientId: awsConfig.userPoolClientId,
      loginWith: {
        username: true,
        email: true
      }
    }
  }
};
