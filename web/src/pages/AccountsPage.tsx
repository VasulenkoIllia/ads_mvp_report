import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Empty, Input, Select, Space, Switch, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CheckCircleOutlined, ClearOutlined, CloudSyncOutlined,
  ReloadOutlined, SyncOutlined, WarningOutlined,
} from '@ant-design/icons';
import { accountsApi, type AdsAccount } from '../api/accounts.js';
import { campaignsApi } from '../api/campaigns.js';
import { ingestionApi, type CoverageItem } from '../api/ingestion.js';
import { sheetsApi } from '../api/sheets.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { StatusTag } from '../components/StatusTag.js';

const { Title, Text } = Typography;

/** 0=missing (worst), 1=stale, 2=not-monitored, 3=ok (best) */
function rowPriority(a: AdsAccount, coverage: Map<string, CoverageItem>): number {
  if (!a.ingestionEnabled) return 2;
  const cov = coverage.get(a.id);
  if (!cov?.lastFactDate) return 0;
  if (!cov.hasDataForYesterday) return 1;
  return 3;
}

function getRowClassName(a: AdsAccount, coverage: Map<string, CoverageItem>): string {
  if (!a.ingestionEnabled) return '';
  const cov = coverage.get(a.id);
  if (!cov?.lastFactDate) return 'row-data-missing';
  if (!cov.hasDataForYesterday) return 'row-data-stale';
  return '';
}

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
  const [activeConfigIds, setActiveConfigIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterIngestion, setFilterIngestion] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [filterFreshness, setFilterFreshness] = useState<'all' | 'ok' | 'stale' | 'missing'>('all');
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingCampaigns, setSyncingCampaigns] = useState<string | 'all' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [messageApi, contextHolder] = message.useMessage();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [acctResult, covResult, cfgResult] = await Promise.allSettled([
        accountsApi.list({ isInMcc: true }),
        ingestionApi.getCoverage(),
        sheetsApi.listConfigs({ active: true }),
      ]);
      if (acctResult.status === 'fulfilled') {
        setAccounts(acctResult.value.items.filter((a) => !a.isManager));
      }
      if (covResult.status === 'fulfilled') {
        const map = new Map<string, CoverageItem>();
        for (const item of covResult.value.items) map.set(item.accountId, item);
        setCoverage(map);
      }
      if (cfgResult.status === 'fulfilled') {
        setActiveConfigIds(new Set(cfgResult.value.items.map((c) => c.adsAccountId)));
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

  async function handleBulkToggle(enabled: boolean) {
    setBulkUpdating(true);
    try {
      await Promise.all(selectedRowKeys.map((id) => accountsApi.patch(id, { ingestionEnabled: enabled })));
      setAccounts((prev) => prev.map((a) => selectedRowKeys.includes(a.id) ? { ...a, ingestionEnabled: enabled } : a));
      void messageApi.success(`${enabled ? 'Увімкнено' : 'Вимкнено'} завантаження для ${selectedRowKeys.length} акаунтів`);
      setSelectedRowKeys([]);
    } catch (e) { setError(e); }
    finally { setBulkUpdating(false); }
  }

  const statusOptions = useMemo(() => {
    const unique = [...new Set(accounts.map((a) => a.googleStatus).filter(Boolean))] as string[];
    return unique.sort().map((s) => ({ value: s, label: s }));
  }, [accounts]);

  const filtered = accounts.filter((a) => {
    if (search && !a.descriptiveName.toLowerCase().includes(search.toLowerCase()) && !a.customerId.includes(search)) return false;
    if (filterStatuses.length > 0 && !filterStatuses.includes(a.googleStatus ?? '')) return false;
    if (filterIngestion === 'enabled' && !a.ingestionEnabled) return false;
    if (filterIngestion === 'disabled' && a.ingestionEnabled) return false;
    if (filterFreshness !== 'all') {
      const cov = coverage.get(a.id);
      if (filterFreshness === 'ok' && (!a.ingestionEnabled || !cov?.hasDataForYesterday)) return false;
      if (filterFreshness === 'stale' && (!a.ingestionEnabled || !cov?.lastFactDate || cov.hasDataForYesterday)) return false;
      if (filterFreshness === 'missing' && (!a.ingestionEnabled || cov?.lastFactDate)) return false;
    }
    return true;
  });

  // Sort: problems first (missing → stale → not-monitored → ok)
  const sortedFiltered = useMemo(
    () => [...filtered].sort((a, b) => rowPriority(a, coverage) - rowPriority(b, coverage)),
    [filtered, coverage],
  );

  const hasActiveFilters = Boolean(search || filterStatuses.length > 0 || filterIngestion !== 'all' || filterFreshness !== 'all');

  function resetFilters() {
    setSearch('');
    setFilterStatuses([]);
    setFilterIngestion('all');
    setFilterFreshness('all');
  }

  const emptyText = hasActiveFilters ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <Space direction="vertical" size={4} align="center">
          <Text type="secondary">Нічого не знайдено за вибраними фільтрами</Text>
          <Button size="small" icon={<ClearOutlined />} onClick={resetFilters}>Скинути фільтри</Button>
        </Space>
      }
    />
  ) : undefined;

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
      title: 'Sheets',
      key: 'sheets',
      width: 80,
      render: (_: unknown, a: AdsAccount) => (
        activeConfigIds.has(a.id)
          ? <Tooltip title="Є активний конфіг автоекспорту"><Tag color="blue" style={{ fontSize: 10 }}>Sheets ✓</Tag></Tooltip>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
      ),
      responsive: ['lg'] as ('lg')[],
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
      <style>{`
        tr.row-data-stale > td { background: #fffbe6 !important; }
        tr.row-data-stale:hover > td { background: #fff3ba !important; }
        tr.row-data-missing > td { background: #fff1f0 !important; }
        tr.row-data-missing:hover > td { background: #ffe0de !important; }
      `}</style>
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

      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="Пошук по назві або Customer ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 280 }}
          allowClear
        />
        <Select
          mode="multiple"
          placeholder="Статус Google"
          value={filterStatuses}
          onChange={setFilterStatuses}
          options={statusOptions}
          style={{ minWidth: 160 }}
          allowClear
          maxTagCount="responsive"
        />
        <Select
          value={filterIngestion}
          onChange={setFilterIngestion}
          style={{ width: 190 }}
          options={[
            { value: 'all', label: 'Завантаження: усі' },
            { value: 'enabled', label: 'Завантаження: увімкнено' },
            { value: 'disabled', label: 'Завантаження: вимкнено' },
          ]}
        />
        <Select
          value={filterFreshness}
          onChange={setFilterFreshness}
          style={{ width: 190 }}
          options={[
            { value: 'all', label: 'Дані: усі' },
            { value: 'ok', label: '✅ Дані: актуальні' },
            { value: 'stale', label: '⚠️ Дані: застарілі' },
            { value: 'missing', label: '❌ Дані: відсутні' },
          ]}
        />
        {hasActiveFilters && (
          <Tooltip title="Скинути всі фільтри">
            <Button icon={<ClearOutlined />} onClick={resetFilters} size="small" />
          </Tooltip>
        )}
      </Space>

      {/* Bulk actions bar */}
      {selectedRowKeys.length > 0 && (
        <Alert
          type="info"
          style={{ marginBottom: 12, padding: '6px 12px' }}
          message={
            <Space wrap>
              <Text>Обрано: <b>{selectedRowKeys.length}</b></Text>
              <Button
                size="small"
                type="primary"
                loading={bulkUpdating}
                onClick={() => handleBulkToggle(true)}
              >
                Увімкнути завантаження
              </Button>
              <Button
                size="small"
                danger
                loading={bulkUpdating}
                onClick={() => handleBulkToggle(false)}
              >
                Вимкнути завантаження
              </Button>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>Скасувати</Button>
            </Space>
          }
        />
      )}

      <Table
        size="small"
        loading={loading}
        dataSource={sortedFiltered}
        columns={columns}
        rowKey="id"
        rowClassName={(a) => getRowClassName(a, coverage)}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
          preserveSelectedRowKeys: true,
        }}
        locale={{ emptyText }}
        pagination={{ pageSize: 30, showSizeChanger: false }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={8}>
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
