import * as Clipboard from 'expo-clipboard';
import * as Network from 'expo-network';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FileSpace } from '@/components/file-space';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SHARE_PORT, normalizeAddress } from '@/share/http';
import { startShareServer } from '@/share/server';
import { localSpace } from '@/share/space';

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => localSpace(), []);
  const [sharing, setSharing] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!sharing) return;

    let alive = true;
    let stop = () => {};

    const publish = async () => {
      try {
        const ip = await Network.getIpAddressAsync();
        if (!alive || !ip || ip === '0.0.0.0') return null;
        setAddress(`${ip}:${SHARE_PORT}`);
        return ip;
      } catch {
        return null;
      }
    };

    void (async () => {
      const ip = await publish();
      if (!alive) return;
      if (!ip) {
        setSharing(false);
        setShareError('先连上 Wi-Fi，再打开分享。');
        return;
      }
      try {
        const server = await startShareServer();
        if (!alive) {
          server.stop();
          return;
        }
        stop = server.stop;
        setShareError(null);
      } catch (error) {
        if (!alive) return;
        setSharing(false);
        setAddress(null);
        const message = error instanceof Error ? error.message : '';
        setShareError(/EADDRINUSE|already/i.test(message) ? '端口被占用。先关掉另一个分享。' : message || '分享开不起来');
      }
    })();

    const network = Network.addNetworkStateListener(() => {
      void publish();
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void publish();
    });

    return () => {
      alive = false;
      stop();
      network.remove();
      app.remove();
    };
  }, [sharing]);

  async function copyAddress() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function enter() {
    const next = normalizeAddress(draft);
    if (!next) {
      setJoinError('写成 192.168.1.8:39217 这样。');
      return;
    }
    setJoinError(null);
    router.push(`/space?address=${encodeURIComponent(next)}` as Href);
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.web, { backgroundColor: theme.background }]}>
        <Text style={[styles.brand, { color: theme.text }]}>lan_share</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>请在手机上打开。网页版不能在局域网里监听。</Text>
      </View>
    );
  }

  const plate = (
    <View>
      <Text style={[styles.brand, { color: theme.text, fontFamily: Fonts.rounded }]}>lan_share</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>同一 Wi-Fi 下的文件，一直留在这台手机上。</Text>

      <View style={[styles.plate, { backgroundColor: theme.plate }]}>
        <View style={styles.plateTop}>
          <View style={styles.status}>
            <View style={[styles.dot, { backgroundColor: sharing ? theme.flag : '#6E868E' }]} />
            <Text style={[styles.statusText, { color: theme.plateText }]}>{sharing ? '分享已开' : '分享已关'}</Text>
          </View>
          <Switch
            accessibilityLabel={sharing ? '关闭分享' : '打开分享'}
            value={sharing}
            onValueChange={(value) => {
              setShareError(null);
              setCopied(false);
              if (!value) setAddress(null);
              setSharing(value);
            }}
            trackColor={{ false: '#3E555C', true: theme.flag }}
            thumbColor="#F7FBFC"
          />
        </View>
        {address ? (
          <Text selectable style={[styles.address, { color: theme.plateText, fontFamily: Fonts.mono }]}>
            {address}
          </Text>
        ) : (
          <Text style={[styles.addressIdle, { color: '#9BB0B6' }]}>打开后会显示地址</Text>
        )}
        {address ? (
          <Pressable accessibilityRole="button" onPress={() => void copyAddress()} style={styles.copy}>
            <Text style={[styles.copyText, { color: theme.plate }]}>{copied ? '已复制' : '复制地址'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.note, { color: theme.textSecondary }]}>
        {sharing ? '把这个页面留在前台，别人才能进来。重新连接 Wi-Fi 后地址可能会变。' : '关掉分享只是不让别人进来，文件还在。'}
      </Text>
      {shareError ? <Text style={[styles.error, { color: theme.danger }]}>{shareError}</Text> : null}

      <Text style={[styles.joinLabel, { color: theme.text }]}>进入别人的分享</Text>
      <View style={styles.joinRow}>
        <TextInput
          value={draft}
          onChangeText={(value) => {
            setDraft(value);
            setJoinError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="192.168.1.8:39217"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="go"
          onSubmitEditing={enter}
          style={[
            styles.joinInput,
            { color: theme.text, borderColor: theme.line, backgroundColor: theme.backgroundElement, fontFamily: Fonts.mono },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          onPress={enter}
          style={({ pressed }) => [styles.joinButton, { backgroundColor: theme.plate, opacity: pressed ? 0.85 : 1 }]}>
          <Text style={[styles.joinButtonText, { color: theme.plateText }]}>进入</Text>
        </Pressable>
      </View>
      {joinError ? <Text style={[styles.error, { color: theme.danger }]}>{joinError}</Text> : null}
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <FileSpace api={api} title="本机文件" header={plate} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  web: { flex: 1, justifyContent: 'center', padding: 28 },
  brand: { fontSize: 34, fontWeight: '700', letterSpacing: -0.6 },
  sub: { marginTop: 6, fontSize: 15, lineHeight: 21 },
  plate: { marginTop: 18, borderRadius: 22, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18 },
  plateTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, fontWeight: '600' },
  address: { marginTop: 18, fontSize: 26, letterSpacing: 0.3 },
  addressIdle: { marginTop: 18, fontSize: 16 },
  copy: {
    alignSelf: 'flex-start',
    marginTop: 14,
    backgroundColor: '#F4FBFC',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  copyText: { fontSize: 14, fontWeight: '700' },
  note: { marginTop: 10, fontSize: 13, lineHeight: 18 },
  error: { marginTop: 8, fontSize: 14, lineHeight: 20 },
  joinLabel: { marginTop: 22, fontSize: 16, fontWeight: '700' },
  joinRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  joinInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  joinButton: { borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  joinButtonText: { fontSize: 16, fontWeight: '700' },
});
