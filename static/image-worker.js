self.onmessage = async ({data}) => {
  try {
    const {file, format, target} = data;
    const type = format === 'original' ? file.type : {JPEG:'image/jpeg',PNG:'image/png',WEBP:'image/webp'}[format];
    if (!['image/jpeg','image/png','image/webp'].includes(type)) throw new Error('Gunakan JPG, PNG, atau WebP yang valid.');
    const bitmap = await createImageBitmap(file, {imageOrientation:'from-image'});
    if (bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error('Resolusi gambar melebihi 40 megapiksel.'); }
    let best = format === 'original' ? file : null;
    if (best && best.size <= target) { bitmap.close(); self.postMessage({blob:best,status:'already_small'}); return; }
    const scales = [1,.85,.7,.55,.4,.3,.2,.1];
    for (let i=0;i<scales.length;i++) {
      const scale=scales[i], canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
      const context=canvas.getContext('2d'); if(type==='image/jpeg'){context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);} context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const encode=async quality=>{const blob=await canvas.convertToBlob({type,quality}); if(blob.type!==type) throw new Error('Format ini tidak didukung browser.'); return blob;};
      let selected=null;
      if(type==='image/png') {const candidate=await encode(); if(!best||candidate.size<best.size) best=candidate; if(candidate.size<=target) selected=candidate;}
      else {let low=.15,high=.95;for(let j=0;j<7;j++){const q=(low+high)/2,candidate=await encode(q);if(!best||candidate.size<best.size)best=candidate;if(candidate.size<=target){selected=candidate;low=q;}else high=q;self.postMessage({progress:(i+(j+1)/7)/scales.length});}}
      self.postMessage({progress:(i+1)/scales.length});
      if(selected){bitmap.close();self.postMessage({blob:selected,status:'success'});return;}
    }
    bitmap.close(); self.postMessage({blob:best,status:'unreachable'});
  } catch(error) { self.postMessage({error:error instanceof DOMException ? 'File tidak dapat diproses. Pastikan format file didukung dan file tidak rusak.' : error.message}); }
};
