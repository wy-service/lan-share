import * as Sharing from 'expo-sharing';
import { File, Paths, UploadType } from 'expo-file-system';

import {
  cleanName,
  encodeFilePath,
  errorText,
  type SharedFile,
} from '@/share/http';
import {
  clearFiles,
  deleteFile,
  importLocal,
  listFiles,
  localFile,
  renameFile,
} from '@/share/store';

export type SpaceApi = {
  list: () => Promise<SharedFile[]>;
  add: (files: File[]) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  clear: () => Promise<void>;
  open: (name: string) => Promise<void>;
};

async function present(file: File) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('这台手机不能打开文件');
  await Sharing.shareAsync(file.uri);
}

async function readError(response: Response): Promise<never> {
  let message = `请求失败 (${response.status})`;
  try {
    const data = JSON.parse(await response.text()) as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // Keep the status line when the body is not JSON.
  }
  throw new Error(message);
}

function parseList(body: string): SharedFile[] {
  const value: unknown = JSON.parse(body);
  if (!Array.isArray(value)) throw new Error('分享列表读不了');
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as { name?: unknown; size?: unknown; modified?: unknown };
    if (typeof record.name !== 'string' || typeof record.size !== 'number') return [];
    return [
      {
        name: record.name,
        size: record.size,
        modified: typeof record.modified === 'number' ? record.modified : 0,
      },
    ];
  });
}

export function localSpace(): SpaceApi {
  return {
    async list() {
      return listFiles();
    },
    async add(files) {
      for (const file of files) await importLocal(file);
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
  };
}

export function remoteSpace(address: string): SpaceApi {
  const root = `http://${address}`;
  return {
    async list() {
      const response = await fetch(`${root}/files`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) await readError(response);
      return parseList(await response.text());
    },
    async add(files) {
      for (const file of files) {
        const result = await file.upload(`${root}${encodeFilePath(cleanName(file.name))}`, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
        });
        if (result.status < 200 || result.status >= 300) {
          let message = `上传失败 (${result.status})`;
          try {
            const data = JSON.parse(result.body) as { error?: string };
            if (data.error) message = data.error;
          } catch {
            message = errorText(new Error(message));
          }
          throw new Error(message);
        }
      }
    },
    async rename(from, to) {
      const response = await fetch(`${root}${encodeFilePath(from)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: to,
      });
      if (!response.ok) await readError(response);
    },
    async remove(name) {
      const response = await fetch(`${root}${encodeFilePath(name)}`, { method: 'DELETE' });
      if (!response.ok) await readError(response);
    },
    async clear() {
      const response = await fetch(`${root}/files`, { method: 'DELETE' });
      if (!response.ok) await readError(response);
    },
    async open(name) {
      const dest = new File(Paths.cache, name);
      if (dest.exists) dest.delete();
      const file = await File.downloadFileAsync(`${root}${encodeFilePath(name)}`, dest);
      await present(file);
    },
  };
}
