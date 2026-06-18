# 🚀 Wendell Portfolio — Deploy Guide

Your portfolio is a Node.js app with two parts:

- **`server.js`** — Express backend that holds your API key and proxies requests to Anthropic
- **`public/index.html`** — The terminal UI that talks to _your_ server (not Anthropic directly)

---

## Step 1 — Get Your Anthropic API Key

1. Go to → https://console.anthropic.com
2. Sign up / log in
3. Click **API Keys** in the left sidebar
4. Click **Create Key** → copy it (starts with `sk-ant-...`)

> ⚠️ Keep this secret. Never paste it into public code or commit it to GitHub.

---

## Step 2 — Test Locally First

```bash
# 1. Enter the project folder
cd wendell-portfolio

# 2. Install dependencies
npm install

# 3. Create your .env file from the example
cp .env.example .env

# 4. Open .env and paste your real API key
#    ANTHROPIC_API_KEY=sk-ant-YOUR-REAL-KEY-HERE

# 5. Start the server
npm start

# 6. Open your browser at:
#    http://localhost:3000
```

If it works locally — the chat responds — you're ready to deploy.

---

## Option A — Deploy to Render (Recommended, Free Tier Available)

### 1. Push to GitHub

```bash
# Inside wendell-portfolio/
git init
git add .
git commit -m "initial portfolio"

# Create a repo on github.com then:
git remote add origin https://github.com/YOUR_USERNAME/wendell-portfolio.git
git push -u origin main
```

### 2. Create a Web Service on Render

1. Go to → https://render.com and sign up (free)
2. Click **New → Web Service**
3. Connect your GitHub account → select `wendell-portfolio`
4. Fill in these settings:

| Setting           | Value         |
| ----------------- | ------------- |
| **Name**          | ` s`          |
| **Environment**   | `Node`        |
| **Build Command** | `npm install` |
| **Start Command** | `npm start`   |
| **Instance Type** | Free          |

5. Scroll down to **Environment Variables** → click **Add Variable**:
   - Key: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-YOUR-REAL-KEY-HERE`

6. Click **Create Web Service**

Render will build and deploy. In ~2 minutes you'll get a live URL like:
`https://wendell-portfolio.onrender.com`

> 💡 **Free tier note:** Render free services sleep after 15 min of inactivity. The first visit after sleep takes ~30 seconds to wake up. Upgrade to Starter ($7/mo) for always-on.

---

## Option B — Deploy to Railway

1. Go to → https://railway.app and sign up
2. Click **New Project → Deploy from GitHub repo**
3. Select `wendell-portfolio`
4. Railway auto-detects Node.js — no config needed
5. Go to **Variables** tab → add:
   - `ANTHROPIC_API_KEY` = `sk-ant-YOUR-KEY`
6. Click **Deploy** → done

Railway gives you a URL like `https://wendell-portfolio.up.railway.app`

> Railway has a $5/mo free credit — plenty for a portfolio site.

---

## Option C — Deploy to Vercel (Requires minor refactor)

Vercel works best with serverless functions. The current setup is a standard Express server, so Render or Railway are easier. If you want Vercel specifically, ask Wendell to refactor to `/api/chat.js` serverless style.

---

## Custom Domain (Optional)

Once deployed on Render or Railway:

1. Buy a domain (Namecheap, GoDaddy, etc.) — e.g. `wendellcasul.dev`
2. In Render: **Settings → Custom Domains → Add Domain**
3. Point your domain's DNS to Render's provided CNAME
4. Done — your portfolio lives at `https://wendellcasul.dev`

---

## Project Structure

```
wendell-portfolio/
├── server.js          ← Node/Express backend (holds API key)
├── package.json       ← Dependencies + start script
├── .env.example       ← Template for your secrets
├── .env               ← Your real secrets (never commit this!)
├── .gitignore         ← Ignores node_modules and .env
└── public/
    └── index.html     ← Your portfolio UI
```

---

## How It Works (Architecture)

```
Visitor's Browser
      │
      │  POST /api/chat   (no API key exposed)
      ▼
Your Server (Render/Railway)
      │
      │  POST api.anthropic.com/v1/messages
      │  Authorization: Bearer sk-ant-...  ← key stays here
      ▼
Anthropic Claude API
      │
      └─ Response flows back to browser
```

Your API key **never touches the browser**. Visitors can't see it in DevTools or page source.

---

## Estimated Monthly Cost

| Service        | Cost                         |
| -------------- | ---------------------------- |
| Render Free    | $0 (sleeps after inactivity) |
| Render Starter | ~$7/mo (always-on)           |
| Railway        | ~$0–5/mo (free credit)       |
| Anthropic API  | ~$0.01–0.10 per conversation |

A portfolio with moderate traffic costs practically nothing.
