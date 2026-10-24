import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// The checks live in the server so `npm start` runs the same ones.
const r=spawnSync(process.execPath,['--import','tsx','apps/server/src/agency/doctor.ts'],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:'inherit'});
process.exit(r.status??1);
