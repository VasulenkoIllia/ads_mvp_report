import { useEffect, useState } from 'react';
import { Button, Input, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ClearOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { accountsApi, type AdsAccount } from '../api/accounts.js';
import { campaignsApi, type Campaign } from '../api/campaigns.js';
import { AccountSelector } from '../components/AccountSelector.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { StatusTag } from '../components/StatusTag.js';

const { Title, Text } = Typography;

const CHANNEL_LABELS: Record<string, string> = {
  SEARCH: 'Пошук', DISPLAY: 'Дисплей', SHOPPING: 'Шопінг',
  VIDEO: 'Відео', SMART: 'Розумна', PERFORMANCE_MAX: 'Performance Max',
  MULTI_CHANNEL: 'Мульти-канальна',
};

export function CampaignsPage() {
  const [accounts, setAccounts] = useState<AdsAccount[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    accountsApi.list({ isInMcc: true }).then((r) => setAccounts(r.items.filter((a) => !a.isManager))).catch(setError);
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await campaignsApi.list({ accountId, status, take: 2000 });
      setCampaigns(r.items);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [accountId, status]);

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await campaignsApi.sync(accountId);
      if ('total' in r) {
        void messageApi.success(`Синхронізовано: ${r.succeeded}/${r.total} акаунтів`);
      } else {
        void messageApi.success(`Знайдено ${r.totalSeen}, нових: ${r.discoveredCount}`);
      }
      await load();
    } catch (e) { setError(e); }
    finally { setSyncing(false); }
  }

  const filtered = campaigns.filter((c) => {
    if (search && !c.campaignName.toLowerCase().includes(search.toLowerCase()) && !c.campaignId.includes(search)) return false;
    if (channel && c.advertisingChannel !== channel) return false;
    return true;
  });

  const hasActiveFilters = Boolean(search || accountId || status || channel);

  function resetFilters() {
    setSearch('');
    setAccountId(undefined);
    setStatus(undefined);
    setChannel(undefined);
  }

  const columns = [
    {
      title: 'Кампанія',
      key: 'name',
      render: (_: unknown, c: Campaign) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 13 }}>{c.campaignName}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>ID: {c.campaignId}</Text>
        </Space>
      ),
    },
    {
      title: 'Акаунт',
      key: 'account',
      render: (_: unknown, c: Campaign) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 13 }}>{c.adsAccount.descriptiveName}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{c.adsAccount.customerId}</Text>
        </Space>
      ),
      responsive: ['md'] as ('md')[],
    },
    {
      title: 'Статус',
      dataIndex: 'campaignStatus',
      key: 'status',
      width: 130,
      render: (v: string) => <StatusTag value={v} />,
    },
    {
      title: 'Тип',
      dataIndex: 'advertisingChannel',
      key: 'channel',
      width: 160,
      render: (v: string | null) => v ? <Tag>{CHANNEL_LABELS[v] ?? v}</Tag> : <Text type="secondary">—</Text>,
      responsive: ['lg'] as ('lg')[],
    },
    {
      title: 'Перший раз',
      dataIndex: 'firstSeenAt',
      key: 'firstSeen',
      width: 110,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{new Date(v).toLocaleDateString('uk-UA')}</Text>,
      responsive: ['lg'] as ('lg')[],
    },
    {
      title: 'Оновлено',
      dataIndex: 'lastSeenAt',
      key: 'lastSeen',
      width: 110,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{new Date(v).toLocaleDateString('uk-UA')}</Text>,
      responsive: ['xl'] as ('xl')[],
    },
  ];

  const stats = {
    enabled: filtered.filter((c) => c.campaignStatus === 'ENABLED').length,
    paused: filtered.filter((c) => c.campaignStatus === 'PAUSED').length,
    removed: filtered.filter((c) => c.campaignStatus === 'REMOVED').length,
  };

  return (
    <div>
      {contextHolder}
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
        <Title level={4} style={{ margin: 0 }}>Каталог кампаній</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Оновити</Button>
          <Button
            icon={<SyncOutlined spin={syncing} />}
            loading={syncing}
            onClick={handleSync}
          >
            {accountId ? 'Sync акаунту' : 'Sync всіх'}
          </Button>
        </Space>
      </Space>

      <ErrorAlert error={error} />

      <Space wrap style={{ marginBottom: 12 }}>
        <AccountSelector
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          placeholder="Всі акаунти"
          includeAll
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="Статус кампанії"
          value={status}
          onChange={setStatus}
          style={{ width: 180 }}
          options={[
            { value: 'ENABLED', label: '🟢 Активна' },
            { value: 'PAUSED', label: '🟡 Призупинена' },
            { value: 'REMOVED', label: '🔴 Видалена' },
          ]}
        />
        <Select
          allowClear
          placeholder="Тип кампанії"
          value={channel}
          onChange={setChannel}
          style={{ width: 190 }}
          options={Object.entries(CHANNEL_LABELS).map(([v, l]) => ({ value: v, label: l }))}
        />
        <Input.Search
          placeholder="Пошук по назві або ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 230 }}
          allowClear
        />
        {hasActiveFilters && (
          <Tooltip title="Скинути всі фільтри">
            <Button icon={<ClearOutlined />} onClick={resetFilters} size="small" />
          </Tooltip>
        )}
      </Space>

      <Space size={16} style={{ marginBottom: 12 }}>
        <Text type="secondary">Всього: <b>{filtered.length}</b></Text>
        <Tag color="success">Активних: {stats.enabled}</Tag>
        <Tag color="warning">Пауза: {stats.paused}</Tag>
        <Tag color="error">Видалених: {stats.removed}</Tag>
      </Space>

      <Table
        size="small"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        rowKey="id"
        pagination={{ pageSize: 50, showSizeChanger: false }}
      />
    </div>
  );
}
