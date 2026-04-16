# Google Ads quota handling (429 RESOURCE_EXHAUSTED)

## Що змінено

При відповіді Google Ads `429 RESOURCE_EXHAUSTED` з `retryDelay` сервіс тепер:

1. Зупиняє поточний ingestion run раніше (без проходу по всіх акаунтах).
2. Повертає API-помилку `429` з кодом `GOOGLE_ADS_QUOTA_EXHAUSTED` і полями:
   - `retryAfterSeconds`
   - `blockedUntil`
   - `requestId`
   - `rateScope`
   - `rateName`
3. Додає preflight cooldown: новий run не стартує, поки не минув `retryDelay` з останнього quota fail.
4. Scheduler враховує фактичний `retryDelay` з `errorSummary` і не робить передчасний retry.

## Навіщо

Google Ads може повертати великі вікна очікування (наприклад `Retry in 4280 seconds`).
Раніше сервіс продовжував робити запити і швидко накопичував багато однакових `429`.
Тепер поведінка контрольована: fail-fast + коректний cooldown.
