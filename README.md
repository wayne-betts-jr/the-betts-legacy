# The Betts Legacy

A family lineage chronicle tracing the Betts family across fifteen generations — from Suffolk, England (1480) to the present day.

**Live site:** [legacy.betts.co](https://legacy.betts.co)

---

## How It Works

The site content is **client-side encrypted**. The published `index.html` contains only the passphrase gate and an AES-256-GCM ciphertext blob — no readable family data appears in the source.

When a visitor enters the correct passphrase, the browser derives a key via PBKDF2 (600k iterations, SHA-256), decrypts the content in memory, and renders the page. Nothing is sent to a server.

### File Structure

```
src/index.html      ← Plaintext source (edit here)
index.html          ← Encrypted output (generated, do not edit)
tools/encrypt.js    ← Build script (Node.js, zero dependencies)
tools/og-image.html ← OG image generator
```

### Editing & Publishing

```bash
# 1. Edit the plaintext source
vim src/index.html

# 2. Encrypt (prompts for passphrase if env var is omitted)
BETTS_PASSPHRASE=your-passphrase node tools/encrypt.js

# 3. Commit both files and push
git add src/index.html index.html
git commit -m "Update content"
git push
```

### Encryption Details

| Parameter       | Value                              |
|-----------------|------------------------------------|
| Algorithm       | AES-256-GCM                        |
| Key derivation  | PBKDF2 · 600,000 iterations · SHA-256 |
| Salt            | 16 random bytes (per encryption)   |
| IV              | 12 random bytes (per encryption)   |
| Payload format  | `[salt:16][iv:12][ciphertext+authTag]` → base64 |

The `<head>` (meta tags, OG tags, fonts, CSS) is **not** encrypted so that social previews and styling work without the passphrase.

### Future Enhancements

- **Session persistence** — cache the derived key in `sessionStorage` so the passphrase survives page reloads within a tab
- **Rate limiting** — add a short delay after failed attempts to slow brute-force
- **Pre-commit hook** — automatically verify `index.html` contains the `<!-- ENCRYPTED -->` marker before allowing commits
- **Multiple pages** — extend `encrypt.js` to process a glob of source files if the site grows beyond a single page
