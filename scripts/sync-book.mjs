import fs from "node:fs/promises";
import crypto from "node:crypto";

const manifest=JSON.parse(await fs.readFile("data/sheets-manifest.json","utf8"));
const sections=JSON.parse(await fs.readFile("data/sections.json","utf8"));
const sheetId=manifest.spreadsheetId;

function clean(v){return String(v??"").replace(/\u00a0/g," ").replace(/[ \t]+/g," ").trim()}
function slug(v){
  return clean(v).toLowerCase()
    .replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,100)
}
function parseCsv(text){
  const rows=[]; let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'){
        if(text[i+1]==='"'){cell+='"';i++} else quoted=false;
      } else cell+=ch;
    } else {
      if(ch==='"') quoted=true;
      else if(ch===','){row.push(clean(cell));cell=""}
      else if(ch==='\n'){row.push(clean(cell.replace(/\r$/,"")));rows.push(row);row=[];cell=""}
      else cell+=ch;
    }
  }
  row.push(clean(cell.replace(/\r$/,"")));
  if(row.some(Boolean)) rows.push(row);
  return rows.map(r=>{while(r.length&& !r[r.length-1])r.pop();return r});
}
function nonemptyCount(r){return r.filter(Boolean).length}
function canonHeader(s){
  const x=clean(s).toLowerCase();
  if(/^наименование|^название/.test(x)) return "name";
  if(/^артикул/.test(x)) return "article";
  if(/^тип/.test(x)) return "type";
  if(/^назначение/.test(x)) return "purpose";
  if(/характерист|особенност|преимуществ/.test(x)) return "features";
  if(/^значение/.test(x)) return "value";
  if(/^параметр|^характеристика$/.test(x)) return "parameter";
  if(/^производител/.test(x)) return "manufacturer";
  if(/^страна/.test(x)) return "country";
  return slug(s)||"field";
}
function detectHeader(rows){
  let best=null;
  for(let i=0;i<Math.min(rows.length,18);i++){
    const r=rows[i], vals=r.filter(Boolean), joined=vals.join(" | ").toLowerCase();
    let score=0;
    if(joined.includes("наименование"))score+=5;
    if(joined.includes("артикул"))score+=3;
    if(joined.includes("назначение"))score+=3;
    if(joined.includes("характерист"))score+=2;
    if(joined.includes("значение"))score+=2;
    score+=Math.min(nonemptyCount(r),6)*.2;
    if(!best||score>best.score)best={i,score,row:r};
  }
  return best&&best.score>=4?best:null;
}
function parseStandardTable(rows,header){
  const keys=header.row.map(canonHeader);
  const nameIdx=keys.indexOf("name");
  if(nameIdx<0)return null;
  const strong=["article","type","purpose","features"].filter(k=>keys.includes(k)).length;
  if(strong<2)return null;
  const items=[];
  const genericName=/^(наименование|название|категория|тип|артикул|назначение|характеристика|характеристики|особенности|преимущества|параметр|значение|комплектация|размер|размеры|общие свойства|общая норма|важно|примечание|источник)$/i;
  for(let i=header.i+1;i<rows.length;i++){
    const r=rows[i], count=nonemptyCount(r);
    const name=clean(r[nameIdx]);
    if(!name)continue;
    const recognized=r.filter(Boolean).map(canonHeader).filter(k=>["name","article","type","purpose","features","value","parameter","manufacturer","country"].includes(k)).length;
    if(items.length && (recognized>=2 || /^(размеры|общие свойства|общая норма|практическое значение|комплектация|варианты|принцип|интерпретация)/i.test(name))) break;
    if(count<2 || genericName.test(name))continue;
    const obj={};
    keys.forEach((k,j)=>{if(r[j])obj[k]=clean(r[j])});
    obj.sourceRow=i+1;
    obj.candidateId=slug((obj.article&&obj.article!=="-"?obj.article+"-":"")+name)||crypto.createHash("sha1").update(name).digest("hex").slice(0,10);
    items.push(obj);
  }
  return items.length?items:null;
}
function classify(rows){
  const nonempty=rows.filter(r=>r.some(Boolean));
  const header=detectHeader(nonempty);
  const products=header?parseStandardTable(nonempty,header):null;
  if(products)return {kind:"products",headerRow:header.i+1,products};
  const twoCol=nonempty.filter(r=>nonemptyCount(r)===2).length;
  if(nonempty.length&&twoCol/nonempty.length>=0.55){
    return {kind:"keyValue",pairs:nonempty.filter(r=>nonemptyCount(r)>=2).map((r,i)=>({label:r.find(Boolean),value:r.slice(r.findIndex(Boolean)+1).find(Boolean)||"",sourceRow:i+1}))};
  }
  return {kind:"richTable",rows:nonempty};
}
async function fetchSheet(meta){
  const url=`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${meta.gid}`;
  const res=await fetch(url,{redirect:"follow",headers:{"user-agent":"TIAN-KnowledgeBook-Sync/2.0"}});
  const body=await res.text();
  if(!res.ok) throw new Error(`gid ${meta.gid}: HTTP ${res.status}`);
  const rows=parseCsv(body);
  return {meta,rows,parsed:classify(rows)};
}
const fetched=[];
for(const meta of manifest.sheets){
  const item=await fetchSheet(meta);
  fetched.push(item);
  console.log(`${meta.order}/${manifest.sheets.length} ${meta.section} ${meta.title} — ${item.parsed.kind}`);
}
const chapters=sections.chapters.map(ch=>({
  id:ch.id,title:ch.title,
  sections:ch.sections.map(s=>{
    const src=fetched.find(x=>x.meta.order===s.sourceOrder);
    return {id:s.section,title:s.title,gid:src?.meta.gid||null,kind:src?.parsed.kind||null,
      products:src?.parsed.products||undefined,pairs:src?.parsed.pairs||undefined,rows:src?.parsed.rows||undefined}
  })
}));
const book={
  version:2,
  generatedAt:new Date().toISOString(),
  spreadsheetId:sheetId,
  chapters
};
const search=[];
for(const ch of chapters)for(const s of ch.sections){
  if(s.products)for(const p of s.products)search.push({
    id:p.candidateId,section:s.id,chapter:ch.id,name:p.name||"",article:p.article||"",
    text:clean([p.name,p.article,p.type,p.purpose,p.features,p.manufacturer,p.country].filter(Boolean).join(" "))
  });
}
const report={
  generatedAt:book.generatedAt,
  sheets:fetched.length,
  sections:chapters.reduce((n,c)=>n+c.sections.length,0),
  products:search.length,
  byKind:fetched.reduce((a,x)=>(a[x.parsed.kind]=(a[x.parsed.kind]||0)+1,a),{})
};
await fs.mkdir("data",{recursive:true});
await fs.writeFile("data/book.json",JSON.stringify(book,null,2)+"\n");
await fs.writeFile("data/search-index.json",JSON.stringify(search,null,2)+"\n");
await fs.writeFile("data/sync-report.json",JSON.stringify(report,null,2)+"\n");
console.log(report);
