export const SHARE_PORT = 39217;

export type SharedFile = {
  name: string;
  size: number;
  modified: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function safeName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > 180) return null;
  if (name === '.' || name === '..' || name.startsWith('.')) return null;
  if (/[\\/\u0000-\u001f]/.test(name)) return null;
  return name;
}

export function cleanName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const safe = safeName(base);
  if (safe) return safe;
  const stripped = base.replace(/[\\/\u0000-\u001f]/g, '').replace(/^\.+/, '').trim();
  return safeName(stripped) ?? `file-${Date.now()}`;
}

export function uniqueName(name: string, taken: (name: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const next = `${stem} (${i})${ext}`;
    if (!taken(next)) return next;
  }
  return `${stem} (${Date.now()})${ext}`;
}

export function normalizeAddress(input: string): string | null {
  let text = input.trim();
  text = text.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(text);
  if (!match) return null;
  const parts = match[1].split('.').map((part) => Number(part));
  if (parts.some((part) => part > 255)) return null;
  const port = match[2] === undefined ? SHARE_PORT : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `${match[1]}:${port}`;
}

export function encodeFilePath(name: string): string {
  return `/files/${encodeURIComponent(name)}`;
}

export type HeaderMessage = {
  method: string;
  target: string;
  headers: Record<string, string>;
};

export function headerEnd(buf: Uint8Array): number {
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

export function parseHead(bytes: Uint8Array): HeaderMessage {
  const text = decoder.decode(bytes);
  const lines = text.split('\r\n');
  const request = lines[0]?.split(' ');
  const method = request?.[0];
  const target = request?.[1];
  if (!method || !target || !request[2]?.startsWith('HTTP/')) {
    throw new Error('请求不完整');
  }
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const index = line.indexOf(':');
    if (index < 1) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return { method: method.toUpperCase(), target, headers };
}

export function contentLength(headers: Record<string, string>): number | null {
  const raw = headers['content-length'];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function fileRoute(
  target: string,
): { scope: 'index' } | { scope: 'file'; name: string } | null {
  const path = target.split('?')[0] ?? '';
  if (path === '/files') return { scope: 'index' };
  if (!path.startsWith('/files/')) return null;
  let name: string;
  try {
    name = decodeURIComponent(path.slice('/files/'.length));
  } catch {
    return null;
  }
  const safe = safeName(name);
  if (!safe) return null;
  return { scope: 'file', name: safe };
}

const REASONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  404: 'Not Found',
  405: 'Method Not Allowed',
  411: 'Length Required',
  500: 'Internal Server Error',
};

export function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

export function httpResponse(code: number, body: Uint8Array, contentType: string): Uint8Array {
  const head = encoder.encode(
    `HTTP/1.1 ${code} ${REASONS[code] ?? 'OK'}\r\nContent-Type: ${contentType}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
  );
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '没完成';
}

export function selfCheck(): void {
  if (safeName('../a') !== null) throw new Error('safeName traversal');
  if (safeName('a/b') !== null) throw new Error('safeName slash');
  if (safeName('.secret') !== null) throw new Error('safeName dot');
  if (safeName(' 笔记.txt ') !== '笔记.txt') throw new Error('safeName trim');

  const taken = new Set(['a.txt']);
  if (uniqueName('a.txt', (name) => taken.has(name)) !== 'a (1).txt') throw new Error('uniqueName');
  if (uniqueName('b.txt', (name) => taken.has(name)) !== 'b.txt') throw new Error('uniqueName free');

  if (normalizeAddress('http://192.168.1.8:39217/files') !== '192.168.1.8:39217') {
    throw new Error('normalize url');
  }
  if (normalizeAddress('10.0.0.2') !== `10.0.0.2:${SHARE_PORT}`) throw new Error('normalize default port');
  if (normalizeAddress('999.0.0.1') !== null) throw new Error('normalize octet');
  if (normalizeAddress('10.0.0.1:99999') !== null) throw new Error('normalize port');

  const raw = encoder.encode('PUT /files/a%20b.txt HTTP/1.1\r\nContent-Length: 4\r\n\r\nabcd');
  const split = 11;
  const first = raw.slice(0, split);
  const merged = new Uint8Array(raw.length);
  merged.set(first, 0);
  merged.set(raw.slice(split), split);
  if (headerEnd(first) !== -1) throw new Error('header split');
  const end = headerEnd(merged);
  if (end < 0) throw new Error('header end');
  const head = parseHead(merged.slice(0, end));
  if (head.method !== 'PUT' || contentLength(head.headers) !== 4) throw new Error('parse head');
  const route = fileRoute(head.target);
  if (!route || route.scope !== 'file' || route.name !== 'a b.txt') throw new Error('file route');
  if (fileRoute('/files/%2E%2E%2Fx') !== null) throw new Error('encoded traversal');
  if (fileRoute('/files')?.scope !== 'index') throw new Error('index route');

  const response = decoder.decode(httpResponse(201, jsonBytes({ name: 'a b.txt' }), 'application/json'));
  if (!response.startsWith('HTTP/1.1 201 Created\r\n')) throw new Error('status');
  if (!response.endsWith('{"name":"a b.txt"}')) throw new Error('body');
}
