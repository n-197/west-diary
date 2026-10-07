'use strict';

// 配色・背景のカスタム。<head> で読み込み、ページを描く前に色を当てる（一瞬元の色が見えないように）。
// 設定は localStorage、背景の写真は IndexedDB に保存する。
const WestTheme = (() => {
  const THEME_KEY = 'west_diary_theme';
  const DB_NAME = 'west-diary';
  const STORE = 'files';
  const BG_KEY = 'background';

  // 標準の配色（style.css の :root と同じ値）
  const BASE = {
    light: { bg: '#f4f5f9', surface: '#ffffff', accent: '#e0434f' },
    dark: { bg: '#12141b', surface: '#1b1e28', accent: '#f0646e' },
  };

  const PRESETS = [
    { id: 'default', label: '標準', accent: null, bg: 'default' },
    { id: 'mono', label: 'モノクロ', accent: '#1d1d1f', accentDark: '#f2f2f2', bg: 'default' },
    { id: 'red', label: '赤', accent: '#e53945', bg: 'tint' },
    { id: 'orange', label: 'オレンジ', accent: '#f08a24', bg: 'tint' },
    { id: 'yellow', label: '黄', accent: '#f2c200', bg: 'tint' },
    { id: 'green', label: '緑', accent: '#2fa84f', bg: 'tint' },
    { id: 'blue', label: '青', accent: '#2f6fe4', bg: 'tint' },
    { id: 'purple', label: '紫', accent: '#8a4fd8', bg: 'tint' },
    { id: 'pink', label: 'ピンク', accent: '#ec5f9b', bg: 'tint' },
  ];

  const DEFAULTS = {
    preset: 'default',
    accent: null,          // null = 標準の色
    mode: 'auto',          // 'auto' | 'light' | 'dark'
    bg: 'default',         // 'default' | 'tint' | 'color' | 'gradient' | 'image'
    bgColor: '#fde7e9',
    bgGradient: ['#fde7e9', '#e3ebfc'],
    bgFade: 0.25,          // 写真の上に重ねる背景色の濃さ（0〜0.7）
  };

  /* ---------- 色の計算 ---------- */
  const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
  // a に b を t の割合で混ぜる
  const mix = (a, b, t) => { const x = toRgb(a); const y = toRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
  const luminance = (hex) => {
    const [r, g, b] = toRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  // 背景 against に対してコントラスト比 min 以上になるまで、白または黒に寄せる
  const ensureContrast = (color, against, min) => {
    const toward = luminance(against) > 0.4 ? '#000000' : '#ffffff';
    let c = color;
    for (let t = 0.1; contrast(c, against) < min && t <= 1; t += 0.1) c = mix(color, toward, t);
    return c;
  };
  const readableOn = (bg) => (contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111');

  /* ---------- 設定の読み書き ---------- */
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(THEME_KEY) || 'null');
      return sanitize(saved);
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  // 書き出しファイルなど外から来た値も、決まった形と範囲にそろえる
  function sanitize(raw) {
    const s = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return s;
    if (PRESETS.some((p) => p.id === raw.preset) || raw.preset === 'custom') s.preset = raw.preset;
    if (isHex(raw.accent)) s.accent = raw.accent.toLowerCase();
    if (['auto', 'light', 'dark'].includes(raw.mode)) s.mode = raw.mode;
    if (['default', 'tint', 'color', 'gradient', 'image'].includes(raw.bg)) s.bg = raw.bg;
    if (isHex(raw.bgColor)) s.bgColor = raw.bgColor.toLowerCase();
    if (Array.isArray(raw.bgGradient) && raw.bgGradient.length === 2 && raw.bgGradient.every(isHex)) {
      s.bgGradient = raw.bgGradient.map((c) => c.toLowerCase());
    }
    const fade = Number(raw.bgFade);
    if (Number.isFinite(fade)) s.bgFade = Math.min(0.7, Math.max(0, fade));
    return s;
  }

  let settings = load();
  let backgroundUrl = null;  // 背景の写真（IndexedDB から読んだ Blob の URL）

  function save() {
    try { localStorage.setItem(THEME_KEY, JSON.stringify(settings)); } catch (e) { /* 保存できなくても見た目は変わる */ }
  }

  /* ---------- 適用 ---------- */
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (settings.mode === 'auto' ? darkQuery.matches : settings.mode === 'dark');

  function accentFor(dark) {
    const preset = PRESETS.find((p) => p.id === settings.preset);
    if (preset && preset.id !== 'custom' && settings.accent === preset.accent) {
      if (dark && preset.accentDark) return preset.accentDark;
    }
    return settings.accent;
  }

  const ACCENT_VARS = ['--primary', '--primary-hover', '--primary-soft', '--on-primary', '--primary-text'];
  const BG_VARS = ['--page-bg', '--on-bg', '--on-bg-muted', '--bg-fade'];

  function apply() {
    const root = document.documentElement;
    const dark = isDark();
    const base = dark ? BASE.dark : BASE.light;

    if (settings.mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.mode);

    // テーマカラー（標準なら style.css の値のまま）
    const accent = accentFor(dark);
    if (accent) {
      // ダークでは暗すぎる色を、ライトでは明るすぎて背景に溶ける色を、見える明るさに寄せる
      const primary = ensureContrast(accent, base.surface, 1.8);
      root.style.setProperty('--primary', primary);
      root.style.setProperty('--primary-hover', dark ? mix(primary, '#ffffff', 0.15) : mix(primary, '#000000', 0.12));
      root.style.setProperty('--primary-soft', dark ? mix(primary, base.surface, 0.78) : mix(primary, '#ffffff', 0.86));
      root.style.setProperty('--on-primary', readableOn(primary));
      root.style.setProperty('--primary-text', ensureContrast(primary, base.surface, 4.5));
    } else {
      ACCENT_VARS.forEach((v) => root.style.removeProperty(v));
    }

    // 背景
    BG_VARS.forEach((v) => root.style.removeProperty(v));
    root.classList.remove('has-bg-image', 'has-custom-bg');
    let pageColor = base.bg;
    const tintFrom = accent || base.accent;
    if (settings.bg === 'tint') {
      pageColor = dark ? mix(tintFrom, base.bg, 0.86) : mix(tintFrom, base.bg, 0.88);
      root.style.setProperty('--page-bg', pageColor);
    } else if (settings.bg === 'color') {
      pageColor = settings.bgColor;
      root.style.setProperty('--page-bg', pageColor);
      root.classList.add('has-custom-bg');
    } else if (settings.bg === 'gradient') {
      const [a, b] = settings.bgGradient;
      pageColor = mix(a, b, 0.5);
      root.style.setProperty('--page-bg', `linear-gradient(160deg, ${a}, ${b})`);
      root.classList.add('has-custom-bg');
    } else if (settings.bg === 'image' && backgroundUrl) {
      root.style.setProperty('--bg-fade', String(settings.bgFade));
      root.classList.add('has-bg-image', 'has-custom-bg');
    }
    // ヘッダーの文字は背景に直接のるので、読みやすい色を選ぶ
    if (settings.bg === 'color' || settings.bg === 'gradient') {
      const on = readableOn(pageColor);
      root.style.setProperty('--on-bg', on);
      root.style.setProperty('--on-bg-muted', mix(on, pageColor, 0.3));
    }

    const layer = document.getElementById('bg-layer');
    if (layer) layer.style.backgroundImage = settings.bg === 'image' && backgroundUrl ? `url("${backgroundUrl}")` : '';

    // ステータスバーなどの色。端末任せの標準のときは、ライト / ダークそれぞれの色に戻す
    const fixed = settings.mode !== 'auto' || settings.bg !== 'default';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      const ownColor = (m.getAttribute('media') || '').includes('dark') ? BASE.dark.bg : BASE.light.bg;
      m.setAttribute('content', fixed ? pageColor : ownColor);
    });
  }

  darkQuery.addEventListener('change', () => { if (settings.mode === 'auto') apply(); });

  /* ---------- 背景の写真（IndexedDB） ---------- */
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbRequest(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  function setBackgroundBlob(blob) {
    if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    backgroundUrl = blob ? URL.createObjectURL(blob) : null;
  }

  async function loadBackground() {
    try {
      const blob = await dbRequest('readonly', (s) => s.get(BG_KEY));
      setBackgroundBlob(blob instanceof Blob ? blob : null);
    } catch (e) {
      console.warn('背景の写真を読み込めませんでした', e);
      setBackgroundBlob(null);
    }
    apply();
    return !!backgroundUrl;
  }

  // 写真を長い辺 1600px までの JPEG に縮めて保存する
  async function resizeImage(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を変換できませんでした'))), 'image/jpeg', 0.82));
  }

  async function saveBackground(fileOrBlob) {
    const blob = await resizeImage(fileOrBlob);
    await dbRequest('readwrite', (s) => s.put(blob, BG_KEY));
    setBackgroundBlob(blob);
    update({ bg: 'image' });
  }

  async function clearBackground() {
    try { await dbRequest('readwrite', (s) => s.delete(BG_KEY)); } catch (e) { /* 消せなくても表示からは外す */ }
    setBackgroundBlob(null);
    if (settings.bg === 'image') update({ bg: 'default' });
    else apply();
  }

  /* ---------- 書き出し・読み込み ---------- */
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  async function exportSettings() {
    let background = null;
    try {
      const blob = await dbRequest('readonly', (s) => s.get(BG_KEY));
      if (blob instanceof Blob) background = await blobToDataUrl(blob);
    } catch (e) { /* 写真なしで書き出す */ }
    return { theme: { ...settings }, background };
  }

  // 書き出しファイルの settings を当てる。写真は data:image/... のみ受け付ける
  async function importSettings(raw) {
    if (!raw || typeof raw !== 'object') return false;
    settings = sanitize(raw.theme);
    if (typeof raw.background === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(raw.background)) {
      try {
        const blob = await (await fetch(raw.background)).blob();
        await saveBackground(blob);
      } catch (e) {
        console.warn('背景の写真を読み込めませんでした', e);
        if (settings.bg === 'image') settings.bg = 'default';
      }
    } else if (settings.bg === 'image' && !backgroundUrl) {
      settings.bg = 'default';
    }
    save();
    apply();
    return true;
  }

  /* ---------- 変更 ---------- */
  function update(partial) {
    settings = sanitize({ ...settings, ...partial });
    save();
    apply();
  }

  function applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    update({ preset: p.id, accent: p.accent, bg: p.bg });
  }

  function reset() {
    settings = { ...DEFAULTS };
    save();
    apply();
  }

  apply();

  return {
    PRESETS,
    get: () => ({ ...settings, bgGradient: [...settings.bgGradient] }),
    hasBackground: () => !!backgroundUrl,
    currentAccent: () => accentFor(isDark()) || (isDark() ? BASE.dark.accent : BASE.light.accent),
    update, applyPreset, reset, apply,
    loadBackground, saveBackground, clearBackground,
    exportSettings, importSettings,
  };
})();
