# LINE Chat Hub — Claude Code Guide

## Project Overview
Multi-channel LINE OA inbox (respond.io-style). Aggregates messages from multiple LINE Official Accounts into one unified web UI.

## Stack
- **Backend**: Node.js + Express + Socket.io + Prisma ORM
- **Frontend**: React 18 + Vite + Tailwind CSS
- **Database**: PostgreSQL
- **Real-time**: Socket.io
- **LINE integration**: @line/bot-sdk

## Quick Start

```bash
# 1. Start PostgreSQL
docker-compose up -d

# 2. Backend setup
cd backend
cp .env.example .env   # fill in your values
npm install
npx prisma migrate dev --name init
npx prisma db seed
npm run dev

# 3. Frontend setup (new terminal)
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173  
Backend API: http://localhost:3001  
Default login: admin@example.com / admin1234

## LINE Webhook Setup
1. Add a LINE channel in Settings
2. Set webhook URL in LINE Developers Console:
   `https://YOUR_DOMAIN/api/webhooks/line/:channelId`
3. Enable webhook in LINE console

## Environment Variables (backend/.env)
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/linechathub
JWT_SECRET=change-this-to-random-string
ANTHROPIC_API_KEY=sk-ant-...   # for AI reply suggestions
PORT=3001
```

## Key Files
- `backend/src/index.js` — Express + Socket.io entry
- `backend/src/routes/webhooks.js` — LINE webhook receiver
- `backend/src/services/line.service.js` — LINE API calls
- `backend/src/services/claude.service.js` — AI suggestions
- `backend/prisma/schema.prisma` — DB schema
- `frontend/src/pages/Inbox.jsx` — main chat UI
- `frontend/src/pages/Dashboard.jsx` — analytics

## Architecture
```
LINE OA → webhook → backend → DB + Socket.io → frontend
frontend → REST API → backend → LINE API → user
```
