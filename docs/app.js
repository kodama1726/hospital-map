// 病院マップ：医療情報ネット × DPC退院患者調査 を地図上で閲覧する
const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
const TYPE_HEX = { 'DPC参加病院': '#c0392b', 'DPC準備病院': '#d68910', '出来高算定病院': '#2e86c1', none: '#8a8f98' };
const GROUPS = { pci: '冠動脈インターベンション', ep: '不整脈デバイス・アブレーション', shd: '構造的心疾患（SHD）', vasc: '大動脈・末梢血管' };
// 治療グループの色：地図上は全組み合わせで見分ける必要があるため、検証済みの3色を主要3グループに、
// 少数の2グループは灰色（グループ名はツールチップと詳細で表示）にする
const GROUP_HEX = { shd: '#2a78d6', pci_ep: '#eb6834', pci: '#1baf7a', ep: '#6b7079', vasc: '#6b7079', none: '#c4c7cc', nodpc: '#c4c7cc' };
// クラスターの色：対応範囲の広さの順に青の濃淡（濃いほど広い）、構成の異なる「待機的PCI・末梢血管中心」だけ別色
const CLUSTER_HEX = { c_all: '#0d366b', c_shd: '#184f95', c_pci_ep_ao: '#256abf', c_pci_ep: '#3987e5', c_pci: '#6da7ec', c_small: '#9ec5f4', c_elective: '#eb6834', na: '#c4c7cc' };

// 色分け・絞り込みの単位（分類）。各分類のカテゴリをチェックで表示切替する
const MODES = {
  group: {
    title: 'カテーテル治療グループ（ルール）',
    note: '実施（10件以上）している治療の組み合わせで、上から順に判定。項目にカーソルを合わせると条件を表示します。',
    cats: () => [...META.groups, { key: 'nodpc', label: 'DPCデータなし' }],
    key: h => h.gr || 'nodpc', color: k => GROUP_HEX[k],
  },
  cluster: {
    title: 'クラスター（実績の類似度）',
    note: () => `${META.clusterInfo.n}施設の8治療の実績（件数を対数変換・標準化）を${META.clusterInfo.method}で${META.clusterInfo.k}群に分類。
      シルエット係数 ${META.clusterInfo.silhouette}（群の境界はなだらかで、規模の連続的な違いが主）。項目にカーソルを合わせると各群の中央値を表示します。`,
    cats: () => [...META.clusters.map(c => ({ ...c, desc: c.profile.map(p => `${p.label} ${p.median}件`).join('、') + '（中央値）' })),
      { key: 'na', label: '対象外（いずれも10件未満・DPCなし）' }],
    key: h => h.cl || 'na', color: k => CLUSTER_HEX[k],
  },
  type: {
    title: 'DPC区分',
    note: '',
    cats: () => [{ key: 'DPC参加病院', label: 'DPC参加病院' }, { key: 'DPC準備病院', label: 'DPC準備病院' },
      { key: '出来高算定病院', label: 'DPCデータ提出（出来高）' }, { key: 'none', label: 'DPCデータなし' }],
    key: h => h.dpc?.t || 'none', color: k => TYPE_HEX[k],
  },
};
const mode = () => MODES[$('color').value];

let H = [], META = null, map, layer, legendDiv, markers = new Map(), selected = null;
const catOn = {}; // 分類ごとの表示中カテゴリ
const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('ja-JP');

// 秘匿値（-1）は 0 として合算し、合算値が下限値であることを masked で示す
function metric(h, keys) {
  const c = h.dpc?.c; if (!c) return { v: 0, masked: false };
  let v = 0, masked = false;
  for (const k of keys) { const x = c[k]; if (x > 0) v += x; else if (x === -1) masked = true; }
  return { v, masked };
}
let SIZE_DEFS;
function buildSizeDefs() {
  const byGroup = g => META.cath.filter(x => x.group === g).map(x => x.key);
  SIZE_DEFS = [
    { id: 'cath', label: 'カテーテル治療 合計', keys: META.cath.map(x => x.key) },
    { id: 'pci', label: 'PCI（AMI＋狭心症）', keys: byGroup('pci') },
    { id: 'abl', label: 'カテーテルアブレーション', keys: ['abl'] },
    { id: 'shd', label: '経カテーテル弁治療', keys: ['shd'] },
    { id: 'sg', label: 'ステントグラフト', keys: ['sg_ad', 'sg_rupt', 'sg_aneu'] },
    { id: 'evt', label: '末梢血管内治療', keys: ['evt'] },
    { id: 'beds', label: '合計病床数', keys: null },
  ];
}
const sizeValue = (h, def) => def.keys ? metric(h, def.keys).v : (h.b[5] || 0);

