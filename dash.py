#!/usr/bin/env python3
"""Terminal dashboard: GitHub issues on takeachangs/donna worked by Claude Code sessions + their Sonnet subagents.

  python3 dash.py            curses UI, refresh every 10 s (r = now, q = quit)
  python3 dash.py --once     one plain-text frame to stdout (also writes ~/.higgs/board.json + board.log.jsonl; --no-log skips)
  python3 dash.py --selftest parser checks on inline samples
"""
import argparse, json, locale, os, re, shutil, subprocess, textwrap, threading, time
from datetime import datetime, timezone
from pathlib import Path

REPO = "takeachangs/donna"
CH_REPO = "JerroldH/chamber"
CHAMBER = str(Path.home() / "projects" / "chamber")  # sessions whose cwd starts here are shown under a second header
TAIL = 2_000_000
HIGGS = Path.home() / ".higgs"
SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"  # working-row spinner frames; --once uses a plain "●"
LOG_MAX, LOG_KEEP = 2_000_000, 500
HIST_MAX, HIST_BOARD = 500, 100
ACK = "Async agent launched"  # tool_result of a background Agent is only a launch ack
NOTIF = re.compile(r"<tool-use-id>(\w+)</tool-use-id>.*?<status>(\w+)</status>", re.S)


def sh(cmd, cwd=None):
    """stdout of cmd, or None on any failure."""
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=10)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def jsh(cmd):
    out = sh(cmd)
    try:
        return json.loads(out) if out is not None else None
    except ValueError:
        return None


def cut(s, n):
    s = str(s)
    return s if len(s) <= n else s[: max(n - 1, 0)] + "…"


def ts(s):
    try:
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


def hm(t):
    return datetime.fromtimestamp(t).strftime("%H:%M")


def age(sec):
    sec = max(int(sec), 0)
    return f"{sec}s" if sec < 60 else f"{sec // 60}m" if sec < 3600 else f"{sec // 3600}h"


# ---- parsers ---------------------------------------------------------------

def parse_agents(raw, root, cham=None):
    """`claude agents --json --all` text -> issue sessions under <root>/.claude/worktrees/ (+ sessions under cham, repo='chamber')."""
    out, wt = {}, f"{root}/.claude/worktrees/"
    for r in json.loads(raw):
        cwd = r.get("cwd") or ""
        ch = bool(cham) and cwd.startswith(cham)
        if not (cwd.startswith(wt) or ch) or r.get("kind") == "background" or r.get("state") in ("stopped", "done", "failed"):
            continue
        folder = os.path.basename(cwd) if ch else cwd[len(wt):].split("/")[0]
        name = re.sub(r"-[0-9a-f]{6}$", "", folder)
        m = re.match(r"#(\d+)", r.get("name") or "") or (re.search(r"issue-(\d+)", cwd) if ch else None)
        e = dict(name=name, repo="chamber" if ch else "donna", label=r.get("name") or name, issue=int(m.group(1)) if m else None, busy=r.get("status") == "busy",
                 cwd=cwd, sid=r.get("sessionId"), started=(r.get("startedAt") or 0) / 1000)
        # one row per sessionId and per worktree: the later startedAt wins
        for key in (e["sid"], cwd):
            old = out.get(key)
            if old and old["started"] > e["started"]:
                break
        else:
            for k in [k for k, v in out.items() if v["sid"] == e["sid"] or v["cwd"] == cwd]:
                del out[k]
            out[e["sid"] or cwd] = e
    return list(out.values())


def parse_transcript(lines, now=None):
    """JSONL lines -> {'agents': [{id,desc,model,effort,t0,t1,fail,name,aid}], 'note': str}. Done = real tool_result or task-notification."""
    ags, note = {}, ""
    for ln in lines:
        try:
            o = json.loads(ln)
        except ValueError:
            continue
        t = ts(o.get("timestamp") or "")
        c = (o.get("message") or {}).get("content")
        if o.get("type") == "queue-operation" and o.get("operation") == "enqueue":
            for tid, st in NOTIF.findall(o.get("content") or ""):
                if tid in ags:
                    ags[tid].update(t1=t, fail=st != "completed")
            continue
        if not isinstance(c, list):
            continue
        for i in c:
            if not isinstance(i, dict):
                continue
            if i.get("type") == "tool_use" and i.get("name") == "Agent":
                inp = i.get("input") or {}
                ags[i["id"]] = dict(id=i["id"], desc=inp.get("description", "?"), model=inp.get("model"),
                                    effort=inp.get("effort"), t0=t, t1=None, fail=False, name=inp.get("name"), aid=None)
            elif i.get("type") == "tool_result" and i.get("tool_use_id") in ags:
                txt = str(i.get("content"))
                if ACK not in txt:
                    ags[i["tool_use_id"]].update(t1=t, fail=False)
                elif m := re.search(r"agentId: (\w+)", txt):
                    ags[i["tool_use_id"]]["aid"] = m.group(1)
            elif i.get("type") == "text" and o.get("type") == "assistant" and i.get("text", "").strip():
                note = i["text"].strip().splitlines()[0]
    return dict(agents=list(ags.values()), note=note)


