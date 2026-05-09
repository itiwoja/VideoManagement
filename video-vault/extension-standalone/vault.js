// vault.js — Video Vault フルページ ロジック (vanilla JS, ES module)

import {
  listVideos,
  createVideo,
  updateVideo,
  deleteVideo,
  recordView,
  listAllTags,
  exportJson,
  importJson,
} from './storage.js';
import { resolveSource, guessThumbnail } from './video-source.js';

// ============== state ==============

const state = {
  videos: /** @type {import('./storage.js').Video[]} */ ([]),
  tags: /** @type {string[]} */ ([]),
  search: '',
  sort: 'addedAt',
  rating: 'all', // 'all' | 'unrated' | '1'..'5'
  tagFilter: /** @type {string|null} */ (null),
};

// ============== util ==============

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

// ============== rendering ==============

function applyFilters() {
  let list = [...state.videos];
  const q = state.search.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.site.toLowerCase().includes(q) ||
        v.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  if (state.rating === 'unrated') {
    list = list.filter((v) => v.rating == null);
  } else if (state.rating !== 'all') {
    const r = Number(state.rating);
    list = list.filter((v) => v.rating === r);
  }
  if (state.tagFilter) {
    list = list.filter((v) => v.tags.includes(state.tagFilter));
  }

  // sort
  const key = state.sort;
  list.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number') return bv - av;
    return new Date(bv).getTime() - new Date(av).getTime();
  });

  return list;
}

function renderGrid() {
  const list = applyFilters();
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  count.textContent = `(${list.length})`;

  if (list.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = list
    .map((v) => {
      const thumb = v.thumbnailUrl
        ? `<img src="${escapeHtml(v.thumbnailUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<span>no thumbnail</span>`;
      const stars = v.rating
        ? Array.from({ length: 5 })
            .map(
              (_, i) =>
                `<span class="star ${i < v.rating ? 'filled' : ''}">★</span>`,
            )
            .join('')
        : '';
      const tagsHtml = v.tags
        .map(
          (t) =>
            `<span class="card-tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`,
        )
        .join('');
      return `
        <li class="card" data-id="${v.id}">
          <div class="thumb" data-action="play">
            ${thumb}
            <span class="site-pill">${escapeHtml(v.site)}</span>
          </div>
          <div class="card-body">
            <div class="card-title" data-action="play">${escapeHtml(v.title)}</div>
            <div class="card-tags">${tagsHtml}</div>
            <div class="meta">
              <span class="stars">${stars}</span>
              <span>👁 ${v.viewCount} · ${formatDate(v.addedAt)}</span>
            </div>
            <div class="card-actions">
              <button data-action="edit">編集</button>
              <button data-action="delete">削除</button>
            </div>
          </div>
        </li>
      `;
    })
    .join('');
}

function renderTagPills() {
  const row = document.getElementById('tag-list-row');
  if (state.tags.length === 0) {
    row.innerHTML = '';
    return;
  }
  row.innerHTML = state.tags
    .map(
      (t) =>
        `<button class="tag-pill tag-name ${state.tagFilter === t ? 'active' : ''}" data-tag-name="${escapeHtml(t)}">${escapeHtml(t)}</button>`,
    )
    .join('');
}

// ============== data ==============

async function refresh() {
  state.videos = await listVideos();
  state.tags = await listAllTags();
  renderGrid();
  renderTagPills();
}

// ============== event handlers ==============

function setupTopbar() {
  document.getElementById('search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderGrid();
  });
  document.getElementById('sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderGrid();
  });

  // rating filter
  const filterRow = document.getElementById('tag-filter-row');
  filterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-rating]');
    if (!btn) return;
    state.rating = btn.dataset.rating;
    filterRow
      .querySelectorAll('button')
      .forEach((b) => b.classList.toggle('active', b === btn));
    renderGrid();
  });

  // tag filter
  document.getElementById('tag-list-row').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tag-name]');
    if (!btn) return;
    const tag = btn.dataset.tagName;
    state.tagFilter = state.tagFilter === tag ? null : tag;
    renderTagPills();
    renderGrid();
  });

  // top buttons
  document.getElementById('add-btn').addEventListener('click', openAddDialog);
  document.getElementById('export-btn').addEventListener('click', handleExport);
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', handleImport);
}

function setupGrid() {
  document.getElementById('grid').addEventListener('click', async (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    const tag = e.target.closest('[data-tag]')?.dataset.tag;

    if (tag) {
      state.tagFilter = state.tagFilter === tag ? null : tag;
      renderTagPills();
      renderGrid();
      return;
    }

    if (action === 'play') {
      const video = state.videos.find((v) => v.id === id);
      if (video) await openPlayer(video);
    } else if (action === 'edit') {
      const video = state.videos.find((v) => v.id === id);
      if (video) openEditDialog(video);
    } else if (action === 'delete') {
      const video = state.videos.find((v) => v.id === id);
      if (video && confirm(`削除しますか?\n${video.title}`)) {
        await deleteVideo(id);
        await refresh();
      }
    }
  });
}

