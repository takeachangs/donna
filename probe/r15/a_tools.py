# /// script
# dependencies = ["websockets>=13"]
# ///
"""Tester A: tool calls + asynchrony on higgs-realtime vs higgs-realtime-1.5-preview (text mode, cheap).
    uv run a_tools.py async  <model> [runs]   # Q1-3: open call across 2 turns, bare ack, output ~30 s later, recall
    uv run a_tools.py reserved <model>        # Q4: tool literally named `delegate`, then `web_search`
Every raw event (in and out) goes to A-tools.jsonl."""
import asyncio, json, os, sys, time
from pathlib import Path
import websockets
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from higgslive import TOOL_DEF, MECHANICS   # the exact schema + prompt the project ships

LOG = open(Path(__file__).with_name("A-tools.jsonl"), "a")
PROMPT = "You are a friendly voice assistant. Keep answers to one or two short sentences. There is no set topic."


class S:
    def __init__(self, model, test, run): self.m, self.test, self.run, self.t0 = model, test, run, time.time()
    def log(self, d, ev): LOG.write(json.dumps({"ts": round(time.time(), 3), "t": round(time.time() - self.t0, 2), "model": self.m, "test": self.test, "run": self.run, "dir": d, "ev": ev}) + "\n"); LOG.flush()
    async def __aenter__(self):
        self.ws = await websockets.connect("wss://api.boson.ai/v1/realtime?model=" + self.m, additional_headers={"Authorization": f"Bearer {os.environ['BOSON_API_KEY']}"}, max_size=None, open_timeout=20)
        self.q = asyncio.Queue(); self.reader = asyncio.create_task(self._read()); return self
    async def __aexit__(self, *a): self.reader.cancel(); await self.ws.close()
    async def _read(self):
        try:
            async for raw in self.ws:
                ev = json.loads(raw); self.log("in", ev); await self.q.put(ev)
        except websockets.ConnectionClosed as e: await self.q.put({"type": "_closed", "code": e.code})
    async def send(self, ev): self.log("out", ev); await self.ws.send(json.dumps(ev))
    async def setup(self, tools, instructions):
        await self.send({"type": "session.update", "session": {"type": "realtime", "model": self.m, "output_modalities": ["text"], "instructions": instructions, "tools": tools, "tool_choice": "auto", "temperature": 0.5}})
        await self.until(lambda e: e["type"] == "session.created", 15)
    async def until(self, pred, timeout):
        """drain events until pred; return (matching event or None, all events seen)."""
        seen, end = [], time.time() + timeout
        while (left := end - time.time()) > 0:
            try: ev = await asyncio.wait_for(self.q.get(), left)
            except asyncio.TimeoutError: break
            seen.append(ev)
            if pred(ev) or ev["type"] == "_closed": return ev, seen
        return None, seen
    async def respond(self, timeout=30):
        """bare response.create, wait for response.done → (text, calls, errors, seconds)."""
        t = time.time(); await self.send({"type": "response.create"})
        done, seen = await self.until(lambda e: e["type"] == "response.done", timeout)
        return summarize(done, seen) + (round(time.time() - t, 2),)
    async def user(self, text, timeout=30):
        await self.send({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}})
        return await self.respond(timeout)
    async def item(self, item):
        await self.send({"type": "conversation.item.create", "item": item})
        return (await self.until(lambda e: e["type"] in ("conversation.item.added", "conversation.item.created", "error"), 5))[0]


def summarize(done, seen):
    errs = [e.get("error") for e in seen if e["type"] == "error"]
    if not done: return "<no response.done>", [], errs + ["timeout"]
    text, calls = [], []
    for o in done["response"].get("output", []):
        if o.get("type") == "function_call": calls.append({k: o.get(k) for k in ("name", "arguments", "call_id", "executor", "status")})
        for p in o.get("content", []) or []: text.append(p.get("text") or p.get("transcript") or "")
    return " ".join(text).strip(), calls, errs


def p(*a): print(*a, flush=True)


