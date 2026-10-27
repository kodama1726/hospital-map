// xlsxのシート構成と先頭行を確認する
const XLSX = require('xlsx');
const [file, rows = 12] = process.argv.slice(2);
const wb = XLSX.readFile(file);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  console.log(`=== ${name} (${ws['!ref']})`);
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  data.slice(0, +rows).forEach((r, i) => console.log(i, JSON.stringify(r.slice(0, 16))));
}
