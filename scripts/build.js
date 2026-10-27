// 医療情報ネット（病院）× DPC退院患者調査（施設概要表・MDC05疾患別手術別集計）を結合し、
// サイト用 JSON と確認用 CSV を出力する
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const RAW = path.join(__dirname, '..', 'raw');
const OUT = path.join(__dirname, '..', 'docs', 'data');
const NAVI_FACILITY = '01-1_hospital_facility_info_20260601.csv';
const NAVI_SPECIALITY = '01-2_hospital_speciality_hours_20260601.csv';

// ---------- CSV ----------
const csv = require('./csv');
const readCsv = file => csv.readCsv(path.join(RAW, file));
const csvCell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

// ---------- 名称の正規化 ----------
const CORP = /(社会医療法人|特定医療法人|医療法人社団|医療法人財団|医療法人|社会福祉法人|一般財団法人|公益財団法人|一般社団法人|公益社団法人|地方独立行政法人|独立行政法人|国立研究開発法人|国立大学法人|公立大学法人|学校法人|宗教法人|社会福祉法人|恩賜財団|株式会社|有限会社|合同会社)/g;
function norm(s) {
  return String(s).normalize('NFKC').replace(/髙/g, '高').replace(/﨑/g, '崎').replace(/德/g, '徳').replace(/廣/g, '広').replace(/惠/g, '恵').replace(/[\s　・･\-－ー()（）「」"'’]/g, '').replace(/ヶ|ケ|ヵ/g, 'ケ').toLowerCase();
}
// 法人名などを除いた「病院名の芯」：空白区切りの最後のトークン、法人格を除去
function core(s) {
  const t = String(s).normalize('NFKC').trim().split(/[\s　]+/);
  let c = t[t.length - 1];
  // 法人格に続く「○○会」も法人名とみなして除く（例：医療法人社団井上会ひかりテラス病院）
  if (CORP.test(c)) c = c.replace(CORP, '').replace(/^\(?社団\)?|^\(?財団\)?/, '').replace(/^[^会]{1,8}会(?=.{3,})/, '');
  CORP.lastIndex = 0;
  return norm(c);
}
function bigrams(s) { const a = new Set(); for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2)); return a; }
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return a === b ? 1 : 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size);
}
function nameScore(dpcName, h) {
  const d = norm(dpcName), dc = core(dpcName);
  let best = 0;
  for (const n of [h.name, h.short].filter(Boolean)) {
    const nn = norm(n), nc = core(n);
    if (d === nn || dc === nc) return 1;
    if (nn.endsWith(dc) || d.endsWith(nc) || nn.includes(dc) || d.includes(nc)) best = Math.max(best, 0.9);
    best = Math.max(best, dice(dc, nc), dice(d, nn));
  }
  return best;
}

// ---------- 医療情報ネット ----------
const num = v => (v === '' || v == null ? null : Number(v));
// 座標が 0.0 の施設は geocode.js（国土地理院API）の結果で補完
const GEO_CACHE = path.join(RAW, 'geocode_cache.json');
const geo = fs.existsSync(GEO_CACHE) ? JSON.parse(fs.readFileSync(GEO_CACHE, 'utf8')) : {};
const navi = readCsv(NAVI_FACILITY).map(r => {
  const lat = num(r['所在地座標（緯度）']), lng = num(r['所在地座標（経度）']);
  const g = lat > 20 ? null : geo[r['ID']];
  return {
  geo: !!g?.lat,
  lat: g ? g.lat : lat > 20 ? lat : null,
  lng: g ? g.lng : lat > 20 ? lng : null,
  id: r['ID'],
  name: r['正式名称'],
  short: r['略称'],
  pref: r['都道府県コード'],
  city: r['都道府県コード'] + r['市区町村コード'],
  addr: r['所在地'],
  url: r['案内用ホームページアドレス'],
  beds: {
    general: num(r['一般病床']), ryoyo: num(r['療養病床']), psych: num(r['精神病床']),
    tb: num(r['結核病床']), infect: num(r['感染症病床']), total: num(r['合計病床数']),
  },
  };
});

