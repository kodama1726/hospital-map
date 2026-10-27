// カテーテル治療実績のクラスター分析（k-means）
// 対象：いずれかの治療が10件以上の病院。特徴量：8指標の log(1+件数) を標準化。
// 秘匿値（0〜9件）は中央値 4.5 で補完。k はシルエット係数で選び、結果を hospitals.json / meta.json に書き込む。
//   node scripts/cluster.js          … 分析して書き込み
//   node scripts/cluster.js --explore … k=2〜9 の比較のみ
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'docs', 'data');
const H = JSON.parse(fs.readFileSync(path.join(DATA, 'hospitals.json'), 'utf8'));
const META = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
const EXPLORE = process.argv.includes('--explore');
const K = 7;
const MASKED = 4.5;

const FEATURES = [
  { key: 'pci_ami', label: 'PCI（AMI）', from: ['pci_ami'] },
  { key: 'pci_ap', label: 'PCI（狭心症）', from: ['pci_ap'] },
  { key: 'abl', label: 'アブレーション', from: ['abl'] },
  { key: 'pm', label: 'ペースメーカー等', from: ['pm'] },
  { key: 'shd', label: '経カテーテル弁治療', from: ['shd'] },
  { key: 'laao', label: '左心耳閉鎖', from: ['laao'] },
  { key: 'sg', label: 'ステントグラフト', from: ['sg_ad', 'sg_rupt', 'sg_aneu'] },
  { key: 'evt', label: '末梢血管内治療', from: ['evt'] },
];
const raw = (c, f) => f.from.reduce((s, k) => s + (c[k] > 0 ? c[k] : c[k] === -1 ? MASKED : 0), 0);

const targets = H.filter(h => h.dpc?.c && META.cath.some(x => h.dpc.c[x.key] > 0));
const X0 = targets.map(h => FEATURES.map(f => Math.log1p(raw(h.dpc.c, f))));
const mean = FEATURES.map((_, j) => X0.reduce((s, r) => s + r[j], 0) / X0.length);
const sd = FEATURES.map((_, j) => Math.sqrt(X0.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / X0.length));
const X = X0.map(r => r.map((v, j) => (v - mean[j]) / sd[j]));

// 再現性のため固定シードの乱数
let seed = 20261027;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const d2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

function kmeans(k) {
  // k-means++ 初期化
  const C = [X[Math.floor(rand() * X.length)]];
  while (C.length < k) {
    const w = X.map(x => Math.min(...C.map(c => d2(x, c))));
    let r = rand() * w.reduce((a, b) => a + b, 0), i = 0;
    while ((r -= w[i]) > 0) i++;
    C.push(X[i]);
  }
  let lab = [];
  for (let it = 0; it < 200; it++) {
    const next = X.map(x => C.reduce((b, c, j) => (d2(x, c) < d2(x, C[b]) ? j : b), 0));
    if (next.every((v, i) => v === lab[i])) break;
    lab = next;
    for (let j = 0; j < k; j++) {
      const m = X.filter((_, i) => lab[i] === j);
      if (m.length) C[j] = m[0].map((_, d) => m.reduce((s, x) => s + x[d], 0) / m.length);
    }
  }
  const sse = X.reduce((s, x, i) => s + d2(x, C[lab[i]]), 0);
  return { lab, C, sse };
}
const best = k => { let b; for (let r = 0; r < 30; r++) { const m = kmeans(k); if (!b || m.sse < b.sse) b = m; } return b; };

function silhouette(lab, k) {
  const D = X.map(a => X.map(b => Math.sqrt(d2(a, b))));
  let s = 0;
  for (let i = 0; i < X.length; i++) {
    const avg = j => { let t = 0, n = 0; for (let q = 0; q < X.length; q++) if (lab[q] === j && q !== i) { t += D[i][q]; n++; } return n ? t / n : 0; };
    const a = avg(lab[i]);
    const b = Math.min(...[...Array(k).keys()].filter(j => j !== lab[i]).map(avg));
    s += (b - a) / Math.max(a, b);
  }
  return s / X.length;
}

// クラスターの特徴（元の件数スケールの中央値と、実施率）
function profile(lab, k) {
  return [...Array(k).keys()].map(j => {
    const idx = lab.map((l, i) => (l === j ? i : -1)).filter(i => i >= 0);
    const med = FEATURES.map(f => {
      const v = idx.map(i => raw(targets[i].dpc.c, f)).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    });
    const rate = FEATURES.map(f => idx.filter(i => f.from.some(k2 => targets[i].dpc.c[k2] > 0)).length / idx.length);
    return { j, n: idx.length, med, rate };
  });
}
const show = ps => ps.forEach(p => console.log(`#${p.j} n=${p.n}\t` + FEATURES.map((f, d) => `${f.label}:${p.med[d]}(${Math.round(p.rate[d] * 100)}%)`).join(' ')));

