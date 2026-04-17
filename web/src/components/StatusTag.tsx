import { Tag } from 'antd';

const COLOR: Record<string, string> = {
  // Run statuses
  SUCCESS: 'success', PARTIAL: 'warning', FAILED: 'error',
  RUNNING: 'processing', CANCELLED: 'default', SKIPPED: 'default',
  // Account / campaign statuses
  ENABLED: 'success', PAUSED: 'warning', REMOVED: 'error',
  CLOSED: 'default', UNKNOWN: 'default',
  // OAuth
  CONNECTED: 'success', DISCONNECTED: 'error', NEEDS_REAUTH: 'warning',
  // Sync
  ACTIVE: 'success',
};

const LABEL: Record<string, string> = {
  SUCCESS: 'Успішно', PARTIAL: 'Частково', FAILED: 'Помилка',
  RUNNING: 'Виконується', CANCELLED: 'Скасовано', SKIPPED: 'Пропущено',
  ENABLED: 'Активна', PAUSED: 'Призупинена', REMOVED: 'Видалена',
  CLOSED: 'Закрита', UNKNOWN: 'Невідомо',
  CONNECTED: 'Підключено', DISCONNECTED: 'Відключено', NEEDS_REAUTH: 'Потрібна реавт.',
  MANUAL: 'Вручну', SCHEDULED: 'Автоматично', SYSTEM: 'Система',
  OVERWRITE: 'Перезапис', APPEND: 'Додавання', UPSERT: 'Оновлення',
  CAMPAIGN: 'По кампаніях', DAILY_TOTAL: 'Добовий підсумок',
  ALL: 'Всі колонки', MANUAL_COLS: 'Вибрані',
  ACTIVE: 'Активний',
};

interface Props { value: string | null | undefined; small?: boolean }

export function StatusTag({ value, small }: Props) {
  const v = (value ?? 'UNKNOWN').toUpperCase();
  return (
    <Tag color={COLOR[v] ?? 'default'} style={small ? { fontSize: 11 } : undefined}>
      {LABEL[v] ?? v}
    </Tag>
  );
}
