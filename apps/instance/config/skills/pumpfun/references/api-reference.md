# Pump.fun API Reference

Complete documentation for all Pump.fun API endpoints.

## Base URLs

| API | URL | Purpose |
|-----|-----|---------|
| Frontend API v3 | `https://frontend-api-v3.pump.fun` | Main API (current) |
| Frontend API v2 | `https://frontend-api-v2.pump.fun` | Deprecated |
| Swap API | `https://swap-api.pump.fun` | Token swaps |
| Profile API | `https://profile-api.pump.fun` | User profiles |
| Advanced API | `https://advanced-api-v2.pump.fun` | Analytics |

---

## Authentication

Most endpoints require JWT authentication.

### Headers
```
Authorization: Bearer <JWT>
Accept: application/json
Origin: https://pump.fun
Content-Type: application/json  (for POST/PUT)
```

See [authentication.md](authentication.md) for login flow.

---

## Coins Endpoints

### GET /coins/{mint}
Get detailed information about a specific token.

| Parameter | Type | In | Required | Description |
|-----------|------|-----|----------|-------------|
| `mint` | string | path | Yes | Token mint address |
| `sync` | boolean | query | Yes | Sync latest data |

### GET /coins
List all tokens with filtering.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | Yes | Max results (max 100) |
| `offset` | number | Yes | Pagination offset |
| `sort` | string | Yes | Sort field |
| `order` | string | Yes | `ASC` or `DESC` |
| `searchTerm` | string | Yes | Search query |
| `includeNsfw` | boolean | Yes | Include NSFW |
| `creator` | string | Yes | Filter by creator |
| `complete` | boolean | Yes | Filter graduated |
| `meta` | string | Yes | Meta tag filter |

### GET /coins/search
Search for tokens.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | Yes | Max results |
| `offset` | number | Yes | Pagination |
| `sort` | string | Yes | Sort field |
| `searchTerm` | string | Yes | Search query |
| `order` | string | Yes | `ASC` or `DESC` |
| `includeNsfw` | boolean | Yes | Include NSFW |
| `creator` | string | Yes | Creator filter |
| `complete` | boolean | Yes | Graduated filter |
| `meta` | string | Yes | Meta filter |
| `type` | string | Yes | Type filter |

### GET /coins/king-of-the-hill
Get the current top token.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `includeNsfw` | string | Yes | Include NSFW |

### GET /coins/currently-live
Get tokens with active livestreams.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | Yes | Max results |
| `offset` | number | Yes | Pagination |
| `includeNsfw` | boolean | Yes | Include NSFW |

### GET /coins/for-you
Get personalized recommendations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | Yes | Max results |
| `offset` | number | Yes | Pagination |
| `includeNsfw` | boolean | Yes | Include NSFW |

### GET /coins/featured/{timeWindow}
Get featured tokens by time window.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timeWindow` | string | Yes | `1h`, `6h`, `24h` |
| `limit` | number | Yes | Max results |
| `offset` | number | Yes | Pagination |
| `includeNsfw` | boolean | Yes | Include NSFW |

### GET /coins/user-created-coins/{userId}
Get tokens created by a user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | Yes | User/wallet address |
| `limit` | number | Yes | Max results |
| `offset` | number | Yes | Pagination |

### GET /coins/graduated
Get tokens that have graduated to Raydium.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | Yes | Max results |
| `offset` | number | Yes | Pagination |

### GET /coins/protected
Admin endpoint for protected token list.

### GET /coins/similar
Get similar tokens.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mint` | string | Yes | Reference token |
| `limit` | number | Yes | Max results |

### GET /coins/personalized
Get personalized coins for a user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | Yes | User ID |

### GET /coins/latest
Get the most recently created token.

### GET /coins/is-free-coin/{mint}
Check if a token was created for free.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mint` | string | Yes | Token mint |

### GET /coins/metadata/{mint}
Get token metadata only.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mint` | string | Yes | Token mint |

