import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1C2B33',
    background: '#E4EEF1',
    backgroundElement: '#F7FBFC',
    backgroundSelected: '#D5E4EA',
    textSecondary: '#5E727A',
    plate: '#17343C',
    plateText: '#F4FBFC',
    flag: '#E24B38',
    line: '#C5D5DB',
    danger: '#9E2F2F',
  },
  dark: {
    text: '#E7F1F3',
    background: '#10181C',
    backgroundElement: '#1A272D',
    backgroundSelected: '#24363D',
    textSecondary: '#93A7AE',
    plate: '#0E2429',
    plateText: '#F4FBFC',
    flag: '#FF6B54',
    line: '#2C4148',
    danger: '#FF8D86',
  },
} as const;

export const Fonts = Platform.select({
  ios: {
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    rounded: 'normal',
    mono: 'monospace',
  },
}) ?? { rounded: 'normal', mono: 'monospace' };
