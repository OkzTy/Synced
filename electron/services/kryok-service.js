const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');

/**
 * KryoK Launcher Service
 * 
 * Embeds the KryoK EXE encrypted inside the app.
 * On launch: decrypts to a random temp folder, launches with --key, auto-deletes on exit.
 * 
 * The EXE is never sitting on disk permanently — only exists while running.
 * 
 * Elevation strategy:
 * - If Synced is already running as admin: spawn directly (child inherits admin)
 * - If not: use PowerShell Start-Process -Verb RunAs with PID tracking
 */

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

function decryptBuffer(encrypted) {
  const iv = encrypted.subarray(0, 16);
  const data = encrypted.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc',
    crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(),
    iv
  );
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function encryptExe(inputPath, outputPath) {
  const exeBuffer = fs.readFileSync(inputPath);
  const encrypted = encryptBuffer(exeBuffer);
  fs.writeFileSync(outputPath, encrypted);
  console.log(`[KryoK] Encrypted ${inputPath} -> ${outputPath} (${encrypted.length} bytes)`);
}

/**
 * Check if the current process is running with administrator privileges
 */
function isElevated() {
  try {
    const result = require('child_process').execSync(
      'net session',
      { stdio: 'pipe', windowsHide: true, timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a process by PID to exit, then execute cleanup
 */
function monitorProcessAndCleanup(pid, tempDir, tokenFilePath, handshakeDir) {
  // Poll every 500ms to check if the process is still alive
  const pollInterval = setInterval(() => {
    try {
      // Sending signal 0 checks if the process exists without killing it
      process.kill(pid, 0);
      // Process still alive — keep waiting
    } catch {
      // Process no longer exists (ESRHR) — clean up
      clearInterval(pollInterval);
      cleanupTempDir(tempDir);
      try { fs.unlinkSync(tokenFilePath); } catch {}
      try { 
        const files = fs.readdirSync(handshakeDir);
        if (files.length === 0) fs.rmdirSync(handshakeDir);
      } catch {}
      console.log('[KryoK] Process exited, temp files cleaned up');
    }
  }, 500);
}

/**
 * Launch KryoK — uses direct spawn if already admin, or PowerShell elevation if not
 */
function launchKryoK(licenseKey) {
  return new Promise((resolve, reject) => {
    try {
      // Generate HMAC handshake token (Layer 5)
      const handshakeDir = path.join(require('os').tmpdir(), 'kryok_handshake');
      if (!fs.existsSync(handshakeDir)) {
        fs.mkdirSync(handshakeDir, { recursive: true });
      }

      const hmac = crypto.createHmac('sha256', licenseKey);
      const timestamp = Math.floor(Date.now() / 1000);
      hmac.update(timestamp.toString());
      const tokenHmac = hmac.digest('hex');
      const tokenContent = `${timestamp}|${tokenHmac}`;
      const tokenFilePath = path.join(handshakeDir, 'launch.token');
      fs.writeFileSync(tokenFilePath, tokenContent);

      // Encrypted binary path
      const encryptedPath = path.join(__dirname, '../../assets/kryok.bin');
      
      if (!fs.existsSync(encryptedPath)) {
        try { fs.unlinkSync(tokenFilePath); } catch {}
        return reject(new Error('KryoK binary not found. Please reinstall Synced.'));
      }

      // Read and decrypt
      const encryptedData = fs.readFileSync(encryptedPath);
      let decrypted;
      try {
        decrypted = decryptBuffer(encryptedData);
      } catch {
        try { fs.unlinkSync(tokenFilePath); } catch {}
        return reject(new Error('Failed to decrypt KryoK binary. File may be corrupted.'));
      }

      // Write to random temp folder
      const tempDir = path.join(
        require('os').tmpdir(),
        'kryok_' + Math.random().toString(36).substring(2, 10)
      );
      fs.mkdirSync(tempDir, { recursive: true });
      
      const exePath = path.join(tempDir, 'kryok.exe');
      fs.writeFileSync(exePath, decrypted);

      // Check if already running as admin
      const elevated = isElevated();
      console.log(`[KryoK] Launching (admin=${elevated}) from: ${exePath}`);

      if (elevated) {
        // ===== ALREADY ADMIN: SPAWN DIRECTLY =====
        // Child inherits admin rights — no elevation needed
        const child = spawn(exePath, ['--key', licenseKey], {
          windowsHide: true,
          stdio: 'ignore',
          detached: false,
        });

        let resolved = false;

        child.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            cleanupTempDir(tempDir);
            try { fs.unlinkSync(tokenFilePath); } catch {}
            reject(new Error(`Failed to launch KryoK: ${err.message}`));
          }
        });

        child.on('exit', (code, signal) => {
          console.log(`[KryoK] Process exited with code=${code} signal=${signal}`);
          cleanupTempDir(tempDir);
          try { fs.unlinkSync(tokenFilePath); } catch {}
          try { 
            const files = fs.readdirSync(handshakeDir);
            if (files.length === 0) fs.rmdirSync(handshakeDir);
          } catch {}
        });

        // Child process started successfully
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve({ success: true });
          }
        }, 1500);

      } else {
        // ===== NOT ADMIN: USE ELEVATION =====
        // Launch with PowerShell -Verb RunAs, capture PID via -PassThru
        const args = `--key "${licenseKey}"`;
        const pidFilePath = path.join(tempDir, 'kryok.pid');
        
        // PowerShell script that:
        // 1. Starts the process elevated
        // 2. Captures the PID
        // 3. Writes PID to file (so we can monitor it)
        // 4. Exits immediately (cleanup happens in Node via PID polling)
        const psScript = `$p = Start-Process -FilePath "${exePath}" -ArgumentList '${args}' -Verb RunAs -PassThru -WindowStyle Hidden; $p.Id | Out-File -FilePath "${pidFilePath}" -Encoding ASCII`;

        const child = spawn('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command', psScript
        ], {
          windowsHide: true,
          stdio: 'ignore',
        });

        let resolved = false;

        child.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            cleanupTempDir(tempDir);
            try { fs.unlinkSync(tokenFilePath); } catch {}
            reject(new Error(`Failed to launch KryoK: ${err.message}`));
          }
        });

        child.on('exit', () => {
          // PowerShell has exited (it exits immediately after Start-Process)
          // Now read the PID file to get the elevated process PID
          try {
            if (fs.existsSync(pidFilePath)) {
              const pidStr = fs.readFileSync(pidFilePath, 'ascii').trim();
              const pid = parseInt(pidStr, 10);
              if (pid && !isNaN(pid)) {
                console.log(`[KryoK] Elevated process PID: ${pid}`);
                // Monitor this PID for exit, then clean up
                monitorProcessAndCleanup(pid, tempDir, tokenFilePath, handshakeDir);
              } else {
                // Couldn't parse PID — fallback: delayed cleanup
                console.warn('[KryoK] Could not parse PID, using fallback cleanup');
                scheduleFallbackCleanup(tempDir, tokenFilePath, handshakeDir);
              }
            } else {
              console.warn('[KryoK] PID file not found, using fallback cleanup');
              scheduleFallbackCleanup(tempDir, tokenFilePath, handshakeDir);
            }
          } catch (err) {
            console.warn('[KryoK] PID read error:', err.message);
            scheduleFallbackCleanup(tempDir, tokenFilePath, handshakeDir);
          }
        });

        // Resolve after a delay — the elevated process should have started by now
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve({ success: true });
          }
        }, 2000);
      }

    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Fallback: wait 30 seconds then clean up (assumes KryoK will have started by then)
 * This is used if we can't determine the elevated process PID
 */
