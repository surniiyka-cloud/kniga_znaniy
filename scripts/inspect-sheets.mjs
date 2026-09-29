import fs from "node:fs/promises";

const manifest = JSON.parse(await fs.readFile(new URL("../data/sheets-manifest.json", import.meta.url), "utf8"));
const spreadsheetId = manifest.spreadsheetId;

function parseCsv(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i+1] === '"') { cell += '"'; i++; }
        else quoted=false;
      } else cell += ch;
    } else {
      if (ch === '"') quoted=true;
      else if (ch === ",") { row.push(cell); cell=""; }
      else if (ch === "\n") { row.push(cell.replace(/\r$/,"")); rows.push(row); row=[]; cell=""; }
      else cell += ch;
    }
  }
  row.push(cell.replace(/\r$/,""));
  if (row.some(v=>v!=="")) rows.push(row);
  return rows;
}

const clean = v => String(v ?? "").replace(/\s+/g," ").trim();
const generic = /^(наименование|название|артикул|тип|назначение|характеристик|описание|примечание|размер|параметр|значение)$/i;

function inspectRows(rows) {
  const nonempty = rows.filter(r=>r.some(v=>clean(v)));
  const sample = nonempty.slice(0,8).map(r=>r.slice(0,12).map(v=>clean(v).slice(0,180)));
  let suggestedTitle="";
  outer: for (const r of nonempty.slice(0,8)) {
    for (const v of r.slice(0,5)) {
      const s=clean(v);
      if (s && s.length<=140 && !generic.test(s)) { suggestedTitle=s; break outer; }
    }
  }
  return {
    rowCount: nonempty.length,
    colCount: nonempty.reduce((m,r)=>Math.max(m,r.length),0),
    suggestedTitle,
    sample,
    rawSample: nonempty.slice(0,3).map(r=>r.slice(0,8)),
    firstColumn: nonempty.map(r=>clean(r[0])).filter(Boolean)
  };
}

async function fetchSheet(item) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${item.gid}`;
  const controller = new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);
  try {
    const res=await fetch(url,{redirect:"follow",headers:{"user-agent":"TIAN-KnowledgeBook-Sync/2.0"},signal:controller.signal});
    const text=await res.text();
    if(!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0,160)}`);
    const rows=parseCsv(text);
    return {...item,ok:true,url,...inspectRows(rows)};
  } catch (e) {
    return {...item,ok:false,url,error:String(e?.message||e)};
  } finally { clearTimeout(timer); }
}

const out=[];
const queue=[...manifest.sheets];
const workers=Array.from({length:6},async()=>{
  while(queue.length){
    const item=queue.shift();
    const result=await fetchSheet(item);
    out.push(result);
    console.log(`[${result.ok?"OK":"ERR"}] ${item.order}/${manifest.sheets.length} gid=${item.gid} ${result.suggestedTitle||result.error||""}`);
  }
});
await Promise.all(workers);
out.sort((a,b)=>a.order-b.order);

const audit={
  generatedAt:new Date().toISOString(),
  spreadsheetId,
  total:out.length,
  ok:out.filter(x=>x.ok).length,
  failed:out.filter(x=>!x.ok).length,
  sheets:out
};
await fs.mkdir(new URL("../data/",import.meta.url),{recursive:true});
await fs.writeFile(new URL("../data/sheet-audit.json",import.meta.url),JSON.stringify(audit,null,2)+"\n","utf8");
if(audit.failed) process.exitCode=2;
