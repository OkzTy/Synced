/**
 * Theme management utility
 */

export const THEMES = [
  { id: 'dark', name: 'Default Dark', emoji: '🌑', colors: ['#0a0a0f', '#6c5ce7', '#a855f7', '#ec4899'] },
  { id: 'light', name: 'Light', emoji: '☀️', colors: ['#f5f5f7', '#5b4cdb', '#8b5cf6', '#d946ef'] },
  { id: 'midnight', name: 'Midnight', emoji: '🌊', colors: ['#070d1a', '#06b6d4', '#3b82f6', '#818cf8'] },
  { id: 'cyberpunk', name: 'Cyberpunk', emoji: '🦾', colors: ['#0a0612', '#ff2d95', '#ff6b2b', '#ffd600'] },
  { id: 'aurora', name: 'Aurora', emoji: '🌌', colors: ['#060d0a', '#10b981', '#06d6a0', '#2dd4bf'] },
  { id: 'gwb', name: 'GWB (Monochrome)', emoji: '⚙️', colors: ['#ffffff', '#808080', '#404040', '#000000'] },
  { id: 'sunset', name: 'Sunset', emoji: '🌅', colors: ['#1a0a0a', '#ff6b35', '#f7c59f', '#e63946'] },
  { id: 'ocean', name: 'Ocean', emoji: '🐋', colors: ['#0a1628', '#0077b6', '#00b4d8', '#90e0ef'] },
  { id: 'forest', name: 'Forest', emoji: '🌲', colors: ['#0a140e', '#2d6a4f', '#40916c', '#95d5b2'] },
  { id: 'lavender', name: 'Lavender', emoji: '💜', colors: ['#120a1e', '#7c3aed', '#a78bfa', '#c4b5fd'] },
  { id: 'crimson', name: 'Crimson', emoji: '❤️', colors: ['#140a0a', '#dc2626', '#ef4444', '#fca5a5'] },
];

export function getTheme() {
  return localStorage.getItem('synced-theme') || 'dark';
}

export function setTheme(themeId) {
  const valid = THEMES.find((t) => t.id === themeId);
  if (!valid) return;
  localStorage.setItem('synced-theme', themeId);
  document.documentElement.setAttribute('data-theme', themeId);
}

export function initTheme() {
  const saved = getTheme();
  document.documentElement.setAttribute('data-theme', saved);
  return saved;
}

export function getAvailableThemes() {
  return THEMES;
}
