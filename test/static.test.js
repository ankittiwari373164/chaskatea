const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const pub=path.join(__dirname,'..','public');
test('every page has a title, viewport and links local assets that exist',()=>{
  const pages=['index','shop','product','cart','checkout','about','contact','login','signup','track','account/index','admin/index'];
  for(const p of pages){const h=fs.readFileSync(path.join(pub,p+'.html'),'utf8');
    assert.match(h,/<title>[^<]+<\/title>/,p);assert.match(h,/name="viewport"/,p);
    for(const m of h.matchAll(/(?:src|href)="(\/[^"?#]+)/g)){const f=path.join(pub,m[1]);if(m[1]==='/'||/^\/(shop|cart|checkout|about|contact|login|signup|track|account|admin|product|order-success|terms|privacy|shipping-returns|policy)$/.test(m[1]))continue;assert.ok(fs.existsSync(f),p+' -> '+m[1]);}
    assert.doesNotMatch(h,/TODO|lorem ipsum/i,p);}
});
test('premium theme: no cartoon tokens left',()=>{
  const css=fs.readFileSync(path.join(pub,'css/styles.css'),'utf8');
  assert.ok(/Cormorant Garamond/.test(css));assert.ok(!/Fraunces|var\(--ink\)\s*;?\s*box-shadow:\s*\d+px \d+px 0/.test(css));
  assert.ok(!/\d+px \d+px 0 var\(--ink\)/.test(css),'hard offset shadows');
  const idx=fs.readFileSync(path.join(pub,'index.html'),'utf8');assert.ok(/milk-tea\.webp/.test(idx));assert.ok(!/stamp|steam|hindi/.test(idx));
});
