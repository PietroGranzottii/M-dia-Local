// Upload, job polling and card UI shared by every page.

export function upload(endpoint, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error */ }
      if (xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Erro ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Sem conexão com o servidor. Ele ainda está rodando?'));
    xhr.send(file);
  });
}

export async function waitForJob(id, onProgress) {
  for (;;) {
    const res = await fetch(`/api/jobs/${id}`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.error);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error(job.error);
    onProgress(job.progress);
    await new Promise((r) => setTimeout(r, 400));
  }
}

export function setupDropZone(drop, picker, onFiles) {
  picker.addEventListener('change', () => {
    onFiles(picker.files);
    picker.value = '';
  });
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  }
  drop.addEventListener('drop', (e) => onFiles(e.dataTransfer.files));
}

export function createCard(queue, title, subtitle) {
  const li = el('li', 'card');
  const head = el('div', 'card-head');
  head.append(el('span', 'file-name', title), el('span', 'file-size', subtitle));
  const status = el('div', 'status', 'Na fila');
  const bar = el('div', 'bar');
  const fill = el('span');
  bar.append(fill);
  const body = el('div', 'card-body');
  li.append(head, status, bar, body);
  queue.prepend(li);

  return {
    body,
    progress(label, p) {
      li.dataset.state = 'working';
      status.textContent = p == null ? `${label}…` : `${label}… ${Math.round(p * 100)}%`;
      fill.style.width = `${(p ?? 0) * 100}%`;
    },
    fail(message) {
      li.dataset.state = 'error';
      status.textContent = message;
      bar.remove();
    },
    finish() {
      li.dataset.state = 'done';
      bar.remove();
      status.textContent = 'Pronto';
    },
  };
}

export function downloadLink(id, name) {
  const link = el('a', 'button', `Baixar ${name}`);
  link.href = `/api/download/${id}/${encodeURIComponent(name)}`;
  link.setAttribute('download', name);
  return link;
}

export function row(badgeClass, label, text, chips) {
  const div = el('div', 'row');
  div.append(el('span', badgeClass, label));
  if (text) div.append(el('span', 'row-text', text));
  if (chips) {
    const list = el('span', 'chips');
    list.append(...chips.map((c) => el('span', 'chip', c)));
    div.append(list);
  }
  return div;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

export function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}
