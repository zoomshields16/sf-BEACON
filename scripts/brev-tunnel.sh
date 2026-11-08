#!/bin/sh
# Private, encrypted link to Nemotron on the Brev H100: localhost:8001 → sf-beacon:8000. Reconnects if it drops.
# No public port needed. Requires `brev login` + SSH access to the instance.  Usage: npm run brev:tunnel
HOST=${BREV_INSTANCE:-sf-beacon}
while true; do
  echo "[brev-tunnel] connecting localhost:8001 → $HOST:8000"
  ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
      -L 8001:localhost:8000 "$HOST"
  echo "[brev-tunnel] link dropped — retrying in 3 s (requests use the hosted fallback meanwhile)"
  sleep 3
done
