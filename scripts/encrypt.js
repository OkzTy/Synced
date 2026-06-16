// Standalone encrypt script for embedding KryoK EXE
// Usage: node encrypt.js <input-exe> <output-bin>
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ENCRYPTION_KEY = Buffer.from('SyncedKryoK2025!@#$');

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', 
    crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(), 
    iv
  );
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: node encrypt.js <path-to-kryok.exe> [output-path]');
  process.exit(1);
}

const inputExe = path.resolve(args[0]);
const outputBin = args[1] || path.join(path.dirname(inputExe), 'kryok_encrypted.bin');

if (!fs.existsSync(inputExe)) {
  console.error(`File not found: ${inputExe}`);
  process.exit(1);
}

const exeBuffer = fs.readFileSync(inputExe);
const encrypted = encryptBuffer(exeBuffer);
fs.writeFileSync(outputBin, encrypted);
console.log(`Encrypted ${inputExe} -> ${outputBin} (${encrypted.length} bytes)`);
