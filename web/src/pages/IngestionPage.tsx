import { useEffect, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, DatePicker, Descriptions, Divider,
  Drawer, Form, Modal, Progress, Row, Space, Switch, Table, Tag, Typography, message, App,
} from 'antd';
import { PlayCircleOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { accountsApi, type AdsAccount } from '../api/accounts.js';
import { campaignsApi, type Campaign } from '../api/campaigns.js';
import { ingestionApi, type ActiveIngestionRun, type CampaignDailyFact, type IngestionRun } from '../api/ingestion.js';
import { AccountSelector } from '../components/AccountSelector.js';
import { CampaignSelector } from '../components/CampaignSelector.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { StatusTag } from '../components/StatusTag.js';
import { usePolling } from '../hooks/usePolling.js';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
}

// Для полів типу runDate (тільки дата, без часу)
function fmtDateOnly(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDuration(startedAt: string) {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}с`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}хв ${s}с`;
}

/* ─── Live progress panel ────────────────────────────────────────────────── */

function ActiveRunPanel({ run }: { run: ActiveIngestionRun }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const total = run.totalAccounts || 1;
  const done = (run.successAccounts ?? 0) + (run.failedAccounts ?? 0) + (run.skippedAccounts ?? 0);
  const pct = Math.round((done / total) * 100);

  const accountRunColumns = [
    {
      title: 'Акаунт',
      key: 'acc',
      render: (_: unknown, r: ActiveIngestionRun['accountRuns'][number]) =>
        `${r.adsAccount.descriptiveName} (${r.adsAccount.customerId})`,
      ellipsis: true,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v: string) => <StatusTag value={v} small />,
    },
    {
      title: 'Рядків',
      dataIndex: 'rowsUpserted',
      key: 'rows',
      width: 70,
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 16, borderColor: '#1677ff', background: '#f0f7ff' }}
      title={
        <Space>
          <Badge status="processing" />
          <Text strong>Завантаження виконується</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            · {done}/{run.totalAccounts} акаунтів · {fmtDuration(run.startedAt)}
            · ✓{run.successAccounts} ✗{run.failedAccounts} ⊘{run.skippedAccounts}
          </Text>
        </Space>
      }
    >
      <Progress
        percent={pct}
        size="small"
        strokeColor="#1677ff"
        style={{ marginBottom: 8 }}
        format={(p) => `${p}%`}
      />
      {run.accountRuns.length > 0 && (
        <Table
          size="small"
          dataSource={[...run.accountRuns].slice(0, 20)}
          columns={accountRunColumns}
          rowKey="id"
          pagination={false}
          scroll={{ y: 200 }}
          expandable={{
            rowExpandable: (r) => Boolean(r.errorSummary),
            expandedRowRender: (r) => <Alert type="error" message={r.errorSummary} style={{ margin: 0 }} />,
          }}
        />
      )}
    </Card>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export function IngestionPage() {
  const { modal } = App.useApp();
  const [accounts, setAccounts] = useState<AdsAccount[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [activeRun, setActiveRun] = useState<ActiveIngestionRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<(IngestionRun & { accountRuns: unknown[] }) | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<CampaignDailyFact[] | null>(null);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [messageApi, contextHolder] = message.useMessage();

  // form state
  const [accountId, setAccountId] = useState<string | undefined>();
  const [campaignId, setCampaignId] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  useEffect(() => {
    accountsApi.list({ isInMcc: true }).then((r) => setAccounts(r.items.filter((a) => !a.isManager))).catch(setError);
    void loadRuns();
  }, []);

  // load campaigns when account changes
  useEffect(() => {
    if (!accountId) { setCampaigns([]); setCampaignId(undefined); return; }
    setCampaignsLoading(true);
    campaignsApi.list({ accountId, take: 2000 })
      .then((r) => setCampaigns(r.items))
      .catch(setError)
      .finally(() => setCampaignsLoading(false));
  }, [accountId]);

  // poll active run while something is running
  const isRunning = activeRun !== null || runs.some((r) => r.status === 'RUNNING');

  usePolling(
    async () => {
      const active = await ingestionApi.getActiveRun().catch(() => null);
      setActiveRun(active);
      if (!active) {
        // If run just finished, refresh the history list
        void loadRuns();
      }
    },
    3000,
    isRunning,
  );

  async function loadRuns() {
    setLoading(true);
    try {
      const r = await ingestionApi.listRuns({ take: 30 });
      setRuns(r.items);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }

  async function handlePreflight() {
    setPreflighting(true);
    setError(null);
    try {
      const params = {
        accountId,
        includeInactiveAccounts: includeInactive,
        ...(dateRange ? { dateFrom: dateRange[0].format('YYYY-MM-DD'), dateTo: dateRange[1].format('YYYY-MM-DD') } : {}),
      };
      const r = await ingestionApi.preflight(params);
      if (r.canRun) {
        void messageApi.success(`Готово: ${r.limits.selectedAccounts} акаунтів, ${r.runWindow.totalDays} днів`);
      } else {
        void messageApi.warning(`Не можна запустити: ${r.reason}`);
      }
    } catch (e) { setError(e); }
    finally { setPreflighting(false); }
  }

  async function doRun() {
    setRunning(true);
    setError(null);
    try {
      const params = {
        accountId,
        campaignId,
        includeInactiveAccounts: includeInactive,
        ...(dateRange ? { dateFrom: dateRange[0].format('YYYY-MM-DD'), dateTo: dateRange[1].format('YYYY-MM-DD') } : {}),
      };
      await ingestionApi.run(params);
      void messageApi.success('Завантаження запущено');
      const active = await ingestionApi.getActiveRun().catch(() => null);
      setActiveRun(active);
      await loadRuns();
    } catch (e) { setError(e); }
    finally { setRunning(false); }
  }

  async function handleRun() {
    const totalDays = dateRange
      ? dateRange[1].diff(dateRange[0], 'day') + 1
      : 1;
    const isLarge = totalDays > 30 || (!accountId && totalDays > 1);

    if (isLarge) {
      const allAccounts = !accountId;
      modal.confirm({
        title: 'Великий запуск — підтвердіть',
        content: (
          <span>
            Буде завантажено <b>{totalDays} {totalDays === 1 ? 'день' : 'днів'}</b>
            {allAccounts ? ' по всіх активних акаунтах' : ''}.
            Це може тривати кілька хвилин.
            <br />Продовжити?
          </span>
        ),
        okText: 'Так, запустити',
        cancelText: 'Скасувати',
        okButtonProps: { danger: totalDays > 60 },
        onOk: () => void doRun(),
      });
    } else {
      void doRun();
    }
  }

  async function handlePreview() {
    if (!accountId && !dateRange) {
      void messageApi.warning('Оберіть акаунт або діапазон дат для превью');
      return;
    }
    setPreviewLoading(true);
    try {
      const r = await ingestionApi.preview({
        accountId,
        campaignId,
        ...(dateRange ? { dateFrom: dateRange[0].format('YYYY-MM-DD'), dateTo: dateRange[1].format('YYYY-MM-DD') } : {}),
        take: 100,
      });
      setPreviewItems(r.items);
      setPreviewTotal(r.total);
      setPreviewOpen(true);
    } catch (e) { setError(e); }
    finally { setPreviewLoading(false); }
  }

  async function openRunDetail(run: IngestionRun) {
    try {
      const detail = await ingestionApi.getRunById(run.id);
      setSelectedRun(detail as typeof selectedRun);
      setDrawerOpen(true);
    } catch (e) { setError(e); }
  }

  const runColumns = [
    {
      title: 'Дата',
      dataIndex: 'runDate',
      key: 'runDate',
      width: 90,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDateOnly(v)}</Text>,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v: string) => <StatusTag value={v} />,
    },
    {
      title: 'Джерело',
      dataIndex: 'triggerSource',
      key: 'source',
      width: 110,
      render: (v: string) => <Tag>{v === 'MANUAL' ? 'Вручну' : 'Авто'}</Tag>,
    },
    {
      title: 'Акаунти',
      key: 'accounts',
      width: 130,
      render: (_: unknown, r: IngestionRun) => (
        <Text style={{ fontSize: 12 }}>
          ✓{r.successAccounts} ✗{r.failedAccounts} ⊘{r.skippedAccounts}
        </Text>
      ),
    },
    {
      title: 'Рядків',
      dataIndex: 'rowsUpserted',
      key: 'rows',
      width: 80,
      render: (v: number) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Початок',
      dataIndex: 'startedAt',
      key: 'startedAt',
      render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
      responsive: ['md'] as ('md')[],
    },
    {
      title: '',
      key: 'action',
      width: 60,
      render: (_: unknown, r: IngestionRun) => (
        <Button size="small" type="link" onClick={() => openRunDetail(r)}>
          Деталі
        </Button>
      ),
    },
  ];

  const previewColumns = [
    { title: 'Дата', dataIndex: 'factDate', key: 'date', width: 90, render: (v: string) => fmtDateOnly(v) },
    { title: 'Кампанія', dataIndex: 'campaignName', key: 'name', ellipsis: true },
    { title: 'Статус', dataIndex: 'campaignStatus', key: 'status', width: 120, render: (v: string) => <StatusTag value={v} small /> },
    { title: 'Покази', dataIndex: 'impressions', key: 'imp', width: 90 },
    { title: 'Кліки', dataIndex: 'clicks', key: 'clicks', width: 80 },
    { title: 'Витрати', dataIndex: 'cost', key: 'cost', width: 90, render: (v: number) => v.toFixed(2) },
    { title: 'Конверсії', dataIndex: 'conversions', key: 'conv', width: 100, render: (v: number) => v.toFixed(2) },
  ];

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ marginBottom: 16 }}>Завантаження даних</Title>

      <ErrorAlert error={error} />

      {/* Live progress panel */}
      {activeRun && <ActiveRunPanel run={activeRun} />}

      {/* Run form */}
      <Card size="small" title="Параметри запуску" style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item label="Рекламний акаунт">
                <AccountSelector
                  accounts={accounts}
                  value={accountId}
                  onChange={(v) => { setAccountId(v); setCampaignId(undefined); }}
                  placeholder="Всі активні акаунти"
                  includeAll
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item label="Кампанія (опційно)">
                <CampaignSelector
                  campaigns={campaigns}
                  value={campaignId}
                  onChange={setCampaignId}
                  loading={campaignsLoading}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item label="Неакт. акаунти">
                <Switch checked={includeInactive} onChange={setIncludeInactive} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="Діапазон дат (порожньо = вчора)">
                <RangePicker
                  value={dateRange}
                  onChange={(v) => setDateRange(v as [Dayjs, Dayjs] | null)}
                  format="YYYY-MM-DD"
                  style={{ width: '100%' }}
                  disabledDate={(d) => d.isAfter(dayjs().subtract(1, 'day'))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Space>
            <Button
              icon={<SearchOutlined />}
              onClick={handlePreflight}
              loading={preflighting}
            >
              Перевірити
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreview}
              loading={previewLoading}
            >
              Превью даних у БД
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleRun}
              loading={running}
              disabled={Boolean(activeRun)}
            >
              Завантажити
            </Button>
          </Space>
        </Form>
      </Card>

      {/* Runs history */}
      <Card
        size="small"
        title="Історія запусків"
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadRuns} loading={loading}>Оновити</Button>}
      >
        <Table
          size="small"
          loading={loading}
          dataSource={runs}
          columns={runColumns}
          rowKey="id"
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      </Card>

      {/* Run detail drawer */}
      <Drawer
        title={selectedRun ? `Деталі запуску ${selectedRun.id.slice(0, 8)}…` : ''}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={560}
      >
        {selectedRun && (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Статус"><StatusTag value={selectedRun.status} /></Descriptions.Item>
              <Descriptions.Item label="Дата">{(selectedRun as IngestionRun).runDate}</Descriptions.Item>
              <Descriptions.Item label="Акаунти">{(selectedRun as IngestionRun).totalAccounts}</Descriptions.Item>
              <Descriptions.Item label="Рядків">{(selectedRun as IngestionRun).rowsUpserted}</Descriptions.Item>
              <Descriptions.Item label="Початок" span={2}>{fmtDate((selectedRun as IngestionRun).startedAt)}</Descriptions.Item>
              {(selectedRun as IngestionRun).errorSummary && (
                <Descriptions.Item label="Помилки" span={2}>
                  <Alert type="warning" message={(selectedRun as IngestionRun).errorSummary} style={{ margin: 0 }} />
                </Descriptions.Item>
              )}
            </Descriptions>
            <Divider orientation="left" plain>Акаунти</Divider>
            <Table
              size="small"
              dataSource={selectedRun.accountRuns as {
                id: string; adsAccount: { descriptiveName: string; customerId: string };
                status: string; rowsUpserted: number; errorSummary: string | null;
              }[]}
              rowKey="id"
              pagination={false}
              columns={[
                { title: 'Акаунт', key: 'acc', render: (_: unknown, r) => `${r.adsAccount.descriptiveName} (${r.adsAccount.customerId})` },
                { title: 'Статус', dataIndex: 'status', key: 'status', render: (v: string) => <StatusTag value={v} small /> },
                { title: 'Рядків', dataIndex: 'rowsUpserted', key: 'rows', width: 70 },
              ]}
              expandable={{
                rowExpandable: (r) => Boolean(r.errorSummary),
                expandedRowRender: (r) => <Alert type="error" message={r.errorSummary} style={{ margin: 0 }} />,
              }}
            />
          </>
        )}
      </Drawer>

      {/* Preview modal */}
      <Modal
        title={`Превью даних у БД (${previewTotal} рядків, показано ${previewItems?.length ?? 0})`}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={900}
      >
        <Table
          size="small"
          dataSource={previewItems ?? []}
          columns={previewColumns}
          rowKey="id"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 700 }}
        />
      </Modal>
    </div>
  );
}
