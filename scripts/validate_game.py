#!/usr/bin/env python3

import asyncio
import argparse
import base64
import json
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, "/tmp/codex-py")

import websockets


ROOT = pathlib.Path(__file__).resolve().parents[1]
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUTPUT_DIR = pathlib.Path("/tmp/lead-belay-validation")


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class CdpClient:
    def __init__(self, websocket):
        self.websocket = websocket
        self.message_id = 0

    async def send(self, method, params=None):
        self.message_id += 1
        payload = {
            "id": self.message_id,
            "method": method,
            "params": params or {},
        }
        await self.websocket.send(json.dumps(payload))

        while True:
            response = json.loads(await self.websocket.recv())
            if response.get("id") == self.message_id:
                if "error" in response:
                    raise RuntimeError(f"{method} failed: {response['error']}")
                return response["result"]

    async def evaluate(self, expression):
        result = await self.send(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": True,
            },
        )
        evaluation = result["result"]
        if evaluation.get("subtype") == "error":
            raise RuntimeError(evaluation.get("description", "Runtime error"))
        return evaluation.get("value")


async def wait_for_debug_port(port):
    version_url = f"http://127.0.0.1:{port}/json/version"
    deadline = time.time() + 10
    while time.time() < deadline:
      try:
          with urllib.request.urlopen(version_url, timeout=1) as response:
              return json.loads(response.read().decode("utf-8"))
      except Exception:
          await asyncio.sleep(0.1)
    raise RuntimeError("Chrome remote debugging port did not come up")


async def wait_for_page(port):
    pages_url = f"http://127.0.0.1:{port}/json/list"
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(pages_url, timeout=1) as response:
                pages = json.loads(response.read().decode("utf-8"))
            for page in pages:
                if page.get("type") == "page":
                    return page
        except Exception:
            pass
        await asyncio.sleep(0.1)
    raise RuntimeError("No Chrome page target was found")


async def wait_until_ready(client):
    deadline = time.time() + 10
    while time.time() < deadline:
        state = await client.evaluate("document.readyState")
        has_api = await client.evaluate("Boolean(window.__leadBelayApi)")
        if state == "complete" and has_api:
            return
        await asyncio.sleep(0.05)
    raise RuntimeError("Game API did not become ready")


async def clear_inputs(client):
    await client.evaluate(
        "window.__leadBelayApi.input({moveToward:false,moveAway:false,ropeOut:false,ropeIn:false})"
    )


async def capture_screenshot(client, name):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = await client.send("Page.captureScreenshot", {"format": "png"})
    image = base64.b64decode(payload["data"])
    path = OUTPUT_DIR / name
    path.write_bytes(image)
    return path


