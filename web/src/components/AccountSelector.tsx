import { Select } from 'antd';
import type { AdsAccount } from '../api/accounts.js';

interface Props {
  accounts: AdsAccount[];
  value?: string;
  onChange?: (v: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
  style?: React.CSSProperties;
  includeAll?: boolean;
}

export function AccountSelector({ accounts, value, onChange, placeholder = 'Оберіть акаунт', allowClear = true, style, includeAll }: Props) {
  const options = [
    ...(includeAll ? [{ value: '', label: 'Всі акаунти' }] : []),
    ...accounts.map((a) => ({
      value: a.id,
      label: `${a.descriptiveName} (${a.customerId})${a.googleStatus !== 'ENABLED' ? ' — неактивний' : ''}`,
    })),
  ];

  return (
    <Select
      showSearch
      allowClear={allowClear}
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
