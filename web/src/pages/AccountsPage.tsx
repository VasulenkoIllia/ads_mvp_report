import { useEffect, useState } from 'react';
import {
  Button, Input, Space, Switch, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import { CheckCircleOutlined, CloudSyncOutlined, ReloadOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons';
import { accountsApi, type AdsAccount } from '../api/accounts.js';
import { campaignsApi } from '../api/campaigns.js';
import { ingestionApi, type CoverageItem } from '../api/ingestion.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { StatusTag } from '../components/StatusTag.js';

const { Title, Text } = Typography;

function CoverageCell({ item, ingestionEnabled }: { item: CoverageItem | undefined; ingestionEnabled: boolean }) {
  if (!ingestionEnabled) {
    return <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>не моніторується</Text>;
  }
  if (!item) {
    return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
  }
  if (!item.lastFactDate) {
    return <Text type="secondary" style={{ fontSize: 12 }}>немає даних</Text>;
  }
  if (item.hasDataForYesterday) {
    return (
      <Space size={4}>
        <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
        <Text style={{ fontSize: 12 }}>{item.lastFactDate}</Text>
      </Space>
    );
  }
  return (
    <Tooltip title={`Відстає на ${item.staleDays ?? 0} дн. від учора`}>
      <Space size={4}>
        <WarningOutlined style={{ color: item.staleDays && item.staleDays > 2 ? '#ff4d4f' : '#faad14', fontSize: 12 }} />
        <Text style={{ fontSize: 12, color: item.staleDays && item.staleDays > 2 ? '#ff4d4f' : '#faad14' }}>
          {item.lastFactDate}
        </Text>
      </Space>
    </Tooltip>
  );
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AdsAccount[]>([]);
  const [coverage, setCoverage] = useState<Map<string, CoverageItem>>(new Map());
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncingCampaigns, setSyncingCampaigns] = useState<string | 'all' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [messageApi, contextHolder] = message.useMessage();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [acctResult, covResult] = await Promise.allSettled([
        accountsApi.list({ isInMcc: true }),
        ingestionApi.getCoverage(),
      ]);
      if (acctResult.status === 'fulfilled') {
        setAccounts(acctResult.value.items.filter((a) => !a.isManager));
      }
      if (covResult.status === 'fulfilled') {
        const map = new Map<string, CoverageItem>();
        for (const item of covResult.value.items) {
          map.set(item.accountId, item);
        }
        setCoverage(map);
      }
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function handleSyncAccounts() {
    setSyncing(true);
    try {
      const r = await accountsApi.syncAccounts();
      void messageApi.success(`Синхронізовано: ${r.total} акаунтів (${r.discovered ?? r.updated ?? 0} оновлено)`);
      await load();
    } catch (e) { setError(e); }
    finally { setSyncing(false); }
  }

  async function handleSyncCampaigns(accountId?: string) {
    setSyncingCampaigns(accountId ?? 'all');
    try {
      const r = await campaignsApi.sync(accountId);
      if ('total' in r) {
        void messageApi.success(`Синхронізовано кампанії: ${r.succeeded}/${r.total} акаунтів`);
      } else {
        void messageApi.success(`Кампанії: ${r.totalSeen} знайдено, ${r.discoveredCount} нових`);
      }
    } catch (e) { setError(e); }
    finally { setSyncingCampaigns(null); }
  }

  async function handleToggleEnabled(account: AdsAccount) {
    try {
      await accountsApi.patch(account.id, { ingestionEnabled: !account.ingestionEnabled });
      setAccounts((prev) => prev.map((a) => a.id === account.id ? { ...a, ingestionEnabled: !a.ingestionEnabled } : a));
    } catch (e) { setError(e); }
  }

  const filtered = accounts.filter((a) =>
    !search || a.descriptiveName.toLowerCase().includes(search.toLowerCase()) || a.customerId.includes(search),
  );

  const columns = [
    {
      title: 'Акаунт',
      key: 'name',
      render: (_: unknown, a: AdsAccount) => (
        <Space direction="vertical" size={0}>
          <Text strong>{a.descriptiveName}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{a.customerId}</Text>
        </Space>
      ),
    },
    {
      title: 'Валюта / ТЗ',
      key: 'currency',
      render: (_: unknown, a: AdsAccount) => (
        <Space size={4}>
          {a.currencyCode && <Tag>{a.currencyCode}</Tag>}
          <Text type="secondary" style={{ fontSize: 12 }}>{a.timeZone ?? '—'}</Text>
        </Space>
      ),
      responsive: ['md'] as ('md')[],
    },
    {
      title: 'Статус Google',
      dataIndex: 'googleStatus',
      key: 'googleStatus',
      render: (v: string) => <StatusTag value={v} />,
    },
    {
      title: 'Дані до',
      key: 'coverage',
      render: (_: unknown, a: AdsAccount) => (
        <CoverageCell item={coverage.get(a.id)} ingestionEnabled={a.ingestionEnabled} />
      ),
    },
    {
      title: 'Завантаження',
      key: 'ingestion',
      render: (_: unknown, a: AdsAccount) => (
        <Tooltip title={a.ingestionEnabled ? 'Вимкнути завантаження' : 'Увімкнути завантаження'}>
          <Switch
            size="small"
            checked={a.ingestionEnabled}
            onChange={() => handleToggleEnabled(a)}
          />
        </Tooltip>
      ),
    },
    {
      title: 'Кампанії',
      key: 'campaigns',
      render: (_: unknown, a: AdsAccount) => (
        <Tooltip title="Синхронізувати кампанії цього акаунту">
          <Button
            size="small"
            icon={<SyncOutlined spin={syncingCampaigns === a.id} />}
            loading={syncingCampaigns === a.id}
            onClick={() => handleSyncCampaigns(a.id)}
          >
            Sync
          </Button>
        </Tooltip>
      ),
    },
  ];

  const enabledCount = filtered.filter((a) => a.ingestionEnabled).length;
  const staleCoverage = [...coverage.values()].filter((c) => !c.hasDataForYesterday && c.lastFactDate !== null);
  const missingCoverage = filtered.filter((a) => a.ingestionEnabled && coverage.has(a.id) && !coverage.get(a.id)!.lastFactDate).length;

  return (
    <div>
      {contextHolder}
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
        <Title level={4} style={{ margin: 0 }}>Рекламні акаунти</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Оновити</Button>
          <Button icon={<CloudSyncOutlined />} onClick={handleSyncAccounts} loading={syncing}>
            Синхронізувати акаунти
          </Button>
          <Button
            icon={<SyncOutlined spin={syncingCampaigns === 'all'} />}
            loading={syncingCampaigns === 'all'}
            onClick={() => handleSyncCampaigns()}
          >
            Sync всі кампанії
          </Button>
        </Space>
      </Space>

      <ErrorAlert error={error} />

      <Input.Search
        placeholder="Пошук по назві або Customer ID…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ maxWidth: 360, marginBottom: 12 }}
        allowClear
      />

      <Table
        size="small"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        rowKey="id"
        pagination={{ pageSize: 30, showSizeChanger: false }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={6}>
              <Text type="secondary">
                Всього: {filtered.length} · Завантаження увімкнено: {enabledCount}
                {staleCoverage.length > 0 && (
                  <> · <Text type="warning" style={{ fontSize: 12 }}>Відстають: {staleCoverage.length}</Text></>
                )}
                {missingCoverage > 0 && (
                  <> · <Text type="danger" style={{ fontSize: 12 }}>Без даних: {missingCoverage}</Text></>
                )}
              </Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </div>
  );
}
