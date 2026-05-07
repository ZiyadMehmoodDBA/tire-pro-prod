export type Theme = 'default' | 'lavender' | 'iris' | 'chai';

const STORAGE_KEY = 'tirepro_theme';

export const THEMES: {
  id: Theme;
  name: string;
  description: string;
  primary: string;
  mid: string;
  light: string;
  gradient: string;
}[] = [
  {
    id:          'default',
    name:        'Ocean Teal',
    description: 'Default — cool teal & cyan',
    primary:     '#0d9488',
    mid:         '#14b8a6',
    light:       '#99f6e4',
    gradient:    'linear-gradient(135deg, #0f766e, #0d9488, #06b6d4)',
  },
  {
    id:          'lavender',
    name:        'Lavender Fields',
    description: 'Soft purple — calm & elegant',
    primary:     '#6D28D9',
    mid:         '#7C3AED',
    light:       '#DDD6FE',
    gradient:    'linear-gradient(135deg, #5B21B6, #7C3AED, #A78BFA)',
  },
  {
    id:          'iris',
    name:        'Iris Garden',
    description: 'Deep indigo — bold & confident',
    primary:     '#4338CA',
    mid:         '#4F46E5',
    light:       '#C7D2FE',
    gradient:    'linear-gradient(135deg, #3730A3, #4F46E5, #818CF8)',
  },
  {
    id:          'chai',
    name:        'Spiced Chai',
    description: 'Warm amber — earthy & inviting',
    primary:     '#B45309',
    mid:         '#D97706',
    light:       '#FDE68A',
    gradient:    'linear-gradient(135deg, #92400E, #D97706, #FBBF24)',
  },
];

export function getTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'default';
}

export function applyTheme(theme: Theme): void {
  const html = document.documentElement;
  if (theme === 'default') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', theme);
  }
  localStorage.setItem(STORAGE_KEY, theme);
}

export function initTheme(): void {
  applyTheme(getTheme());
}
