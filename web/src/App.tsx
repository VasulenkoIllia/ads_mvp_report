import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Alert, App, Button, ConfigProvider, Layout, Menu, Space, Spin, Typography, theme, message,
} from 'antd';
import ukUA from 'antd/locale/uk_UA';
import {
  BarChartOutlined, CalendarOutlined, CloudOutlined, DatabaseOutlined,
  LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, TeamOutlined,
} from '@ant-design/icons';
import { authApi, type Session } from './api/auth.js';
import { RunningBanner } from './components/RunningBanner.js';

// Lazy-завантаження сторінок — зменшує початковий бандл
const OverviewPage   = lazy(() => import('./pages/OverviewPage.js').then((m) => ({ default: m.OverviewPage })));
const AccountsPage   = lazy(() => import('./pages/AccountsPage.js').then((m) => ({ default: m.AccountsPage })));
const CampaignsPage  = lazy(() => import('./pages/CampaignsPage.js').then((m) => ({ default: m.CampaignsPage })));
const IngestionPage  = lazy(() => import('./pages/IngestionPage.js').then((m) => ({ default: m.IngestionPage })));
const SheetsPage     = lazy(() => import('./pages/SheetsPage.js').then((m) => ({ default: m.SheetsPage })));
const SchedulerPage  = lazy(() => import('./pages/SchedulerPage.js').then((m) => ({ default: m.SchedulerPage })));

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

type Page = 'overview' | 'accounts' | 'campaigns' | 'ingestion' | 'sheets' | 'scheduler';

const NAV_ITEMS = [
  { key: 'overview',   label: 'Огляд',          icon: <BarChartOutlined /> },
  { key: 'accounts',   label: 'Акаунти',         icon: <TeamOutlined /> },
  { key: 'campaigns',  label: 'Кампанії',         icon: <CloudOutlined /> },
  { key: 'ingestion',  label: 'Дані',         icon: <DatabaseOutlined /> },
  { key: 'sheets',     label: 'Google Sheets',    icon: <CalendarOutlined /> },
  { key: 'scheduler',  label: 'Планувальник',     icon: <CalendarOutlined /> },
];

const PAGE_FALLBACK = (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
    <Spin size="large" />
  </div>
);

/* ─── Login ──────────────────────────────────────────────────────────────── */

function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const { authUrl } = await authApi.loginStart();
      window.location.href = authUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка входу');
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f5f5f5',
    }}>
      <div style={{
        textAlign: 'center', padding: 48, background: '#fff',
        borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,.08)', minWidth: 340,
      }}>
        <Title level={3} style={{ marginBottom: 8 }}>Ads MVP Report</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 32 }}>
          Увійдіть через Google для доступу до системи
        </Text>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
        <Button type="primary" size="large" block loading={loading} onClick={handleLogin}>
          Увійти через Google
        </Button>
      </div>
    </div>
  );
}

/* ─── Dashboard ──────────────────────────────────────────────────────────── */

function Dashboard({ session }: { session: Session }) {
  const [page, setPage] = useState<Page>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [, contextHolder] = message.useMessage();

  async function handleLogout() {
    await authApi.logout();
    window.location.reload();
  }

  function renderPage() {
    switch (page) {
      case 'overview':   return <OverviewPage onNavigate={(p) => setPage(p as Page)} />;
      case 'accounts':   return <AccountsPage />;
      case 'campaigns':  return <CampaignsPage />;
      case 'ingestion':  return <IngestionPage />;
      case 'sheets':     return <SheetsPage />;
      case 'scheduler':  return <SchedulerPage />;
      default:           return null;
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {contextHolder}
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        style={{ background: '#001529' }}
        width={200}
      >
        <div style={{ padding: collapsed ? '14px 8px' : '14px 16px', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
          {!collapsed && (
            <Text style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>Ads MVP Report</Text>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          onClick={({ key }) => setPage(key as Page)}
          items={NAV_ITEMS}
          style={{ borderRight: 0 }}
        />
      </Sider>

      <Layout>
        <Header style={{
          background: '#fff', padding: '0 16px', height: 48,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #f0f0f0',
        }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16 }}
          />
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>{session.email}</Text>
            <Button size="small" icon={<LogoutOutlined />} onClick={() => void handleLogout()}>
              Вийти
            </Button>
          </Space>
        </Header>

        <RunningBanner />
        <Content style={{ margin: '0 16px 16px', padding: 20, background: '#fff', borderRadius: 8 }}>
          <Suspense fallback={PAGE_FALLBACK}>
            {renderPage()}
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}

/* ─── Root ───────────────────────────────────────────────────────────────── */

export default function Root() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi.getSession()
      .then(setSession)
      .catch(() => setSession({ authenticated: false, email: null }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="Завантаження…"><div style={{ minHeight: 100 }} /></Spin>
      </div>
    );
  }

  return (
    <ConfigProvider
      locale={ukUA}
      theme={{ token: { colorPrimary: '#1677ff', borderRadius: 6 }, algorithm: theme.defaultAlgorithm }}
    >
      {/* App надає modal/message/notification контекст для useApp() в дочірніх компонентах */}
      <App>
        {session?.authenticated
          ? <Dashboard session={session} />
          : <LoginPage />
        }
      </App>
    </ConfigProvider>
  );
}
