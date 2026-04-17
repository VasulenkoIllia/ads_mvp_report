import { useEffect, useState } from 'react';
import {
  Alert, App, Badge, Button, Card, Checkbox, Col, DatePicker, Descriptions, Divider,
  Drawer, Form, Input, Modal, Popconfirm, Progress, Row, Select, Space,
  Table, Tag, Tabs, Typography, message,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, EyeOutlined, LoadingOutlined,
  PlayCircleOutlined, PlusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { accountsApi, type AdsAccount } from '../api/accounts.js';
import { sheetsApi, type ManualRangeRun, type SheetConfig, type SheetExportRun, type SheetPreviewResult } from '../api/sheets.js';
import { AccountSelector } from '../components/AccountSelector.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { PreviewTable } from '../components/PreviewTable.js';
import { StatusTag } from '../components/StatusTag.js';
import { usePolling } from '../hooks/usePolling.js';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

// Only UPSERT is supported — resolveForcedWriteMode() always applies it server-side.
const WRITE_MODE_OPTIONS = [
  { value: 'UPSERT', label: 'Оновлення (UPSERT)' },
];
const DATA_MODE_OPTIONS = [
  { value: 'CAMPAIGN', label: 'По кампаніях' },
  { value: 'DAILY_TOTAL', label: 'Добовий підсумок' },
];
const STATUS_OPTIONS = [
  { value: 'ENABLED', label: '🟢 Активна' },
  { value: 'PAUSED', label: '🟡 Призупинена' },
  { value: 'REMOVED', label: '🔴 Видалена' },
];

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtDateOnly(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDuration(startedAt: string) {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}с`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}хв ${s}с`;
}

/* ─── Live progress panel for active range run ───────────────────────────── */

function ActiveRangeRunPanel({ run }: { run: ManualRangeRun }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const total = run.totalDays || 1;
  const pct = Math.round((run.completedDays / total) * 100);

  return (
    <Card
      size="small"
      style={{ marginBottom: 16, borderColor: '#52c41a', background: '#f6ffed' }}
      title={
        <Space>
          <Badge status="processing" color="#52c41a" />
          <Text strong>Вивантаження в Sheets виконується</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            · {run.completedDays}/{run.totalDays} днів
            {' '}· ✓{run.successDays} ✗{run.failedDays}
            {' '}· {fmtDuration(run.startedAt)}
          </Text>
        </Space>
      }
    >
      <Progress
        percent={pct}
        size="small"
        strokeColor="#52c41a"
        format={(p) => `${p}%`}
      />
      <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
        {run.dateFrom} — {run.dateTo} · {run.spreadsheetId.slice(0, 22)}… · 📄 {run.sheetName}
      </Text>
      {run.errorSummary && (
        <Alert type="warning" message={run.errorSummary} style={{ marginTop: 8, padding: '4px 8px' }} />
      )}
    </Card>
  );
}

function ExportRunStatusTag({ run }: { run: SheetExportRun }) {
  if (run.status === 'SKIPPED') {
    return run.rowsPrepared > 0
      ? <Tag color="success" style={{ fontSize: 11 }}>Актуально</Tag>
      : <Tag color="default" style={{ fontSize: 11 }}>Немає даних</Tag>;
  }
  return <StatusTag value={run.status} small />;
}

/* ─── Config form drawer ─────────────────────────────────────────────────── */

interface ConfigFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: AdsAccount[];
  editing: SheetConfig | null;
}

