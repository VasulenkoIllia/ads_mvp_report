import { useEffect, useState } from 'react';
import { Button, Card, Col, Row, Space, Statistic, Typography } from 'antd';
import {
  CheckCircleOutlined, CloudSyncOutlined, DatabaseOutlined, ScheduleOutlined,
} from '@ant-design/icons';
import { accountsApi, type GoogleStatus } from '../api/accounts.js';
import { ingestionApi, type IngestionRun } from '../api/ingestion.js';
import { schedulerApi, type SchedulerHealth } from '../api/scheduler.js';
import { sheetsApi, type SheetExportRun } from '../api/sheets.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { StatusTag } from '../components/StatusTag.js';

const { Title, Text } = Typography;

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtTime(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

type IngHealth = {
  runs: { runningCount: number; lastRun: IngestionRun | null; last24h: Record<string, number> };
  accounts: { eligible: number; withFactsForYesterday: number; missingFactsForYesterday: number };
  throughput: { rowsUpserted24h: number };
};

type ShHealth = {
  configs: { active: number };
  runs: {
    running: number;
    staleRunning: number;
    schedulerAttemptsForYesterday: { date: string; total: number; success: number; failed: number; partial: number; skipped: number; cancelled: number };
    recent: SheetExportRun[];
  };
};

export function OverviewPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [accounts, setAccounts] = useState<{ total: number; enabled: number } | null>(null);
  const [ingHealth, setIngHealth] = useState<IngHealth | null>(null);
  const [sheetsHealth, setSheetsHealth] = useState<ShHealth | null>(null);
  const [schedHealth, setSchedHealth] = useState<SchedulerHealth | null>(null);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function load() {
    try {
      const [accList, ing, sh, sched, gs] = await Promise.all([
        accountsApi.list({ isInMcc: true }),
        ingestionApi.getHealth(),
        sheetsApi.getHealth(),
        schedulerApi.getHealth(),
        accountsApi.getStatus(),
      ]);
      const enabled = accList.items.filter((a) => a.ingestionEnabled && !a.isManager).length;
      setAccounts({ total: accList.items.filter((a) => !a.isManager).length, enabled });
      setIngHealth(ing);
      setSheetsHealth(sh);
      setSchedHealth(sched);
      setGoogleStatus(gs);
    } catch (e) { setError(e); }
  }

  useEffect(() => { void load(); }, []);

  async function handleSync() {
    setSyncing(true);
    try { await accountsApi.syncAccounts(); await load(); } catch (e) { setError(e); } finally { setSyncing(false); }
  }

  const lastIngRun = ingHealth?.runs?.lastRun ?? null;
  const lastShRun = sheetsHealth?.runs?.recent?.[0] ?? null;

  return (
    <div>
      <Space style={{ marginBottom: 24, justifyContent: 'space-between', width: '100%' }}>
        <Title level={4} style={{ margin: 0 }}>Огляд</Title>
        <Button icon={<CloudSyncOutlined />} loading={syncing} onClick={handleSync}>
          Синхронізувати акаунти
        </Button>
      </Space>

      <ErrorAlert error={error} />

      <Row gutter={[16, 16]}>
        {/* OAuth */}
        <Col xs={24} sm={12} md={6}>
          <Card size="small">
            <Statistic
              title="Google OAuth"
              value={googleStatus?.oauth.grantedEmail ?? '—'}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ fontSize: 13 }}
            />
            <Space size={4} style={{ marginTop: 8 }} wrap>
              <StatusTag value={googleStatus?.oauth.status} />
              {googleStatus?.oauth.tokenWarning.shouldWarn && (
                <Text type="warning" style={{ fontSize: 12 }}>
                  ⚠ Токен спливає: {googleStatus.oauth.tokenWarning.daysLeft} дн.
                </Text>
              )}
            </Space>
            {googleStatus?.oauth.refreshTokenExpiresAt && (
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                Дійсний до: {new Date(googleStatus.oauth.refreshTokenExpiresAt).toLocaleDateString('uk-UA')}
              </Text>
            )}
          </Card>
        </Col>

        {/* Accounts */}
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ cursor: 'pointer' }} onClick={() => onNavigate('accounts')}>
            <Statistic
              title="Рекламні акаунти"
              value={accounts?.enabled ?? '—'}
              suffix={accounts ? `/ ${accounts.total}` : ''}
              prefix={<DatabaseOutlined />}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>активних для завантаження</Text>
            {(ingHealth?.accounts?.missingFactsForYesterday ?? 0) > 0 && (
              <Text type="danger" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                ❌ Без даних: {ingHealth!.accounts.missingFactsForYesterday} акаунтів
              </Text>
            )}
            {(ingHealth?.accounts?.missingFactsForYesterday ?? 0) === 0 && accounts?.enabled && (ingHealth?.accounts?.withFactsForYesterday ?? 0) > 0 && (
              <Text type="success" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                ✅ Всі активні акаунти актуальні
              </Text>
            )}
          </Card>
        </Col>

        {/* Ingestion */}
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ cursor: 'pointer' }} onClick={() => onNavigate('ingestion')}>
            <Statistic
              title="Останнє завантаження"
              value={fmtDate(lastIngRun?.startedAt)}
              valueStyle={{ fontSize: 13 }}
            />
            <Space size={4} style={{ marginTop: 6 }} wrap>
              <StatusTag value={lastIngRun?.status} small />
              {lastIngRun && (
                <Text type="secondary" style={{ fontSize: 12 }}>{lastIngRun.rowsUpserted} рядків</Text>
              )}
              {(ingHealth?.runs?.runningCount ?? 0) > 0 && <StatusTag value="RUNNING" small />}
            </Space>
            {(ingHealth?.accounts?.missingFactsForYesterday ?? 0) > 0 && (
              <Text type="danger" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                ⚠ Без даних за вчора: {ingHealth!.accounts.missingFactsForYesterday} акаунтів
              </Text>
            )}
          </Card>
        </Col>

        {/* Sheets */}
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ cursor: 'pointer' }} onClick={() => onNavigate('sheets')}>
            <Statistic
              title="Останній Sheets-експорт"
              value={fmtDate(lastShRun?.startedAt)}
              valueStyle={{ fontSize: 13 }}
            />
            <div style={{ marginTop: 6 }}>
              <StatusTag value={lastShRun?.status} small />
              {(sheetsHealth?.runs?.running ?? 0) > 0 && <StatusTag value="RUNNING" small />}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Scheduler next runs */}
      {schedHealth && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} sm={12}>
            <Card
              size="small"
              title={<Space><ScheduleOutlined /> Планувальник — Завантаження</Space>}
              extra={<StatusTag value={schedHealth.settings.ingestionEnabled ? 'ENABLED' : 'PAUSED'} small />}
            >
              <Space direction="vertical" size={2}>
                <Text>Час запуску: <b>{fmtTime(schedHealth.settings.ingestionHour, schedHealth.settings.ingestionMinute)}</b> (Київ)</Text>
                <Text>Наступний: <b>{fmtDate(schedHealth.runtime.nextIngestionAt)}</b></Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Надолуження: {schedHealth.runtime.catchupDays} дн. · Оновлення: {schedHealth.runtime.refreshDays} дн.
                </Text>
              </Space>
            </Card>
          </Col>
          <Col xs={24} sm={12}>
            <Card
              size="small"
              title={<Space><ScheduleOutlined /> Планувальник — Sheets</Space>}
              extra={<StatusTag value={schedHealth.settings.sheetsEnabled ? 'ENABLED' : 'PAUSED'} small />}
            >
              <Space direction="vertical" size={2}>
                <Text>Час запуску: <b>{fmtTime(schedHealth.settings.sheetsHour, schedHealth.settings.sheetsMinute)}</b> (Київ)</Text>
                <Text>Наступний: <b>{fmtDate(schedHealth.runtime.nextSheetsAt)}</b></Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Активних конфігів: {sheetsHealth?.configs?.active ?? '—'}
                </Text>
              </Space>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