### GET /coins/top-holders-and-sol-balance/{mint}
Get top holders with their balances.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mint` | string | Yes | Token mint |

### POST /coins/create
Create a new token.

### POST /coins/sign-create-tx
Sign a token creation transaction.

### POST /coins/metadatas
Get metadata for multiple tokens.

### PATCH /coins/ban/{mint}
Admin: Ban a token.

---

## Trades Endpoints

### GET /trades/all/{mint}
Get all trades for a token.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mint` | string | Yes | Token mint |
| `limit` | number | Yes | Max trades |
| `offset` | number | Yes | Pagination |
| `minimumSize` | number | Yes | Min trade size |

### GET /trades/latest
Get the latest trade across all tokens.

### GET /trades/count/{mint}
Get trade count for a token.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mint` | string | Yes | Token mint |
| `minimumSize` | number | Yes | Min trade size |

### GET /trades/followsUserId/{mint}
Get trades from users you follow.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mint` | string | Yes | Token mint |
| `followsUserId` | string | Yes | Your user ID |
| `limit` | number | Yes | Max trades |
| `offset` | number | Yes | Pagination |
| `minimumSize` | number | Yes | Min trade size |

### POST /trades/signatures
Get trades by transaction signatures.

### POST /trades/signatures/small
Get compact trade data by signatures.

---

## Transaction Endpoints

### POST /send-transaction
Submit a signed transaction.

### POST /send-transaction/check-signatures
Check transaction status.

### GET /send-transaction/jito-tip-account
Get Jito tip account for priority transactions.

---

## Auth Endpoints

### POST /auth/login
Authenticate with wallet signature.

Request body: `LoginDto` (wallet signature data)

### POST /auth/logout
End session.

### GET /auth/my-profile
Get current user profile.

### GET /auth/is-admin
Check if user is admin.

### GET /auth/is-super-admin
Check if user is super admin.

### GET /auth/is-valid-jurisdiction
Check if user's location is allowed.

---

## User Endpoints

### GET /users/{id}
Get user profile.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | User ID/address |

### POST /users/register
Register new user.

### POST /users
Update user profile.

### DELETE /users
Delete user account.

---

## Balance Endpoints

### GET /balances/{address}
Get token balances for a wallet.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | Yes | Wallet address |
| `offset` | number | Yes | Pagination |
| `limit` | number | Yes | Max results |
| `minBalance` | number | Yes | Min balance filter |

### POST /balances/index
Trigger balance indexing.

---

## Reply/Comment Endpoints

### GET /replies/{mint}
Get comments for a token.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mint` | string | Yes | Token mint |
| `limit` | number | Yes | Max comments |
| `offset` | number | Yes | Pagination |
| `user` | string | Yes | Filter by user |
| `reverseOrder` | boolean | Yes | Reverse order |

### GET /replies
Get all comments.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | Yes | Max results |
| `offset` | number | Yes | Pagination |

### POST /replies
Create a comment.

Request body: `ReplyDto`

### POST /replies/mints
Get comments for multiple tokens.

Request body: `GetRepliesForMintsDto`
```json
{
  "mints": ["mint1", "mint2"],
  "limit": 10,
  "user": "optional_user",
  "reverseOrder": false
}
```

### GET /replies/user-replies/{address}
Get comments by a user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | Yes | User address |
| `limit` | number | Yes | Max results |
| `offset` | number | Yes | Pagination |

### GET /replies/ban
Check if user is banned from commenting.

---

## IPFS Endpoints

### POST /ipfs/image
Upload image to IPFS.

Content-Type: `multipart/form-data`

### POST /ipfs/token-metadata
Upload token metadata to IPFS.

Request body: `UploadMetadataDto`

---

## Vanity Key Endpoints

### GET /vanity/key
Get vanity key with captcha.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `captchaToken` | string | Yes | Captcha token |

### GET /vanity/random-mint-public-key
Get random mint keypair.

---

## Following Endpoints

### GET /following/{userId}
Get users someone follows.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | Yes | User ID |

### POST /following/{userId}
Follow a user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | Yes | User to follow |
| `captchaToken` | string | Yes | Captcha token |

### DELETE /following/{userId}
Unfollow a user.

### GET /following/followers/{id}
Get user's followers.

### GET /following/mutuals/{id}
Get mutual follows.

---

## Likes Endpoints

### POST /likes/{targetId}
Like a token or comment.

### DELETE /likes/{targetId}
Unlike.

### GET /likes/{targetId}
Get like status.

---

## Bookmark Endpoints

### GET /bookmarks
Get all bookmark lists.

### POST /bookmarks
Create bookmark list.

### GET /bookmarks/{bookmarkId}
Get specific bookmark list.

### PUT /bookmarks/{bookmarkId}
Update bookmark list.

### DELETE /bookmarks/{bookmarkId}
Delete bookmark list.

### GET /bookmarks/default
Get default bookmark list.

### POST /bookmarks/{bookmarkId}/items
Add item to bookmark.

### DELETE /bookmarks/{bookmarkId}/{itemId}
Remove item from bookmark.

### GET /bookmarks/items/{itemId}
Get bookmark status for item.

---

## Notification Endpoints

### GET /notifications
Get notifications.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | Yes | Max results |
| `offset` | number | Yes | Pagination |

---

## Candlestick Endpoints

### GET /candlesticks/{mint}
Get OHLCV chart data.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mint` | string | Yes | Token mint |
| `offset` | number | Yes | Pagination |
| `limit` | number | Yes | Max candles |
| `timeframe` | number | Yes | Interval (seconds) |

