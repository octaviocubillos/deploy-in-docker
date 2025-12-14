#!/bin/bash

# Configuration constants
GITHUB_REPO="octaviocubillos/deploy-in-docker"
BINARY_NAME="oton-pilot"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="$HOME/.config/oton-pilot"
GH_API_URL="https://api.github.com/repos/$GITHUB_REPO/releases/latest"

# Terminal formatting
BOLD='\033[1m'
GREEN='\033[1;32m'
BLUE='\033[1;34m'
RED='\033[1;31m'
NC='\033[0m' # No Color

echo -e "\n${BOLD}${BLUE}=== Oton Pilot CLI Installer ===${NC}\n"

# 1. Platform Detection
echo -e "${BLUE}[1/5] Identifying platform...${NC}"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

if [[ "$OS" != "linux" && "$OS" != "darwin" ]]; then
    echo -e "${RED}Error: OS '$OS' is not supported.${NC}"
    exit 1
fi

# Map architecture to release binary names if necessary
# Assuming binary is platform-agnostic node binary or specific build
# For this example we'll assume a single 'oton-pilot.min.js' or bundled binary
# Adjust as per your release artifacts naming convention
ASSET_NAME="oton-pilot.min.js" 

echo -e "Platform: ${GREEN}$OS ($ARCH)${NC}"

# 2. Check Prerequisites
echo -e "\n${BLUE}[2/5] Preparing environment...${NC}"

# We will install our own node binary if not present used solely for this CLI
NODE_VERSION="v22.11.0"
NODE_DIST="linux-x64" # Default to linux-x64, can be dynamic based on ARCH/OS
if [[ "$OS" == "darwin" ]]; then
    NODE_DIST="darwin-x64"
    if [[ "$ARCH" == "arm64" ]]; then
        NODE_DIST="darwin-arm64" 
    fi
elif [[ "$ARCH" == "aarch64" ]]; then
    NODE_DIST="linux-arm64"
fi

NODE_FILENAME="node-${NODE_VERSION}-${NODE_DIST}"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_FILENAME}.tar.gz"
LOCAL_NODE_BIN="$CONFIG_DIR/bin/node"

# 3. Create Configuration Directory
echo -e "\n${BLUE}[3/5] Setting up configuration...${NC}"
if [ ! -d "$CONFIG_DIR/bin" ]; then
    mkdir -p "$CONFIG_DIR/bin"
    echo -e "Created configuration directory: ${GREEN}$CONFIG_DIR${NC}"
fi

# Download Node.js if not exists
if [ ! -f "$LOCAL_NODE_BIN" ]; then
    echo -e "Downloading Node.js (${NODE_VERSION})..."
    curl -L "$NODE_URL" | tar -xz -C "$CONFIG_DIR/bin" --strip-components=2 "${NODE_FILENAME}/bin/node"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Node.js installed locally for oton-pilot.${NC}"
    else
        echo -e "${RED}Failed to download Node.js.${NC}"
        exit 1
    fi
else 
     echo -e "Using existing local Node.js."
fi


# 4. Download Release
echo -e "\n${BLUE}[4/5] Downloading latest release...${NC}"

# Fetch latest release URL
LATEST_URL=$(curl -s $GH_API_URL | grep "browser_download_url.*$ASSET_NAME" | cut -d '"' -f 4)

if [ -z "$LATEST_URL" ]; then
    echo -e "${RED}Error: Could not determine download URL for $ASSET_NAME${NC}"
    echo "Check if the release exists on GitHub ($GITHUB_REPO)."
    exit 1
fi

echo -e "Downloading from: ${GREEN}$LATEST_URL${NC}"

# Create a temporary wrapper script
WRAPPER_SCRIPT="$INSTALL_DIR/$BINARY_NAME"
JS_DEST="$CONFIG_DIR/$ASSET_NAME"

# Download the JS bundle to config dir (or lib dir)
curl -L -o "$JS_DEST" "$LATEST_URL" --progress-bar

if [ $? -ne 0 ]; then
    echo -e "${RED}Download failed.${NC}"
    exit 1
fi

chmod +x "$JS_DEST"

# 5. Create Executable Wrapper
echo -e "\n${BLUE}[5/5] Creating executable wrapper...${NC}"

# Write the wrapper bash script
cat <<EOF > "$WRAPPER_SCRIPT"
#!/bin/bash
"$LOCAL_NODE_BIN" "$JS_DEST" "\$@"
EOF

# Make it executable
chmod +x "$WRAPPER_SCRIPT"

echo -e "\n${GREEN}✔ Installation successful!${NC}"
echo -e "You can now use the CLI by running: ${BOLD}$BINARY_NAME${NC}\n"
echo -e "Try it now: ${BLUE}$BINARY_NAME --help${NC}\n"
