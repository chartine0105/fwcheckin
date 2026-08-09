# fwcheckin

Daily auto check-in for [废文网 / SosadFun](https://xn--pxtr7m.net).

Zero dependencies (Node 18+ native `fetch`). Runs on QingLong, plain Node, or GitHub Actions.

## How it works

Check-in is the web route `GET /qiandao`. The script hits it, then compares the total check-in count on the user center page before and after to report the result — no fragile HTML/text parsing.

## Environment variable

| Name   | Value |
|--------|-------|
| `fwxs` | Full cookie after logging in |

Multiple accounts: join with `@`, optional `#label` per account.

```
cookieA#alice@cookieB#bob
```

Get the cookie: log in, open DevTools → Network → refresh → copy the `Cookie:` request header.

## Usage

**QingLong** — add env var `fwxs`, drop in `fwxs_checkin.js`, schedule `task fwxs_checkin.js` at `5 8 * * *`.

**Node**

```bash
fwxs="your-cookie" node fwxs_checkin.js
```

**GitHub Actions** — add a repository secret named `FWXS`. The bundled workflow runs daily at 00:05 UTC (08:05 Beijing) and can be triggered manually. Never commit the cookie to the repository.

## License

MIT
