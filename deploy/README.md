# Deploying eCash Meter to a single VPS

Everything runs on one small box: `bitcoind`, the indexer, the Next.js app, and
Caddy for TLS. Target domain: **example.com**.

## Why a VPS, and why not BitWindow

The app makes exactly four JSON-RPC calls — `getblockchaininfo`, `getblockcount`,
`getblockhash`, `getblock` (verbosity 3) — all stock Bitcoin Core. **BitWindow,
`bip300301-enforcer` and `orchestratord` are not needed on the server.** The
enforcer's only contribution was the 8-slot sidechain registry, which is
hardcoded in `lib/config.ts`.

A VPS is still required because there is no public L2L-Signet RPC endpoint, and
because the store is a local SQLite file that `lib/store.ts` opens directly — so
the web process must share a filesystem with it.

```
 bitcoind (L2L-Signet, RPC on 127.0.0.1:38332)
     │  getblock v3
     ▼
 ecashmeter-index.timer → npm run index → /var/lib/ecashmeter/ecash-meter.sqlite
                                                    │  read-only
                                                    ▼
                                          ecashmeter.service (next start, :3000)
                                                    │
                                                    ▼
                                          Caddy :443 → example.com
```

The app never contacts the node, so the site keeps serving the last indexed data
even while bitcoind is down or resyncing.

## Forking this for your own deployment

Nothing in this repository is specific to one machine — there are no IP addresses,
credentials or keys anywhere in it, and every secret is generated on the server
during step 4. To run it under your own domain, change these and nothing else:

1. **Your domain** — `deploy/Caddyfile` (the two site blocks) and the
   `example.com` references in this file. That is the only place the domain
   appears; the app itself never hardcodes a hostname.
2. **The clone URL** in step 6, and optionally the `Documentation=` lines in
   `deploy/systemd/*.service`, to point at your fork.
3. **Nothing else for signet.** The RPC password, `rpcauth` hash and TLS
   certificate are all generated fresh on your box.

Two things are *network*-specific rather than deployment-specific, and matter if
you target something other than L2L-Signet:

- `deploy/bitcoin.conf` — `signetchallenge` and `addnode` define which signet you
  join. A different challenge is a different network, and the indexer will refuse
  to mix them (it stamps the genesis hash into `meta`).
- `lib/config.ts` — the 8-slot drivechain registry was read from L2L-Signet's
  enforcer. Another network's slate may differ; long term this should be queried
  from `ValidatorService.GetSidechains` rather than hardcoded.

The service account names (`bitcoin`, `ecashmeter`) and paths
(`/srv/ecashmeter`, `/var/lib/ecashmeter`) are arbitrary — rename them if you
like, but change them consistently across `deploy/systemd/*` and the env files.

## Sizing

**Hetzner CPX22** (2 vCPU / 4 GB / 80 GB, ~€19.49/mo), Ubuntu 26.04 — verified
on exactly that combination. Cost-optimized CX23 (~€5.49) is the better buy if it
is in stock; it was sold out in every EU location at deploy time. Ubuntu 26.04 is
fine despite being new: NodeSource serves `nodistro` and Caddy's repo serves
`any-version`, so neither depends on the release codename. The L2L-Signet
chain is ~26 MB — Next.js is the largest thing on the box, and the 4 GB is for
the build, not the node. Price the EU regions; Hetzner's 2026 increases hit US
locations hardest.

For the August mainnet switch, rescale within the same line (CPX32: 4 vCPU / 8 GB /
160 GB) so it stays an in-place resize — crossing to a different CPU family does
not. CPU/RAM-only rescales are reversible; growing the disk is one-way.

**Verified end to end on 2026-07-30:** CPX22 / Ubuntu 26.04 / Nuremberg, Node
24.18.1 (`node:sqlite` unflagged), Bitcoin Core v30.2.0, Caddy v2.11.4. Full
backfill indexed blocks 0–7311 (42,752 commitments, 8.3 MB store) in 6.1s with a
648 MB peak. Survives reboot with all four units `enabled`.

---

## 1. DNS at Namecheap

Domain List → **example.com** → Manage → Advanced DNS. **Delete the default
parking-page records first**, then add:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | `@` | your server IPv4 | Automatic |
| AAAA | `@` | your server IPv6 | Automatic |
| CNAME | `www` | `example.com.` | Automatic |

Do this early — Caddy cannot issue a certificate until the A record resolves.
Check with `dig +short example.com` before step 8.

## 2. Base setup

```bash
ssh root@YOUR_IP

apt update && apt upgrade -y
apt install -y ufw git curl ca-certificates

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Port 38333 stays closed. bitcoind only needs *outbound* access to reach the
signet seed peer.

```bash
# Service accounts, both without login shells.
adduser --system --group --home /var/lib/bitcoind bitcoin
adduser --system --group --home /srv/ecashmeter ecashmeter

