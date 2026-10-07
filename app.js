'use strict';

const STORAGE_KEY = 'west_diary_entries';
const BACKUP_KEY = 'west_diary_last_backup';
const VIEW_KEY = 'west_diary_view';
const BACKUP_REMIND_DAYS = 30;

const state = {
  catalog: [],        // WEST. の作品カタログ（catalog.json）
  catalogLoaded: false,
  entries: [],        // 日記（この端末のブラウザに保存）
  view: 'timeline',   // 'timeline' | 'group' | 'songs'
  keyword: '',        // 日記の検索語
  songKeyword: '',    // 曲をさがす の検索語
  category: 'all',
  editingId: null,
  confirmingId: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  form: $('entry-form'), formPanel: document.querySelector('.form-panel'), formHeading: $('form-heading'),
  date: $('date'), song: $('song'), album: $('album'), lyric: $('lyric'), memo: $('memo'), player: $('player'),
  songOptions: $('song-options'), albumOptions: $('album-options'), albumHint: $('album-hint'),
  formError: $('form-error'), submitBtn: $('submit-btn'), submitLabel: document.querySelector('#submit-btn .btn-label'),
  cancelBtn: $('cancel-btn'), tabs: document.querySelectorAll('.tab'), search: $('search'),
  categoryFilter: $('category-filter'), list: $('entry-list'), count: $('count'), notice: $('notice'),
  exportBtn: $('export-btn'), importBtn: $('import-btn'), importFile: $('import-file'),
  backupStatus: $('backup-status'), dataMessage: $('data-message'),
};

/* ---------- ユーティリティ ---------- */
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function normalize(str) {
  return String(str || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}
function formatDate(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd || '') ? ymd.replace(/-/g, '.') : (ymd || '');
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // XSS 対策：常に textContent で挿入
  return node;
}
function showNotice(message) {
  els.notice.textContent = message;
  els.notice.hidden = !message;
}
function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- 保存先（この端末の localStorage） ---------- */
function loadEntries() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('日記データの読み込みに失敗しました', e);
    showNotice('日記を読み込めませんでした。');
    return [];
  }
}

// 保存できたら true。失敗時は state を元に戻せるよう呼び出し側で扱う
function saveEntries(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    state.entries = entries;
    return true;
  } catch (e) {
    console.error('日記データの保存に失敗しました', e);
    return false;
  }
}

/* ---------- カタログ ---------- */
const workById = (id) => state.catalog.find((w) => w.id === id) || null;

// 入力された作品名をカタログの作品に対応づける（完全一致 → 部分一致）
function findWork(albumName) {
  const n = normalize(albumName);
  if (!n) return null;
  return state.catalog.find((w) => normalize(w.name) === n)
    || state.catalog.find((w) => normalize(w.name).includes(n) || n.includes(normalize(w.name)))
    || null;
}

// その曲を収録した作品のうち、最初に発売されたもの
function firstWorkWithSong(song) {
  const n = normalize(song);
  if (!n) return null;
  return state.catalog.find((w) => w.songs.some((s) => normalize(s.title) === n)) || null;
}

// 曲名に対応するカタログの曲（作品が分かればその収録曲を優先）
function findSong(title, work) {
  const n = normalize(title);
  if (!n) return null;
  const inWork = work && work.songs.find((s) => normalize(s.title) === n);
  if (inWork) return inWork;
  const other = firstWorkWithSong(title);
  return other ? other.songs.find((s) => normalize(s.title) === n) : null;
}

function fillOptions(datalist, values) {
  datalist.replaceChildren(...values.map((v) => { const o = document.createElement('option'); o.value = v; return o; }));
}

function refreshSongOptions() {
  const work = findWork(els.album.value);
  const songs = (work ? work.songs : state.catalog.flatMap((w) => w.songs)).map((s) => s.title);
  fillOptions(els.songOptions, [...new Set(songs)]);
}

function updateAlbumHint() {
  const hint = els.albumHint;
  hint.replaceChildren();
  hint.classList.remove('is-missing');
  if (!els.album.value.trim() || state.catalog.length === 0) return;
  const work = findWork(els.album.value);
  if (work) {
    const img = document.createElement('img');
    img.src = work.artwork; img.alt = '';
    hint.append(img, `${work.name}（${formatDate(work.releaseDate)} 発売）`);
  } else {
    hint.classList.add('is-missing');
    hint.textContent = 'カタログにない作品です。ジャケットなし・発売日不明で保存されます。';
  }
}

