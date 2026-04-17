import { Table, Typography } from 'antd';
import type { SheetPreviewResult } from '../api/sheets.js';

const COL_LABELS: Record<string, string> = {
  date: 'Дата', customer_id: 'Customer ID', account_name: 'Акаунт',
  campaign_id: 'ID кампанії', campaign_name: 'Кампанія', campaign_status: 'Статус',
  impressions: 'Покази', clicks: 'Кліки', ctr_percent: 'CTR%',
  average_cpc: 'Ср. CPC', cost: 'Витрати', conversions: 'Конверсії',
  cost_per_conversion: 'Ціна/конв.', conversion_value: 'Цінність', conversion_value_per_cost: 'ROAS',
  final_url_suffix: 'URL суфікс', tracking_url_template: 'Шаблон URL',
  utm_source: 'UTM Source', utm_medium: 'UTM Medium', utm_campaign: 'UTM Campaign',
  utm_term: 'UTM Term', utm_content: 'UTM Content',
};

interface Props {
  preview: SheetPreviewResult;
  loading?: boolean;
}

export function PreviewTable({ preview, loading }: Props) {
  const columns = preview.columns.map((col, idx) => ({
    key: col,
    dataIndex: idx,
    title: COL_LABELS[col] ?? col,
    ellipsis: true,
    width: 110,
  }));

  const dataSource = preview.rows.map((row, i) => {
    const obj: Record<string, unknown> = { key: i };
    row.values.forEach((v, idx) => { obj[idx] = v; });
    return obj;
  });

  return (
    <>
      <Typography.Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
        Показано {preview.rows.length} рядків з {preview.totalRows} за {preview.dateFrom} — {preview.dateTo}
      </Typography.Text>
      <Table
        size="small"
        loading={loading}
        dataSource={dataSource}
        columns={columns}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: Math.max(columns.length * 110, 600) }}
      />
    </>
  );
}
