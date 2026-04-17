import { Select } from 'antd';
import type { Campaign } from '../api/campaigns.js';

const STATUS_ICON: Record<string, string> = { ENABLED: '🟢', PAUSED: '🟡', REMOVED: '🔴' };

interface Props {
  campaigns: Campaign[];
  value?: string;
  onChange?: (v: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
  style?: React.CSSProperties;
  loading?: boolean;
}

export function CampaignSelector({ campaigns, value, onChange, placeholder = 'Оберіть кампанію (опційно)', allowClear = true, style, loading }: Props) {
  const options = campaigns.map((c) => ({
    value: c.campaignId,
    label: `${STATUS_ICON[c.campaignStatus] ?? '⚪'} ${c.campaignName}`,
  }));

  return (
    <Select
      showSearch
      allowClear={allowClear}
      loading={loading}
      placeholder={placeholder}
      value={value || undefined}
      onChange={(v) => onChange?.(v || undefined)}
      options={options}
      filterOption={(input, opt) =>
        (opt?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
      }
      style={{ minWidth: 280, ...style }}
    />
  );
}