def read_tail(path):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            n = f.tell()
            f.seek(max(n - TAIL, 0))
            data = f.read().decode("utf-8", "replace").splitlines()
        return data[1:] if n > TAIL else data
    except OSError:
        return None


def find_orch(root):
    """sessionId of the newest transcript (by mtime) of this repo's project dir whose cwd is exactly root, else None."""
    d = Path.home() / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", root)
    try:
        fs = sorted(d.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)[:20]
    except OSError:
        return None
    for p in fs:
        try:
            with open(p, errors="replace") as f:
                for _, ln in zip(range(40), f):
                    if '"cwd"' in ln:
                        if json.loads(ln).get("cwd") == root:
                            return p.stem
                        break
        except (OSError, ValueError):
            continue


def orch_agents(lines, load, now):
    """Orchestrator transcript lines -> its Agent calls (running, or finished < 6 h ago), each with 'kids' = the Agent calls
    in its own transcript load(agentId) (JSONL lines or None -> no kids)."""
    out = []
    for a in parse_transcript(lines)["agents"]:
        if live(a, now) or a["t1"] and now - a["t1"] < 21600:
            ol = load(a["aid"]) if a["aid"] else None
            out.append(dict(a, kids=parse_transcript(ol)["agents"] if ol else []))
    return out


# ---- collection (runs in background thread) --------------------------------

def collect(root, tier):
    now = time.time()
    raw = sh(["claude", "agents", "--json", "--all"])
    try:
        sess = parse_agents(raw, root, CHAMBER) if raw is not None else None
    except Exception:
        sess = None
    orch, sid = None, find_orch(root)
    if sid:
        slug = re.sub(r"[^A-Za-z0-9]", "-", root)
        lines = read_tail(Path.home() / ".claude" / "projects" / slug / f"{sid}.jsonl")
        tasks = Path(f"/private/tmp/claude-{os.getuid()}/{slug}/{sid}/tasks")
        if lines is not None:
            orch = orch_agents(lines, lambda aid: read_tail(tasks / f"{aid}.output"), now)
    prs_ch = jsh(["gh", "pr", "list", "--repo", CH_REPO, "--state", "all", "--json",
                  "number,headRefName,state,title,reviewDecision,isDraft", "--limit", "100"])
    issues_ch = jsh(["gh", "issue", "list", "--repo", CH_REPO, "--state", "all", "--json", "number,state", "--limit", "100"])
    prs = jsh(["gh", "pr", "list", "--repo", REPO, "--state", "all", "--json",
               "number,headRefName,state,title,reviewDecision,isDraft", "--limit", "100"])
    issues = jsh(["gh", "issue", "list", "--repo", REPO, "--state", "all", "--json",
                  "number,state,milestone", "--limit", "100"])
    for s in sess or []:
        s["branch"] = (sh(["git", "-C", s["cwd"], "branch", "--show-current"]) or "?").strip()
        slug = re.sub(r"[^A-Za-z0-9]", "-", s["cwd"])  # "/." -> "--"
        lines = read_tail(Path.home() / ".claude" / "projects" / slug / f"{s['sid']}.jsonl")
        s.update(parse_transcript(lines) if lines is not None else dict(agents=None, note=""))
    return dict(now=now, root=root, tier=tier, sess=sess, prs=prs, issues=issues, orch=orch, prs_ch=prs_ch, issues_ch=issues_ch)


# ---- model (shared by renderer and log) ------------------------------------

def pr_for(s, prs):
    pat = re.compile(rf"^(claude/)?issue-{s['issue']}(-|$)") if s["issue"] else None
    ms = [p for p in prs or [] if p["headRefName"] == s["branch"] or (pat and pat.match(p["headRefName"]))]
    return max(ms, key=lambda p: (p["state"] == "OPEN", p["number"]), default=None)


