import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorText, type SharedFile } from '@/share/http';
import type { SpaceApi } from '@/share/space';

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

export function FileSpace({
  api,
  title,
  header,
}: {
  api: SpaceApi;
  title: string;
  header?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      setFiles(await api.list());
      setError(null);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      pending.current = false;
    }
  }, [api]);

  useEffect(() => {
    const load = () => void refresh();
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      pending.current = false;
      await refresh();
    } catch (taskError) {
      Alert.alert('没完成', errorText(taskError));
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (busy) return;
    const picked = await File.pickFileAsync({ multipleFiles: true });
    if (picked.canceled) return;
    await run(() => api.add(picked.result));
  }

  function askRename(name: string) {
    setRenaming(name);
    setDraft(name);
  }

  function askDelete(name: string) {
    Alert.alert('删除这个文件？', name, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => void run(() => api.remove(name)),
      },
    ]);
  }

  function askClear() {
    Alert.alert('清空全部分享文件？', '连进来的人看到的也会一起被删掉。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => void run(() => api.clear()),
      },
    ]);
  }

  function saveName() {
    if (!renaming) return;
    const next = draft.trim();
    const from = renaming;
    if (!next) {
      Alert.alert('名字不能为空');
      return;
    }
    setRenaming(null);
    if (next !== from) void run(() => api.rename(from, next));
  }

  return (
    <View style={styles.fill}>
      <FlatList
        data={files}
        keyExtractor={(item) => item.name}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          pending.current = false;
          void refresh().finally(() => setRefreshing(false));
        }}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {header}
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
              <Text style={[styles.count, { color: theme.textSecondary }]}>{files.length}</Text>
            </View>
            <Text style={[styles.hint, { color: theme.textSecondary }]}>点按打开，长按改名或删除</Text>
            {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            还没有文件。上传之后，同一 Wi-Fi 里连进来的人可以一起改。
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.name}
            accessibilityHint="点按打开，长按改名或删除"
            onPress={() => void run(() => api.open(item.name))}
            onLongPress={() => {
              Alert.alert(item.name, undefined, [
                { text: '改名', onPress: () => askRename(item.name) },
                { text: '删除', style: 'destructive', onPress: () => askDelete(item.name) },
                { text: '取消', style: 'cancel' },
              ]);
            }}
            style={({ pressed }) => [
              styles.row,
              { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
            ]}>
            <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
              {item.name}
            </Text>
            <Text style={[styles.size, { color: theme.textSecondary }]}>{formatSize(item.size)}</Text>
          </Pressable>
        )}
      />

      <View
        style={[
          styles.bar,
          { borderColor: theme.line, backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, 12) },
        ]}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void upload()}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: theme.plate, opacity: busy ? 0.5 : pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.primaryText, { color: theme.plateText }]}>{busy ? '处理中' : '上传文件'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy || files.length === 0}
          onPress={askClear}
          style={({ pressed }) => [styles.secondary, { opacity: busy || files.length === 0 ? 0.4 : pressed ? 0.6 : 1 }]}>
          <Text style={[styles.secondaryText, { color: theme.danger }]}>清空</Text>
        </Pressable>
      </View>

      <Modal transparent visible={renaming !== null} animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRenaming(null)}>
          <Pressable style={[styles.dialog, { backgroundColor: theme.backgroundElement }]} onPress={() => {}}>
            <Text style={[styles.dialogTitle, { color: theme.text }]}>改名</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              selectTextOnFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]}
              onSubmitEditing={saveName}
            />
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={() => setRenaming(null)}>
                <Text style={[styles.dialogCancel, { color: theme.textSecondary }]}>取消</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={saveName}>
                <Text style={[styles.dialogSave, { color: theme.flag }]}>保存</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 12, flexGrow: 1 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 22 },
  sectionTitle: { fontSize: 18, fontFamily: Fonts.rounded, fontWeight: '700' },
  count: { fontFamily: Fonts.mono, fontSize: 13 },
  hint: { marginTop: 4, marginBottom: 8, fontSize: 13 },
  error: { marginBottom: 8, fontSize: 14, lineHeight: 20 },
  empty: { marginTop: 28, fontSize: 15, lineHeight: 22 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, fontSize: 16 },
  size: { fontFamily: Fonts.mono, fontSize: 12 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: { flex: 1, borderRadius: 999, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 16, fontWeight: '700' },
  secondary: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  secondaryText: { fontSize: 16, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(16, 24, 28, 0.45)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 18, padding: 18, gap: 14 },
  dialogTitle: { fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18 },
  dialogCancel: { fontSize: 16 },
  dialogSave: { fontSize: 16, fontWeight: '700' },
});
