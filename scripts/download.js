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
  // 第11回NDBオープンデータ（公費含む）：特定保険医療材料、医科診療行為（算定回数）
  ['ndb/ndb11.zip', 'https://www.mhlw.go.jp/content/12400000/001711937.zip'],
  ['ndb/ndb11_k.zip', 'https://www.mhlw.go.jp/content/12400000/001742574.zip'],
];

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  for (const [name, url] of FILES) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const file = path.join(RAW, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    // zip は Windows では PowerShell、それ以外では unzip で展開。NDB の zip は同名フォルダに展開する
    if (name.endsWith('.zip')) {
      const dir = name.startsWith('ndb/') ? file.replace(/\.zip$/, '') : RAW;
      fs.mkdirSync(dir, { recursive: true });
      if (process.platform === 'win32') {
        execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${file}' -DestinationPath '${dir}' -Force`]);
      } else execFileSync('unzip', ['-o', '-q', file, '-d', dir]);
      fs.unlinkSync(file);
    }
    console.log('OK', name);
  }
})();