async def async_run(model, run):
    async with S(model, "async", run) as s:
        await s.setup([TOOL_DEF], PROMPT + "\n\n" + MECHANICS)
        text, calls, errs, dt = await s.user("Can you make a file called groceries.txt on my computer with a short grocery list in it?")
        p(f"[{model} r{run}] T0 ({dt}s) calls={calls} errs={errs} text={text!r}")
        call = next((c for c in calls if c["name"] == TOOL_DEF["name"]), None)
        if not call: p("  NO CALL, abort run"); return
        t_call = time.time()
        text, calls, errs, dt = await s.respond()   # Q2: bare ack
        p(f"  ACK ({dt}s) calls={calls} errs={errs} text={text!r}")
        for q in ("By the way, what's the capital of Australia?", "Cool. Tell me a one-line joke about cats."):   # Q1
            text, calls, errs, dt = await s.user(q)
            p(f"  TURN ({dt}s) calls={calls} errs={errs} text={text!r}")
        await asyncio.sleep(max(0, 30 - (time.time() - t_call)))
        ack = await s.item({"type": "function_call_output", "call_id": call["call_id"], "output": "Created groceries.txt in the home folder with: oat milk, sourdough bread, 6 eggs, bananas, coffee beans."})
        p(f"  OUTPUT sent {time.time() - t_call:.0f}s after call; server ack={ack and ack['type']} {ack.get('error') if ack else ''}")
        text, calls, errs, dt = await s.respond()   # Q3: incorporates?
        p(f"  RESULT ({dt}s) calls={calls} errs={errs} text={text!r}")
        text, calls, errs, dt = await s.user("Sorry, I zoned out. What exactly did you put in that file?")
        p(f"  RECALL ({dt}s) calls={calls} errs={errs} text={text!r}")


async def reserved(model):
    D = "Please think hard about this and delegate it: what's the most robust plan to migrate a 2 TB MySQL database to Postgres with under a minute of downtime?"
    for name, desc, params, ask in [
        ("delegate", "Hands a hard question to a stronger background model.", {"reason": {"type": "string"}}, D),
        ("delegate", "Hands a hard question to a stronger background model.", {"task": {"type": "string"}},
         "Please think hard about this and delegate it: what's the most robust plan to migrate a 2 TB MySQL database to Postgres with under a minute of downtime?"),
        ("web_search", "Searches the web.", {"query": {"type": "string"}},
         "Search the web: what is the current price of a Raspberry Pi 5 with 8 GB of RAM?")]:
        async with S(model, "reserved-" + name + "-" + "+".join(params), 0) as s:
            await s.setup([{"type": "function", "name": name, "description": desc, "parameters": {"type": "object", "properties": params, "required": list(params)}}], PROMPT)
            t = time.time(); await s.send({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": ask}]}})
            await s.send({"type": "response.create"})
            dones = 0
            while dones < 6:   # server tools chain responses on their own; stop at a call-free reply, 6 responses or 40 s quiet
                ev, seen = await s.until(lambda e: e["type"] in ("response.done", "conversation.item.added", "conversation.item.done", "error"), 40)
                if not ev: p(f"[{model} {name}({",".join(params)})] quiet 40 s, stop"); break
                dt = round(time.time() - t, 2)
                if ev["type"] == "response.done":
                    dones += 1; text, calls, errs = summarize(ev, seen); p(f"[{model} {name}({",".join(params)})] +{dt}s response.done calls={calls} errs={errs} text={text[:400]!r}")
                    if not calls: break
                elif ev["type"] == "error": p(f"[{model} {name}({",".join(params)})] +{dt}s ERROR {ev.get('error')}")
                else:
                    it = ev.get("item", {})
                    if it.get("type") in ("function_call", "function_call_output"):
                        p(f"[{model} {name}({",".join(params)})] +{dt}s {ev['type']} {it.get('type')} executor={it.get('executor')} args={it.get('arguments')} out={str(it.get('output'))[:400]!r}")


if __name__ == "__main__":
    cmd, model = sys.argv[1], sys.argv[2]
    if cmd == "async":
        for r in range(int(sys.argv[3]) if len(sys.argv) > 3 else 3): asyncio.run(async_run(model, r))
    else: asyncio.run(reserved(model))