mkdir -p /var/lib/bitcoind /etc/bitcoin /var/lib/ecashmeter /etc/ecashmeter
chown bitcoin:bitcoin /var/lib/bitcoind
chown ecashmeter:ecashmeter /var/lib/ecashmeter
chmod 750 /var/lib/ecashmeter
```

Add swap — `next build` can OOM on 4 GB, especially while bitcoind is syncing:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 3. Install Bitcoin Core 30.2

```bash
cd /tmp
curl -O https://bitcoincore.org/bin/bitcoin-core-30.2/bitcoin-30.2-x86_64-linux-gnu.tar.gz

# Verify before extracting. This checksum is from bitcoincore.org/bin/bitcoin-core-30.2/SHA256SUMS
echo "6aa7bb4feb699c4c6262dd23e4004191f6df7f373b5d5978b5bcdd4bb72f75d8  bitcoin-30.2-x86_64-linux-gnu.tar.gz" | sha256sum -c -
# must print: bitcoin-30.2-x86_64-linux-gnu.tar.gz: OK

tar xzf bitcoin-30.2-x86_64-linux-gnu.tar.gz
install -m 0755 bitcoin-30.2/bin/bitcoind bitcoin-30.2/bin/bitcoin-cli /usr/local/bin/
bitcoind --version   # expect v30.2.0
```

## 4. Node config and RPC credentials

Copy `deploy/bitcoin.conf` to `/etc/bitcoin/bitcoin.conf`, then generate real
credentials. The binary tarball does not ship Core's `rpcauth.py`, so this
reproduces it exactly (random salt, HMAC-SHA256):

```bash
python3 - <<'EOF'
import os, hmac, hashlib, secrets
user = "ecashmeter"
pw   = secrets.token_urlsafe(32)
salt = os.urandom(16).hex()
h    = hmac.new(salt.encode(), pw.encode(), hashlib.sha256).hexdigest()
print(f"rpcauth={user}:{salt}${h}")
print(f"ECASH_RPC_PASS={pw}")
EOF
```

Put the `rpcauth=` line in `/etc/bitcoin/bitcoin.conf` (replacing
`REPLACE_ME`) and the password in `/etc/ecashmeter/indexer.env` at step 6.
**Never** leave the `user`/`password` defaults from local development —
`lib/rpc.ts` warns about them for good reason.

```bash
chown root:bitcoin /etc/bitcoin/bitcoin.conf && chmod 640 /etc/bitcoin/bitcoin.conf
```

## 5. Start the node

```bash
cp deploy/systemd/bitcoind.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bitcoind

# Sync is minutes, not hours — the chain is ~26 MB.
watch -n5 'bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf -datadir=/var/lib/bitcoind getblockchaininfo | grep -E "chain|blocks|headers|initialblockdownload"'
```

Wait for `initialblockdownload: false`. If `blocks` stays at 0, the seed peer is
unreachable — check `getpeerinfo` and outbound connectivity to
`172.105.148.135:38333`.

Confirm the network identity matches what the store expects:

```bash
bitcoin-cli -conf=/etc/bitcoin/bitcoin.conf -datadir=/var/lib/bitcoind getblockhash 0
# expect 00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6
```

The indexer stamps this genesis hash into `meta` and refuses to mix networks, so
a mismatch here means the `signetchallenge` is wrong.

## 6. Deploy the app

```bash
# Clone AS ecashmeter. Cloning as root then chowning leaves git refusing to
# operate ("detected dubious ownership"), which breaks later `git pull`s.
mkdir -p /srv/ecashmeter && chown ecashmeter:ecashmeter /srv/ecashmeter
sudo -u ecashmeter git clone https://github.com/vake21/ecash-meter.git /srv/ecashmeter

# Node must be new enough to ship node:sqlite unflagged.
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -e "require('node:sqlite'); console.log('node:sqlite OK')"
```

If that last line throws, the Node version is too old — install 26.x instead.
There is no fallback: the store has no external database driver by design.

```bash
cd /srv/ecashmeter

