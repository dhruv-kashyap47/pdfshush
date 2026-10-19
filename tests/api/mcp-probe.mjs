import { spawn } from 'node:child_process';
import path from 'node:path';

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const BIN = path.resolve(HERE, '..', '..', 'apps', 'mcp', 'dist', 'bin.js');
const child = spawn(process.execPath, [BIN], {
  env: { ...process.env, PDFSHUSH_API_URL: 'http://127.0.0.1:8080', PDFSHUSH_API_KEY: 'pshk_deliberately-invalid' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 1) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pdfshush_inspect', arguments: { files: [{ name: 'a.pdf', data: Buffer.from('%PDF-1.4 x').toString('base64') }] } } }) + '\n');
    } else if (msg.id === 2) {
      const text = msg.result.content[0].text;
      console.log('isError:', msg.result.isError);
      console.log('envelope:', text);
      child.kill();
      process.exit(0);
    }
  }
});
child.stderr.pipe(process.stderr);
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } }) + '\n');
