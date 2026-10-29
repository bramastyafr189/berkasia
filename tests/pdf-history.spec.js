import {test, expect} from '@playwright/test';
import {PDFDocument, StandardFonts} from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readFile} from 'node:fs/promises';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGP8z4APMOGVHbHSAEEsAROYnfdQAAAAAElFTkSuQmCC','base64');
async function sourcePDF(){const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);for(const text of ['FIRST','SECOND','THIRD'])doc.addPage([250,250]).drawText(text,{x:20,y:190,font});return Buffer.from(await doc.save());}
const file=(name,mimeType,buffer)=>({name,mimeType,buffer});
async function openEditor(page){await page.goto('/');await page.getByRole('button',{name:'Kelola PDF'}).click();await page.locator('#pdf-start').setInputFiles(file('source.pdf','application/pdf',await sourcePDF()));await expect(page.getByText('3 halaman',{exact:true})).toBeVisible();}
async function pageTexts(buffer){const pdf=await pdfjs.getDocument({data:new Uint8Array(buffer)}).promise,result=[];for(let i=1;i<=pdf.numPages;i++)result.push((await(await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' '));await pdf.cleanup();return result;}
test('delete all pages can be undone and redone, and new edits clear redo',async({page})=>{
 await openEditor(page);const undo=page.locator('#pdf-undo'),redo=page.locator('#pdf-redo');await expect(undo).toBeDisabled();
 for(let i=1;i<=3;i++)await page.getByRole('button',{name:`Hapus halaman ${i}`}).click();await expect(page.getByText('0 halaman',{exact:true})).toBeVisible();await expect(page.locator('#save-pdf')).toBeDisabled();
 await undo.click();await expect(page.getByText('1 halaman',{exact:true})).toBeVisible();await expect(page.locator('#save-pdf')).toBeEnabled();await redo.click();await expect(page.getByText('0 halaman',{exact:true})).toBeVisible();
 await undo.click();await page.getByRole('button',{name:'Putar halaman 3'}).click();await expect(redo).toBeDisabled();
});
test('replacement can be undone and redone, including saved document',async({page})=>{
 await openEditor(page);const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Ganti halaman 2'}).click()]);await chooser.setFiles(file('replacement.pdf','application/pdf',await sourcePDF()));
 await page.getByRole('radio',{name:'Halaman sumber 3 Halaman 3'}).check();await page.getByRole('button',{name:'Gunakan halaman'}).click();
 await expect(page.locator('.page-info').nth(1)).toHaveAttribute('title','replacement.pdf, halaman sumber 3');await page.locator('#pdf-undo').click();await expect(page.locator('.page-info').nth(1)).toHaveAttribute('title','source.pdf, halaman sumber 2');await page.locator('#pdf-redo').click();await expect(page.locator('.page-info').nth(1)).toHaveAttribute('title','replacement.pdf, halaman sumber 3');
 await page.getByRole('button',{name:'Simpan PDF'}).click();const link=page.getByRole('link',{name:'Unduh PDF'});await expect(link).toBeVisible();const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);expect(await pageTexts(await readFile(await download.path()))).toEqual(['FIRST','THIRD','THIRD']);
 await page.locator('#pdf-undo').click();await expect(link).toBeHidden();
});
test('keyboard shortcuts undo, redo and preserve editing focus',async({page})=>{
 await openEditor(page);await page.getByRole('button',{name:'Pindah ke kiri halaman 3'}).click();await expect(page.locator('.page-info').nth(1)).toHaveAttribute('title','source.pdf, halaman sumber 3');
 await page.keyboard.press('Control+z');await expect(page.locator('.page-info').nth(1)).toHaveAttribute('title','source.pdf, halaman sumber 2');await page.keyboard.press('Control+Shift+z');await expect(page.locator('.page-info').nth(1)).toHaveAttribute('title','source.pdf, halaman sumber 3');
 await page.getByRole('button',{name:'Mulai ulang'}).click();await page.locator('#pdf-start').setInputFiles(file('source.pdf','application/pdf',await sourcePDF()));await expect(page.locator('#pdf-undo')).toBeDisabled();
});
test('undo and redo cover rotation, duplication, and English labels',async({page})=>{
 await openEditor(page);await page.getByRole('button',{name:'Putar halaman 1'}).click();await page.getByRole('button',{name:'Duplikat halaman 1'}).click();await expect(page.getByText('4 halaman',{exact:true})).toBeVisible();await page.locator('#pdf-undo').click();await expect(page.getByText('3 halaman',{exact:true})).toBeVisible();await page.locator('#pdf-undo').click();await expect(page.locator('.page-preview img').first()).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');await page.locator('#pdf-redo').click();await page.locator('#pdf-redo').click();await expect(page.getByText('4 halaman',{exact:true})).toBeVisible();await page.locator('[data-lang=en]').click();await expect(page.getByRole('button',{name:'Undo'})).toBeEnabled();await expect(page.getByRole('button',{name:'Redo'})).toBeDisabled();
});

