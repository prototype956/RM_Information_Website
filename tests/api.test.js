import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let server, base, adminCookie, memberCookie, otherCookie, memberId;
const testDir = mkdtempSync(path.join(tmpdir(), 'rm-resource-test-'));
const admin = { name: '测试管理员', email: 'admin@example.test', password: 'Test-only-12345' };
const member = { name: '测试队员', email: 'member@example.test', password: 'Test-only-12345' };
const payload = { title: 'PID 控制学习笔记', domain: 'rm', category: '电控与嵌入式', tags: JSON.stringify(['PID','入门']), kind: 'link', url: 'https://example.org/docs', description: '测试资料简介' };
async function request(url,{cookie,body,method='GET',headers={}}={}) {
  const response=await fetch(`${base}/api${url}`,{method,headers:{...(cookie?{cookie}:{}),...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>null);
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
}
async function createLink(cookie=memberCookie, fields={}) {
  const body=new FormData();Object.entries({...payload,...fields}).forEach(([key,value])=>body.append(key,value));
  return request('/resources',{method:'POST',cookie,body});
}
before(async()=>{
  server=spawn(process.execPath,['server/index.js'],{env:{...process.env,NODE_ENV:'test',PORT:'0',DATA_DIR:testDir},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server startup timed out')),15000);server.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){base=match[0];clearTimeout(timeout);resolve();}});server.once('exit',code=>{clearTimeout(timeout);reject(Error(`Server exited: ${code}`));});server.stderr.on('data',chunk=>{if(!chunk.toString().includes('ExperimentalWarning'))process.stderr.write(chunk);});});
});
after(async()=>{server?.kill();await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});const target=path.resolve(testDir), parent=path.resolve(tmpdir());if(target.startsWith(parent+path.sep)&&path.basename(target).startsWith('rm-resource-test-'))rmSync(target,{recursive:true,force:true});});

test('unauthenticated users cannot access metadata, content, or management',async()=>{
  for(const url of ['/resources','/resources/sample-1','/files/attachment-0','/invitations'])assert.equal((await request(url)).status,401);
  assert.equal((await request('/auth/status')).data.setupNeeded,true);
});
test('initialize one administrator; private session cookie; cannot bootstrap twice',async()=>{
  const r=await request('/auth/setup',{method:'POST',body:admin});assert.equal(r.status,201);adminCookie=r.cookie;assert.ok(adminCookie);assert.equal(r.data.user.role,'admin');assert.ok(!r.data.user.password);assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Lax/);
  assert.equal((await request('/auth/setup',{method:'POST',body:admin})).status,403);
  assert.equal((await request('/auth/status')).data.setupNeeded,false);
});
test('bad login and cross-origin mutation rejected',async()=>{
  assert.equal((await request('/auth/login',{method:'POST',body:{email:admin.email,password:'wrong'}})).status,401);
  assert.equal((await request('/invitations',{method:'POST',cookie:adminCookie,body:{},headers:{Origin:'https://untrusted.example'}})).status,403);
});
test('invitation is required, expires when revoked, and can be consumed once',async()=>{
  assert.equal((await request('/auth/register',{method:'POST',body:{...member,token:'invalid'}})).status,410);
  const invite=await request('/invitations',{method:'POST',cookie:adminCookie,body:{}});assert.equal(invite.status,201);
  assert.equal((await request(`/auth/invitation/${invite.data.token}`)).status,200);
  const r=await request('/auth/register',{method:'POST',body:{...member,token:invite.data.token}});assert.equal(r.status,201);memberCookie=r.cookie;memberId=r.data.user.id;assert.equal(r.data.user.role,'member');
  assert.equal((await request('/auth/register',{method:'POST',body:{...member,email:'again@example.test',token:invite.data.token}})).status,410);
  const revoked=await request('/invitations',{method:'POST',cookie:adminCookie,body:{}});await request(`/invitations/${revoked.data.id}`,{method:'DELETE',cookie:adminCookie});assert.equal((await request(`/auth/invitation/${revoked.data.token}`)).status,410);
  const other=await request('/invitations',{method:'POST',cookie:adminCookie,body:{}});const second=await request('/auth/register',{method:'POST',body:{...member,email:'other@example.test',token:other.data.token}});otherCookie=second.cookie;
});
test('members cannot issue invitations or use admin operations',async()=>{
  assert.equal((await request('/invitations',{method:'POST',cookie:memberCookie,body:{}})).status,403);
  assert.equal((await request('/invitations',{cookie:memberCookie})).status,403);
});
test('seed data is marked as sample and files are private',async()=>{
  const r=await request('/resources',{cookie:memberCookie});assert.equal(r.status,200);assert.equal(r.data.resources.length,9);assert.ok(r.data.resources.every(x=>x.sample===1));
  assert.equal((await request('/files/attachment-0')).status,401);
  const file=await fetch(`${base}/api/files/attachment-0?preview=1`,{headers:{cookie:memberCookie}});assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/inline/);assert.equal(file.headers.get('cache-control'),'no-store');
});
test('link submission validates metadata and prohibits executable URLs',async()=>{
  for(const name of ['PID','入门']) await request('/taxonomy/tags',{method:'POST',cookie:adminCookie,body:{name}});
  for(const fields of [{url:'javascript:alert(1)'},{url:'bad'},{title:''},{tags:'{}'},{kind:'unknown'}])assert.equal((await createLink(memberCookie,fields)).status,400);
  const valid=await createLink();assert.equal(valid.status,201);
  const r=await request(`/resources/${valid.data.id}`,{cookie:memberCookie});assert.equal(r.data.resource.owner_id,memberId);assert.equal(r.data.resource.sample,0);assert.deepEqual(r.data.resource.tags,['PID','入门']);
});
test('real multipart files are stored and downloadable with original names',async()=>{
  const form=new FormData();Object.entries({...payload,kind:'file',url:''}).forEach(([key,value])=>form.append(key,value));
  form.append('files',new Blob(['actual test content'],{type:'text/plain'}),'测试笔记.txt');
  const r=await request('/resources',{method:'POST',cookie:memberCookie,body:form});assert.equal(r.status,201);
  const detail=(await request(`/resources/${r.data.id}`,{cookie:memberCookie})).data.resource;assert.equal(detail.attachments[0].name,'测试笔记.txt');
  const f=await fetch(`${base}/api/files/${detail.attachments[0].id}`,{headers:{cookie:otherCookie}});assert.equal(f.status,200);assert.equal(await f.text(),'actual test content');assert.match(f.headers.get('content-disposition'),/attachment/);
  const noFile=new FormData();Object.entries({...payload,kind:'file'}).forEach(([k,v])=>noFile.append(k,v));assert.equal((await request('/resources',{method:'POST',cookie:memberCookie,body:noFile})).status,400);
});
test('favorites are personal, detail visits recorded, and ownership enforced',async()=>{
  const {data}=await createLink();const id=data.id;
  assert.equal((await request(`/resources/${id}/favorite`,{method:'POST',cookie:memberCookie,body:{}})).data.favorite,true);
  assert.equal((await request(`/resources/${id}`,{cookie:memberCookie})).data.resource.favorite,true);
  assert.equal((await request(`/resources/${id}`,{cookie:otherCookie})).data.resource.favorite,false);
  assert.ok((await request('/resources',{cookie:memberCookie})).data.recent.includes(id));
  assert.equal((await request(`/resources/${id}`,{method:'PATCH',cookie:otherCookie,body:{...payload,title:'steal'}})).status,403);
  assert.equal((await request(`/resources/${id}`,{method:'DELETE',cookie:otherCookie})).status,403);
  assert.equal((await request(`/resources/${id}`,{method:'PATCH',cookie:memberCookie,body:{...payload,title:'更新的学习笔记'}})).status,200);
  assert.equal((await request(`/resources/${id}`,{cookie:memberCookie})).data.resource.title,'更新的学习笔记');
  assert.equal((await request(`/resources/${id}`,{method:'PATCH',cookie:adminCookie,body:{...payload,hidden:false}})).status,400);
  assert.equal((await request(`/resources/${id}`,{method:'PATCH',cookie:memberCookie,body:{hidden:true}})).status,403);
  assert.equal((await request(`/resources/${id}`,{method:'PATCH',cookie:adminCookie,body:{hidden:true}})).status,200);
  assert.equal((await request(`/resources/${id}`,{cookie:otherCookie})).status,404);
  assert.ok(!(await request('/resources',{cookie:otherCookie})).data.resources.some(x=>x.id===id));
  assert.equal((await request(`/resources/${id}`,{cookie:memberCookie})).status,200);
  await request(`/resources/${id}`,{method:'PATCH',cookie:adminCookie,body:{hidden:false}});
  assert.equal((await request(`/resources/${id}`,{cookie:otherCookie})).status,200);
  assert.equal((await request(`/resources/${id}`,{method:'DELETE',cookie:memberCookie})).status,200);
  assert.equal((await request(`/resources/${id}`,{cookie:adminCookie})).status,404);
});
test('logout invalidates session',async()=>{
  assert.equal((await request('/auth/logout',{method:'POST',cookie:memberCookie,body:{}})).status,200);
  assert.equal((await request('/me',{cookie:memberCookie})).status,401);
});