def pr_issue(p):
    m = re.match(r"^(?:claude/)?issue-(\d+)(?:-|$)", p["headRefName"]) or re.search(r"\(#(\d+)\)\s*$", p["title"])
    return int(m.group(1)) if m else None


def review(p):
    if p["state"] == "MERGED":
        return "✔ merged"
    if p["state"] == "CLOSED":
        return "✘ closed"
    return "✔ approved" if p.get("reviewDecision") == "APPROVED" else "⚠ review"


def milestones(issues):
    """-> [(label, closed, total, bar)] ordered by milestone number; issues without milestone ignored."""
    ms = {}
    for i in issues or []:
        m = i.get("milestone")
        if m:
            e = ms.setdefault(m["number"], [(m["title"].split() or ["?"])[0], 0, 0])
            e[1] += i["state"] == "CLOSED"
            e[2] += 1
    return [(l, c, t, "▰" * c + "▱" * (t - c)) for _, (l, c, t) in sorted(ms.items())]


def chamber_bar(issues):
    """one block per issue (closed = ▰), by issue number."""
    if issues is None:
        return "?"
    return "".join("▰" if i["state"] == "CLOSED" else "▱" for i in sorted(issues, key=lambda i: i["number"])) \
        + f" {sum(i['state'] == 'CLOSED' for i in issues)}/{len(issues)}"


def live(a, now):
    """running = no finish time and started within 6 h; older unfinished ones are stale ('?')."""
    return not a["t1"] and now - (a["t0"] or now) < 21600


def stats(snap):
    now, sess, prs, issues = snap["now"], snap["sess"], snap["prs"], snap["issues"]
    ags = [a for s in sess or [] for a in s["agents"] or []]
    oa = snap.get("orch") or []
    ags += [k for a in oa for k in a["kids"]] + [a for a in oa if a["model"] == "sonnet"]
    pn = lambda st: None if prs is None else sum(p["state"] == st for p in prs)
    return dict(working=None if sess is None else sum(s["busy"] for s in sess),
                idle=None if sess is None else sum(not s["busy"] for s in sess),
                agents_working=sum(live(a, now) for a in oa),
                sonnets_running=sum(live(a, now) for a in ags),
                sonnets_done_today=sum(bool(a["t1"]) and now - a["t1"] < 86400 for a in ags),
                prs_open=pn("OPEN"), prs_merged=pn("MERGED"),
                issues_open=None if issues is None else sum(i["state"] == "OPEN" for i in issues))


def events(snap):
    """-> [(t, tag, text, key)] oldest first."""
    ev = []
    for s in snap["sess"] or []:
        tag = f"#{s['issue']}" if s["issue"] else s["label"][:14]
        for a in s["agents"] or []:
            if a["t0"]:
                ev.append((a["t0"], tag, f"Agent: {a['desc']} ({a['model'] or '–'}/{a['effort'] or '–'})", (tag, a["id"], 0)))
            if a["t1"]:
                ev.append((a["t1"], tag, f"Agent {'failed' if a['fail'] else 'done'}: {a['desc']}", (tag, a["id"], 1)))
        if s["note"]:
            ev.append((snap["now"], tag, f"\"{s['note']}\"", (tag, f"\"{s['note']}\"")))
    return sorted(ev, key=lambda e: e[0])


def load_history():
    """Seed (hist, seen) from the events arrays in board.log.jsonl (newest last), so a restart keeps the night."""
    hist, seen = [], set()
    try:
        lines = (HIGGS / "board.log.jsonl").read_text().splitlines()
    except OSError:
        lines = []
    for ln in lines:
        try:
            evs = json.loads(ln).get("events") or []
            for e in evs:
                k = (e["tag"], e["text"])
                if k not in seen:
                    seen.add(k)
                    hist.append(dict(t=e["t"], tag=e["tag"], text=e["text"]))
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
    hist.sort(key=lambda e: e["t"])
    return hist[-HIST_MAX:], seen


def absorb(snap, hist, seen):
    """Append events of snap not seen before to hist (in place, sorted by t, capped); -> the new ones.
    Seeded log events carry no agent id, so they match live ones by (tag, text) via seen."""
    new = []
    for t, tag, text, k in events(snap):
        if k not in seen and (tag, text) not in seen:
            new.append(dict(t=t, tag=tag, text=text))
        seen.add(k)
    hist[:] = sorted(hist + new, key=lambda e: e["t"])[-HIST_MAX:]  # slice-assign: readers on other threads never see it empty
    return new


