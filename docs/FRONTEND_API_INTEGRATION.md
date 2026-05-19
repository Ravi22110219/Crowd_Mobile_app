# AIResQ Frontend And API Integration Guide

This document is the handoff contract for integrating AIResQ into another product with two separate frontend apps:

- Public reporting app: citizens submit flood reports.
- Admin app: authorized staff review, verify, invalidate, delete, and monitor reports.

The current implementation lives in this repo as one Expo app with two tabs, but the backend and frontend modules are already separable. A partner app can either import/copy the AIResQ modules or call the HTTP/WebSocket APIs directly.

## Current Source Of Truth

| Area | Code path |
| --- | --- |
| API infrastructure and routes | `backend/lib/airesq-native-aws-stack.ts` |
| Public report create Lambda | `backend/lambdas/reports/create.js` |
| Public report list Lambda | `backend/lambdas/reports/listPublic.js` |
| Admin list Lambda | `backend/lambdas/reports/listAdmin.js` |
| Admin status Lambda | `backend/lambdas/reports/updateStatus.js` |
| Admin delete Lambda | `backend/lambdas/reports/delete.js` |
| Shared Lambda helpers, captcha, signed photo URLs, broadcast | `backend/lambdas/shared/http.js` |
| Mobile API wrapper | `mobile/src/api/airesqApi.js` |
| Mobile WebSocket wrapper | `mobile/src/api/liveSocket.js` |
| Mobile Cognito auth wrapper | `mobile/src/auth/cognitoAuth.js` |
| Public report screen | `mobile/src/screens/ReportScreen.js` |
| Admin screen | `mobile/src/screens/AdminScreen.js` |
| Live map screen | `mobile/src/screens/LiveMapScreen.js` |
| Runtime config | `mobile/src/config/awsConfig.js`, `mobile/.env.example` |

## Target Architecture

```text
Public reporting app
  -> POST /reports
  -> GET /captcha or Cloudflare Turnstile token
  -> optional GET /reports/public
  -> optional WebSocket live updates

Admin app
  -> shared login / Cognito session
  -> Authorization: Bearer <admin JWT>
  -> GET /admin/reports
  -> PATCH /admin/reports/{id}/status
  -> DELETE /admin/reports/{id}
  -> optional WebSocket live updates

AIResQ AWS backend
  -> API Gateway HTTP API
  -> API Gateway WebSocket API
  -> Lambda
  -> DynamoDB reports table
  -> S3 private photo bucket
  -> Cognito admin authorizer
```

## Recommended Folder Structure In The Other App

Use this structure when the partner product has two frontend apps in one repository.

```text
partner-product/
  apps/
    public-report/
      src/
        app/
          App.tsx
          navigation/
        features/
          airesq-report/
            ReportPage.tsx
            ReportSuccess.tsx
            validation.ts
        config/
          env.ts
      .env

    admin/
      src/
        app/
          App.tsx
          navigation/
        features/
          airesq-admin/
            AdminReportsPage.tsx
            AdminMapPage.tsx
            ReportDetailsModal.tsx
        auth/
          session.ts
        config/
          env.ts
      .env

  packages/
    airesq-api/
      src/
        client.ts
        liveSocket.ts
        types.ts
        errors.ts
      package.json

    airesq-auth/
      src/
        getAdminToken.ts
        cognitoConfig.ts
        sessionBridge.ts
      package.json

    airesq-ui/
      src/
        ReportCard.tsx
        StatusBadge.tsx
        DepthControl.tsx
        PhotoPicker.tsx
      package.json
```

Use this smaller structure when integrating into one existing app.

```text
src/
  airesq/
    api/
      airesqApi.ts
      liveSocket.ts
      types.ts
    auth/
      getAdminToken.ts
      cognitoAuth.ts
    config/
      airesqConfig.ts
    public/
      ReportScreen.tsx
      preprocessReport.ts
    admin/
      AdminReportsScreen.tsx
      AdminMapScreen.tsx
      ReportDetailsModal.tsx
    components/
      DepthControl.tsx
      PhotoPicker.tsx
      StatusBadge.tsx
      ReportCard.tsx
```

