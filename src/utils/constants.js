export const APP_NAME = 'Synced';
export const APP_VERSION = '2.2.4';

export const ROUTES = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/dma', label: 'DMA', icon: '📡' },
  { path: '/external', label: 'External', icon: '🔍' },
  { path: '/internal', label: 'Internal', icon: '💉' },
  { path: '/scripts', label: 'Scripting', icon: '⚡' },
  { path: '/ai', label: 'AI', icon: '🤖' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];

export const BRIDGE_PORT = 8765;
export const API_PORT = 9876;
export const ADMIN_PORT = 3847;

export const LICENSE_TYPES = [
  { id: 'TRIAL', label: 'Trial (1 Day)', days: 1 },
  { id: '3DAY', label: '3 Days', days: 3 },
  { id: 'WEEK', label: 'Weekly (7 Days)', days: 7 },
  { id: 'MONTH', label: 'Monthly (30 Days)', days: 30 },
  { id: 'QUARTER', label: 'Quarterly (90 Days)', days: 90 },
  { id: 'LIFETIME', label: 'Lifetime', days: null },
];
