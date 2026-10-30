// NDBオープンデータ（第11回・令和6年度）から、カテーテル室で使う特定保険医療材料の月別数量を
// Kコード種別（手技の種類）ごとに整理し、対応する手技の月別算定回数と並べて docs/data/materials.json に出力する
//   node scripts/materials.js           … 出力
//   node scripts/materials.js --check   … 振り分け結果の一覧のみ表示
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const NDB = path.join(__dirname, '..', 'raw', 'ndb');
const OUT = path.join(__dirname, '..', 'docs', 'data', 'materials.json');
const find = (dir, re) => {
  for (const f of fs.readdirSync(dir, { recursive: true })) if (re.test(f)) return path.join(dir, f);
  throw new Error(`見つかりません: ${dir} ${re}`);
};
const MAT_FILE = find(path.join(NDB, 'ndb11'), /診療月別数量/);
const K_FILE = find(path.join(NDB, 'ndb11_k'), /K_手術[\\/]款別診療月別算定回数/);
const D_FILE = find(path.join(NDB, 'ndb11_k'), /D_検査[\\/]診療月別算定回数/);
const MONTHS = ['2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03'];

// Kコード種別。材料は名称で振り分け（上から順に判定）、手技は分類コード・診療行為名で集計する
const CATS = [
  { key: 'device', label: 'ペースメーカー・ICD等（K597〜K599）',
    mat: /^ペースメーカー（|^ペースメーカー・|植込式心臓ペースメーカー用リード|^植込型除細動器|両室ペーシング|リード除去|リードロッキング|リード抜去|リード一体型ペースメーカー抜去|ローテーションシース|ペースメーカ用カテーテル電極用シース/,
    proc: { code: /^K(597|597-2|598|598-2|599|599-2|599-3|599-4|599-5)$/ } },
  { key: 'abl', label: 'カテーテルアブレーション（K595）',
    mat: /心筋焼灼術用カテーテル|心腔内超音波|体外.*ペースメーカー用.*(検査機能付加|冠状静脈洞型|房室弁輪部型)/,
    proc: { code: /^K595$/ } },
  { key: 'shd', label: '構造的心疾患（TAVI・MitraClip・左心耳閉鎖等）',
    mat: /経カテーテル人工生体弁|僧帽弁クリップ|左心耳閉鎖|弁拡張用|心房中隔欠損|卵円孔開存|弁周囲欠損|動脈管閉鎖/,
    proc: { name: /経カテーテル弁置換術|経皮的大動脈弁拡張術|経皮的僧帽弁拡張術|経皮的僧帽弁クリップ術|経皮的肺動脈弁拡張術|左心耳閉鎖術）（経カテーテル|経皮的心房中隔欠損閉鎖術|経皮的卵円孔開存閉鎖術|経皮的動脈管開存閉鎖術|弁周囲逆流/ } },
  { key: 'aorta', label: '大動脈ステントグラフト（K561）',
    mat: /大動脈用ステントグラフト|ＰＴＡバルーンカテーテル（大動脈/,
    proc: { code: /^K561$/ } },
  { key: 'pci', label: 'PCI（K546〜K550-2）',
    mat: /冠動脈用ステント|ＰＴＣＡ用|特殊カテーテル（(切削|破砕)型）|冠動脈狭窄部貫通用|冠動脈灌流用|血管内光断層|血管内超音波プローブ|血管造影用圧センサー|冠動脈造影用センサー付ガイドワイヤー/,
    proc: { code: /^K(546|547|548|549|550|550-2)$/ },
    note: 'IVUS・OCT・圧ワイヤー（FFR）は主に冠動脈で使われるためPCIに含めたが、診断カテーテル検査や末梢血管治療での使用も含む。' },
  { key: 'evt', label: '末梢血管・シャント（K616系）',
    mat: /末梢血管用ステント|ＰＴＡバルーンカテーテル|下肢動脈狭窄部貫通用|^狭窄部貫通用カテーテル|血管形成用カテーテル（(エキシマ|切削吸引)|血栓除去用カテーテル（(バルーン付き|経皮的血栓除去用|残存)/,
    proc: { code: /^K(616|616-4|616-6|616-7)$/ },
    note: 'PTAバルーン等は透析シャントの拡張（K616-4）でも多く使われるため、手技件数にK616-4を含めている。' },
  { key: 'common', label: '共通（造影カテーテル・シース等）',
    mat: /血管造影用カテーテル|血管造影用マイクロカテーテル|血管造影用ガイドワイヤー|血管造影用シースイントロデューサーセット|心腔内及び大動脈デバイス用|穿刺部止血材料|体外ペースメーカー用電極（一時ペーシング型）|交換用カテーテル|血管内異物除去用カテーテル（(細血管用|大血管用)）/,
    proc: { dCode: /^D206$/ },
    note: '複数の手技と検査で共通に使う材料。比較用に心臓カテーテル法（D206：検査）の算定回数を表示。脳血管・腹部の血管造影でも使われる。' },
];
// カテーテル室の循環器治療以外（脳血管・塞栓術・在宅など）は除外
const EXCLUDE = /脳|頸動脈|塞栓用コイル|デタッチャブルコイル用|気管支|フローダイバーター|体温調節|静脈弁カッター|下大静脈|オクリュージョン|血管塞栓用プラグ|大動脈分岐部用フィルター|在宅|胸・腹水|胆|腎瘻/;

