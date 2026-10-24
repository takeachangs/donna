import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const root=fileURLToPath(new URL('..',import.meta.url));
export function checkRepo(){
 const names=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 const files=[...new Set(names)];
 const allowed=/^(?:apps\/(?:web|server)\/|tests\/|scripts\/|docs\/|licenses\/|\.github\/|(?:README\.md|AGENTS\.md|THIRD_PARTY_NOTICES\.md|\.gitignore|\.gitattributes|\.env\.example|package(?:-lock)?\.json|tsconfig\.json|vitest\.config\.ts)$)/;
 const forbidden=/(^|\/)(?:node_modules|artifacts|\.history|\.runtime|\.cache|dist|candidates|\.git|\.env)(\/|$)|\.(?:wav|pcm|webm|log|jsonl)$/;
 const problems=[];
 let bytes=0;
 const env=path.join(root,'.env');
 const secrets=fs.existsSync(env)?fs.readFileSync(env,'utf8').split(/\r?\n/).flatMap(line=>{
  const match=line.match(/^\s*[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*\s*=\s*["']?([^\r\n]+?)["']?\s*$/);
  return match&&match[1].length>=12?[match[1]]:[];
 }):[];
 for(const file of files){
  if(!allowed.test(file)||forbidden.test(file))problems.push(`Unexpected packaged file: ${file}`);
  const abs=path.join(root,file),stat=fs.lstatSync(abs);
  if(stat.isSymbolicLink()){problems.push(`Symlink is not allowed in source package: ${file}`);continue;}
  if(!stat.isFile()){problems.push(`Not an ordinary source file: ${file}`);continue;}
  const buffer=fs.readFileSync(abs);bytes+=buffer.length;
  if(secrets.some(secret=>buffer.includes(Buffer.from(secret))))problems.push(`Private credential found in ${file}`);
  if(file.endsWith('.gltf')){
   const model=JSON.parse(buffer);
   for(const asset of [...model.buffers||[],...model.images||[]])if(asset.uri&&!asset.uri.startsWith('data:')){
    const dep=path.resolve(path.dirname(abs),asset.uri);
    if(!dep.startsWith(path.resolve(root,'apps/web/public')+path.sep)||!fs.existsSync(dep))problems.push(`Missing/unsafe model dependency: ${file}`);
   }
  }
 }
 for(const file of ['.env','artifacts/agency/workspace.json','.history/private.txt','.runtime/private.txt','releases/private.zip']){
  try{execFileSync('git',['check-ignore','--no-index','-q',file],{cwd:root})}catch{problems.push(`Private path is not ignored: ${file}`)}
 }
 if(problems.length)throw Error(problems.join('\n'));
 return {files:files.length,bytes};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('Source boundary verified:',checkRepo());