# ---- rendering: a frame is a list of rows, a row is a list of (text, attr) segments ----
# attr: '' plain, b bold, d dim, g green, y yellow, r red

def fit(segs, n):
    """Truncate with '…' / pad with spaces to exactly n columns."""
    tot = sum(len(t) for t, _ in segs)
    if tot <= n:
        return segs + [(" " * (n - tot), "")]
    out, left = [], max(n - 1, 0)
    for t, a in segs:
        if left <= 0:
            break
        out.append((t[:left], a))
        left -= len(t)
    return out + [("…", out[-1][1] if out else "")] if n > 0 else []


def lr(left, right, n, rattr="d"):
    """left segs, right text right-aligned (dropped if it leaves <8 cols for left)."""
    if right and n - len(right) - 2 >= 8:
        return fit(left, n - len(right) - 2) + [("  " + right, rattr)]
    return fit(left, n)


def agent_row(a, pre, label, n, now, spin):
    me = f"{a['model'] or '–'}·{(a['effort'] or '–').replace('medium', 'med')}"
    if a["t1"]:
        icon, ia, meta = ("✘", "r", "failed") if a["fail"] else ("✔", "d", "done")
    elif live(a, now):
        icon, ia, meta = spin, "g", age(now - (a["t0"] or now))
    else:
        icon, ia, meta = "?", "d", "?"
    return lr([(pre, ""), (icon, ia), (f" {me:<12}{label}", "d" if a["t1"] else "")], meta, n, ia if a["fail"] else "d")


def tree_pane(snap, n, tier, spin="●"):
    now = snap["now"]
    rows = [[(" TREE", "b")], [(" ◉ you · orchestrator", "")]]
    if snap["sess"] is None:
        rows.append([(" sessions: ?", "")])
    if snap.get("orch") is None:
        rows.append([(" agents: ?", "")])
    key = lambda s: s["issue"] or 0
    ss = sorted([s for s in snap["sess"] or [] if s.get("repo") != "chamber"], key=key)
    cs = sorted([s for s in snap["sess"] or [] if s.get("repo") == "chamber"], key=key)
    oa = (snap.get("orch") or [])[-8:]
    for k, a in enumerate(oa):
        last = k == len(oa) - 1 and not ss
        rows.append(agent_row(a, f" {'└─' if last else '├─'} ", a.get("name") or a["desc"], n, now, spin))
        kids = a["kids"][-4:]
        for j, c in enumerate(kids):
            rows.append(agent_row(c, f" {'   ' if last else '│  '}{'└─' if j == len(kids) - 1 else '├─'} ", c["desc"], n, now, spin))

    def sess_rows(ss, prs):
        for k, s in enumerate(ss):
            last = k == len(ss) - 1
            p = pr_for(s, prs)
            if s["busy"]:
                icon, ia, meta, ma = spin, "g", f"{tier}  {age(now - s['started'])}" if s["started"] else tier, "d"
            else:
                icon, ia, ma = "◦", "d", "d"
                meta = "idle" + (f" · PR #{p['number']} {review(p)}" if p else "")
                ma = "y" if p and p["state"] == "OPEN" else "d"
            rows.append(lr([(f" {'└─' if last else '├─'} ", ""), (icon, ia), (" " + s["label"], "" if s["busy"] else "d")], meta, n, ma))
            ags = s["agents"]
            if ags is None:
                rows.append([(f" {'   ' if last else '│  '}└─ subagents: ?", "d")])
            shown = (ags or [])[-6:]
            for j, a in enumerate(shown):
                pre = f" {'   ' if last else '│  '}{'└─' if j == len(shown) - 1 else '├─'} "
                rows.append(agent_row(a, pre, a["desc"], n, now, spin))

    sess_rows(ss, snap["prs"])
    if cs:
        rows.append([(f" ◉ chamber ({CH_REPO})", "")])
        sess_rows(cs, snap.get("prs_ch"))
    return rows


