#!/bin/bash

# Script to run frontend integration tests
# Ensures backend is running and environment is configured

set -e

echo "🧪 Frontend Integration Test Runner"
echo "=================================="

# Check if backend is running
echo -n "📡 Checking if backend is running... "
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Backend is running"
else
    echo "❌ Backend is NOT running"
    echo ""
    echo "Please start the backend first:"
    echo "  cd ../backend"
    echo "  make backend"
    echo ""
    exit 1
fi

# Set environment variables
export TEST_INTEGRATION=true
export NEXT_PUBLIC_API_URL=http://localhost:8000

echo "🔧 Environment configured:"
echo "   TEST_INTEGRATION=$TEST_INTEGRATION"
echo "   NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL"
echo ""

# Run integration tests
echo "▶️  Running integration tests..."
echo ""

npm test -- --run tests/integration

echo ""
echo "✅ Integration tests complete!"
