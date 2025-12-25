#!/bin/bash
# Script to download cloudflared binaries for all platforms
# This script downloads the latest cloudflared release from GitHub

set -e

BIN_DIR="bin"
CLOUDFLARED_VERSION="${CLOUDFLARED_VERSION:-latest}"
GITHUB_REPO="cloudflare/cloudflared"
BASE_URL="https://github.com/${GITHUB_REPO}/releases"

# Create bin directory if it doesn't exist
mkdir -p "${BIN_DIR}"

echo "Downloading cloudflared binaries..."

# Function to download for a specific platform
download_for_platform() {
    local platform=$1
    local arch=$2
    local extension=$3
    local output_name=$4
    local is_archive=${5:-false}
    
    if [ "$CLOUDFLARED_VERSION" = "latest" ]; then
        # Get latest release tag
        LATEST_TAG=$(curl -s "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
        echo "Latest version: ${LATEST_TAG}"
    else
        LATEST_TAG="${CLOUDFLARED_VERSION}"
    fi
    
    local download_url="${BASE_URL}/download/${LATEST_TAG}/cloudflared-${platform}-${arch}${extension}"
    local output_path="${BIN_DIR}/${output_name}"
    local temp_archive="${BIN_DIR}/temp-${platform}-${arch}${extension}"
    local temp_extract_dir="${BIN_DIR}/temp-extract-${platform}-${arch}"
    
    echo "Downloading ${platform}-${arch}..."
    echo "  URL: ${download_url}"
    echo "  Output: ${output_path}"
    
    if curl -L -f -o "${temp_archive}" "${download_url}"; then
        if [ "$is_archive" = "true" ]; then
            # Extract .tgz archive
            mkdir -p "${temp_extract_dir}"
            if tar -xzf "${temp_archive}" -C "${temp_extract_dir}"; then
                # The extracted file is named "cloudflared"
                if [ -f "${temp_extract_dir}/cloudflared" ]; then
                    cp "${temp_extract_dir}/cloudflared" "${output_path}"
                    chmod +x "${output_path}"
                    rm -rf "${temp_extract_dir}"
                    rm -f "${temp_archive}"
                    echo "  ✓ Successfully downloaded and extracted ${output_name}"
                else
                    echo "  ✗ Binary not found in archive"
                    rm -rf "${temp_extract_dir}"
                    rm -f "${temp_archive}"
                    return 1
                fi
            else
                echo "  ✗ Failed to extract archive"
                rm -f "${temp_archive}"
                return 1
            fi
        else
            # Direct binary
            mv "${temp_archive}" "${output_path}"
            chmod +x "${output_path}"
            echo "  ✓ Successfully downloaded ${output_name}"
        fi
    else
        echo "  ✗ Failed to download ${platform}-${arch}"
        return 1
    fi
}

# Download for Linux (amd64)
download_for_platform "linux" "amd64" "" "cloudflared" false

# Download for Windows (amd64)
download_for_platform "windows" "amd64" ".exe" "cloudflared.exe" false

# Download for macOS (amd64) - uses .tgz archive
download_for_platform "darwin" "amd64" ".tgz" "cloudflared-mac-amd64" true

# Download for macOS (arm64) - Apple Silicon, uses .tgz archive
download_for_platform "darwin" "arm64" ".tgz" "cloudflared-mac-arm64" true

echo ""
echo "Download complete!"
echo ""
echo "Note: For macOS, you may need to rename the appropriate binary:"
echo "  - For Intel Macs: mv bin/cloudflared-mac-amd64 bin/cloudflared"
echo "  - For Apple Silicon: mv bin/cloudflared-mac-arm64 bin/cloudflared"
echo ""
echo "Or you can use both and the app will detect the correct one at runtime."

