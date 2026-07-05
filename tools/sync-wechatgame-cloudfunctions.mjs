import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const source = resolve(root, 'cloudfunctions');
const targets = [
  resolve(root, 'build/wechatgame/cloudfunctions'),
  resolve(root, 'build/wechatgame-staged/cloudfunctions'),
];

if (!existsSync(source)) {
  console.log('No cloudfunctions directory to sync.');
  process.exit(0);
}

for (const target of targets) {
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
  console.log(`Synced cloudfunctions -> ${target}`);
}
