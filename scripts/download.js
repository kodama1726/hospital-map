// 元データ（厚生労働省のオープンデータ）を raw/ にダウンロードする
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAW = path.join(__dirname, '..', 'raw');
const FILES = [
  ['01-1_hospital_facility_info_20260601.csv.zip', 'https://www.mhlw.go.jp/content/11121000/01-1_hospital_facility_info_20260601.csv.zip'],
  ['01-2_hospital_speciality_hours_20260601.csv.zip', 'https://www.mhlw.go.jp/content/11121000/01-2_hospital_speciality_hours_20260601.csv.zip'],
  ['gaiyo.xlsx', 'https://www.mhlw.go.jp/content/12404000/001717940.xlsx'],
  ['mdc05.xlsx', 'https://www.mhlw.go.jp/content/12404000/001718116.xlsx'],
  ['dpc_tensuhyo_R6.xlsx', 'https://www.mhlw.go.jp/content/12400000/001452318.xlsx'],
];

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  for (const [name, url] of FILES) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const file = path.join(RAW, name);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    // zip は tar（Windows 10 以降・macOS・Linux に標準搭載）で展開
    if (name.endsWith('.zip')) { execFileSync('tar', ['-xf', name], { cwd: RAW }); fs.unlinkSync(file); }
    console.log('OK', name);
  }
})();
