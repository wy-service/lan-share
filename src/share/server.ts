import TcpSocket from 'react-native-tcp-socket';
import type Socket from 'react-native-tcp-socket/lib/types/Socket';
import { FileMode } from 'expo-file-system';

import {
  SHARE_PORT,
  contentLength,
  errorText,
  fileRoute,
  headerEnd,
  httpResponse,
  jsonBytes,
  parseHead,
  type HeaderMessage,
} from '@/share/http';
import {
  beginUpload,
  clearFiles,
  deleteFile,
  hasRoom,
  listFiles,
  localFile,
  renameFile,
  type Upload,
} from '@/share/store';

const JSON_TYPE = 'application/json; charset=utf-8';

type Phase =
  | { stage: 'head'; buf: Uint8Array }
  | { stage: 'upload'; upload: Upload; name: string; length: number; received: number }
  | { stage: 'body'; head: HeaderMessage; route: { scope: 'file'; name: string }; length: number; received: number; buf: Uint8Array }
  | { stage: 'done' };

function bytesOf(data: Uint8Array | string): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(data);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function drained(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.once('drain', () => resolve());
  });
}

// ponytail: Connection: close, one request per socket. Add keep-alive if clients pipeline.
async function sendFile(socket: Socket, file: NonNullable<ReturnType<typeof localFile>>) {
  const size = file.size;
  const head = `HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ${size}\r\nConnection: close\r\n\r\n`;
  if (!socket.write(head)) await drained(socket);
  const handle = file.open(FileMode.ReadOnly);
  try {
    let left = size;
    while (left > 0) {
      const chunk = handle.readBytes(Math.min(64 * 1024, left));
      if (chunk.length === 0) break;
      left -= chunk.length;
      if (!socket.write(chunk)) await drained(socket);
    }
  } finally {
    handle.close();
  }
  socket.end();
}

