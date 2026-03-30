#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'index.html');
const OUT = path.join(ROOT, 'index.html');

const ITERATIONS = 600_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg) {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

function askPassphrase() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question('Passphrase: ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function encrypt(plaintext, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes
  // Layout: [salt:16][iv:12][ciphertext+authTag]
  return Buffer.concat([salt, iv, encrypted, authTag]).toString('base64');
}

// ---------------------------------------------------------------------------
// Parse source
// ---------------------------------------------------------------------------

function parseSource(html) {
  const headMatch = html.match(/<head>([\s\S]*?)<\/head>/);
  if (!headMatch) die('Could not find <head> in source.');

  // Content to encrypt: from <header class="hero"> through </footer>
  const startMarker = '<header class="hero">';
  const endMarker = '</footer>';
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.lastIndexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    die('Could not find content boundaries (<header class="hero"> ... </footer>). Is src/index.html already encrypted?');
  }

  const bodyContent = html.slice(startIdx, endIdx + endMarker.length);
  return { head: headMatch[1], body: bodyContent };
}

// ---------------------------------------------------------------------------
// Build encrypted HTML
// ---------------------------------------------------------------------------

function buildOutput(headContent, ciphertext) {
  return `<!-- ENCRYPTED - Do not edit. Edit src/index.html instead. -->
<!DOCTYPE html>
<html lang="en" style="overflow-y:scroll;">
<head>
${headContent}
</head>
<body>

<div id="gate">
  <div class="gate-crest">&#9884;</div>
  <h2>The Betts Legacy</h2>
  <p>Family access only</p>
  <form id="gate-form" onsubmit="return false;">
    <input type="password" id="gate-input" placeholder="Enter passphrase" autocomplete="off" />
    <button type="submit" id="gate-btn">Enter</button>
  </form>
  <div class="gate-error" id="gate-error">Incorrect passphrase</div>
  <div style="position:fixed;bottom:12px;left:0;right:0;text-align:center;font-size:10px;color:#c8c3bc;letter-spacing:1px;">v${new Date().toISOString().slice(0,10).replace(/-/g,'.')}</div>
</div>

<div id="encrypted" style="display:none;">${ciphertext}</div>

<script>
(function() {
  var form = document.getElementById('gate-form');
  var input = document.getElementById('gate-input');
  var error = document.getElementById('gate-error');
  var btn = document.getElementById('gate-btn');

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    error.classList.remove('visible');
    input.classList.remove('error');
    btn.textContent = 'Decrypting\\u2026';
    btn.disabled = true;

    try {
      var passphrase = input.value;
      var raw = atob(document.getElementById('encrypted').textContent);
      var payload = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) payload[i] = raw.charCodeAt(i);

      var salt = payload.slice(0, 16);
      var iv = payload.slice(16, 28);
      var ciphertext = payload.slice(28);

      var keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
      );

      var key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: ${ITERATIONS}, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      var decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
      );

      var html = new TextDecoder().decode(decrypted);

      // Keep gate visible as overlay while content loads beneath
      var gate = document.getElementById('gate');
      gate.style.position = 'fixed';
      gate.style.inset = '0';
      gate.style.zIndex = '9999';
      gate.style.transition = 'opacity 0.4s ease';

      document.getElementById('encrypted').remove();
      document.body.insertAdjacentHTML('beforeend', html);

      // Re-execute inline scripts
      document.body.querySelectorAll('script').forEach(function(old) {
        if (old.closest('#gate')) return;
        var s = document.createElement('script');
        s.textContent = old.textContent;
        old.parentNode.replaceChild(s, old);
      });

      // Fade out gate after content is ready
      requestAnimationFrame(function() {
        gate.style.opacity = '0';
        setTimeout(function() { gate.remove(); }, 400);
      });

    } catch (err) {
      input.classList.add('error');
      error.classList.add('visible');
      btn.textContent = 'Enter';
      btn.disabled = false;
    }
  });
})();
</script>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Validate source exists
  if (!fs.existsSync(SRC)) {
    die(`Source file not found: ${SRC}`);
  }

  const html = fs.readFileSync(SRC, 'utf8');

  // Safety: make sure it's plaintext
  if (!html.includes('<header class="hero">')) {
    die('src/index.html does not look like the plaintext source.');
  }

  // Get passphrase
  let passphrase = process.env.BETTS_PASSPHRASE;
  if (!passphrase) {
    passphrase = await askPassphrase();
  }
  if (!passphrase || passphrase.length < 6) {
    die('Passphrase must be at least 6 characters.');
  }

  // Parse and encrypt
  const { head, body } = parseSource(html);
  const ciphertext = encrypt(body, passphrase);

  // Write output
  const output = buildOutput(head, ciphertext);
  fs.writeFileSync(OUT, output, 'utf8');

  console.log(`\n  Encrypted ${body.length} bytes of content.`);
  console.log(`  Output: ${OUT}`);
  console.log(`  Payload: ${ciphertext.length} base64 chars\n`);
}

main();