---

## Livestream Endpoints

### GET /livestreams/{mint}
Get livestream info for token.

### GET /livestreams/{mint}/raw
Get raw livestream data.

### GET /livestreams/livekit/token/host
Get host token for livestream.

### GET /livestreams/livekit/token/participant
Get participant token.

### POST /livestreams/create-livestream
Create a livestream.

### PUT /livestreams/update-livestream
Update livestream.

### PUT /livestreams/{mint}/disable-livestream
Disable livestream.

### PUT /livestreams/{mint}/enable-livestream
Enable livestream.

### GET /livestreams/stream/livechat-token
Get livechat token.

---

## Utility Endpoints

### GET /health
API health check.

### GET /sol-price
Get current SOL price.

### GET /era
Get current era info.

### GET /eras
Get all eras.

### GET /global-params/{timestamp}
Get global parameters at timestamp.

### GET /metas/current
Get current meta tags.

### GET /metas/search
Search meta tags.

### GET /search
Global search.

---

## Report Endpoints

### POST /reports
Create report.

### GET /reports
Get reports (admin).

### POST /reports/update
Update report.

### DELETE /reports/{id}
Delete report.

---

## Activity Endpoints

### POST /activity/click
Log coin click.

### POST /activity/convert
Log conversion.

### POST /activity/seen
Log seen coins.

---

## Moderation Endpoints (Admin)

### POST /moderation/ban/{id}
Ban user.

### POST /moderation/ban-address/{address}
Ban wallet address.

### GET /moderation/ban-users
Get banned users.

### POST /moderation/ban-terms
Add ban term.

### GET /moderation/ban-terms
Get ban terms.

### DELETE /moderation/ban-terms/{id}
Remove ban term.

### POST /moderation/mark-as-ignored/{id}
Mark report as ignored.

### POST /moderation/mark-as-nsfw/{mint}
Mark token as NSFW.

### POST /moderation/bulk-nsfw
Bulk mark NSFW.

### POST /moderation/add-throttle-exception
Add throttle exception.

### GET /moderation/throttle-exceptions
Get throttle exceptions.

### DELETE /moderation/delete-throttle-exception/{id}
Remove throttle exception.

---

## Wallet Screening

### GET /check/{address}
Screen wallet address.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | Yes | Wallet address |

---

## Rate Limiting

Check response headers:
- `x-ratelimit-limit` - Request limit
- `x-ratelimit-remaining` - Remaining requests
- `x-ratelimit-reset` - Reset timestamp

---

## Error Codes

| Status | Description |
|--------|-------------|
| 200 | Success |
| 201 | Created |
| 304 | Not Modified (caching) |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Server Error |

---

## Caching

Many endpoints support ETag caching:
- Send `If-None-Match: W/"etag-value"` header
- Returns `304 Not Modified` if unchanged
- Reduces bandwidth usage