function setCategoryValue(value) {
  $(value === 'single' ? 'cat-single' : 'cat-album').checked = true;
}
function getCategoryValue() {
  return $('cat-single').checked ? 'single' : 'album';
}

function onAlbumChanged() {
  const work = findWork(els.album.value);
  if (work && normalize(work.name) === normalize(els.album.value)) setCategoryValue(work.category);
  updateAlbumHint();
  refreshSongOptions();
}

function onSongChanged() {
  if (els.album.value.trim()) return;
  const work = firstWorkWithSong(els.song.value);
  if (work) {
    els.album.value = work.name;
    onAlbumChanged();
  }
}

async function loadCatalog() {
  try {
    const res = await fetch('catalog.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.catalog = (data.works || []).slice().sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  } catch (e) {
    console.warn('カタログの読み込みに失敗しました', e);
    state.catalog = [];
  }
  state.catalogLoaded = true;
  fillOptions(els.albumOptions, state.catalog.map((w) => w.name));
  refreshSongOptions();
  updateAlbumHint();
  render();
}

/* ---------- フォーム ---------- */
function showFormError(message) {
  els.formError.textContent = message;
  els.formError.hidden = !message;
}

function resetForm() {
  state.editingId = null;
  els.form.reset();
  els.date.value = todayString();
  setCategoryValue('album');
  showFormError('');
  els.formHeading.textContent = '新しい日記';
  els.submitLabel.textContent = '保存';
  els.cancelBtn.hidden = true;
  els.formPanel.classList.remove('is-editing');
  updateAlbumHint();
  refreshSongOptions();
}

function startEdit(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  state.editingId = id;
  state.confirmingId = null;
  els.date.value = entry.date;
  els.song.value = entry.song;
  els.album.value = entry.album;
  els.lyric.value = entry.lyric || '';
  els.memo.value = entry.memo || '';
  setCategoryValue(entry.category);
  showFormError('');
  els.formHeading.textContent = '日記を編集';
  els.submitLabel.textContent = '更新';
  els.cancelBtn.hidden = false;
  els.formPanel.classList.add('is-editing');
  updateAlbumHint();
  refreshSongOptions();
  render();
  els.formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  els.song.focus({ preventScroll: true });
}

function handleSubmit(event) {
  event.preventDefault();

  const date = els.date.value;
  const song = els.song.value.trim();
  const album = els.album.value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showFormError('日付を入力してください。');
  if (!song) return showFormError('曲名を入力してください。');
  if (!album) return showFormError('作品名を入力してください。');
  showFormError('');

  const now = new Date().toISOString();
  const existing = state.editingId ? state.entries.find((e) => e.id === state.editingId) : null;
  const work = findWork(album);
  const body = {
    id: existing ? existing.id : newId(),
    date, song, album,
    category: getCategoryValue(),
    lyric: els.lyric.value.trim(),
    memo: els.memo.value.trim(),
    workId: work ? work.id : '',
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  const next = existing
    ? state.entries.map((e) => (e.id === existing.id ? body : e))
    : [...state.entries, body];
  if (!saveEntries(next)) {
    showFormError('保存できませんでした。端末の空き容量を確認してください。');
    return;
  }
  resetForm();
  render();
  updateBackupStatus();
}

function deleteEntry(id) {
  if (!saveEntries(state.entries.filter((e) => e.id !== id))) {
    showNotice('削除できませんでした。もう一度お試しください。');
    return;
  }
  state.confirmingId = null;
  if (state.editingId === id) resetForm();
  render();
  updateBackupStatus();
}

/* ---------- 絞り込み・並び替え ---------- */
function entryWork(e) {
  return workById(e.workId) || findWork(e.album);
}

function getFilteredEntries() {
  const kw = normalize(state.keyword);
  return state.entries.filter((e) => {
    if (state.category !== 'all' && e.category !== state.category) return false;
    if (!kw) return true;
    return [e.song, e.album, e.lyric, e.memo].some((v) => normalize(v).includes(kw));
  });
}

function compareByDateDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || '').localeCompare(a.createdAt || '');
}