const num = v => (typeof v === 'number' ? v : null); // 「‐」（10未満の秘匿）は null

// 材料：行の形が [別表,定義,区分番号,区分名,コード,名称,総計,4月..] と [区分番号,区分名,コード,名称,総計,..] の2種類ある
function readMaterials(setting) {
  const wb = XLSX.readFile(MAT_FILE);
  const d = XLSX.utils.sheet_to_json(wb.Sheets[setting], { header: 1, defval: '' });
  const rows = [];
  let sec = '', secName = '';
  for (const r of d.slice(4)) {
    let o;
    if (/^\d{9}$/.test(String(r[4]))) { if (r[2] !== '') { sec = r[2]; secName = r[3]; } o = 4; }
    else if (/^\d{9}$/.test(String(r[2]))) { if (r[0] !== '') { sec = r[0]; secName = r[1]; } o = 2; }
    else continue;
    rows.push({ code: String(r[o]), name: String(r[o + 1]), sec: `${sec} ${secName}`, total: num(r[o + 2]), m: r.slice(o + 3, o + 15).map(num) });
  }
  return rows;
}
// 手技：K手術は [款,分類コード,分類名称,診療行為コード,診療行為,点数,総計,4月..]、
// D検査は先頭の「款」列がない。分類コードは最初の行のみ記載
function readProcs(file, setting) {
  const wb = XLSX.readFile(file);
  const d = XLSX.utils.sheet_to_json(wb.Sheets[setting], { header: 1, defval: '' });
  const o = /^款/.test(String(d[2][0])) ? 1 : 0;
  const rows = [];
  let code = '', cname = '';
  for (const r of d.slice(3)) {
    if (r[o] !== '') { code = String(r[o]); cname = String(r[o + 1]); }
    if (!/^\d{9}$/.test(String(r[o + 2]))) continue;
    rows.push({ code, cname, name: String(r[o + 3]), total: num(r[o + 5]), m: r.slice(o + 6, o + 18).map(num) });
  }
  return rows;
}

const SETTINGS = ['入院', '外来'];
const mats = Object.fromEntries(SETTINGS.map(s => [s, readMaterials(s)]));
const kRows = Object.fromEntries(SETTINGS.map(s => [s, readProcs(K_FILE, s)]));
const dRows = Object.fromEntries(SETTINGS.map(s => [s, readProcs(D_FILE, s)]));

const catOf = name => (EXCLUDE.test(name) ? null : CATS.find(c => c.mat.test(name))?.key || null);
const matchProc = (c, r, isD) => {
  const p = c.proc;
  if (isD) return p.dCode?.test(r.code);
  return (p.code && p.code.test(r.code)) || (p.name && p.name.test(r.name));
};

// 入院・外来を品目／診療行為ごとに結合し、月別値を {入院:[..], 外来:[..]} で持つ
function merge(list) {
  const map = new Map();
  for (const [s, rows] of list) for (const r of rows) {
    const k = r.code + '|' + r.name;
    if (!map.has(k)) map.set(k, { ...r, m: undefined, total: undefined, by: {} });
    map.get(k).by[s] = { total: r.total, m: r.m };
  }
  return [...map.values()];
}

const out = { source: '厚生労働省 第11回NDBオープンデータ（令和6年度レセプト：2024年4月〜2025年3月診療分、公費を含む）', months: MONTHS, settings: SETTINGS, cats: [] };
const allMat = merge(SETTINGS.map(s => [s, mats[s]]));
for (const c of CATS) {
  const materials = allMat.filter(r => catOf(r.name) === c.key)
    .map(r => ({ code: r.code, name: r.name, sec: r.sec, by: r.by }))
    .filter(r => SETTINGS.some(s => r.by[s]?.total));
  const procs = [
    ...merge(SETTINGS.map(s => [s, kRows[s].filter(r => matchProc(c, r, false))])),
    ...merge(SETTINGS.map(s => [s, dRows[s].filter(r => matchProc(c, r, true))])),
  ].map(r => ({ code: r.code, name: r.name, by: r.by })).filter(r => SETTINGS.some(s => r.by[s]?.total));
  out.cats.push({ key: c.key, label: c.label, note: c.note || '', procs, materials });
}

if (process.argv.includes('--check')) {
  const sum = r => SETTINGS.reduce((t, s) => t + (r.by[s]?.total || 0), 0);
  for (const c of out.cats) {
    console.log(`\n=== ${c.label}`);
    c.procs.forEach(p => console.log('  [手技]', p.code, p.name, Math.round(sum(p))));
    c.materials.forEach(m => console.log('  [材料]', m.name, Math.round(sum(m))));
  }
  // 振り分けなかった循環器らしい材料の確認
  const left = allMat.filter(r => !catOf(r.name) && !EXCLUDE.test(r.name) && /カテーテル|ステント|ガイドワイヤー|ペースメーカ|弁|血管/.test(r.name));
  console.log('\n=== 未分類（確認用）'); left.forEach(r => console.log('  ', r.sec, '|', r.name));
} else {
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('出力:', OUT, Math.round(fs.statSync(OUT).size / 1024), 'KB');
  out.cats.forEach(c => console.log(c.label, '手技', c.procs.length, '材料', c.materials.length));
}
