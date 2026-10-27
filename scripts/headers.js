// 疾患別手術別集計の列ヘッダー（DPC6桁・名称・件数/在院日数・手術コード）を展開して出力する
const XLSX = require('xlsx');
const wb = XLSX.readFile(process.argv[2]);
const ws = wb.Sheets[wb.SheetNames[0]];
const d = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
let code = '', name = '', kind = '';
for (let c = 3; c < d[3].length; c++) {
  if (d[0][c]) code = d[0][c];
  if (d[1][c]) name = d[1][c];
  if (d[2][c]) kind = d[2][c];
  if (kind === '件数') console.log(c, code, name, d[3][c]);
}
