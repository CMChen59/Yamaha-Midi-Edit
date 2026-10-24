const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'public', 'samples', 'fixed_伤心酒店 Style.sty');
const outputPath = path.join(__dirname, '..', 'src', 'core', 'data', 'yamaha-style-template-base64.ts');

const buf = fs.readFileSync(inputPath);
const b64 = buf.toString('base64');

const tsContent = `// Base64-encoded Golden Style Template
export const GOLDEN_STYLE_TEMPLATE_BASE64 = '${b64}';
`;

fs.writeFileSync(outputPath, tsContent);
console.log('Successfully generated:', outputPath);