const depts = new Map();
for (const r of readCsv(NAVI_SPECIALITY)) {
  if (!depts.has(r['ID'])) depts.set(r['ID'], new Set());
  depts.get(r['ID']).add(r['診療科目名']);
}

// ---------- DPC 施設概要表 ----------
const wbG = XLSX.readFile(path.join(RAW, 'gaiyo.xlsx'));
const gRows = XLSX.utils.sheet_to_json(wbG.Sheets['施設概要表'], { header: 1, defval: '' });
const dash = v => (v === '-' || v === '' ? null : v);
const dpc = gRows.slice(1).filter(r => /^\d{5}$/.test(String(r[0]))).map(r => ({
  kokuji: String(r[0]),
  city: String(r[2]).padStart(5, '0'),
  name: String(r[4]),
  type: String(r[5]).replace(/^(平成|令和)\S*?年度(新規)?/, ''), // DPC参加病院 / DPC準備病院 / 出来高算定病院
  dpcBeds: num(r[6]),
  nyuin: dash(r[7]),
  totalBeds: num(r[15]),
  months: num(r[16]),
  indexUrl: dash(r[17]),
}));

// ---------- DPC MDC05 疾患別手術別集計（カテーテル関連の手術分岐） ----------
// 手術分岐の意味は DPC電子点数表（令和6年度）「６）手術」の対応コードで確認済み
const CATH = [
  { key: 'pci_ami', label: 'PCI（急性心筋梗塞）', dpc: '050030', op: '03', group: 'pci',
    note: '経皮的冠動脈形成術・ステント留置術・血栓吸引術等（K546〜K550-2）' },
  { key: 'pci_ap', label: 'PCI（狭心症・慢性虚血性心疾患）', dpc: '050050', op: '02', group: 'pci',
    note: '経皮的冠動脈形成術・ステント留置術等（K546〜K549）' },
  { key: 'abl', label: 'カテーテルアブレーション', dpc: '050070', op: '03', group: 'ep',
    note: '経皮的カテーテル心筋焼灼術（K595）／頻脈性不整脈' },
  { key: 'laao', label: '経皮的左心耳閉鎖術', dpc: '050070', op: '02', group: 'ep',
    note: '左心耳閉鎖術 経カテーテル的手術（K594-4ハ）' },
  { key: 'pm', label: '徐脈性不整脈の手術（主にペースメーカー）', dpc: '050210', op: '97', group: 'ep',
    note: '050210の「手術あり（97）」。ペースメーカー移植・交換術が主だが他の手術を含む' },
  { key: 'shd', label: '経カテーテル弁治療（TAVI・MitraClip等）', dpc: '050080', op: '02', group: 'shd',
    note: '経カテーテル弁置換術・経皮的弁拡張術・経皮的僧帽弁クリップ術（K555-2, K556-2, K559-2, K559-3, K570-2）' },
  { key: 'sg_ad', label: 'ステントグラフト（大動脈解離）', dpc: '050161', op: '02', group: 'vasc',
    note: 'ステントグラフト内挿術（K561）' },
  { key: 'sg_rupt', label: 'ステントグラフト（破裂性大動脈瘤）', dpc: '050162', op: '03', group: 'vasc',
    note: 'ステントグラフト内挿術（K561）' },
  { key: 'sg_aneu', label: 'ステントグラフト（非破裂性大動脈瘤）', dpc: '050163', op: '03', group: 'vasc',
    note: 'ステントグラフト内挿術（K561）' },
  { key: 'evt', label: '末梢血管内治療（閉塞性動脈疾患）', dpc: '050170', op: '03', group: 'vasc',
    note: '四肢の血管拡張術・血栓除去術（K616）等' },
];
const wbM = XLSX.readFile(path.join(RAW, 'mdc05.xlsx'));
const m = XLSX.utils.sheet_to_json(wbM.Sheets[wbM.SheetNames[0]], { header: 1, defval: '' });
const colOf = {}; const losColOf = {};
{
  let code = '', kind = '';
  for (let c = 3; c < m[3].length; c++) {
    if (m[0][c]) code = String(m[0][c]);
    if (m[2][c]) kind = m[2][c];
    (kind === '件数' ? colOf : losColOf)[`${code}-${m[3][c]}`] = c;
  }
}
for (const x of CATH) {
  x.col = colOf[`${x.dpc}-${x.op}`];
  x.losCol = losColOf[`${x.dpc}-${x.op}`];
  if (x.col == null) throw new Error(`列が見つかりません: ${x.dpc}-${x.op}`);
}
// MDC05 全体（手術なし・あり全分岐）の件数合計も循環器入院の規模として算出
const mdc05Cols = Object.entries(colOf).filter(([k]) => !k.includes('再掲')).map(([, c]) => c);
const cath = new Map();
for (const r of m.slice(4)) {
  const k = String(r[0]);
  if (!/^\d{5}$/.test(k)) continue;
  const v = {};
  for (const x of CATH) {
    const n = r[x.col], los = r[x.losCol];
    // 「-」は0〜9件（0件を含む秘匿）。null と区別するため -1 で保持
    v[x.key] = typeof n === 'number' ? n : n === '-' ? -1 : null;
    if (typeof los === 'number') v[x.key + '_los'] = Math.round(los * 10) / 10;
  }
  let sum = 0, masked = false;
  for (const c of mdc05Cols) { if (typeof r[c] === 'number') sum += r[c]; else if (r[c] === '-') masked = true; }
  v.mdc05 = sum; v.mdc05_masked = masked;
  cath.set(k, v);
}

