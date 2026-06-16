const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.argv[2];
const pkg = require('../package.json');
const VERSION = pkg.version;
const EXE_PATH = path.join(__dirname, '..', 'dist-electron', `Synced Setup ${VERSION}.exe`);

async function ghFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      method: options.method || 'GET',
      headers: {
        'Authorization': `token ${TOKEN}`,
        'User-Agent': 'Synced-Release-Script',
        ...options.headers,
      },
    };
    const req = https.request(url, opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`GitHub API error ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  // 1. Delete old release if exists
  console.log('Checking existing releases...');
  const releases = await ghFetch('https://api.github.com/repos/OkzTy/Synced/releases');
  const oldRelease = releases.find(r => r.tag_name === `v${VERSION}`);
  if (oldRelease) {
    console.log(`Deleting old release: ${oldRelease.id}`);
    // Delete all assets first
    for (const asset of oldRelease.assets) {
      console.log(`  Deleting asset: ${asset.name}`);
      await ghFetch(`https://api.github.com/repos/OkzTy/Synced/releases/assets/${asset.id}`, { method: 'DELETE' });
    }
    await ghFetch(`https://api.github.com/repos/OkzTy/Synced/releases/${oldRelease.id}`, { method: 'DELETE' });
    // Also delete the tag
    try {
      await ghFetch(`https://api.github.com/repos/OkzTy/Synced/git/refs/tags/v${VERSION}`, { method: 'DELETE' });
    } catch {}
  }

  // 2. Create release
  console.log('Creating release...');
  const release = await ghFetch('https://api.github.com/repos/OkzTy/Synced/releases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: `v${VERSION}`,
      name: `v${VERSION}`,
      body: `Synced v${VERSION}\n\n- Turso cloud database integration (online sync)\n- Bug fixes & improvements`,
      draft: false,
      prerelease: VERSION.includes('beta') || VERSION.includes('alpha'),
    }),
  });
  console.log(`Release created: ${release.html_url}`);

  // 3. Upload the .exe asset
  console.log('Uploading installer...');
  const fileBuffer = fs.readFileSync(EXE_PATH);
  const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(path.basename(EXE_PATH))}`);
  
  const uploadRes = await new Promise((resolve, reject) => {
    const opts = {
      method: 'POST',
      headers: {
        'Authorization': `token ${TOKEN}`,
        'User-Agent': 'Synced-Release-Script',
        'Content-Type': 'application/x-msdownload',
        'Content-Length': fileBuffer.length,
      },
    };
    const req = https.request(uploadUrl, opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`Upload error ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
  console.log(`Installer uploaded!`);

  // 4. Upload blockmap if exists
  const blockMapPath = EXE_PATH + '.blockmap';
  if (fs.existsSync(blockMapPath)) {
    console.log('Uploading blockmap...');
    const bmBuffer = fs.readFileSync(blockMapPath);
    const bmUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(path.basename(blockMapPath))}`);
    await new Promise((resolve, reject) => {
      const opts = {
        method: 'POST',
        headers: {
          'Authorization': `token ${TOKEN}`,
          'User-Agent': 'Synced-Release-Script',
          'Content-Type': 'application/octet-stream',
          'Content-Length': bmBuffer.length,
        },
      };
      const req = https.request(bmUrl, opts, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`Blockmap upload error ${res.statusCode}: ${data}`));
        });
      });
      req.on('error', reject);
      req.write(bmBuffer);
      req.end();
    });
    console.log('Blockmap uploaded!');
  }

  console.log(`\n✅ Release v${VERSION} created successfully!`);
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