async function init() {
  [H, META] = await Promise.all([fetch('data/hospitals.json').then(r => r.json()), fetch('data/meta.json').then(r => r.json())]);
  buildSizeDefs();
  for (const h of H) h.cathAny = META.cath.some(x => h.dpc?.c?.[x.key] > 0);

  PREFS.forEach((p, i) => $('pref').add(new Option(p, i + 1)));
  SIZE_DEFS.forEach(d => $('size').add(new Option(d.label, d.id)));
  $('src').innerHTML = `出典：厚生労働省「医療情報ネット オープンデータ」（${META.naviDate}時点）、
    厚生労働省「DPC退院患者調査」${META.dpcPeriod}（疾患別手術別集計 MDC05・施設概要表）を加工。
    地図：<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>`;

  map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([36.5, 137.5], 6);
  L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>', maxZoom: 18,
  }).addTo(map);
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => (legendDiv = L.DomUtil.create('div', 'legend'));
  legend.addTo(map);
  layer = L.layerGroup().addTo(map);

  for (const [id, m] of Object.entries(MODES)) catOn[id] = new Set(m.cats().map(c => c.key));
  ['pref', 'filter', 'beds', 'size', 'color'].forEach(id => $(id).addEventListener('change', render));
  $('pref').addEventListener('change', () => {
    const p = +$('pref').value; if (!p) return map.setView([36.5, 137.5], 6);
    const pts = H.filter(h => h.p === p).map(h => [h.lat, h.lng]);
    if (pts.length) map.fitBounds(pts, { padding: [20, 20] });
  });
  map.on('moveend', renderRank);
  $('close').onclick = () => { $('detail').hidden = true; selected = null; history.replaceState(null, '', location.pathname); render(); };
  setupSearch();
  // ?c=group|cluster|type で色分けを指定
  const c0 = new URLSearchParams(location.search).get('c');
  if (MODES[c0]) $('color').value = c0;
  render();
  // ?h=<医療情報ネットID> で病院を指定して開く
  const initial = H.find(h => h.id === new URLSearchParams(location.search).get('h'));
  if (initial) select(initial, true);
}

// グループのチェックを除いた絞り込み（グループ別件数の表示に使う）
function baseVisible() {
  const p = +$('pref').value, f = $('filter').value, b = +$('beds').value;
  return H.filter(h => (!p || h.p === p)
    && (f === 'all' || (f === 'dpc' && /DPC/.test(h.dpc?.t || '')) || (f === 'cath' && h.cathAny))
    && (h.b[5] || 0) >= b);
}
const visible = () => { const m = mode(), on = catOn[$('color').value]; return baseVisible().filter(h => on.has(m.key(h))); };
const colorOf = h => { const m = mode(); return m.color(m.key(h)); };
const groupLabel = h => META.groups.find(g => g.key === h.gr)?.label || 'DPCデータなし';
const clusterOf = h => META.clusters.find(c => c.key === h.cl);
const catLabel = h => { const m = mode(); return m.cats().find(c => c.key === m.key(h))?.label || ''; };

function renderGroups() {
  const m = mode(), on = catOn[$('color').value], base = baseVisible();
  const rows = m.cats().map(c => ({ c, n: base.filter(h => m.key(h) === c.key).length })).filter(x => x.n > 0 || !on.has(x.c.key));
  const note = typeof m.note === 'function' ? m.note() : m.note;
  $('groups').innerHTML = `<h2>${m.title}</h2>` + rows.map(({ c, n }) => `
    <label title="${c.desc || ''}"><input type="checkbox" data-k="${c.key}" ${on.has(c.key) ? 'checked' : ''}>
      <span class="sw" style="background:${m.color(c.key)}"></span><span>${c.label}</span><span class="v">${fmt(n)}</span></label>`).join('') +
    (note ? `<p class="note">${note}</p>` : '');
  $('groups').querySelectorAll('input').forEach(el => el.onchange = () => {
    el.checked ? on.add(el.dataset.k) : on.delete(el.dataset.k); render();
  });
}

function renderLegend() {
  const m = mode();
  legendDiv.innerHTML = m.cats().map(c => `<i style="background:${m.color(c.key)}"></i>${c.label}`).join('<br>');
}