function accept(socket: Socket) {
  socket.setNoDelay(true);
  socket.setTimeout(120_000);

  let finished = false;
  let phase: Phase = { stage: 'head', buf: new Uint8Array() };

  const fail = (code: number, message: string) => {
    if (finished) return;
    finished = true;
    const upload = phase.stage === 'upload' ? phase.upload : null;
    phase = { stage: 'done' };
    try {
      upload?.abort();
    } catch {
      // The temp file may already be gone.
    }
    try {
      socket.end(httpResponse(code, jsonBytes({ error: message }), JSON_TYPE));
    } catch {
      socket.destroy();
    }
  };

  const reply = (code: number, payload: unknown) => {
    if (finished) return;
    finished = true;
    phase = { stage: 'done' };
    socket.end(httpResponse(code, jsonBytes(payload), JSON_TYPE));
  };

  const replyEmpty = (code: number) => {
    if (finished) return;
    finished = true;
    phase = { stage: 'done' };
    socket.end(httpResponse(code, new Uint8Array(), 'text/plain'));
  };

  const storeFail = (error: unknown) => {
    const message = errorText(error);
    fail(message === '文件不存在' ? 404 : 400, message);
  };

  const dispatch = (head: HeaderMessage, route: { scope: 'file'; name: string }, body: Uint8Array) => {
    if (head.method !== 'PATCH') {
      fail(405, '不能这样改');
      return;
    }
    try {
      reply(200, renameFile(route.name, new TextDecoder().decode(body)));
    } catch (error) {
      storeFail(error);
    }
  };

  const openRequest = (head: HeaderMessage, rest: Uint8Array) => {
    const route = fileRoute(head.target);
    if (!route) {
      fail(404, '没有这个文件');
      return;
    }
    const length = contentLength(head.headers);

    if (head.method === 'GET' && route.scope === 'index') {
      try {
        reply(200, listFiles());
      } catch (error) {
        storeFail(error);
      }
      return;
    }

    if (head.method === 'GET' && route.scope === 'file') {
      const file = localFile(route.name);
      if (!file) {
        fail(404, '文件不存在');
        return;
      }
      phase = { stage: 'done' };
      finished = true;
      void sendFile(socket, file).catch(() => socket.destroy());
      return;
    }

    if (head.method === 'DELETE' && route.scope === 'index') {
      try {
        clearFiles();
        replyEmpty(204);
      } catch (error) {
        storeFail(error);
      }
      return;
    }

    if (head.method === 'DELETE' && route.scope === 'file') {
      try {
        deleteFile(route.name);
        replyEmpty(204);
      } catch (error) {
        storeFail(error);
      }
      return;
    }

    if (head.method === 'PUT' && route.scope === 'file') {
      if (length === null) {
        fail(411, '缺少文件长度');
        return;
      }
      if (!hasRoom(length)) {
        fail(400, '空间不足');
        return;
      }
      try {
        const upload = beginUpload();
        phase = { stage: 'upload', upload, name: route.name, length, received: 0 };
        takeUpload(rest);
      } catch (error) {
        storeFail(error);
      }
      return;
    }

    if (head.method === 'PATCH' && route.scope === 'file') {
      if (length === null) {
        fail(411, '缺少文件长度');
        return;
      }
      if (length > 1024) {
        fail(400, '文件名太长');
        return;
      }
      phase = { stage: 'body', head, route, length, received: 0, buf: new Uint8Array() };
      takeBody(rest);
      return;
    }

    fail(405, '不能这样改');
  };

  const takeUpload = (chunk: Uint8Array) => {
    if (phase.stage !== 'upload') return;
    const need = phase.length - phase.received;
    const take = chunk.subarray(0, need);
    if (take.length > 0) {
      phase.upload.write(take);
      phase.received += take.length;
    }
    if (phase.received < phase.length) return;
    const { upload, name } = phase;
    phase = { stage: 'done' };
    try {
      const info = upload.finish(name);
      reply(201, info);
    } catch (error) {
      storeFail(error);
    }
  };

  const takeBody = (chunk: Uint8Array) => {
    if (phase.stage !== 'body') return;
    const need = phase.length - phase.received;
    const take = chunk.subarray(0, need);
    if (take.length > 0) {
      phase.buf = concat(phase.buf, take);
      phase.received += take.length;
    }
    if (phase.received < phase.length) return;
    const current = phase;
    phase = { stage: 'done' };
    dispatch(current.head, current.route, current.buf);
  };

  const onData = (data: Uint8Array | string) => {
    if (finished || phase.stage === 'done') return;
    const chunk = bytesOf(data);
    if (phase.stage === 'head') {
      const buf = concat(phase.buf, chunk);
      const end = headerEnd(buf);
      if (end < 0) {
        if (buf.length > 16 * 1024) {
          fail(400, '请求头太大');
          return;
        }
        phase = { stage: 'head', buf };
        return;
      }
      let head: HeaderMessage;
      try {
        head = parseHead(buf.subarray(0, end));
      } catch (error) {
        fail(400, errorText(error));
        return;
      }
      openRequest(head, buf.subarray(end + 4));
      return;
    }
    if (phase.stage === 'upload') takeUpload(chunk);
    else if (phase.stage === 'body') takeBody(chunk);
  };

  socket.on('data', (data) => {
    try {
      onData(data);
    } catch (error) {
      fail(500, errorText(error));
    }
  });
  socket.on('timeout', () => {
    if (!finished && phase.stage === 'upload') {
      try {
        phase.upload.abort();
      } catch {
        // The temp file may already be gone.
      }
    }
    socket.destroy();
  });
  socket.on('error', () => {
    if (finished) return;
    finished = true;
    if (phase.stage === 'upload') {
      try {
        phase.upload.abort();
      } catch {
        // The temp file may already be gone.
      }
    }
  });
  socket.on('close', () => {
    if (finished) return;
    finished = true;
    if (phase.stage === 'upload') {
      try {
        phase.upload.abort();
      } catch {
        // The temp file may already be gone.
      }
    }
  });
}

export function startShareServer(): Promise<{ stop: () => void }> {
  return new Promise((resolve, reject) => {
    const server = TcpSocket.createServer((socket) => {
      accept(socket);
    });
    let settled = false;
    server.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    server.listen({ port: SHARE_PORT, host: '0.0.0.0', reuseAddress: true }, () => {
      if (settled) return;
      settled = true;
      resolve({
        stop() {
          server.close();
        },
      });
    });
  });
}