function ConfigDrawer({ open, onClose, onSaved, accounts, editing }: ConfigFormProps) {
  const [accountId, setAccountId] = useState<string | undefined>();
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [dataMode, setDataMode] = useState('CAMPAIGN');
  const [campaignStatuses, setCampaignStatuses] = useState<string[]>(['ENABLED', 'PAUSED', 'REMOVED']);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (editing) {
      setAccountId(editing.adsAccountId);
      setSpreadsheetId(editing.spreadsheetId);
      setSheetName(editing.sheetName);
      setDataMode(editing.dataMode);
      setCampaignStatuses(editing.campaignStatuses.length > 0 ? editing.campaignStatuses : ['ENABLED', 'PAUSED', 'REMOVED']);
      setActive(editing.active);
    } else {
      setAccountId(undefined); setSpreadsheetId(''); setSheetName('');
      setDataMode('CAMPAIGN');
      setCampaignStatuses(['ENABLED', 'PAUSED', 'REMOVED']); setActive(true);
    }
    setError(null);
  }, [editing, open]);

  async function handleSave() {
    if (!accountId) { void messageApi.warning('Оберіть акаунт'); return; }
    if (!spreadsheetId.trim()) { void messageApi.warning('Введіть Spreadsheet ID'); return; }
    if (!sheetName.trim()) { void messageApi.warning('Введіть назву аркуша'); return; }
    setSaving(true);
    try {
      await sheetsApi.upsertConfig(accountId, {
        configId: editing?.id,
        spreadsheetId: spreadsheetId.trim(),
        sheetName: sheetName.trim(),
        dataMode,
        campaignStatuses,
        active,
      });
      void messageApi.success('Збережено');
      onSaved();
      onClose();
    } catch (e) { setError(e); }
    finally { setSaving(false); }
  }

  return (
    <Drawer
      title={editing ? 'Редагувати конфіг' : 'Новий конфіг'}
      open={open}
      onClose={onClose}
      width={480}
      extra={<Button type="primary" loading={saving} onClick={handleSave}>Зберегти</Button>}
    >
      {contextHolder}
      <ErrorAlert error={error} />
      <Form layout="vertical">
        <Form.Item label="Рекламний акаунт" required>
          <AccountSelector accounts={accounts} value={accountId} onChange={setAccountId} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Spreadsheet ID" required>
          <Input value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} placeholder="1BxiMV…" />
        </Form.Item>
        <Form.Item label="Назва аркуша" required>
          <Input value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Sheet1" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Режим запису">
              <Text type="secondary" style={{ fontSize: 13 }}>UPSERT — оновлення змінених рядків</Text>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Режим даних">
              <Select value={dataMode} onChange={setDataMode} options={DATA_MODE_OPTIONS} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="Статуси кампаній">
          <Checkbox.Group
            options={STATUS_OPTIONS}
            value={campaignStatuses}
            onChange={(v) => setCampaignStatuses(v as string[])}
          />
        </Form.Item>
        <Form.Item label="Активний">
          <Select value={String(active)} onChange={(v) => setActive(v === 'true')} options={[{ value: 'true', label: 'Так' }, { value: 'false', label: 'Ні' }]} style={{ width: 120 }} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

/* ─── Main SheetsPage ─────────────────────────────────────────────────────── */

