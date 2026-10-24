import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkRepo, root } from './check-repo.mjs';
const info = checkRepo();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain'))
  throw Error('Commit source changes before packaging; the archive uses the committed tree.');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const commit = git('rev-parse', '--short', 'HEAD');
const target = path.join(root, 'releases', `chamber-${version}-${commit}.zip`);
fs.mkdirSync(path.dirname(target), { recursive: true });
git('archive', '--format=zip', '--prefix=chamber/', '-o', target, 'HEAD');
const hash = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
fs.writeFileSync(target + '.sha256', hash + '  ' + path.basename(target) + '\n');
console.log({ archive: target, commit, sourceFiles: info.files, archiveBytes: fs.statSync(target).size, sha256: hash });
