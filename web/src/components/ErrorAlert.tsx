import { Alert } from 'antd';
import { ApiError } from '../api/client.js';

interface Props {
  error: unknown;
  style?: React.CSSProperties;
}

export function ErrorAlert({ error, style }: Props) {
  if (!error) return null;

  let message = 'Невідома помилка';
  let description: string | undefined;

  if (error instanceof ApiError) {
    if (error.status === 401) {
      message = 'Сесія закінчилась. Оновіть сторінку та увійдіть знову.';
    } else if (error.status === 404) {
      message = error.message.includes('404') ? error.message : `Не знайдено: ${error.message}`;
    } else {
      message = error.message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  return (
    <Alert
      type="error"
      showIcon
      message={message}
      description={description}
      style={{ marginBottom: 16, ...style }}
    />
  );
}
