import { Directory, File } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { type SharedFile } from '@/share/http';
import { clearFiles, deleteFile, importLocal, listFiles, localFile, renameFile, saveText } from '@/share/store';

export type SpaceApi = {
  list: () => Promise<SharedFile[]>;
  add: (files: File[]) => Promise<void>;
  addText: (text: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  clear: () => Promise<void>;
  open: (name: string) => Promise<void>;
  save: (name: string) => Promise<void>;
};

const GRANT_READ = 1;

function openType(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'apk') return 'application/vnd.android.package-archive';
  return file.type || '*/*';
}

function pickedCancel(error: unknown): boolean {
  return error instanceof Error && /cancell?ed/i.test(error.message);
}

async function present(file: File) {
  if (Platform.OS === 'android') {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: file.contentUri,
        type: openType(file),
        flags: GRANT_READ,
      });
    } catch {
      throw new Error('没有应用能打开。点「另存」，存到下载或其他文件夹后再打开');
    }
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('这台手机不能打开文件');
  await Sharing.shareAsync(file.uri);
}

export function localSpace(): SpaceApi {
  return {
    async list() {
      return listFiles();
    },
    async add(files) {
      for (const file of files) await importLocal(file);
    },
    async addText(text) {
      saveText(text);
    },
    async rename(from, to) {
      renameFile(from, to);
    },
    async remove(name) {
      deleteFile(name);
    },
    async clear() {
      clearFiles();
    },
    async open(name) {
      const file = localFile(name);
      if (!file) throw new Error('文件不存在');
      await present(file);
    },
    async save(name) {
      const file = localFile(name);
      if (!file) throw new Error('文件不存在');
      let directory: Directory;
      try {
        directory = await Directory.pickDirectoryAsync();
      } catch (error) {
        if (pickedCancel(error)) return;
        throw error;
      }
      try {
        await file.copy(directory);
      } catch (error) {
        if (error instanceof Error && /already exists/i.test(error.message)) {
          throw new Error('这个文件夹里已经有同名文件');
        }
        throw error;
      }
    },
  };
}