# --include=dev is REQUIRED. The indexer runs through tsx, and next build needs
# typescript and tailwind — all devDependencies. `npm ci` would skip them if
# NODE_ENV=production is set in the shell.
sudo -u ecashmeter npm ci --include=dev
sudo -u ecashmeter npm run build
```

Install the env files:

```bash
cp deploy/site.env.example    /etc/ecashmeter/site.env
cp deploy/indexer.env.example /etc/ecashmeter/indexer.env
# edit indexer.env: set ECASH_RPC_PASS from step 4
chown root:ecashmeter /etc/ecashmeter/*.env && chmod 640 /etc/ecashmeter/*.env
```

## 7. First index, then the services

Install the units first, then run the backfill through the oneshot unit. Do NOT
use `env $(grep … | xargs)` — the generated RPC password is random and can contain
characters that word-splitting mangles, and the unit already reads the
EnvironmentFile correctly:

```bash
cp deploy/systemd/ecashmeter.service       /etc/systemd/system/
cp deploy/systemd/ecashmeter-index.service /etc/systemd/system/
cp deploy/systemd/ecashmeter-index.timer   /etc/systemd/system/
systemctl daemon-reload

systemctl start ecashmeter-index.service
journalctl -u ecashmeter-index -n 5 --no-pager -o cat
```

Expect something like `inserted 7300 block(s), N commitment(s)`. If it reports
only ~432 blocks, `ECASH_BACKFILL_BLOCKS` was not picked up — the 30-day chart
will look nearly empty.

```bash
cp deploy/systemd/ecashmeter.service       /etc/systemd/system/
cp deploy/systemd/ecashmeter-index.service /etc/systemd/system/
cp deploy/systemd/ecashmeter-index.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ecashmeter.service
systemctl enable --now ecashmeter-index.timer   # the TIMER, not the .service

curl -s localhost:3000/api/health | python3 -m json.tool   # expect "status": "ok"
```

## 8. TLS and the public site

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

cp deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile

# MUST come AFTER validate. Running `caddy validate` as root instantiates the file
# logger, creating /var/log/caddy/ecashmeter.log owned by root:root mode 600 — and
# the service runs as `caddy`, so it then fails to start with "permission denied"
# on that file. Chown the whole directory afterwards.
chown -R caddy:caddy /var/log/caddy

systemctl restart caddy
```

Certificate issuance takes a few seconds once DNS resolves. Then:

```bash
curl -sI https://example.com | head -1              # 200
curl -s https://example.com/api/health | python3 -m json.tool
curl -sI https://www.example.com | head -2          # 301 to apex
curl -sI --max-time 5 http://YOUR_IP:3000/            # must FAIL (loopback only)
```

---

## Operations

```bash
# logs
journalctl -u bitcoind -f
journalctl -u ecashmeter -f
journalctl -u ecashmeter-index --since "1 hour ago"
systemctl list-timers ecashmeter-index.timer

# is the data fresh? 503 = stale, empty, or parser mismatch
curl -s https://example.com/api/health | python3 -m json.tool
```

Point an uptime monitor at `/api/health` and alert on non-200. It returns 503
when the newest indexed block is older than `STALE_AFTER_SEC` (30 min), which
catches a wedged indexer — a plain homepage check would not, because the page
renders happily from stale data.

**Redeploy:**

```bash
cd /srv/ecashmeter
sudo -u ecashmeter git pull
sudo -u ecashmeter npm ci --include=dev
sudo -u ecashmeter npm run build
systemctl restart ecashmeter
```

The store lives in `/var/lib/ecashmeter`, outside the app directory, so a
redeploy never touches it.

**Rebuild the store** (only needed when `PARSER_VERSION` in `lib/bmm.ts`
changes — the indexer refuses to append across versions and tells you so):

```bash
systemctl stop ecashmeter-index.timer
rm /var/lib/ecashmeter/ecash-meter.sqlite*
systemctl start ecashmeter-index.service   # reads the EnvironmentFile properly
systemctl start ecashmeter-index.timer
```

The DB is a disposable derived cache. Backing it up is optional; it rebuilds from
the node in under a second on signet.

---

## August 2026: switching to mainnet

Do not do this piecemeal — it is a network change, and the indexer will
(correctly) refuse to mix networks by genesis hash.

1. **Resolve the open question first:** does eCash mainnet inherit Bitcoin's full
   ~700 GB history, or start from a UTXO snapshot? A 1:1 split implies the former,
   which means resizing to CPX31 and setting a `prune` value. Confirm before
   provisioning, because it decides the disk.
2. Rescale the Hetzner instance (CPU/RAM in place; growing the disk is one-way).
3. Replace `[signet]` in `/etc/bitcoin/bitcoin.conf` with mainnet settings — drop
   `signetchallenge`, `signetblocktime`, `acceptnonstdtxn` and the signet
   `addnode`. Set `chain=main`.
4. Wipe the datadir and resync, then **delete the store** — its stamped
   `genesis_hash` is signet's, and the indexer will refuse to append to it.
5. Re-check `lib/config.ts`: the 8-slot registry is hardcoded from L2L-Signet.
   The mainnet slate may differ, and long term this should be read from the
   enforcer's `ValidatorService.GetSidechains` rather than baked in.
6. Expect `metric` to flip from `bmm` to `fees` once real bidding starts —
   `lib/aggregate.ts` switches on any non-zero attributed fee, which is
   intentional so the first real bids are visible immediately.

If pruning: `prune` caps how far back the store can ever be rebuilt, because
verbosity-3 prevouts are unavailable for pruned blocks. Keep the horizon well
past `WINDOW_DAYS` (30) — `prune=100000` is roughly 15 months.