test('individual deleted and replaced pages can be restored without reverting other edits',async({page})=>{
 await openEditor(page);await page.getByRole('button',{name:'Hapus halaman 1'}).click();await page.getByRole('button',{name:'Hapus halaman 3'}).click();await expect(page.locator('.page-card--deleted')).toHaveCount(2);await page.getByRole('button',{name:'Pulihkan halaman 1'}).click();await expect(page.getByText('2 halaman',{exact:true})).toBeVisible();
 const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Ganti halaman 2'}).click()]);await chooser.setFiles(file('replacement.pdf','application/pdf',await sourcePDF()));await page.getByRole('radio',{name:'Halaman sumber 3 Halaman 3'}).check();await page.getByRole('button',{name:'Gunakan halaman'}).click();
 await page.getByRole('button',{name:'Tukar versi halaman 2'}).click();await expect(page.locator('.page-info').nth(1)).toHaveAttribute('title','source.pdf, halaman sumber 2');await page.getByRole('button',{name:'Tukar versi halaman 2'}).click();await expect(page.locator('.page-info').nth(1)).toHaveAttribute('title','replacement.pdf, halaman sumber 3');
 await page.getByRole('button',{name:'Simpan PDF'}).click();const link=page.getByRole('link',{name:'Unduh PDF'});await expect(link).toBeVisible();const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);expect(await pageTexts(await readFile(await download.path()))).toEqual(['FIRST','THIRD']);
 await page.locator('[data-lang=en]').click();await expect(page.getByRole('button',{name:'Restore page 3'})).toBeVisible();await expect(page.getByText('Excluded from output')).toBeVisible();
});

test('touch drag reorders pages and keeps source numbers through undo and export',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openEditor(page);await page.emulateMedia({reducedMotion:'reduce'});
 const cards=page.locator('.page-card');const handle=cards.nth(0).locator('.page-drag-handle');await handle.scrollIntoViewIfNeeded();
 const first=await handle.boundingBox(),target=await cards.nth(1).boundingBox();const cdp=await page.context().newCDPSession(page);
 const point=(x,y)=>({x:Math.round(x),y:Math.round(y)});const start=point(first.x+first.width/2,first.y+first.height/2),end=point(target.x+target.width/2,target.y+60);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[end]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(cards.nth(1).locator('.page-origin')).toContainText('Halaman sumber 1');await expect(cards.nth(0).locator('.page-origin')).toContainText('Halaman sumber 2');
 await page.locator('#pdf-undo').click();await expect(cards.nth(0).locator('.page-origin')).toContainText('Halaman sumber 1');await page.locator('#pdf-redo').click();
 await page.getByRole('button',{name:'Simpan PDF'}).click();const link=page.getByRole('link',{name:'Unduh PDF'});await expect(link).toBeVisible();const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);expect(await pageTexts(await readFile(await download.path()))).toEqual(['SECOND','FIRST','THIRD']);
 await page.locator('[data-lang=en]').click();await expect(cards.nth(1).locator('.page-origin')).toContainText('Source page 1');
});
