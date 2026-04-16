# Ads MVP Report

Google Ads -> DB -> Google Sheets сервіс з мінімальним UI для керування:

1. Авторизація тільки через allowlist Google-акаунтів.
2. Sync підконтрольних MCC акаунтів.
3. Ingestion у БД (ручний за період + авто щодня за вчора з rolling-refresh останніх днів).
4. Export у Sheets (авто-конфіг на рівні акаунту + ручний разовий за період).

## Архітектура MVP

- `Backend`: Node.js + Express + Prisma + PostgreSQL
- `Frontend`: React + Ant Design (вбудований у backend як `web/dist`)
- `Scheduler`: внутрішній tick-планувальник з timezone `Europe/Kyiv`
- `Google OAuth`: refresh token зберігається шифровано

## Доступ і безпека

- Доступ до `/api/v1/*` тільки після логіну Google.
- Дозволені email задаються в `APP_ALLOWED_GOOGLE_EMAILS`.
- Після OAuth callback створюється cookie-сесія `ads_mvp_session`.
- Сесія живе `APP_SESSION_TTL_DAYS` (default `6`), потім обов'язковий повторний логін.
- Увімкнений базовий `rate-limit`:
  - `GET /api/v1/auth/login/start`
  - ключові write-endpoints (manual runs, sync, update settings/configs)
- У production обов'язкові:
  - `APP_ALLOWED_GOOGLE_EMAILS`
  - `APP_SESSION_SECRET`
  - `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`

## Логіка модулів UI

- `Акаунти`: єдине місце для авто-конфігу Sheets (spreadsheet, sheet, поля, режими, active).
- `Завантаження`: ручне ingestion у БД за період + перемикач авто ingestion за вчора.
- `Експорт в Sheets`: ручний експорт за період запускається фоновим backend job (не залежить від вкладки і не змінює авто-конфіг).
- `Планувальник`: cron-параметри ingestion/export та retries/limits.

## Незалежність pipeline

- `Ingestion` (Google Ads -> DB) і `Sheets Export` (DB -> Google Sheets) працюють як 2 незалежні scheduler-процеси.
- Помилка ingestion-тікa не блокує sheets-тік в тому ж scheduler cycle.
- Дані в Sheets завжди залежать від фактичної свіжості БД на момент export.

## Стабільність і захист від гонок

- Строга валідація дат `YYYY-MM-DD` (некоректні дати типу `2026-02-31` відхиляються).
- Захист від race condition при старті ingestion через транзакційний Postgres advisory lock.
- Stale-run auto-fail для ingestion/sheets базується на `updatedAt` (тобто "нема прогресу"), а не лише на `startedAt`.
- Для довгих запусків оновлюється heartbeat/progress у БД під час обробки.
- Для Google Sheets quota `ReadRequestsPerMinutePerUser` додано quota-aware backoff і скорочено зайві read-запити під час export.

## Локальний запуск

1. Встановити залежності:

```bash
npm install
npm run web:install
```

2. Підняти локальну БД (compose для локального тесту):

```bash
docker compose up -d
```

3. Підготувати `.env`:

```bash
cp .env.example .env
```

4. Заповнити Google змінні:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (для локального: `http://localhost:4010/api/v1/google/oauth/callback`)
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_MANAGER_CUSTOMER_ID`
- `APP_ALLOWED_GOOGLE_EMAILS`

5. Ініціалізувати Prisma:

```bash
npm run db:generate
npm run db:migrate:deploy
```

Якщо отримав `P3005` (БД вже не порожня після старого `db push`), зроби baseline один раз:

```bash
npx prisma migrate resolve --applied 20260311_init
npm run db:migrate:deploy
```

6. Зібрати web та запустити API:

```bash
npm run web:build
npm run dev
```

7. Відкрити:

- backend+UI: `http://localhost:4010`
- dev frontend (опційно): `http://localhost:5173` (`npm run web:dev`)

## Прод-режим (Docker + Traefik)

