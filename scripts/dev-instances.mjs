import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const secret = randomBytes(32).toString('hex');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  const deadline = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 12_000);
  deadline.unref();
}
for (let index = 0; index < 3; index++) {
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: new URL('../apps/api/', import.meta.url), stdio: 'inherit',
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(3001 + index),
      INSTANCE_ID: `api-${index + 1}`, INSTANCE_SECRET: secret,
      INSTANCE_PEERS: index === 0 ? 'http://127.0.0.1:3002,http://127.0.0.1:3003' : '' },
  });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', (code) => { if (!stopping) stop(code || 1); });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
console.info('Three APIs: coordinator on 3001; targets on 3001, 3002, 3003. Start the web app separately.');