def now_pane(snap, n, spin="●"):
    st = snap["stats"]
    q = lambda v: "?" if v is None else v
    def two(a, b):
        (i1, c1, t1), (i2, c2, t2) = a, b
        return [(" ", ""), (i1, c1), (f" {t1}".ljust(24), ""), (i2, c2), (f" {t2}", "")]
    rows = [[(" NOW", "b")],
            two((spin, "g", f"{q(st['working'])} sessions working"), ("◦", "d", f"{q(st['idle'])} idle")),
            [(" ", ""), (spin, "g"), (f" {st['agents_working']} agents working", "")],
            two((spin, "g", f"{st['sonnets_running']} sonnets running"), ("✔", "d", f"{st['sonnets_done_today']} done today")),
            two(("⚠", "y", f"{q(st['prs_open'])} PR to review"), ("✔", "d", f"{q(st['prs_merged'])} merged")),
            [(" ○ " + f"{q(st['issues_open'])} issues open", "")], [("", "")],
            [(" REVIEW QUEUE", "b")]]
    opens = sorted((p for p in snap["prs"] or [] if p["state"] == "OPEN"), key=lambda p: -p["number"])
    if snap["prs"] is None:
        rows.append([(" ?", "")])
    for p in opens:
        iss = pr_issue(p)
        suffix = f" (issue #{iss})" if iss else ""
        rt = review(p)
        tw = max(n - len(rt) - len(suffix) - len(str(p["number"])) - 6, 8)
        rows.append(lr([(f" #{p['number']}  {cut(p['title'], tw)}{suffix}", "")], rt, n, "y" if rt.startswith("⚠") else "d"))
    return rows


def wrap(s, n):
    return textwrap.wrap(s, max(n, 1), break_long_words=True, break_on_hyphens=False) or [""]


def card(e, W):
    """Newest event as a bordered box, W columns wide."""
    iw = W - 4
    box = lambda t, a: [("│ ", "y"), (t.ljust(iw), a), (" │", "y")]
    bad = "r" if e["text"].startswith("Agent failed") else ""
    return ([[("┌" + "─" * (W - 2) + "┐", "y")]] + [box(l, "b") for l in wrap(f"{hm(e['t'])}  {e['tag']}", iw)]
            + [box(l, bad) for l in wrap(e["text"], iw)] + [[("└" + "─" * (W - 2) + "┘", "y")]])


def ev_rows(e, tw, W):
    """Older event: `hh:mm  tag  text`, text wrapped with a hanging indent under the text column."""
    pre = f" {hm(e['t'])}  {e['tag']:<{tw}}  "
    a = "r" if e["text"].startswith("Agent failed") else ""
    return [[(pre if k == 0 else " " * len(pre), ""), (l, a)] for k, l in enumerate(wrap(e["text"], max(W - len(pre), 10)))]


