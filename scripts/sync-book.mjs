import fs from "node:fs/promises";
import crypto from "node:crypto";

const manifest=JSON.parse(await fs.readFile("data/sheets-manifest.json","utf8"));
const sections=JSON.parse(await fs.readFile("data/sections.json","utf8"));
const sheetId=manifest.spreadsheetId;

function clean(v){
  return String(v??"")
    .replace(/\u00a0/g," ")
    .split(/\r?\n/)
    .map(x=>x.replace(/[ \t]+/g," ").trim())
    .join("\n")
    .trim();
}
function flat(v){return clean(v).replace(/\s*\n\s*/g," ").trim()}
function slug(v){
  return flat(v).toLowerCase()
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
  return rows.map(r=>{while(r.length&&!r[r.length-1])r.pop();return r});
}
function nonemptyCount(r){return r.filter(v=>flat(v)).length}
function canonHeader(s){
  const x=flat(s).toLowerCase().replace(/[.:]+$/,"");
  if(/^(наименование|название)( товара| позиции)?$/.test(x)) return "name";
  if(/^артикул/.test(x)) return "article";
  if(/^тип$/.test(x)) return "type";
  if(/^назначение$/.test(x)) return "purpose";
  if(/^(характеристики?|особенности?|преимущества?|характеристики \/ особенности|характеристики \/ преимущества)$/.test(x)) return "features";
  if(/^значение$/.test(x)) return "value";
  if(/^параметр$/.test(x)) return "parameter";
  if(/^производител/.test(x)) return "manufacturer";
  if(/^страна/.test(x)) return "country";
  if(/^размер/.test(x)) return "size";
  if(/^(кол-во|количество)/.test(x)) return "quantity";
  if(/^рост/.test(x)) return "height";
  if(/^ширина/.test(x)) return "width";
  if(/^длина/.test(x)) return "length";
  if(/^толщина/.test(x)) return "thickness";
  return "field";
}
const HEADER_KEYS=new Set(["name","article","type","purpose","features","value","parameter","manufacturer","country","size","quantity","height","width","length","thickness"]);
function headerInfo(row){
  const keys=row.map(canonHeader);
  const recognized=keys.filter(k=>HEADER_KEYS.has(k)&&k!=="field").length;
  const strong=["article","type","purpose","features"].filter(k=>keys.includes(k)).length;
  const product=keys.includes("name")&&strong>=2;
  const generic=!product&&recognized>=2;
  return {keys,recognized,strong,product,generic,any:product||generic};
}
function expandPackedRows(rows){
  const expanded=[];
  for(let ri=0;ri<rows.length;ri++){
    const row=rows[ri];
    const parts=row.map(v=>String(v??"").split(/\r?\n/).map(x=>flat(x)));
    const multi=parts.filter(p=>p.length>1).length;
    const first=parts.map(p=>p[0]||"");
    const headerish=headerInfo(first).any || /(^| )(наименование|название|артикул|параметр|размер)( |$)/i.test(first.join(" "));
    if(multi>=2&&headerish){
      const max=Math.max(...parts.map(p=>p.length));
      for(let k=0;k<max;k++){
        const r=parts.map(p=>p[k]||"");
        while(r.length&&!r[r.length-1])r.pop();
        if(r.some(Boolean))expanded.push(r);
      }
    }else{
      expanded.push(row.map(v=>flat(v)));
    }
  }
  const out=[];
  for(let i=0;i<expanded.length;i++){
    const r=expanded[i], next=expanded[i+1]||[];
    if(/^варианты\b/i.test(flat(r[0])) &&
       r.slice(1).some(v=>["size","quantity"].includes(canonHeader(v))) &&
       /^артикул/i.test(flat(next[0])) && nonemptyCount(next)===1){
      out.push([flat(r[0])]);
      out.push([flat(next[0]),...r.slice(1)]);
      i++;
      continue;
    }
    out.push(r);
  }
  return out;
}
function precedingTitle(rows,i){
  for(let k=i-1;k>=Math.max(0,i-3);k--){
    if(nonemptyCount(rows[k])===1){
      const t=flat(rows[k].find(Boolean));
      if(t&&!headerInfo(rows[k]).any)return t;
    }
    if(nonemptyCount(rows[k])>1)break;
  }
  return "";
}
function rowToObject(row,keys,sourceRow,group){
  const obj={};
  keys.forEach((k,j)=>{
    if(k!=="field"&&row[j])obj[k]=flat(row[j]);
  });
  if(group)obj.group=group;
  obj.sourceRow=sourceRow;
  const name=obj.name||"";
  obj.candidateId=slug((obj.article&&obj.article!=="-"&&obj.article!=="—"?obj.article+"-":"")+name)
    ||crypto.createHash("sha1").update(JSON.stringify(row)).digest("hex").slice(0,10);
  return obj;
}
function parseProductTables(rows){
  const products=[], productBlocks=[];
  const genericName=/^(наименование|название|категория|тип|артикул|назначение|характеристика|характеристики|особенности|преимущества|параметр|значение|комплектация|размер|размеры|общие свойства|общая норма|важно|примечание|источник)$/i;
  for(let i=0;i<rows.length;i++){
    const h=headerInfo(rows[i]);
    if(!h.product)continue;
    const group=precedingTitle(rows,i);
    const block=[];
    let j=i+1;
    for(;j<rows.length;j++){
      const r=rows[j], info=headerInfo(r), count=nonemptyCount(r);
      if(info.any)break;
      if(count===0)continue;
      if(count===1){
        if(block.length)break;
        continue;
      }
      const nameIdx=h.keys.indexOf("name");
      const name=flat(r[nameIdx]);
      if(!name||genericName.test(name))continue;
      const obj=rowToObject(r,h.keys,j+1,group);
      if(!obj.name)continue;
      block.push(obj);
      products.push(obj);
    }
    productBlocks.push({group,header:rows[i].map(flat),count:block.length});
    i=Math.max(i,j-1);
  }
  return {products,productBlocks};
}
function parseGenericTables(rows){
  const tables=[];
  for(let i=0;i<rows.length;i++){
    const h=headerInfo(rows[i]);
    if(!h.generic)continue;
    const title=precedingTitle(rows,i);
    const body=[];
    let j=i+1;
    for(;j<rows.length;j++){
      const r=rows[j], info=headerInfo(r), count=nonemptyCount(r);
      if(info.any)break;
      if(count===0)continue;
      if(count===1&&body.length)break;
      if(count>=2)body.push(r.map(flat));
    }
    if(body.length)tables.push({title,headers:rows[i].map(flat),rows:body});
    i=Math.max(i,j-1);
  }
  return tables;
}
function collectNotes(rows){
  const notes=[];
  for(let i=0;i<rows.length;i++){
    if(nonemptyCount(rows[i])!==1)continue;
    const t=flat(rows[i].find(Boolean));
    if(!t||headerInfo(rows[i]).any)continue;
    if(t.length<3)continue;
    notes.push(t);
  }
  return [...new Set(notes)];
}
function classify(inputRows){
  const rows=expandPackedRows(inputRows).filter(r=>r.some(v=>flat(v)));
  const {products,productBlocks}=parseProductTables(rows);
  const tables=parseGenericTables(rows);
  const notes=collectNotes(rows);
  if(products.length)return {kind:"products",products,productBlocks,tables:tables.length?tables:undefined,notes:notes.length?notes:undefined};
  const twoCol=rows.filter(r=>nonemptyCount(r)===2).length;
  if(rows.length&&twoCol/rows.length>=0.55){
    return {kind:"keyValue",pairs:rows.filter(r=>nonemptyCount(r)>=2).map((r,i)=>({
      label:flat(r.find(Boolean)),
      value:flat(r.slice(r.findIndex(Boolean)+1).find(Boolean)||""),
      sourceRow:i+1
    })),tables:tables.length?tables:undefined,notes:notes.length?notes:undefined};
  }
  return {kind:"richTable",rows:rows.map(r=>r.map(flat)),tables:tables.length?tables:undefined,notes:notes.length?notes:undefined};
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
    const seen={};
    const products=(src?.parsed.products||[]).map(p=>{
      const base=`${s.section}-${p.candidateId}`;
      const n=(seen[base]=(seen[base]||0)+1);
      return {...p,id:n===1?base:`${base}-${n}`};
    });
    return {id:s.section,title:s.title,gid:src?.meta.gid||null,kind:src?.parsed.kind||null,
      products:products.length?products:undefined,
      productBlocks:src?.parsed.productBlocks||undefined,
      tables:src?.parsed.tables||undefined,
      notes:src?.parsed.notes||undefined,
      pairs:src?.parsed.pairs||undefined,
      rows:src?.parsed.rows||undefined}
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
    id:p.id,section:s.id,chapter:ch.id,name:p.name||"",article:p.article||"",
    text:clean([p.name,p.article,p.type,p.purpose,p.features,p.manufacturer,p.country].filter(Boolean).join(" "))
  });
}
const allProducts=[];
for(const ch of chapters)for(const s of ch.sections)for(const p of (s.products||[]))allProducts.push({chapter:ch.id,section:s.id,...p});
const idCounts={}; for(const p of allProducts)idCounts[p.id]=(idCounts[p.id]||0)+1;
const articleCounts={};
for(const p of allProducts){
  const a=flat(p.article||"");
  if(a&&a!=="-"&&a!=="—"&&!/^в каталоге не указан/i.test(a))articleCounts[a]=(articleCounts[a]||0)+1;
}
const report={
  generatedAt:book.generatedAt,
  sheets:fetched.length,
  sections:chapters.reduce((n,c)=>n+c.sections.length,0),
  products:search.length,
  byKind:fetched.reduce((a,x)=>(a[x.parsed.kind]=(a[x.parsed.kind]||0)+1,a),{}),
  perSection:chapters.flatMap(ch=>ch.sections.map(s=>({
    id:s.id,title:s.title,kind:s.kind,
    products:(s.products||[]).length,
    tables:(s.tables||[]).length,
    notes:(s.notes||[]).length
  }))),
  suspiciousProducts:allProducts.filter(p=>{
    const n=flat(p.name||"");
    return /^(s|m|l|xl|xxl|xxxl|xs)$/i.test(n)||/^размер$/i.test(n)||n.length<2;
  }).map(p=>({section:p.section,name:p.name,article:p.article||"",sourceRow:p.sourceRow})),
  duplicateIds:Object.entries(idCounts).filter(([,n])=>n>1).map(([id,count])=>({id,count})),
  duplicateArticles:Object.entries(articleCounts).filter(([,n])=>n>1).map(([article,count])=>({article,count}))
};
await fs.mkdir("data",{recursive:true});
await fs.writeFile("data/book.json",JSON.stringify(book,null,2)+"\n");
await fs.writeFile("data/search-index.json",JSON.stringify(search,null,2)+"\n");
await fs.writeFile("data/sync-report.json",JSON.stringify(report,null,2)+"\n");
console.log(report);
