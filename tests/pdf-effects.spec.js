import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { PNG } from 'pngjs';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

// A red page through a 25%-gray luminosity mask with an inverting transfer
// function. The correct composite over white is approximately RGB(255,64,64).
async function maskedPdf({large = false, subtype = 'Luminosity'} = {}) {
  const doc = await PDFDocument.create(), context = doc.context, page = doc.addPage([100, 100]);
  const alphaState = context.register(context.obj({ Type: 'ExtGState', ca: .25 }));
  const group = context.register(context.flateStream(subtype === 'Alpha' ? 'q /GSAlpha gs 1 g 0 0 100 100 re f Q' : '0.25 g 0 0 100 100 re f', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100], Group: { S: 'Transparency', CS: 'DeviceGray' }, Resources: { ExtGState: { GSAlpha: alphaState } }
  }));
  const transfer = context.register(context.obj({ FunctionType: 2, Domain: [0, 1], C0: [1], C1: [0], N: 1 }));
  const state = context.register(context.obj({ Type: 'ExtGState', SMask: { S: subtype, G: group, TR: transfer } }));
  page.node.set(PDFName.of('Resources'), context.obj({ ExtGState: { GS0: state } }));
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream('q /GS0 gs 1 0 0 rg 0 0 100 100 re f Q')));
  if (large) { let n=7; const bytes = new Uint8Array(200000); for(let i=0;i<bytes.length;i++){n=(n*1664525+1013904223)>>>0;bytes[i]=n>>>24;} await doc.attach(bytes, 'sample.bin'); }
  return Buffer.from(await doc.save());
}
function checkPixel(bytes, tolerance = 18) {
  const image = PNG.sync.read(bytes), offset = ((Math.floor(image.height / 2) * image.width) + Math.floor(image.width / 2)) * 4;
  const pixel = [...image.data.subarray(offset, offset + 4)];
  expect(pixel[0], `pixel ${pixel}`).toBeGreaterThan(240);
  expect(pixel[1], `pixel ${pixel}`).toBeGreaterThan(64 - tolerance);
  expect(pixel[1], `pixel ${pixel}`).toBeLessThan(64 + tolerance);
  expect(pixel[2], `pixel ${pixel}`).toBeGreaterThan(64 - tolerance);
  expect(pixel[2], `pixel ${pixel}`).toBeLessThan(64 + tolerance);
}
const file = bytes => ({name: 'mask.pdf', mimeType: 'application/pdf', buffer: bytes});
test('PDF preview correctly applies luminosity mask and transfer function in a worker', async ({page}) => {
  await page.goto('/'); await page.getByRole('button', {name:'Kelola PDF'}).click();
  await page.locator('#pdf-start').setInputFiles(file(await maskedPdf()));
  const image = page.locator('.page-preview img').first(); await expect(image).toBeVisible();
  const src = await image.getAttribute('src'); checkPixel(Buffer.from(src.split(',')[1], 'base64'));
});
test('PDF-to-PNG conversion retains luminosity mask and transfer function', async ({page}) => {
  await page.goto('/'); await page.getByRole('button',{name:'Konversi',exact:true}).click();
  await page.locator('#file').setInputFiles(file(await maskedPdf())); await page.locator('#format').selectOption('PNG');
  await page.locator('#form').evaluate(form=>form.requestSubmit());
  const link=page.locator('#results a'); await expect(link).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);
  const zip=await JSZip.loadAsync(await readFile(await download.path()));
  checkPixel(await zip.file('halaman-001.png').async('nodebuffer'));
});
test('strong compression retains the rendered mask in its rasterized PDF', async ({page}) => {
  await page.goto('/'); await page.locator('#file').setInputFiles(file(await maskedPdf({large:true})));
  await page.locator('#pdf-method').selectOption('raster'); await page.locator('#target').fill('100'); await page.locator('#unit').selectOption('KB');
  await page.locator('#form').evaluate(form=>form.requestSubmit()); await expect(page.locator('#results')).toContainText('PDF diubah menjadi gambar');
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#results a').click()]);
  await page.getByRole('button',{name:'Kelola PDF'}).click(); await page.locator('#pdf-start').setInputFiles(await download.path());
  const image=page.locator('.page-preview img').first();await expect(image).toBeVisible();
  const src=await image.getAttribute('src');checkPixel(Buffer.from(src.split(',')[1],'base64'), 25);
});

test('PDF preview applies alpha mask with a transfer function', async ({page}) => {
  await page.goto('/'); await page.getByRole('button', {name:'Kelola PDF'}).click();
  await page.locator('#pdf-start').setInputFiles(file(await maskedPdf({subtype:'Alpha'})));
  const image = page.locator('.page-preview img').first(); await expect(image).toBeVisible();
  const src = await image.getAttribute('src'); checkPixel(Buffer.from(src.split(',')[1], 'base64'));
});
test('embedded PDF font is rendered when worker font loading is unavailable', async ({page}) => {
  // Simulate a browser worker without FontFaceSet. In this case PDF.js must use
  // glyph paths rather than attempt to install CSS in the document polyfill.
  let intercepted = false;
  await page.route('**/pdf-worker.js?*', async route => {
    intercepted = true;
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({response, body: `Object.defineProperty(self, 'fonts', {value: undefined});\n${body}`});
  });
  const {default:fontkit} = await import('@pdf-lib/fontkit');
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
  const p = doc.addPage([240, 100]); p.drawText('Berkasia test', {x:12, y:35, size:28, font});
  await page.goto('/'); await page.getByRole('button',{name:'Kelola PDF'}).click();
  await page.locator('#pdf-start').setInputFiles(file(Buffer.from(await doc.save())));
  const img=page.locator('.page-preview img').first(); await expect(img).toBeVisible(); expect(intercepted).toBeTruthy();
  const data=PNG.sync.read(Buffer.from((await img.getAttribute('src')).split(',')[1], 'base64'));
  let dark=0; for(let i=0;i<data.data.length;i+=4) if(data.data[i]<80 && data.data[i+1]<80 && data.data[i+2]<80 && data.data[i+3]>200) dark++;
  expect(dark).toBeGreaterThan(100);
});
test('PDF preview applies transfer maps to drawn colors without SVG filters', async ({page}) => {
  const doc=await PDFDocument.create(),ctx=doc.context,p=doc.addPage([100,100]);
  const transfer=ctx.register(ctx.obj({FunctionType:2,Domain:[0,1],C0:[1],C1:[0],N:1}));
  const state=ctx.register(ctx.obj({Type:'ExtGState',TR:transfer}));
  p.node.set(PDFName.of('Resources'),ctx.obj({ExtGState:{GS0:state}}));
  p.node.set(PDFName.of('Contents'),ctx.register(ctx.flateStream('q /GS0 gs 0.25 g 0 0 100 100 re f Q')));
  await page.goto('/');await page.getByRole('button',{name:'Kelola PDF'}).click();await page.locator('#pdf-start').setInputFiles(file(Buffer.from(await doc.save())));
  const image=page.locator('.page-preview img').first();await expect(image).toBeVisible();const png=PNG.sync.read(Buffer.from((await image.getAttribute('src')).split(',')[1],'base64'));const offset=(Math.floor(png.height/2)*png.width+Math.floor(png.width/2))*4;
  for(const value of png.data.subarray(offset,offset+3)){expect(value).toBeGreaterThan(175);expect(value).toBeLessThan(210);}
});
