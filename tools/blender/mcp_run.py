"""Run Little Spirit Blender build steps in the *live* Blender session over MCP.

Usage:  python3 tools/blender/mcp_run.py "<python expression using build modules>"
        python3 tools/blender/mcp_run.py --file tools/blender/arp_weights_mori.py
   e.g. python3 tools/blender/mcp_run.py "build_ancient_tree.build(display=(0, 25, 0))"
        python3 tools/blender/mcp_run.py --screenshot out.png

Talks to the Blender Lab MCP bridge (stdio) which forwards to the add-on server
inside Blender (localhost:9876). Headless alternative: build_all.py.
"""
import base64, json, os, subprocess, sys

BRIDGE = os.path.expanduser("~/Library/Application Support/Claude/Claude Extensions/ant.dir.gh.blender.blender-mcp/.venv/bin/blender-mcp")
HERE = os.path.dirname(os.path.abspath(__file__))


def call(tool, args):
    p = subprocess.Popen([BRIDGE], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)

    def send(o):
        p.stdin.write(json.dumps(o) + "\n"); p.stdin.flush()

    def recv(i):
        for line in p.stdout:
            try:
                j = json.loads(line)
            except ValueError:
                continue
            if j.get("id") == i:
                return j

    send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "ls", "version": "1"}}})
    recv(1)
    send({"jsonrpc": "2.0", "method": "notifications/initialized"})
    send({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool, "arguments": args}})
    r = recv(2)
    p.terminate()
    return r


def run(expr):
    code = (
        "import sys, importlib\n"
        f"sys.path.insert(0, {HERE!r})\n"
        "import lsgen, parts, build_ancient_tree, build_props, build_forest_kit, setup_refs\n"
        "for m in (lsgen, parts, build_ancient_tree, build_props, build_forest_kit, setup_refs): importlib.reload(m)\n"
        f"result = {{'out': {expr}}}\n"
    )
    return call("execute_blender_code", {"code": code})


if __name__ == "__main__":
    if sys.argv[1] == "--file":
        r = call("execute_blender_code", {"code": open(sys.argv[2]).read()})
        print(json.dumps(r.get("result", r), indent=1)[:4000])
    elif sys.argv[1] == "--screenshot":
        r = call("get_screenshot_of_window_as_image", {})
        for c in r["result"]["content"]:
            if c["type"] == "image":
                open(sys.argv[2], "wb").write(base64.b64decode(c["data"]))
                print("saved", sys.argv[2])
    else:
        r = run(sys.argv[1])
        for c in r.get("result", {}).get("content", []):
            print(c.get("text", "")[:4000])
        if "error" in r:
            print(r["error"])