Keep `airesq-api` and `airesq-auth` shared. Keep the public and admin UI separate so the public app does not bundle admin screens, admin routes, or admin-only fields such as phone numbers and signed photo URLs.

## Splitting The Current Mobile App Into Two Apps

The current Expo app uses `mobile/src/navigation/AppNavigator.js` to show both `ReportScreen` and `AdminScreen` in one bottom-tab app. For a two-app deployment, split that shell but keep the shared modules.

### Public Reporting App

The public app should import only the public reporting flow and any public map components.

```text
public-report-app/
  src/
    api/
      airesqPublicApi.ts
    config/
      airesqConfig.ts
    screens/
      ReportScreen.tsx
      LiveMapScreen.tsx
    components/
      CaptchaBox.tsx
      DepthControl.tsx
      PhotoPicker.tsx
      ReferenceSelector.tsx
      MapSurface.tsx
      MapOverlay.tsx
    utils/
      depth.ts
      location.ts
      preprocessReport.ts
```

Public app entry should render `ReportScreen` first. It should not configure Cognito unless another feature in that public app already needs it.

### Admin App

The admin app should import the admin dashboard, shared API client, shared auth provider, and live map.

```text
admin-app/
  src/
    api/
      airesqAdminApi.ts
      liveSocket.ts
    auth/
      getAdminToken.ts
      cognitoAuth.ts
    config/
      airesqConfig.ts
    screens/
      AdminScreen.tsx
      LiveMapScreen.tsx
    components/
      ReportCard.tsx
      StatusBadge.tsx
      MapSurface.tsx
      MapOverlay.tsx
```

Admin app entry must configure the shared auth provider before calling admin APIs. In the current repo this happens in `mobile/App.js` with `Amplify.configure(amplifyConfig)`.

For a clean production split, keep the public API client separate from the admin API client. The current `mobile/src/api/airesqApi.js` imports the Cognito token helper because it serves both tabs; a split public app should avoid importing admin auth code.

## Environment Variables

Values come from `cdk deploy` outputs in `backend/`.

### Shared

```text
AIRESQ_API_BASE_URL=<ApiBaseUrl>
AIRESQ_WS_URL=<WebSocketUrl>
AIRESQ_AWS_REGION=<aws-region>
```

### Public Reporting App

```text
AIRESQ_API_BASE_URL=<ApiBaseUrl>
AIRESQ_WS_URL=<WebSocketUrl, only if showing live public map>
GOOGLE_MAP_API=<google-map-api-key, only if showing map>
TURNSTILE_PUBLIC_KEY=<cloudflare-turnstile-site-key, if Turnstile is enabled>
```

### Admin App

```text
AIRESQ_API_BASE_URL=<ApiBaseUrl>
AIRESQ_WS_URL=<WebSocketUrl>
AIRESQ_AWS_REGION=<aws-region>
AIRESQ_COGNITO_USER_POOL_ID=<CognitoUserPoolId>
AIRESQ_COGNITO_USER_POOL_CLIENT_ID=<CognitoUserPoolClientId>
```

Do not expose `TURNSTILE_PRIVATE_KEY` in frontend apps. It is a backend deployment secret only.

## API Summary

