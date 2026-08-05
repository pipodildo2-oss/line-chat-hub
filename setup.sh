#!/bin/bash
set -e

echo "======================================"
echo "  LINE Chat Hub — Setup Script"
echo "  (SQLite mode - no Docker needed)"
echo "======================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "📁 Project dir: $SCRIPT_DIR"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Please install from https://nodejs.org"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# Backend setup
cd "$SCRIPT_DIR/backend"

# Create .env with SQLite
if [ ! -f .env ]; then
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env << EOF
DATABASE_URL=file:./dev.db
JWT_SECRET=$JWT_SECRET
ANTHROPIC_API_KEY=
PORT=3001
EOF
  echo "✅ .env created (SQLite)"
else
  # Update DATABASE_URL to SQLite if it's still postgresql
  if grep -q "postgresql" .env; then
    sed -i '' 's|DATABASE_URL=.*|DATABASE_URL=file:./dev.db|' .env
    echo "✅ .env updated to use SQLite"
  else
    echo "✅ .env already exists"
  fi
fi

echo ""
echo "📦 Installing backend packages..."
npm install
echo "✅ Backend packages installed"

echo ""
echo "🗄️  Setting up SQLite database..."
npx prisma migrate dev --name init 2>/dev/null || npx prisma db push
node prisma/seed.js
echo "✅ Database ready (SQLite)"

echo ""
echo "📦 Installing frontend packages..."
cd "$SCRIPT_DIR/frontend"
npm install
echo "✅ Frontend packages installed"

echo ""
echo "======================================"
echo "✅ Setup complete!"
echo ""
echo "Run these in 2 separate Terminal tabs:"
echo ""
echo "  Tab 1 - Backend:"
echo "  cd \"$SCRIPT_DIR/backend\" && npm run dev"
echo ""
echo "  Tab 2 - Frontend:"
echo "  cd \"$SCRIPT_DIR/frontend\" && npm run dev"
echo ""
echo "Then open: http://localhost:5173"
echo "Login: admin@example.com / admin1234"
echo "======================================"