// ---------- 突合（DPC → 医療情報ネット） ----------
const byCity = new Map();
for (const h of navi) { if (!byCity.has(h.city)) byCity.set(h.city, []); byCity.get(h.city).push(h); }
const byPref = new Map();
for (const h of navi) { if (!byPref.has(h.pref)) byPref.set(h.pref, []); byPref.get(h.pref).push(h); }

const used = new Map(); // navi id -> {kokuji, score}
const matches = [];
for (const d of dpc) {
  let best = null;
  const consider = (h, bonus) => {
    const ns = nameScore(d.name, h);
    if (bonus < 0 && ns < 1) return; // 市区町村をまたぐ場合は名称の完全一致のみ
    let s = ns + bonus;
    if (d.totalBeds && h.beds.total) {
      const ratio = Math.min(d.totalBeds, h.beds.total) / Math.max(d.totalBeds, h.beds.total);
      s += ratio > 0.8 ? 0.05 : ratio < 0.4 ? -0.1 : 0;
    }
    if (!best || s > best.score) best = { h, score: s };
  };
  for (const h of byCity.get(d.city) || []) consider(h, 0);
  // 市区町村コードの不一致（合併・政令市の区など）に備え、同一都道府県内の完全一致も見る
  if (!best || best.score < 0.9) for (const h of byPref.get(d.city.slice(0, 2)) || []) if (h.city !== d.city) consider(h, -0.15);
  const ok = best && best.score >= 0.88;
  matches.push({ d, h: ok ? best.h : null, score: best ? best.score : 0, cand: best && best.h });
}
// 1つの医療情報ネット施設に複数のDPC施設が割り当たった場合はスコアの高い方を採用
matches.sort((a, b) => b.score - a.score);
for (const x of matches) {
  if (!x.h) continue;
  if (used.has(x.h.id)) { x.dup = used.get(x.h.id); x.h = null; continue; }
  used.set(x.h.id, x.d.kokuji);
}

