# Ads MVP Report — Plan повного перероблення

## Стан зараз

| Шар | Що є |
|-----|------|
| Backend | 5 модулів: auth, google, ingestion, sheets, scheduler |
| DB | 13 Prisma-моделей, кампанії існують лише як рядки `CampaignDailyFact` |
| Frontend | 1 файл App.tsx (~2600 рядків), меню-routing через стан |

### Ключові проблеми
- Каталогу кампаній немає — не можна побачити кампанії акаунту до завантаження даних
- Фільтрація по конкретній кампанії при інгестії та експорті відсутня
- Превью (що буде вивантажено) відсутнє
- Весь UI в одному файлі — важко підтримувати та розширювати

---

## Що будуємо

### Нові можливості
1. **Каталог кампаній** — окрема синхронізація з Google Ads, незалежно від інгестії метрик
2. **Перегляд кампаній** — по акаунту: всі кампанії з фільтром по статусу
3. **Цільова інгестія** — можна завантажити дані по конкретній кампанії або групі
4. **Превью даних** — перед вивантаженням в Sheets показуємо таблицю з тим що є в БД
5. **Перероблений UI** — розбитий на окремі файли, зрозумілий, мінімалістичний

---

## Фази реалізації

---

### Фаза 1 — БД: Каталог кампаній
**Файли:** `prisma/schema.prisma`, нова міграція

#### Нова модель `Campaign`
```prisma
model Campaign {
  id                 String   @id @default(cuid())
  adsAccountId       String
  campaignId         String   // Google Ads campaign resource ID
  campaignName       String
  campaignStatus     String   // ENABLED | PAUSED | REMOVED
  advertisingChannel String?  // SEARCH | DISPLAY | SHOPPING | VIDEO | …
  firstSeenAt        DateTime @default(now())
  lastSeenAt         DateTime @default(now())
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  adsAccount AdsAccount @relation(fields: [adsAccountId], references: [id], onDelete: Cascade)

  @@unique([adsAccountId, campaignId])
  @@index([adsAccountId, campaignStatus])
}
```

#### Нова модель `CampaignSyncRun`
```prisma
model CampaignSyncRun {
  id              String        @id @default(cuid())
  adsAccountId    String
  status          SyncRunStatus @default(RUNNING)
  startedAt       DateTime      @default(now())
  finishedAt      DateTime?
  totalSeen       Int           @default(0)
  discoveredCount Int           @default(0)
  updatedCount    Int           @default(0)
  errorSummary    String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  adsAccount AdsAccount @relation(fields: [adsAccountId], references: [id], onDelete: Cascade)

  @@index([adsAccountId, startedAt])
  @@index([status, startedAt])
}
```

**Додати релації до `AdsAccount`:**
```prisma
campaigns       Campaign[]
campaignSyncs   CampaignSyncRun[]
```

---

### Фаза 2 — Backend: Модуль `campaigns/`
**Файли:** `src/modules/campaigns/campaigns.service.ts`, `campaigns.route.ts`

#### GAQL-запит для синхронізації кампаній
```sql
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type
FROM campaign
ORDER BY campaign.name
```
Запит повертає ВСІ кампанії: ENABLED, PAUSED, REMOVED.

#### Функції сервісу
- `syncCampaignsForAccount(accountId)` — завантажує всі кампанії з Google Ads, upsert в `Campaign`
- `syncCampaignsForAllAccounts()` — синхронізує всі активні акаунти
- `listCampaigns(filters)` — перелік кампаній з фільтром по `accountId`, `status`
- `getCampaignSyncHistory(accountId)` — останні синхронізації

#### API endpoints
```
POST /campaigns/sync            — синхронізувати кампанії (один акаунт або всі)
GET  /campaigns                 — список кампаній (?accountId=&status=&q=&take=)
GET  /campaigns/sync-runs       — історія синхронізацій
```

#### Інтеграція
- Після `syncGoogleAdsAccounts()` автоматично запускати `syncCampaignsForAllAccounts()`

---

### Фаза 3 — Backend: Покращення інгестії
**Файли:** `src/modules/ingestion/ingestion.service.ts`, `ingestion.route.ts`

#### Новий параметр `campaignId`
```typescript
export type RunGoogleAdsIngestionParams = {
  // ... існуючі
  campaignId?: string;  // Google Ads campaign ID — якщо задано, завантажуємо лише цю кампанію
};
```

GAQL зміна: додати `AND campaign.id = '${campaignId}'` якщо задано.