def render(snap, interval, width, tier="opus·xhigh", hist=None, height=None, spin="●"):
    """-> list of rows (list of (text, attr)). hist = accumulated events, oldest first (default: this snapshot's);
    height = terminal rows (EVENTS fills what is left, legend pinned to the last row); None = card + 8 older events."""
    W = max(width, 40)
    snap = dict(snap, stats=stats(snap))
    bar = [("─" * W, "d")]
    bars = "   ".join(f"{l} {b} {c}/{t}" for l, c, t, b in milestones(snap["issues"])) if snap["issues"] is not None else "milestones: ?"
    right = f"{hm(snap['now'])}   ⟳{interval}s"
    mid = f" DONNA · build board".ljust(24) + bars
    rows = [fit([(cut(mid, W - len(right) - 3), "b")], W - len(right) - 1) + [(right, "b")], fit([(" chamber".ljust(24) + chamber_bar(snap.get("issues_ch")), "b")], W), bar]
    if W >= 100:
        rw = 41
        lw = min(W * 3 // 5, W - 3 - rw)
        rw = W - 3 - lw
        L, R = tree_pane(snap, lw, tier, spin), now_pane(snap, rw, spin)
        for k in range(max(len(L), len(R))):
            rows.append(fit(L[k] if k < len(L) else [], lw) + [(" │ ", "d")] + fit(R[k] if k < len(R) else [], rw))
    else:
        for part in (tree_pane(snap, W, tier, spin), now_pane(snap, W, spin)):
            rows += [fit(r, W) for r in part] + [[("", "")]]
        rows.pop()
    if hist is None:
        hist = [dict(t=t, tag=tag, text=x) for t, tag, x, _ in events(snap)]
    rows += [bar, [(" EVENTS", "b")]]
    if hist:
        rows += card(hist[-1], W)
        old = hist[-2::-1]
        tw = min(max([len(e["tag"]) for e in old] + [4]), 16)
        room = 8 if height is None else height - len(rows) - 2
        for n, e in enumerate(old):
            r = ev_rows(e, tw, W)
            if height is None and n >= 8 or height is not None and len(r) > room:
                break
            rows += r
            room -= len(r) if height is not None else 0
    else:
        rows.append([(" –", "d")])
    if height:  # legend on the very last row, rule above it; blank-pad or clip the body to fit
        rows = (rows + [[("", "")]] * height)[: height - 2]
    rows += [bar, fit([(" ● working  ◦ idle  ✔ done  ✘ failed  ⚠ needs review        [q]uit  [r]efresh", "")], W)]
    return rows


# ---- log files -------------------------------------------------------------

def write_log(snap, hist, new):
    """Atomic ~/.higgs/board.json snapshot (+ last HIST_BOARD events) + one line in board.log.jsonl (capped); new = events first seen this refresh."""
    try:
        HIGGS.mkdir(parents=True, exist_ok=True)
        st, ev = stats(snap), events(snap)
        full = dict(snap, stats=st, milestones=milestones(snap["issues"]), events=[dict(t=t, tag=tag, text=x) for t, tag, x, _ in ev],
                    history=hist[-HIST_BOARD:])
        tmp = HIGGS / "board.json.tmp"
        tmp.write_text(json.dumps(full, ensure_ascii=False, default=str))
        os.replace(tmp, HIGGS / "board.json")
        log = HIGGS / "board.log.jsonl"
        with open(log, "a") as f:
            f.write(json.dumps(dict(ts=snap["now"], working=st["working"], sonnets_running=st["sonnets_running"],
                                    prs_open=st["prs_open"], events=new), ensure_ascii=False) + "\n")
        if log.stat().st_size > LOG_MAX:
            log.write_text("".join(log.read_text().splitlines(True)[-LOG_KEEP:]))
    except OSError:
        pass


# ---- UI --------------------------------------------------------------------

def ui(scr, args, root):
    try:
        curses.curs_set(0)
    except curses.error:
        pass
    attrs = {"": 0, "b": curses.A_BOLD, "d": getattr(curses, "A_DIM", 0), "g": 0, "y": 0, "r": 0}
    if curses.has_colors():
        curses.start_color()
        try:
            curses.use_default_colors()
        except curses.error:
            pass
        for n, (k, c) in enumerate((("g", curses.COLOR_GREEN), ("y", curses.COLOR_YELLOW), ("r", curses.COLOR_RED)), 1):
            curses.init_pair(n, c, -1)
            attrs[k] = curses.color_pair(n)
    snap, kick, stop = {}, threading.Event(), threading.Event()
    hist, seen = load_history()

    def worker():
        while not stop.is_set():
            snap["v"] = v = collect(root, args.tier)
            new = absorb(v, hist, seen)
            if not args.no_log:
                write_log(v, hist, new)
            kick.wait(args.interval)
            kick.clear()

    threading.Thread(target=worker, daemon=True).start()
    scr.timeout(250)  # spinner tick: redraws the last snapshot only, no subprocess
    while True:
        scr.erase()
        h, w = scr.getmaxyx()
        if "v" not in snap:
            scr.addstr(0, 1, "loading…")
        else:
            for y, row in enumerate(render(snap["v"], args.interval, w - 1, args.tier, list(hist), h, SPIN[int(time.time() * 4) % len(SPIN)])[:h]):
                x = 0
                for t, a in row:
                    try:
                        scr.addstr(y, x, t[: w - 1 - x], attrs[a])
                    except curses.error:
                        pass
                    x += len(t)
        scr.refresh()
        k = scr.getch()
        if k in (ord("q"), ord("Q")):
            stop.set()
            return
        if k in (ord("r"), ord("R")):
            kick.set()


def selftest():
    root = "/r"
    raw = json.dumps([
        dict(kind="interactive", name="x", status="idle", cwd="/r", sessionId="a", pid=1),
        dict(kind="interactive", name="#1 herd", status="busy", cwd="/r/.claude/worktrees/issue-1-herd-0063d6", sessionId="s1", pid=2)])
    s = parse_agents(raw, root)
    assert len(s) == 1 and s[0]["name"] == "issue-1-herd" and s[0]["issue"] == 1 and s[0]["busy"], s
    assert s[0]["label"] == "#1 herd", s
    wt = "/r/.claude/worktrees/"
    raw2 = json.dumps([
        dict(kind="background", name="bg", state="stopped", cwd=wt + "issue-1-herd-0063d6", sessionId="b", startedAt=1),
        dict(kind="interactive", name="Old", status="idle", cwd=wt + "issue-3-ring-aaaaaa", sessionId="o", startedAt=1000),
        dict(kind="interactive", name="Call fixes 2", status="busy", cwd=wt + "issue-3-ring-aaaaaa", sessionId="n", startedAt=2000),
        dict(kind="interactive", name="Same", status="idle", cwd=wt + "x-bbbbbb", sessionId="n", startedAt=1500)])
    s2 = parse_agents(raw2, root)
    assert [(x["label"], x["issue"]) for x in s2] == [("Call fixes 2", None)], s2
    use = {"type": "assistant", "timestamp": "2026-10-24T03:01:05.647Z", "message": {"content": [
        {"type": "text", "text": "Spawning\nmore"},
        {"type": "tool_use", "id": "t1", "name": "Agent", "input": {"description": "Write herd.py", "model": "sonnet", "effort": "high", "name": "herd-w"}}]}}
    ack = {"type": "user", "timestamp": "2026-10-24T03:01:06.000Z", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "t1", "content": [{"type": "text", "text": "Async agent launched successfully.\nagentId: a8673629 (internal ID)"}]}]}}
    res = {"type": "user", "timestamp": "2026-10-24T03:03:06.000Z", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "t1", "content": "done"}]}}
    note = {"type": "queue-operation", "operation": "enqueue", "timestamp": "2026-10-24T03:03:00.000Z",
            "content": "<task-notification>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n</task-notification>"}
    p = parse_transcript([json.dumps(use), json.dumps(ack)])
    a = p["agents"][0]
    assert (a["desc"], a["model"], a["effort"], a["t1"], p["note"]) == ("Write herd.py", "sonnet", "high", None, "Spawning"), p
    assert (a["name"], a["aid"]) == ("herd-w", "a8673629"), a
    assert parse_transcript([json.dumps(x) for x in (use, ack, res)])["agents"][0]["t1"], "tool_result = done"
    assert parse_transcript([json.dumps(x) for x in (use, ack, note)])["agents"][0]["t1"], "notification = done"
    # A: orchestrator agent + nested sonnet from its task output; stale/unfinished-old ones dropped; chamber sessions grouped
    kid = dict(use, message={"content": [dict(use["message"]["content"][1], id="k1", input={"description": "Kid work", "model": "sonnet", "effort": "high"})]})
    t0 = ts("2026-10-24T03:01:05.647Z")
    oa = orch_agents([json.dumps(use), json.dumps(ack)], lambda aid: [json.dumps(kid)] if aid == "a8673629" else None, t0 + 120)
    assert len(oa) == 1 and oa[0]["kids"][0]["desc"] == "Kid work" and live(oa[0], t0 + 120), oa
    assert orch_agents([json.dumps(use), json.dumps(ack)], lambda aid: None, t0 + 7 * 3600) == []
    assert orch_agents([json.dumps(use), json.dumps(ack)], lambda aid: None, t0 + 60)[0]["kids"] == []
    raw3 = json.dumps([dict(kind="interactive", name="Chamber #1", status="busy", cwd="/h/projects/chamber-wt/issue-1", sessionId="c1", startedAt=1000)])
    c = parse_agents(raw3, root, "/h/projects/chamber")
    assert [(x["repo"], x["label"], x["issue"]) for x in c] == [("chamber", "Chamber #1", 1)], c
    osnap = dict(now=t0 + 120, sess=[dict(x, agents=[], note="", branch="b") for x in c], prs=[], issues=[], prs_ch=[], orch=oa, issues_ch=[dict(number=2, state="OPEN"), dict(number=1, state="CLOSED")])
    fr = ["".join(t for t, _ in r) for r in render(osnap, 10, 110)]
    assert any("chamber" in x and "▰▱ 1/2" in x for x in fr) and any("◉ chamber (JerroldH/chamber)" in x for x in fr), fr
    assert any("sonnet·high herd-w" in x for x in fr) and any("sonnet·high Kid work" in x for x in fr), fr
    assert any("1 agents working" in x for x in fr) and any("2 sonnets running" in x for x in fr), fr
    ms = lambda n, t, st: dict(number=n, state=st, milestone=t and dict(number=int(t[1]), title=t))
    iss = [ms(1, "M2 b", "OPEN"), ms(2, "M1 a", "CLOSED"), ms(3, "M1 a", "CLOSED"), ms(4, "M1 a", "OPEN"), ms(5, None, "OPEN")]
    assert milestones(iss) == [("M1", 2, 3, "▰▰▱"), ("M2", 0, 1, "▱")], milestones(iss)
    prs = [dict(number=9, headRefName="claude/issue-3-ring-ab12", state="OPEN", title="x"), dict(number=8, headRefName="z", state="MERGED", title="y (#4)")]
    assert pr_for(dict(issue=3, branch="?"), prs)["number"] == 9 and pr_issue(prs[0]) == 3 and pr_issue(prs[1]) == 4
    assert pr_for(dict(issue=None, branch="z"), prs)["number"] == 8 and pr_for(dict(issue=30, branch="?"), prs) is None
    assert live(dict(t1=None, t0=1.0), 21600) and not live(dict(t1=None, t0=1.0), 21602) and not live(dict(t1=5, t0=1.0), 6)
    snap = dict(now=1000.0, sess=[dict(name="issue-3-ring", label="#3 ring", issue=3, busy=True, started=940.0, branch="b", note="hi",
                agents=[dict(id="a", desc="d", model="sonnet", effort="medium", t0=950.0, t1=None, fail=False)])], prs=prs, issues=iss)
    for w in (60, 110):
        fr = ["".join(t for t, _ in r) for r in render(snap, 10, w)]
        assert all(len(x) == w or set(x) <= {" "} or len(x) <= w for x in fr) and any("#3 ring" in x and "1m" in x for x in fr), fr
        assert any("M1 ▰▰▱ 2/3" in x for x in fr) and any("sonnet·med" in x for x in fr), fr
    # history: overlapping refreshes add only the new events; a seeded (tag, text) event is not re-added
    mk = lambda now, note, ags: dict(now=now, sess=[dict(label="#3 ring", issue=3, note=note, agents=ags)])
    ag = lambda i, t1=None: dict(id=i, desc="d" + i, model="sonnet", effort="high", t0=10.0, t1=t1, fail=False)
    h, sn = [], set()
    assert len(absorb(mk(100.0, "one", [ag("a")]), h, sn)) == 2 and len(h) == 2
    assert [e["text"] for e in absorb(mk(110.0, "one", [ag("a"), ag("b", 105.0)]), h, sn)] == ["Agent: db (sonnet/high)", "Agent done: db"] and len(h) == 4
    assert [e["t"] for e in h if e["text"] == '"one"'] == [100.0], "note never re-stamped"
    assert absorb(mk(120.0, "one", [ag("a"), ag("b", 105.0)]), h, sn) == [] and len(h) == 4
    h2, sn2 = [dict(t=1.0, tag="#3", text='"one"')], {("#3", '"one"')}
    assert len(absorb(mk(130.0, "one", []), h2, sn2)) == 0 and len(h2) == 1
    long = ("word " * 40).strip()
    fr = [("".join(t for t, _ in r)) for r in render(snap, 10, 60, hist=[dict(t=1.0, tag="#3", text=long), dict(t=2.0, tag="#3", text=long)])]
    assert all(len(x) <= 60 for x in fr) and "…" not in "".join(fr[:-1]), fr
    assert sum(x.count("word") for x in fr) == 80, fr
    assert len(render(snap, 10, 110, hist=[dict(t=i, tag="#3", text=long) for i in range(30)], height=30)) == 30
    for hh in (14, 40):
        fr = ["".join(t for t, _ in r) for r in render(snap, 10, 110, hist=[dict(t=1.0, tag="#3", text=long)], height=hh, spin="⠋")]
        assert len(fr) == hh and "[q]uit" in fr[-1] and fr[-2].startswith("─") and any("⠋ 1 sessions working" in x for x in fr), fr
    print("selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=int, default=10)
    ap.add_argument("--tier", default="opus·xhigh")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--no-log", action="store_true", help="skip ~/.higgs/board.json + board.log.jsonl")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    root = (sh(["git", "rev-parse", "--show-toplevel"]) or "").strip()
    if args.once:
        snap = collect(root, args.tier)
        hist, seen = load_history()
        new = absorb(snap, hist, seen)
        if not args.no_log:
            write_log(snap, hist, new)
        for row in render(snap, args.interval, shutil.get_terminal_size((110, 24)).columns - 1, args.tier, hist):
            print("".join(t for t, _ in row).rstrip())
        return
    locale.setlocale(locale.LC_ALL, "")
    global curses
    import curses  # Only the terminal UI needs curses; the office's transcript parser works on Windows.
    curses.wrapper(ui, args, root)


if __name__ == "__main__":
    main()
