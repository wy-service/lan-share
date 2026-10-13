import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { cleanName, safeName, uniqueName, type SharedFile } from '@/share/http';

function shareDir(): Directory {
  const dir = new Directory(Paths.document, 'share');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function isFile(entry: File | Directory): entry is File {
  return entry instanceof File;
}

function describe(file: File): SharedFile {
  return {
    name: file.name,
    size: file.size,
    modified: file.lastModified ?? 0,
  };
}

export function listFiles(): SharedFile[] {
  return shareDir()
    .list()
    .filter(isFile)
    .filter((file) => !file.name.startsWith('.'))
    .map(describe)
    .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
}

export function localFile(name: string): File | null {
  const safe = safeName(name);
  if (!safe) return null;
  const file = new File(shareDir(), safe);
  return file.exists ? file : null;
}

export function hasRoom(bytes: number): boolean {
  return bytes <= Paths.availableDiskSpace;
}

function tempFile(): File {
  return new File(shareDir(), `.up-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export async function importLocal(source: File): Promise<SharedFile> {
  if (!hasRoom(source.size)) throw new Error('空间不足');
  const dir = shareDir();
  const temp = tempFile();
  try {
    await source.copy(temp);
    const name = uniqueName(cleanName(source.name), (candidate) => new File(dir, candidate).exists);
    temp.rename(name);
    return describe(new File(dir, name));
  } catch (error) {
    if (temp.exists) temp.delete();
    if (error instanceof Error && /space|full|enospc/i.test(error.message)) throw new Error('空间不足');
    throw error;
  }
}

export type Upload = {
  write: (chunk: Uint8Array) => void;
  abort: () => void;
  finish: (requested: string) => SharedFile;
};

export function beginUpload(): Upload {
  const dir = shareDir();
  const temp = tempFile();
  temp.create();
  const handle = temp.open(FileMode.Truncate);
  let closed = false;
  let committed = false;

  return {
    write(chunk) {
      if (chunk.length === 0) return;
      handle.writeBytes(chunk);
    },
    abort() {
      if (closed) return;
      closed = true;
      try {
        handle.close();
      } catch {
        // The handle is already closed when the file was cleared.
      }
      if (temp.exists) temp.delete();
    },
    finish(requested) {
      if (closed) throw new Error('上传已取消');
      closed = true;
      try {
        handle.close();
        if (!temp.exists) throw new Error('分享已被清空');
        const safe = safeName(requested);
        if (!safe) throw new Error('文件名不可用');
        const name = uniqueName(safe, (candidate) => new File(dir, candidate).exists);
        temp.rename(name);
        committed = true;
        return describe(new File(dir, name));
      } catch (error) {
        if (!committed && temp.exists) temp.delete();
        throw error;
      }
    },
  };
}

export function renameFile(from: string, to: string): SharedFile {
  const file = localFile(from);
  if (!file) throw new Error('文件不存在');
  const next = safeName(to);
  if (!next) throw new Error('文件名不可用');
  if (next === file.name) return describe(file);
  const dest = new File(file.parentDirectory, next);
  if (dest.exists) throw new Error('已经有这个名字');
  file.rename(next);
  return describe(new File(file.parentDirectory, next));
}

export function deleteFile(name: string): void {
  const file = localFile(name);
  if (!file) throw new Error('文件不存在');
  file.delete();
}

export function clearFiles(): void {
  for (const entry of shareDir().list()) entry.delete();
}
