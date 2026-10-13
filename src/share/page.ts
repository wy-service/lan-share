const page = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lan_share</title>
<style>
  body { margin: 0; font: 16px/1.4 sans-serif; background: #E4EEF1; color: #1C2B33; }
  main { max-width: 640px; margin: 0 auto; padding: 24px 20px 96px; }
  h1 { margin: 0; font-size: 28px; }
  .hint, .meta, .empty { color: #5E727A; }
  .label { margin-top: 18px; font-weight: 700; }
  textarea { box-sizing: border-box; width: 100%; min-height: 96px; margin-top: 8px; border: 1px solid #C5D5DB; border-radius: 12px; padding: 10px 12px; font: inherit; color: inherit; background: #F7FBFC; }
  .text-actions { display: flex; gap: 16px; }
  .status { min-height: 1.2em; font-weight: 700; color: #17343C; }
  .err { color: #9E2F2F; min-height: 1.2em; }
  ul { list-style: none; padding: 0; margin: 12px 0 0; }
  li { display: flex; align-items: center; gap: 8px; min-height: 56px; border-bottom: 1px solid #C5D5DB; }
  a { flex: 1; min-width: 0; display: flex; color: inherit; text-decoration: none; }
  .stem { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ext { flex: none; }
  button.link { border: 0; background: none; font: inherit; padding: 8px; color: #17343C; }
  button.danger { color: #9E2F2F; }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; gap: 16px; align-items: center; padding: 12px 20px calc(12px + env(safe-area-inset-bottom)); background: #E4EEF1; border-top: 1px solid #C5D5DB; }
  .primary { flex: 1; border: 0; border-radius: 999px; min-height: 48px; background: #17343C; color: #F4FBFC; font: inherit; font-weight: 700; }
  .clear { border: 0; background: none; min-height: 48px; color: #9E2F2F; font: inherit; font-weight: 700; }
</style>
<main>
  <h1>对方的分享</h1>
  <p class="hint">点文件名下载。改名、删除和清空跟手机上一样。</p>
  <p class="label">分享文本</p>
  <textarea id="text" placeholder="输入，或从剪贴板粘贴"></textarea>
  <div class="text-actions">
    <button class="link" id="paste" type="button">粘贴</button>
    <button class="link" id="share-text" type="button">分享</button>
  </div>
  <p class="status" id="status"></p>
  <p class="err" id="err"></p>
  <ul id="list"></ul>
  <p class="empty" id="empty" hidden>还没有文件。上传之后，同一 Wi-Fi 里连进来的人可以一起改。</p>
</main>
<div class="bar">
  <button class="primary" id="upload" type="button">上传文件</button>
  <button class="clear" id="clear" type="button">清空</button>
</div>
<input id="picker" type="file" multiple hidden>
<script>
const err = document.getElementById('err');
const status = document.getElementById('status');
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const picker = document.getElementById('picker');
const textBox = document.getElementById('text');
let busy = false;

function textName(text) {
  const line = (text.split(/\\n/, 1)[0] || '').trim().replace(/\\s+/g, ' ');
  let stem = line.replace(/[\\\\/\\u0000-\\u001f]/g, '').replace(/^\\.+/, '').trim();
  stem = stem.replace(/\\.txt$/i, '').slice(0, 40).trim();
  return (stem || '文本') + '.txt';
}

function sizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return rounded + ' ' + units[unit];
}

async function api(path, options) {
  const res = await fetch(path, options);
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) throw new Error((data && data.error) || ('没完成 (' + res.status + ')'));
  return data;
}

function uploadPut(path, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', path);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      let data = null;
      if (xhr.responseText) {
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error((data && data.error) || ('没完成 (' + xhr.status + ')')));
        return;
      }
      resolve(data);
    };
    xhr.onerror = () => reject(new Error('没完成'));
    xhr.send(body);
  });
}

function showError(error) {
  err.textContent = error && error.message ? error.message : '没完成';
}

function render(files) {
  list.replaceChildren();
  const rows = Array.isArray(files) ? files : [];
  empty.hidden = rows.length > 0;
  for (const file of rows) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = '/files/' + encodeURIComponent(file.name);
    const dot = file.name.lastIndexOf('.');
    const stem = document.createElement('span');
    stem.className = 'stem';
    stem.textContent = dot > 0 ? file.name.slice(0, dot) : file.name;
    link.append(stem);
    if (dot > 0) {
      const ext = document.createElement('span');
      ext.className = 'ext';
      ext.textContent = file.name.slice(dot);
      link.append(ext);
    }
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = sizeText(file.size);
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'link';
    rename.textContent = '改名';
    rename.onclick = () => renameFile(file.name);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link danger';
    remove.textContent = '删除';
    remove.onclick = () => removeFile(file.name);
    li.append(link, meta, rename, remove);
    list.append(li);
  }
}

async function refresh() {
  if (busy) return;
  try {
    render(await api('/files'));
    err.textContent = '';
  } catch (error) {
    showError(error);
  }
}

async function run(task) {
  if (busy) return;
  busy = true;
  try {
    await task();
  } catch (error) {
    showError(error);
    busy = false;
    status.textContent = '';
    return;
  }
  busy = false;
  status.textContent = '';
  await refresh();
}

function renameFile(name) {
  const next = prompt('改名', name);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) {
    showError(new Error('名字不能为空'));
    return;
  }
  if (trimmed === name) return;
  void run(() => api('/files/' + encodeURIComponent(name), { method: 'PATCH', body: trimmed }));
}

function removeFile(name) {
  if (!confirm('删除这个文件？\\n' + name)) return;
  void run(() => api('/files/' + encodeURIComponent(name), { method: 'DELETE' }));
}

document.getElementById('upload').onclick = () => picker.click();
picker.onchange = () => {
  const files = Array.from(picker.files || []);
  picker.value = '';
  if (files.length === 0) return;
  void run(async () => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const head = files.length > 1 ? ('正在上传 ' + (i + 1) + '/' + files.length) : '正在上传';
      status.textContent = head + ' 0%';
      await uploadPut('/files/' + encodeURIComponent(file.name), file, (loaded, total) => {
        const pct = total ? Math.min(100, Math.round(loaded * 100 / total)) : 0;
        status.textContent = head + ' ' + pct + '%  ' + sizeText(loaded) + ' / ' + sizeText(total);
      });
    }
  });
};
document.getElementById('paste').onclick = async () => {
  try {
    textBox.value = await navigator.clipboard.readText();
    err.textContent = '';
  } catch (error) {
    showError(new Error('剪贴板读不了，直接粘贴到输入框'));
  }
};
document.getElementById('share-text').onclick = () => {
  const text = textBox.value;
  if (!text.trim()) {
    showError(new Error('文本是空的'));
    return;
  }
  void run(async () => {
    status.textContent = '正在分享文本';
    await api('/files/' + encodeURIComponent(textName(text)), { method: 'PUT', body: text });
    textBox.value = '';
  });
};
document.getElementById('clear').onclick = () => {
  if (!confirm('清空全部分享文件？\\n连进来的人看到的也会一起被删掉。')) return;
  void run(() => api('/files', { method: 'DELETE' }));
};
void refresh();
setInterval(() => void refresh(), 3000);
</script>
`;

export const pageBytes = new TextEncoder().encode(page);