| Method | Path | App | Auth | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/captcha` | Public | None | Get signed math captcha challenge |
| `POST` | `/reports` | Public | None, captcha required | Submit a flood report |
| `GET` | `/reports/public` | Public, Admin map | None | Get map-safe reports |
| `GET` | `/admin/reports?filter=all|pending|valid|invalid` | Admin | Cognito JWT | List all reports with admin fields |
| `PATCH` | `/admin/reports/{id}/status` | Admin | Cognito JWT | Mark report `valid` or `invalid` |
| `DELETE` | `/admin/reports/{id}` | Admin | Cognito JWT | Delete report and photo |
| WebSocket | `AIRESQ_WS_URL` | Public map, Admin | None currently | Receive live report events |

All HTTP requests and responses are JSON. Admin calls must send:

```text
Authorization: Bearer <Cognito ID token>
Content-Type: application/json
```

The current mobile implementation uses the Cognito ID token from `fetchAuthSession()` in `mobile/src/auth/cognitoAuth.js`.

## Public App API Contract

### `GET /captcha`

Use this when the public app is not using Cloudflare Turnstile.

Response:

```json
{
  "question": "42 + 18 = ?",
  "challengeId": "uuid",
  "expiresAt": 1790000000000,
  "token": "hmac"
}
```

Send the returned fields back in `POST /reports` with the user's answer.

### `POST /reports`

Creates a report, stores the photo in private S3, stores metadata in DynamoDB, and broadcasts a `new_submission` WebSocket event.

Request with signed math captcha:

```json
{
  "name": "Asha",
  "phone": "9999999999",
  "street": "MG Road",
  "zone": "Central",
  "vehicle_type": "car",
  "flood_depth_cm": 42.5,
  "remarks": "Water rising near the crossing",
  "person_height_cm": null,
  "gps": {
    "lat": 12.9716,
    "lon": 77.5946,
    "accuracy": 12
  },
  "photo": {
    "base64": "jpeg-base64-without-data-prefix",
    "contentType": "image/jpeg"
  },
  "captcha": {
    "challengeId": "uuid",
    "expiresAt": 1790000000000,
    "token": "hmac-from-captcha",
    "answer": "60"
  }
}
```

Request with Cloudflare Turnstile:

```json
{
  "name": "Asha",
  "phone": "9999999999",
  "street": "MG Road",
  "zone": "Central",
  "vehicle_type": "car",
  "flood_depth_cm": 42.5,
  "remarks": "Water rising near the crossing",
  "person_height_cm": null,
  "gps": {
    "lat": 12.9716,
    "lon": 77.5946,
    "accuracy": 12
  },
  "photo": {
    "base64": "jpeg-base64-without-data-prefix",
    "contentType": "image/jpeg"
  },
  "captcha": {
    "provider": "turnstile",
    "token": "turnstile-client-response-token"
  }
}
```

Successful response:

```json
{
  "ok": true,
  "id": "report-id",
  "item": {
    "id": "report-id",
    "name": "Asha",
    "phone": "9999999999",
    "street": "MG Road",
    "zone": "Central",
    "vehicle_type": "car",
    "flood_depth_cm": 42.5,
    "remarks": "Water rising near the crossing",
    "person_height_cm": null,
    "gps": {
      "lat": 12.9716,
      "lon": 77.5946,
      "accuracy": 12
    },
    "photo_key": "reports/report-id.jpg",
    "photo_url": "temporary-signed-s3-url",
    "thumbnail_url": "temporary-signed-s3-url",
    "received_at": "2026-05-19T10:00:00.000Z",
    "verification_status": "pending",
    "verified_at": null
  }
}
```

Validation and normalization currently enforced by backend:

- `flood_depth_cm` is clamped to `0-200` and rounded to one decimal place.
- String fields are trimmed and length-limited.
- Default `vehicle_type` is `car`.
- New reports start with `verification_status: "pending"`.
- Captcha must be valid before the report is stored.

The current mobile app also preprocesses images before upload in `mobile/src/utils/preprocessReport.js`:

- JPEG format
- resized to width `1280`
- compression `0.78`
- base64 encoded without a data URL prefix

### `GET /reports/public`

Returns map-safe reports for public display. It excludes reports marked `invalid` and excludes reports without GPS coordinates.

Response:

```json
{
  "count": 1,
  "items": [
    {
      "id": "report-id",
      "name": "Asha",
      "street": "MG Road",
      "zone": "Central",
      "vehicle_type": "car",
      "flood_depth_cm": 42.5,
      "remarks": "Water rising near the crossing",
      "gps": {
        "lat": 12.9716,
        "lon": 77.5946,
        "accuracy": 12
      },
      "received_at": "2026-05-19T10:00:00.000Z",
      "verification_status": "pending"
    }
  ]
}
```

Public response intentionally omits `phone`, `photo_key`, `photo_url`, `thumbnail_url`, and `verified_at`.

## Admin App API Contract

Admin routes are protected by API Gateway's Cognito user-pool authorizer. The admin app must send a valid bearer token for the configured user pool/client.

### `GET /admin/reports?filter=all|pending|valid|invalid`

Returns admin-visible reports sorted newest first. The `filter` query parameter is optional and defaults to `all`.

Response:

```json
{
  "count": 1,
  "items": [
    {
      "id": "report-id",
      "name": "Asha",
      "phone": "9999999999",
      "street": "MG Road",
      "zone": "Central",
      "vehicle_type": "car",
      "flood_depth_cm": 42.5,
      "remarks": "Water rising near the crossing",
      "person_height_cm": null,
      "gps": {
        "lat": 12.9716,
        "lon": 77.5946,
        "accuracy": 12
      },
      "photo_key": "reports/report-id.jpg",
      "photo_url": "temporary-signed-s3-url",
      "thumbnail_url": "temporary-signed-s3-url",
      "received_at": "2026-05-19T10:00:00.000Z",
      "verification_status": "pending",
      "verified_at": null
    }
  ]
}
```

`photo_url` and `thumbnail_url` are signed S3 URLs and expire after one hour.

### `PATCH /admin/reports/{id}/status`

Request:

```json
{
  "status": "valid"
}
```

Allowed values are `valid` and `invalid`.

Response:

```json
{
  "ok": true,
  "item": {
    "id": "report-id",
    "verification_status": "valid",
    "verified_at": "2026-05-19T10:05:00.000Z"
  }
}
```

The actual response includes the full updated report item and signed photo URLs when a photo exists.

### `DELETE /admin/reports/{id}`

Deletes the DynamoDB report item and the S3 photo object when present.

Response:

```json
{
  "ok": true,
  "deleted": "report-id"
}
```

## WebSocket Contract

Connect to `AIRESQ_WS_URL`.

Current events:

```json
{
  "type": "new_submission",
  "report": {
    "id": "report-id",
    "street": "MG Road",
    "zone": "Central",
    "flood_depth_cm": 42.5,
    "gps": {
      "lat": 12.9716,
      "lon": 77.5946,
      "accuracy": 12
    },
    "verification_status": "pending"
  }
}
```

```json
{
  "type": "report_updated",
  "report": {
    "id": "report-id",
    "verification_status": "valid"
  }
}
```

```json
{
  "type": "report_deleted",
  "id": "report-id"
}
```

The current frontend listens mainly for `new_submission`. A robust integration should also handle `report_updated` and `report_deleted` so maps and admin lists stay consistent after verification or deletion.

## Shared Auth Integration

### Current Auth Behavior

The current backend creates a Cognito user pool and user-pool app client in `backend/lib/airesq-native-aws-stack.ts`.

Current admin frontend flow:

1. Admin enters username/password.
2. `aws-amplify/auth` signs in against the AIResQ Cognito user pool.
3. `fetchAuthSession()` returns tokens.
4. `mobile/src/auth/cognitoAuth.js` reads `session.tokens.idToken`.
5. `mobile/src/api/airesqApi.js` sends `Authorization: Bearer <idToken>` for admin routes.
6. API Gateway verifies the token with the Cognito authorizer before Lambda runs.

### Requirement: Admin Logs Into Their App Once And Can Access AIResQ Admin APIs

Use one of these auth patterns.

| Pattern | Backend change | Frontend change | When to use |
| --- | --- | --- | --- |
| Same Cognito user pool | None | Their admin app uses the AIResQ user pool/client or already has a session from it | Fastest integration |
| Federated common login into AIResQ Cognito | Cognito IdP configuration may be added | Their login redirects/federates into the AIResQ pool, then use the returned Cognito ID token | Best when they have Google/SAML/OIDC but can trust Cognito as the API token issuer |
| External JWT authorizer | Replace or extend the CDK authorizer | Their admin app sends their existing JWT | Best when they already have a production identity provider and do not want Cognito tokens |
| Backend proxy/BFF | Add a trusted server-side integration | Their frontend calls their backend; their backend calls AIResQ after validating admin session | Best when frontend tokens must not be shared across systems |

For the current code with no backend changes, the partner admin app must use the same Cognito user pool and send the Cognito ID token.

### Shared Auth Implementation Contract

Create one shared token provider in the partner app:

```ts
export type AdminTokenProvider = () => Promise<string>;

