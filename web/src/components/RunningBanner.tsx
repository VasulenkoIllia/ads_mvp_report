import { useEffect, useState } from 'react';
import { Alert, Progress, Space, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { ingestionApi, type ActiveIngestionRun } from '../api/ingestion.js';
import { sheetsApi } from '../api/sheets.js';
import { usePolling } from '../hooks/usePolling.js';

const { Text } = Typography;

function fmtDuration(startedAt: string) {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}с`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}хв ${s}с`;
}

export function RunningBanner() {
  const [activeRun, setActiveRun] = useState<ActiveIngestionRun | null>(null);
  const [sheetsRunning, setSheetsRunning] = useState(false);
  const [, setTick] = useState(0); // for elapsed time refresh

  async function checkActive() {
    const [run, sheetsHealth] = await Promise.allSettled([
      ingestionApi.getActiveRun(),
      sheetsApi.getHealth(),
    ]);
    setActiveRun(run.status === 'fulfilled' ? run.value : null);
    if (sheetsHealth.status === 'fulfilled') {
      const h = sheetsHealth.value;
      setSheetsRunning((h.runs?.running ?? 0) > 0);
    }
  }

  const isActive = Boolean(activeRun || sheetsRunning);
  // Швидкий poll (3s) під час виконання, повільний (30s) у холостому режимі
  usePolling(checkActive, isActive ? 3000 : 30000, true);

  // Re-render every second to update elapsed time display
  useEffect(() => {
    if (!activeRun) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeRun]);

  if (!isActive) return null;

  const parts: React.ReactNode[] = [];

  if (activeRun) {
    const total = activeRun.totalAccounts || 1;
    const done = (activeRun.successAccounts ?? 0) + (activeRun.failedAccounts ?? 0) + (activeRun.skippedAccounts ?? 0);
    const pct = Math.round((done / total) * 100);

    parts.push(
      <Space key="ing" size={8} style={{ flexWrap: 'wrap' }}>
        <LoadingOutlined style={{ color: '#1677ff' }} />
        <Text strong>Завантаження виконується</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {done}/{total} акаунтів · {fmtDuration(activeRun.startedAt)}
        </Text>
        <Progress
          percent={pct}
          size="small"
          style={{ width: 120, marginBottom: 0 }}
          showInfo={false}
          strokeColor="#1677ff"
        />
        <Text style={{ fontSize: 12 }}>{pct}%</Text>
      </Space>
    );
  }

  if (sheetsRunning) {
    parts.push(
      <Space key="sheets" size={8}>
        <LoadingOutlined style={{ color: '#52c41a' }} />
        <Text strong>Sheets-експорт виконується</Text>
      </Space>
    );
  }

  return (
    <Alert
      type="info"
      style={{
        margin: '0 16px 12px',
        padding: '6px 12px',
        borderRadius: 6,
      }}
      message={
        <Space split={<span style={{ color: '#d9d9d9' }}>|</span>} wrap>
          {parts}
        </Space>
      }
    />
  );
}
