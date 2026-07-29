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

## Sizing

**Hetzner CX22** (2 vCPU / 4 GB / 40 GB, ~€4/mo), Ubuntu 24.04. The L2L-Signet
chain is ~26 MB — Next.js is the largest thing on the box, and the 4 GB is for
the build, not the node. Price the EU regions; Hetzner's 2026 increases hit US
locations hardest.

Rescale to CPX31 before the August mainnet switch (see the last section).

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
git clone https://github.com/vake21/ecash-meter.git /srv/ecashmeter
chown -R ecashmeter:ecashmeter /srv/ecashmeter

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

Run the backfill by hand first so you can see it work:

```bash
cd /srv/ecashmeter
sudo -u ecashmeter env $(grep -v '^#' /etc/ecashmeter/indexer.env | xargs) npm run index
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
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
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
cd /srv/ecashmeter && sudo -u ecashmeter env $(grep -v '^#' /etc/ecashmeter/indexer.env | xargs) npm run index
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