function render() {
  const def = SIZE_DEFS.find(d => d.id === $('size').value);
  const list = visible();
  renderGroups(); renderLegend();
  const max = Math.max(1, ...list.map(h => sizeValue(h, def)));
  layer.clearLayers(); markers.clear();
  // 小さい円を上に描くため値の大きい順に追加
  list.sort((a, b) => sizeValue(b, def) - sizeValue(a, def));
  for (const h of list) {
    const v = sizeValue(h, def);
    const r = 2.5 + 16 * Math.sqrt(v / max);
    const m = L.circleMarker([h.lat, h.lng], {
      radius: r, color: h === selected ? '#111' : '#fff', weight: h === selected ? 2.5 : 0.7,
      fillColor: colorOf(h), fillOpacity: 0.8,
    }).bindTooltip(`${h.n}<br>${catLabel(h)}<br>${def.label}: ${def.keys ? fmt(v) + '件' : fmt(v) + '床'}`, { direction: 'top' });
    m.on('click', () => select(h));
    m.addTo(layer); markers.set(h.id, m);
  }
  const cathN = list.filter(h => h.cathAny).length;
  const beds = list.reduce((s, h) => s + (h.b[5] || 0), 0);
  const pci = list.reduce((s, h) => s + metric(h, ['pci_ami', 'pci_ap']).v, 0);
  $('stats').innerHTML = [
    [fmt(list.length), '表示中の病院'], [fmt(beds), '合計病床数'],
    [fmt(cathN), 'カテ実績のある病院'], [fmt(pci), 'PCI退院患者数（下限）'],
  ].map(([b, s]) => `<div class="tile"><b>${b}</b><span>${s}</span></div>`).join('');
  renderRank();
}

function renderRank() {
  const def = SIZE_DEFS.find(d => d.id === $('size').value);
  const bounds = map.getBounds();
  const top = visible().filter(h => bounds.contains([h.lat, h.lng]))
    .map(h => ({ h, v: sizeValue(h, def) })).filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v).slice(0, 15);
  $('rank').innerHTML = `<h2>地図範囲内の上位：${def.label}</h2><ol>` +
    top.map(x => `<li data-id="${x.h.id}"><span>${x.h.n}</span><span class="v">${fmt(x.v)}</span></li>`).join('') + '</ol>';
  $('rank').querySelectorAll('li').forEach(li => li.onclick = () => select(H.find(h => h.id === li.dataset.id), true));
}

// 全国順位（10件以上＝秘匿されていない施設の中での順位）
function nationalRank(key, v) {
  if (!(v > 0)) return '';
  const vals = H.map(h => h.dpc?.c?.[key]).filter(x => x > 0);
  const rank = 1 + vals.filter(x => x > v).length;
  return `<span class="pct">全国 ${rank}位 / ${vals.length}施設</span>`;
}