if (EXPLORE) {
  for (let k = 2; k <= 9; k++) {
    const m = best(k);
    console.log(`k=${k} SSE=${m.sse.toFixed(0)} silhouette=${silhouette(m.lab, k).toFixed(3)}`);
  }
  for (const k of [4, 5, 6, 7]) { console.log(`--- k=${k}`); show(profile(best(k).lab, k)); }
  process.exit();
}

// ---------- 本処理 ----------
const model = best(K);
const sil = silhouette(model.lab, K);
const prof = profile(model.lab, K);
show(prof);

// クラスターの命名：各治療の実施率（10件以上の施設割合）から特徴を判定する。
// 並び順は地図の色（濃い＝対応範囲が広い）に対応
const R = (p, key) => p.rate[FEATURES.findIndex(f => f.key === key)];
const NAMES = [
  { key: 'c_all', label: '全領域・高実績（左心耳閉鎖まで）', test: p => R(p, 'laao') >= 0.5 },
  { key: 'c_shd', label: 'SHD・大動脈まで対応', test: p => R(p, 'shd') >= 0.5 },
  { key: 'c_pci_ep_ao', label: 'PCI＋アブレーション＋大動脈', test: p => R(p, 'abl') >= 0.5 && R(p, 'sg') >= 0.5 },
  { key: 'c_pci_ep', label: 'PCI＋アブレーション', test: p => R(p, 'abl') >= 0.5 },
  { key: 'c_pci', label: 'PCI中心（急性心筋梗塞を含む）', test: p => R(p, 'pci_ami') >= 0.8 },
  { key: 'c_elective', label: '待機的PCI・末梢血管中心', test: p => R(p, 'pci_ami') < 0.6 && R(p, 'evt') >= 0.8 },
  { key: 'c_small', label: '小規模（実績が少ない）', test: () => true },
];
const named = new Map();
for (const p of prof) {
  const nm = NAMES.find(n => n.test(p) && !named.has(n.key)) || { key: 'c_' + p.j, label: 'クラスター' + (p.j + 1) };
  named.set(nm.key, { ...nm, p });
}
const clusters = NAMES.filter(n => named.has(n.key)).map(n => named.get(n.key))
  .concat([...named.values()].filter(v => !NAMES.some(n => n.key === v.key)))
  .map(({ key, label, p }) => ({
    key, label, n: p.n, j: p.j,
    profile: FEATURES.map((f, d) => ({ label: f.label, median: p.med[d], rate: Math.round(p.rate[d] * 100) })),
  }));
const keyOfJ = Object.fromEntries(clusters.map(c => [c.j, c.key]));

// 類似病院：標準化した特徴量のユークリッド距離が近い5施設
targets.forEach((h, i) => {
  h.cl = keyOfJ[model.lab[i]];
  h.nn = X.map((x, q) => [q, d2(X[i], x)]).filter(([q]) => q !== i)
    .sort((a, b) => a[1] - b[1]).slice(0, 5).map(([q]) => targets[q].id);
});
for (const h of H) if (!targets.includes(h)) { delete h.cl; delete h.nn; }

META.clusters = clusters.map(({ j, ...c }) => c);
META.clusterInfo = {
  method: 'k-means（k-means++初期化・30回試行の最良解）',
  k: K, silhouette: +sil.toFixed(3), n: targets.length,
  features: FEATURES.map(f => f.label),
  note: '各治療の退院患者数を log(1+件数) に変換して標準化。公表値が秘匿（0〜9件）の場合は4.5で補完。',
};
fs.writeFileSync(path.join(DATA, 'hospitals.json'), JSON.stringify(H));
fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(META, null, 1));

// 確認用 CSV に列を追加
const CSV = path.join(__dirname, '..', 'hospitals_merged.csv');
const lines = fs.readFileSync(CSV, 'utf8').replace(/^﻿/, '').split('\n');
const byId = new Map(H.map(h => [h.id, h]));
const label = Object.fromEntries(clusters.map(c => [c.key, c.label]));
const head = lines[0].split(',');
const ci = head.indexOf('クラスター');
const out = lines.map((l, i) => {
  const cells = ci >= 0 ? l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter((_, c) => c !== ci).join(',') : l;
  if (i === 0) return cells + ',クラスター';
  const id = l.split(',')[0];
  return cells + ',' + (label[byId.get(id)?.cl] || '');
});
fs.writeFileSync(CSV, '﻿' + out.join('\n'));

console.log(`k=${K} silhouette=${sil.toFixed(3)} 対象 ${targets.length}施設`);
clusters.forEach(c => console.log(c.label, c.n));