#### Endpoint превью даних
```
GET /ingestion/preview?accountId=&dateFrom=&dateTo=&campaignId=&take=100
```
Повертає наявні `CampaignDailyFact` з БД без жодних запитів до Google Ads.

---

### Фаза 4 — Backend: Превью для Sheets
**Файли:** `src/modules/sheets/sheets.service.ts`, `sheets.route.ts`

#### Endpoint
```
GET /sheets/preview?accountId=&dateFrom=&dateTo=&campaignIds=&dataMode=&take=50
```
Виконує `prepareRowsForConfig()` без реального запису в Google Sheets.  
Повертає: `{ columns, rows, totalRows, dateFrom, dateTo }`.

---

### Фаза 5 — Frontend: Повне перероблення
**Файли:** `web/src/**`

#### Нова структура
```
web/src/
├── main.tsx
├── App.tsx                    # Кореневий layout + меню-навігація
│
├── api/                       # API-клієнт (розбитий по доменах)
│   ├── client.ts              # axios instance, interceptors, error handling
│   ├── auth.api.ts
│   ├── accounts.api.ts
│   ├── campaigns.api.ts
│   ├── ingestion.api.ts
│   ├── sheets.api.ts
│   └── scheduler.api.ts
│
├── components/                # Перевикористовувані компоненти
│   ├── StatusTag.tsx          # Кольоровий тег статусу (SUCCESS/FAILED/etc)
│   ├── AccountSelector.tsx    # Select з пошуком по акаунтах
│   ├── CampaignSelector.tsx   # Select кампаній (з фільтром по статусу)
│   ├── DateRangeField.tsx     # Пара datepickers з валідацією
│   ├── ErrorAlert.tsx         # Стандартний блок помилки
│   ├── PreviewTable.tsx       # Таблиця превью даних
│   └── RunStatusCard.tsx      # Картка статусу запуску
│
└── pages/
    ├── OverviewPage.tsx        # Дашборд: ключові метрики, останні запуски
    ├── AccountsPage.tsx        # Список акаунтів, toggle enabled, sync кампаній
    ├── CampaignsPage.tsx       # Кампанії з фільтрами (акаунт, статус, пошук)
    ├── IngestionPage.tsx       # Ручна інгестія, preflight, history
    ├── SheetsPage.tsx          # Конфіги, ручний range-export, history
    └── SchedulerPage.tsx       # Налаштування планувальника
```

#### Ключові UX-рішення
- **Навігація**: Ant Design Menu (вертикальне ліворуч)
- **Мова**: повністю українська
- **Таблиці**: sortable, з пагінацією де потрібно
- **Дії**: підтвердження перед деструктивними операціями
- **Стани**: loading skeleton, empty state, error state для кожного блоку
- **Превью**: перед ручним експортом в Sheets — модальне вікно з таблицею

#### Сторінки детально

**OverviewPage** — швидкий огляд
- Картки: OAuth-статус, кількість акаунтів, остання інгестія, останній sheets-export
- Наступний автозапуск для планувальника
- Кнопка "Синхронізувати акаунти"

**AccountsPage** — управління акаунтами
- Таблиця з колонками: Назва, Customer ID, Валюта, Статус Google, Інгестія вкл/викл, Кампаній
- Кнопка "Синхронізувати кампанії" (для кожного або для всіх)
- Клік → перехід до деталей акаунту

**CampaignsPage** — каталог кампаній
- Фільтри: акаунт, статус (ENABLED/PAUSED/REMOVED), пошук по назві
- Таблиця: Назва, Акаунт, Статус, Тип, Остання дата даних
- Кнопка "Синхронізувати" для поточного акаунту

**IngestionPage** — завантаження даних
- Форма: акаунт (або всі), кампанія (опційно), дата/діапазон
- Кнопка "Preflight" — перевірка без запуску
- Кнопка "Завантажити"
- Таблиця з историєю запусків
- Деталі запуску (акаунти, помилки)

**SheetsPage** — вивантаження в Sheets
- Секція конфігів (per-account): CRUD
- Секція ручного range-export з превью
- Таблиця history запусків

**SchedulerPage** — планувальник
- Форма налаштувань (час, увімк/викл, спроби)
- Поточний стан: наступний запуск, останній запуск

---

### Фаза 6 — Стабільність та полірування
- Error boundary в React
- Автооновлення статусу (polling для запущених операцій)
- Унікальне повідомлення при 404/403 в Sheets
- Перевірка типів TypeScript (backend + frontend)
- Запуск усіх тестів

---

## Порядок реалізації

