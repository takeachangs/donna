"""Offline Codex/office integration checks. The fake CLI never calls a model."""
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import herd

FAKE = '''import json,sys,time
from pathlib import Path
args=sys.argv[1:]; prompt=sys.stdin.read() if args[-1]=='-' else args[-1]; cwd=Path.cwd()
thread=args[args.index('resume')+1] if 'resume' in args else 'fake-thread-'+cwd.name
def event(**v): print(json.dumps(v),flush=True)
with (cwd/'runs.jsonl').open('a') as f:f.write(json.dumps({'args':args,'thread':thread,'at':time.time()})+'\\n')
event(type='thread.started',thread_id=thread)
event(type='item.started',item={'type':'command_execution','command':'check actual files'})
time.sleep(10 if 'slow task' in prompt else .6)
if 'fail task' in prompt:
 event(type='turn.failed',error={'message':'fixture failure'});sys.exit(1)
(cwd/'proof.txt').write_text(thread)
event(type='item.completed',item={'type':'file_change','changes':[{'path':'proof.txt','kind':'add'}]})
event(type='item.completed',item={'type':'agent_message','text':'I am '+cwd.name+'; thread '+thread+'; I wrote proof.txt.'})
event(type='turn.completed',usage={'input_tokens':10,'output_tokens':5})
'''


class CodexWorkers(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        fake = self.base / 'fake_codex.py'
        fake.write_text(FAKE, encoding='utf-8')
        self.env = patch.dict(os.environ, {'HIGGS_HOME': str(self.base / 'home'),
            'DONNA_CODEX_BIN': str(fake), 'CODEX_THREAD_ID': 'fake-brain-session'})
        self.env.start()
        herd.new('donna', kind='codex', project=str(self.base))

    def tearDown(self):
        for agent in herd.ls():
            if agent['name'] != 'donna': herd.close(agent['name'])
        time.sleep(.3)
        self.env.stop()
        self.temp.cleanup()

    def worker(self, name):
        path = self.base / name
        path.mkdir()
        herd.new(name, kind='codex', project=str(path))
        return path

    def wait(self, check):
        until = time.monotonic() + 12
        while time.monotonic() < until:
            if value := check(): return value
            time.sleep(.03)
        self.fail('worker did not reach the expected state')

    def finished(self, name, tid):
        return herd.capture(name)['tasks'].get(tid, {}).get('state') in ('done', 'failed')

    def test_parallel_workers_office_and_one_briefing(self):
        goal = herd.send('donna', 'Build the page')
        paths = [self.worker(n) for n in ('Ava', 'Ben')]
        herd.reply('donna', goal, 'take', '')
        herd.reply('donna', goal, 'note', 'Hiring Ava and Ben')
        jobs = [(name, herd.send(name, 'Build your part')) for name in ('Ava', 'Ben')]
        def working():
            rows = [w for w in herd.office()['workers'] if not w.get('lead')]
            return rows if len(rows) == 2 and all(w['status'] == 'working' and w['currentAction'].startswith('Running') for w in rows) else None
        rows = self.wait(working)
        self.assertEqual({w['name'] for w in rows}, {'Ava', 'Ben'})
        self.assertEqual(herd.office()['workers'][0]['currentAction'], 'Hiring Ava and Ben')
        self.assertNotEqual(rows[0]['voice'], rows[1]['voice'])
        self.wait(lambda: all(self.finished(n,t) for n,t in jobs))
        starts = [json.loads((p/'runs.jsonl').read_text().splitlines()[0])['at'] for p in paths]
        self.assertLess(abs(starts[1]-starts[0]), .6)
        self.assertTrue(all((p/'proof.txt').is_file() for p in paths))
        herd.reply('donna', goal, 'say', 'Ava and Ben built the page; I reviewed it.')
        office = herd.office()
        self.assertTrue(all(w['status'] == 'done' for w in office['workers'][1:]))
        self.assertEqual(len(office['briefings']), 1)
        self.assertEqual({c['name'] for c in office['briefings'][0]['contributors']}, {'Ava','Ben'})
        self.assertEqual(herd.rj(herd.root()/'donna/meta.json')['session'], 'fake-brain-session')

    def test_followups_queue_and_resume_the_exact_thread(self):
        path = self.worker('Maya')
        first = herd.send('Maya', 'Build a quiz')
        self.wait(lambda: herd.capture('Maya')['tasks'][first]['state'] == 'in_progress')
        second = herd.send('Maya', 'On the phone with the person: What did you build?')
        self.wait(lambda: self.finished('Maya',first) and self.finished('Maya',second))
        runs = [json.loads(l) for l in (path/'runs.jsonl').read_text().splitlines()]
        self.assertEqual(len(runs), 2)
        self.assertNotIn('resume', runs[0]['args'])
        self.assertIn('resume', runs[1]['args'])
        self.assertEqual(runs[0]['thread'], runs[1]['thread'])
        results = [m for m in herd.lines(herd.root()/'Maya/outbox.jsonl') if m['kind']=='say']
        self.assertEqual(len(results), 2)
        self.assertIn('Maya',results[-1]['text'])

    def test_failure_is_not_reported_as_success(self):
        self.worker('Finn')
        tid = herd.send('Finn', 'fail task')
        self.wait(lambda: self.finished('Finn',tid))
        self.assertEqual(herd.capture('Finn')['tasks'][tid]['state'], 'failed')
        self.assertEqual(herd.capture('Finn')['outbox'][-1]['kind'], 'fail')
        self.assertEqual(herd.office()['workers'][1]['status'], 'failed')

    def test_native_brain_ack_is_not_a_completion(self):
        meta = herd.root()/'donna/meta.json'
        herd.write_json(meta,{**herd.rj(meta),'native_brain':True})
        tid = herd.send('donna','Plan a page and delegate it')
        self.wait(lambda: bool(herd.lines(herd.root()/'donna/usage.jsonl')))
        self.assertEqual(herd.capture('donna')['tasks'][tid]['state'],'in_progress')
        self.assertFalse(any(o['kind'] in ('say','fail') for o in herd.capture('donna')['outbox']))


if __name__ == '__main__':
    unittest.main()
