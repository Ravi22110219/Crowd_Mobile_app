# AIResQ AWS Backend

Node.js serverless backend for the React Native flood reporting app.

## Deploy

```bash
npm install
npm run build
npx cdk bootstrap
npx cdk deploy
```

## Monitoring and Cost Controls

The CDK stack creates monitoring for the AIResQ serverless backend:

- `Project=AIResQ`, `Environment=demo`, and `ManagedBy=AWS-CDK` tags on supported resources.
- A CloudWatch dashboard for API Gateway, Lambda, DynamoDB, S3 photo storage, and WebSocket usage.
- CloudWatch alarms for Lambda errors, HTTP API 5xx errors, and DynamoDB throttling.
- An SNS email alert topic for operational alarms.
- An AWS Budget for AIResQ-tagged backend service costs.
- AWS Cost Anomaly Detection for AIResQ-tagged spend.

Default alerts go to `demo@airesqclimsols.com`, with a `$25` monthly budget and `$5` anomaly threshold. Override them at deploy time:

```bash
npx cdk deploy \
  -c alertEmail=ops@example.com \
  -c monthlyBudgetUsd=25 \
  -c anomalyThresholdUsd=5
```

After deploy, confirm the SNS subscription email so CloudWatch alarm alerts are delivered. Activate the `Project` and `Environment` cost allocation tags in AWS Billing and Cost Management so the budget and anomaly monitor can separate AIResQ costs from other account usage. Cost Explorer and budget data can take around 24 hours to appear.

## Turnstile Captcha

Report submission supports Cloudflare Turnstile verification for web clients. The frontend sends the Turnstile token, and `CreateReportFn` validates it server-side with Cloudflare before saving the report.

Set the secret before deploying the backend:

```bash
TURNSTILE_PRIVATE_KEY=<cloudflare-turnstile-secret> npm run deploy
```

You can also pass it with CDK context:

```bash
npx cdk deploy -c turnstilePrivateKey=<cloudflare-turnstile-secret>
```

For local development, the CDK stack also reads `../mobile/.env` as a fallback. Only `TURNSTILE_PUBLIC_KEY` should be exposed to the frontend; never call Cloudflare Siteverify from frontend code.

## CDK Outputs

Copy these outputs into `../mobile/.env`:

```text
EXPO_PUBLIC_AWS_REGION=<aws-region>
EXPO_PUBLIC_API_BASE_URL=<ApiBaseUrl>
EXPO_PUBLIC_WS_URL=<WebSocketUrl>
EXPO_PUBLIC_COGNITO_USER_POOL_ID=<CognitoUserPoolId>
EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=<CognitoUserPoolClientId>
```

## API Contract

### `GET /captcha`

Public. Returns a signed math captcha challenge.

```json
{
  "question": "42 + 18 = ?",
  "challengeId": "uuid",
  "expiresAt": 1730000000000,
  "token": "hmac"
}
```

### `POST /reports`

Public. Verifies captcha, stores photo in S3, saves report in DynamoDB, broadcasts over WebSocket.

```json
{
  "name": "Asha",
  "phone": "9999999999",
  "street": "MG Road",
  "zone": "Central",
  "vehicle_type": "car",
  "flood_depth_cm": 42.5,
  "remarks": "Water rising",
  "gps": { "lat": 12.9716, "lon": 77.5946, "accuracy": 12 },
  "photo": {
    "base64": "jpeg-base64-without-data-prefix",
    "contentType": "image/jpeg"
  },
  "captcha": {
    "challengeId": "uuid",
    "expiresAt": 1730000000000,
    "token": "hmac",
    "answer": "60"
  }
}
```

### `GET /reports/public`

Public. Returns map-safe reports, excluding invalid reports.

### `GET /admin/reports?filter=all|pending|valid|invalid`

Cognito protected. Returns admin reports with temporary signed S3 photo URLs.

### `PATCH /admin/reports/{id}/status`

Cognito protected.

```json
{ "status": "valid" }
```

### `DELETE /admin/reports/{id}`

Cognito protected. Deletes the report and its S3 photo.

## WebSocket Events

Connect the app to `WebSocketUrl`.

```json
{ "type": "new_submission", "report": { "...": "..." } }
{ "type": "report_updated", "report": { "...": "..." } }
{ "type": "report_deleted", "id": "report-id" }
```

## Create First Admin User

After deploy, create a Cognito user in the AWS Console or CLI:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <CognitoUserPoolId> \
  --username admin@example.com \
  --user-attributes Name=email,Value=admin@example.com Name=email_verified,Value=true
```

Then set a permanent password:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id <CognitoUserPoolId> \
  --username admin@example.com \
  --password 'ChangeMe12345' \
  --permanent
```
