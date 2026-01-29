#!/bin/bash
#
# Vendor Hours Tracker - Production Startup Script
# 
# Usage:
#   ./scripts/start.sh           # Start/restart the application
#   ./scripts/start.sh stop      # Stop the application
#   ./scripts/start.sh status    # Check status
#   ./scripts/start.sh logs      # View logs
#   ./scripts/start.sh setup     # First-time setup (install + build + start)
#   ./scripts/start.sh install-deps  # Install system dependencies (Node.js, build tools)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect OS and package manager
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
    elif [ -f /etc/redhat-release ]; then
        OS="rhel"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    else
        OS="unknown"
    fi
    
    # Detect package manager
    if command -v apt-get &> /dev/null; then
        PKG_MANAGER="apt"
    elif command -v dnf &> /dev/null; then
        PKG_MANAGER="dnf"
    elif command -v yum &> /dev/null; then
        PKG_MANAGER="yum"
    elif command -v brew &> /dev/null; then
        PKG_MANAGER="brew"
    else
        PKG_MANAGER="unknown"
    fi
}

# Install system dependencies
install_system_deps() {
    detect_os
    
    log_info "Detected OS: $OS (Package manager: $PKG_MANAGER)"
    echo ""
    
    case $PKG_MANAGER in
        apt)
            log_info "Installing system dependencies with apt..."
            sudo apt-get update
            sudo apt-get install -y curl git build-essential python3
            ;;
        dnf)
            log_info "Installing system dependencies with dnf..."
            sudo dnf install -y curl git gcc gcc-c++ make python3
            ;;
        yum)
            log_info "Installing system dependencies with yum..."
            sudo yum install -y curl git gcc gcc-c++ make python3
            ;;
        brew)
            log_info "Installing system dependencies with Homebrew..."
            brew install python3 || true
            # Xcode command line tools should already have build tools
            ;;
        *)
            log_warn "Unknown package manager. Please install manually:"
            echo "  - curl"
            echo "  - git"
            echo "  - build tools (gcc, g++, make)"
            echo "  - python3"
            return 1
            ;;
    esac
    
    log_success "System dependencies installed"
}

# Install Node.js
install_nodejs() {
    detect_os
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            log_info "Node.js $(node -v) already installed"
            return 0
        fi
        log_warn "Node.js version too old. Installing Node.js 20 LTS..."
    else
        log_info "Installing Node.js 20 LTS..."
    fi
    
    case $PKG_MANAGER in
        apt)
            # Using NodeSource repository for Ubuntu/Debian
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        dnf|yum)
            # Using NodeSource repository for RHEL/CentOS/Amazon Linux
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo $PKG_MANAGER install -y nodejs
            ;;
        brew)
            brew install node@20
            brew link --overwrite node@20
            ;;
        *)
            log_error "Cannot auto-install Node.js. Please install Node.js 18+ manually:"
            echo "  https://nodejs.org/en/download/"
            echo ""
            echo "Or use nvm:"
            echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
            echo "  nvm install 20"
            echo "  nvm use 20"
            return 1
            ;;
    esac
    
    log_success "Node.js $(node -v) installed"
}

# Install PM2 globally (optional, for system-wide access)
install_pm2_global() {
    if command -v pm2 &> /dev/null; then
        log_info "PM2 already installed globally"
        return 0
    fi
    
    log_info "Installing PM2 globally..."
    sudo npm install -g pm2
    log_success "PM2 installed globally"
}

# Full system setup
install_all_deps() {
    echo ""
    echo "============================================"
    echo "  System Dependencies Installation"
    echo "============================================"
    echo ""
    
    install_system_deps
    echo ""
    install_nodejs
    echo ""
    
    # Verify installation
    echo ""
    log_info "Verifying installation..."
    echo "  Node.js: $(node -v)"
    echo "  npm: $(npm -v)"
    
    echo ""
    read -p "Install PM2 globally? (recommended for production) [y/N]: " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_pm2_global
    fi
    
    echo ""
    log_success "System dependencies ready!"
    echo ""
    log_info "Next step: Run './scripts/start.sh setup' to deploy the application"
    echo ""
}

# Check if Node.js is installed
check_node() {
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed."
        echo ""
        log_info "Run './scripts/start.sh install-deps' to install system dependencies"
        echo "Or install Node.js manually: https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_error "Node.js version 18+ required. Current: $(node -v)"
        echo ""
        log_info "Run './scripts/start.sh install-deps' to upgrade Node.js"
        exit 1
    fi
    
    log_info "Node.js $(node -v) detected"
}