function scheduleFallbackCleanup(tempDir, tokenFilePath, handshakeDir) {
  console.log('[KryoK] Fallback cleanup scheduled in 60s');
  setTimeout(() => {
    cleanupTempDir(tempDir);
    try { fs.unlinkSync(tokenFilePath); } catch {}
    try { 
      const files = fs.readdirSync(handshakeDir);
      if (files.length === 0) fs.rmdirSync(handshakeDir);
    } catch {}
  }, 60000);
}

/**
 * Clean up the temp directory
 */
function cleanupTempDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      // Try to delete all files in the directory first
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(dirPath, file));
        } catch {}
      }
      fs.rmdirSync(dirPath);
      console.log(`[KryoK] Cleaned up: ${dirPath}`);
    }
  } catch (err) {
    console.error('[KryoK] Cleanup error:', err.message);
  }
}

function registerIpcHandlers() {
  ipcMain.handle('kryok:launch', async (event, licenseKey) => {
    try {
      const result = await launchKryoK(licenseKey);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = {
  registerIpcHandlers,
  encryptExe,
  launchKryoK,
};

// CLI: node electron/services/kryok-service.js encrypt <input-exe> <output-bin>
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'encrypt' && args[1]) {
    const inputExe = path.resolve(args[1]);
    const outputBin = args[2] || path.join(path.dirname(inputExe), 'kryok_encrypted.bin');
    encryptExe(inputExe, outputBin);
  } else {
    console.log('Usage: node electron/services/kryok-service.js encrypt <path-to-kryok.exe> [output-path]');
  }
}
