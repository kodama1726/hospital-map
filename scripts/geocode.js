// 医療情報ネットで座標が欠損（0.0）の病院を、国土地理院アドレスマッチングAPIで補完する
// 結果は raw/geocode_cache.json に保存し、build.js が参照する
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'raw');
const CACHE = path.join(RAW, 'geocode_cache.json');
const { readCsv } = require('./csv');

const rows = readCsv(path.join(RAW, '01-1_hospital_facility_info_20260601.csv'));
const targets = rows.filter(r => !(Number(r['所在地座標（緯度）']) > 20))
  .map(r => ({ id: r['ID'], name: r['正式名称'], addr: r['所在地'] }));
// キャッシュは対象施設の分だけ残す
const old = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const cache = Object.fromEntries(targets.filter(t => old[t.id] && !old[t.id].q.includes('"')).map(t => [t.id, old[t.id]]));

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let done = 0;
  for (const t of targets) {
    if (cache[t.id]) continue;
    // 番地以降の建物名などは除く
    const q = t.addr.normalize('NFKC').replace(/\s.*$/, '');
    const res = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
    const js = await res.json();
    if (js[0]) {
      const [lng, lat] = js[0].geometry.coordinates;
      cache[t.id] = { lat, lng, q, hit: js[0].properties.title };
    } else cache[t.id] = { lat: null, lng: null, q };
    if (++done % 20 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1)); console.log(done); }
    await sleep(300);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
  const ok = targets.filter(t => cache[t.id]?.lat).length;
  console.log(`対象 ${targets.length} / 補完 ${ok}`);
})();
