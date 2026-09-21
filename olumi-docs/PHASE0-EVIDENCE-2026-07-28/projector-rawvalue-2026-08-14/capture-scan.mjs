import fs from 'node:fs';
const files = process.argv.slice(2);
let totalFactors=0, capped=0, capNoRaw=0, capWithRaw=0, inconsistent=0;
const examples=[];
function walk(o){
  if (o===null||typeof o!=='object') return;
  if (Array.isArray(o)) { o.forEach(walk); return; }
  if (o.kind==='factor' || (o.observed_state && typeof o.observed_state==='object')) {
    const os=o.observed_state;
    if (os && typeof os==='object') {
      totalFactors++;
      const cap=os.cap, v=os.value, rv=os.raw_value;
      if (typeof cap==='number' && Number.isFinite(cap) && cap>0) {
        capped++;
        if (rv===undefined||rv===null) { capNoRaw++; if(examples.length<6) examples.push({id:o.id,value:v,cap,unit:os.unit}); }
        else { capWithRaw++;
          if (typeof v==='number'&&v>=0&&v<=1&&Math.abs(v*cap-rv)>Math.max(1,Math.abs(rv))*0.005) inconsistent++;
        }
      }
    }
  }
  for (const k of Object.keys(o)) walk(o[k]);
}
for (const f of files) { walk(JSON.parse(fs.readFileSync(f,'utf8'))); }
console.log(JSON.stringify({files:files.length,totalFactorsWithObserved:totalFactors,capped,capNoRaw,capWithRaw,inconsistent,examples},null,2));
