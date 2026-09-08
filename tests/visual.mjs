import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright-core');
const base=process.env.TEST_URL||'http://127.0.0.1:5175';
assert.notEqual(new URL(base).port,'5173','Use an isolated QA server, never the daily database.');
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
await context.addInitScript(()=>localStorage.setItem('rm-motion','off'));
const page=await context.newPage(),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
mkdirSync('artifacts/neon',{recursive:true});
const settle=async()=>{await page.locator('h1').waitFor();await page.evaluate(()=>document.fonts.ready);await page.locator('.loading').waitFor({state:'hidden'});};
async function inspect(name,width){
 await settle();
 const geometry=await page.evaluate(()=>({
  width:innerWidth,scroll:document.documentElement.scrollWidth,
  clipped:[...document.querySelectorAll('h1 .hero-line-inner')].filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent),
  overflow:[...document.querySelectorAll('main h1,main h2,main .field,main .resource-main,main .search-field')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left<-1);}).map(e=>e.className),
  smallButtons:[...document.querySelectorAll('main button,header button,.auth-card button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.getAttribute('role')!=='switch'&&(r.width<43||r.height<43);}).map(e=>({label:e.getAttribute('aria-label')||e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))
 }));
 assert.equal(geometry.scroll,width,`${name} horizontal overflow`);
 assert.deepEqual(geometry.clipped,[],`${name} heading clipped`);
 assert.deepEqual(geometry.overflow,[],`${name} content outside viewport`);
 assert.deepEqual(geometry.smallButtons,[],`${name} undersized action`);
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 const violations=axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
 results.push({page:name,width,geometry,violations});
 if(violations.length)console.log(JSON.stringify({name,width,violations}));
}
try{
 await page.goto(base+'/login');
 await page.getByLabel('邮箱',{exact:true}).fill('qa-admin@example.test');
 await page.getByLabel('密码',{exact:true}).fill('Local-test-password-123');
 await page.getByRole('button',{name:'进入资料中心',exact:true}).click();
 await page.getByRole('heading',{name:'最近更新',exact:false}).waitFor();
 for(const width of [1440,768,360]){
  await page.setViewportSize({width,height:width===360?800:1050});
  for(const [name,path]of [['home','/'],['list','/resources'],['detail','/resources/sample-5'],['upload','/resources/new'],['edit','/resources/sample-2/edit'],['favorites','/favorites'],['uploads','/uploads'],['admin','/admin']]){
   await page.goto(base+path);await settle();
   if(name==='detail')await page.locator('.image-preview img').evaluate(e=>e.decode());
   if(name==='home'){const bottom=await page.locator('[data-search]').evaluate(e=>e.getBoundingClientRect().bottom);assert.ok(bottom<(width===360?800:1050),'Search must be in the first viewport');}
   await inspect(name,width);
   if(['home','list','detail','upload'].includes(name))await page.screenshot({path:`artifacts/neon/${name}-${width===1440?'desktop':width===360?'mobile':'tablet'}.png`,fullPage:true});
  }
 }
 // Filter dialog: focus stays inside, Escape dismisses, focus returns to the trigger.
 await page.goto(base+'/resources');await settle();
 const filter=page.getByRole('button',{name:'筛选',exact:true});await filter.click();
 const modal=page.getByRole('dialog');await modal.waitFor();
 for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.ok(await modal.evaluate(el=>el.contains(document.activeElement)));}
 await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.activeElement?.textContent.includes('筛选'));
 // Menu and drawer use the same Escape and focus behavior.
 await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'打开导航'}).click();await page.getByRole('dialog',{name:'资料导航'}).waitFor();
 for(let i=0;i<16;i++){await page.keyboard.press('Tab');assert.ok(await page.getByRole('dialog',{name:'资料导航'}).evaluate(el=>el.contains(document.activeElement)));}
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'资料导航'}).waitFor({state:'hidden'});
 // Invalid HTTP link is associated with its input, and submission stays on the form.
 await page.goto(base+'/resources/new');await settle();await page.getByRole('tab',{name:'分享链接'}).click();
 await page.getByLabel('资料标题',{exact:false}).fill('浏览器测试 · 无效链接');
 await page.getByLabel('资料链接',{exact:true}).fill('ftp://example.org');
 await page.getByRole('button',{name:'发布资料',exact:true}).click();
 await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('资料链接',{exact:true}).getAttribute('aria-invalid'),'true');
 assert.equal(await page.getByLabel('资料链接',{exact:true}).getAttribute('aria-describedby').then(x=>x.includes('resource-error')),true);
 // Login screenshots use an unauthenticated context and the real existing login form.
 const guest=await browser.newContext({reducedMotion:'reduce'}),login=await guest.newPage();
 for(const width of [1440,768,360]){
  await login.setViewportSize({width,height:width===360?800:1050});await login.goto(base+'/resources/sample-2');await login.getByRole('heading',{name:'欢迎回来，队友。'}).waitFor();await login.evaluate(()=>document.fonts.ready);
  assert.equal(await login.evaluate(()=>document.documentElement.scrollWidth),width);
  const clipped=await login.locator('.hero-line-inner').evaluateAll(els=>els.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent));assert.deepEqual(clipped,[]);
  const axe=await new AxeBuilder({page:login}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();results.push({page:'login',width,violations:axe.violations});
  await login.screenshot({path:`artifacts/neon/login-${width===1440?'desktop':width===360?'mobile':'tablet'}.png`,fullPage:true});
 }
 await guest.close();
 // A blocked animation chunk must leave both the hero and search available.
 const staticContext=await browser.newContext({viewport:{width:1440,height:1050}});
 await staticContext.addCookies(await context.cookies());
 let blockedAnimations=0;
 await staticContext.route('**/*.js',async route=>{const response=await route.fetch();const body=await response.body();if(body.toString().includes('GreenSock')){blockedAnimations++;await route.abort();}else await route.fulfill({response,body});});
 const staticPage=await staticContext.newPage();await staticPage.goto(base+'/');await staticPage.getByRole('heading',{name:'最近更新',exact:false}).waitFor();
 assert.ok(await staticPage.getByRole('textbox',{name:'搜索资料'}).isVisible());
 assert.ok(await staticPage.locator('.hero-line-inner').first().isVisible());
 await staticPage.getByRole('textbox',{name:'搜索资料'}).fill('STM32');await staticPage.getByRole('button',{name:'搜索',exact:true}).click();await staticPage.getByRole('heading',{name:'“STM32” 的搜索结果'}).waitFor();
 assert.ok(blockedAnimations>0,'The GSAP chunk must actually be blocked for this fallback check');
 await staticContext.close();
 assert.deepEqual(errors,[]);
 writeFileSync('artifacts/neon/visual-results.json',JSON.stringify({results,errors},null,2));
 assert.equal(results.flatMap(r=>r.violations).length,0,'Resolve accessibility violations in visual-results.json');
 console.log(JSON.stringify({layouts:results.length,screenshots:15,accessibilityViolations:0,errors,interactionChecks:['focus trap','focus restore','Escape','invalid link association','animation failure']}));
}catch(e){writeFileSync('artifacts/neon/visual-results.json',JSON.stringify({results,errors,failure:e.message},null,2));await page.screenshot({path:'artifacts/neon/visual-failure.png',fullPage:true});console.error(e);process.exitCode=1;}finally{await browser.close();}
