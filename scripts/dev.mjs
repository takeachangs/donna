import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const children=[];
const listening=port=>new Promise(resolve=>{
 const socket=createConnection({host:'127.0.0.1',port});
 socket.once('connect',()=>{socket.destroy();resolve(true)});
 socket.once('error',()=>resolve(false));
});
for(const port of [3003,5183])if(await listening(port)){
 console.error(`Port ${port} is occupied. Stop the existing Agency dev process before running npm run dev.`);
 process.exit(1);
}
function shutdown(code=0){for(const child of children)child.kill();process.exit(code)}
function launch(args){
 const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});
 children.push(child);
 child.once('error',err=>{console.error(err.message);shutdown(1)});
 child.once('exit',code=>shutdown(code??0));
}
// No watcher on the execution server: frontend edits must not interrupt a native task.
launch(['--import','tsx','apps/server/src/agency/server.ts']);
launch(['node_modules/vite/bin/vite.js','--config','apps/web/vite.config.ts']);
console.log('Personal Agency: http://127.0.0.1:5183/');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>shutdown());