У репозиторії є 2 compose-конфіги:

1. `docker-compose.yml`:
- локальний тестовий PostgreSQL (як зараз).

2. `docker-compose.deploy.yml`:
- прод-розгортання;
- один контейнер `app` (backend + frontend);
- окремий контейнер `db`;
- Traefik labels для домену `adsmvp.workflo.space`;
- timezone у контейнерах `Europe/Kyiv`.

### Деплой-команди

1. Підготувати deploy env:

```bash
cp .env.deploy.example .env.deploy
```

В `.env.deploy` перевір:
- `DEPLOY_CORS_ORIGIN=https://adsmvp.workflo.space`
- `GOOGLE_OAUTH_REDIRECT_URI=https://adsmvp.workflo.space/api/v1/google/oauth/callback`
- `APP_ALLOWED_GOOGLE_EMAILS`, `APP_SESSION_SECRET`, `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`
- за потреби rate-limit:
  - `RATE_LIMIT_AUTH_LOGIN_START_WINDOW_MS`, `RATE_LIMIT_AUTH_LOGIN_START_MAX`
  - `RATE_LIMIT_WRITE_WINDOW_MS`, `RATE_LIMIT_WRITE_MAX`
- `PRISMA_MIGRATE_ON_START=true` (або `false`, якщо міграції застосовуєш вручну)
- `SHEETS_MANUAL_MAX_RANGE_DAYS=180`
- `SCHEDULER_CATCHUP_DAYS=3` (які дні перевіряє scheduler: `-3, -2, -1` від сьогодні)
- `SCHEDULER_REFRESH_DAYS=2` (щодня перевигружає останні 2 дні для актуалізації конверсій)

2. Запустити:

```bash
docker compose -f docker-compose.deploy.yml up -d --build
docker compose -f docker-compose.deploy.yml logs -f app
```

## Production checklist

Перед деплоєм:

1. `npm run check`
2. Перевірити `APP_ALLOWED_GOOGLE_EMAILS`, `APP_SESSION_SECRET`, `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`.
3. Перевірити `GOOGLE_OAUTH_REDIRECT_URI` під прод-домен.
4. Перевірити `CORS_ORIGIN` (наприклад `https://adsmvp.workflo.space`).
5. Переконатись, що в Google Ads MCC потрібні акаунти мають статус `ENABLED`.

## Основні API

- Auth:
  - `GET /api/v1/auth/session`
  - `GET /api/v1/auth/login/start`
  - `POST /api/v1/auth/logout`

- Google:
  - `GET /api/v1/google/status`
  - `GET /api/v1/google/oauth/callback`
  - `POST /api/v1/google/accounts/sync`
  - `GET /api/v1/google/accounts`
  - `PATCH /api/v1/google/accounts/:accountId`

- Ingestion:
  - `POST /api/v1/ingestion/runs`
  - `GET /api/v1/ingestion/preflight`
  - `GET /api/v1/ingestion/runs`
  - `GET /api/v1/ingestion/runs/:runId`
  - `GET /api/v1/ingestion/health`

- Sheets:
  - `GET /api/v1/sheets/configs`
  - `PUT /api/v1/sheets/configs/:accountId`
  - `DELETE /api/v1/sheets/configs/:configId`
  - `POST /api/v1/sheets/runs` (авто-конфіг)
  - `POST /api/v1/sheets/runs/manual` (ручний разовий запуск)
  - `POST /api/v1/sheets/manual-range-runs` (ручний фоновий запуск за період)
  - `GET /api/v1/sheets/manual-range-runs`
  - `GET /api/v1/sheets/manual-range-runs/:runId`
  - `GET /api/v1/sheets/runs`
  - `GET /api/v1/sheets/health`

- Scheduler:
  - `GET /api/v1/scheduler/settings`
  - `PATCH /api/v1/scheduler/settings`
  - `GET /api/v1/scheduler/health`

## Здоров'я сервісу

- `GET /healthz` перевіряє API + підключення до БД.
