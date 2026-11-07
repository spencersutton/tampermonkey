"""One upstream Centrifugo connection; browsers receive invalidations, never raw lot updates."""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from datetime import datetime
from typing import Any

import websocket

from .gateway import Gateway
from .site import SITE, ApiError, normalize_standing
from .store import Store

log = logging.getLogger(__name__)
URL = "wss://ws.triangleliquidators.com/connection/websocket"


class Live:
    def __init__(self, store: Store, gateway: Gateway) -> None:
        self.store = store
        self.gateway = gateway
        self.state = "off"
        self.error: str | None = None
        self._tabs: dict[str, tuple[float, set[int]]] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._catchups: queue.Queue[int] = queue.Queue(maxsize=2000)
        self._pending: set[int] = set()
        self._generation = 0

    def start(self) -> None:
        threading.Thread(target=self._run, name="live-catalog", daemon=True).start()
        threading.Thread(target=self._catch_up, name="live-catchup", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def reconnect(self) -> None:
        self.gateway.clear()
        self._generation += 1
        self._wake.set()

    def watch(self, tab: str, ids: list[int], active: bool) -> None:
        if not tab or len(tab) > 100 or len(ids) > 2000 or any(type(i) is not int or i <= 0 for i in ids):
            raise ValueError("Invalid live subscription")
        with self._lock:
            if active:
                self._tabs[tab] = (time.monotonic(), set(ids))
            else:
                self._tabs.pop(tab, None)
        self._wake.set()

    def wanted(self) -> set[int]:
        with self._lock:
            cutoff = time.monotonic() - 65
            self._tabs = {key: value for key, value in self._tabs.items() if value[0] > cutoff}
            return set().union(*(value[1] for value in self._tabs.values()))

    def _account_wanted(self) -> bool:
        with self._lock:
            return self.gateway.session.logged_in and bool(self._tabs)

    def publication(self, channel: str, data: dict[str, Any]) -> None:
        if channel.startswith("lot:"):
            lot_id = data.get("id")
            if type(lot_id) is not int:
                return
            fields = {
                "current_price": "currentPrice",
                "bid_count": "bidCount",
                "next_min_increment": "nextMinIncrement",
                "status": "status",
                "version": "version",
            }
            patch = {dest: data[key] for key, dest in fields.items() if data.get(key) is not None}
            if data.get("ends_at"):
                patch["endsAt"] = round(datetime.fromisoformat(data["ends_at"]).timestamp() * 1000)
            self.store.merge_lot(lot_id, patch)
        elif channel.startswith("user:"):
            lot_id = int(data.get("lot_id") or 0)
            lot = self.store.lot(lot_id)
            if not lot:
                return
            standing = normalize_standing(data.get("relationship"))
            if standing is None and data.get("type") in ("winning", "outbid"):
                standing = {"isLeading": data["type"] == "winning", "yourMaxBid": (lot.get("yourStanding") or {}).get("yourMaxBid")}
            if standing:
                self.store.merge_lot(lot_id, {"yourStanding": standing, "hasBid": True}, account=True)
                self._queue(lot_id)

    def _queue(self, lot_id: int) -> None:
        with self._lock:
            if lot_id in self._pending:
                return
            try:
                self._catchups.put_nowait(lot_id)
            except queue.Full:
                log.warning("Live catch-up queue full; catalog refresh will recover lot %s", lot_id)
                return
            self._pending.add(lot_id)

    def _catch_up(self) -> None:
        while not self._stop.is_set():
            try:
                lot_id = self._catchups.get(timeout=1)
            except queue.Empty:
                continue
            try:
                if self.store.lot(lot_id):
                    self.gateway.detail(lot_id, fresh=True)
            except ApiError, ValueError:
                log.warning("Could not catch up lot %s", lot_id, exc_info=True)
            finally:
                with self._lock:
                    self._pending.discard(lot_id)

    def _run(self) -> None:
        delay = 1
        while not self._stop.is_set():
            if not self.wanted() and not self._account_wanted():
                self.state = "off"
                self._wake.wait(1)
                self._wake.clear()
                continue
            try:
                self._connect()
                delay = 1
            except (websocket.WebSocketException, OSError, ApiError, ValueError, KeyError, TypeError) as error:
                self.state, self.error = "disconnected", str(error)
                log.warning("Live updates disconnected: %s", error)
                self._stop.wait(delay)
                delay = min(delay * 2, 30)

    def _connect(self) -> None:
        self.state, self.error = "connecting", None
        generation = self._generation
        token = self.gateway.request("/v1/auth/ws-token/")["token"] if self.gateway.session.logged_in else None
        sock = websocket.create_connection(URL, origin=SITE, timeout=1)
        commands: dict[int, tuple[str, int | None, float]] = {}
        command_id = 0

        def send(kind: str, value: dict[str, Any], lot_id: int | None = None) -> None:
            nonlocal command_id
            command_id += 1
            commands[command_id] = (kind, lot_id, time.monotonic())
            sock.send(json.dumps({"id": command_id, kind: value}))

        subscribed: set[int] = set()
        renew_at = float("inf")
        last_frame = time.monotonic()
        ping_interval = 25
        pong = False
        try:
            send("connect", {"token": token} if token else {})
            connected = False
            while not self._stop.is_set() and generation == self._generation and time.monotonic() < renew_at:
                now = time.monotonic()
                if now - last_frame > ping_interval + 10 or any(now - command[2] > 10 for command in commands.values()):
                    raise TimeoutError("Live connection stopped responding")
                wanted = self.wanted()
                if not wanted and not self._account_wanted():
                    return
                if connected:
                    for lot_id in wanted - subscribed:
                        send("subscribe", {"channel": f"lot:{lot_id}"}, lot_id)
                    for lot_id in subscribed - wanted:
                        send("unsubscribe", {"channel": f"lot:{lot_id}"}, lot_id)
                    subscribed = wanted
                try:
                    raw = sock.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                if not raw:
                    raise OSError("Live connection closed")
                last_frame = time.monotonic()
                for line in raw.splitlines():
                    message = json.loads(line)
                    if not message:
                        if pong:
                            sock.send("{}")
                        continue
                    if "error" in message:
                        raise ValueError(f"Live subscription failed: {message['error']}")
                    if "id" in message:
                        kind, lot_id, _ = commands.pop(message["id"], ("", None, 0))
                        result = message.get(kind) or {}
                        if kind == "connect":
                            connected = True
                            self.state = "connected"
                            ping_interval = result.get("ping") or 25
                            pong = bool(result.get("pong"))
                            if result.get("expires"):
                                renew_at = time.monotonic() + max(1, result["ttl"] - 30)
                        elif kind == "subscribe" and lot_id is not None:
                            lot = self.store.lot(lot_id)
                            if lot and result.get("offset", 0) > (lot.get("version") or 0):
                                self._queue(lot_id)
                    push = message.get("push") or {}
                    if "pub" in push:
                        self.publication(push.get("channel", ""), push["pub"].get("data") or {})
                    if "disconnect" in push:
                        raise OSError(str(push["disconnect"]))
        finally:
            sock.close()
