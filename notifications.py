"""Durable, project-scoped pending phone notifications. No network or audio."""
import hashlib
import json
import os
import re
import herd


def key(message):
    return hashlib.sha256(json.dumps([message['id'], message['kind'], message.get('text'), message.get('ts')],
                                    ensure_ascii=True).encode()).hexdigest()


def conveys(message, transcript):
    """Callbacks repeat reviewed text: a greeting/reason for calling is not delivery."""
    words = lambda s: set(re.findall(r"\w+", s.casefold()))
    expected, actual = words(message['text']), words(transcript)
    return bool(expected) and len(expected & actual) / len(expected) >= .75


def pending():
    d = herd.root()/'donna'
    meta, status = herd.rj(d/'meta.json'), herd.rj(d/'status.json')
    if not meta.get('project'): return []
    inbox = herd.tail(d/'inbox.jsonl')
    projects = {m['id']: m.get('project') for m in inbox if 'id' in m and not m.get('in_reply_to')}
    replaced = {m['replaces'] for m in inbox if m.get('replaces')}
    events = herd.tail(herd.root()/'events.jsonl')
    heard = {e.get('id') for e in events if e.get('ev') == 'task.spoken'}
    acked = set(herd.rj(d/'notification-acks.json').get('keys', []))
    results = herd.rj(d/'results.json')
    groups = {}
    for m in herd.tail(d/'outbox.jsonl'):
        kind, tid = m.get('kind'), m.get('id')
        if kind not in ('say','fail','ask') or not m.get('text') or tid in replaced: continue
        # Re-registering the same brain starts a new duty period, not a delivery receipt.
        # Legacy mail has no project identity, so only that mail uses the duty cutoff.
        if not projects.get(tid) and m.get('ts', 0) < meta.get('since', 0): continue
        if projects.get(tid) and os.path.normcase(projects[tid]) != os.path.normcase(meta.get('project', '')): continue
        task = status.get('tasks', {}).get(tid, {})
        if kind == 'ask' and (task.get('state') != 'needs_you' or task.get('asked') != m['text']): continue
        if kind != 'ask' and tid in heard: continue
        k = key(m)
        if k in acked: continue
        # A format refinement can finish two task IDs with the same reviewed artifact and exact report.
        artifacts = sorted(a['id'] for a in results.get(tid, []))
        group = json.dumps([kind,m['text'],artifacts]) if artifacts and kind != 'ask' else k
        if group in groups: groups[group]['receipts'].append({'id': tid, 'key': k, 'kind': kind})
        else: groups[group] = {**m, 'key': k, 'receipts': [{'id': tid, 'key': k, 'kind': kind}]}
    return list(groups.values())


def acknowledge(message):
    """Only call after successful speech/playback, never when a result is merely queued."""
    d = herd.root()/'donna'
    with herd.worker_lock(d/'.delivery.lock'):
        file = d/'notification-acks.json'
        saved = herd.rj(file)
        keys, spoken = set(saved.get('keys', [])), set(saved.get('spoken', []))
        newly_spoken = []
        for receipt in message['receipts']:
            if receipt['key'] in keys: continue
            keys.add(receipt['key'])
            if receipt['kind'] in ('say','fail'):
                spoken.add(receipt['id']); newly_spoken.append(receipt['id'])
        herd.write_json(file, {'keys': sorted(keys), 'spoken': sorted(spoken)})
        for tid in newly_spoken: herd.event('task.spoken', 'donna', id=tid)
    herd.write_office()
