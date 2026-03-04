# 💚 Emerald Chat

A real-time anonymous chat platform built with **Node.js + Socket.io**. Pairs real strangers instantly using interest-based matchmaking.

## Features

- ⚡ Real-time 1-on-1 text chat (Socket.io WebSockets)
- 👥 Group chat lobby (shared room, all users)
- 🎯 Interest-based matching (optional — falls back to FIFO queue)
- ⌨️ Live typing indicators
- ⏭ Skip / next stranger (re-queues instantly)
- 👤 Anonymous aliases (e.g. "SwiftFox42") — no account needed
- 🚩 Report system (logs to server console)
- ⭐ Post-chat rating modal
- 📊 Live online count broadcast every 5 seconds
- 🏥 Health check endpoint at `/health`

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env
cp .env.example .env

# 3. Start dev server (with auto-reload)
npm run dev

# 4. Open http://localhost:3000
```

---

## Deploy to Railway (recommended — free tier)

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo
4. Railway auto-detects Node.js and uses `railway.json`
5. Your app goes live at `https://your-app.up.railway.app`

No environment variables required — PORT is set automatically by Railway.

---

## Deploy to Render (free tier)

1. Push to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Render reads `render.yaml` automatically
5. Live at `https://your-app.onrender.com`

> Note: Render free tier spins down after 15 min of inactivity. Upgrade to paid for always-on.

---

## Deploy to a VPS (DigitalOcean, Linode, etc.)

```bash
# On your server
git clone https://github.com/you/emerald-chat
cd emerald-chat
npm install --production

# Run with PM2 (keeps alive on reboot)
npm install -g pm2
pm2 start server.js --name emerald-chat
pm2 save
pm2 startup

# Optional: Nginx reverse proxy
# Point your domain to port 3000
```

---

## Project Structure

```
emerald-chat/
├── server.js          # Main server — Express + Socket.io matchmaking
├── public/
│   └── index.html     # Complete frontend (single file, no build step)
├── package.json
├── Procfile           # Railway / Heroku
├── railway.json       # Railway config
├── render.yaml        # Render config
├── .env.example
├── .gitignore
└── README.md
```

---

## Socket.io Event Reference

| Event (client → server) | Payload | Description |
|---|---|---|
| `register` | `{ gender, interests[], mode }` | Set user preferences |
| `find_match` | `{ mode }` | Join matchmaking queue |
| `message` | `{ text }` | Send message to room |
| `typing` | `{ isTyping }` | Broadcast typing indicator |
| `skip` | — | End chat, re-queue |
| `leave_chat` | — | Stop looking entirely |
| `report` | `{ reason }` | Report current partner |

| Event (server → client) | Payload | Description |
|---|---|---|
| `registered` | `{ alias }` | Your anonymous alias |
| `queued` | `{ position }` | Your place in queue |
| `matched` | `{ roomId, partnerAlias, sharedInterests, mode }` | Paired with someone |
| `message` | `{ text, from, alias, timestamp }` | Incoming message |
| `partner_typing` | `{ isTyping }` | Partner typing state |
| `chat_ended` | `{ reason }` | Chat was ended |
| `joined_group` | `{ recentMessages, onlineInGroup }` | Entered group lobby |
| `group_user_count` | `number` | Group room headcount |
| `online_count` | `number` | Total users online |
| `left_chat` | — | Confirmed leave |
| `report_received` | — | Report acknowledged |

---

## License

MIT