// 作品ごとにまとめ、発売日の古い順に並べる（カタログにない作品は末尾に作品名順）
function groupByWork(entries) {
  const map = new Map();
  entries.forEach((e) => {
    const work = entryWork(e);
    const key = work ? `w:${work.id}` : `a:${normalize(e.album)}`;
    if (!map.has(key)) map.set(key, { work, album: work ? work.name : e.album, entries: [] });
    map.get(key).entries.push(e);
  });
  const groups = [...map.values()];
  groups.forEach((g) => g.entries.sort(compareByDateDesc));
  groups.sort((a, b) => {
    const ra = a.work ? a.work.releaseDate : '';
    const rb = b.work ? b.work.releaseDate : '';
    if (ra && rb && ra !== rb) return ra < rb ? -1 : 1;
    if (ra && !rb) return -1;
    if (!ra && rb) return 1;
    return a.album.localeCompare(b.album, 'ja');
  });
  return groups;
}

/* ---------- 描画 ---------- */
function createArtwork(work, alt) {
  const box = el('div', 'artwork');
  const placeholder = () => { box.textContent = '♪'; box.setAttribute('aria-hidden', 'true'); };
  if (work && work.artwork) {
    const img = document.createElement('img');
    img.src = work.artwork;
    img.alt = alt;
    img.loading = 'lazy';
    img.onerror = () => { img.remove(); placeholder(); };
    box.appendChild(img);
  } else {
    placeholder();
  }
  return box;
}

function createBadge(category) {
  const single = category === 'single';
  return el('span', `badge ${single ? 'badge-single' : 'badge-album'}`, single ? 'シングル' : 'アルバム');
}