function setupDialogs() {
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeDialog(btn.dataset.close);
    });
  });

  // backdrop click
  document.querySelectorAll('.dialog').forEach((dialog) => {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog(dialog.id);
    });
  });

  // escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.dialog:not(.hidden)').forEach((d) => closeDialog(d.id));
    }
  });

  // add form
  document.getElementById('paste-btn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) document.getElementById('add-url').value = text.trim();
    } catch {
      /* ignore */
    }
  });

  document.getElementById('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('add-url').value.trim();
    const title = document.getElementById('add-title').value.trim();
    const errEl = document.getElementById('add-error');
    errEl.classList.add('hidden');
    if (!url) {
      errEl.textContent = 'URL を入力してください';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      new URL(url);
    } catch {
      errEl.textContent = 'URL の形式が不正です';
      errEl.classList.remove('hidden');
      return;
    }
    const result = await createVideo({
      url,
      title: title || url,
      thumbnailUrl: guessThumbnail(url),
    });
    closeDialog('add-dialog');
    await refresh();
    if (result.duplicate) {
      // 重複のときは通知だけ
      console.log('既に保存済み');
    }
  });

  // edit form
  const ratingRow = document.getElementById('edit-rating');
  ratingRow.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-r]');
    if (!btn) return;
    const r = btn.dataset.r;
    ratingRow
      .querySelectorAll('button')
      .forEach((b) => b.classList.toggle('selected', b === btn));
    ratingRow.dataset.value = r;
  });

  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const title = document.getElementById('edit-title').value.trim();
    const note = document.getElementById('edit-note').value;
    const tagsRaw = document.getElementById('edit-tags').value;
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const ratingRaw = ratingRow.dataset.value;
    const rating =
      ratingRaw == null || ratingRaw === '0' ? null : Number(ratingRaw);

    await updateVideo(id, {
      title: title || undefined,
      rating,
      note: note || null,
      tags,
    });
    closeDialog('edit-dialog');
    await refresh();
  });

  document.getElementById('edit-delete').addEventListener('click', async () => {
    const id = document.getElementById('edit-id').value;
    const video = state.videos.find((v) => v.id === id);
    if (!video) return;
    if (confirm(`削除しますか?\n${video.title}`)) {
      await deleteVideo(id);
      closeDialog('edit-dialog');
      await refresh();
    }
  });
}

function openDialog(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeDialog(id) {
  document.getElementById(id).classList.add('hidden');
}

function openAddDialog() {
  document.getElementById('add-url').value = '';
  document.getElementById('add-title').value = '';
  document.getElementById('add-error').classList.add('hidden');
  openDialog('add-dialog');
  setTimeout(() => document.getElementById('add-url').focus(), 50);
}

function openEditDialog(video) {
  document.getElementById('edit-id').value = video.id;
  document.getElementById('edit-title').value = video.title;
  document.getElementById('edit-note').value = video.note ?? '';
  document.getElementById('edit-tags').value = video.tags.join(', ');
  const ratingRow = document.getElementById('edit-rating');
  ratingRow.querySelectorAll('button').forEach((b) => {
    const r = b.dataset.r === '0' ? null : Number(b.dataset.r);
    b.classList.toggle('selected', r === video.rating);
  });
  ratingRow.dataset.value = video.rating ?? '0';
  openDialog('edit-dialog');
}

async function openPlayer(video) {
  const source = resolveSource(video.url);
  document.getElementById('player-title').textContent = video.title;
  document.getElementById('player-open-original').href = video.url;
  const body = document.getElementById('player-body');

  if (source.type === 'iframe') {
    body.innerHTML = `<iframe src="${escapeHtml(source.url)}"
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
      referrerpolicy="no-referrer"></iframe>`;
  } else if (source.type === 'video') {
    body.innerHTML = `<video src="${escapeHtml(source.url)}" controls autoplay playsinline></video>`;
  } else {
    body.innerHTML = `
      <div class="player-fallback">
        <p>このサイトはアプリ内再生に未対応です。</p>
        <p style="font-size:11px; color: var(--fg-3); word-break:break-all;">${escapeHtml(video.url)}</p>
        <a href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">元サイトで開く ↗</a>
        <p style="font-size:10px; color:var(--fg-3); margin-top:16px;">
          対応サイト: YouTube / TikTok / ニコニコ動画 / Vimeo / 直リンク (.mp4 等)
        </p>
      </div>`;
  }

  openDialog('player-dialog');
  // record view
  await recordView(video.id);
  await refresh();
}

async function handleExport() {
  const json = await exportJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0, 10);
  a.download = `video-vault-backup-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const result = await importJson(text);
    alert(`インポート完了: ${result.added} 件追加 / ${result.skipped} 件スキップ`);
    await refresh();
  } catch (err) {
    alert(`インポート失敗: ${err.message}`);
  } finally {
    e.target.value = '';
  }
}

// ============== player close cleanup ==============

document.getElementById('player-dialog').addEventListener('click', (e) => {
  if (e.target.matches('.dialog') || e.target.matches('[data-close]') || e.target.closest('[data-close]')) {
    // iframe / video を破棄して再生停止
    document.getElementById('player-body').innerHTML = '';
  }
});

// ============== boot ==============

setupTopbar();
setupGrid();
setupDialogs();
refresh();
