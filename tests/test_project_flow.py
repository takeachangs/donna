"""Offline regressions for attached project scope and result delivery."""
import ast
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import herd


def bridge_function(name, **values):
    """Load a pure bridge helper without starting the phone or importing audio."""
    source = Path(herd.__file__).with_name('bridge.py').read_text(encoding='utf-8')
    node = next(n for n in ast.parse(source).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
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


if __name__ == '__main__': unittest.main()
