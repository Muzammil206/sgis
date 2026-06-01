#!/bin/bash

# ============================================================================
# SGIS Docker Quick Start Script
# Usage: ./docker-start.sh [start|stop|restart|logs|clean]
# ============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "${BLUE}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker Desktop from https://www.docker.com/products/docker-desktop"
        exit 1
    fi
    print_success "Docker is installed"
}

# Check if Docker Compose is installed
check_docker_compose() {
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed"
        exit 1
    fi
    print_success "Docker Compose is installed"
}

# Start services
start_services() {
    print_header "Starting SGIS services..."
    
    if [ ! -f .env ]; then
        print_warning ".env file not found, copying from .env.example"
        cp .env.example .env
        print_success "Created .env file (edit it to customize settings)"
    fi
    
    docker-compose up -d
    print_success "Services started!"
    print_header "Waiting for database to be ready..."
    sleep 5
    
    echo ""
    print_header "Services are now running:"
    echo "  🌐 API:     http://localhost:4000"
    echo "  📊 pgAdmin: http://localhost:5050 (admin@admin.com / admin)"
    echo ""
    print_header "Useful commands:"
    echo "  View logs:     $0 logs"
    echo "  Stop services: $0 stop"
    echo "  Restart:       $0 restart"
}

# Stop services
stop_services() {
    print_header "Stopping SGIS services..."
    docker-compose down
    print_success "Services stopped"
}

# Restart services
restart_services() {
    print_header "Restarting SGIS services..."
    stop_services
    sleep 2
    start_services
}

# Show logs
show_logs() {
    SERVICE=${1:-""}
    if [ -z "$SERVICE" ]; then
        print_header "Showing logs from all services (Ctrl+C to exit):"
        docker-compose logs -f
    else
        print_header "Showing logs from $SERVICE service (Ctrl+C to exit):"
        docker-compose logs -f "$SERVICE"
    fi
}

# Clean up
clean_all() {
    print_warning "This will stop services and delete all data (database, volumes)"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_header "Cleaning up..."
        docker-compose down -v
        print_success "Cleanup complete"
    else
        print_warning "Cleanup cancelled"
    fi
}

# Build image
build_image() {
    print_header "Building Docker image..."
    docker-compose build --no-cache
    print_success "Image built successfully"
}

# Main menu
case "${1:-help}" in
    start)
        check_docker
        check_docker_compose
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        check_docker
        check_docker_compose
        restart_services
        ;;
    logs)
        show_logs "$2"
        ;;
    clean)
        clean_all
        ;;
    build)
        check_docker
        check_docker_compose
        build_image
        ;;
    status)
        print_header "Container status:"
        docker-compose ps
        ;;
    ps)
        docker-compose ps
        ;;
    *)
        echo -e "${BLUE}SGIS Docker Quick Start${NC}"
        echo ""
        echo "Usage: $0 [command] [options]"
        echo ""
        echo "Commands:"
        echo "  start [service]  - Start all services (or specific service)"
        echo "  stop             - Stop all services"
        echo "  restart          - Restart all services"
        echo "  logs [service]   - Show logs (api, db, pgadmin)"
        echo "  status           - Show container status"
        echo "  build            - Build Docker image"
        echo "  clean            - Stop and remove all containers/volumes"
        echo "  help             - Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 start"
        echo "  $0 logs api"
        echo "  $0 restart"
        echo ""
        ;;
esac
