import * as Clipboard from 'expo-clipboard';
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

import { errorText, type SharedFile } from '@/share/http';
import type { SpaceApi } from '@/share/space';

function nameParts(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

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
  const insets = useSafeAreaInsets();
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
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

  async function openFile(name: string) {
    try {
      await api.open(name);
    } catch (error) {
      Alert.alert('没打开', errorText(error));
    }
  }

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
      setStatus(null);
      setBusy(false);
    }
  }

  async function upload() {
    if (busy) return;
    const picked = await File.pickFileAsync({ multipleFiles: true });
    if (picked.canceled) return;
    const chosen = picked.result;
    await run(async () => {
      for (let i = 0; i < chosen.length; i++) {
        setStatus(chosen.length > 1 ? `正在上传 ${i + 1}/${chosen.length}` : '正在上传');
        await api.add([chosen[i]]);
      }
    });
  }

  async function pasteText() {
    try {
      const value = await Clipboard.getStringAsync();
      if (!value) {
        setError('剪贴板是空的');
        return;
      }
      setText(value);
      setError(null);
    } catch {
      setError('剪贴板读不了');
    }
  }

  function shareText() {
    if (!text.trim()) {
      setError('文本是空的');
      return;
    }
    const body = text;
    void run(async () => {
      setStatus('正在分享文本');
      await api.addText(body);
      setText('');
    });
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
              <Text style={styles.sectionTitle}>{title}</Text>
              <Text style={styles.count}>{files.length}</Text>
            </View>
            <Text style={styles.label}>分享文本</Text>
            <TextInput
              value={text}
              onChangeText={(value) => {
                setText(value);
                setError(null);
              }}
              multiline
              placeholder="输入，或从剪贴板粘贴"
              placeholderTextColor="#5E727A"
              style={styles.textInput}
            />
            <View style={styles.textActions}>
              <Pressable accessibilityRole="button" onPress={() => void pasteText()} disabled={busy}>
                <Text style={styles.action}>粘贴</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={shareText} disabled={busy}>
                <Text style={styles.actionSave}>分享</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>点文件名打开。另存后，文件管理器里就能看到。</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            还没有文件。上传之后，同一 Wi-Fi 里连进来的人可以一起改。
          </Text>
        }
        renderItem={({ item }) => {
          const parts = nameParts(item.name);
          return (
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.name}
                onPress={() => void openFile(item.name)}
                style={({ pressed }) => [styles.name, pressed && styles.rowPressed]}>
                <View style={styles.nameLine}>
                  <View style={styles.stemBox}>
                    <Text numberOfLines={1} style={styles.stem}>
                      {parts.stem}
                    </Text>
                  </View>
                  {parts.ext ? <Text style={styles.ext}>{parts.ext}</Text> : null}
                </View>
                <Text style={styles.size}>{formatSize(item.size)}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void run(async () => {
                    setStatus('正在另存');
                    await api.save(item.name);
                  })
                }
                hitSlop={8}>
                <Text style={styles.action}>另存</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => askRename(item.name)} hitSlop={8}>
                <Text style={styles.action}>改名</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => askDelete(item.name)} hitSlop={8}>
                <Text style={styles.actionDanger}>删除</Text>
              </Pressable>
            </View>
          );
        }}
      />

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {status ? <Text style={styles.uploadStatus}>{status}</Text> : null}
        <View style={styles.barRow}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void upload()}
          style={({ pressed }) => [styles.primary, (busy || pressed) && styles.pressed, busy && styles.disabled]}>
          <Text style={styles.primaryText}>上传文件</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy || files.length === 0}
          onPress={askClear}
          style={({ pressed }) => [styles.secondary, { opacity: busy || files.length === 0 ? 0.4 : pressed ? 0.6 : 1 }]}>
          <Text style={styles.secondaryText}>清空</Text>
        </Pressable>
        </View>
      </View>

      <Modal transparent visible={renaming !== null} animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRenaming(null)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>改名</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              selectTextOnFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor="#5E727A"
              style={styles.input}
              onSubmitEditing={saveName}
            />
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={() => setRenaming(null)}>
                <Text style={styles.dialogCancel}>取消</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={saveName}>
                <Text style={styles.dialogSave}>保存</Text>
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
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1C2B33' },
  count: { fontSize: 13, color: '#5E727A' },
  label: { marginTop: 22, fontSize: 16, fontWeight: '700', color: '#1C2B33' },
  textInput: {
    marginTop: 8,
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1C2B33',
    borderColor: '#C5D5DB',
    backgroundColor: '#F7FBFC',
    textAlignVertical: 'top',
  },
  textActions: { flexDirection: 'row', gap: 16, marginTop: 4 },
  hint: { marginTop: 16, marginBottom: 8, fontSize: 13, color: '#5E727A' },
  error: { marginBottom: 8, fontSize: 14, lineHeight: 20, color: '#9E2F2F' },
  empty: { marginTop: 28, fontSize: 15, lineHeight: 22, color: '#5E727A' },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#C5D5DB',
  },
  rowPressed: { backgroundColor: '#D5E4EA' },
  name: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  stemBox: { flexShrink: 1, minWidth: 0 },
  stem: { fontSize: 16, color: '#1C2B33' },
  ext: { flexShrink: 0, fontSize: 16, color: '#1C2B33' },
  size: { marginTop: 2, fontSize: 12, color: '#5E727A' },
  action: { fontSize: 15, fontWeight: '700', color: '#17343C', paddingVertical: 8, paddingHorizontal: 4 },
  actionSave: { fontSize: 15, fontWeight: '700', color: '#E24B38', paddingVertical: 8, paddingHorizontal: 4 },
  actionDanger: { fontSize: 15, fontWeight: '700', color: '#9E2F2F', paddingVertical: 8, paddingHorizontal: 4 },
  bar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#C5D5DB',
    backgroundColor: '#E4EEF1',
  },
  uploadStatus: { marginBottom: 8, fontSize: 14, fontWeight: '700', color: '#17343C' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  primary: { flex: 1, borderRadius: 999, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17343C' },
  primaryText: { fontSize: 16, fontWeight: '700', color: '#F4FBFC' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  secondary: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  secondaryText: { fontSize: 16, fontWeight: '700', color: '#9E2F2F' },
  backdrop: { flex: 1, backgroundColor: 'rgba(16, 24, 28, 0.45)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 18, padding: 18, gap: 14, backgroundColor: '#F7FBFC' },
  dialogTitle: { fontSize: 18, fontWeight: '700', color: '#1C2B33' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1C2B33',
    borderColor: '#C5D5DB',
    backgroundColor: '#E4EEF1',
  },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18 },
  dialogCancel: { fontSize: 16, color: '#5E727A' },
  dialogSave: { fontSize: 16, fontWeight: '700', color: '#E24B38' },
});
