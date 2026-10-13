import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { FileSpace } from '@/components/file-space';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { normalizeAddress } from '@/share/http';
import { remoteSpace } from '@/share/space';

export default function RemoteScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ address?: string }>();
  const raw = Array.isArray(params.address) ? params.address[0] : params.address;
  const address = raw ? normalizeAddress(raw) : null;
  const api = useMemo(() => (address ? remoteSpace(address) : null), [address]);

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.missing, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.text }}>请在手机上打开。</Text>
      </View>
    );
  }

  if (!address || !api) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.text }}>地址不对。</Text>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: '对方的分享', headerBackTitle: '返回' }} />
      <FileSpace
        api={api}
        title="分享里的文件"
        header={
          <Text selectable style={[styles.address, { color: theme.textSecondary, fontFamily: Fonts.mono }]}>
            {address}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  address: { marginTop: 8, fontSize: 15 },
});
