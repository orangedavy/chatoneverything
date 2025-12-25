# Cloudflared Setup Guide

This guide explains how to bundle cloudflared with your app so it works on all platforms (Linux, macOS, Windows) without requiring users to install cloudflared separately.

## Important: No Cloudflare Account Required! ✅

**The app uses Cloudflare's "quick tunnels" feature, which does NOT require:**
- ❌ Signing up for a Cloudflare account
- ❌ Logging in to Cloudflare
- ❌ Any authentication or API keys
- ❌ Any configuration files

Quick tunnels are temporary, public URLs that work immediately out of the box. They're perfect for development and sharing your app with others without any setup.

## Overview

The app now automatically detects and uses bundled cloudflared binaries. If a bundled binary is not found, it falls back to the system PATH (which may not be available on all systems).

## Downloading Cloudflared Binaries

Before building your app, you need to download the cloudflared binaries for all target platforms.

### Option 1: Using npm script (Recommended)

```bash
npm run download-cloudflared
```

This will download the latest cloudflared binaries for:
- Linux (amd64)
- Windows (amd64) 
- macOS (amd64 - Intel)
- macOS (arm64 - Apple Silicon)

### Option 2: Using the Node.js script directly

```bash
node scripts/download-cloudflared.js
```

To download a specific version:
```bash
node scripts/download-cloudflared.js 2024.1.0
```

### Option 3: Using the bash script

```bash
./scripts/download-cloudflared.sh
```

Or with a specific version:
```bash
CLOUDFLARED_VERSION=2024.1.0 ./scripts/download-cloudflared.sh
```

## Binary Structure

After downloading, your `bin/` directory should contain:

```
bin/
├── cloudflared              # Linux binary
├── cloudflared.exe          # Windows binary
├── cloudflared-mac-amd64    # macOS Intel binary
└── cloudflared-mac-arm64    # macOS Apple Silicon binary
```

## How It Works

1. **Development Mode**: The app looks for binaries in `bin/` directory relative to the project root.

2. **Packaged App**: The app looks for binaries in `resources/bin/` (electron-builder places them there via `extraResources`).

3. **Platform Detection**: 
   - Windows: Uses `cloudflared.exe`
   - Linux: Uses `cloudflared`
   - macOS: Automatically detects architecture (arm64 or amd64) and uses the appropriate binary

4. **Fallback**: If no bundled binary is found, the app falls back to using `cloudflared` from the system PATH (may fail if not installed).

## Building the App

After downloading the binaries, build your app as usual:

```bash
# Build for Linux
npm run build:linux

# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac

# Build for all platforms
npm run build
```

The cloudflared binaries will be automatically included in the built packages via the `extraResources` configuration in `package.json`.

## Verification

To verify that cloudflared is bundled correctly:

1. **Development**: Check that `bin/cloudflared` (or platform-specific binary) exists and is executable.

2. **Packaged App**: After building, check that the binary is in the `resources/bin/` directory of the unpacked app.

3. **Runtime**: When the app starts, check the logs. If cloudflared is found, tunnel creation will proceed. If not, you'll see a warning about falling back to system PATH.

## Troubleshooting

### Binaries not found after building

- Ensure you've run the download script before building
- Check that `package.json` includes the correct binary names in `extraResources`
- Verify the binary names match what's in your `bin/` directory

### Tunnel creation fails

- Check that the cloudflared binary is executable (on Unix-like systems)
- Verify the binary architecture matches the target platform
- Check app logs for specific error messages

### macOS architecture issues

- The app automatically detects the correct architecture
- If you only have one macOS binary, the app will try to use it (may fail on incompatible architecture)
- For best results, include both `cloudflared-mac-amd64` and `cloudflared-mac-arm64`

## Manual Download

If the scripts don't work, you can manually download cloudflared from:
https://github.com/cloudflare/cloudflared/releases

Place the binaries in the `bin/` directory with the correct names:
- Linux: `cloudflared`
- Windows: `cloudflared.exe`
- macOS Intel: `cloudflared-mac-amd64`
- macOS Apple Silicon: `cloudflared-mac-arm64`