async def run_seed(client, server_port, seed):
    url = f"http://127.0.0.1:{server_port}/?autostart=1&seed={seed}"
    await client.send("Page.navigate", {"url": url})
    await wait_until_ready(client)

    last_inputs = {}
    jumped_this_fall = False
    last_spot_action = 0
    last_stable = None
    started = time.time()

    while time.time() - started < 140:
        state = await client.evaluate("window.__leadBelayApi.state()")
        desired = {
            "moveToward": False,
            "moveAway": False,
            "ropeOut": False,
            "ropeIn": False,
        }

        if state["stage"] in {"won", "lost"}:
            await clear_inputs(client)
            return state

        fall = state["fall"]
        if fall:
            if fall["type"] == "spot":
                diff = state["climber"]["x"] - state["belayerX"]
                if diff < -0.08:
                    desired["moveToward"] = True
                elif diff > 0.08:
                    desired["moveAway"] = True

                if abs(diff) <= 0.38 and fall["elapsed"] <= 0.92 and time.time() - last_spot_action > 0.15:
                    await client.evaluate("window.__leadBelayApi.action()")
                    last_spot_action = time.time()
            else:
                stable = last_stable or state
                window = stable["slackWindow"]
                mid = window["min"] + (window["max"] - window["min"]) * 0.5

                if fall["catchTime"] is None:
                    if stable["subphase"] == "clipping" and stable["clippedCount"] <= 4:
                        desired["moveToward"] = True
                    elif stable["slack"] < mid - 0.18:
                        desired["moveToward"] = True
                    elif stable["slack"] > mid + 0.18:
                        desired["moveAway"] = True

                should_jump = (
                    (
                        stable["subphase"] == "clipping"
                        and stable["clippedCount"] <= 4
                        and stable["slack"] < window["min"] + 0.12
                    )
                    or (
                        (
                            stable["clippedCount"] >= 3
                            and stable["slack"] < window["min"] + 0.18
                        )
                    )
                    or (
                        stable["clippedCount"] >= 5
                        and (
                            stable["subphase"] == "clipping"
                            or stable["slack"] < window["max"] - 0.22
                        )
                    )
                )

                if (
                    should_jump
                    and not fall["jumpApplied"]
                    and not jumped_this_fall
                    and (
                        fall["catchTime"] is not None
                        or fall["elapsed"] >= 0.82
                    )
                ):
                    await client.evaluate("window.__leadBelayApi.action()")
                    jumped_this_fall = True
        else:
            jumped_this_fall = False
            last_stable = state

            if state["phase"] == "preclip":
                diff = state["climber"]["x"] - state["belayerX"]
                if diff < -0.08:
                    desired["moveToward"] = True
                elif diff > 0.08:
                    desired["moveAway"] = True
            else:
                window = state["slackWindow"]
                if state["subphase"] == "clipping":
                    ratio = 0.72 if state["clippedCount"] <= 4 else 0.55
                else:
                    ratio = 0.24 if state["clippedCount"] <= 2 else (0.18 if state["clippedCount"] <= 4 else 0.42)
                target_slack = window["min"] + (window["max"] - window["min"]) * ratio
                error = target_slack - state["slack"]
                low_guard = window["min"] + (0.03 if state["clippedCount"] <= 2 else 0.04)
                high_guard = window["max"] - (0.03 if state["subphase"] == "clipping" else 0.06)

                if state["slack"] < low_guard:
                    desired["ropeOut"] = True
                elif state["slack"] > high_guard:
                    desired["ropeIn"] = True
                elif error > 0.05:
                    desired["ropeOut"] = True
                elif error < -0.05:
                    desired["ropeIn"] = True

                if state["slack"] < low_guard - 0.06 or error > 0.18:
                    desired["moveToward"] = True
                elif state["slack"] > high_guard + 0.06 or error < -0.18:
                    desired["moveAway"] = True

        if desired != last_inputs:
            script = (
                "window.__leadBelayApi.input("
                + json.dumps(desired, separators=(",", ":"))
                + ")"
            )
            await client.evaluate(script)
            last_inputs = desired

        await asyncio.sleep(0.05)

    await clear_inputs(client)
    screenshot = await capture_screenshot(client, f"{seed}-timeout.png")
    raise RuntimeError(
        f"Seed {seed} timed out. Clip {state['clippedCount']}, phase {state['phase']}/{state['subphase']}, "
        f"slack {state['slack']:.2f}, window {state['slackWindow']}, advice {state['advice']}. "
        f"Screenshot: {screenshot}"
    )


async def main(seeds):
    server_port = free_port()
    debug_port = free_port()
    user_data_dir = tempfile.mkdtemp(prefix="lead-belay-chrome-")

    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(server_port), "--bind", "127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    chrome = subprocess.Popen(
        [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            f"--remote-debugging-port={debug_port}",
            f"--user-data-dir={user_data_dir}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        await wait_for_debug_port(debug_port)
        page = await wait_for_page(debug_port)
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=5_000_000) as websocket:
            client = CdpClient(websocket)
            await client.send("Page.enable")
            await client.send("Runtime.enable")
            await client.send("Emulation.setDeviceMetricsOverride", {
                "mobile": True,
                "width": 390,
                "height": 844,
                "deviceScaleFactor": 2,
            })

            results = []
            for seed in seeds:
                state = await run_seed(client, server_port, seed)
                results.append(state)
                print(
                    f"{seed}: {state['stage']} clips={state['clippedCount']} catches={state['performance']['catches']}",
                    flush=True,
                )
                if state["stage"] != "won":
                    screenshot = await capture_screenshot(client, f"{seed}-{state['stage']}.png")
                    raise RuntimeError(
                        f"Seed {seed} ended with {state['stage']}: {state['result']}. "
                        f"Clip {state['clippedCount']}, phase {state['phase']}/{state['subphase']}, "
                        f"slack {state['slack']:.2f}, window {state['slackWindow']}, fall {state['fall']}. "
                        f"Screenshot: {screenshot}"
                    )

            peak_force = max(result["performance"]["maxForce"] for result in results)
            catches = sum(result["performance"]["catches"] for result in results)
            print(f"Validated {len(results)} seeds, total catches {catches}, peak force {peak_force:.1f} kN")
    finally:
        chrome.terminate()
        server.terminate()
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--seed",
        action="append",
        dest="seeds",
        help="Seed value to validate. Can be passed multiple times.",
    )
    args = parser.parse_args()
    asyncio.run(main(args.seeds or ["alpha", "beta", "gamma", "delta", "epsilon"]))
