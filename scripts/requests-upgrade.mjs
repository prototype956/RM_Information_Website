import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync,readdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('artifacts/requests-upgrade'),mode=process.argv[2];assert.ok(['before','after'].includes(mode));mkdirSync(dir,{recursive:true});const db=new DatabaseSync(path.resolve('data/resources.db'),{readOnly:true});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),result={};
for(const table of ['users','sessions','invitations','resources','attachments','favorites','roadmaps','roadmap_progress','taxonomy_options','taxonomy_meta','taxonomy_aliases']){const rows=db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();result[table]={count:rows.length,sha256:hash(rows)};}
const files=readdirSync('data/files').sort().map(name=>({name,hash:createHash('sha256').update(readFileSync(path.join('data/files',name))).digest('hex')}));result.files={count:files.length,sha256:hash(files)};
if(mode==='before'){const dest=path.join(dir,'resources-before-requests.db');assert.equal(existsSync(dest),false,'Do not overwrite the backup');await backup(db,dest);writeFileSync(path.join(dir,'before.json'),JSON.stringify(result,null,2));}else{assert.deepEqual(result,JSON.parse(readFileSync(path.join(dir,'before.json'),'utf8')));assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('SELECT count(*) AS n FROM taxonomy_requests').get().n,0,'Do not insert test requests in real data');writeFileSync(path.join(dir,'after.json'),JSON.stringify({...result,preserved:true},null,2));}db.close();console.log(JSON.stringify({mode,preserved:mode==='after',counts:Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.count]))}));
