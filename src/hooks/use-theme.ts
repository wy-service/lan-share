import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export function useTheme() {
  return useColorScheme() === 'dark' ? Colors.dark : Colors.light;
}
