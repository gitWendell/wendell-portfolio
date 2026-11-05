# Wendell portfolio

This app uses Node.js and Express. The public homepage works without an AI provider. The optional AI guide uses the existing invite and owner access checks.

## Run locally

```sh
npm ci
PORT=3020 USE_OLLAMA=false KEEP_ALIVE=false npm start
```

Open http://localhost:3020. No API key is needed to review the homepage or invite screen. Configure an AI provider and an owner passcode in the server environment only when testing the guide with access.

```sh
npm test
```

The tests start an isolated local server and check the public homepage, static assets, script syntax, and access restrictions. They do not make AI calls.

## Files

- `public/index.html`, `home.css`, `home.js`: public professional overview, services, selected work, contact links, and invite-link forwarding.
- `public/explore.html`: existing terminal-style AI guide with its invite screen.
- `public/social-card.png`: local image for social sharing previews.
- `server.js`: static hosting, AI proxy, existing access checks, and invite management.
- `prompt.txt`: professional background, services, remote-work preferences, and truthful boundaries for learning tools.

Old links such as `/?ref=ABCD` still open the homepage and offer a link to the guide carrying that invite code. New guide invites point directly to `/explore.html?ref=ABCD`.

## Update the existing host

Keep the existing domain, hosting service, and production secrets. This change does not need a new host or a new paid service.

1. Push the reviewed changes to the repository branch connected to the current host.
2. Use `npm ci` as the install/build command and `npm start` as the start command. The host supplies `PORT`.
3. Keep the existing `OWNER_PASSCODE`, provider configuration, and persistent `tokens.json` / `visitors.json` data. Do not put their values in Git.
4. Open the homepage and confirm the introduction, services, work examples, and email links.
5. Open `/explore.html` and confirm it still asks for an invite passcode.

The public homepage does not grant access to `/api/chat` or owner invite tools. Existing AI settings support Ollama, Gemini via `GEMINI_API_KEY`, and an optional OpenAI-compatible fallback. Keep provider keys on the server. `USE_OLLAMA=false` skips the Ollama call during chat when the host does not run it.

The server uses Node's built-in `fetch`; it no longer relies on `node-fetch` being installed indirectly by another dependency.