export function SheetsPage() {
  const { modal } = App.useApp();
  const [accounts, setAccounts] = useState<AdsAccount[]>([]);
  const [configs, setConfigs] = useState<SheetConfig[]>([]);
  const [runs, setRuns] = useState<SheetExportRun[]>([]);
  const [rangeRuns, setRangeRuns] = useState<ManualRangeRun[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SheetConfig | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [messageApi, contextHolder] = message.useMessage();

  // Manual range form
  const [rangeAccountId, setRangeAccountId] = useState<string | undefined>();
  const [rangeSpreadsheetId, setRangeSpreadsheetId] = useState('');
  const [rangeSheetName, setRangeSheetName] = useState('');
  const [rangeDates, setRangeDates] = useState<[Dayjs, Dayjs] | null>(null);
  const [rangeWriteMode, setRangeWriteMode] = useState('UPSERT');
  const [rangeDataMode, setRangeDataMode] = useState('CAMPAIGN');
  const [rangeCampaignStatuses, setRangeCampaignStatuses] = useState<string[]>(['ENABLED', 'PAUSED', 'REMOVED']);
  const [rangeCampaignNameSearch, setRangeCampaignNameSearch] = useState('');
  const [rangeRunning, setRangeRunning] = useState(false);
  const [previewResult, setPreviewResult] = useState<SheetPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // active range run (найновіший RUNNING)
  const activeRangeRun = rangeRuns.find((r) => r.status === 'RUNNING') ?? null;
  const hasRunning = Boolean(activeRangeRun);

  useEffect(() => {
    accountsApi.list({ isInMcc: true }).then((r) => setAccounts(r.items.filter((a) => !a.isManager))).catch(setError);
    void loadConfigs();
    void loadRuns();
    void loadRangeRuns();
  }, []);

  // polling: швидко коли щось виконується, повільно інакше
  usePolling(loadRangeRuns, hasRunning ? 3000 : 30000, true);

  async function loadConfigs() {
    setLoadingConfigs(true);
    try { const r = await sheetsApi.listConfigs(); setConfigs(r.items); }
    catch (e) { setError(e); } finally { setLoadingConfigs(false); }
  }

  async function loadRuns() {
    setLoadingRuns(true);
    try { const r = await sheetsApi.listRuns({ take: 30 }); setRuns(r.items); }
    catch (e) { setError(e); } finally { setLoadingRuns(false); }
  }

  async function loadRangeRuns() {
    try { const r = await sheetsApi.listRangeRuns({ take: 20 }); setRangeRuns(r.items); }
    catch (e) { setError(e); }
  }

  async function handleDeleteConfig(configId: string) {
    try {
      await sheetsApi.deleteConfig(configId);
      void messageApi.success('Конфіг видалено');
      await loadConfigs();
    } catch (e) { setError(e); }
  }

  async function doStartRangeRun() {
    setRangeRunning(true);
    try {
      await sheetsApi.startRangeRun({
        accountId: rangeAccountId!,
        dateFrom: rangeDates![0].format('YYYY-MM-DD'),
        dateTo: rangeDates![1].format('YYYY-MM-DD'),
        spreadsheetId: rangeSpreadsheetId.trim(),
        sheetName: rangeSheetName.trim(),
        writeMode: rangeWriteMode,
        dataMode: rangeDataMode,
        campaignStatuses: rangeCampaignStatuses,
        campaignNameSearch: rangeCampaignNameSearch.trim() || undefined,
      });
      void messageApi.success('Вивантаження запущено у фоні');
      await loadRangeRuns();
    } catch (e) { setError(e); }
    finally { setRangeRunning(false); }
  }

  async function handleStartRangeRun() {
    if (!rangeAccountId || !rangeSpreadsheetId.trim() || !rangeSheetName.trim() || !rangeDates) {
      void messageApi.warning('Заповніть всі поля: акаунт, Spreadsheet ID, назву аркуша і діапазон дат');
      return;
    }
    const totalDays = rangeDates[1].diff(rangeDates[0], 'day') + 1;
    if (totalDays > 30) {
      modal.confirm({
        title: 'Великий діапазон — підтвердіть',
        content: (
          <span>
            Буде вивантажено <b>{totalDays} днів</b> у таблицю.<br />
            Це може тривати кілька хвилин. Продовжити?
          </span>
        ),
        okText: 'Так, запустити',
        cancelText: 'Скасувати',
        okButtonProps: { danger: totalDays > 90 },
        onOk: () => void doStartRangeRun(),
      });
    } else {
      void doStartRangeRun();
    }
  }

  async function handlePreview() {
    if (!rangeAccountId || !rangeDates) {
      void messageApi.warning('Оберіть акаунт та діапазон дат для превью');
      return;
    }
    setPreviewLoading(true);
    try {
      const r = await sheetsApi.preview({
        accountId: rangeAccountId,
        dateFrom: rangeDates[0].format('YYYY-MM-DD'),
        dateTo: rangeDates[1].format('YYYY-MM-DD'),
        dataMode: rangeDataMode,
        campaignStatuses: rangeCampaignStatuses.join(','),
        campaignNameSearch: rangeCampaignNameSearch.trim() || undefined,
        take: 100,
      });
      setPreviewResult(r);
      setPreviewOpen(true);
    } catch (e) { setError(e); }
    finally { setPreviewLoading(false); }
  }

  const configColumns = [
    {
      title: 'Акаунт',
      key: 'account',
      render: (_: unknown, c: SheetConfig) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 13 }}>{c.adsAccount.descriptiveName}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{c.adsAccount.customerId}</Text>
        </Space>
      ),
    },
    {
      title: 'Таблиця / Аркуш',
      key: 'sheet',
      render: (_: unknown, c: SheetConfig) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }} copyable={{ text: c.spreadsheetId }}>{c.spreadsheetId.slice(0, 20)}…</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>📄 {c.sheetName}</Text>
        </Space>
      ),
    },
    {
      title: 'Режим',
      key: 'mode',
      render: (_: unknown, c: SheetConfig) => (
        <Space size={4}>
          <StatusTag value={c.writeMode} small />
          <StatusTag value={c.dataMode} small />
        </Space>
      ),
      responsive: ['md'] as ('md')[],
    },
    {
      title: 'Стан',
      key: 'active',
      render: (_: unknown, c: SheetConfig) => (
        c.active ? <Tag color="success">Активний</Tag> : <Tag>Вимкнено</Tag>
      ),
      width: 90,
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_: unknown, c: SheetConfig) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setEditingConfig(c); setConfigDrawerOpen(true); }} />
          <Popconfirm title="Видалити конфіг?" onConfirm={() => handleDeleteConfig(c.id)} okText="Так" cancelText="Ні">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const rangeRunColumns = [
    {
      title: 'Таблиця',
      key: 'sheet',
      render: (_: unknown, r: ManualRangeRun) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }} copyable={{ text: r.spreadsheetId }}>{r.spreadsheetId.slice(0, 16)}…</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>📄 {r.sheetName}</Text>
        </Space>
      ),
    },
    {
      title: 'Діапазон',
      key: 'range',
      render: (_: unknown, r: ManualRangeRun) => <Text style={{ fontSize: 12 }}>{r.dateFrom} — {r.dateTo}</Text>,
    },
    { title: 'Статус', dataIndex: 'status', key: 'status', width: 110, render: (v: string) => <StatusTag value={v} small /> },
    {
      title: 'Прогрес',
      key: 'progress',
      width: 160,
      render: (_: unknown, r: ManualRangeRun) => {
        const pct = r.totalDays > 0 ? Math.round((r.completedDays / r.totalDays) * 100) : 0;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Progress
              percent={pct}
              size="small"
              strokeColor={r.failedDays > 0 ? '#faad14' : '#52c41a'}
              showInfo={false}
              style={{ marginBottom: 0 }}
            />
            <Text style={{ fontSize: 11 }}>{r.completedDays}/{r.totalDays} днів · ✗{r.failedDays}</Text>
          </Space>
        );
      },
    },
    {
      title: 'Початок',
      dataIndex: 'startedAt',
      key: 'startedAt',
      render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
      responsive: ['md'] as ('md')[],
    },
  ];

  const exportRunColumns = [
    { title: 'Дата', dataIndex: 'runDate', key: 'date', width: 90, render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDateOnly(v)}</Text> },
    { title: 'Статус', key: 'status', width: 110, render: (_: unknown, r: SheetExportRun) => <ExportRunStatusTag run={r} /> },
    { title: 'Рядків', key: 'rows', render: (_: unknown, r: SheetExportRun) => <Text style={{ fontSize: 12 }}>↑{r.rowsWritten} ↻{r.rowsSkipped} ✗{r.rowsFailed}</Text> },
    { title: 'Початок', dataIndex: 'startedAt', key: 'ts', render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>, responsive: ['md'] as ('md')[] },
  ];

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ marginBottom: 16 }}>Вивантаження в Google Sheets</Title>
      <ErrorAlert error={error} />

      <Tabs defaultActiveKey="configs" items={[
        {
          key: 'configs',
          label: 'Конфіги автоекспорту',
          children: (
            <>
              <Space style={{ marginBottom: 12 }}>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => { setEditingConfig(null); setConfigDrawerOpen(true); }}
                >
                  Новий конфіг
                </Button>
                <Button icon={<ReloadOutlined />} onClick={loadConfigs} loading={loadingConfigs}>Оновити</Button>
              </Space>
              <Table
                size="small"
                loading={loadingConfigs}
                dataSource={configs}
                columns={configColumns}
                rowKey="id"
                pagination={{ pageSize: 20, showSizeChanger: false }}
              />
            </>
          ),
        },
        {
          key: 'range',
          label: (
            <Space size={4}>
              Ручне вивантаження
              {hasRunning && <LoadingOutlined style={{ color: '#52c41a', fontSize: 12 }} />}
            </Space>
          ),
          children: (
            <>
              {/* Live progress for active range run */}
              {activeRangeRun && <ActiveRangeRunPanel run={activeRangeRun} />}

              <Card size="small" title="Параметри вивантаження" style={{ marginBottom: 16 }}>
                <Form layout="vertical">
                  <Row gutter={16}>
                    <Col xs={24} md={10}>
                      <Form.Item label="Рекламний акаунт" required>
                        <AccountSelector
                          accounts={accounts}
                          value={rangeAccountId}
                          onChange={setRangeAccountId}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={14}>
                      <Form.Item label="Діапазон дат" required>
                        <RangePicker
                          value={rangeDates}
                          onChange={(v) => setRangeDates(v as [Dayjs, Dayjs] | null)}
                          format="YYYY-MM-DD"
                          style={{ width: '100%' }}
                          disabledDate={(d) => d.isAfter(dayjs().subtract(1, 'day'))}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col xs={24} md={14}>
                      <Form.Item label="Spreadsheet ID" required>
                        <Input value={rangeSpreadsheetId} onChange={(e) => setRangeSpreadsheetId(e.target.value)} placeholder="1BxiMV…" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={10}>
                      <Form.Item label="Назва аркуша" required>
                        <Input value={rangeSheetName} onChange={(e) => setRangeSheetName(e.target.value)} placeholder="Sheet1" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col xs={12} md={6}>
                      <Form.Item label="Режим запису">
                        <Select value={rangeWriteMode} onChange={setRangeWriteMode} options={WRITE_MODE_OPTIONS} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item label="Режим даних">
                        <Select value={rangeDataMode} onChange={setRangeDataMode} options={DATA_MODE_OPTIONS} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="Статуси кампаній">
                        <Checkbox.Group
                          options={STATUS_OPTIONS}
                          value={rangeCampaignStatuses}
                          onChange={(v) => setRangeCampaignStatuses(v as string[])}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col xs={24} md={16}>
                      <Form.Item
                        label="Фільтр по назві кампанії"
                        extra={
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            Залиште порожнім — вивантажити всі. Введіть частину назви — наприклад «DSA» або «Performance Max».
                          </Text>
                        }
                      >
                        <Input
                          value={rangeCampaignNameSearch}
                          onChange={(e) => setRangeCampaignNameSearch(e.target.value)}
                          placeholder="Наприклад: DSA, Performance Max, пошук…"
                          allowClear
                          prefix={<span style={{ color: '#bfbfbf', fontSize: 12 }}>🔍</span>}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Space>
                    <Button icon={<EyeOutlined />} loading={previewLoading} onClick={handlePreview}>
                      Превью
                    </Button>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      loading={rangeRunning}
                      disabled={hasRunning}
                      onClick={handleStartRangeRun}
                    >
                      Вивантажити
                    </Button>
                  </Space>
                </Form>
              </Card>

              <Card
                size="small"
                title="Запущені вивантаження"
                extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadRangeRuns}>Оновити</Button>}
              >
                <Table
                  size="small"
                  dataSource={rangeRuns}
                  columns={rangeRunColumns}
                  rowKey="id"
                  pagination={{ pageSize: 15, showSizeChanger: false }}
                  expandable={{
                    rowExpandable: (r) => Boolean(r.errorSummary),
                    expandedRowRender: (r) => <Alert type="error" message={r.errorSummary} style={{ margin: 0 }} />,
                  }}
                />
              </Card>
            </>
          ),
        },
        {
          key: 'history',
          label: 'Автоматичні запуски',
          children: (
            <>
              <Button icon={<ReloadOutlined />} onClick={loadRuns} loading={loadingRuns} style={{ marginBottom: 12 }}>
                Оновити
              </Button>
              <Table
                size="small"
                loading={loadingRuns}
                dataSource={runs}
                columns={exportRunColumns}
                rowKey="id"
                pagination={{ pageSize: 30, showSizeChanger: false }}
                expandable={{
                  rowExpandable: (r) => Boolean(r.errorSummary),
                  expandedRowRender: (r) => <Alert type="warning" message={r.errorSummary} style={{ margin: 0 }} />,
                }}
              />
            </>
          ),
        },
      ]} />

      {/* Config drawer */}
      <ConfigDrawer
        open={configDrawerOpen}
        onClose={() => setConfigDrawerOpen(false)}
        onSaved={loadConfigs}
        accounts={accounts}
        editing={editingConfig}
      />

      {/* Preview modal */}
      <Modal
        title="Превью даних"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={1000}
      >
        {previewResult && <PreviewTable preview={previewResult} />}
      </Modal>
    </div>
  );
}
