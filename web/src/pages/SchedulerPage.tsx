import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Divider, Form,
  InputNumber, Row, Space, Switch, Tag, Tooltip, Typography, message,
} from 'antd';
import { InfoCircleOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { schedulerApi, type SchedulerHealth, type SchedulerSettings } from '../api/scheduler.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { StatusTag } from '../components/StatusTag.js';

const { Title, Text, Paragraph } = Typography;

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtTime(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* ─── Catchup / Refresh explanation card ─────────────────────────────────── */

function CatchupRefreshCard({ catchupDays, refreshDays }: { catchupDays: number; refreshDays: number }) {
  const today = new Date();
  const dates: { date: string; type: 'refresh' | 'catchup' | 'history' }[] = [];

  for (let i = 1; i <= Math.max(catchupDays, refreshDays) + 2; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toLocaleDateString('uk-UA', { month: 'short', day: 'numeric' });
    if (i <= refreshDays) {
      dates.push({ date: ds, type: 'refresh' });
    } else if (i <= catchupDays) {
      dates.push({ date: ds, type: 'catchup' });
    } else {
      dates.push({ date: ds, type: 'history' });
    }
  }

  return (
    <Card
      size="small"
      style={{ marginBottom: 16, background: '#fffbe6', borderColor: '#ffe58f' }}
      title={
        <Space>
          <InfoCircleOutlined style={{ color: '#faad14' }} />
          <Text strong>Логіка автоматичного оновлення</Text>
        </Space>
      }
    >
      <Row gutter={16}>
        <Col xs={24} md={14}>
          <Paragraph style={{ marginBottom: 8, fontSize: 13 }}>
            Щоночі планувальник запускає завантаження даних і обробляє кілька дат одночасно:
          </Paragraph>
          <Space direction="vertical" size={4} style={{ marginBottom: 8 }}>
            <Space size={4}>
              <Tag color="orange">Оновлення</Tag>
              <Text style={{ fontSize: 12 }}>
                Останні <strong>{refreshDays}</strong> дн. — дані завантажуються завжди, навіть якщо є успішний запис.
                <br />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Google Ads оновлює статистику ретроактивно — конверсії та вартість можуть змінитися протягом 2–3 діб.
                </Text>
              </Text>
            </Space>
            <Space size={4}>
              <Tag color="blue">Надолуження</Tag>
              <Text style={{ fontSize: 12 }}>
                До <strong>{catchupDays}</strong> дн. назад — завантажується лише якщо даних ще немає.
                <br />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Якщо планувальник пропустив день (збій, перезапуск), він заповнює пропуск.
                </Text>
              </Text>
            </Space>
          </Space>
        </Col>
        <Col xs={24} md={10}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            Приклад для поточного запуску:
          </Text>
          <Space wrap size={4}>
            {dates.map(({ date, type }) => (
              <Tooltip
                key={date}
                title={
                  type === 'refresh' ? 'Завжди оновлюється' :
                  type === 'catchup' ? 'Завантажується, якщо немає даних' :
                  'Не обробляється автоматично'
                }
              >
                <Tag
                  color={type === 'refresh' ? 'orange' : type === 'catchup' ? 'blue' : 'default'}
                  style={{ cursor: 'default', fontSize: 11 }}
                >
                  {date}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        </Col>
      </Row>
    </Card>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export function SchedulerPage() {
  const [health, setHealth] = useState<SchedulerHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [messageApi, contextHolder] = message.useMessage();

  // form state mirrors SchedulerSettings
  const [ingSetting, setIng] = useState<Partial<SchedulerSettings>>({});
  const [sheetsSetting, setSheets] = useState<Partial<SchedulerSettings>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const h = await schedulerApi.getHealth();
      setHealth(h);
      const s = h.settings;
      setIng({
        ingestionEnabled: s.ingestionEnabled,
        ingestionHour: s.ingestionHour,
        ingestionMinute: s.ingestionMinute,
        ingestionMaxDailyAttempts: s.ingestionMaxDailyAttempts,
        ingestionRetryDelayMin: s.ingestionRetryDelayMin,
        ingestionBatchSize: s.ingestionBatchSize,
        ingestionMaxAccounts: s.ingestionMaxAccounts,
      });
      setSheets({
        sheetsEnabled: s.sheetsEnabled,
        sheetsHour: s.sheetsHour,
        sheetsMinute: s.sheetsMinute,
        sheetsMaxDailyAttempts: s.sheetsMaxDailyAttempts,
        sheetsRetryDelayMin: s.sheetsRetryDelayMin,
        sheetsMaxConfigsPerTick: s.sheetsMaxConfigsPerTick,
      });
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await schedulerApi.patchSettings({ ...ingSetting, ...sheetsSetting });
      void messageApi.success('Налаштування збережено');
      await load();
    } catch (e) { setError(e); }
    finally { setSaving(false); }
  }

  return (
    <div>
      {contextHolder}
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <Title level={4} style={{ margin: 0 }}>Планувальник</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Оновити</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
            Зберегти
          </Button>
        </Space>
      </Space>

      <ErrorAlert error={error} />

      {/* Catchup/Refresh explanation */}
      {health && (
        <CatchupRefreshCard
          catchupDays={health.runtime.catchupDays}
          refreshDays={health.runtime.refreshDays}
        />
      )}

      {/* Current state */}
      {health && (
        <Row gutter={[16, 0]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={12}>
            <Descriptions size="small" title="Поточний стан — Завантаження" bordered column={2}>
              <Descriptions.Item label="Увімкнено" span={2}>
                <StatusTag value={health.settings.ingestionEnabled ? 'ENABLED' : 'PAUSED'} />
              </Descriptions.Item>
              <Descriptions.Item label="Час запуску" span={2}>
                <Text strong>
                  {fmtTime(health.settings.ingestionHour, health.settings.ingestionMinute)}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}> (Київ)</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Наступний запуск" span={2}>
                {fmtDate(health.runtime.nextIngestionAt)}
              </Descriptions.Item>
              <Descriptions.Item label="Надолуження">{health.runtime.catchupDays} дн.</Descriptions.Item>
              <Descriptions.Item label="Оновлення">{health.runtime.refreshDays} дн.</Descriptions.Item>
            </Descriptions>
          </Col>
          <Col xs={24} md={12}>
            <Descriptions size="small" title="Поточний стан — Sheets" bordered column={2}>
              <Descriptions.Item label="Увімкнено" span={2}>
                <StatusTag value={health.settings.sheetsEnabled ? 'ENABLED' : 'PAUSED'} />
              </Descriptions.Item>
              <Descriptions.Item label="Час запуску" span={2}>
                <Text strong>
                  {fmtTime(health.settings.sheetsHour, health.settings.sheetsMinute)}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}> (Київ)</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Наступний запуск" span={2}>
                {fmtDate(health.runtime.nextSheetsAt)}
              </Descriptions.Item>
              <Descriptions.Item label="Опитування">
                {health.runtime.pollSeconds}с
              </Descriptions.Item>
              <Descriptions.Item label="Оновлено">
                {fmtDate(health.settings.updatedAt)}
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      )}

      <Divider />

      <Row gutter={[16, 16]}>
        {/* Ingestion settings */}
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={
              <Space>
                Автозавантаження
                <StatusTag value={ingSetting.ingestionEnabled ? 'ENABLED' : 'PAUSED'} small />
              </Space>
            }
          >
            <Form layout="vertical" size="small">
              <Form.Item label="Увімкнено">
                <Switch
                  checked={ingSetting.ingestionEnabled}
                  onChange={(v) => setIng((p) => ({ ...p, ingestionEnabled: v }))}
                />
              </Form.Item>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item label="Година запуску (0–23)">
                    <InputNumber
                      min={0} max={23}
                      value={ingSetting.ingestionHour}
                      onChange={(v) => setIng((p) => ({ ...p, ingestionHour: v ?? 0 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Хвилина (0–59)">
                    <InputNumber
                      min={0} max={59}
                      value={ingSetting.ingestionMinute}
                      onChange={(v) => setIng((p) => ({ ...p, ingestionMinute: v ?? 0 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
              {health && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Час: {fmtTime(ingSetting.ingestionHour ?? 0, ingSetting.ingestionMinute ?? 0)} (Київ)
                </Text>
              )}
              <Row gutter={8} style={{ marginTop: 8 }}>
                <Col span={12}>
                  <Form.Item label="Макс. спроб/день">
                    <InputNumber
                      min={1} max={10}
                      value={ingSetting.ingestionMaxDailyAttempts}
                      onChange={(v) => setIng((p) => ({ ...p, ingestionMaxDailyAttempts: v ?? 2 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Затримка між спробами (хв)">
                    <InputNumber
                      min={1} max={120}
                      value={ingSetting.ingestionRetryDelayMin}
                      onChange={(v) => setIng((p) => ({ ...p, ingestionRetryDelayMin: v ?? 30 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item label="Розмір пакету">
                    <InputNumber
                      min={10} max={500}
                      value={ingSetting.ingestionBatchSize}
                      onChange={(v) => setIng((p) => ({ ...p, ingestionBatchSize: v ?? 100 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Макс. акаунтів/запуск">
                    <InputNumber
                      min={1} max={10000}
                      value={ingSetting.ingestionMaxAccounts}
                      onChange={(v) => setIng((p) => ({ ...p, ingestionMaxAccounts: v ?? 5000 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>
        </Col>

        {/* Sheets settings */}
        <Col xs={24} md={12}>
          <Card
            size="small"
            title={
              <Space>
                Автоекспорт Sheets
                <StatusTag value={sheetsSetting.sheetsEnabled ? 'ENABLED' : 'PAUSED'} small />
              </Space>
            }
          >
            <Form layout="vertical" size="small">
              <Form.Item label="Увімкнено">
                <Switch
                  checked={sheetsSetting.sheetsEnabled}
                  onChange={(v) => setSheets((p) => ({ ...p, sheetsEnabled: v }))}
                />
              </Form.Item>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item label="Година запуску (0–23)">
                    <InputNumber
                      min={0} max={23}
                      value={sheetsSetting.sheetsHour}
                      onChange={(v) => setSheets((p) => ({ ...p, sheetsHour: v ?? 1 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Хвилина (0–59)">
                    <InputNumber
                      min={0} max={59}
                      value={sheetsSetting.sheetsMinute}
                      onChange={(v) => setSheets((p) => ({ ...p, sheetsMinute: v ?? 10 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
              {health && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Час: {fmtTime(sheetsSetting.sheetsHour ?? 0, sheetsSetting.sheetsMinute ?? 0)} (Київ)
                </Text>
              )}
              <Row gutter={8} style={{ marginTop: 8 }}>
                <Col span={12}>
                  <Form.Item label="Макс. спроб/день">
                    <InputNumber
                      min={1} max={10}
                      value={sheetsSetting.sheetsMaxDailyAttempts}
                      onChange={(v) => setSheets((p) => ({ ...p, sheetsMaxDailyAttempts: v ?? 2 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Затримка між спробами (хв)">
                    <InputNumber
                      min={1} max={120}
                      value={sheetsSetting.sheetsRetryDelayMin}
                      onChange={(v) => setSheets((p) => ({ ...p, sheetsRetryDelayMin: v ?? 20 }))}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Макс. конфігів за один тік">
                <InputNumber
                  min={1} max={500}
                  value={sheetsSetting.sheetsMaxConfigsPerTick}
                  onChange={(v) => setSheets((p) => ({ ...p, sheetsMaxConfigsPerTick: v ?? 200 }))}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
