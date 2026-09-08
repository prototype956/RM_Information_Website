import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Each run gets its own accounts, database and uploaded files.
const root=resolve('artifacts/qa-data');
mkdirSync(root,{recursive:true});
const data=mkdtempSync(resolve(root,'neon-'));
const server=spawn(process.execPath,['server/index.js','--production'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:data},stdio:['ignore','pipe','inherit']});
const ready=new Promise((resolveReady,reject)=>{
 const timeout=setTimeout(()=>reject(new Error('QA server did not start')),15000);
 server.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolveReady(match[0]);}});
 server.once('error',error=>{clearTimeout(timeout);reject(error);});
 server.once('exit',code=>{clearTimeout(timeout);reject(new Error(`QA server exited: ${code}`));});
});
async function run(file,url){await new Promise((resolveRun,reject)=>{const child=spawn(process.execPath,[file],{env:{...process.env,TEST_URL:url},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolveRun():reject(new Error(`${file} failed (${code})`)));});}
try{
 const url=await ready;
 writeFileSync('artifacts/qa-data/latest.json',JSON.stringify({data,url,startedAt:new Date().toISOString()},null,2));
 await run('tests/browser.mjs',url);
 await run('tests/visual.mjs',url);
 await run('tests/roadmaps-browser.mjs',url);
 await run('tests/taxonomy-browser.mjs',url);
 await run('tests/requests-browser.mjs',url);
}catch(error){console.error(error.message);process.exitCode=1;}finally{server.kill();}
