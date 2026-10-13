import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { YamahaParser } from './src/core/parser/yamaha-parser.ts';
import { YamahaWriter } from './src/core/writer/yamaha-writer.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exportDir = path.resolve(__dirname, 'usb_test_export');

if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir, { recursive: true });
}

const filesToExport = [
  { name: '4006_SX900.T547.sty', outName: 'TEST_4006_SX900.sty', format: 'STY' as const },
  { name: '4006-1_PAD.PAD', outName: 'TEST_4006_1.PAD', format: 'PAD' as const },
  { name: '4006-2_PAD.PAD', outName: 'TEST_4006_2.PAD', format: 'PAD' as const },
];

console.log('--- 正在導出實琴測試檔案 ---');
for (const file of filesToExport) {
  const inPath = path.resolve(__dirname, 'samples', file.name);
  const outPath = path.resolve(exportDir, file.outName);

  const rawBytes = new Uint8Array(fs.readFileSync(inPath));
  const parsed = YamahaParser.parse(rawBytes, file.format);
  const reBytes = YamahaWriter.write(parsed);

  fs.writeFileSync(outPath, reBytes);
  console.log(`✓ 已生成測試檔: usb_test_export/${file.outName} (大小: ${reBytes.length} Bytes)`);
}
console.log('--- 導出完成！可將 usb_test_export 內的檔案拷貝至 USB 隨身碟 ---');