# Check if PM2 is available
check_pm2() {
    if ! npx pm2 --version &> /dev/null; then
        log_error "PM2 not found. Run 'npm install' first."
        exit 1
    fi
}

# Install dependencies
install_deps() {
    log_info "Installing dependencies..."
    npm install
    log_success "Dependencies installed"
}

# Build the project
build_project() {
    log_info "Building project..."
    npm run build
    log_success "Build complete"
}

# Create required directories
create_dirs() {
    mkdir -p logs
    mkdir -p server/uploads
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."
    npm run db:migrate
    log_success "Migrations complete"
}

# Start the application
start_app() {
    check_pm2
    create_dirs
    
    log_info "Starting application with PM2..."
    npx pm2 start ecosystem.config.cjs --env production
    
    echo ""
    log_success "Application started!"
    echo ""
    npx pm2 status
    echo ""
    log_info "View logs with: npm run pm2:logs"
    log_info "Monitor with: npm run pm2:monit"
}

# Stop the application
stop_app() {
    check_pm2
    log_info "Stopping application..."
    npx pm2 stop ecosystem.config.cjs 2>/dev/null || true
    npx pm2 delete ecosystem.config.cjs 2>/dev/null || true
    log_success "Application stopped"
}

# Restart the application
restart_app() {
    check_pm2
    create_dirs
    
    # Check if processes exist
    if npx pm2 list | grep -q "vendor-tracker"; then
        log_info "Restarting application..."
        npx pm2 restart ecosystem.config.cjs
    else
        log_info "No running processes found. Starting fresh..."
        start_app
    fi
    
    log_success "Application restarted"
    npx pm2 status
}

# Show status
show_status() {
    check_pm2
    npx pm2 status
}

# Show logs
show_logs() {
    check_pm2
    npx pm2 logs
}

# Full setup (first-time deployment)
full_setup() {
    echo ""
    echo "============================================"
    echo "  Application Setup"
    echo "============================================"
    echo ""
    
    # Check if Node.js is available, offer to install if not
    if ! command -v node &> /dev/null; then
        log_warn "Node.js is not installed."
        echo ""
        read -p "Would you like to install system dependencies now? [Y/n]: " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            install_all_deps
            echo ""
        else
            log_error "Node.js is required. Run './scripts/start.sh install-deps' first."
            exit 1
        fi
    fi
    
    check_node
    install_deps
    build_project
    run_migrations
    
    echo ""
    log_info "Setup complete! Starting application..."
    echo ""
    
    start_app
    
    echo ""
    echo "============================================"
    log_success "Deployment complete!"
    echo "============================================"
    echo ""
    log_info "API Server:    http://localhost:3001"
    log_info "Client:        http://localhost:5173"
    echo ""
    log_info "To enable auto-start on reboot, run:"
    echo "  ./scripts/start.sh startup"
    echo ""
}

# Setup PM2 to start on boot
setup_startup() {
    check_pm2
    log_info "Setting up PM2 startup..."
    echo ""
    echo "Run the following command (may require sudo):"
    echo ""
    npx pm2 startup
    echo ""
    log_info "After running the above command, save the process list:"
    echo "  npx pm2 save"
}

# Main command handler
case "${1:-start}" in
    start)
        check_node
        restart_app
        ;;
    stop)
        stop_app
        ;;
    restart)
        check_node
        restart_app
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    setup)
        full_setup
        ;;
    build)
        check_node
        build_project
        ;;
    startup)
        setup_startup
        ;;
    install-deps)
        install_all_deps
        ;;
    install-node)
        install_nodejs
        ;;
    *)
        echo "Vendor Hours Tracker - Startup Script"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  install-deps  - Install system dependencies (Node.js, build tools)"
        echo "  setup         - First-time app setup (npm install, build, migrate, start)"
        echo "  start         - Start or restart the application (default)"
        echo "  stop          - Stop the application"
        echo "  restart       - Restart the application"
        echo "  status        - Show process status"
        echo "  logs          - View application logs"
        echo "  build         - Build the project only"
        echo "  startup       - Configure PM2 to start on system boot"
        echo ""
        echo "First-time deployment on a fresh server:"
        echo "  1. ./scripts/start.sh install-deps"
        echo "  2. ./scripts/start.sh setup"
        echo "  3. ./scripts/start.sh startup"
        echo ""
        exit 1
        ;;
esac