function select(h, fly) {
  selected = h;
  history.replaceState(null, '', '?h=' + h.id);
  if (fly) map.setView([h.lat, h.lng], Math.max(map.getZoom(), 12));
  render();
  const d = h.dpc, c = d?.c;
  const typeCls = { 'DPC参加病院': 'dpc', 'DPC準備病院': 'prep', '出来高算定病院': 'deki' }[d?.t] || '';
  const bedLabels = ['一般', '療養', '精神', '結核', '感染症'];
  const bedMax = Math.max(1, ...h.b.slice(0, 5).map(x => x || 0));
  const bedsHtml = bedLabels.map((l, i) => h.b[i] ? `<span>${l}</span><span class="bar"><i style="width:${100 * h.b[i] / bedMax}%"></i></span><span class="n">${fmt(h.b[i])}</span>` : '').join('');

  let cathHtml = '<p class="note">この病院のDPCデータ（退院患者調査）は見つかりませんでした。</p>';
  if (c) {
    let rows = '', lastG = '';
    for (const x of META.cath) {
      if (x.group !== lastG) { rows += `<tr class="grp"><td colspan="3">${GROUPS[x.group]}</td></tr>`; lastG = x.group; }
      const v = c[x.key], los = c[x.key + '_los'];
      const cell = v > 0 ? `${fmt(v)}${nationalRank(x.key, v)}` : '<span class="masked">10未満</span>';
      rows += `<tr title="${x.note}"><td>${x.label}</td><td class="num">${cell}</td><td class="num">${los ?? '—'}</td></tr>`;
    }
    cathHtml = `<table class="cath"><thead><tr><th>治療</th><th style="text-align:right">退院患者数</th><th style="text-align:right">平均在院日数</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">循環器系（MDC05）退院患者数：${fmt(c.mdc05)}${c.mdc05_masked ? ' 以上' : ''}<br>
      数値は該当手術を受けた退院患者数（手術件数ではない）。公表データでは0〜9件が秘匿されるため「10未満」と表示。
      主病名の診断群で集計しており、他の病名で行われた治療は含まれません。行にカーソルを合わせると対象のKコードを表示します。</p>`;
  }
  $('detail-body').innerHTML = `
    <h2>${h.n}</h2>
    <p class="addr">${h.a}${h.g ? '（位置は住所から推定）' : ''}</p>
    <div class="badges">
      ${d ? `<span class="badge ${typeCls}">${d.t}</span>` : '<span class="badge">DPCデータなし</span>'}
      ${d?.nb ? `<span class="badge">${d.nb}</span>` : ''}
      ${d?.m != null && d.m < 12 ? `<span class="badge">データ提出 ${d.m}か月</span>` : ''}
    </div>
    ${h.gr ? `<div class="group-box"><b><span class="sw" style="background:${GROUP_HEX[h.gr]}"></span>${groupLabel(h)}</b>
      <p>${META.groups.find(g => g.key === h.gr).desc}</p></div>` : ''}
    ${h.cl ? `<div class="group-box"><b><span class="sw" style="background:${CLUSTER_HEX[h.cl]}"></span>クラスター：${clusterOf(h).label}</b>
      <p>実績のパターンが似た${fmt(clusterOf(h).n)}施設の群</p></div>` : ''}
    <section><h3>病床数（合計 ${h.b[5] != null ? fmt(h.b[5]) + '床' : '不明'}）</h3><div class="beds">${bedsHtml || '<span class="note">内訳の登録なし</span>'}</div>
      ${d?.db ? `<p class="note">DPC算定病床：${fmt(d.db)}床</p>` : ''}</section>
    <section><h3>カテーテル室の循環器治療実績（${META.dpcPeriod}）</h3>${cathHtml}</section>
    ${h.nn ? `<section><h3>実績が似ている病院</h3><ol class="similar">${h.nn.map(id => H.find(x => x.id === id)).map(s =>
      `<li data-id="${s.id}"><span>${s.n}<small>${PREFS[s.p - 1]}・${clusterOf(s)?.label || ''}</small></span><span class="v">${fmt(metric(s, META.cath.map(x => x.key)).v)}件</span></li>`).join('')}</ol>
      <p class="note">8治療の実績（対数変換・標準化）の距離が近い順。右はカテーテル治療の合計。</p></section>` : ''}
    <section><h3>診療科（${h.dp.length}）</h3><div class="depts">${h.dp.join('、') || '登録なし'}</div></section>
    <section>
      ${h.u ? `<a class="ext" href="${h.u}" target="_blank" rel="noopener">病院ホームページ ↗</a><br>` : ''}
      ${d?.iu ? `<a class="ext" href="${d.iu}" target="_blank" rel="noopener">病院指標（DPC病院情報の公表） ↗</a>` : ''}
    </section>`;
  $('detail').hidden = false;
  $('detail-body').querySelectorAll('.similar li').forEach(li => li.onclick = () => {
    const s = H.find(x => x.id === li.dataset.id);
    if (!visible().includes(s)) catOn[$('color').value].add(mode().key(s));
    select(s, true);
  });
}

function setupSearch() {
  const q = $('q'), box = $('suggest');
  q.addEventListener('input', () => {
    const s = q.value.trim().normalize('NFKC');
    if (s.length < 2) { box.hidden = true; return; }
    const hits = H.filter(h => h.n.normalize('NFKC').includes(s)).slice(0, 20);
    box.innerHTML = hits.map(h => `<div data-id="${h.id}">${h.n}<small>${h.a}</small></div>`).join('') || '<div>該当なし</div>';
    box.hidden = false;
    box.querySelectorAll('[data-id]').forEach(el => el.onclick = () => {
      box.hidden = true; q.value = '';
      const h = H.find(x => x.id === el.dataset.id);
      if (!visible().includes(h)) { $('filter').value = 'all'; $('beds').value = '0'; $('pref').value = ''; catOn[$('color').value].add(mode().key(h)); }
      select(h, true);
    });
  });
  document.addEventListener('click', e => { if (!box.contains(e.target) && e.target !== q) box.hidden = true; });
}

init();
