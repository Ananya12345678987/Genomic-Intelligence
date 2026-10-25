# Deploying (single web service, e.g. Render)

**Status.** The single-origin serving code is tested locally (production mode, real browser, mocked-free server). The Render steps below have **not** been run end to end by the author, and Render's dashboard wording can change. Treat them as a checklist, and check each setting against Render's current documentation.

## Why one service

The login session is an HttpOnly cookie with `SameSite=Lax`. If the website and the API are two separate services (for example `app.onrender.com` and `api.onrender.com`), the browser treats them as different sites (`onrender.com` is on the Public Suffix List). It then refuses to store or send the cookie, so you appear to log in but every later request returns `401 Authentication required`. Serving the website and the API from the same address avoids this, and removes the need for CORS.

When `NODE_ENV=production` the server automatically serves `client/dist` next to the API. You can also point `CLIENT_DIST` at another build folder.

## Steps

1. **Database.** Create a MongoDB Atlas cluster and a database user. Under Network Access, Render's outbound addresses are not fixed on the free plan, so you may have to allow `0.0.0.0/0`. If you do, use a long random database password. Do not store real patient data.
2. **Create one Web Service** from your repository (root of the repo, not `server/`).
   - Build command: `npm install --include=dev && npm run build`
   - Start command: `npm start`
   - Environment variable `NODE_VERSION` = `22`
3. **Environment variables** (Environment tab):

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `MONGODB_URI` | your Atlas connection string, with the database name before the `?` |
   | `SESSION_SECRET` | 64 random hex characters. Set it once and do not change it, or everyone is logged out. |
   | `CLIENT_URL` | the service's own public URL, e.g. `https://your-service.onrender.com` |
   | `AI_PROVIDER` | `none` (or `anthropic` with `AI_API_KEY` and `AI_MODEL`) |

   Do **not** set `VITE_API_BASE_URL`. The client must call the relative path `/api`.
4. Deploy, then open `https://your-service.onrender.com/api/health`. You should see `"database":"connected"`.
5. Open the site root, register an account, and search `BRAF p.Val600Glu`.

## If you see `401 Authentication required` after logging in

1. Reload the page. If you are sent back to the login screen, the session cookie is not being stored or sent.
2. In DevTools, Network tab, click an `/api/...` request and look at **Request URL**. If its host differs from the page's address, the API is a separate service. Move to the single-service setup above, or add a Render rewrite from `/api/*` on the website to the API so the browser only ever sees one address.
3. Check that `SESSION_SECRET` is identical across restarts and that `NODE_ENV=production` is set (production sets `Secure` cookies and trusts one proxy hop).
4. The free plan sleeps after inactivity; the first request can take about a minute.

## Limits that matter in production

The uploaded-report store and the public-source cache are in memory and per instance. Run a single instance; do not scale to several without moving them to a shared store. See the README for the full list of known limitations and the checklist before any clinical or institutional use.
