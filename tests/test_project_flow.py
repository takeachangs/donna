"""Offline regressions for attached project scope and result delivery."""
import ast
import asyncio
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
import notifications


def bridge_function(name, **values):
    """Load a pure bridge helper without starting the phone or importing audio."""
    source = Path(herd.__file__).with_name('bridge.py').read_text(encoding='utf-8')
    node = next(n for n in ast.walk(ast.parse(source)) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    scope = dict(os=os, herd=herd, **values)
    exec(compile(ast.Module(body=[node], type_ignores=[]), 'bridge.py', 'exec'), scope)
    return scope[name]


class ProjectFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {'HIGGS_HOME': str(self.base/'home')})
        self.env.start()
        self.project = self.base/'current-project'
        self.project.mkdir()
        (self.base/'unrelated-private-project').mkdir()
        herd.new('donna', project=str(self.project))

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_project_context_and_mail_use_registered_project(self):
        text = herd.project_context()
        self.assertIn(str(self.project), text)
        self.assertNotIn('unrelated-private-project', text)
        self.assertIn('Never enumerate parent or sibling', text)
        with patch.object(herd, 'wake'):
            tid = herd.send('donna', 'What projects do we have here?')
        mail = herd.lines(herd.root()/'donna/inbox.jsonl')[-1]
        self.assertEqual(mail['project'], str(self.project))
        self.assertEqual(mail['id'], tid)

    def test_voice_gets_scope_without_optional_seed_and_preserves_callback(self):
        context = self.base/'context.txt'
        seed = bridge_function('context_seed', CONTEXT=str(context))
        self.assertIn(str(self.project), seed())
        context.write_text('Calling about: Your page is ready.\nA custom note.', encoding='utf-8')
        self.assertTrue(seed().startswith('Calling about: Your page is ready.'))
        self.assertIn(str(self.project), seed())

    def test_result_snapshot_survives_source_changes_and_is_visible_in_report(self):
        with patch.object(herd, 'wake'): tid = herd.send('donna', 'Build a standalone page')
        page = self.project/'index.html'; page.write_text('<h1>Reviewed result</h1>', encoding='utf-8')
        item = herd.result('donna', tid, page, 'My page')
        herd.reply('donna', tid, 'say', 'Done. Use Open result in the report.')
        page.write_text('<h1>Unreviewed edit</h1>', encoding='utf-8')
        snapshot = herd.home()/'results'/item['id']/item['file']
        self.assertIn('Reviewed result', snapshot.read_text())
        self.assertEqual(herd.office()['briefings'][-1]['artifacts'], [item])

    def test_results_cannot_publish_sibling_files_or_unknown_tasks(self):
        with patch.object(herd, 'wake'): tid = herd.send('donna', 'Build a page')
        outside = self.base/'unrelated-private-project'/'private.html'
        outside.write_text('private', encoding='utf-8')
        with self.assertRaises(SystemExit): herd.result('donna', tid, outside)
        with self.assertRaises(SystemExit): herd.result('donna', 'missing-task', outside)

    def finish(self, text='The page is ready. Use Open result in the report.'):
        with patch.object(herd, 'wake'): tid = herd.send('donna', 'Update the page')
        herd.reply('donna', tid, 'say', text)
        return tid

    def test_restart_recovers_unspoken_result_and_ack_prevents_replay(self):
        tid = self.finish()
        async def boot(expect_result):
            queue = asyncio.Queue()
            watch = bridge_function('watch_outbox', asyncio=asyncio, time=time, SAYS=queue, CLAIMED=set(), NOW={'call':None})
            task = asyncio.create_task(watch())
            try:
                if expect_result:
                    item = await asyncio.wait_for(queue.get(), 1)
                    self.assertEqual(item[1], tid)
                else:
                    with self.assertRaises(asyncio.TimeoutError): await asyncio.wait_for(queue.get(), .4)
            finally:
                task.cancel()
                try: await task
                except asyncio.CancelledError: pass
        asyncio.run(boot(True))
        self.assertEqual(herd.office()['briefings'][-1]['status'], 'queued')
        asyncio.run(boot(True))  # a crash before speech must not lose the result
        notifications.acknowledge(notifications.pending()[0])
        self.assertEqual(herd.office()['briefings'][-1]['status'], 'presented')
        asyncio.run(boot(False))

    def test_resolved_questions_replacements_and_other_projects_do_not_ring(self):
        with patch.object(herd, 'wake'):
            ask = herd.send('donna', 'Pick a color')
            herd.reply('donna', ask, 'ask', 'Blue?')
            self.assertEqual(len(notifications.pending()), 1)
            herd.send('donna', 'Yes', reply_to=ask)
            self.assertEqual(notifications.pending(), [])
            old = self.finish('Old version ready')
            herd.send('donna', 'Do the new version', replaces=old)
            self.assertEqual(notifications.pending(), [])
            self.finish('This project result')
        meta = herd.root()/'donna/meta.json'
        herd.write_json(meta, {**herd.rj(meta), 'project':str(self.base/'other-project')})
        self.assertEqual(notifications.pending(), [])

    def test_same_artifact_and_report_are_announced_once_for_refinement(self):
        first, second = self.finish(), self.finish()
        page=self.project/'index.html'; page.write_text('<p>One reviewed deliverable</p>')
        for tid in (first,second): herd.result('donna',tid,page)
        messages=notifications.pending()
        self.assertEqual(len(messages),1)
        self.assertEqual({r['id'] for r in messages[0]['receipts']},{first,second})
        notifications.acknowledge(messages[0])
        self.assertEqual(notifications.pending(),[])
        self.assertTrue(all(b['status']=='presented' for b in herd.office()['briefings']))

    def test_interrupted_or_failed_audio_is_not_acknowledged(self):
        self.finish(); message=notifications.pending()[0]
        for epoch, failed in ((0,False),(1,True)):
            confirm=bridge_function('confirm_spoken',asyncio=asyncio,time=time,notifications=notifications,
                                    receipt_epoch=1,st={'audio_failed':failed})
            asyncio.run(confirm([message],time.monotonic(),epoch))
            self.assertEqual(len(notifications.pending()),1)
        confirm=bridge_function('confirm_spoken',asyncio=asyncio,time=time,notifications=notifications,
                                receipt_epoch=1,st={})
        asyncio.run(confirm([message],time.monotonic()+.02,1))
        self.assertEqual(notifications.pending(),[])

    def test_callback_greeting_is_not_a_delivered_result(self):
        message={'text':'Ava fixed the counter and I reviewed the file. Use Open result in the report.'}
        self.assertFalse(notifications.conveys(message,"Hi, it's Donna. I'm calling to check on the counter."))
        self.assertTrue(notifications.conveys(message,"Hi, it's Donna. Ava fixed the counter and I reviewed the file. Use Open result in the report."))


if __name__ == '__main__': unittest.main()