export function createAiresqClient(config: {
  apiBaseUrl: string;
  getAdminToken?: AdminTokenProvider;
}) {
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {})
      }
    });

    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(body?.error || `AIResQ API failed: ${response.status}`);
    return body;
  }

  async function adminRequest(path: string, init: RequestInit = {}) {
    if (!config.getAdminToken) throw new Error("AIResQ admin token provider is not configured.");
    const token = await config.getAdminToken();
    return request(path, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
  }

  return {
    getCaptcha: () => request("/captcha"),
    createReport: (payload: unknown) => request("/reports", { method: "POST", body: JSON.stringify(payload) }),
    getPublicReports: () => request("/reports/public"),
    getAdminReports: (filter = "all") => {
      const query = filter && filter !== "all" ? `?filter=${encodeURIComponent(filter)}` : "";
      return adminRequest(`/admin/reports${query}`);
    },
    updateReportStatus: (id: string, status: "valid" | "invalid") => adminRequest(`/admin/reports/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    }),
    deleteReport: (id: string) => adminRequest(`/admin/reports/${encodeURIComponent(id)}`, {
      method: "DELETE"
    })
  };
}
```

If using Amplify with the current Cognito pool:

```ts
import { fetchAuthSession } from "aws-amplify/auth";

export async function getAiresqAdminToken() {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error("Admin session expired.");
  return token;
}
```

If using a different identity provider, the backend authorizer must be updated to trust that provider's issuer and audience before the token can work.

## Frontend Integration Steps

### Public Reporting App

1. Copy or reimplement the API methods from `mobile/src/api/airesqApi.js`.
2. Build the report form using fields from the `POST /reports` contract.
3. Capture GPS with user permission and send `{ lat, lon, accuracy }`.
4. Require a photo before submit if matching current AIResQ behavior.
5. Compress the photo to JPEG and send `photo.base64` without the `data:image/jpeg;base64,` prefix.
6. Use either `GET /captcha` or Cloudflare Turnstile.
7. Clamp depth in the UI to `0-200 cm`; backend also enforces this.
8. Submit to `POST /reports`.
9. Show confirmation after a `201` response.
10. Optionally load `/reports/public` and connect to the WebSocket for a public live map.

### Admin App

1. Configure shared admin auth.
2. Get the admin JWT from the common session.
3. Create the AIResQ API client with `getAdminToken`.
4. Load reports with `GET /admin/reports`.
5. Support filters: `all`, `pending`, `valid`, `invalid`.
6. Display signed `photo_url` when present.
7. Mark reports with `PATCH /admin/reports/{id}/status`.
8. Delete reports with `DELETE /admin/reports/{id}`.
9. Connect to the WebSocket for live `new_submission` events.
10. Handle `report_updated` and `report_deleted` events to keep local state fresh.

## Data Model

### Report Object

| Field | Type | Public response | Admin response | Notes |
| --- | --- | --- | --- | --- |
| `id` | string | Yes | Yes | UUID generated by backend |
| `name` | string | Yes | Yes | Trimmed, max 120 chars |
| `phone` | string | No | Yes | Trimmed, max 32 chars |
| `street` | string | Yes | Yes | Trimmed, max 180 chars |
| `zone` | string | Yes | Yes | Trimmed, max 180 chars |
| `vehicle_type` | string | Yes | Yes | Defaults to `car`; current UI supports `car`, `bike`, `bicycle`, `autorickshaw`, `person` |
| `flood_depth_cm` | number | Yes | Yes | `0-200`, one decimal |
| `remarks` | string | Yes | Yes | Trimmed, max 1000 chars |
| `person_height_cm` | number/null | No | Yes | Used when reference object is `person` |
| `gps.lat` | number/null | Yes | Yes | Public list only returns reports with coordinates |
| `gps.lon` | number/null | Yes | Yes | Public list only returns reports with coordinates |
| `gps.accuracy` | number/null | Yes | Yes | Device-provided accuracy |
| `photo_key` | string/null | No | Yes | Private S3 object key |
| `photo_url` | string | No | Yes | Signed S3 URL, one-hour expiry |
| `thumbnail_url` | string | No | Yes | Same signed URL as `photo_url` currently |
| `received_at` | ISO string | Yes | Yes | Backend generated |
| `verification_status` | `pending`/`valid`/`invalid` | Yes | Yes | New reports start as `pending` |
| `verified_at` | ISO string/null | No | Yes | Set when admin marks valid/invalid |

## Error Format

Most API errors return:

```json
{
  "error": "Human-readable error message"
}
```

Expected client handling:

- `400`: bad request, missing report id, invalid status, or captcha failure.
- `401`/`403`: admin token missing, expired, or not trusted by the authorizer.
- `404`: report not found.
- `500`: backend failure. Show a retry path and log details client-side.

## Security Notes

- Public routes are intentionally unauthenticated but protected against automated submissions by captcha.
- Admin routes must never be called without a bearer token.
- Public UI should not expose admin routes, phone numbers, private S3 keys, or signed photo URLs.
- Signed photo URLs expire after one hour; reload admin report details if an image stops loading.
- `TURNSTILE_PRIVATE_KEY` must stay server-side.
- The WebSocket currently does not require auth and only broadcasts public-safe report fields.
- CORS currently allows all origins in CDK. Tighten `allowOrigins` before production if the consuming domains are known.

## Backend Changes Needed For Different Common Auth

If the other admin app cannot use the current AIResQ Cognito user pool, update `backend/lib/airesq-native-aws-stack.ts`:

1. Add or replace the current `HttpUserPoolAuthorizer`.
2. Configure the trusted issuer and audience for the partner identity provider.
3. Attach the new authorizer to:
   - `GET /admin/reports`
   - `PATCH /admin/reports/{id}/status`
   - `DELETE /admin/reports/{id}`
4. Keep public routes without auth.
5. Redeploy and share the updated issuer/audience/token rules with the admin frontend team.

The frontend contract should remain `Authorization: Bearer <admin JWT>` even if the JWT issuer changes.

## Quick Integration Checklist

- API base URL added to both apps.
- WebSocket URL added where live updates are needed.
- Public app submits `POST /reports` with captcha and photo.
- Admin app sends `Authorization: Bearer <token>` on every `/admin/*` request.
- Admin app can list, filter, validate, invalidate, and delete reports.
- Admin app handles expired signed photo URLs.
- Public map uses `/reports/public`, not `/admin/reports`.
- Shared auth issuer is confirmed before development starts.
- `TURNSTILE_PRIVATE_KEY` is configured only during backend deployment.
- Production CORS origins are decided before launch.
