# AIResQ Native AWS App

This folder contains a React Native mobile app and a Node.js AWS backend for the flood reporting workflow.

## Architecture

```text
React Native app
  -> API Gateway HTTP API
  -> Lambda Node.js
  -> DynamoDB reports table + S3 photo bucket
  -> API Gateway WebSocket API for live admin/map updates

Admin auth
  React Native admin screen -> Cognito -> protected API Gateway routes
```

## Folders

- `mobile/` - Expo React Native app with reusable screens and components.
- `backend/` - AWS CDK app plus Node.js Lambda handlers.

## Main Workflows

1. A reporter opens the mobile app report form.
2. The app requests a signed captcha challenge from `GET /captcha`.
3. The reporter fills location, reference object, decimal depth, optional photo, and captcha answer.
4. The app preprocesses the report:
   - clamps depth to `0-200 cm`
   - preserves decimal depth values
   - normalizes unit values into centimeters
   - compresses the image before upload
   - attaches GPS accuracy metadata
5. `POST /reports` verifies captcha, stores the photo in S3, stores report metadata in DynamoDB, and pushes a WebSocket event.
6. Live map/admin screens receive the event instantly and update overlays/cards.
7. Admin signs in with Cognito and calls protected routes for listing, verification, and deletion.

## Services Used

- AWS CDK
- Amazon API Gateway HTTP API
- Amazon API Gateway WebSocket API
- AWS Lambda with Node.js
- Amazon DynamoDB
- Amazon S3
- Amazon Cognito
- Amazon CloudWatch
- IAM least-privilege roles

## Deploy Backend

```bash
cd airesq-native-aws/backend
npm install
npm run build
npx cdk bootstrap
npx cdk deploy
```

After deploy, copy the CDK outputs into `mobile/.env`.

## Run Mobile

```bash
cd airesq-native-aws/mobile
npm install
cp .env.example .env
npm start
```

## Integration Notes

The mobile app is intentionally componentized so another React Native app can import:

- `src/screens/ReportScreen.js`
- `src/screens/LiveMapScreen.js`
- `src/screens/AdminDashboardScreen.js`
- `src/api/airesqApi.js`
- `src/components/*`

Set the API endpoints in `src/config/awsConfig.js` or `.env`.
