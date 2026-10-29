import {test, expect} from '@playwright/test';
import {PDFDocument, StandardFonts} from 'pdf-lib';
async function pdfFile(){const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);for(let i=0;i<3;i++)doc.addPage([300,400]).drawText(`Page ${i+1}`,{x:20,y:300,font});return {name:'sample.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())};}
for(const language of ['id','en']) {
 test(`responsive tools and controls in ${language}`,async({page})=>{
  await page.goto('/'); await page.locator(`[data-lang="${language}"]`).click();
  const names=language==='id'?['Kompres','Konversi','Kelola PDF']:['Compress','Convert','Manage PDF'];
  for(const width of [280,320,375,430,600,601,768,1024,1440]){
   await page.setViewportSize({width,height:800});
   for(const name of names){await page.getByRole('button',{name,exact:true}).click(); const geometry=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,tabs:[...document.querySelectorAll('.nav-item')].map(button=>{const rect=button.getBoundingClientRect();return {left:rect.left,right:rect.right,inner:button.clientWidth,scroll:button.scrollWidth,height:rect.height};})})); expect(geometry.scroll,`${name} ${language} ${width}px page overflow`).toBeLessThanOrEqual(geometry.width);for(const tab of geometry.tabs){expect(tab.left).toBeGreaterThanOrEqual(0);expect(tab.right).toBeLessThanOrEqual(width+1);expect(tab.scroll,`tab text at ${width}px`).toBeLessThanOrEqual(tab.inner);expect(tab.height).toBeGreaterThanOrEqual(40);}}
  }
  await page.setViewportSize({width:320,height:800});
  await page.locator('#pdf-start').setInputFiles(await pdfFile());await expect(page.locator('.page-card')).toHaveCount(3);
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#add-pages').click()]);await chooser.setFiles(await pdfFile());await expect(page.locator('#page-dialog')).toBeVisible();
  const overflow=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,dialog:document.querySelector('#page-dialog').getBoundingClientRect().right}));expect(overflow.scroll).toBeLessThanOrEqual(overflow.width);expect(overflow.dialog).toBeLessThanOrEqual(overflow.width);
 });
}
test('mobile navigation hides while scrolling down and returns when scrolling up',async({page})=>{
 await page.setViewportSize({width:375,height:800});await page.goto('/');const nav=page.locator('.nav');await expect(nav).not.toHaveClass(/nav--hidden/);const before=await nav.boundingBox();expect(before.y).toBeGreaterThan(600);
 await page.evaluate(()=>window.scrollTo(0,600));await expect(nav).toHaveClass(/nav--hidden/);await page.evaluate(()=>window.scrollTo(0,300));await expect(nav).not.toHaveClass(/nav--hidden/);await page.getByRole('button',{name:'Konversi',exact:true}).click();await expect(page.locator('#file-workspace h2')).toHaveText('Konversi file');
 await page.setViewportSize({width:1024,height:800});await expect(nav).not.toHaveClass(/nav--hidden/);expect(await nav.evaluate(el=>getComputedStyle(el).position)).not.toBe('fixed');
});
test('floating mobile navigation retains accessible labels and contrast',async({page})=>{
 await page.setViewportSize({width:375,height:800});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');const {default:AxeBuilder}=await import('@axe-core/playwright');const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();expect(results.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);for(const name of ['Kompres','Konversi','Kelola PDF'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
});
test('mobile active capsule slides to each selected menu',async({page})=>{
 await page.setViewportSize({width:375,height:800});await page.goto('/');const nav=page.locator('.nav');await expect(nav).toHaveAttribute('data-active','compress');
 const offset=async()=>page.evaluate(()=>{const nav=document.querySelector('.nav'),style=getComputedStyle(nav,'::before'),matrix=new DOMMatrixReadOnly(style.transform);return matrix.m41;});
 const first=await offset();await page.getByRole('button',{name:'Konversi',exact:true}).click();await expect(nav).toHaveAttribute('data-active','convert');await expect.poll(offset).toBeGreaterThan(first+30);const second=await offset();await page.getByRole('button',{name:'Kelola PDF'}).click();await expect(nav).toHaveAttribute('data-active','pdf');await expect.poll(offset).toBeGreaterThan(second+30);await expect(page.locator('.nav-item.active')).toHaveAttribute('data-tool','pdf');
});

test('desktop capsule slides across the navigation',async({page})=>{
 await page.setViewportSize({width:1024,height:800});await page.goto('/');const nav=page.locator('.nav');const offset=()=>nav.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el,'::before').transform).m41);const start=await offset();await page.getByRole('button',{name:'Konversi',exact:true}).click();await expect.poll(offset).toBeGreaterThan(start+30);const middle=await offset();await page.getByRole('button',{name:'Kelola PDF',exact:true}).click();await expect.poll(offset).toBeGreaterThan(middle+30);
});