// ---------- 出力 ----------
const dpcByNavi = new Map(matches.filter(x => x.h).map(x => [x.h.id, x]));
const hospitals = navi.filter(h => h.lat && h.lng).map(h => {
  const mt = dpcByNavi.get(h.id);
  const o = {
    id: h.id, n: h.name, a: h.addr, p: +h.pref, lat: +h.lat.toFixed(6), lng: +h.lng.toFixed(6), g: h.geo ? 1 : undefined, u: h.url || undefined,
    b: [h.beds.general, h.beds.ryoyo, h.beds.psych, h.beds.tb, h.beds.infect, h.beds.total],
    dp: [...(depts.get(h.id) || [])],
  };
  if (mt) {
    const d = mt.d;
    o.dpc = { k: d.kokuji, n: d.name, t: d.type, nb: d.nyuin, db: d.dpcBeds, m: d.months, iu: d.indexUrl || undefined, c: cath.get(d.kokuji) };
  }
  return o;
});
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'hospitals.json'), JSON.stringify(hospitals));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  built: new Date().toISOString().slice(0, 10),
  naviDate: '2026-06-01',
  dpcPeriod: '令和6年度（令和6年6月〜令和7年5月退院）',
  cath: CATH.map(({ key, label, dpc, op, group, note }) => ({ key, label, dpc, op, group, note })),
}, null, 1));

// 確認用：統合CSV と 突合結果CSV
const cols = ['医療情報ネットID', '正式名称', '都道府県コード', '所在地', '緯度', '経度', '一般病床', '療養病床', '精神病床', '結核病床', '感染症病床', '合計病床数',
  'DPC告示番号', 'DPC施設名', 'DPC区分', 'DPC算定病床数', '入院基本料', ...CATH.map(x => x.label + '_件数'), 'MDC05件数合計'];
const lines = [cols.join(',')];
for (const o of hospitals) {
  const c = o.dpc?.c || {};
  lines.push([o.id, o.n, o.p, o.a, o.lat, o.lng, ...o.b, o.dpc?.k, o.dpc?.n, o.dpc?.t, o.dpc?.db, o.dpc?.nb,
    ...CATH.map(x => (c[x.key] === -1 ? '0-9' : c[x.key])), c.mdc05].map(csvCell).join(','));
}
fs.writeFileSync(path.join(__dirname, '..', 'hospitals_merged.csv'), '﻿' + lines.join('\n'));
const mlines = ['告示番号,DPC施設名,DPC市町村番号,DPC区分,DPC病床総数,判定,スコア,医療情報ネットID,医療情報ネット名称,医療情報ネット合計病床'];
for (const x of matches.sort((a, b) => a.d.kokuji.localeCompare(b.d.kokuji))) {
  const h = x.h || x.cand;
  mlines.push([x.d.kokuji, x.d.name, x.d.city, x.d.type, x.d.totalBeds, x.h ? '一致' : x.dup ? '重複除外' : '未一致', x.score.toFixed(2),
    h?.id, h?.name, h?.beds.total].map(csvCell).join(','));
}
fs.writeFileSync(path.join(__dirname, '..', 'match_report.csv'), '﻿' + mlines.join('\n'));

// ---------- 集計 ----------
const byType = {};
for (const x of matches) {
  const t = x.d.type || '(不明)';
  byType[t] = byType[t] || { all: 0, ok: 0 };
  byType[t].all++; if (x.h) byType[t].ok++;
}
console.log('医療情報ネット病院:', navi.length, '/ 座標あり出力:', hospitals.length, '（うちAPI補完', hospitals.filter(o => o.g).length, '）');
console.log('DPC施設:', dpc.length, '/ 一致:', matches.filter(x => x.h).length);
console.log(byType);
const cathHosp = hospitals.filter(o => o.dpc?.c && CATH.some(x => o.dpc.c[x.key] > 0)).length;
console.log('カテーテル治療のいずれかが10件以上の病院:', cathHosp);
for (const x of CATH) console.log(' ', x.label, hospitals.filter(o => o.dpc?.c?.[x.key] > 0).length, '施設');
console.log('JSONサイズ(KB):', Math.round(fs.statSync(path.join(OUT, 'hospitals.json')).size / 1024));