function createButton(label, className, onClick) {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function createLink(label, href, className = 'btn btn-small') {
  const a = el('a', className, label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

// 歌詞は権利の都合でページに載せず、外部サイトで開く
// 「〇〇 - From THE FIRST TAKE」「〇〇 (LIVE From …)」などの別バージョンは元の曲名で探す
const baseTitle = (title) => title.replace(/\s+-\s+.*$/, '').replace(/\s*[(（][^()（）]*[)）]$/, '').trim() || title;
const lyricsUrl = (title) => `https://www.uta-net.com/search/?Aselect=2&Bselect=3&Keyword=${encodeURIComponent(baseTitle(title))}`;
const youtubeMusicUrl = (title) => `https://music.youtube.com/search?q=${encodeURIComponent(`WEST. ${title}`)}`;

/* ---------- 試聴（iTunes の 30 秒プレビュー） ---------- */
let playingUrl = null;
const failedPreviews = new Set();  // 再生できなかった URL は以後ボタンを出さない

function syncPlayButtons() {
  const p = els.player;
  const ratio = p.duration ? (p.currentTime / p.duration) * 100 : 0;
  document.querySelectorAll('.btn-play').forEach((b) => {
    const active = !p.paused && b.dataset.preview === playingUrl;
    b.classList.toggle('is-playing', active);
    b.setAttribute('aria-pressed', String(active));
    b.textContent = active ? '❚❚ 停止' : '▶ 試聴';
    b.style.setProperty('--p', active ? `${ratio}%` : '0%');
  });
}

function onPreviewFailed(url) {
  if (!url) return;
  failedPreviews.add(url);
  if (playingUrl === url) playingUrl = null;
  showNotice(navigator.onLine === false
    ? '試聴にはインターネット接続が必要です。'
    : '試聴を再生できませんでした。「YouTube Music」から聴いてください。');
  render();
}

function togglePreview(url) {
  const p = els.player;
  if (playingUrl === url && !p.paused) {
    p.pause();
    return;
  }
  showNotice('');
  playingUrl = url;
  p.src = url;
  p.play().catch((err) => { if (err.name !== 'AbortError') onPreviewFailed(url); });
  syncPlayButtons();
}

// 試聴・YouTube Music・歌詞のボタン
function createListenActions(title, work) {
  const song = findSong(title, work);
  const items = [];
  if (song && song.preview && !failedPreviews.has(song.preview)) {
    const b = createButton('▶ 試聴', 'btn btn-small btn-play', () => togglePreview(song.preview));
    b.dataset.preview = song.preview;
    b.setAttribute('aria-label', `${title} を試聴`);
    items.push(b);
  }
  items.push(
    createLink('YouTube Music', youtubeMusicUrl(title)),
    createLink('歌詞を見る', lyricsUrl(title)),
  );
  return items;
}

function createCard(entry, { showAlbum = true } = {}) {
  const card = el('article', 'card');
  if (entry.id === state.editingId) card.classList.add('is-editing');
  const work = entryWork(entry);
  card.appendChild(createArtwork(work, `${entry.album} のジャケット`));

  const body = el('div', 'card-body');
  const meta = el('div', 'card-meta');
  const time = el('time', '', formatDate(entry.date));
  time.dateTime = entry.date;
  meta.append(time, createBadge(entry.category));
  body.appendChild(meta);
  body.appendChild(el('h3', 'card-song', entry.song));
  if (showAlbum) body.appendChild(el('p', 'card-album', entry.album));
  if (entry.lyric) body.appendChild(el('blockquote', 'card-lyric', entry.lyric));
  if (entry.memo) body.appendChild(el('p', 'card-memo', entry.memo));

  const actions = el('div', 'card-actions');
  if (state.confirmingId === entry.id) {
    actions.append(
      el('span', 'confirm-text', 'この日記を削除しますか？'),
      createButton('やめる', 'btn btn-small', () => { state.confirmingId = null; render(); }),
      createButton('削除する', 'btn btn-danger-solid', () => deleteEntry(entry.id)),
    );
  } else {
    const editBtn = createButton('編集', 'btn btn-small', () => startEdit(entry.id));
    const delBtn = createButton('削除', 'btn btn-small btn-danger', () => { state.confirmingId = entry.id; render(); });
    actions.append(...createListenActions(entry.song, work), el('span', 'actions-gap'), editBtn, delBtn);
  }
  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function createEmpty(message) {
  const box = el('div', 'empty');
  box.append(el('span', 'empty-icon', '♪'), el('p', '', message));
  return box;
}

/* ---------- 曲をさがす ---------- */
// 検索語に曲名または作品名が一致する { work, song } の一覧（発売順）
function getSongMatches() {
  const kw = normalize(state.songKeyword);
  const rows = [];
  state.catalog.forEach((work) => {
    if (state.category !== 'all' && work.category !== state.category) return;
    const workHit = kw && normalize(work.name).includes(kw);
    work.songs.forEach((song) => {
      if (!kw || workHit || normalize(song.title).includes(kw)) rows.push({ work, song });
    });
  });
  return rows;
}

// 曲名ごとの日記の件数
function countEntriesBySong() {
  const counts = new Map();
  state.entries.forEach((e) => {
    const key = normalize(e.song);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

// 選んだ曲をフォームに入れる（編集中なら新規の日記に切り替える）
function writeWithSong(work, song) {
  if (state.editingId) resetForm();
  els.song.value = song.title;
  els.album.value = work.name;
  onAlbumChanged();
  setCategoryValue(work.category);
  render();
  els.formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  els.memo.focus({ preventScroll: true });
}

function createGroupHeader(work, albumName, category, summary) {
  const header = el('div', 'group-header');
  header.appendChild(createArtwork(work, `${albumName} のジャケット`));
  const info = el('div', 'group-info');
  info.appendChild(el('h3', 'group-title', albumName));
  const sub = el('p', 'group-sub');
  sub.append(createBadge(category), summary);
  info.appendChild(sub);
  header.appendChild(info);
  return header;
}

function createSongRow({ work, song }, counts, { showWork }) {
  const row = el('article', 'song-row');
  if (showWork) row.appendChild(createArtwork(work, `${work.name} のジャケット`));
  const main = el('div', 'song-main');
  main.appendChild(el('h4', 'song-title', song.title));
  const sub = el('p', 'song-sub');
  if (showWork) sub.append(createBadge(work.category), `${work.name} ・ ${formatDate(work.releaseDate)}`);
  const n = counts.get(normalize(song.title)) || 0;
  if (n > 0) sub.appendChild(el('span', 'recorded', `記録済み ${n} 回`));
  if (sub.childNodes.length) main.appendChild(sub);
  const actions = el('div', 'card-actions');
  actions.append(
    ...createListenActions(song.title, work),
    createButton('この曲で日記を書く', 'btn btn-small btn-write', () => writeWithSong(work, song)),
  );
  main.appendChild(actions);
  row.appendChild(main);
  return row;
}

function renderSongs() {
  if (!state.catalogLoaded) {
    els.list.appendChild(createEmpty('曲の一覧を読み込んでいます…'));
    return;
  }
  if (state.catalog.length === 0) {
    els.list.appendChild(createEmpty('曲の一覧を読み込めませんでした。インターネットに接続して開き直してください。'));
    return;
  }
  const rows = getSongMatches();
  els.count.hidden = false;
  els.count.textContent = `${rows.length} 曲`;
  if (rows.length === 0) {
    els.list.appendChild(createEmpty('条件に一致する曲が見つかりませんでした。'));
    return;
  }
  const counts = countEntriesBySong();

  // 検索語があれば曲を並べ、なければ作品ごとに見出しを付けて全曲を出す
  if (normalize(state.songKeyword)) {
    rows.forEach((r) => els.list.appendChild(createSongRow(r, counts, { showWork: true })));
    return;
  }
  const byWork = new Map();
  rows.forEach((r) => {
    if (!byWork.has(r.work)) byWork.set(r.work, []);
    byWork.get(r.work).push(r);
  });
  byWork.forEach((workRows, work) => {
    const section = el('section', 'group');
    section.appendChild(createGroupHeader(work, work.name, work.category,
      `${formatDate(work.releaseDate)} 発売 ・ ${work.songs.length} 曲`));
    workRows.forEach((r) => section.appendChild(createSongRow(r, counts, { showWork: false })));
    els.list.appendChild(section);
  });
}

function render() {
  els.list.replaceChildren();
  els.count.hidden = true;
  if (state.view === 'songs') renderSongs();
  else renderEntries();
  syncPlayButtons();
}

function renderEntries() {
  if (state.entries.length === 0) {
    els.list.appendChild(createEmpty('まだ日記がありません。最初の1曲を記録しましょう。引っ越しの場合は、下の「日記を読み込む」から。'));
    return;
  }
  const filtered = getFilteredEntries();
  els.count.hidden = false;
  els.count.textContent = filtered.length === state.entries.length
    ? `全 ${state.entries.length} 件`
    : `${filtered.length} 件 / 全 ${state.entries.length} 件`;
  if (filtered.length === 0) {
    els.list.appendChild(createEmpty('条件に一致する日記が見つかりませんでした。'));
    return;
  }

  if (state.view === 'timeline') {
    filtered.slice().sort(compareByDateDesc).forEach((e) => els.list.appendChild(createCard(e)));
    return;
  }

  groupByWork(filtered).forEach((g) => {
    const section = el('section', 'group');
    section.appendChild(createGroupHeader(
      g.work, g.album, g.work ? g.work.category : g.entries[0].category,
      `${g.work ? formatDate(g.work.releaseDate) + ' 発売' : '発売日不明'} ・ ${g.entries.length} 件`,
    ));
    g.entries.forEach((e) => section.appendChild(createCard(e, { showAlbum: false })));
    els.list.appendChild(section);
  });
}

function setView(view) {
  state.view = view;
  els.tabs.forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  // 検索窓は日記と曲で別々の検索語を持つ
  const songs = view === 'songs';
  els.search.value = songs ? state.songKeyword : state.keyword;
  els.search.placeholder = songs ? '曲名・作品名で検索' : '曲名・作品名・歌詞・本文で検索';
  els.search.setAttribute('aria-label', songs ? '曲を検索' : 'キーワード検索');
  try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* 保存できなくても動作に影響なし */ }
  render();
}

/* ---------- 書き出し・読み込み（引っ越し・バックアップ） ---------- */
function showDataMessage(message, isError = false) {
  els.dataMessage.textContent = message;
  els.dataMessage.classList.toggle('is-error', isError);
}

function updateBackupStatus() {
  let last = null;
  try { last = localStorage.getItem(BACKUP_KEY); } catch (e) { /* 不明として扱う */ }
  const status = els.backupStatus;
  status.classList.remove('is-warning');
  if (last) {
    status.textContent = `最後のバックアップ：${formatDate(last.slice(0, 10))}`;
    const days = (Date.now() - Date.parse(last)) / 86400000;
    if (state.entries.length > 0 && days >= BACKUP_REMIND_DAYS) {
      status.textContent += `（${Math.floor(days)}日前。そろそろ書き出しておきましょう）`;
      status.classList.add('is-warning');
    }
  } else {
    status.textContent = state.entries.length > 0
      ? 'まだバックアップしていません。日記はこの端末の中だけにあるので、ときどき書き出しておきましょう。'
      : '';
    if (state.entries.length > 0) status.classList.add('is-warning');
  }
}

async function exportEntries() {
  if (state.entries.length === 0) {
    showDataMessage('書き出す日記がありません。');
    return;
  }
  const data = JSON.stringify({ app: 'west-diary', version: 1, exportedAt: new Date().toISOString(), entries: state.entries }, null, 2);
  const filename = `west-diary-${todayString()}.json`;
  const file = new File([data], filename, { type: 'application/json' });

  try {
    // スマホでは共有シートから「ファイルに保存」などを選べる
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      showDataMessage('書き出しを取りやめました。');
      return;
    }
    console.error(err);
    showDataMessage('書き出せませんでした。', true);
    return;
  }
  try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (e) { /* 記録できなくても書き出しは済んでいる */ }
  showDataMessage(`${state.entries.length} 件の日記を書き出しました。`);
  updateBackupStatus();
}

// 書き出したファイルの 1 件を検証して日記の形にそろえる（不正なものは null）
function sanitizeImported(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const date = str(raw.date, 10);
  const song = str(raw.song, 100);
  const album = str(raw.album, 100);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !song || !album) return null;
  const now = new Date().toISOString();
  return {
    id: str(raw.id, 100) || newId(),
    date, song, album,
    category: raw.category === 'single' ? 'single' : 'album',
    lyric: str(raw.lyric, 200),
    memo: str(raw.memo, 2000),
    workId: str(raw.workId, 50),
    createdAt: str(raw.createdAt, 40) || now,
    updatedAt: str(raw.updatedAt, 40) || now,
  };
}

async function importEntries(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    showDataMessage('ファイルを読み込めませんでした。書き出した .json ファイルを選んでください。', true);
    return;
  }
  const list = Array.isArray(parsed) ? parsed : parsed && parsed.entries;
  if (!Array.isArray(list)) {
    showDataMessage('日記のファイルではないようです。書き出した .json ファイルを選んでください。', true);
    return;
  }

  // 同じ id の日記は、更新日時が新しい方を残す
  const byId = new Map(state.entries.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  list.forEach((raw) => {
    const entry = sanitizeImported(raw);
    if (!entry) { skipped += 1; return; }
    const current = byId.get(entry.id);
    if (!current) {
      byId.set(entry.id, entry);
      added += 1;
    } else if ((entry.updatedAt || '') > (current.updatedAt || '')) {
      byId.set(entry.id, entry);
      updated += 1;
    }
  });

  if (!saveEntries([...byId.values()])) {
    showDataMessage('保存できませんでした。端末の空き容量を確認してください。', true);
    return;
  }
  const parts = [`${added} 件を追加しました`];
  if (updated) parts.push(`${updated} 件を更新しました`);
  if (skipped) parts.push(`${skipped} 件は内容が不完全なため読み込みませんでした`);
  showDataMessage(`${parts.join('。')}。`);
  render();
  updateBackupStatus();
}

/* ---------- 初期化 ---------- */
els.form.addEventListener('submit', handleSubmit);
els.cancelBtn.addEventListener('click', () => { resetForm(); render(); });
els.album.addEventListener('input', onAlbumChanged);
els.song.addEventListener('change', onSongChanged);
els.song.addEventListener('blur', onSongChanged);
els.tabs.forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
els.search.addEventListener('input', () => {
  if (state.view === 'songs') state.songKeyword = els.search.value;
  else state.keyword = els.search.value;
  render();
});
els.categoryFilter.addEventListener('change', () => { state.category = els.categoryFilter.value; render(); });
['play', 'pause', 'ended', 'timeupdate'].forEach((type) => els.player.addEventListener(type, syncPlayButtons));
els.player.addEventListener('error', () => onPreviewFailed(playingUrl));
els.exportBtn.addEventListener('click', exportEntries);
els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files && els.importFile.files[0];
  els.importFile.value = '';
  if (file) importEntries(file);
});

state.entries = loadEntries();
resetForm();
try {
  const saved = localStorage.getItem(VIEW_KEY);
  if (['timeline', 'group', 'songs'].includes(saved)) state.view = saved;
} catch (e) { /* 既定の表示のまま */ }
setView(state.view);
updateBackupStatus();
loadCatalog();

// ブラウザに日記を勝手に消されないよう、永続保存をお願いしておく
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => { /* 許可されなくても動作に影響なし */ });
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('オフライン対応を有効にできませんでした', e));
  });
}
