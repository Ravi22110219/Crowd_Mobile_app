# AIResQ React Native Mobile App

Expo app for report submission, live flood map overlays, and Cognito-protected admin review.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Fill `.env` with the CDK outputs from `../backend`.

## Screens

- `ReportScreen` - public flood report form with captcha, GPS, photo preprocessing, and constrained decimal depth.
- `LiveMapScreen` - map overlay with live WebSocket updates.
- `AdminScreen` - Cognito login, stats, report verification, deletion, and live new-report updates.

## Reusing in Another React Native App

Import the screen or component you need:

```js
import ReportScreen from './src/screens/ReportScreen';
import LiveMapScreen from './src/screens/LiveMapScreen';
import { airesqApi } from './src/api/airesqApi';
```

The app expects these env values:

```text
EXPO_PUBLIC_AWS_REGION=
EXPO_PUBLIC_API_BASE_URL=
EXPO_PUBLIC_WS_URL=
EXPO_PUBLIC_COGNITO_USER_POOL_ID=
EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=
GOOGLE_MAP_API=
TURNSTILE_PUBLIC_KEY=
```

`TURNSTILE_PRIVATE_KEY` may exist in local `.env` for backend CDK deployment, but it is not exposed through Expo config and must not be used from frontend code.

## Depth Rules

Depth is stored as centimeters with one decimal place. The UI supports:

- meters with decimal input
- feet with decimal input
- centimeters with decimal input
- hard clamp from `0` to `200 cm`

The same constraint is enforced before submit in `src/utils/preprocessReport.js`.
