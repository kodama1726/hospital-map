// カテ室材料の月別推移：NDBオープンデータの特定保険医療材料と手技（K・D）の月別値を種別ごとに表示する
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('ja-JP');
const fmt1 = n => n.toLocaleString('ja-JP', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

let D, setting = 'all', sortKey = 'total', sortDir = -1, charts = {};

// 入院・外来の選択に応じた月別値（秘匿「‐」は null。合算時は 0 として扱い masked を立てる）
function series(item) {
  const keys = setting === 'all' ? D.settings : [setting];
  const m = Array(12).fill(0);
  let masked = false, any = false;
  for (const k of keys) {
    const b = item.by[k]; if (!b) continue;
    b.m.forEach((v, i) => { if (v == null) masked = true; else { m[i] += v; any = true; } });
  }
  return { m, masked, total: m.reduce((a, b) => a + b, 0), any };
}

async function init() {
  D = await fetch('data/materials.json').then(r => r.json());
  D.cats.forEach(c => $('cat').add(new Option(c.label, c.key)));
  const q = new URLSearchParams(location.search).get('k');
  if (D.cats.some(c => c.key === q)) $('cat').value = q;
  $('cat').onchange = () => { history.replaceState(null, '', '?k=' + $('cat').value); render(); };
  $('setting').querySelectorAll('button').forEach(b => b.onclick = () => {
    setting = b.dataset.v;
    $('setting').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    render();
  });
  $('src').textContent = `出典：${D.source}「特定保険医療材料（診療月別数量）」「K手術・D検査（診療月別算定回数）」を加工。` +
    '数量・回数が10未満の月は秘匿（‐）のため0として合算しており、合計は下限値。材料と手技の対応は材料名から当サイトで分類したもので、公式の対応関係ではありません。';
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  render();
}

function render() {
  const c = D.cats.find(x => x.key === $('cat').value);
  $('catnote').textContent = c.note;

  // 手技：分類コード（K546 等）単位にまとめる
  const byCode = new Map();
  for (const p of c.procs) {
    const s = series(p);
    if (!byCode.has(p.code)) byCode.set(p.code, { code: p.code, names: [], m: Array(12).fill(0), masked: false });
    const g = byCode.get(p.code);
    g.names.push(p.name); s.m.forEach((v, i) => g.m[i] += v); g.masked ||= s.masked;
  }
  const procGroups = [...byCode.values()].map(g => ({ ...g, total: g.m.reduce((a, b) => a + b, 0) })).filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total);
  const procTotal = procGroups.reduce((s, g) => s + g.total, 0);
  $('procsub').textContent = procGroups.map(g => g.code).join('・') + (c.key === 'common' ? '（検査）' : '');

  const mats = c.materials.map(m => ({ ...m, s: series(m) })).filter(m => m.s.total > 0).sort((a, b) => b.s.total - a.s.total);
  const matTotal = mats.reduce((s, m) => s + m.s.total, 0);

  $('tiles').innerHTML = [
    [fmt(procTotal), c.key === 'common' ? '心臓カテーテル検査の年間算定回数' : '手技の年間算定回数'],
    [fmt(matTotal), '材料の年間数量（全品目合計）'],
    [String(mats.length), '材料の品目数'],
    [procTotal ? fmt1(matTotal / procTotal) : '—', '手技1件あたりの材料数量（目安）'],
  ].map(([b, s]) => `<div class="tile"><b>${b}</b><span>${s}</span></div>`).join('');

  const months = D.months.map(m => +m.slice(5) + '月');
  const ink = css('--muted'), line = css('--line');
  const base = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { color: css('--ink'), boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
      tooltip: { callbacks: { label: x => `${x.dataset.label}：${fmt(x.parsed.y)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: ink }, border: { color: line } },
      y: { beginAtZero: true, grid: { color: line }, ticks: { color: ink, callback: v => v.toLocaleString('ja-JP') }, border: { display: false } },
    },
  };

  // 手技：分類コード別の積み上げ棒（8系列を超える分は「その他」）
  const pTop = procGroups.slice(0, 7), pRest = procGroups.slice(7);
  const pSets = pTop.map((g, i) => ({ label: g.code, data: g.m, names: g.names, color: css(SLOTS[i]) }));
  if (pRest.length) pSets.push({ label: 'その他', data: months.map((_, i) => pRest.reduce((s, g) => s + g.m[i], 0)), color: css('--s8') });
  charts.p?.destroy();
  charts.p = new Chart($('procChart'), {
    type: 'bar',
    data: { labels: months, datasets: pSets.map(s => ({ label: s.label, data: s.data, backgroundColor: s.color, borderColor: css('--panel'), borderWidth: { top: 2 }, borderRadius: 0, maxBarThickness: 28 })) },
    options: { ...base, scales: { ...base.scales, x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } } },
  });

  // 材料：上位6品目＋その他の折れ線
  const mTop = mats.slice(0, 6), mRest = mats.slice(6);
  const mSets = mTop.map((m, i) => ({ label: m.name, data: m.s.m, color: css(SLOTS[i]) }));
  if (mRest.length) mSets.push({ label: `その他（${mRest.length}品目）`, data: months.map((_, i) => mRest.reduce((s, m) => s + m.s.m[i], 0)), color: css('--s8') });
  charts.m?.destroy();
  charts.m = new Chart($('matChart'), {
    type: 'line',
    data: { labels: months, datasets: mSets.map(s => ({ label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0 })) },
    options: { ...base, plugins: { ...base.plugins, legend: { ...base.plugins.legend, labels: { ...base.plugins.legend.labels, generateLabels: ch => Chart.defaults.plugins.legend.labels.generateLabels(ch).map(l => ({ ...l, text: l.text.length > 26 ? l.text.slice(0, 25) + '…' : l.text })) } } } },
  });

  renderTable(mats, procTotal);
}

function spark(m) {
  const max = Math.max(1, ...m), w = 84, h = 22, bw = w / 12;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="月別推移">` +
    m.map((v, i) => { const bh = Math.max(1, (h - 2) * v / max); return `<rect x="${i * bw + 1}" y="${h - bh}" width="${bw - 2}" height="${bh}" rx="1"${v ? '' : ' class="na"'}><title>${i < 9 ? i + 4 : i - 8}月：${fmt(v)}</title></rect>`; }).join('') + '</svg>';
}

function renderTable(mats, procTotal) {
  const cols = [
    { k: 'sec', l: '区分', v: m => m.sec },
    { k: 'name', l: '品名', v: m => m.name },
    { k: 'total', l: '年間数量', v: m => m.s.total, num: true },
    { k: 'per', l: '手技1件あたり', v: m => procTotal ? m.s.total / procTotal : 0, num: true },
    { k: 'trend', l: '月別推移（4月→3月）', v: () => 0 },
  ];
  const col = cols.find(c => c.k === sortKey);
  const rows = [...mats].sort((a, b) => { const x = col.v(a), y = col.v(b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
  $('tbl').innerHTML = '<thead><tr>' + cols.map(c => `<th data-k="${c.k}"${c.num ? ' style="text-align:right"' : ''}>${c.l}${c.k === sortKey ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('') + '</tr></thead><tbody>' +
    rows.map(m => `<tr><td class="sec">${m.sec.replace(/^\d+\s*/, '')}</td><td>${m.name}${m.s.masked ? ' <span class="note" title="10未満で秘匿された月を含む">*</span>' : ''}</td>
      <td class="num">${fmt(m.s.total)}</td><td class="num">${procTotal ? fmt1(m.s.total / procTotal) : '—'}</td><td>${spark(m.s.m)}</td></tr>`).join('') + '</tbody>';
  $('tbl').querySelectorAll('th').forEach(th => th.onclick = () => {
    if (th.dataset.k === 'trend') return;
    sortDir = sortKey === th.dataset.k ? -sortDir : (th.dataset.k === 'name' || th.dataset.k === 'sec' ? 1 : -1);
    sortKey = th.dataset.k; render();
  });
}

init();