```
1. prisma/schema.prisma         — нові моделі Campaign + CampaignSyncRun
2. Prisma migration
3. campaigns.service.ts         — syncCampaigns, listCampaigns
4. campaigns.route.ts           — /campaigns/sync, /campaigns
5. ingestion.service.ts         — campaignId фільтр + /ingestion/preview
6. sheets.service.ts            — /sheets/preview
7. Реєстрація нових routes в main.ts
8. web/src/api/*                — API-шар
9. web/src/components/*         — спільні компоненти
10. web/src/pages/*             — всі сторінки
11. web/src/App.tsx             — layout + навігація
12. tsc --noEmit + npm test     — перевірка
```

---

## Що НЕ змінюємо

- Логіка OAuth (auth.service.ts, google.service.ts) — стабільна
- Логіка інгестії метрик (лише додаємо campaignId фільтр)
- Логіка Sheets-запису (лише додаємо preview endpoint)
- Scheduler tick logic (лише UI для нього)
- Prisma моделі для існуючих даних (лише додаємо)
- Docker / deployment конфіги

---

## Документація проекту

### Архітектура
```
Google Ads API
      │
      ▼
[Ingestion Service]  ←──── [Scheduler] ────→  [Sheets Service]
      │                                               │
      ▼                                               ▼
[PostgreSQL / Prisma]                      [Google Sheets API]
      │
      ▼
[Express API v1]
      │
      ▼
[React Frontend]
```

### Потік даних
1. **OAuth** → користувач авторизується через Google, зберігається refresh token (AES-256-GCM)
2. **Account Sync** → `POST /google/accounts/sync` завантажує всі дочірні акаунти MCC
3. **Campaign Sync** → `POST /campaigns/sync` завантажує всі кампанії кожного акаунту
4. **Ingestion** → `POST /ingestion/runs` завантажує `CampaignDailyFact` за вказаний діапазон дат
5. **Scheduler** → автоматично запускає ingestion + sheets export щодня о заданій годині
6. **Sheets Export** → `POST /sheets/runs/manual` або автоматично через конфіг
7. **Preview** → `GET /ingestion/preview` або `GET /sheets/preview` — перегляд без запису

### Моделі DB
| Модель | Призначення |
|--------|-------------|
| GoogleOAuthConnection | OAuth-підключення, refresh token |
| AdsAccount | Рекламні акаунти з MCC |
| Campaign | Каталог кампаній (NEW) |
| CampaignSyncRun | Історія синхронізацій кампаній (NEW) |
| IngestionRun | Запуски завантаження даних |
| IngestionAccountRun | Деталі по кожному акаунту в запуску |
| CampaignDailyFact | Денні метрики кампаній |
| AccountSheetConfig | Конфіги вивантаження в Sheets |
| SheetExportRun | Запуски вивантаження |
| SheetManualRangeRun | Ручні range-вивантаження |
| SheetManualRangeRunDay | Деталі по дням в range-вивантаженні |
| SheetRowState | Стан рядків для UPSERT дедуплікації |
| SchedulerSettings | Налаштування планувальника |

### API Endpoints (після рефакторингу)
```
Auth
  GET  /api/v1/auth/session
  GET  /api/v1/auth/login/start
  POST /api/v1/auth/logout

Google / Accounts
  GET  /api/v1/google/status
  GET  /api/v1/google/oauth/callback
  POST /api/v1/google/accounts/sync
  GET  /api/v1/google/accounts
  PATCH /api/v1/google/accounts/:accountId

Campaigns (NEW)
  POST /api/v1/campaigns/sync
  GET  /api/v1/campaigns
  GET  /api/v1/campaigns/sync-runs

Ingestion
  POST /api/v1/ingestion/runs
  GET  /api/v1/ingestion/preflight
  GET  /api/v1/ingestion/preview      (NEW)
  GET  /api/v1/ingestion/runs
  GET  /api/v1/ingestion/runs/:runId
  GET  /api/v1/ingestion/health

Sheets
  GET  /api/v1/sheets/configs
  PUT  /api/v1/sheets/configs/:accountId
  DELETE /api/v1/sheets/configs/:configId
  POST /api/v1/sheets/runs
  POST /api/v1/sheets/runs/manual
  GET  /api/v1/sheets/preview         (NEW)
  POST /api/v1/sheets/manual-range-runs
  GET  /api/v1/sheets/manual-range-runs
  GET  /api/v1/sheets/manual-range-runs/:runId
  GET  /api/v1/sheets/runs
  GET  /api/v1/sheets/health

Scheduler
  GET  /api/v1/scheduler/settings
  PATCH /api/v1/scheduler/settings
  GET  /api/v1/scheduler/health
```
