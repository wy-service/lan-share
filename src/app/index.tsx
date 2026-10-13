import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FileSpace } from '@/components/file-space';
import { SHARE_PORT, parsePort } from '@/share/http';
import { startShareServer } from '@/share/server';
import { localSpace } from '@/share/space';

function readSavedPort(): number {
  try {
    const file = new File(Paths.document, 'share-port.txt');
    if (!file.exists) return SHARE_PORT;
    return parsePort(file.textSync()) ?? SHARE_PORT;
  } catch {
    return SHARE_PORT;
  }
}

function writeSavedPort(port: number) {
  const file = new File(Paths.document, 'share-port.txt');
  if (!file.exists) file.create();
  file.write(String(port));
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const api = useMemo(() => localSpace(), []);
  const [sharing, setSharing] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [port, setPort] = useState(readSavedPort);
  const [portText, setPortText] = useState(() => String(port));
  const [portError, setPortError] = useState<string | null>(null);

  useEffect(() => {
    if (!sharing) return;

    let alive = true;
    let stop = () => {};

    const publish = async () => {
      try {
        const ip = await Network.getIpAddressAsync();
        if (!alive || !ip || ip === '0.0.0.0') return null;
        setAddress(`${ip}:${port}`);
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
        const server = await startShareServer(port);
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
  }, [sharing, port]);

  function applyPort() {
    const next = parsePort(portText);
    if (next === null) {
      setPortError('端口要在 1 到 65535 之间');
      setPortText(String(port));
      return;
    }
    setPortError(null);
    setPortText(String(next));
    if (next === port) return;
    writeSavedPort(next);
    setPort(next);
  }

  async function copyAddress() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const plate = (
    <View>
      <Text style={styles.brand}>lan_share</Text>
      <Text style={styles.sub}>同一 Wi-Fi 下的文件，一直留在这台手机上。</Text>

      <View style={styles.plate}>
        <View style={styles.plateTop}>
          <View style={styles.status}>
            <View style={[styles.dot, sharing ? styles.dotOn : styles.dotOff]} />
            <Text style={styles.statusText}>{sharing ? '分享已开' : '分享已关'}</Text>
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
            trackColor={{ false: '#3E555C', true: '#E24B38' }}
            thumbColor="#F7FBFC"
          />
        </View>
        <View style={styles.portRow}>
          <Text style={styles.portLabel}>端口</Text>
          <TextInput
            value={portText}
            onChangeText={(value) => {
              setPortText(value.replace(/[^\d]/g, ''));
              setPortError(null);
            }}
            onEndEditing={applyPort}
            onSubmitEditing={applyPort}
            keyboardType="number-pad"
            maxLength={5}
            accessibilityLabel="端口"
            style={styles.portInput}
          />
        </View>
        {portError ? <Text style={styles.portError}>{portError}</Text> : null}
        {address ? (
          <Text selectable style={styles.address}>
            {address}
          </Text>
        ) : (
          <Text style={styles.addressIdle}>打开后会显示地址</Text>
        )}
        {address ? (
          <Pressable accessibilityRole="button" onPress={() => void copyAddress()} style={styles.copy}>
            <Text style={styles.copyText}>{copied ? '已复制' : '复制地址'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.note}>
        {sharing
          ? '把这个页面留在前台，别人才能进来。浏览器打开上面的地址也能改文件。重新连接 Wi-Fi 后地址可能会变。'
          : '关掉分享只是不让别人进来，文件还在。'}
      </Text>
      {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
    </View>
  );

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <FileSpace api={api} title="本机文件" header={plate} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#E4EEF1' },
  brand: { fontSize: 34, fontWeight: '700', letterSpacing: -0.6, color: '#1C2B33' },
  sub: { marginTop: 6, fontSize: 15, lineHeight: 21, color: '#5E727A' },
  plate: {
    marginTop: 18,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    backgroundColor: '#17343C',
  },
  plateTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: '#E24B38' },
  dotOff: { backgroundColor: '#6E868E' },
  statusText: { fontSize: 15, fontWeight: '600', color: '#F4FBFC' },
  portRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  portLabel: { color: '#F4FBFC', fontSize: 15, fontWeight: '600' },
  portInput: {
    minWidth: 88,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F4FBFC',
    color: '#1C2B33',
    fontSize: 16,
  },
  portError: { marginTop: 8, color: '#FFB4A8', fontSize: 13 },
  address: { marginTop: 18, fontSize: 26, letterSpacing: 0.3, color: '#F4FBFC' },
  addressIdle: { marginTop: 18, fontSize: 16, color: '#9BB0B6' },
  copy: {
    alignSelf: 'flex-start',
    marginTop: 14,
    backgroundColor: '#F4FBFC',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  copyText: { fontSize: 14, fontWeight: '700', color: '#17343C' },
  note: { marginTop: 10, fontSize: 13, lineHeight: 18, color: '#5E727A' },
  error: { marginTop: 8, fontSize: 14, lineHeight: 20, color: '#9E2F2F' },
});
