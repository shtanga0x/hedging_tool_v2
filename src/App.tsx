import { useState, useEffect, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { ThemeProvider, CssBaseline, Box, Tabs, Tab, AppBar, Toolbar, Typography, IconButton, Alert, Button } from '@mui/material';
import Brightness4 from '@mui/icons-material/Brightness4';
import Brightness7 from '@mui/icons-material/Brightness7';
import Telegram from '@mui/icons-material/Telegram';
import { darkTheme, lightTheme } from './theme';
import { PositionBuilderTab } from './components/builder/PositionBuilderTab';
import { PositionFinderTab } from './components/finder/PositionFinderTab';
import { BacktesterTab } from './components/backtester/BacktesterTab';
import type { BuilderTransferPayload } from './types';

interface ErrorBoundaryState { error: Error | null }
class TabErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TabErrorBoundary] render crash:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <Box sx={{ p: 3 }}>
          <Alert severity="error" sx={{ mb: 2 }}>
            <strong>Something went wrong while rendering this tab.</strong><br />
            {this.state.error.message}
          </Alert>
          <Button variant="outlined" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

declare const __APP_VERSION__: string;

type TabValue = 'builder' | 'finder' | 'backtester';

export default function App() {
  const [isDark, setIsDark] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>('builder');
  const [transferPayload, setTransferPayload] = useState<BuilderTransferPayload | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'builder') {
      const raw = localStorage.getItem('hedging_tool_transfer');
      if (raw) {
        try {
          const payload = JSON.parse(raw) as BuilderTransferPayload;
          localStorage.removeItem('hedging_tool_transfer');
          setTransferPayload(payload);
          setActiveTab('builder');
        } catch { /* ignore */ }
      } else {
        setActiveTab('builder');
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  return (
    <ThemeProvider theme={isDark ? darkTheme : lightTheme}>
      <CssBaseline />
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mr: 2 }}>
            Hedging Tool
          </Typography>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v as TabValue)} sx={{ flexGrow: 1 }}>
            <Tab label="Position Builder" value="builder" />
            <Tab label="Position Finder" value="finder" />
            <Tab label="Backtester" value="backtester" />
          </Tabs>
          <Typography
            component="a"
            href="https://t.me/shtanga0x"
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              fontFamily: "'Exo 2', 'Segoe UI', Arial, sans-serif",
              fontSize: '1.1rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textDecoration: 'none',
              color: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              opacity: 0.85,
              '&:hover': { opacity: 1 },
              mr: 0.5,
            }}
          >
            <Telegram fontSize="small" />
            shtanga0x
          </Typography>
          <IconButton size="small" onClick={() => setIsDark(d => !d)}>
            {isDark ? <Brightness7 /> : <Brightness4 />}
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: activeTab === 'builder' ? 'block' : 'none' }}>
          <TabErrorBoundary>
            <PositionBuilderTab
              transferPayload={transferPayload}
              onTransferConsumed={() => setTransferPayload(null)}
            />
          </TabErrorBoundary>
        </Box>
        <Box sx={{ display: activeTab === 'finder' ? 'block' : 'none' }}>
          <TabErrorBoundary>
            <PositionFinderTab
              onSendToBuilder={(payload) => {
                setTransferPayload(payload);
                setActiveTab('builder');
              }}
            />
          </TabErrorBoundary>
        </Box>
        <Box sx={{ display: activeTab === 'backtester' ? 'block' : 'none' }}>
          <TabErrorBoundary>
            <BacktesterTab />
          </TabErrorBoundary>
        </Box>
      </Box>
      <Typography
        variant="caption"
        sx={{ display: 'block', textAlign: 'center', pb: 2, opacity: 0.35, fontSize: '0.7rem' }}
      >
        v{__APP_VERSION__}
      </Typography>
    </ThemeProvider>
  );
}
