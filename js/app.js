
import {makeSearch} from "./search.js";
import {route,href,go} from "./router.js";
import {favorites,recent,applyTheme,cycleTheme,getTheme} from "./storage.js";

const q=(s)=>document.querySelector(s);
const app=q("#app"), nav=q("#nav"), searchInput=q("#globalSearch"), searchPanel=q("#searchPanel");
const isAdmin=()=>{try{return sessionStorage.getItem("kb_admin")==="1"}catch{return false}};
const state={book:null,terms11:[],terms11Base:[],assets:{productImages:{},sectionImages:{}},overrides:{version:1,products:{},sections:{},chapters:{}},publishedLiveSnapshots:{},editorBase:{products:new Map(),images:new Map(),sections:new Map(),chapters:new Map()},index:[],reports:{sync:null,images:null},versionLog:{current:"2.0",entries:[]},products:new Map(),sections:new Map(),chapters:new Map(),sectionCatalog:new Map(),search:()=>[],lightbox:{images:[],index:0,alt:""}};

function esc(v){return String(v??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function fmtDate(v){try{return new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(v));}catch{return v||"—";}}
function article(p){const a=String(p.article||"").trim();return (!a||a==="-"||a==="—")?"":a;}
function imgSrc(p){return state.assets.productImages?.[p.id]?.[0]||"";}
function ctx(id){return state.products.get(id)||null;}
function toast(t){const el=q("#toast");el.textContent=t;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),1800);}
function counters(){
  const visible=id=>{const x=ctx(id);return x&&!isProductExcluded(x.section.id,x.product.id)};
  q("#favCount").textContent=favorites.get().filter(visible).length;
}
function applyAdminVisibility(){
  const admin=isAdmin();
  const diag=document.querySelector(".diag-link"),ver=q("#versionLogBtn");
  if(diag)diag.hidden=!admin;
  if(ver){
    ver.hidden=false;
    ver.disabled=!admin;
    ver.title=admin?"Открыть историю обновлений":"Версия сайта. История обновлений доступна администратору.";
    ver.setAttribute("aria-disabled",String(!admin));
  }
}
function title(t){document.title=t?(t+" · Книга знаний TIAN-Трейд"):"Книга знаний · TIAN-Трейд";}
function closeMenu(){document.body.classList.remove("sidebar-open");}
function crumb(items){return '<div class="crumbs"><button data-route="home">Главная</button>'+items.map((x)=>'<span>›</span>'+(x.route?'<button data-route="'+esc(x.route)+'" data-id="'+esc(x.id||"")+'">'+esc(x.label)+'</button>':'<span>'+esc(x.label)+'</span>')).join("")+'</div>';}


function safeSlug(v){return String(v||"item").toLowerCase().replace(/[^a-zа-яё0-9]+/gi,"-").replace(/^-|-$/g,"").slice(0,72)||"item";}

const LIVE_SHEETS_KEY="kb_live_sheet_snapshots";
function liveClean(v){return String(v??"").replace(/\u00a0/g," ").split(/\r?\n/).map(x=>x.replace(/[ \t]+/g," ").trim()).join("\n").trim();}
function liveFlat(v){return liveClean(v).replace(/\s*\n\s*/g," ").trim();}
function liveSlug(v){return liveFlat(v).toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,100);}
function liveCsv(text){
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else quoted=false}else cell+=ch}
    else if(ch==='"')quoted=true;
    else if(ch===","){row.push(liveClean(cell));cell=""}
    else if(ch==="\n"){row.push(liveClean(cell.replace(/\r$/,"")));rows.push(row);row=[];cell=""}
    else cell+=ch;
  }
  row.push(liveClean(cell.replace(/\r$/,"")));if(row.some(Boolean))rows.push(row);
  return rows.map(r=>{while(r.length&&!r[r.length-1])r.pop();return r}).filter(r=>r.some(Boolean));
}
function liveNonempty(r){return (r||[]).filter(v=>liveFlat(v)).length;}
function liveCanon(s){
  const x=liveFlat(s).toLowerCase().replace(/[.:]+$/,"");
  if(/^(наименование|название)( товара| позиции)?$/.test(x))return "name";
  if(/^артикул/.test(x))return "article";if(/^тип$/.test(x))return "type";if(/^назначение$/.test(x))return "purpose";
  if(/^(характеристики?|особенности?|преимущества?|характеристики \/ особенности|характеристики \/ преимущества)$/.test(x))return "features";
  if(/^значение$/.test(x))return "value";if(/^параметр$/.test(x))return "parameter";if(/^производител/.test(x))return "manufacturer";
  if(/^страна/.test(x))return "country";if(/^размер/.test(x))return "size";if(/^(кол-во|количество)/.test(x))return "quantity";
  if(/^рост/.test(x))return "height";if(/^ширина/.test(x))return "width";if(/^длина/.test(x))return "length";if(/^толщина/.test(x))return "thickness";
  return "field";
}
const LIVE_HEADER_KEYS=new Set(["name","article","type","purpose","features","value","parameter","manufacturer","country","size","quantity","height","width","length","thickness"]);
function liveHeaderInfo(row){
  const keys=(row||[]).map(liveCanon),recognized=keys.filter(k=>LIVE_HEADER_KEYS.has(k)&&k!=="field").length,strong=["article","type","purpose","features"].filter(k=>keys.includes(k)).length;
  const product=keys.includes("name")&&strong>=2,generic=!product&&recognized>=2;return {keys,recognized,strong,product,generic,any:product||generic};
}
function livePrecedingTitle(rows,i){
  for(let k=i-1;k>=Math.max(0,i-3);k--){if(liveNonempty(rows[k])===1){const t=liveFlat(rows[k].find(Boolean));if(t&&!liveHeaderInfo(rows[k]).any)return t}if(liveNonempty(rows[k])>1)break}return "";
}
function liveRowObject(row,keys,sourceRow,group,headers=[]){
  const obj={},sheetFields=[];keys.forEach((k,j)=>{const value=liveFlat(row[j]||""),label=liveFlat(headers[j]||"");if(k!=="field"&&value)obj[k]=value;if(label&&value)sheetFields.push([label,value])});
  if(sheetFields.length)obj.sheetFields=sheetFields;if(group)obj.group=group;obj.sourceRow=sourceRow;
  obj.candidateId=liveSlug((obj.article&&obj.article!=="-"&&obj.article!=="—"?obj.article+"-":"")+(obj.name||""))||("row-"+sourceRow);return obj;
}
function liveParseProducts(rows){
  const products=[],productBlocks=[],genericName=/^(наименование|название|категория|тип|артикул|назначение|характеристика|характеристики|особенности|преимущества|параметр|значение|комплектация|размер|размеры|общие свойства|общая норма|важно|примечание|источник)$/i;
  for(let i=0;i<rows.length;i++){const h=liveHeaderInfo(rows[i]);if(!h.product)continue;const group=livePrecedingTitle(rows,i),block=[];let j=i+1;
    for(;j<rows.length;j++){const r=rows[j],info=liveHeaderInfo(r),count=liveNonempty(r);if(info.any)break;if(count===0)continue;if(count===1){if(block.length)break;continue}
      const nameIdx=h.keys.indexOf("name"),name=liveFlat(r[nameIdx]);if(!name||genericName.test(name))continue;const obj=liveRowObject(r,h.keys,j+1,group,rows[i]);if(!obj.name)continue;block.push(obj);products.push(obj)}
    productBlocks.push({group,header:rows[i].map(liveFlat),count:block.length});i=Math.max(i,j-1);
  }return {products,productBlocks};
}
function liveParseTables(rows){
  const tables=[];for(let i=0;i<rows.length;i++){const h=liveHeaderInfo(rows[i]);if(!h.generic)continue;const title=livePrecedingTitle(rows,i),body=[];let j=i+1;
    for(;j<rows.length;j++){const r=rows[j],info=liveHeaderInfo(r),count=liveNonempty(r);if(info.any)break;if(count===0)continue;if(count===1&&body.length)break;if(count>=2)body.push(r.map(liveFlat))}
    if(body.length)tables.push({title,headers:rows[i].map(liveFlat),rows:body});i=Math.max(i,j-1);
  }return tables;
}
function liveNotes(rows){const out=[];for(const r of rows){if(liveNonempty(r)!==1)continue;const t=liveFlat(r.find(Boolean));if(t&&t.length>=3&&!liveHeaderInfo(r).any)out.push(t)}return [...new Set(out)];}
function liveClassify(rows){
  const {products,productBlocks}=liveParseProducts(rows),tables=liveParseTables(rows),notes=liveNotes(rows);
  if(products.length)return {kind:"products",products,productBlocks,tables:tables.length?tables:undefined,notes:notes.length?notes:undefined,rawRows:rows};
  const twoCol=rows.filter(r=>liveNonempty(r)===2).length;
  if(rows.length&&twoCol/rows.length>=.55)return {kind:"keyValue",pairs:rows.filter(r=>liveNonempty(r)>=2).map((r,i)=>({label:liveFlat(r.find(Boolean)),value:liveFlat(r.slice(r.findIndex(Boolean)+1).find(Boolean)||""),sourceRow:i+1})),tables:tables.length?tables:undefined,notes:notes.length?notes:undefined,rawRows:rows};
  return {kind:"richTable",rows:rows.map(r=>r.map(liveFlat)),tables:tables.length?tables:undefined,notes:notes.length?notes:undefined,rawRows:rows};
}
function liveSnapshots(){
  let local={};try{local=JSON.parse(localStorage.getItem(LIVE_SHEETS_KEY)||"{}")||{}}catch{}
  const merged={...deepCopy(state.publishedLiveSnapshots||{}),...local};
  for(const [id,snap] of Object.entries(merged)){
    const base=bookSectionById(id)?.section;
    const hasBaseProducts=Array.isArray(base?.products)&&base.products.length>0;
    const parsedProducts=Array.isArray(snap?.parsed?.products)?snap.parsed.products:[];
    // A malformed/empty cached snapshot must never turn an existing product section
    // into a raw "canvas". A valid refresh for a product section must contain products.
    if(hasBaseProducts && (snap?.parsed?.kind!=="products" || !parsedProducts.length))delete merged[id];
  }
  return merged;
}
function saveLiveSnapshots(v){
  const payload=JSON.stringify(v||{});
  try{
    localStorage.setItem(LIVE_SHEETS_KEY,payload);
    return true;
  }catch(e){
    // Большие листы Google Sheets могут превысить квоту localStorage.
    // Свежие данные уже применены в памяти, поэтому ошибка хранения кэша
    // не должна превращаться в ошибку загрузки самого листа.
    try{
      localStorage.removeItem(LIVE_SHEETS_KEY);
      localStorage.setItem(LIVE_SHEETS_KEY,payload);
      return true;
    }catch(e2){
      console.warn("Не удалось сохранить локальный кэш Google Sheets; продолжаем без него.",e2);
      try{localStorage.removeItem(LIVE_SHEETS_KEY)}catch{}
      return false;
    }
  }
}
function bookSectionById(id){for(const ch of state.book?.chapters||[]){const s=(ch.sections||[]).find(x=>x.id===id);if(s)return {chapter:ch,section:s}}return null}
function applyLiveParsed(section,parsed){
  for(const k of ["products","productBlocks","tables","notes","pairs","rows","rawRows","packedRows"])delete section[k];
  section.kind=parsed.kind;for(const k of ["productBlocks","tables","notes","pairs","rows","rawRows"])if(parsed[k]!==undefined)section[k]=deepCopy(parsed[k]);
  if(parsed.products?.length){const seen={};section.products=parsed.products.map(p=>{const base=section.id+"-"+p.candidateId,n=(seen[base]=(seen[base]||0)+1);return {...p,id:n===1?base:base+"-"+n}})}
}
function applyStoredLiveSnapshots(){
  const snaps=liveSnapshots();for(const [id,snap] of Object.entries(snaps)){const x=bookSectionById(id);if(x&&snap?.parsed)applyLiveParsed(x.section,snap.parsed)}
}
async function fetchLiveSection(sectionId,{rebuild=true}={}){
  const x=bookSectionById(sectionId);if(!x?.section?.gid)throw new Error("У раздела "+sectionId+" нет прямого листа Google Sheets.");
  const sid=state.book.spreadsheetId,gid=x.section.gid,base="https://docs.google.com/spreadsheets/d/"+encodeURIComponent(sid);
  const urls=[base+"/export?format=csv&gid="+encodeURIComponent(gid)+"&_="+Date.now(),base+"/gviz/tq?tqx=out:csv&gid="+encodeURIComponent(gid)+"&_="+Date.now()];
  let last=null;
  for(const url of urls){try{const res=await fetch(url,{cache:"no-store",redirect:"follow"}),text=await res.text();if(!res.ok||/<!doctype html|<html/i.test(text.slice(0,500)))throw new Error("Google Sheets HTTP "+res.status);const rows=liveCsv(text);if(!rows.length)throw new Error("Google Sheets вернул пустой лист");
      const parsed=liveClassify(rows),snaps=liveSnapshots();snaps[sectionId]={fetchedAt:new Date().toISOString(),gid:String(gid),parsed};saveLiveSnapshots(snaps);applyLiveParsed(x.section,parsed);
      if(rebuild)rebuildAfterLiveRefresh(sectionId);
      return {sectionId,rows:rows.length,fetchedAt:snaps[sectionId].fetchedAt};
    }catch(e){last=e}}
  throw new Error("Не удалось забрать свежие данные из листа "+sectionId+": "+(last?.message||"ошибка запроса"));
}
function rebuildAfterLiveRefresh(fallbackSection=""){
  const before=route(),productId=before.name==="product"?before.id:"";
  mapData();state.index=buildLiveSearchIndex();state.search=makeSearch(state.index);renderNav();counters();installEditorApi();
  if(productId&&!ctx(productId))go("section",fallbackSection||"home");else render();
  q("#syncState").textContent="Google Sheets · свежие данные "+fmtDate(new Date().toISOString());
}
async function refreshLiveSections(ids){
  const list=[...new Set((ids||[]).filter(Boolean))];if(!list.length)throw new Error("Не найден лист Google Sheets для обновления.");
  const result=[];for(const id of list)result.push(await fetchLiveSection(id,{rebuild:false}));
  rebuildAfterLiveRefresh(list[0]);
  return {sectionId:list.length===1?list[0]:list.join(", "),rows:result.reduce((n,x)=>n+(x.rows||0),0),sections:list.length,items:result};
}

function displaySections(ch){
  const base=ch.sections.filter((s)=>isAdmin()||!["1.3","2.2.1"].includes(s.id)).map((s)=>s.id==="1.2"&&!state.overrides?.sections?.["1.2"]?.title?{...s,title:"Сокращения, обозначения и единицы измерения"}:s);
  if(ch.id!=="2")return base;
  const out=[];let six=false,seven=false;
  for(const s of base){
    if(s.id.startsWith("2.6.")){if(!six){out.push({id:"2.6",title:"Анализаторы качества молока",composite:true});six=true;}continue;}
    if(s.id.startsWith("2.7.")){if(!seven){out.push({id:"2.7",title:"Анализаторы соматических клеток",composite:true});seven=true;}continue;}
    out.push(s.id==="2.13"?{...s,title:state.overrides?.sections?.["2.13"]?.title||"Тест-пластины KangarooSci"}:s);
  }
  return out;
}
function cleanPairs(arr){
  return (arr||[]).filter((x)=>{
    const l=String(x.label||"").trim(),v=String(x.value||"").trim();
    return l&&v&&!["Характеристика","Показатель","Особенность","Преимущество","Этап","Функция","Вариант работы","Объект"].includes(l)&&!["Значение","Описание","Практическое значение","Диапазон измерения","Интерпретация"].includes(v);
  }).map((x)=>[String(x.label).trim(),String(x.value).trim()]);
}
function fieldsFromRows(rows){
  const out=[];
  for(const r of rows||[]){
    const l=String(r?.[0]||"").trim(),v=String(r?.[1]||"").trim();
    if(!l||!v||l.length>90||["Характеристика","Наименование","Преимущество","Показатель","Определяемое вещество"].includes(l))continue;
    out.push([l,v]);
  }
  return out;
}
function splitPairBlocks(s){
  const pairs=s.pairs||[];const blocks=[];let cur=null;
  for(let i=0;i<pairs.length;i++){
    const l=String(pairs[i].label||"").trim(),v=String(pairs[i].value||"").trim();
    if(l==="Характеристика"&&/^(Значение|Данные)$/i.test(v)){if(cur?.name)blocks.push(cur);cur={name:"",fields:[]};continue;}
    if(l==="Наименование"){
      if(cur?.name)blocks.push(cur);
      cur={name:v,fields:[]};continue;
    }
    if(!cur)cur={name:"",fields:[],advantages:[],practical:[]};
    if(l&&v)cur.fields.push([l,v]);
  }
  if(cur?.name)blocks.push(cur);
  for(const b of blocks){
    const special=b.fields.findIndex((r)=>/^(Преимущество|Особенность)$/i.test(r[0])&&/Практическое значение/i.test(r[1]));
    if(special>=0){
      const tail=b.fields.slice(special+1);
      b.advantages=uniquePairs(tail);
      b.practical=uniquePairs(tail);
      b.fields=b.fields.slice(0,special);
    }else{b.advantages=[];b.practical=[];}
  }
  return blocks;
}
function registerCatalog(sectionId,name,fields=[],images=[],opts={}){
  const x=state.sections.get(sectionId);if(!x)return null;
  const baseId="catalog-"+safeSlug(sectionId+"-"+name);let id=baseId,n=2;while(state.products.has(id))id=baseId+"-"+n++;
  const f=(fields||[]).filter((r)=>r?.[0]&&r?.[1]);
  const find=(rx)=>f.find((r)=>rx.test(r[0]))?.[1]||"";
  const sourceSectionId=opts.sourceSectionId||sectionId,sourceRef=bookSectionById(sourceSectionId)?.section||null;
  const p={id,name,article:opts.article||find(/^Артикул$/i),type:opts.type||find(/^(Тип|Тип оборудования|Категория)$/i),purpose:opts.purpose||find(/^Назначение$/i),detailFields:f,advantages:opts.advantages||[],substances:opts.substances||[],indicators:opts.indicators||[],indicatorTable:opts.indicatorTable||null,tabTables:deepCopy(opts.tabTables||{}),options:opts.options||[],variants:opts.variants||[],complectation:opts.complectation||[],workflow:opts.workflow||[],calibration:opts.calibration||[],assortment:opts.assortment||[],consumables:opts.consumables||[],testKits:opts.testKits||[],washCycle:opts.washCycle||[],customTabs:opts.customTabs||[],sourceSectionId,sourceGid:opts.sourceGid||sourceRef?.gid||null};
  const ctxObj={chapter:x.chapter,section:x.section,product:p};
  if(!state.sectionCatalog.has(sectionId))state.sectionCatalog.set(sectionId,[]);
  state.sectionCatalog.get(sectionId).push(ctxObj);
  state.products.set(id,ctxObj);
  if(images?.length)state.assets.productImages[id]=images;
  return ctxObj;
}
function bestImage(sectionId,needle){
  const imgs=state.assets.sectionImages?.[sectionId]||[], n=safeSlug(needle).replace(/-/g,"");
  const compact=(v)=>safeSlug(v.split("/").pop()).replace(/-/g,"");
  return imgs.find((x)=>{const z=compact(x);return n.split(/\d+/)[0]&&z.includes(n.replace(/^экспресстест/,"").slice(0,12));})||imgs[0]||"";
}

function uniquePairs(arr){
  const seen=new Set(),out=[];
  for(const r of arr||[]){const k=String(r?.[0]||"").trim()+"\u0000"+String(r?.[1]||"").trim();if(!r?.[0]||!r?.[1]||seen.has(k))continue;seen.add(k);out.push([String(r[0]).trim(),String(r[1]).trim()]);}
  return out;
}
function withFallbackFields(fields,fallback=[]){
  const source=uniquePairs(fields),labels=new Set(source.map(r=>String(r[0]).trim().toLowerCase()));
  return uniquePairs([...source,...fallback.filter(r=>!labels.has(String(r?.[0]||"").trim().toLowerCase()))]);
}
function sourcePairs(rows,{keepSingles=false}={}){
  const out=[];
  for(const r of rows||[]){
    const vals=(r||[]).map(v=>String(v||"").trim());
    if(vals[0]&&vals.slice(1).some(Boolean))out.push([vals[0],vals.slice(1).filter(Boolean).join(" · ")]);
    else if(keepSingles&&vals[0])out.push(["Дополнительная информация",vals[0]]);
  }
  return uniquePairs(out.filter(([l,v])=>l&&v&&!/^(Характеристика|Особенность|Преимущество|Этап)$/i.test(l)&&!/^(Значение|Практическое значение|Действие)$/i.test(v)));
}
function parseRowBlock(rows,config={}){
  const fields=[],advantages=[],substances=[];let group=config.initialGroup||"";
  const pairs=config.fieldPairs||[[0,1]];
  for(const r of rows||[]){
    for(const [a,b] of pairs){
      const l=String(r?.[a]||"").trim(),v=String(r?.[b]||"").trim();
      if(!l||!v||l.length>110||/^(Характеристика|Наименование|Преимущество|Практическое значение|Антибиотик \/ вещество|ppb)/i.test(l))continue;
      if(v==="—"||v==="-")continue;
      fields.push([l,v]);
    }
    if(config.advCols){
      const av=String(r?.[config.advCols[0]]||"").trim(),pv=String(r?.[config.advCols[1]]||"").trim();
      if(av&&pv&&!/^(Преимущество|Практическое значение)$/i.test(av)&&av.length<140){
        advantages.push([av,pv]);
      }
    }
    if(config.substanceCols){
      const s=String(r?.[config.substanceCols[0]]||"").trim(),v=String(r?.[config.substanceCols[1]]||"").trim();
      if(s&&!v&&!/^(Антибиотик \/ вещество|ppb)/i.test(s)){group=s;continue;}
      if(s&&v&&!/^(Антибиотик \/ вещество|ppb)/i.test(s))substances.push({group,substance:s,ppb:v});
    }
    if(config.groupCol!=null){
      const g=String(r?.[config.groupCol]||"").trim();
      if(g&&!String(r?.[config.substanceCols?.[0]]||"").trim()&&!/^(Группа)$/i.test(g))group=g;
    }
  }
  return {fields:uniquePairs(fields),advantages:uniquePairs(advantages),substances};
}
function parallelBlockStarts(rows){
  const out=[];
  for(let i=0;i<(rows||[]).length-1;i++){
    const vals=(rows[i]||[]).map(v=>String(v||"").trim()).filter(Boolean);
    const next=(rows[i+1]||[]).map(v=>String(v||"").trim());
    if(vals.length>=2&&new Set(vals).size===1&&next.includes("Характеристика"))out.push(i);
  }
  return out;
}
function parseParallelProduct(rows,st,en){
  const marker=String(rows[st]?.[0]||"").trim(),block=rows.slice(st+1,en);
  const hi=block.findIndex(r=>(r||[]).some(v=>String(v||"").trim()==="Характеристика"));
  if(hi<0)return {name:marker,fields:[],advantages:[],complectation:[],substances:[],customTabs:[]};
  const head=block[hi]||[],data=block.slice(hi+1);
  const col=(rx)=>head.findIndex(v=>rx.test(String(v||"").trim()));
  const charCol=col(/^Характеристика$/i),compCol=col(/^Комплектация$/i),advCol=col(/^Преимущество$/i);
  const reqCol=col(/^Показатель$/i);
  let subCol=-1,groupCol=-1,initialGroup="";
  const scan=block.slice(hi,Math.min(block.length,hi+5));
  outer:for(const r of scan){
    for(let j=0;j<r.length-1;j++){
      if(/^(Антибиотик \/ вещество|Определяемый показатель)$/i.test(String(r[j]||"").trim())&&/(ppb|предел обнаружения)/i.test(String(r[j+1]||"").trim())){
        subCol=j;groupCol=/^Группа$/i.test(String(head[j-1]||"").trim())?j-1:-1;
        const h=String(head[j]||"").trim();
        if(groupCol<0&&h&&!/^(Антибиотик \/ вещество|Определяемый показатель)$/i.test(h))initialGroup=h;
        break outer;
      }
    }
  }
  const fields=[],advantages=[],complectation=[],requirements=[],substances=[];let group=initialGroup,name=marker;
  for(const r of data){
    if(charCol>=0){
      const l=String(r[charCol]||"").trim(),v=String(r[charCol+1]||"").trim();
      if(/^Наименование$/i.test(l)&&v){name=v.replace(/^Экспресс-тест\s+/i,"").trim()||marker}
      else if(l&&v&&!/^(Характеристика|Данные)$/i.test(l)&&!["-","—"].includes(v))fields.push([l,v]);
    }
    if(compCol>=0){
      const l=String(r[compCol]||"").trim(),v=String(r[compCol+1]||"").trim();
      if(l&&v&&!/^(Комплектация|Количество)$/i.test(l)&&!["-","—"].includes(v))complectation.push([l,v]);
    }
    if(advCol>=0){
      const l=String(r[advCol]||"").trim(),v=String(r[advCol+1]||"").trim();
      if(l&&v&&!/^Преимущество$/i.test(l)&&!/Практическое значение|Что это даёт/i.test(l)&&!["-","—"].includes(v))advantages.push([l,v]);
    }
    if(reqCol>=0&&reqCol!==advCol){
      const l=String(r[reqCol]||"").trim(),v=String(r[reqCol+1]||"").trim();
      if(l&&v&&!/^Показатель$/i.test(l)&&!/Требование/i.test(l)&&!["-","—"].includes(v))requirements.push([l,v]);
    }
    if(subCol>=0){
      if(groupCol>=0){
        const g=String(r[groupCol]||"").trim();if(g&&!/^Группа$/i.test(g))group=g;
      }
      const s=String(r[subCol]||"").trim(),v=String(r[subCol+1]||"").trim();
      if(groupCol<0&&s&&!v&&!/^(Антибиотик \/ вещество|Определяемый показатель)$/i.test(s)){group=s;continue}
      if(s&&v&&!/^(Антибиотик \/ вещество|Определяемый показатель)$/i.test(s)&&!/(ppb|предел обнаружения)/i.test(s))substances.push({group,substance:s,ppb:v});
    }
  }
  const customTabs=requirements.length?[{id:"requirements-"+safeSlug(marker),label:"Требования / показатели",kind:"pairs",rows:uniquePairs(requirements)}]:[];
  return {name,fields:uniquePairs(fields),advantages:uniquePairs(advantages),complectation:uniquePairs(complectation),substances,customTabs};
}
function buildGarantCards(s){
  const rows=s.rawRows||s.rows||[],starts=parallelBlockStarts(rows),merged=new Map();
  starts.forEach((st,i)=>{
    const marker=String(rows[st]?.[0]||"").trim(),parsed=parseParallelProduct(rows,st,starts[i+1]??rows.length);
    const key=marker.toLowerCase(),old=merged.get(key)||{name:parsed.name||marker,fields:[],advantages:[],complectation:[],substances:[],customTabs:[]};
    old.fields=uniquePairs([...old.fields,...parsed.fields]);
    old.advantages=uniquePairs([...old.advantages,...parsed.advantages]);
    old.complectation=uniquePairs([...old.complectation,...parsed.complectation]);
    old.customTabs=[...old.customTabs,...parsed.customTabs];
    const seen=new Set(old.substances.map(x=>[x.group,x.substance,x.ppb].join("\u0000")));
    for(const x of parsed.substances){const k=[x.group,x.substance,x.ppb].join("\u0000");if(!seen.has(k)){seen.add(k);old.substances.push(x)}}
    merged.set(key,old);
  });
  const img=state.assets.sectionImages?.[s.id]?.[0]||"";
  for(const parsed of merged.values())registerCatalog(s.id,parsed.name,parsed.fields,img?[img]:[],{
    advantages:parsed.advantages,complectation:parsed.complectation,substances:parsed.substances,customTabs:parsed.customTabs
  });
}
function splitAdvantages(pairs){
  const arr=pairs||[],idx=arr.findIndex((p)=>/^(Преимущество|Особенность)$/i.test(String(p.label||"").trim())&&/Практическое значение/i.test(String(p.value||"")));
  if(idx<0)return {fields:cleanPairs(arr),advantages:[]};
  return {fields:cleanPairs(arr.slice(0,idx)),advantages:uniquePairs(arr.slice(idx+1).map((p)=>[p.label,p.value]))};
}

function compactRowValue(r,start=1){
  return (r||[]).slice(start).filter((v)=>String(v||"").trim()).map((v)=>String(v).trim()).join(" · ");
}
function parseAnalyzerRaw(section){
  const rows=section.rawRows||section.rows||[];
  const out={fields:[],indicators:[],indicatorTable:null,tabTables:{},options:[],variants:[],calibration:[],equipment:[],advantages:[],customTabs:[]};
  let mode="fields",custom=null;
  const headingMap=new Map([
    ["измеряемые показатели","indicators"],["дополнительные опции","options"],["дополнительные параметры / опции","options"],
    ["дополнительная комплектация","options"],["варианты исполнения","variants"],["возможные калибровки","calibration"],
    ["калибровки","calibration"],["оснащение","equipment"],["особенности","advantages"],
    ["особенности и практическое значение","advantages"],["преимущества и практическое значение","advantages"]
  ]);
  const headerRx=/^(Характеристика|Показатель|Дополнительный показатель|Исполнение|Канал|Функция|Особенность|Преимущество|Этап|Вариант работы)$/i;
  const customHeadingRx=/^(Принцип исследования|Интерпретация по .+|4-камерная кассета|Программное обеспечение и интерпретация)$/i;
  const pushCustom=(label)=>{custom={id:"raw-"+safeSlug(section.id+"-"+label),label,kind:"pairs",rows:[]};out.customTabs.push(custom);mode="custom";};
  for(let i=0;i<rows.length;i++){
    const r=rows[i]||[], vals=r.filter((v)=>String(v||"").trim()), first=String(r[0]||"").trim(), key=first.toLowerCase();
    const next=(rows[i+1]||[]).filter((v)=>String(v||"").trim());
    if(!vals.length)continue;
    if(vals.length===1&&headingMap.has(key)){mode=headingMap.get(key);custom=null;continue;}
    if(vals.length===1&&customHeadingRx.test(first)){pushCustom(first);continue;}
    if(i===0&&first.length>100)continue;
    if(i===0&&vals.length===1)continue;
    if(!first)continue;
    const value=compactRowValue(r,1);
    if(mode!=="fields"&&headerRx.test(first)&&vals.length>=2){
      const headers=r.map(v=>String(v||"").trim()).filter(Boolean);
      if(["indicators","options","variants","calibration","equipment"].includes(mode)){
        out.tabTables[mode]={headers,rows:[]};
        if(mode==="indicators")out.indicatorTable=out.tabTables[mode];
      }
      continue;
    }
    if(headerRx.test(first)&&/^(Значение|Диапазон измерения|Артикул|Калибровка по умолчанию|Описание|Практическое значение)$/i.test(String(r[1]||"").trim()))continue;

    if(vals.length===1){
      if(mode==="calibration"){out.calibration.push(["Вариант",first]);continue;}
      if(mode==="options"){out.options.push(["Опция",first]);continue;}
      if(mode==="custom"&&custom){custom.rows.push(["Пункт",first]);continue;}
      if(next.length>=2){pushCustom(first);continue;}
      out.advantages.push(["Дополнительная информация",first]);continue;
    }
    const pair=[first,value];
    if(mode==="fields"&&/^(Калибровки по умолчанию|Дополнительная калибровка|Калибровка канала \d+|Индивидуальная калибровка|Калибровка)$/i.test(first)){
      out.calibration.push(pair);continue;
    }
    if(mode==="custom"&&custom){custom.rows.push(pair);continue;}
    if(out.tabTables?.[mode]?.headers?.length){
      const width=out.tabTables[mode].headers.length,row=Array.from({length:width},(_,j)=>String(r[j]||"").trim());
      if(row.some(Boolean))out.tabTables[mode].rows.push(row);
    }
    out[mode].push(pair);
  }
  for(const k of ["fields","indicators","options","variants","calibration","equipment","advantages"])out[k]=uniquePairs(out[k]);
  out.customTabs=out.customTabs.map((t)=>({...t,rows:uniquePairs(t.rows)})).filter((t)=>t.rows.length);
  return out;
}
function unisensorImage(...names){
  const n=names.map(x=>String(x||"").toLowerCase()).join(" ");
  const direct=[
    ["twinsensor","https://unisensor.be/assets/c5f73568-bc5e-46da-8bb5-455af1bd6b48/500x500/unisensor-web-dairy-twinsensor-kit020.jpg"],
    ["tetrasensor","https://www.sinanson.com/idea/kd/83/myassets/products/673/unisensor-web-honey-tetrasensor-kit008-009.jpg?revision=1742303667"],
    ["meatsensor","https://labware.saccosystem.com/public/ImgProd/Big/L029689.jpg"],
    ["aflasensor","img/photos/03-testy-dopolnitelnyh-grupp/03-aflasensor.png"],
    ["aminosensor","img/photos/03-testy-dopolnitelnyh-grupp/03-aminosensor.png"],
    ["cowsensor","img/photos/03-testy-dopolnitelnyh-grupp/03-cowsensor.png"],
    ["milksensor","img/photos/03-testy-dopolnitelnyh-grupp/03-milksensor-ltse.png"],
    ["quinosensor","img/photos/03-testy-dopolnitelnyh-grupp/03-quinosensor.png"],
    ["sulfasensor","img/photos/03-testy-dopolnitelnyh-grupp/03-sulfasensor.png"],
    ["tylosensor","img/photos/03-testy-dopolnitelnyh-grupp/03-tylosensor.png"]
  ];
  for(const [key,path] of direct)if(n.includes(key))return path;
  const imgs=state.assets.sectionImages?.["2.1.2"]||[];
  return imgs.find(path=>{const z=path.toLowerCase();return names.some(x=>{const k=safeSlug(x).replace(/-/g,"");return k&&z.replace(/[^a-zа-яё0-9]/gi,"").includes(k.slice(0,12));});})||"";
}
function parseUnisensorBlock(rows,start,end,name,initialGroup=""){
  const block=rows.slice(start,end),fields=[],advantages=[],substances=[];let group=initialGroup;
  for(const r of block){
    const a=String(r[0]||"").trim(),b=String(r[1]||"").trim(),c=String(r[2]||"").trim(),d=String(r[3]||"").trim(),e=String(r[4]||"").trim(),f=String(r[5]||"").trim();
    if(a&&b&&!/^(Характеристика|Наименование)$/i.test(a)&&b!=="Данные"&&b!=="-")fields.push([a,b]);
    if(c&&d&&!/^(Преимущество)$/i.test(c)&&!/Практическое значение/i.test(d))advantages.push([c,d]);
    if(e&&!f&&!/^(Антибиотик \/ вещество|Определяемый показатель)$/i.test(e)){group=e;continue;}
    if(e&&f&&!/^(Антибиотик \/ вещество|Определяемый показатель)$/i.test(e))substances.push({group,substance:e,ppb:f});
  }
  return {name,fields:uniquePairs(fields),advantages:uniquePairs(advantages),substances};
}
function buildUnisensorCards(s){
  const rows=s.rawRows||s.rows||[],starts=[];
  rows.forEach((r,i)=>{
    const a=String(r?.[0]||"").trim(),c=String(r?.[2]||"").trim(),e=String(r?.[4]||"").trim();
    const next=String(rows[i+1]?.[0]||"").trim();
    if(a&&next==="Характеристика"&&(a===c||a===e||(!c&&!e)))starts.push(i);
  });
  starts.forEach((st,i)=>{
    const marker=String(rows[st]?.[0]||"").trim(),en=starts[i+1]??rows.length;
    const parsed=parseUnisensorBlock(rows,st+1,en,marker);
    const display=parsed.fields.find(r=>r[0]==="Наименование")?.[1]||marker;
    const cleanName=display.replace(/^Экспресс-тест\s+/i,"").trim()||marker;
    const img=unisensorImage(marker,display,cleanName);
    registerCatalog("2.1.2",cleanName,parsed.fields,img?[img]:[],{advantages:parsed.advantages,substances:parsed.substances,sourceSectionId:s.id,sourceGid:s.gid});
  });
}
function buildAnalyzerParts(pairs){
  const a=splitAdvantages(pairs),fields=[],indicators=[],options=[],variants=[];
  let mode="fields";
  const optionRx=/^(Термопринтер|Связь|Передача данных|Автоматический пробоотбор|Ультразвуковая мешалка|Операционная система|Управление|Встроенный pH-метр|Определение удельной электропроводности|Реагенты|Меню)$/i;
  for(const r of a.fields){
    const l=String(r[0]).trim(),v=String(r[1]).trim();
    if(!l||!v||l.length>120)continue;
    if(/^(Показатель|Дополнительный показатель)$/i.test(l)&&/^(Диапазон измерения|Обозначение)$/i.test(v)){mode=l.startsWith("Доп")?"options":"indicators";continue;}
    if(l==="Исполнение"&&v==="Артикул"){mode="variants";continue;}
    if(l==="Канал"&&/Калибровка/i.test(v)){mode="options";continue;}
    if(l==="Функция"&&/Описание/i.test(v)){mode="options";continue;}
    if(/доп\. опция/i.test(l)){options.push([l.replace(/\s*\(доп\. опция\)/i,""),v]);continue;}
    if(optionRx.test(l)){options.push([l,v]);continue;}
    if(mode==="indicators")indicators.push([l,v]);
    else if(mode==="options")options.push([l,v]);
    else if(mode==="variants")variants.push([l,v]);
    else fields.push([l,v]);
  }
  return {fields:uniquePairs(fields),indicators:uniquePairs(indicators),options:uniquePairs(options),variants:uniquePairs(variants),advantages:a.advantages};
}
function buildAnalyzerRows(rows){
  const fields=[],indicators=[],options=[],advantages=[];let mode="fields";
  for(const r of rows||[]){
    const a=String(r[0]||"").trim();
    if(!a)continue;
    if(a==="Измеряемые показатели"){mode="indicators";continue;}
    if(a==="Дополнительные параметры / опции"||a==="Дополнительная комплектация"){mode="options";continue;}
    if(a==="Преимущества и практическое значение"){mode="advantages";continue;}
    if(["Показатель","Дополнительный показатель","Преимущество","Дополнительная опция"].includes(a))continue;
    if(mode==="fields"){
      if(r.length>=2&&a.length<100&&a!=="Источник")fields.push([a,String(r[1]||"").trim()]);
    }else if(mode==="indicators"){
      if(r.length>=3)indicators.push([a,[r[1],r[2],r[3]?"погрешность "+r[3]:""].filter(Boolean).join(" · ")]);
    }else if(mode==="options"){
      if(r.length===1)options.push([a,"Доступно"]);
      else if(r.length>=2)options.push([a,String(r[1]||"").trim()]);
    }else if(mode==="advantages"&&r.length>=2){
      advantages.push([a,String(r[1]||"").trim()]);
    }
  }
  return {fields:uniquePairs(fields),indicators:uniquePairs(indicators),options:uniquePairs(options),advantages:uniquePairs(advantages)};
}
function sectionRowsBetween(rows,startLabel,endLabel){
  const a=rows.findIndex((r)=>String(r[0]||"").trim()===startLabel);
  if(a<0)return [];
  const b=endLabel?rows.findIndex((r,i)=>i>a&&String(r[0]||"").trim()===endLabel):rows.length;
  return rows.slice(a+1,b<0?rows.length:b);
}
function buildExtensoCard(ext){
  const rows=ext.rawRows||ext.rows||[];
  const headingIndex=(label)=>rows.findIndex(r=>String(r?.[0]||"").trim()===label);
  const pairRange=(a,b)=>{
    const st=headingIndex(a),en=b?headingIndex(b):rows.length;if(st<0)return [];
    return uniquePairs(rows.slice(st+1,en<0?rows.length:en).map(r=>[String(r?.[0]||"").trim(),compactRowValue(r,1)])
      .filter(([l,v])=>l&&v&&!/^(Характеристика|Показатель|Этап|Компонент|Вид калибровки|Преимущество)$/i.test(l)));
  };
  const firstScenario=headingIndex("EXTENSO ДЛЯ МОЛОКА");
  const fields=uniquePairs(rows.slice(0,firstScenario<0?rows.length:firstScenario).map(r=>[String(r?.[0]||"").trim(),compactRowValue(r,1)])
    .filter(([l,v])=>l&&v&&!/^(СИСТЕМА EXTENSO|Характеристика)$/i.test(l)&&v!=="Значение"));
  const milk=pairRange("EXTENSO ДЛЯ МОЛОКА","EXTENSO ДЛЯ МЯСА");
  const meat=pairRange("EXTENSO ДЛЯ МЯСА","КОМПЛЕКТАЦИЯ");
  const compMilk=[],compMeat=[],workMilk=[],workMeat=[],calibration=[],advantages=[];let mode="",sub="";
  for(const r of rows){
    const a=String(r[0]||"").trim(),v=String(r[1]||"").trim();
    if(a==="КОМПЛЕКТАЦИЯ"){mode="comp";sub="";continue}
    if(a==="ПОРЯДОК РАБОТЫ"){mode="workflow";sub="";continue}
    if(a==="КАЛИБРОВКА"){mode="cal";continue}
    if(a==="ПРЕИМУЩЕСТВА И ПРАКТИЧЕСКОЕ ЗНАЧЕНИЕ"){mode="adv";continue}
    if(a.startsWith("ТАБЛИЦА ЧУВСТВИТЕЛЬНОСТИ EXTENSO")){mode="";continue}
    if(mode==="comp"){
      if(["Молоко","Мясо"].includes(a)){sub=a;continue}
      if(a&&v&&!["Компонент","Количество"].includes(a))(sub==="Мясо"?compMeat:compMilk).push([a,v]);
    }else if(mode==="workflow"){
      if(["Молоко","Мясо"].includes(a)){sub=a;continue}
      if(a&&v&&!["Этап","Действие"].includes(a))(sub==="Мясо"?workMeat:workMilk).push(["Шаг "+a,v]);
    }else if(mode==="cal"){
      if(a&&v&&a!=="Вид калибровки")calibration.push([a,v]);
    }else if(mode==="adv"){
      if(a&&v&&a!=="Преимущество")advantages.push([a,v]);
    }
  }
  const sensTabs=[];
  const sensStarts=rows.map((r,i)=>String(r?.[0]||"").trim().startsWith("ТАБЛИЦА ЧУВСТВИТЕЛЬНОСТИ EXTENSO")?i:-1).filter(i=>i>=0);
  sensStarts.forEach((st,i)=>{
    const title=String(rows[st]?.[0]||"").trim(),header=(rows[st+1]||[]).map(v=>String(v||"").trim()).filter(Boolean),en=sensStarts[i+1]??rows.length;
    const body=rows.slice(st+2,en).map(r=>Array.from({length:header.length},(_,j)=>String(r?.[j]||"").trim())).filter(r=>r.some(Boolean));
    if(!header.length||!body.length)return;
    const isMeat=/МЯСО/i.test(title);
    sensTabs.push({id:isMeat?"extSensitivityMeat":"extSensitivityMilk",label:isMeat?"Чувствительность · мясо":"Чувствительность · молоко",kind:"table",headers:header,rows:body});
  });
  const customTabs=[
    {id:"extMilk",label:"EXTENSO для молока",kind:"pairs",rows:milk},
    {id:"extMeat",label:"EXTENSO для мяса",kind:"pairs",rows:meat},
    {id:"compMilk",label:"Комплектация · молоко",kind:"pairs",rows:compMilk},
    {id:"compMeat",label:"Комплектация · мясо",kind:"pairs",rows:compMeat},
    {id:"workMilk",label:"Порядок работы · молоко",kind:"steps",rows:workMilk},
    {id:"workMeat",label:"Порядок работы · мясо",kind:"steps",rows:workMeat},
    ...sensTabs
  ];
  return {fields,customTabs,calibration:uniquePairs(calibration),advantages:uniquePairs(advantages),substances:[]};
}
function buildConsumableBlocks(s){
  const rows=s.rawRows||s.rows||[],starts=[];
  rows.forEach((r,i)=>{if(String(r?.[0]||"").trim()==="Наименование"&&String(r?.[1]||"").trim())starts.push({i,name:String(r[1]).trim()})});
  const out=[];
  starts.forEach((item,n)=>{
    const next=starts[n+1]?.i??rows.length,en=Math.max(item.i+1,next-1),block=rows.slice(item.i,en);
    const fields=[],advantages=[],workflow=[],complectation=[],washCycle=[];let mode="fields";
    for(const r of block){
      const vals=(r||[]).map(v=>String(v||"").trim()),a=vals[0],v=vals.slice(1).filter(Boolean).join(" · ");
      if(!a)continue;
      if(!v){
        if(/Преимуществ|Практическое значение/i.test(a)){mode="advantages";continue}
        if(/Состав комплекта/i.test(a)){mode="complectation";continue}
        if(/Рекомендуемый цикл мойки|При простое/i.test(a)){mode="wash";continue}
        if(/Место в цикле мойки|Приготовление рабочего раствора|Как используется кассета/i.test(a)){mode="workflow";continue}
        continue;
      }
      if(/^(Характеристика|Наименование|Особенность|Этап|Компонент|Шаг|Ситуация)$/i.test(a)&&/^(Значение|Практическое значение|Количество|Средство|Действие|Что делать|Зачем это нужно)/i.test(v))continue;
      if(["-","—"].includes(v))continue;
      const pair=[a,v];
      if(mode==="advantages")advantages.push(pair);
      else if(mode==="workflow")workflow.push(pair);
      else if(mode==="complectation")complectation.push(pair);
      else if(mode==="wash")washCycle.push(pair);
      else if(a!=="Наименование")fields.push(pair);
    }
    out.push({name:item.name,fields:uniquePairs(fields),advantages:uniquePairs(advantages),workflow:uniquePairs(workflow),complectation:uniquePairs(complectation),washCycle:uniquePairs(washCycle)});
  });
  const shared=out.find(x=>x.name==="EKOWEEK")?.washCycle||[];
  for(const x of out)if(x.name==="EKODAY"&&!x.washCycle.length&&shared.length)x.washCycle=deepCopy(shared);
  return out;
}
function buildChapter2Catalog(){
  state.sectionCatalog.clear();
  const ch=state.chapters.get("2");if(!ch)return;
  const sBy=(id)=>ch.sections.find((s)=>s.id===id);

  // 2.1.1 — границы карточек и смысловые колонки определяются по структуре листа, без номеров строк
  const fourS=sBy("2.1.1"),fr=fourS?.rawRows||fourS?.rows||[];
  const fourStarts=parallelBlockStarts(fr);
  const fourGroupImage=(marker,name="")=>{
    const n=(String(marker||"")+" "+String(name||"")).toLowerCase().replace(/[^a-zа-яё0-9]+/gi," ");
    if(n.includes("4sensor sensitive"))return "img/photos/02-testy-4-gruppy/02-ekspress-test-4sensor-sensitive.png";
    if(n.includes("dipsensor"))return "img/photos/02-testy-4-gruppy/02-dipsensor.png";
    if(n.includes("4sensor"))return "img/photos/02-testy-4-gruppy/02-ekspress-test-4sensor.png";
    if(n.includes("ankar")&&n.includes("milk"))return "img/photos/02-testy-4-gruppy/02-ekspress-test-ankar-milk-test.png";
    if(n.includes("garant")&&n.includes("4"))return "img/photos/02-testy-4-gruppy/02-ekspress-test-garant-4-utra-milk.png";
    return "";
  };
  fourStarts.forEach((st,i)=>{
    const marker=String(fr[st]?.[0]||"").trim(),parsed=parseParallelProduct(fr,st,fourStarts[i+1]??fr.length);
    const image=fourGroupImage(marker,parsed.name);
    registerCatalog("2.1.1",parsed.name||marker,parsed.fields,image?[image]:[],{
      advantages:parsed.advantages,substances:parsed.substances,complectation:parsed.complectation,customTabs:parsed.customTabs
    });
  });
  // 2.1.2 — Unisensor: карточки собираются из всей страницы листа
  const us=sBy("2.1.2");if(us)buildUnisensorCards(us);

  const g=sBy("2.1.3");if(g)buildGarantCards(g);

  const d=sBy("2.1.4");
  if(d)registerCatalog("2.1.4","Delvotest SP-NT / Delvotest T",cleanPairs(d.pairs),[
    "img/photos/02-testy-4-gruppy/02-test-sistemy-delvotest-sp-nt.png",
    "img/photos/02-testy-4-gruppy/02-test-sistemy-delvotest-t.png"
  ]);

  const ext=sBy("2.3");if(ext){const x=buildExtensoCard(ext);registerCatalog("2.3","Система EXTENSO · молоко и мясо",x.fields,state.assets.sectionImages?.["2.3"]||[],x);}
  function buildIncubatorCards(s){
  const rows=s.rawRows||s.rows||[];
  const starts=[];
  for(let i=0;i<rows.length-1;i++){
    const vals=(rows[i]||[]).map(v=>String(v||"").trim()).filter(Boolean);
    const next=(rows[i+1]||[]).map(v=>String(v||"").trim()).filter(Boolean);
    if(vals.length===1&&/^(Характеристика|Страна производства)$/i.test(next[0]||""))starts.push(i);
  }
  const imageFor=(name)=>{
    const n=String(name||"").toLowerCase();
    if(n.includes("tias"))return "img/photos/12-inkubatory-i-schityvayuschie-ustroystva/12-tias.png";
    if(n.includes("hs 00647")||n.includes("hs-00647"))return "img/photos/12-inkubatory-i-schityvayuschie-ustroystva/12-heatsensor-hs-00647.png";
    if(n.includes("duo"))return "img/photos/12-inkubatory-i-schityvayuschie-ustroystva/12-heatsensor-duo.png";
    if(n.includes("octo"))return "img/photos/12-inkubatory-i-schityvayuschie-ustroystva/12-heatsensor-octo.png";
    if(n.includes("delvotest"))return "img/photos/12-inkubatory-i-schityvayuschie-ustroystva/12-delvotest.png";
    return "";
  };
  starts.forEach((st,i)=>{
    const end=starts[i+1]??rows.length;
    const name=String(rows[st]?.[0]||"").trim().replace(/^\*+|\*+$/g,"").trim();
    const fields=[],advantages=[],modes=[];
    let mode="fields";
    for(const r of rows.slice(st+1,end)){
      const vals=(r||[]).map(v=>String(v||"").trim()).filter(Boolean);
      if(!vals.length)continue;
      if(vals.length===1){
        const heading=vals[0].replace(/^\*+|\*+$/g,"").trim();
        if(/^(Преимущества|Преимущества и практическое значение)$/i.test(heading))mode="advantages";
        continue;
      }
      const label=String(vals[0]).replace(/^\*+|\*+$/g,"").trim();
      const value=vals.slice(1).join(" · ").trim();
      if(!label||!value||/^(Характеристика|Наименование)$/i.test(label))continue;
      if(mode==="advantages"){
        if(!/^(Преимущество|Практическое значение)$/i.test(label))advantages.push([label,value]);
      }else{
        if(/^Режим работы №/i.test(label))modes.push([label,value]);
        else fields.push([label,value]);
      }
    }
    const image=imageFor(name);
    registerCatalog("2.4",name,fields,image?[image]:[],{
      advantages:uniquePairs(advantages),
      customTabs:modes.length?[{id:"modes-"+safeSlug(name),label:"Режимы работы",kind:"pairs",rows:uniquePairs(modes)}]:[]
    });
  });
}

  const inc=sBy("2.4");if(inc)buildIncubatorCards(inc);

  const readers=sBy("2.5");if(readers){
    const blocks=splitPairBlocks(readers);
    blocks.forEach((b,i)=>registerCatalog("2.5",b.name,b.fields,i===0?["img/photos/12-inkubatory-i-schityvayuschie-ustroystva/12-ankar-100.png"]:[],{advantages:b.advantages}));
  }

  // 2.6 и 2.7 — собираем все блоки листа: характеристики, показатели, опции, калибровки, оснащение, особенности
  const analyzerBase={
    "2.6.1":[["Артикул","0704.05.001"],["Исследуемый материал","Молоко"]],
    "2.6.2":[["Артикул","0704.05.006"],["Исследуемый материал","Молоко и молочное сырьё"]],
    "2.6.5":[["Артикул","0704.05.022"],["Исследуемый материал","Молоко и молочное сырьё"]],
    "2.6.6":[["Артикул","0704.05.023"],["Исследуемый материал","Молоко и молочное сырьё"]],
    "2.6.7":[["Артикул","0704.05.024"],["Исследуемый материал","Молоко и молочное сырьё"]]
  };
  for(const child of ch.sections.filter((s)=>s.id.startsWith("2.6."))){
    const x=parseAnalyzerRaw(child);
    const fields=withFallbackFields(x.fields,analyzerBase[child.id]||[]);
    const customTabs=[...(x.customTabs||[]),...(x.equipment.length?[{id:"equipment-"+safeSlug(child.id),label:"Оснащение",kind:"pairs",rows:x.equipment}]:[])];
    registerCatalog("2.6",child.title.replace(/^Ekomilk — /,"Ekomilk "),fields,state.assets.sectionImages?.[child.id]||[],{
      type:"Анализатор качества молока",indicators:x.indicators,indicatorTable:x.indicatorTable,tabTables:x.tabTables,options:x.options,variants:x.variants,
      calibration:x.calibration,advantages:x.advantages,customTabs,sourceSectionId:child.id,sourceGid:child.gid
    });
  }
  for(const child of ch.sections.filter((s)=>s.id.startsWith("2.7."))){
    const x=parseAnalyzerRaw(child),fields=uniquePairs(x.fields);
    const customTabs=[...(x.customTabs||[]),...(x.equipment.length?[{id:"equipment-"+safeSlug(child.id),label:"Оснащение",kind:"pairs",rows:x.equipment}]:[])];
    registerCatalog("2.7",child.title,fields,state.assets.sectionImages?.[child.id]||[],{
      type:"Анализатор соматических клеток",indicators:x.indicators,indicatorTable:x.indicatorTable,tabTables:x.tabTables,options:x.options,variants:x.variants,
      calibration:x.calibration,advantages:x.advantages,customTabs,sourceSectionId:child.id,sourceGid:child.gid
    });
  }
  // Ekomilk HORIZON относится сразу к двум категориям: качество молока и соматические клетки.
  // В 2.7 создаём независимую карточку-копию со всем содержимым исходной карточки 2.6.
  const horizonSource=state.products.get("catalog-2-6-ekomilk-horizon");
  if(horizonSource){
    const hp=deepCopy(horizonSource.product),hImages=deepCopy(state.assets.productImages?.[horizonSource.product.id]||[]);
    registerCatalog("2.7",hp.name,hp.detailFields||[],hImages,{
      article:hp.article||"",type:hp.type||"Анализатор качества молока",purpose:hp.purpose||"",
      advantages:hp.advantages||[],substances:hp.substances||[],indicators:hp.indicators||[],indicatorTable:hp.indicatorTable||null,
      tabTables:hp.tabTables||{},options:hp.options||[],variants:hp.variants||[],complectation:hp.complectation||[],
      workflow:hp.workflow||[],calibration:hp.calibration||[],assortment:hp.assortment||[],consumables:hp.consumables||[],
      testKits:hp.testKits||[],washCycle:hp.washCycle||[],customTabs:hp.customTabs||[],
      sourceSectionId:hp.sourceSectionId||"2.6.4",sourceGid:hp.sourceGid||null
    });
  }
  // 2.8 — каждый расходник отдельной карточкой, включая EKODAY; комплектация отдельно
  const cons=sBy("2.8");if(cons){
    buildConsumableBlocks(cons).forEach((b)=>registerCatalog("2.8",b.name,b.fields,[],{advantages:b.advantages,workflow:b.workflow,complectation:b.complectation,washCycle:b.washCycle}));
  }

  // остальные key-value каталоги
  for(const id of ["2.9","2.12"]){
    const s=sBy(id);if(!s)continue;
    const blocks=splitPairBlocks(s);
    if(blocks.length)blocks.forEach((b,i)=>registerCatalog(id,b.name,b.fields,(state.assets.sectionImages?.[id]||[]).slice(i,i+1),{advantages:b.advantages}));
    else registerCatalog(id,s.title,cleanPairs(s.pairs),state.assets.sectionImages?.[id]||[]);
  }

  // 2.15 — БиоТФ и тест-наборы строятся из актуальных строк листа
  const bio=sBy("2.15");if(bio){
    const rows=bio.rawRows||bio.rows||[];
    const ix=(label,from=0)=>rows.findIndex((r,i)=>i>=from&&String(r?.[0]||"").trim()===label);
    const practical=ix("Практическое значение"),kits=ix("Тест-наборы для БиоТФ");
    const fields=sourcePairs(rows.slice(1,practical<0?rows.length:practical));
    const advantages=sourcePairs(rows.slice(practical+1,kits<0?rows.length:kits));
    const kitNames=["СТАРТ","ПАСТ","ПРО","ЩФ"],customTabs=[];
    kitNames.forEach((name,i)=>{
      const a=ix(name,kits<0?0:kits),b=i<kitNames.length-1?ix(kitNames[i+1],a+1):rows.length;
      if(a<0)return;
      const block=sourcePairs(rows.slice(a+1,b<0?rows.length:b),{keepSingles:true});
      if(block.length)customTabs.push({id:"bio-"+safeSlug(name),label:name,kind:"pairs",rows:block});
    });
    const name=rows.find(r=>String(r?.[0]||"").trim()==="Наименование")?.[1]||"Турбидофлуориметр БиоТФ";
    registerCatalog("2.15",name,fields,state.assets.sectionImages?.["2.15"]||[],{advantages,customTabs});
  }
  // 2.16 — Люминометр SMART, LuciPac и нормы RLU — также только из листа
  const san=sBy("2.16");if(san){
    const rows=san.rawRows||san.rows||[];
    const ix=(label,from=0)=>rows.findIndex((r,i)=>i>=from&&String(r?.[0]||"").trim()===label);
    const practical=ix("Практическое значение"),luci=ix("LuciPac A3 Water / Surface"),norms=ix("Рекомендуемые нормы производителя");
    const fields=sourcePairs(rows.slice(1,practical<0?rows.length:practical));
    const advantages=sourcePairs(rows.slice(practical+1,luci<0?rows.length:luci));
    const luciRows=luci>=0?sourcePairs(rows.slice(luci+1,norms<0?rows.length:norms),{keepSingles:true}):[];
    const normRows=[];
    if(norms>=0){
      for(const r of rows.slice(norms+1)){
        const obj=String(r?.[0]||"").trim(),result=String(r?.[1]||"").trim(),interpretation=String(r?.[2]||"").trim();
        if(!/^(Поверхность|Вода)$/i.test(obj)||!/RLU/i.test(result)||!interpretation)continue;
        normRows.push([obj,result,interpretation]);
        if(normRows.length>=5)break;
      }
    }
    const customTabs=[];
    if(luciRows.length)customTabs.push({id:"luci",label:"LuciPac A3",kind:"pairs",rows:luciRows});
    if(normRows.length)customTabs.push({id:"rlu",label:"Интерпретация RLU",kind:"rlu",rows:normRows});
    const name=rows.find(r=>String(r?.[0]||"").trim()==="Наименование")?.[1]||"Люминометр SMART";
    registerCatalog("2.16",name,fields,state.assets.sectionImages?.["2.16"]||[],{advantages,customTabs});
  }
  // 2.10 — индикаторные полоски. Читаем не только распознанные tables, но и сырые строки:
  // часть каталога приходит как richTable/rawRows и раньше выпадала из карточек.
  const strips=sBy("2.10");if(strips){
    const seen=new Set();
    const stripKey=(name)=>String(name||"")
      .toLowerCase().replace(/ё/g,"е")
      .replace(/,?\s*\d+\s*шт\.?$/i,"")
      .replace(/[^a-zа-я0-9]+/gi,"");
    const purposeByKey={
      "кислотностьмолока":"Для быстрого определения кислотности pH молока. Цветовая шкала в оптимальных для молочной отрасли значениях от 5,3 до 6,9 позволяет проводить контроль сырого, термически обработанного молока, сливок, а также кисломолочных молочных продуктов. Прилагаемая справочная таблица ориентировочного пересчета значений pH в титруемую кислотность позволяет приблизительно определить кислотность молока в градусах Тернера.",
      "ph012":"Для быстрого и эффективного анализа значений pH растворов и жидкостей в диапазоне от 0 до 12 ед. pH. Цветовая шкала с шагом в 1 ед. pH позволяет точно определить значения кислотности и щелочности растворов и жидкостей.",
      "ph59":"Для быстрого и эффективного анализа значений pH растворов и жидкостей в диапазоне нейтральных значений от 5 до 9 ед. pH С использованием полосок возможно осуществлять контроль до 0,5 ед. pH.",
      "мочевинавмолоке":"Для полуколичественного определения мочевины в молоке. Нормальное содержание мочевины в молоке от 0,15 до 0,30 г/л (3,3-5,5 ммоль/л). Отклонения могут свидетельствовать о несбалансированности рациона, а превышение - о фальсификации белковой фазы молока. Индикаторные полоски позволяют провести анализ в диапазоне 0,0-1,0 г/л.",
      "маститноемолоко":"Для определения аномального молока. Прилагаемая инструкция позволяет оценить ориентировочное количество соматических клеток на основании цветовой реакции. Индикаторные полоски идеально подходят для анализа показателя в полевых условиях для быстрой диагностики. Для точного анализа необходимо применять инструментальные методы анализа (ГОСТ 23453-2014 «Молоко. Методы определения количества соматических клеток»).",
      "остаточнаящелочность":"Для экспресс-контроля остаточных количеств щелочных моющих и дезинфицирующих средств в промывных водах и на поверхностях. Цветовая шкала позволяет провести исследование в диапазоне от 0 до 5 000 мг/л по NaOH.",
      "остаточнаякислотность":"Для экспресс-контроля остаточных количеств кислотных моющих и дезинфицирующих средств в промывных водах и на поверхностях. Цветовая шкала позволяет провести исследование в диапазоне от 0 до 5 000 мг/л по серной кислоте.",
      "нук100мг":"Для полуколичественного определения концентрации надуксусной кислоты водных растворов в диапазоне от 0 до 100 мг/л. Прилагаемая в инструкции таблица позволяет перевести полученные результаты в различные объемные единицы содержания НУК в растворе.",
      "нук1000мг":"Для полуколичественного определения концентрации надуксусной кислоты водных растворов в диапазоне от 0 до 1000 мг/л. Прилагаемая в инструкции таблица позволяет перевести полученные результаты в различные объемные единицы содержания НУК в растворе.",
      "хлор10мг":"Для полуколичественного определения концентрации свободного хлора в водных растворах в диапазоне от 0 до 10 мг/л Cl₂.",
      "дхц":"Для визуального контроля приготовления, правильности хранения и определения концентрации рабочих растворов дезинфицирующих средств на основе натриевой соли дихлоризоциануровой кислоты. Индикаторные полоски позволяют провести анализ в растворах, концентрация активного хлора которых составляет от 0,0075 до 0,2%. В инструкции приводится таблица разведений для приготовления растворов перекиси водорода иных концентраций, не определяемых индикаторной полоской.",
      "час100мг":"Для полуколичественного определения концентрации четвертичных аммониевых соединений (ЧАС) в промывных и сточных водах промышленных предприятий. Индикаторные полоски «ЧАС – 100 мг» позволяют контролировать конечную стадию отмывки оборудования и, как следствие, позволяют экономить значительные количества воды.",
      "нейтрализующиевещества":"Для качественного определения наличия соды, аммиака и солей аммония в молоке. Нейтрализующие вещества обладают ингибирующим эффектом, такое молоко становится непригодным к переработке.",
      "пероксид25мг":"Для полуколичественного определения перекиси водорода (H₂O₂) в водных растворах в диапазоне от 0 до 25 мг/л",
      "пероксид1000мг":"Для полуколичественного определения перекиси водорода (H₂O₂) в водных растворах в диапазоне от 0 до 1000 мг/л"
    };
    const addStrip=(name,fields,type="Индикаторные полоски")=>{
      const clean=String(name||"").trim();if(!clean||/медицин/i.test(clean))return;
      const key=stripKey(clean);if(!key||seen.has(key))return;seen.add(key);
      const rows=uniquePairs(fields||[]);
      const fromCatalog=purposeByKey[key]||"";
      const current=rows.find(r=>/^(Предназначение|Назначение)$/i.test(String(r?.[0]||"").trim()))?.[1]||"";
      const purpose=fromCatalog||current;
      if(fromCatalog){
        const idx=rows.findIndex(r=>/^(Предназначение|Назначение)$/i.test(String(r?.[0]||"").trim()));
        if(idx>=0)rows[idx]=["Предназначение",fromCatalog];else rows.unshift(["Предназначение",fromCatalog]);
      }
      const customTabs=purpose?[{id:"purpose",label:"Предназначение",kind:"pairs",rows:[["Предназначение",purpose]]}]:[];
      registerCatalog("2.10",clean,rows,[],{type,customTabs});
    };
    (strips.tables||[]).forEach((t)=>{
      (t.rows||[]).forEach((r)=>{
        const fs=(t.headers||[]).slice(1).map((h,i)=>[h,r[i+1]]).filter((x)=>String(x[1]||"").trim());
        addStrip(r[0],fs,t.title||"Индикаторные полоски");
      });
    });
    // Контрольный набор из бумажного каталога: эти позиции должны существовать даже если
    // очередной импорт Google Sheets распознал страницу неполностью.
    const required=[
      ["Остаточная щелочность",[
        ["Предназначение","Для экспресс-контроля остаточных количеств щелочных моющих и дезинфицирующих средств в промывных водах и на поверхностях. Цветовая шкала позволяет провести исследование в диапазоне от 0 до 5 000 мг/л по NaOH."],
        ["Время анализа","15 с"]
      ]],
      ["НУК - 100 мг",[
        ["Предназначение","Для одновременного определения концентрации надуксусной кислоты в водных растворах в диапазоне от 0 до 100 мг/л. Таблица в инструкции позволяет перевести полученные результаты в различные объёмные единицы содержания НУК в растворе."],
        ["Время анализа","10 с"]
      ]],
      ["НУК - 1000 мг",[
        ["Предназначение","Для одновременного определения концентрации надуксусной кислоты в водных растворах в диапазоне от 0 до 1000 мг/л. Таблица в инструкции позволяет перевести полученные результаты в различные объёмные единицы содержания НУК в растворе."],
        ["Время анализа","10 с"]
      ]],
      ["Хлор - 10 мг",[
        ["Предназначение","Для полуколичественного определения концентрации активного хлора в водных растворах в диапазоне от 0 до 10 мг/л Cl."],
        ["Время анализа","35 с"]
      ]],
      ["ДХЦ",[
        ["Предназначение","Для визуального контроля приготовления, правильности хранения и определения концентрации рабочих растворов дезинфицирующих средств на основе натриевой соли дихлоризоциануровой кислоты."],
        ["Время анализа","10 с"]
      ]],
      ["ЧАС - 100 мг",[
        ["Предназначение","Для полуколичественного определения концентрации четвертичных аммониевых соединений (ЧАС) в промывных и сточных водах промышленных предприятий."],
        ["Время анализа","30 с"]
      ]]
    ];
    required.forEach(([name,fields])=>addStrip(name,fields));
  }

  // микотоксины/ГМО — уже структурированные товары, но выводим их тем же карточным каталогом
  const myco=sBy("2.11");if(myco){
    state.sectionCatalog.set("2.11",(myco.products||[]).map((p)=>state.products.get(p.id)).filter(Boolean));
  }

  // 2.13 — оба продуктовых блока собираются прямо из листа
  const micro=sBy("2.13");if(micro){
    const rows=micro.rawRows||micro.rows||[];
    const idx=(test)=>rows.findIndex(r=>test(String(r?.[0]||"").trim()));
    const between=(a,b)=>{
      const st=idx(a),en=idx(b);if(st<0)return [];
      return rows.slice(st+1,en<0?rows.length:en);
    };
    const asPairs=(arr)=>uniquePairs(arr.map(r=>[String(r?.[0]||"").trim(),compactRowValue(r,1)])
      .filter(([l,v])=>l&&v&&!/^(Характеристика|Этап|Особенность)$/i.test(l)&&!/^Значение$/i.test(v)));
    const asLineup=(arr)=>{
      if(!arr.length)return [];
      const h=arr[0]||[];
      return uniquePairs(arr.slice(1).map(r=>{
        const name=String(r?.[0]||"").trim();
        const info=h.slice(1).map((x,i)=>String(r?.[i+1]||"").trim()?[String(x||"").trim(),String(r[i+1]).trim()]:null).filter(Boolean).map(x=>x[0]+": "+x[1]).join(" · ");
        return [name,info];
      }).filter(r=>r[0]&&r[1]));
    };
    const compareRows=between(x=>x==="KangarooSci или HygieneChek Plus?",()=>false);
    const comparison=compareRows.length>1?compareRows.slice(1).map(r=>[String(r[0]||"").trim(),["KangarooSci — "+String(r[1]||"").trim(),"HygieneChek Plus — "+String(r[2]||"").trim()].filter(x=>!/[—]\s*$/.test(x)).join(" · ")]).filter(r=>r[0]&&r[1]):[];
    let kangFields=asPairs(between(x=>x==="Общие характеристики",x=>x==="Подготовка и проведение анализа"));
    let kangWorkflow=asPairs(between(x=>x==="Подготовка и проведение анализа",x=>x==="Практическое значение"));
    let kangAdv=asPairs(between(x=>x==="Практическое значение",x=>/^Romer Labs HygieneChek Plus/i.test(x)));
    let kangLine=asLineup(between(x=>x==="Линейка тест-пластин",x=>x==="Общие характеристики"));
    const replacePair=(rows,rx,value,addLabel="")=>{
      const out=deepCopy(rows||[]),i=out.findIndex(r=>rx.test(String(r?.[0]||"")));
      if(i>=0)out[i]=[out[i][0],value];else if(addLabel)out.push([addLabel,value]);
      return out;
    };
    kangFields=replacePair(kangFields,/^Назначение$/i,"Микробиологический анализ в готовой продукции, сырье и смывах с поверхностей и подсчет количества микроорганизмов","Назначение");
    kangFields=replacePair(kangFields,/^Формат$/i,"Готовая к работе тест-пластина с питательной средой","Формат");
    kangFields=replacePair(kangFields,/Считывание результата/i,"Визуальный количественный учет колоний после инкубации","Считывание результата");
    kangAdv=replacePair(kangAdv,/Готовая питательная система/i,"Упрощает проведение микробиологического анализа за счет отсутствия необходимости подготовки питательных сред");
    kangAdv=replacePair(kangAdv,/Количественный результат/i,"Позволяет проводить подсчёт количества выросших микроорганизмов");
    kangAdv=replacePair(kangAdv,/Разные селективные варианты/i,"Линейка охватывает весь спектр микробиологических показателей пищевого предприятия.");
    kangAdv=replacePair(kangAdv,/Цветовая дифференциация колоний/i,"Помогает визуально интерпретировать результат конкретной тест-пластины благодаря специальным селективным индикаторным добавкам");
    kangAdv=kangAdv.filter(r=>!/Посев 1 мл/i.test(String(r?.[0]||"")));
    kangAdv=replacePair(kangAdv,/Компактный формат/i,"Тест-пластины полностью заменяют необходимость использования чашек Петри при анализе.");
    kangWorkflow=(kangWorkflow||[]).map(r=>[r[0],String(r[1]||"").replace(/гомогенизация/gi,"гомогенизацию")]);
    if(!kangWorkflow.some(r=>/утилиз/i.test(String(r?.[0]||"")+" "+String(r?.[1]||""))))kangWorkflow.push(["9. Утилизация","Утилизировать тест-пластину как ПБА"]);
    kangLine=(kangLine||[]).map(r=>[String(r[0]||"").replace(/Lactic Acid\s+на\s+KGR014/gi,"Lactic Acid KGR014"),r[1]]);
    registerCatalog("2.13","Тест-пластины KangarooSci",kangFields,state.assets.sectionImages?.["2.13"]||[],{
      advantages:kangAdv,assortment:kangLine,workflow:kangWorkflow,
      customTabs:comparison.length?[{id:"comparison-kangaroo-hygiene",label:"Сравнение с HygieneChek Plus",kind:"pairs",rows:comparison}]:[]
    });
    const hDescIndex=idx(x=>/^Romer Labs HygieneChek Plus/i.test(x));
    if(hDescIndex>=0){
      const hFields=asPairs(between(x=>x==="Общие характеристики HygieneChek Plus",x=>x==="KangarooSci или HygieneChek Plus?"));
      const hWorkflow=asPairs(between(x=>x==="Как используется HygieneChek Plus",x=>x==="Линейка HygieneChek Plus"));
      const hLine=asLineup(between(x=>x==="Линейка HygieneChek Plus",x=>x==="Общие характеристики HygieneChek Plus"));
      registerCatalog("2.13","Romer Labs HygieneChek Plus",hFields,[],{
        assortment:hLine,workflow:hWorkflow,
        customTabs:comparison.length?[{id:"comparison-hygiene-kangaroo",label:"Сравнение с KangarooSci",kind:"pairs",rows:comparison}]:[]
      });
    }
  }
  // питательные среды — корректировки по экспертному файлу по микробиологии
  const media=sBy("2.14");if(media){
    const imgMap=[
      [/сухой питательный бульон/i,"11-suhoy-bulon.png"],[/сухой питательный агар/i,"11-suhoy-agar.png"],
      [/кмафанм/i,"11-kmafanm.png"],[/мкм-1/i,"11-mkm-1.png"],[/мкм-2/i,"11-mkm-2.png"],
      [/кесслер/i,"11-kessler.png"],[/ажфк/i,"11-azhfk.png"],[/\bкода\b/i,"11-koda.png"],[/гпс/i,"11-gps.png"],[/лпс/i,"11-lps.png"],
      [/полужидкая среда с лактозой/i,"11-poluzhidkaya-s-laktozoy.png"],[/эндо/i,"11-endo.png"],[/\bсда\b/i,"11-sda.png"],
      [/ласса/i,"11-lassa.png"],[/сабуро/i,"11-saburo.png"],[/солевой бульон/i,"11-solevoy-bulon.png"],
      [/резазурина натриевая/i,"11-rezazurina-natriya.png"],[/неомицина сульфат/i,"11-neomitsina-sulfat.png"],
      [/термофильного.*b\s*19/i,"11-termofilnyy-streptokokk-b19.png"]
    ];
    const folder="img/photos/11-pitatelnye-sredy-uglich/";
    const deletedRx=[
      /мкм-2/i,/полужидкая среда с лактозой/i,/среда для определения бифидобактерий/i,
      /среда для культивирования бифидобактерий/i,/контрольный образец сычужного фермента/i,
      /актибакт\s*углич[-–— ]*м/i,/неомицина сульфат/i
    ];
    for(const r of media.rawRows||media.rows||[]){
      let name=String(r[1]||"").trim(),purpose=String(r[3]||"").trim();
      if(!name||!purpose||name===name.toUpperCase())continue;
      if(deletedRx.some(rx=>rx.test(name)))continue;

      let target="2.14",cardPurpose="",extra=[];
      let images=[];
      const hit=imgMap.find(([rx])=>rx.test(name));
      if(hit)images=[folder+hit[1]];

      if(/сухой питательный бульон/i.test(name)){
        name="Сухой питательный бульон ГРМ";
        purpose="Неселективная среда для накопления микроорганизмов";
      }else if(/сухой питательный агар/i.test(name)){
        name="Сухой питательный агар ГРМ";
        purpose="Неселективный питательный агар. Может быть использован для исследования КМАФАнМ (ОМЧ), неселективного культивирования микроорганизмов или для получения изолированных колоний на финальных этапах селективного культивирования аэробных микроорганизмов";
      }else if(/кмафанм/i.test(name)){
        purpose="Неселективный питательный агар. Может быть использован для исследования КМАФАнМ (ОМЧ) в соответствии с ГОСТ, кроме этого может применяться для неселективного культивирования микроорганизмов или для получения изолированных колоний на финальных этапах селективного культивирования аэробных микроорганизмов";
      }else if(/мкм-1/i.test(name)){
        name="Бликфельдта";
        purpose="Питательный агар для определения количества молочнокислых микроорганизмов в молочных продуктах по ГОСТ 33951-2016";
        extra.push(["Варианты поставки","Возможна поставка разных модификаций"]);
      }else if(/кесслер/i.test(name)){
        purpose="Жидкая питательная среда Кесслера для определения БГКП в пищевых продуктах по ГОСТ 31747-2012 и в молочных продуктах по ГОСТ 32901-2016";
        extra.push(["Тип анализа","Качественный"]);
      }else if(/ажфк/i.test(name)){
        purpose="Плотная питательная селективная среда для определения БГКП в продуктах сыроделия и маслоделия по ГОСТ 32901-2014";
      }else if(/^кода$/i.test(name)){
        purpose="Жидкая селективная среда, которая используется в микробиологических лабораториях для выделения и дифференциации энтеробактерий по признаку ферментации лактозы.";
      }else if(/гпс/i.test(name)){
        name="Глюкозо-пептонная среда (ГПС) с индикатором";
        purpose="Жидкая питательная среда для санитарно-бактериологического анализа воды (питьевой, минеральной, прибрежной) с целью обнаружения бактерий группы кишечной палочки (БГКП) по признаку ферментации глюкозы.";
      }else if(/^сда\b/i.test(name)){
        images=["img/photos/admin/microbiology/sda.webp"];
      }else if(/ласса/i.test(name)){
        name="Ласса";
        purpose="Полужидкая дифференциально-диагностическая питательная среда, предназначенная для определения спор лактатсбраживающих маслянокислых бактерий (клостридий).";
      }else if(/сабуро/i.test(name)){
        cardPurpose="Среда используется в микробиологических исследованиях для выделения и культивирования сапрофитных грибов (плесеней), включая дрожжеподобные грибы (дрожжи) в пищевых продуктах, сырье, материалах, смывах, воздухе и объектах окружающей среды";
        purpose="Питательная селективная среда для исследования дрожжей и плесневых грибов в пищевых продуктах, сырье, материалах, смывах, воздухе и объектах окружающей среды. Среда используется для анализа в молочных продуктах по ГОСТ 33566-2015 и в пищевых продуктах по ГОСТ 10444.12-2013";
      }else if(/среда агаровая для определения дрожжей и плесеней/i.test(name)){
        name="Сывороточный агар с индикатором БФ";
        purpose="Селективная питательная среда для определения дрожжей и плесневых грибов в молоке и молочных продуктах по ГОСТ 33566-2015";
      }else if(/солевой бульон/i.test(name)){
        purpose="Питательный бульон для селективного накопления солеустойчивых микроорганизмов. Используется на стадии предобогащения (накопления) при исследовании стафилококков, в частности золотистого стафилококка (Staphylococcus aureus) по ГОСТ 30347-2016";
      }else if(/молочно-солевой агар/i.test(name)){
        purpose="Используется при исследовании стафилококков в пищевых продуктах по ГОСТ 31746-2012";
      }else if(/скив/i.test(name)){
        target="2.1.4";name="СКИВ";images=["img/photos/admin/microbiology/skiv.webp"];
        extra.push(["Фасовка","Стеклянный флакон"]);
      }else if(/резазурина натриевая/i.test(name)||/микробитесты.*резазурин/i.test(name)){
        target="2.1.4";
        purpose="Предназначен для определения наличия ингибирующих веществ в молоке по ГОСТ 23453-2012, п. 7";
      }else if(/термофильного.*b\s*19/i.test(name)){
        target="2.1.4";
        name="Тест-культура для определения ингибирующих веществ";
        cardPurpose="Тест-культура термофильного молочнокислого стрептококка Streptococcus thermophilus B19 для исследования по ГОСТ 23453-2016, п. 7.2.3";
        purpose="Предназначен для определения наличия ингибирующих веществ в молоке по ГОСТ 23453-2012, п. 7";
      }

      const fs=[["Назначение",purpose],["Фасовка",r[4]||""],["ТУ / стандарт",r[5]||""],...extra].filter((x)=>x[1]);
      registerCatalog(target,name,fs,images,{purpose:cardPurpose||purpose});
    }
  }
}
function renderSensitivitySection(ch,s){
  const rows=s.rawRows||s.rows||[];
  const headerIndex=rows.findIndex(r=>String(r?.[0]||"").trim()==="Определяемое вещество"&&r.length>1);
  const tests=headerIndex>=0?rows[headerIndex].slice(1).map(v=>String(v||"").trim()).filter(Boolean):[];
  const groups=[];let current=null;
  for(let i=0;i<rows.length;i++){
    const r=rows[i]||[],vals=r.filter(v=>String(v||"").trim()),a=String(r[0]||"").trim();
    if(!vals.length||a.startsWith("Примечание."))continue;
    if(vals.length===1){
      if(!/^Сводная таблица чувствительности тестов$/i.test(a)){current={name:a,rows:[]};groups.push(current)}
      continue;
    }
    if(a==="Определяемое вещество")continue;
    if(!current||!tests.length)continue;
    const values=tests.map((_,j)=>String(r[j+1]||"").trim()||"—");
    current.rows.push([a,...values]);
  }
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title}])+
    '<div class="page-head"><div><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>'+esc(s.title)+'</h1><p>Сравнение чувствительности тестов по группам веществ. Все значения — ppb (мкг/кг).</p></div></div>'+
    '<div class="sensitivity-legend">'+tests.map((t,i)=>'<span><b>'+(i+1)+'</b>'+esc(t)+'</span>').join("")+'</div>'+
    groups.filter((g)=>g.rows.length).map((g)=>'<section class="sensitivity-group"><div class="section-heading compact"><div><h2>'+esc(g.name)+'</h2></div><p>'+g.rows.length+' веществ</p></div><div class="sensitivity-wrap"><table class="sensitivity-table"><thead><tr><th>Вещество</th>'+tests.map((t)=>'<th>'+esc(t)+'</th>').join("")+'</tr></thead><tbody>'+g.rows.map((r)=>'<tr><td>'+esc(r[0])+'</td>'+r.slice(1).map((v)=>'<td class="'+(v==="—"?"empty":"")+'">'+esc(v)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div></section>').join("")+
    '<p class="sensitivity-note">Знак «—» означает, что значение не приведено в использованной таблице чувствительности. Для полного перечня характеристик открывайте карточку конкретного теста.</p>'+rawTables(s);
}
function sectionBaseItems(sectionId){
  if(state.sectionCatalog.has(sectionId))return [...(state.sectionCatalog.get(sectionId)||[])];
  const x=state.sections.get(sectionId);if(!x)return [];
  return (x.section.products||[]).map(p=>({chapter:x.chapter,section:x.section,product:p}));
}
function keepMycoDefault(name){
  const n=String(name||"").trim().toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ");
  return n.includes("agrastrip pro watex")||n.startsWith("ringbio technology")||n==="ифа"||n.startsWith("ифа ")||n.includes("agrastrip gmo trait check");
}
function defaultHiddenProducts(sectionId,items){
  if(sectionId!=="2.11")return [];
  return (items||[]).filter(x=>!keepMycoDefault(x?.product?.name)).map(x=>x.product.id);
}
function defaultProductOrder(sectionId,items){
  const base=(items||[]).map(x=>x.product.id);if(sectionId!=="2.11")return base;
  const rank=name=>{const n=String(name||"").trim().toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ");if(n.includes("agrastrip pro watex"))return 0;if(n.startsWith("ringbio technology"))return 1;if(n==="ифа"||n.startsWith("ифа "))return 2;if(n.includes("agrastrip gmo trait check"))return 3;return 999;};
  return [...items].sort((a,b)=>rank(a.product.name)-rank(b.product.name)).map(x=>x.product.id);
}
function sectionProductLayout(sectionId){
  const items=sectionBaseItems(sectionId),section=state.sections.get(sectionId)?.section||{};
  const defaultOrder=defaultProductOrder(sectionId,items);
  const hidden=Array.isArray(section.hiddenProductIds)?section.hiddenProductIds:defaultHiddenProducts(sectionId,items);
  const deleted=Array.isArray(section.deletedProductIds)?section.deletedProductIds:[];
  const order=Array.isArray(section.productOrder)&&section.productOrder.length?section.productOrder:defaultOrder;
  return {items,defaultOrder,hidden:[...new Set(hidden)],deleted:[...new Set(deleted)],order:[...new Set([...order,...defaultOrder])]};
}
function orderedSectionItems(sectionId,{includeHidden=false,includeDeleted=false}={}){
  const l=sectionProductLayout(sectionId),byId=new Map(l.items.map(x=>[x.product.id,x])),hidden=new Set(l.hidden),deleted=new Set(l.deleted),out=[];
  const keep=id=>includeDeleted||!deleted.has(id);
  for(const id of l.order){const x=byId.get(id);if(!x)continue;if(keep(id)&&(includeHidden||!hidden.has(id)))out.push(x);byId.delete(id);}
  for(const x of byId.values())if(keep(x.product.id)&&(includeHidden||!hidden.has(x.product.id)))out.push(x);
  return out;
}
function isProductHidden(sectionId,productId){return sectionProductLayout(sectionId).hidden.includes(productId);}
function isProductDeleted(sectionId,productId){return sectionProductLayout(sectionId).deleted.includes(productId);}
function isProductExcluded(sectionId,productId){return isProductHidden(sectionId,productId)||isProductDeleted(sectionId,productId);}
function renderCatalogSection(ch,s){
  const items=orderedSectionItems(s.id);
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title}])+
    '<div class="page-head"><div><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>'+esc(s.title)+'</h1><p>'+items.length+' карточек</p></div></div>'+

    (items.length?'<div class="filter-row"><input class="filter-input" id="sectionFilter" type="search" placeholder="Поиск внутри раздела…"></div><section class="product-grid" id="sectionProducts">'+items.map(card).join("")+'</section>':'<div class="empty-state"><strong>Карточки готовятся</strong></div>');
    if(items.length){
    q("#sectionFilter").addEventListener("input",(e)=>{const z=e.target.value.toLowerCase().trim(),f=items.filter((it)=>JSON.stringify(it.product).toLowerCase().includes(z));q("#sectionProducts").innerHTML=f.length?f.map(card).join(""):'<div class="empty-state" style="grid-column:1/-1"><strong>Ничего не найдено</strong></div>';});
  }
}

function upperRowStart(v){
  const s=String(v??"");
  const m=s.match(/^(\s*)([а-яё])(.*)$/s);
  return m?m[1]+m[2].toUpperCase()+m[3]:s;
}
function splitFeatureText(text){
  return String(text||"").split(/;|\.\s+(?=[А-ЯA-ZЁ])/).map((x)=>upperRowStart(x.trim().replace(/[.;]+$/,""))).filter((x)=>x.length>2);
}
function inferFeatureCharacteristic(text){
  const s=String(text||"").trim(),l=s.toLowerCase().replace(/ё/g,"е");
  const starts=(x)=>l.startsWith(x);
  if(/^комплект на \d+\s+анализ/i.test(l))return "Количество анализов в комплекте";
  const rules=[
    ["размер щетк","Размер щётки"],["размер лист","Размер листа"],["размер","Размер"],
    ["объем","Объём"],["длина","Длина"],["ширина","Ширина"],["высота","Высота"],
    ["диаметр","Диаметр"],["толщина","Толщина"],["масса","Масса"],["вес","Масса"],
    ["плотность","Плотность"],["цвет","Цвет"],["упаковка","Упаковка"],
    ["количество","Количество"],["мощность","Мощность"],["производительность","Производительность"],
    ["давление","Давление"],["расход","Расход"],["питание","Питание"],["напряжение","Напряжение"],
    ["температур","Температура"],["время","Время"],["диапазон","Диапазон"],
    ["материал","Материал"],["изготовлен из","Материал"],["изготовлена из","Материал"],["изготовлено из","Материал"],["изготовлены из","Материал"],
    ["выполнен из","Материал"],["выполнена из","Материал"],["выполнено из","Материал"],["выполнены из","Материал"],
    ["прочный пластик","Материал"],["металлическая ручка","Материал ручки"],
    ["жесткая щетина","Щетина"],["встроенная пружина","Пружина"],
    ["горизонтальная щетка подвижна","Подвижность горизонтальной щётки"],
    ["наклонное дно","Конструкция"],["состоит из","Конструкция"],["конструкция","Конструкция"],
    ["возможно штабелирование","Штабелирование"],["штабелирован","Штабелирование"],
    ["зернистость","Зернистость"],["ресурс","Ресурс"],["срок службы","Срок службы"],
    ["скорость","Скорость"],["частота","Частота"],["грузоподъемност","Грузоподъёмность"],
    ["в комплекте","Комплектация"],["комплект","Комплектация"],
    ["встроенн","Оснащение"],["регулиров","Регулировка"]
  ];
  for(const [prefix,label] of rules)if(starts(prefix))return label;
  if(/^до \d+\s+(?:ягнят|телят|животных)(?:\s|$)/i.test(l))return "Количество животных";
  if(/(?:^|[,;]\s*)(?:в комплекте|в комплект входит|в комплект входят|входит в комплект|входят в комплект|соска в комплекте|цепь .*в комплекте)/i.test(l))return "Комплектация";
  if(/^(?:ручка|клапаны?|соски?|зонд|зонды|кабель|адаптер|ремень|щетки?).*в комплекте$/i.test(l))return "Комплектация";
  if(/^[a-zа-яё][^;]{0,100}\sв комплекте$/i.test(l))return "Комплектация";
  return "";
}
function classifySheetFields(p){
  const source=(p.sheetFields||[]).map((r)=>[upperRowStart(String(r[0]||"").trim()),upperRowStart(String(r[1]||"").trim())]).filter((r)=>r[0]&&r[1]);
  const characteristics=[],advantages=[],complectation=[],options=[],variants=[];
  const baseSkip=/^(Наименование|Название|Артикул)$/i;
  let featureSeen=false,advIndex=0;
  const distributeFeature=(value)=>{
    featureSeen=true;
    splitFeatureText(value).forEach((x)=>{
      const label=inferFeatureCharacteristic(x);
      if(label==="Комплектация"){complectation.push(["Комплектация",x]);return}
      if(label){characteristics.push([label,x]);return}
      advantages.push(["Особенность "+(++advIndex),x]);
    });
  };
  for(const [label,value] of source){
    if(baseSkip.test(label))continue;
    if(/(Преимуществ|Особенност|Характеристики?\s*(?:\/|и)\s*(?:особенност|преимуществ))/i.test(label)){
      distributeFeature(value);
      continue;
    }
    if(/^(Комплектация|Комплект|Состав комплекта|Состав упаковки)$/i.test(label)){complectation.push([label,value]);continue;}
    if(/^(Опции?|Дополнительные опции|Доп\. ?опции|Дополнительная комплектация)$/i.test(label)){options.push([label,value]);continue;}
    if(/^(Варианты?|Исполнение|Размерный ряд|Модификации?)$/i.test(label)){variants.push([label,value]);continue;}
    characteristics.push([label,value]);
  }
  if(!featureSeen&&p.features)distributeFeature(p.features);
  const standard=[
    ["Артикул",article(p)||""],["Тип",p.type],["Назначение",p.purpose],["Производитель",p.manufacturer],["Страна",p.country],
    ["Размер",p.size],["Количество",p.quantity],["Рост",p.height],["Ширина",p.width],["Длина",p.length],["Толщина",p.thickness]
  ].filter((x)=>x[1]).map(r=>[r[0],upperRowStart(r[1])]);
  const chars=uniquePairs([...standard,...characteristics].map(r=>r.map(upperRowStart)));
  const charValues=new Set(chars.map(r=>String(r[1]||"").trim().toLowerCase()));
  return {
    characteristics:chars,
    advantages:uniquePairs(advantages.map(r=>r.map(upperRowStart)).filter(r=>!charValues.has(String(r[1]||"").trim().toLowerCase()))),
    complectation:uniquePairs(complectation.map(r=>r.map(upperRowStart))),
    options:uniquePairs(options.map(r=>r.map(upperRowStart))),
    variants:uniquePairs(variants.map(r=>r.map(upperRowStart)))
  };
}

function normProductName(v){
  return String(v||"").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/gi," ").trim().replace(/\s+/g," ");
}
function applyProductBlock(section,name,pairs,advantages){
  if(!name)return;
  const want=normProductName(name);
  let p=(section.products||[]).find(x=>normProductName(x.name)===want);
  const articlePair=(pairs||[]).find(r=>/^Артикул$/i.test(r?.[0]||""));
  if(!p&&articlePair?.[1])p=(section.products||[]).find(x=>String(x.article||"").trim()===String(articlePair[1]).trim()&&(!want||normProductName(x.name).includes(want)||want.includes(normProductName(x.name))));
  if(!p){
    p={id:section.id+"-"+safeSlug(articlePair?.[1]||name),name,sourceRow:0,sheetFields:[]};
    section.products=section.products||[];section.products.push(p);
  }
  p.sheetFields=uniquePairs([...(p.sheetFields||[]),...(pairs||[])]);
  const val=(label)=>p.sheetFields.find(r=>new RegExp("^"+label+"$","i").test(String(r?.[0]||"")))?.[1]||"";
  p.article=p.article||val("Артикул");
  p.type=p.type||val("Тип");
  p.purpose=p.purpose||val("Назначение");
  p.manufacturer=p.manufacturer||val("Производитель");
  p.country=p.country||val("Страна");
  if((advantages||[]).length)p.advantages=uniquePairs([...(p.advantages||[]),...advantages]);
}
function enrichVerticalProductBlocks(section){
  if(!section||!/^(3)(\.|$)/.test(section.id||""))return;
  const rows=section.rawRows||section.packedRows||[];if(!rows.length)return;
  for(let i=0;i<rows.length;i++){
    const row=rows[i]||[];
    for(let c=0;c<row.length-1;c++){
      if(!/^Наименование$/i.test(String(row[c]||"").trim()))continue;
      const name=String(row[c+1]||"").trim();if(!name)continue;
      const pairs=[["Наименование",name]],advantages=[];let adv=false;
      for(let j=i+1;j<rows.length;j++){
        const r=rows[j]||[],label=String(r[c]||"").trim(),value=String(r[c+1]||"").trim();
        if(/^Наименование$/i.test(label)&&value)break;
        if(label&& !value && !/^Практическое значение$/i.test(label)){
          const next=rows[j+1]||[],nl=String(next[c]||"").trim(),nv=String(next[c+1]||"").trim();
          if(nl&&nv)break;
        }
        if(/^Практическое значение$/i.test(label)&&!value){adv=true;continue}
        if(/^Особенность$/i.test(label)&&/^Практическое значение$/i.test(value)){adv=true;continue}
        if(!label||!value)continue;
        if(/^(Характеристика|Показатель)$/i.test(label)&&/^(Значение|Практическое значение)$/i.test(value))continue;
        if(adv)advantages.push([label,value]);else pairs.push([label,value]);
      }
      // В листе 3.1 у Reventa 1.5 M исторически ошибочно указан тот же артикул, что у Reventa 3 M.
      // Каталожный артикул Reventa 1.5 M — 0202.011; без коррекции обе позиции получают одинаковый id
      // и одна карточка перезаписывает другую в state.products.
      if(section.id==="3.1"&&/^reventa\s*1[.,]5\s*m$/i.test(name)){
        const art=pairs.find(r=>/^Артикул$/i.test(String(r?.[0]||"")));
        if(art)art[1]="0202.011";else pairs.push(["Артикул","0202.011"]);
      }
      if(pairs.length>1||advantages.length)applyProductBlock(section,name,pairs,advantages);
    }
  }
}

function enrichRegularProducts(){
  for(const [id,x] of state.products){
    const p=x.product;
    if(String(id).startsWith("catalog-")||p.manual)continue;
    const z=classifySheetFields(p);
    p.detailFields=z.characteristics.length?z.characteristics:[["Артикул",article(p)||"Не указан"],["Тип",p.type],["Назначение",p.purpose]].filter((r)=>r[1]);
    if(z.advantages.length)p.advantages=z.advantages;
    if(z.complectation.length)p.complectation=z.complectation;
    if(z.options.length)p.options=z.options;
    if(z.variants.length)p.variants=z.variants;
  }
}
function deepCopy(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function mergeOverrideLayer(base,extra){
  const out=deepCopy(base||{version:1,products:{},sections:{},chapters:{}});
  for(const key of ["products","sections","chapters"]){
    out[key] ||= {};
    for(const [id,val] of Object.entries(extra?.[key]||{}))out[key][id]={...(out[key][id]||{}),...deepCopy(val)};
  }
  return out;
}
function localEditorOverrides(published=null){
  try{
    const local=JSON.parse(localStorage.getItem("kb_admin_overrides_local")||"null")||null;
    if(!local)return null;
    const lt=Date.parse(local.updatedAt||"")||0,pt=Date.parse(published?.updatedAt||"")||0;
    return lt>pt?local:null;
  }catch{return null}
}

const PRODUCT_COLOR_SPECS=[
  ["Красный","красн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|красно(?=-)"],
  ["Зелёный","зел[её]н(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|зел[её]но(?=-)"],
  ["Синий","син(?:ий|яя|ее|ие|его|ей|юю|им|ими)|сине(?=-)"],
  ["Жёлтый","ж[её]лт(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|ж[её]лто(?=-)"],
  ["Чёрный","ч[её]рн(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|ч[её]рно(?=-)"],
  ["Белый","бел(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|бело(?=-)"],
  ["Оранжевый","оранжев(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|оранжево(?=-)"],
  ["Фиолетовый","фиолетов(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|фиолетово(?=-)"],
  ["Голубой","голуб(?:ой|ая|ое|ые|ого|ой|ую|ым|ыми)|голубо(?=-)"],
  ["Серый","сер(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|серо(?=-)"],
  ["Розовый","розов(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|розово(?=-)"],
  ["Коричневый","коричнев(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|коричнево(?=-)"],
  ["Бежевый","бежев(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|бежево(?=-)"],
  ["Серебристый","серебрист(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|серебристо(?=-)"],
  ["Золотистый","золотист(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|золотисто(?=-)"],
  ["Бордовый","бордов(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|бордово(?=-)"],
  ["Салатовый","салатов(?:ый|ая|ое|ые|ого|ой|ую|ым|ыми)|салатово(?=-)"]
];
function productColorsInText(v){
  const s=String(v||""),out=[];
  for(const [name,pattern] of PRODUCT_COLOR_SPECS)if(new RegExp(pattern,"giu").test(s))out.push(name);
  return out;
}
function stripProductColorWords(v){
  let s=String(v||"");
  for(const [,pattern] of PRODUCT_COLOR_SPECS)s=s.replace(new RegExp(pattern,"giu"),"");
  s=s.replace(/(?:доступные|варианты)?\s*цвет(?:а|ы|ов)?\s*[:—–-]?\s*/giu,"");
  return s
    .replace(/\s*[—–-]\s*(?=;|,|$)/g,"")
    .replace(/(^|[;,])\s*[—–-]\s*/g,"$1 ")
    .replace(/(^|\s)-(?=\s|,|;|$)/g,"$1")
    .replace(/\s{2,}/g," ")
    .replace(/\s+([,;:.])/g,"$1")
    .replace(/([,;])\s*([,;])+/g,"$1")
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g,"")
    .trim();
}
function normalizeProductColors(p){
  if(!p||typeof p!=="object")return p;
  const bag=[];
  const add=(v)=>{for(const c of productColorsInText(v))if(!bag.includes(c))bag.push(c)};
  add(p.color||"");
  const cleanScalar=(key)=>{
    const v=String(p[key]||"");const found=productColorsInText(v);found.forEach(c=>{if(!bag.includes(c))bag.push(c)});
    if(found.length)p[key]=stripProductColorWords(v);
  };
  for(const key of ["name","article","type","purpose"])cleanScalar(key);
  if(p.features){
    const kept=[];
    for(const raw of String(p.features).split(";")){
      const clause=raw.trim(),found=productColorsInText(clause);
      found.forEach(c=>{if(!bag.includes(c))bag.push(c)});
      if(!found.length){if(clause)kept.push(clause);continue}
      const cleaned=stripProductColorWords(clause);
      if(cleaned&&!/^(доступные|варианты)$/iu.test(cleaned))kept.push(cleaned);
    }
    p.features=kept.join("; ");
  }
  const cleanRows=(rows,key)=>{
    const out=[];
    for(const raw of Array.isArray(rows)?rows:[]){
      const row=Array.isArray(raw)?raw.map(x=>String(x??"")):[String(raw??"")];
      const label=String(row[0]||"").trim();
      row.forEach(add);
      if(/^(?:доступные\s+|варианты\s+)?цвет(?:а|ы|ов)?\b/iu.test(label))continue;
      const cleaned=row.map(stripProductColorWords);
      if(key==="variants"&&cleaned.slice(1).every(x=>!String(x).trim()))continue;
      if(cleaned.some(x=>String(x).trim()))out.push(cleaned);
    }
    return out;
  };
  const pairKeys=["detailFields","advantages","indicators","options","variants","complectation","calibration","assortment","consumables","testKits","workflow","washCycle"];
  for(const key of pairKeys)if(Array.isArray(p[key]))p[key]=cleanRows(p[key],key);
  if(p.tabTables&&typeof p.tabTables==="object"){
    for(const table of Object.values(p.tabTables)){
      if(!table||typeof table!=="object")continue;
      let headers=Array.isArray(table.headers)?table.headers.map(x=>String(x??"")):[];
      let rows=Array.isArray(table.rows)?table.rows.map(r=>Array.isArray(r)?r.map(x=>String(x??"")):[]):[];
      const colorCols=[];
      headers.forEach((h,i)=>{add(h);if(/^(?:доступные\s+|варианты\s+)?цвет(?:а|ы|ов)?\b/iu.test(h.trim()))colorCols.push(i)});
      rows.forEach(r=>r.forEach(add));
      if(colorCols.length){
        const rm=new Set(colorCols);
        headers=headers.filter((_,i)=>!rm.has(i));
        rows=rows.map(r=>r.filter((_,i)=>!rm.has(i)));
        table.merges=[];
      }
      table.headers=headers.map(stripProductColorWords);
      table.rows=cleanRows(rows,"table");
    }
  }
  if(Array.isArray(p.customTabs))p.customTabs=p.customTabs.map(t=>({...t,rows:Array.isArray(t?.rows)?cleanRows(t.rows,"custom"):t?.rows}));
  p.color=bag.join("; ");
  return p;
}

function mapData(){
  state.products.clear();state.sections.clear();state.chapters.clear();state.sectionCatalog.clear();
  state.editorBase={products:new Map(),images:new Map(),sections:new Map(),chapters:new Map()};
  const ov=state.overrides||{};
  state.book.chapters.forEach((ch)=>{
    state.editorBase.chapters.set(ch.id,{title:ch.title});
    if(ov.chapters?.[ch.id]?.title!==undefined)ch.title=String(ov.chapters[ch.id].title||"");
    state.chapters.set(ch.id,ch);
    ch.sections.forEach((s)=>{
      enrichVerticalProductBlocks(s);
      state.editorBase.sections.set(s.id,{title:s.title,notes:deepCopy(s.notes||[]),pairs:deepCopy(s.pairs||[]),tables:deepCopy(s.tables||[])});
      const sov=ov.sections?.[s.id];
      if(sov){for(const [k,v] of Object.entries(sov)){if(!["id","gid","products","rawRows","packedRows"].includes(k))s[k]=deepCopy(v);}}
      if(s.id==="1.2"&&!sov?.title)s.title="Сокращения, обозначения и единицы измерения";
      // Manual marketplace-style products live in the override layer, not in Google Sheets.
      // Therefore a Sheets refresh can replace imported products without deleting hand-created cards.
      const manualProducts=sov?.manualProducts&&typeof sov.manualProducts==="object"&&!Array.isArray(sov.manualProducts)?sov.manualProducts:{};
      for(const [manualId,manualSource] of Object.entries(manualProducts)){
        if(!manualSource||typeof manualSource!=="object")continue;
        const manual={...deepCopy(manualSource),id:manualId,manual:true,sourceSectionId:s.id,sourceGid:s.gid||null};
        s.products=Array.isArray(s.products)?s.products:[];
        s.products.push(manual);
        if(Array.isArray(manual.images)&&manual.images.length)state.assets.productImages[manualId]=deepCopy(manual.images);
      }
      state.sections.set(s.id,{chapter:ch,section:(ch.id==="2"&&s.id==="2.13"?{...s,title:state.overrides?.sections?.["2.13"]?.title||"Тест-пластины KangarooSci"}:s)});
      (s.products||[]).forEach((p)=>state.products.set(p.id,{chapter:ch,section:s,product:p}));
    });
    if(ch.id==="2"){
      state.sections.set("2.6",{chapter:ch,section:{id:"2.6",title:"Анализаторы качества молока",composite:true,...deepCopy(ov.sections?.["2.6"]||{})}});
      state.sections.set("2.7",{chapter:ch,section:{id:"2.7",title:"Анализаторы соматических клеток",composite:true,...deepCopy(ov.sections?.["2.7"]||{})}});
    }
  });
  enrichRegularProducts();
  buildChapter2Catalog();

  // Ручные карточки для составных разделов 2.6 / 2.7.
  // Раньше manualProducts загружались только для реальных листов state.book.sections,
  // поэтому копии, созданные прямо в составном разделе, не появлялись после reload.
  for(const sectionId of ["2.6","2.7"]){
    const composite=state.sections.get(sectionId),manualProducts=ov.sections?.[sectionId]?.manualProducts;
    if(!composite||!manualProducts||typeof manualProducts!=="object"||Array.isArray(manualProducts))continue;
    for(const [manualId,manualSource] of Object.entries(manualProducts)){
      if(!manualSource||typeof manualSource!=="object"||state.products.has(manualId))continue;
      const manual={...deepCopy(manualSource),id:manualId,manual:true,sourceSectionId:sectionId,sourceGid:null};
      const ctxObj={chapter:composite.chapter,section:composite.section,product:manual};
      if(!state.sectionCatalog.has(sectionId))state.sectionCatalog.set(sectionId,[]);
      state.sectionCatalog.get(sectionId).push(ctxObj);
      state.products.set(manualId,ctxObj);
      if(Array.isArray(manual.images)&&manual.images.length)state.assets.productImages[manualId]=deepCopy(manual.images);
    }
  }

  for(const [id,x] of state.products){
    state.editorBase.products.set(id,deepCopy(x.product));
    state.editorBase.images.set(id,deepCopy(state.assets.productImages?.[id]||[]));
    const pov=ov.products?.[id];if(!pov)continue;
    const metaKeys=["id","images","__frozen","appendDetailFields","removeDetailFieldPatterns","pairPatches","tablePatches","removeCustomTabIds"];
    for(const [k,v] of Object.entries(pov)){
      if(metaKeys.includes(k))continue;
      x.product[k]=deepCopy(v);
    }

    const rx=(s)=>{try{return new RegExp(String(s||""),"i")}catch{return null}};
    if(Array.isArray(pov.removeDetailFieldPatterns)&&pov.removeDetailFieldPatterns.length){
      const pats=pov.removeDetailFieldPatterns.map(rx).filter(Boolean);
      x.product.detailFields=(x.product.detailFields||[]).filter(r=>!pats.some(p=>p.test(String(r?.[0]||""))));
    }
    if(Array.isArray(pov.appendDetailFields)&&pov.appendDetailFields.length){
      const rows=Array.isArray(x.product.detailFields)?deepCopy(x.product.detailFields):[];
      for(const pair of pov.appendDetailFields){
        const label=String(pair?.[0]||"").trim(),value=String(pair?.[1]||"").trim();if(!label)continue;
        const idx=rows.findIndex(r=>String(r?.[0]||"").trim().toLowerCase()===label.toLowerCase());
        if(idx>=0)rows[idx]=[label,value];else rows.push([label,value]);
      }
      x.product.detailFields=rows;
    }

    const patchRows=(rows,patch)=>{
      let out=deepCopy(rows||[]);
      const remove=(patch?.removePatterns||[]).map(rx).filter(Boolean);
      if(remove.length)out=out.filter(r=>!remove.some(p=>p.test(String(r?.[0]||""))));
      for(const rr of patch?.rename||[]){
        const re=rx(rr?.match);if(!re)continue;
        out=out.map(r=>re.test(String(r?.[0]||""))?[String(rr?.label||r?.[0]||""),...r.slice(1)]:r);
      }
      for(const rr of patch?.replaceCells||[]){
        const re=rx(rr?.match);if(!re)continue;
        const col=Math.max(0,Number(rr?.col||1));
        out=out.map(r=>{
          if(!re.test(String(r?.[0]||"")))return r;
          const row=[...(r||[])];while(row.length<=col)row.push("");
          row[col]=String(rr?.value??row[col]??"");return row;
        });
      }
      const drop=Math.max(0,Number(patch?.dropLast||0));if(drop)out=out.slice(0,Math.max(0,out.length-drop));
      return out;
    };
    for(const [key,patch] of Object.entries(pov.pairPatches||{})){
      if(Array.isArray(x.product[key]))x.product[key]=patchRows(x.product[key],patch);
    }
    for(const [key,patch] of Object.entries(pov.tablePatches||{})){
      const table=x.product.tabTables?.[key];if(table?.rows)x.product.tabTables[key]={...table,rows:patchRows(table.rows,patch)};
      if(key==="indicators"&&x.product.indicatorTable?.rows)x.product.indicatorTable={...x.product.indicatorTable,rows:patchRows(x.product.indicatorTable.rows,patch)};
    }
    if(Array.isArray(pov.removeCustomTabIds)&&pov.removeCustomTabIds.length){
      const gone=new Set(pov.removeCustomTabIds.map(String));
      x.product.customTabs=(x.product.customTabs||[]).filter(t=>!gone.has(String(t?.id||"")));
      if(x.product.tabTables)for(const tid of gone)delete x.product.tabTables[tid];
      if(Array.isArray(x.product.tabOrder))x.product.tabOrder=x.product.tabOrder.filter(t=>!gone.has(String(t)));
    }
    if(Array.isArray(pov.images))state.assets.productImages[id]=deepCopy(pov.images);
  }

  for(const [,x] of state.products){
    const p=x.product;
    for(const key of ["detailFields","advantages","indicators","options","variants","complectation","workflow","calibration","assortment","consumables","testKits","washCycle"]){
      if(Array.isArray(p?.[key]))p[key]=p[key].map(r=>Array.isArray(r)?r.map(upperRowStart):r);
    }
    if(Array.isArray(p?.customTabs))p.customTabs=p.customTabs.map(t=>({...t,rows:Array.isArray(t?.rows)?t.rows.map(r=>Array.isArray(r)?r.map(upperRowStart):r):t?.rows}));
    if(p?.tabTables)for(const table of Object.values(p.tabTables)){
      if(Array.isArray(table?.headers))table.headers=table.headers.map(upperRowStart);
      if(Array.isArray(table?.rows))table.rows=table.rows.map(r=>Array.isArray(r)?r.map(upperRowStart):r);
    }
  }
}
function buildLiveSearchIndex(){
  const out=[];
  for(const [id,x] of state.products){if(isProductExcluded(x.section.id,id))continue;const p=x.product;out.push({id,section:x.section.id,chapter:x.chapter.id,name:p.name||"",article:p.article||"",text:[p.name,p.article,p.type,p.color,p.purpose,p.features,p.manufacturer,p.country,JSON.stringify(p.detailFields||[]),JSON.stringify(p.advantages||[]),JSON.stringify(p.indicators||[]),JSON.stringify(p.indicatorTable||{}),JSON.stringify(p.tabTables||{}),JSON.stringify(p.substances||[])].filter(Boolean).join(" ")});}
  return out;
}
function installEditorApi(){
  window.KB_EDITOR_API={
    route(){return route()},
    current(){
      const r=route();
      if(r.name==="product"||r.name==="accountProduct"){
        const x=ctx(r.id);if(!x)return {kind:"none"};normalizeProductColors(x.product);
        const sourceId=x.product.sourceSectionId||x.section.id,source=bookSectionById(sourceId)?.section||null;
        return {kind:"product",id:r.id,product:deepCopy(x.product),sourceProduct:deepCopy(state.editorBase.products.get(r.id)||{}),images:deepCopy(state.assets.productImages?.[r.id]||[]),sourceImages:deepCopy(state.editorBase.images.get(r.id)||[]),tabs:productTabs(x.product,{includeHidden:true}),section:{id:x.section.id,title:x.section.title,gid:x.section.gid||null},sourceSection:source?{id:source.id,title:source.title,gid:source.gid||x.product.sourceGid||null}:null,chapter:{id:x.chapter.id,title:x.chapter.title},spreadsheetId:state.book.spreadsheetId};
      }
      if(r.name==="section"||r.name==="accountSection"){
        const x=state.sections.get(r.id);if(!x)return {kind:"none"};
        const base=state.editorBase.sections.get(r.id)||{title:x.section.title},layout=sectionProductLayout(r.id);
        const currentCards=orderedSectionItems(r.id,{includeHidden:true}).map(item=>({id:item.product.id,name:item.product.name||item.product.id,article:article(item.product)||"",hidden:layout.hidden.includes(item.product.id)}));
        const deletedSet=new Set(layout.deleted);
        const deletedProductCards=layout.items.filter(item=>deletedSet.has(item.product.id)).map(item=>({id:item.product.id,name:item.product.name||item.product.id,article:article(item.product)||""}));
        const sourceSection={...deepCopy(base),productOrder:deepCopy(layout.defaultOrder),hiddenProductIds:deepCopy(defaultHiddenProducts(r.id,layout.items)),deletedProductIds:[]};
        const terms11=Array.isArray(state.terms11)?deepCopy(state.terms11):[];
        const sourceTerms11=Array.isArray(state.terms11Base)&&state.terms11Base.length?deepCopy(state.terms11Base):terms11;
        return {kind:"section",id:r.id,section:deepCopy(x.section),sourceSection,terms11,sourceTerms11,productCards:currentCards,deletedProductCards,chapter:{id:x.chapter.id,title:x.chapter.title},spreadsheetId:state.book.spreadsheetId};
      }
      if(r.name==="chapter"){
        const ch=state.chapters.get(r.id);return ch?{kind:"chapter",id:r.id,chapter:deepCopy(ch),sourceChapter:deepCopy(state.editorBase.chapters.get(r.id)||{title:ch.title}),spreadsheetId:state.book.spreadsheetId}:{kind:"none"};
      }
      return {kind:"dashboard",spreadsheetId:state.book.spreadsheetId};
    },
    catalog(){
      return state.book.chapters.map(ch=>{
        const visibleSections=displaySections(ch);
        return {
          id:ch.id,
          title:ch.title,
          sections:visibleSections.map(sec=>{
            const items=orderedSectionItems(sec.id,{includeHidden:true,includeDeleted:false});
            return {id:sec.id,title:sec.title,products:items.map(x=>({id:x.product.id,name:x.product.name||x.product.id,article:article(x.product)||""}))};
          })
        };
      });
    },
    product(id){
      const x=ctx(id);if(!x)return null;normalizeProductColors(x.product);
      const sourceId=x.product.sourceSectionId||x.section.id,source=bookSectionById(sourceId)?.section||null;
      return {kind:"product",id:x.product.id,product:deepCopy(x.product),sourceProduct:deepCopy(state.editorBase.products.get(x.product.id)||{}),images:deepCopy(state.assets.productImages?.[x.product.id]||[]),sourceImages:deepCopy(state.editorBase.images.get(x.product.id)||[]),tabs:productTabs(x.product,{includeHidden:true}),section:{id:x.section.id,title:x.section.title,gid:x.section.gid||null},sourceSection:source?{id:source.id,title:source.title,gid:source.gid||x.product.sourceGid||null}:null,chapter:{id:x.chapter.id,title:x.chapter.title}};
    },
    overrides(){return deepCopy(state.overrides||{})},
    setOverrides(overrides){
      if(!overrides||typeof overrides!=="object"||Array.isArray(overrides))return;
      state.overrides=deepCopy(overrides);
      mapData();
      state.index=buildLiveSearchIndex();
      state.search=makeSearch(state.index);
      renderNav();
      counters();
    },
    setProductOverride(id,override){
      const key=String(id||"");if(!key||!override||typeof override!=="object")return;
      state.overrides ||= {};state.overrides.products ||= {};
      state.overrides.products[key]=deepCopy(override);
      const x=state.products.get(key);
      if(x){
        const meta=new Set(["id","images","__frozen","appendDetailFields","removeDetailFieldPatterns","pairPatches","tablePatches","removeCustomTabIds"]);
        for(const [k,v] of Object.entries(override))if(!meta.has(k))x.product[k]=deepCopy(v);
      }
      if(Array.isArray(override.images)){
        state.assets.productImages ||= {};
        if(override.images.length)state.assets.productImages[key]=deepCopy(override.images);
        else delete state.assets.productImages[key];
      }
      state.index=buildLiveSearchIndex();state.search=makeSearch(state.index);
    },
    setProductImages(id,images){
      const key=String(id||"");if(!key)return;
      const list=Array.isArray(images)?deepCopy(images):[];
      state.assets.productImages ||= {};
      if(list.length)state.assets.productImages[key]=list;else delete state.assets.productImages[key];
      state.overrides ||= {};
      state.overrides.products ||= {};
      state.overrides.products[key] ||= {};
      if(list.length)state.overrides.products[key].images=deepCopy(list);else delete state.overrides.products[key].images;
    },
    liveSnapshots(){return deepCopy(liveSnapshots())},
    async refreshCurrentSection(){
      const r=route();
      if(r.name==="product"){
        const x=ctx(r.id),id=x?.product?.sourceSectionId||x?.section?.id||"";
        if(!id)throw new Error("Для этой карточки не найден исходный лист Google Sheets.");
        return refreshLiveSections([id]);
      }
      if(r.name==="section"){
        const direct=bookSectionById(r.id)?.section;
        if(direct?.gid)return refreshLiveSections([r.id]);
        const ch=state.sections.get(r.id)?.chapter,children=(ch?.sections||[]).filter(s=>s.id.startsWith(r.id+".")&&s.gid).map(s=>s.id);
        if(children.length)return refreshLiveSections(children);
      }
      throw new Error("Сначала открой нужный раздел или карточку товара.");
    }
  };
  window.dispatchEvent(new CustomEvent("kb:ready"));
}
function renderNav(){
  nav.innerHTML=state.book.chapters.map((ch)=>{
    const sections=displaySections(ch);
    return '<div class="nav-chapter" data-chapter="'+esc(ch.id)+'"><button class="nav-chapter-btn" data-nav-chapter="'+esc(ch.id)+'"><span class="nav-num">'+esc(ch.id)+'</span><span>'+esc(ch.title)+'</span><span class="nav-caret">›</span></button><div class="nav-sub">'+sections.map((s)=>'<a class="nav-link" data-nav-section="'+esc(s.id)+'" href="'+href("section",s.id)+'">'+esc(s.id)+' · '+esc(s.title)+'</a>').join("")+'</div></div>';
  }).join("");
}
function activeNav(){
  document.querySelectorAll(".nav-link").forEach((x)=>x.classList.remove("active"));
  document.querySelectorAll(".nav-chapter").forEach((x)=>x.classList.remove("open"));
  const r=route();let sid="",cid="";
  if(r.name==="section"){sid=r.id;cid=state.sections.get(sid)?.chapter.id||"";}
  if(r.name==="product"){const x=ctx(r.id);sid=x?.section.id||"";cid=x?.chapter.id||"";}
  if(r.name==="chapter")cid=r.id;
  if(cid)document.querySelector('.nav-chapter[data-chapter="'+CSS.escape(cid)+'"]')?.classList.add("open");
  if(sid)document.querySelector('.nav-link[data-nav-section="'+CSS.escape(sid)+'"]')?.classList.add("active");
}
function imageSrc(v){const s=String(v||"");return /^https?:\/\//i.test(s)||s.startsWith("data:")||s.startsWith("./")?s:"./"+s;}
function imageView(p,path,context="card"){
  const raw=p?.imageSettings?.[path]||{},legacy=raw&&("scale" in raw||"x" in raw||"y" in raw||"fit" in raw)?raw:null;
  const v=raw?.[context]||legacy||{},num=(x,d,min,max)=>{const n=Number(x);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):d};
  return {scale:num(v.scale,1,.6,4),x:num(v.x,0,-60,60),y:num(v.y,0,-60,60),fit:v.fit==="cover"?"cover":"contain"};
}
function imageViewStyle(p,path,context="card"){
  const v=imageView(p,path,context);
  return "object-fit:"+v.fit+" !important;transform:translate("+v.x+"%,"+v.y+"%) scale("+v.scale+") !important;";
}
function garantCardColor(name){
  const n=String(name||"").toUpperCase();
  const map=[
    ["ALBENDAZOLE","#11A9B8"],
    ["SULFA","#E60012"],
    ["AVERMECTINS","#30318C"],
    ["DIO","#D88B89"],
    ["BTSC PLUS","#B8CB91"],
    ["BTSC CEFTIOFUR","#8B8179"],
    ["MACROLIDES TULATHROMYCIN","#7F95AF"],
    ["ULTRA","#F28A00"],
    ["QMLE","#079447"],
    ["AMINO ULTRA","#A89488"],
    ["AMINOSPEC","#C58AA5"],
    ["AMINO","#A94283"],
    ["KFMD","#D6B55E"],
    ["BACSF","#3D8D7E"],
    ["LQMES","#666380"],
    ["FTMCS","#7E70B3"],
    ["NATAMYCIN","#138FC4"],
    ["MONENSIN","#4A4A4A"],
    ["NOVOBIOCIN","#F4D000"],
    ["METRONIDAZOLE","#73536C"],
    ["FTSP","#B88A63"]
  ];
  return map.find(([k])=>n.includes(k))?.[1]||"#2F7D5A";
}
function card(x,index=0){
  const p=normalizeProductColors(x.product), images=state.assets.productImages?.[p.id]||[], im=images[0]||"", a=article(p);
  const priority=index<6,load=priority?"eager":"lazy",fetchPriority=priority?' fetchpriority="high"':"";
  const isGarant=x.section?.id==="2.1.3";
  const garantColor=isGarant?garantCardColor(p.name):"";
  const garantStyle=isGarant?' style="--garant-card-color:'+garantColor+'"':"";
  const garantClass=isGarant?" garant-card":"";
  return '<article class="product-card'+garantClass+'"'+garantStyle+'><div class="product-image '+(im?"":"placeholder")+'" '+(im?'data-open-product="'+esc(p.id)+'"':"")+'>'+(im?'<img src="'+esc(imageSrc(im))+'" loading="'+load+'" decoding="async"'+fetchPriority+' alt="'+esc(p.name)+'" style="'+esc(imageViewStyle(p,im,"card"))+'">':"")+(images.length>1?'<span class="photo-count">◫ '+images.length+'</span>':"")+'</div><div class="product-body"><div class="product-meta">'+(a?'<span class="badge article">Арт. '+esc(a)+'</span>':"")+(isGarant?'<span class="garant-color-dot" aria-hidden="true"></span>':"")+(p.type?'<span class="badge">'+esc(p.type)+'</span>':"")+(p.color?'<span class="badge">Цвет: '+esc(p.color)+'</span>':"")+'</div><h3>'+esc(p.name)+'</h3>'+(p.purpose?'<p>'+esc(p.purpose)+'</p>':"")+'<div class="product-actions"><button class="btn primary" data-open-product="'+esc(p.id)+'">Подробнее</button><button class="btn icon '+(favorites.has(p.id)?"active":"")+'" data-fav="'+esc(p.id)+'" aria-label="Избранное">★</button></div></div></article>';
}
function grouped(items){
  let last="",out="";
  items.forEach((x)=>{const g=x.product.group||"";if(g&&g!==last){out+='<h3 class="group-title">'+esc(g)+'</h3>';last=g;}out+=card(x);});
  return out;
}
const IMAGE_LABELS={
  "02-dipsensor":"Dipsensor",
  "02-ekspress-test-4sensor-sensitive":"4Sensor Sensitive",
  "02-ekspress-test-4sensor":"4Sensor",
  "02-ekspress-test-ankar-milk-test":"ANKAR Milk Test",
  "02-ekspress-test-garant-4-utra-milk":"GARANT 4 Ultra Milk",
  "02-test-sistemy-delvotest-sp-nt":"Delvotest SP-NT",
  "02-test-sistemy-delvotest-t":"Delvotest T",
  "03-aflasensor":"Aflasensor",
  "03-aminosensor":"Aminosensor",
  "03-cowsensor":"Cowsensor",
  "03-milksensor-ltse":"Milksensor LTSE",
  "03-quinosensor":"Quinosensor",
  "03-sulfasensor":"Sulfasensor",
  "03-tylosensor":"Tylosensor",
  "03-garant":"GARANT",
  "05-sistema-extenso":"Система EXTENSO",
  "12-ankar-100":"ANKAR 100",
  "12-delvotest":"Инкубатор Delvotest",
  "12-heatsensor-duo":"HeatSensor DUO",
  "12-heatsensor-hs-00647":"HeatSensor HS-00647",
  "12-heatsensor-octo":"HeatSensor OCTO",
  "12-tias":"Считывающее устройство TIAS",
  "08-ekomilk-120-6-parametrov":"Ekomilk 120 — 6 параметров",
  "08-ekomilk-120-9-parametrov":"Ekomilk 120 — 9 параметров",
  "08-ekomilk-total-bez-printera":"Ekomilk TOTAL — без принтера",
  "08-ekomilk-total-s-printerom":"Ekomilk TOTAL — с принтером",
  "08-ekomilk-horizon":"Ekomilk HORIZON",
  "09-ekomilk-horizon":"Ekomilk HORIZON",
  "08-tias-agro":"TIAS AGRO",
  "08-tias-agro-plus":"TIAS AGRO PLUS",
  "08-tias-full-check-plus":"TIAS FULLCHECK PLUS",
  "08-tias-full-check":"TIAS FULLCHECK",
  "09-ekomilk-scan":"Ekomilk SCAN",
  "09-tias-somcell":"TIAS SomCell",
  "06-test-plastiny-kangaroosci":"Тест-пластины KangarooSci",
  "07-turbidofluorimetr-biotf":"Турбидофлуориметр БиоТФ",
  "10-lyuminometr":"Люминометр"
};
function visualTitle(path){
  const base=String(path||"").split("/").pop().replace(/\.[^.]+$/,"");
  if(IMAGE_LABELS[base])return IMAGE_LABELS[base];
  return base.replace(/^\d+-/,"").replace(/-/g," ").replace(/\b\w/g,(m)=>m.toUpperCase());
}
function visualCatalog(s,images){
  if(!images?.length)return "";
  return '<section class="visual-catalog"><div class="section-heading compact"><div><span class="eyebrow">Позиции раздела</span><h2>Товары и оборудование</h2></div><p>'+images.length+' фото</p></div><div class="visual-grid">'+images.map((im)=>'<article class="visual-card"><button class="visual-image" type="button" data-lightbox-src="'+esc(imageSrc(im))+'"><img src="'+esc(imageSrc(im))+'" loading="lazy" alt="'+esc(visualTitle(im))+'"></button><div class="visual-body"><span class="visual-kicker">'+esc(s.id)+'</span><h3>'+esc(visualTitle(im))+'</h3><p>Фото относится к этой конкретной позиции. Характеристики и справочные данные собраны ниже.</p></div></article>').join("")+'</div></section>';
}
function knowledgeCards(s){
  let out="";
  if(s.pairs?.length){
    out+='<section class="knowledge-section"><div class="section-heading compact"><div><span class="eyebrow">Ключевая информация</span><h2>Характеристики и сведения</h2></div><p>'+s.pairs.length+' пунктов</p></div><div class="knowledge-grid">'+s.pairs.map((x)=>'<article class="knowledge-card"><span>'+esc(x.label)+'</span><p>'+esc(x.value)+'</p></article>').join("")+'</div></section>';
  }
  return out;
}
function rawTables(){return "";}
function safeRichHtml(html){
  let out=String(html||"");
  out=out.replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,"");
  out=out.replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta)[^>]*\/?>/gi,"");
  out=out.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi,"");
  out=out.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi,"");
  return out;
}
function contentBlockHtml(b,i){
  const type=b?.type||"text";
  if(type==="heading")return '<section class="content-block content-heading"><h2>'+esc(b.html||b.text||"")+'</h2></section>';
  if(type==="quote")return '<section class="content-block content-quote"><blockquote>'+safeRichHtml(b.html||"")+'</blockquote></section>';
  if(type==="list"){
    const items=Array.isArray(b.items)?b.items:[];
    return '<section class="content-block content-list"><ul>'+items.map(x=>'<li>'+safeRichHtml(x)+'</li>').join("")+'</ul></section>';
  }
  if(type==="table"){
    const h=Array.isArray(b.headers)?b.headers:[],rows=Array.isArray(b.rows)?b.rows:[];
    if(!h.length)return "";
    const hints=tableColumnHints(h,rows);
    return '<section class="content-block content-table"><div class="content-table-wrap"><table>'+tableColgroup(h,rows)+'<thead><tr>'+h.map((x,i)=>'<th class="'+hints[i].className+'">'+esc(x)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+h.map((_,j)=>'<td class="'+hints[j].className+'">'+esc(r?.[j]||"")+'</td>').join("")+'</tr>').join("")+'</tbody></table></div></section>';
  }
  if(type==="image"){
    const src=String(b.src||"");if(!src)return "";
    const width=Math.min(100,Math.max(20,Number(b.width)||100)),align=b.align==="left"||b.align==="right"?b.align:"center";
    const imageSrc=/^(https?:|data:|\.\/)/i.test(src)?src:"./"+src;
    return '<figure class="content-block content-image align-'+align+'" style="--content-image-width:'+width+'%"><img src="'+esc(imageSrc)+'" alt="'+esc(b.alt||"")+'">'+(b.caption?'<figcaption>'+esc(b.caption)+'</figcaption>':"")+'</figure>';
  }
  return '<section class="content-block content-text">'+safeRichHtml(b.html||"")+'</section>';
}
function sectionContent(s){
  if(Array.isArray(s.contentBlocks)&&s.contentBlocks.length){
    return '<section class="section-content-builder">'+s.contentBlocks.map(contentBlockHtml).join("")+'</section>';
  }
  return knowledgeCards(s);
}

function renderHome(){
  title("");
  const recentItems=recent.get().map(ctx).filter(x=>x&&!isProductExcluded(x.section.id,x.product.id)).slice(0,6);
  const photoProducts=Object.keys(state.assets.productImages||{}).length;
  app.innerHTML='<section class="hero"><div class="hero-copy"><span class="eyebrow">TIAN-Трейд · внутренняя база знаний</span><h1>Вся продуктовая экспертиза — в одной системе</h1><p>Поиск по ассортименту, артикулам, назначению и характеристикам. Данные автоматически собираются из рабочей Книги знаний.</p><div class="hero-actions"><button class="btn hero-btn" data-focus-search>⌕ Найти товар</button><button class="btn hero-btn secondary" data-route="favorites">★ Избранное</button></div><div class="hero-meta"><span class="hero-chip">'+state.book.chapters.length+' глав</span><span class="hero-chip">'+state.sections.size+' подразделов</span><span class="hero-chip">'+state.products.size+' карточек</span><span class="hero-chip">Обновлено '+fmtDate(state.book.generatedAt)+'</span></div></div></section><section class="stats"><div class="stat"><strong>'+state.book.chapters.length+'</strong><span>глав</span></div><div class="stat"><strong>'+state.sections.size+'</strong><span>подразделов</span></div><div class="stat"><strong>'+state.products.size+'</strong><span>структурированных карточек</span></div><div class="stat"><strong>'+photoProducts+'</strong><span>товаров с индивидуальными фото</span></div></section><section class="home-tools"><button type="button" class="home-tool" data-focus-search><span>⌕</span><strong>Глобальный поиск</strong><small>Название, артикул, назначение</small></button>'+(isAdmin()?'<button type="button" class="home-tool" data-route="diagnostics"><span>✓</span><strong>Диагностика данных</strong><small>Фото, дубликаты и качество базы</small></button>':'')+'</section><div class="section-heading"><div><span class="eyebrow">Навигация</span><h2>Разделы Книги знаний</h2></div></div><section class="chapter-grid">'+state.book.chapters.map((ch)=>'<article class="chapter-card" data-num="'+esc(ch.id)+'" data-open-chapter="'+esc(ch.id)+'"><span class="chapter-num">'+esc(ch.id)+'</span><span class="chapter-arrow">↗</span><h3>'+esc(ch.title)+'</h3><p>'+ch.sections.length+' подразделов</p></article>').join("")+'</section>'+(recentItems.length?'<div class="section-heading"><div><span class="eyebrow">История</span><h2>Недавно просмотренные</h2></div></div><section class="recent-grid">'+recentItems.map(card).join("")+'</section>':"");
}
function renderImportant(title,items,foot=""){
  return '<section class="important-panel"><div class="important-icon">!</div><div><h2>'+esc(title)+'</h2><ul>'+items.map((x)=>'<li><strong>'+esc(x[0])+'</strong> '+esc(x[1])+'</li>').join("")+'</ul>'+(foot?'<p class="important-foot">'+esc(foot)+'</p>':"")+'</div></section>';
}
function foundationInlineText(text){
  let s=esc(String(text||"").trim());
  s=s.replace(/\b(Важно|То есть|Например|Примеры|Обратите внимание)\s*[—–:-]?/gi,'<span class="foundation-note-label">$1</span> ');
  s=s.replace(/\b(ОТМЕНЕНО|ВСЕГДА|ОБЯЗАТЕЛЬНО|НЕ ПУТАТЬ|НЕВОЗМОЖНО)\b/gi,'<mark class="foundation-key foundation-key-alert">$1</mark>');
  s=s.replace(/\b(предел чувствительности|арбитражный метод|количественный метод|качественный метод|валидация|верификация|ВЭЖХ|ИФА|ИХА|ВЛС|СИ|ИО)\b/gi,'<mark class="foundation-key">$1</mark>');
  s=s.replace(/«([^»]{2,90})»/g,'<span class="foundation-quoted">«$1»</span>');
  return s;
}
function foundationBodyHtml(body){
  return (body||[]).filter(Boolean).map((p,i)=>'<p class="'+(i===0?"foundation-lead":"foundation-paragraph")+'">'+foundationInlineText(p)+'</p>').join("");
}
function renderTermsSection(ch,s){
  const fallback=(s.pairs||[]).map((x,i)=>({number:i+1,title:String(x.label||"").trim(),definition:String(x.value||"").trim(),body:[],resources:[],related:[]}));
  const terms=(Array.isArray(state.terms11)&&state.terms11.length?state.terms11:fallback).filter(x=>x&&x.title);
  const termByNumber=new Map(terms.map(x=>[Number(x.number),x]));
  const groups=[
    {id:"normative",number:"01",title:"Нормативная база и подтверждение соответствия",range:"01—08",from:1,to:8,desc:"Разбираем, какие документы подтверждают соответствие продукции и как читать их статус и назначение."},
    {id:"metrology",number:"02",title:"Оборудование и метрология",range:"09—12",from:9,to:12,desc:"Различаем испытательное оборудование и средства измерений, аттестацию и поверку."},
    {id:"methods",number:"03",title:"Методы исследования",range:"13—20",from:13,to:20,desc:"Разбираем количественные и качественные методы, чувствительность и арбитражные исследования."},
    {id:"quality",number:"04",title:"Валидация и внедрение",range:"21—22",from:21,to:22,desc:"Отделяем пригодность самой методики от её корректного внедрения в конкретной лаборатории."},
    {id:"organizations",number:"05",title:"Научно-исследовательские организации",range:"23—28",from:23,to:28,desc:"ВНИМИ, ВНИИМС, ВНИИМП, ВГНКИ, ILVO и AFNOR."}
  ];
  const resourceHref=(href)=>{
    const v=String(href||"").trim();
    if(!v)return "";
    if(/^https?:\/\//i.test(v))return v;
    return "./"+v.split("/").map(encodeURIComponent).join("/");
  };
  const isPdf=(r)=>/\.pdf(?:$|[?#])/i.test(String(r?.href||""));
  const resourceHtml=(r)=>{
    const href=resourceHref(r?.href);
    if(!href)return "";
    const label=String(r?.label||r?.href||"Документ").trim();
    const external=/^https?:\/\//i.test(String(r.href||""));
    if(isPdf(r)){
      return '<button type="button" class="foundation-doc" data-doc-preview data-doc-href="'+esc(href)+'" data-doc-label="'+esc(label)+'"><span class="foundation-doc-type">PDF</span><span class="foundation-doc-name">'+esc(label)+'</span><span class="foundation-doc-action">Предпросмотр&nbsp;↗</span></button>';
    }
    return '<a class="foundation-link" href="'+esc(href)+'"'+(external?' target="_blank" rel="noopener"':"")+'><span>'+esc(label)+'</span><span>↗</span></a>';
  };
  const relatedHtml=(r)=>{
    const target=termByNumber.get(Number(r?.term));
    return target?'<button type="button" class="foundation-related" data-term-target="'+esc(String(r.term))+'"><span>→</span>'+esc(r.label||target.title)+'</button>':"";
  };
  const itemHtml=(t)=>{
    const definition=String(t.definition||t.summary||(t.body||[])[0]||"").trim();
    const detailBody=foundationBodyHtml(t.body||[]);
    const resources=(t.resources||[]).map(resourceHtml).filter(Boolean).join("");
    const related=(t.related||[]).map(relatedHtml).filter(Boolean).join("");
    const docsBlock=resources?'<section class="foundation-assets"><div class="foundation-assets-head"><span>Нормативные материалы</span></div><div class="foundation-resource-list">'+resources+'</div></section>':"";
    const relatedBlock=related?'<section class="foundation-assets foundation-related-assets"><div class="foundation-assets-head"><span>Связанные термины</span></div><div class="foundation-related-list">'+related+'</div></section>':"";
    const detailBlocks=(detailBody||docsBlock||relatedBlock)
      ?'<div class="foundation-detail-grid">'+(detailBody?'<section class="foundation-detail-copy">'+detailBody+'</section>':"")+(docsBlock||"")+(relatedBlock||"")+'</div>'
      :"";
    const details=detailBlocks?'<details class="foundation-details"><summary>Подробнее</summary>'+detailBlocks+'</details>':"";
    const pending=isAdmin()&&(t.pendingResources||[]).length?'<div class="foundation-pending"><span>Ожидают добавления</span>'+esc((t.pendingResources||[]).join(" · "))+'</div>':"";
    const titleRow='<div class="foundation-title-row"><div class="foundation-title-copy"><span class="foundation-kicker">ТЕРМИН</span><h3>'+esc(t.title)+'</h3></div></div>';
    const search=[t.title,definition,...(t.body||[]),(t.resources||[]).map(r=>r.label),(t.related||[]).map(r=>r.label)].flat().filter(Boolean).join(" ").toLowerCase();
    return '<article class="foundation-term" data-term-item data-term-number="'+esc(String(t.number))+'" data-term-search="'+esc(search)+'"><div class="foundation-term-rail"><span class="foundation-term-no">'+String(t.number).padStart(2,"0")+'</span><span class="foundation-term-kind">ТЕРМИН</span></div><div class="foundation-term-content"><div class="foundation-term-heading">'+titleRow+'<span class="foundation-term-mark">§</span></div><div class="foundation-summary"><p class="foundation-definition">'+foundationInlineText(definition)+'</p></div>'+details+pending+'</div></article>';
  };
  const groupHtml=groups.map(g=>{
    const groupTerms=terms.filter(t=>Number(t.number)>=g.from&&Number(t.number)<=g.to);
    return '<section class="foundation-group" id="foundation-'+esc(g.id)+'" data-foundation-group="'+esc(g.id)+'"><div class="foundation-group-head"><div><span class="foundation-group-index">'+esc(g.number)+' / '+esc(g.range)+'</span><h2>'+esc(g.title)+'</h2><p>'+esc(g.desc)+'</p></div><span class="foundation-group-count">'+groupTerms.length+' терм.</span></div><div class="foundation-list">'+groupTerms.map(itemHtml).join("")+'</div></section>';
  }).join("");
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title}])+
    '<div class="foundation-head"><div class="foundation-intro"><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>Термины и определения</h1><p>Сначала — короткое рабочее определение. Если нужно разобраться глубже, откройте «Подробнее»: там собран смысловой контекст, нормативные материалы и связанные термины.</p></div></div>'+
    '<section class="foundation-browser"><div class="foundation-toolbar"><div class="foundation-search"><span>⌕</span><input id="terms11Search" type="search" placeholder="Найти термин, определение или обозначение…" autocomplete="off"><button type="button" id="terms11SearchClear" hidden>×</button></div><div class="foundation-filters" role="group" aria-label="Фильтр терминов"><button type="button" class="foundation-filter active" data-foundation-filter="all">Все</button><button type="button" class="foundation-filter" data-foundation-filter="docs">С документами</button><button type="button" class="foundation-filter" data-foundation-filter="related">Со связями</button></div></div><div class="foundation-overview"><div class="foundation-jumps">'+groups.map(g=>'<button type="button" data-foundation-jump="'+esc(g.id)+'"><span>'+esc(g.number)+'</span>'+esc(g.title)+'</button>').join("")+'</div></div><div class="foundation-groups">'+groupHtml+'</div><div class="foundation-no-results" id="terms11NoResults" hidden><strong>Ничего не найдено</strong><span>Измените запрос или снимите фильтр.</span></div></section>';
  const items=[...document.querySelectorAll("[data-term-item]")];
  const input=q("#terms11Search"),clear=q("#terms11SearchClear"),empty=q("#terms11NoResults");
  const filterBtns=[...document.querySelectorAll("[data-foundation-filter]")];
  let activeFilter="all";
  const apply=()=>{
    const query=(input?.value||"").trim().toLowerCase();
    if(clear)clear.hidden=!query;
    let shown=0;
    items.forEach(item=>{
      const hasDocs=!!item.querySelector(".foundation-resource-list");
      const hasRelated=!!item.querySelector(".foundation-related-assets");
      const filterOk=activeFilter==="all"||(activeFilter==="docs"&&hasDocs)||(activeFilter==="related"&&hasRelated);
      const textOk=!query||String(item.dataset.termSearch||"").includes(query);
      const ok=filterOk&&textOk;
      item.hidden=!ok;
      if(ok)shown++;
    });
    document.querySelectorAll("[data-foundation-group]").forEach(group=>{
      const visible=group.querySelectorAll("[data-term-item]:not([hidden])").length;
      group.hidden=visible===0;
    });
    if(empty)empty.hidden=shown>0;
  };
  input?.addEventListener("input",apply);
  clear?.addEventListener("click",()=>{if(input){input.value="";input.focus();}apply();});
  filterBtns.forEach(btn=>btn.addEventListener("click",()=>{
    activeFilter=btn.dataset.foundationFilter||"all";
    filterBtns.forEach(x=>x.classList.toggle("active",x===btn));
    apply();
  }));
  const scrollFoundationTo=(target)=>{
    if(!target)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const toolbar=q(".foundation-toolbar");
      const offset=(toolbar?.getBoundingClientRect().bottom||90)+18;
      const y=target.getBoundingClientRect().top+window.scrollY-offset;
      window.scrollTo({top:Math.max(0,y),behavior:"smooth"});
    }));
  };
  document.querySelectorAll("[data-foundation-jump]").forEach(btn=>btn.addEventListener("click",()=>{
    const target=q("#foundation-"+CSS.escape(btn.dataset.foundationJump||""));
    scrollFoundationTo(target);
  }));
  document.querySelectorAll("[data-term-target]").forEach(btn=>btn.addEventListener("click",()=>{
    const termNumber=btn.dataset.termTarget||"";
    if(input){input.value="";input.blur();}
    activeFilter="all";
    filterBtns.forEach(x=>x.classList.toggle("active",x.dataset.foundationFilter==="all"));
    apply();
    const target=document.querySelector('[data-term-number="'+CSS.escape(termNumber)+'"]');
    if(!target)return;
    const group=target.closest("[data-foundation-group]");
    if(group)group.hidden=false;
    scrollFoundationTo(target);
    target.classList.add("term-focus");
    setTimeout(()=>target.classList.remove("term-focus"),1100);
  }));
}
function renderNormsSection(ch,s){
  const sectionTitle="Сокращения, обозначения и единицы измерения";
  const rows=(s.rawRows||s.rows||[]);
  const units=[],reading=[],steps=[];
  let mode="";
  const sectionHeads={
    "1. Нормативные документы":"docs",
    "2. Обозначения и единицы измерения":"units",
    "3. Как читать показатели и таблицы":"reading",
    "Порядок подбора товара":"steps"
  };
  const skipHeads=new Set(["Документ","Обозначение","Показатель / обозначение","Шаг"]);
  for(const r of rows){
    const a=String(r?.[0]||"").trim();
    if(!a)continue;
    if(sectionHeads[a]){mode=sectionHeads[a];continue}
    if(/^Важно:/i.test(a))continue;
    if(skipHeads.has(a))continue;
    if(mode==="units")units.push(r);
    else if(mode==="reading")reading.push(r);
    else if(mode==="steps")steps.push(r);
  }

  const norm=(v)=>String(v||"").toLowerCase()
    .replace(/ё/g,"е")
    .replace(/≤/g," less-or-equal ")
    .replace(/≥/g," greater-or-equal ")
    .replace(/</g," less ")
    .replace(/>/g," greater ")
    .replace(/[^a-zа-я0-9]+/gi," ")
    .trim()
    .replace(/\s+/g," ");
  const topicDefs=[
    {id:"micro",label:"Микробиология",where:"микробиология, лабораторный контроль, посевы и тест-пластины",rx:/(кое|омч|микроб|инкубац|посев|тест[- ]?пласт|биотф|питательн|колони)/i,prefixes:["2.13","2.14","2.15"]},
    {id:"analyzers",label:"Анализаторы",where:"анализаторы качества молока, измерительные приборы",rx:/(сомо|scc|анализатор|диапазон измерения|погрешн|опци|комплектац|измеряем|показател)/i,prefixes:["2.6.","2.7.","2.15"]},
    {id:"strips",label:"Индикаторные полоски",where:"индикаторные полоски, экспресс-контроль, растворы",rx:/(полос|индикатор|нку|час|остаточн|мг\/л)/i,prefixes:["2.10"]},
    {id:"methods",label:"Методы",where:"лабораторные методы, тест-системы, пробоподготовка",rx:/(предел обнаружения|диапазон чувствительност|время анализа|пробоподготовк|температура инкубац|время инкубац|сравнительн|группа антибиотик|метод)/i,prefixes:["2.1.1","2.1.2","2.1.3","2.1.4","2.13","2.15"]},
    {id:"measure",label:"Измерения",where:"измерения, характеристики приборов и таблицы чувствительности",rx:/(ppb|мкг\/кг|мг\/л|rlu|ph|диапазон измерения|погрешн|<|>|не более|не менее|измерен)/i,prefixes:["2.6.","2.7.","2.10","2.15"]},
    {id:"disinfection",label:"Дезинфекция",where:"мойка, дезинфекция, контроль рабочих растворов",rx:/(нку|час|cip|дезинфек|мойк|мг\/л)/i,prefixes:["2.10","8.3","9.3"]},
    {id:"milk",label:"Молоко",where:"молоко и молочная продукция",rx:/(молок|сомо|scc|ph|кое\/мл|ppb|антибиотик)/i,prefixes:["2.1.1","2.1.2","2.1.3","2.1.4","2.6.","2.7."]},
    {id:"express",label:"Экспресс-тесты",where:"экспресс-тесты и быстрый контроль",rx:/(ppb|предел обнаружения|полос|тест|время анализа|пробоподготовк|чувствительност)/i,prefixes:["2.1.1","2.1.2","2.1.3","2.1.4","2.10","2.11","4.9"]},
    {id:"selection",label:"Подбор товара",where:"подбор товара и сравнение характеристик",rx:/(диапазон|погрешн|предел|чувствительност|время|пробоподготовк|комплектац|опци|показател)/i,prefixes:["2.1.1","2.1.2","2.1.3","2.1.4","2.6.","2.7.","2.10","2.15"]}
  ];
  const topicById=new Map(topicDefs.map(x=>[x.id,x]));
  const records=[];
  const customNorms=Array.isArray(s.norms12Records)?s.norms12Records:null;
  const findRecord=(label)=>{
    const key=norm(label);
    return records.find(x=>x.aliases.some(a=>a===key))||null;
  };
  if(customNorms){
    for(const r of customNorms){
      const label=String(r?.label||"").trim();if(!label)continue;
      records.push({
        label,
        meaning:String(r?.meaning||"").trim(),
        definition:String(r?.definition||"").trim(),
        whereSource:String(r?.whereSource||"").trim(),
        example:String(r?.example||"").trim(),
        important:String(r?.important||"").trim(),
        detailsText:Array.isArray(r?.detailsText)?r.detailsText.map(x=>String(x||"")):[],
        aliases:[String(r?.label||"").trim().toLowerCase()],
        type:String(r?.type||"concept")
      });
    }
  }else{
  for(const r of units){
    const label=String(r?.[0]||"").trim(),meaning=String(r?.[1]||"").trim(),where=String(r?.[2]||"").trim();
    if(!label)continue;
    const aliases=[norm(label)];
    if(/[,/]/.test(label))label.split(/,\s*/).map(norm).filter(Boolean).forEach(x=>aliases.push(x));
    records.push({label,meaning,definition:meaning,whereSource:where,example:"",important:"",aliases:[...new Set(aliases)],type:"abbreviation"});
  }
  for(const r of reading){
    const label=String(r?.[0]||"").trim();
    let definition=String(r?.[1]||"").trim();
    const example=String(r?.[2]||"").trim(),important=String(r?.[3]||"").trim();
    if(label==="<"&&/выше указанного уровня/i.test(definition))definition="Значение менее указанного уровня";
    if(!label)continue;
    const existing=findRecord(label);
    if(existing){
      if(definition)existing.definition=definition;
      if(example)existing.example=example;
      if(important)existing.important=important;
      continue;
    }
    records.push({label,meaning:"",definition,whereSource:"",example,important,aliases:[norm(label)],type:"concept"});
  }
  for(const t of (s.glossaryTerms||[])){
    const label=String(t?.label||"").trim();if(!label)continue;
    const aliases=[norm(label),...(Array.isArray(t.aliases)?t.aliases.map(norm):[])].filter(Boolean);
    records.push({
      label,
      meaning:"",
      definition:String(t?.summary||"").trim(),
      whereSource:String(t?.where||"").trim(),
      example:"",
      important:"",
      detailsText:Array.isArray(t?.details)?t.details.map(x=>String(x||"").trim()).filter(Boolean):[],
      aliases:[...new Set(aliases)],
      type:String(t?.type||"concept")
    });
  }
  }
  const uniqueProducts=(arr)=>{
    const seen=new Set(),out=[];
    for(const x of arr){
      if(!x||seen.has(x.product.id)||isProductExcluded(x.section.id,x.product.id))continue;
      seen.add(x.product.id);out.push(x);
      if(out.length>=4)break;
    }
    return out;
  };
  const products=[...state.products.values()];
  const buildRecord=(r)=>{
    const hay=[r.label,r.meaning,r.definition,r.whereSource,r.example,r.important,...(r.detailsText||[])].filter(Boolean).join(" ");
    const topics=topicDefs.filter(t=>t.rx.test(hay)).map(t=>t.id);
    if(!topics.length)topics.push("selection");
    const topicObjects=topics.map(id=>topicById.get(id)).filter(Boolean);
    const where=[r.whereSource,...topicObjects.map(t=>t.where)].filter(Boolean).join(" · ");
    const searchTerms=[r.label,r.meaning,r.definition,r.whereSource,r.example,r.important,...(r.detailsText||[]),...topicObjects.map(t=>t.label)].filter(Boolean);
    const exact=[];
    const normalizedNeedles=[r.label,r.meaning].filter(x=>norm(x).length>=3).map(norm);
    for(const x of products){
      const hayProduct=norm(JSON.stringify(x.product));
      if(normalizedNeedles.some(n=>hayProduct.includes(n)))exact.push(x);
    }
    const topicCandidates=[];
    for(const t of topicObjects){
      for(const x of products){
        if(t.prefixes.some(prefix=>x.section.id===prefix||x.section.id.startsWith(prefix)))topicCandidates.push(x);
      }
    }
    const related=uniqueProducts([...exact,...topicCandidates]);
    return {...r,topics,topicLabels:topicObjects.map(t=>t.label),where:[...new Set(where.split(" · ").map(x=>x.trim()).filter(Boolean))].slice(0,4),products:related,search:searchTerms.concat(related.map(x=>x.product.name)).join(" ").toLowerCase()};
  };
  const terms=records.map(buildRecord);
  const topicCounts=new Map(topicDefs.map(t=>[t.id,0]));
  terms.forEach(t=>t.topics.forEach(id=>topicCounts.set(id,(topicCounts.get(id)||0)+1)));
  const topicButtons='<button type="button" class="glossary-topic active" data-glossary-topic="all">Все <b>'+terms.length+'</b></button>'+topicDefs.filter(t=>(topicCounts.get(t.id)||0)>0).map(t=>'<button type="button" class="glossary-topic" data-glossary-topic="'+esc(t.id)+'">'+esc(t.label)+' <b>'+topicCounts.get(t.id)+'</b></button>').join("");
  const itemHtml=(r,i)=>{
    const chips=r.topicLabels.slice(0,3).map(label=>'<button type="button" class="glossary-chip" data-glossary-topic="'+esc(topicDefs.find(t=>t.label===label)?.id||"all")+'">'+esc(label)+'</button>').join("");
    const productsHtml=r.products.length?r.products.map(x=>'<button type="button" class="glossary-product-link" data-open-product="'+esc(x.product.id)+'"><strong>'+esc(x.product.name)+'</strong>'+(article(x.product)?'<span>Арт. '+esc(article(x.product))+'</span>':"")+'</button>').join(""):'<span class="glossary-empty-link">Связанных карточек пока не привязано</span>';
    const example=r.example?'<div class="glossary-detail-block"><span>Пример</span><p>'+esc(r.example)+'</p></div>':"";
    const important=r.important?'<div class="glossary-detail-block glossary-detail-important"><span>Важно</span><p>'+esc(r.important)+'</p></div>':"";
    const expanded=(r.detailsText||[]).length?'<div class="glossary-detail-block glossary-detail-expanded"><span>Подробнее</span>'+r.detailsText.map(x=>'<p>'+esc(x)+'</p>').join("")+'</div>':"";
    const details=(expanded||example||important||r.products.length||r.topicLabels.length)?'<details class="glossary-details"><summary>Подробнее</summary><div class="glossary-detail-grid">'+expanded+'<div class="glossary-detail-block"><span>Связанные темы</span><div class="glossary-chip-row">'+chips+'</div></div><div class="glossary-detail-block glossary-products"><span>В каких товарах и карточках</span><div class="glossary-product-list">'+productsHtml+'</div></div>'+example+important+'</div></details>':"";
    const kind=r.type==="abbreviation"?"Сокращение / обозначение":"Термин";
    const secondary=r.meaning?'<p class="glossary-expansion">'+esc(r.meaning)+'</p>':"";
    const body=r.meaning&&r.definition&&norm(r.meaning)!==norm(r.definition)?'<p class="glossary-definition">'+esc(r.definition)+'</p>':(!r.meaning&&r.definition?'<p class="glossary-definition">'+esc(r.definition)+'</p>':"");
    const quick="";
    return '<article class="glossary-card" data-glossary-item data-glossary-topics="'+esc(r.topics.join(" "))+'" data-glossary-search="'+esc(r.search)+'"><div class="glossary-card-head"><div><span class="glossary-kind">'+kind+'</span><h3>'+esc(r.label)+'</h3>'+secondary+'</div><span class="glossary-index">'+String(i+1).padStart(2,"0")+'</span></div>'+(body||quick?'<div class="glossary-summary">'+body+quick+'</div>':"")+'<div class="glossary-topic-row">'+r.topicLabels.slice(0,3).map(label=>'<button type="button" class="glossary-chip" data-glossary-topic="'+esc(topicDefs.find(t=>t.label===label)?.id||"all")+'">'+esc(label)+'</button>').join("")+'</div>'+details+'</article>';
  };
  const termsHtml=terms.map(itemHtml).join("");
  const renderedSteps=Array.isArray(s.norms12Steps)?s.norms12Steps:steps;
  const stepsHtml=renderedSteps.map((r,i)=>{
    const label=String(r?.[0]||"").trim(),value=String(r?.[1]||"").trim();
    if(!label&&!value)return "";
    return '<div class="glossary-step"><span>'+String(i+1).padStart(2,"0")+'</span><div><strong>'+esc(label.replace(/^\d+\.\s*/,""))+'</strong><p>'+esc(value)+'</p></div></div>';
  }).join("");
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+sectionTitle}])+
    '<div class="page-head glossary-page-head"><div><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>'+sectionTitle+'</h1><p>Быстрый словарь для менеджера: сначала понятный ответ, затем контекст и подробности — только если они нужны.</p></div></div>'+
    '<section class="glossary-browser"><div class="glossary-toolbar"><div class="glossary-search"><span>⌕</span><input id="glossarySearch" type="search" placeholder="Найти сокращение, слово или понятие…" autocomplete="off"><button type="button" id="glossarySearchClear" hidden>×</button></div></div><div class="glossary-topics" role="tablist">'+topicButtons+'</div><div class="glossary-result-line"><strong id="glossaryResultCount">'+terms.length+'</strong><span>записей</span><span class="glossary-result-hint">Наведите взгляд на первый уровень — остальное раскрывается по необходимости.</span></div><div class="glossary-grid" id="glossaryGrid">'+termsHtml+'</div><div class="glossary-no-results" id="glossaryNoResults" hidden><strong>Ничего не найдено</strong><span>Попробуйте другое слово или другую тему.</span></div></section>'+
    (stepsHtml?'<details class="glossary-manager-guide"><summary><span>Памятка менеджера</span><small>Порядок подбора товара — раскрывается только при необходимости</small></summary><div class="glossary-steps">'+stepsHtml+'</div></details>':"")
  const items=[...document.querySelectorAll("[data-glossary-item]")];
  const topicBtns=[...document.querySelectorAll("[data-glossary-topic]")];
  const input=q("#glossarySearch"),clear=q("#glossarySearchClear"),empty=q("#glossaryNoResults"),count=q("#glossaryResultCount");
  let active="all";
  const apply=()=>{
    const query=(input?.value||"").trim().toLowerCase();
    if(clear)clear.hidden=!query;
    let shown=0;
    items.forEach(item=>{
      const topicOk=active==="all"||String(item.dataset.glossaryTopics||"").split(" ").includes(active);
      const textOk=!query||String(item.dataset.glossarySearch||"").includes(query);
      const ok=topicOk&&textOk;
      item.hidden=!ok;if(ok)shown++;
    });
    if(count)count.textContent=String(shown);
    if(empty)empty.hidden=shown>0;
  };
  topicBtns.forEach(btn=>btn.addEventListener("click",()=>{
    active=btn.dataset.glossaryTopic||"all";
    topicBtns.forEach(x=>x.classList.toggle("active",x===btn));
    apply();
    q("#glossaryGrid")?.scrollIntoView({behavior:"smooth",block:"start"});
  }));
  input?.addEventListener("input",apply);
  clear?.addEventListener("click",()=>{if(input){input.value="";input.focus();}apply();});
}
function renderChapter(id){
  const ch=state.chapters.get(id);if(!ch)return notFound();title(ch.title);
  const sections=displaySections(ch);
  app.innerHTML=crumb([{label:"Глава "+ch.id}])+'<div class="page-head"><div><span class="eyebrow">Глава '+esc(ch.id)+'</span><h1>'+esc(ch.title)+'</h1><p>'+sections.length+' подразделов</p></div></div><section class="chapter-grid">'+sections.map((s)=>'<article class="chapter-card" data-num="'+esc(s.id)+'" data-open-section="'+esc(s.id)+'"><span class="chapter-num">'+esc(s.id)+'</span><span class="chapter-arrow">↗</span><h3>'+esc(s.title)+'</h3><p>'+((s.products||[]).length?((s.products||[]).length+" карточек"):"Справочный материал")+'</p></article>').join("")+'</section>';
}
function renderSection(id){
  const x=state.sections.get(id);if(!x)return notFound();const ch=x.chapter,s=x.section;if(["1.3","2.2.1"].includes(id)&&!isAdmin())return notFound();title(s.id+" "+s.title);
  if(id==="2.2.2")return renderSensitivitySection(ch,s);
  if(ch.id==="2" && (state.sectionCatalog.get(id)?.length))return renderCatalogSection(ch,s);
  if(id==="1.1")return renderTermsSection(ch,s);
  if(id==="1.2")return renderNormsSection(ch,s);
  const items=orderedSectionItems(id);
  const sectionImgs=state.assets.sectionImages?.[s.id]||[];
  const subtitle=items.length?items.length+" карточек":(sectionImgs.length?sectionImgs.length+" визуальных позиций":"Справочный материал");
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title}])+
    '<div class="page-head"><div><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>'+esc(s.title)+'</h1><p>'+subtitle+'</p></div></div>'+
    (items.length?'<div class="filter-row"><input class="filter-input" id="sectionFilter" type="search" placeholder="Поиск внутри раздела…"></div><section class="product-grid" id="sectionProducts">'+grouped(items)+'</section>':visualCatalog(s,sectionImgs))+
    (id==="3.1"&&items.length?"":sectionContent(s));
  if(items.length){q("#sectionFilter").addEventListener("input",(e)=>{const z=e.target.value.toLowerCase().trim();const f=items.filter((it)=>[it.product.name,it.product.article,it.product.type,it.product.color,it.product.purpose,it.product.features].filter(Boolean).join(" ").toLowerCase().includes(z));q("#sectionProducts").innerHTML=f.length?grouped(f):'<div class="empty-state" style="grid-column:1/-1"><strong>Ничего не найдено</strong></div>';});}
}
function normalizedCharacteristicRows(rows){
  return (rows||[]).map((r,i)=>{
    if(!Array.isArray(r))return r;
    const row=[...r],label=String(row?.[0]||"").trim(),m=label.match(/^(?:Характеристика|Пункт)\s*(\d+)$/i);
    const hasOther=row.slice(1).some(v=>String(v||"").trim());
    if(m)row[0]=String(Number(m[1]));
    else if(!label&&hasOther)row[0]=String(i+1);
    return row;
  });
}
function fields(p){
  if(p.detailFields?.length)return normalizedCharacteristicRows(p.detailFields).filter((x)=>x?.[0]&&x?.some?.(v=>String(v||"").trim()));
  return [["Артикул",article(p)||"Не указан"],["Тип",p.type],["Назначение",p.purpose],["Характеристики / особенности",p.features],["Производитель",p.manufacturer],["Страна",p.country]].filter((x)=>x[1]);
}
function pairHeaders(p,key,width){
  const saved=Array.isArray(p?.pairHeaders?.[key])?p.pairHeaders[key]:[];
  const defaults=key==="advantages"?["Преимущество","Описание"]:key==="detailFields"?["Название характеристики","Значение"]:[];
  return Array.from({length:width},(_,i)=>String(saved[i]||defaults[i]||("Столбец "+(i+1))));
}
function tableColumnHints(headers,rows){
  const width=Math.max(1,(headers||[]).length),allRows=Array.isArray(rows)?rows:[];
  return Array.from({length:width},(_,i)=>{
    const vals=[String(headers?.[i]||""),...allRows.map(r=>String(r?.[i]||""))].map(v=>v.trim()).filter(Boolean);
    const maxLen=Math.max(1,...vals.map(v=>v.length));
    const compact=i>0&&vals.length>0&&vals.every(v=>v.length<=18&&/^[\d\s.,%+\-–—/:<>≤≥×xа-яa-z()]+$/i.test(v));
    const ch=i===0?Math.min(34,Math.max(16,maxLen+2)):compact?Math.min(18,Math.max(7,maxLen+2)):Math.min(48,Math.max(14,maxLen+2));
    return {className:(i===0?"table-col-primary ":"")+(compact?"table-col-compact":"table-col-text"),ch};
  });
}
function tableColgroup(headers,rows){
  return '<colgroup>'+tableColumnHints(headers,rows).map(x=>'<col class="'+x.className+'" style="width:'+x.ch+'ch">').join("")+'</colgroup>';
}
function pairTable(rows,p,key,cls="pair-data-table"){
  const body=(rows||[]).filter(r=>(r||[]).some(v=>String(v||"").trim()));
  const width=Math.max(2,...body.map(r=>Array.isArray(r)?r.length:0));
  const headers=pairHeaders(p,key,width);
  if(!body.length)return "";
  const hints=tableColumnHints(headers,body);
  return '<div class="pair-table-wrap"><table class="'+cls+'">'+tableColgroup(headers,body)+'<thead><tr>'+headers.map((h,i)=>'<th class="'+hints[i].className+'">'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+
    body.map(r=>'<tr>'+Array.from({length:width},(_,i)=>'<td class="'+hints[i].className+'">'+esc(r?.[i]||"")+'</td>').join("")+'</tr>').join("")+
    '</tbody></table></div>';
}

function tabTableFor(p,id){
  if(p&&Object.prototype.hasOwnProperty.call(p,"tabTables")){
    return Object.prototype.hasOwnProperty.call(p.tabTables||{},id)?p.tabTables[id]:null;
  }
  if(id==="indicators"&&p?.indicatorTable)return p.indicatorTable;
  return null;
}
function hasTabContent(p,id,pairs=[]){return !!(tabTableFor(p,id)?.rows?.length||(pairs||[]).some(r=>Array.isArray(r)?r.some(v=>String(v||"").trim()):String(r||"").trim()))}
function productTabs(p,{includeHidden=false}={}){normalizeProductColors(p);
  const standard=[
    {id:"specs",label:"Характеристики",rows:p.detailFields},
    {id:"indicators",label:"Измеряемые показатели",rows:p.indicators},
    {id:"options",label:"Дополнительные опции",rows:p.options},
    {id:"variants",label:"Варианты исполнения",rows:p.variants},
    {id:"advantages",label:/Анализатор/i.test(p.type||"")?"Особенности":"Преимущества / особенности",rows:p.advantages},
    {id:"complectation",label:"Комплектация",rows:p.complectation},
    {id:"washCycle",label:"Рекомендуемый цикл мойки",rows:p.washCycle},
    {id:"workflow",label:"Порядок работы",rows:p.workflow},
    {id:"calibration",label:"Калибровка",rows:p.calibration},
    {id:"assortment",label:"Линейка",rows:p.assortment},
    {id:"consumables",label:"Расходные материалы",rows:p.consumables},
    {id:"testKits",label:"Тест-наборы",rows:p.testKits}
  ];
  let tabs=standard.filter(t=>includeHidden||hasTabContent(p,t.id,t.rows)).map(({id,label})=>({id,label}));
  for(const t of p.customTabs||[]){
    if(p?.id==="catalog-2-15-турбидофлуориметр-биотф"&&String(t?.id||"")==="bio-щф")continue;
    const customHasContent=hasTabContent(p,t.id,t.rows)||String(p?.tabIntroTexts?.[t.id]||"").trim()||String(p?.tabImages?.[t.id]||"").trim();
    if((includeHidden||customHasContent)&&!tabs.some(x=>x.id===t.id))tabs.push({id:t.id,label:t.label||t.id});
  }
  if(p.substances?.length)tabs.push({id:"substances",label:"Вещества и ppb"});
  const hidden=new Set(p.hiddenTabs||[]);
  if(!includeHidden)tabs=tabs.filter(t=>!hidden.has(t.id));
  if(p.tabLabels)tabs=tabs.map(t=>({...t,label:p.tabLabels[t.id]||t.label}));
  if(Array.isArray(p.tabOrder)&&p.tabOrder.length){const pos=new Map(p.tabOrder.map((id,i)=>[id,i]));tabs.sort((a,b)=>(pos.has(a.id)?pos.get(a.id):999)-(pos.has(b.id)?pos.get(b.id):999));}
  return tabs;
}
function pairCards(rows,cls="feature-definition-list",p=null,key=""){
  const width=Math.max(2,...(rows||[]).map(r=>Array.isArray(r)?r.length:0));
  if(width>2&&p)return pairTable(rows,p,key,cls+"-table");
  return twoColumnCardTable([],rows||[]);
}
function stepCards(rows){
  return '<div class="step-instruction-list">'+(rows||[]).map((r,i)=>{
    const label=String(r?.[0]||("Шаг "+(i+1))),text=String(r?.[1]||""),warning=/внимание|важно/i.test(label);
    return '<div class="step-instruction-row '+(warning?"is-warning":"")+'"><div class="step-instruction-index">'+esc(label)+'</div><div class="step-instruction-text">'+esc(text)+'</div></div>';
  }).join("")+'</div>';
}
function productDocumentsHtml(p){
  const docs=Array.isArray(p?.documents)?p.documents:[];
  if(!docs.length)return "";
  const icon=(name)=>{
    const ext=String(name||"").toLowerCase().split(".").pop();
    if(ext==="pdf")return "PDF";
    if(["ppt","pptx"].includes(ext))return "PPT";
    if(["doc","docx","rtf"].includes(ext))return "DOC";
    if(["xls","xlsx","csv"].includes(ext))return "XLS";
    return "FILE";
  };
  return '<section class="product-documents"><div class="product-documents-head"><strong>Файлы и документы</strong><span>'+docs.length+'</span></div><div class="product-documents-list">'+docs.map(d=>{
    const name=String(d?.name||String(d?.path||"").split("/").pop()||"Документ"),path=String(d?.path||"");if(!path)return "";
    const ext=name.toLowerCase().split(".").pop(),preview=ext==="pdf";
    return '<a class="product-document" href="'+esc(path.startsWith("./")||/^https?:/i.test(path)?path:"./"+path)+'" '+(preview?'data-doc-preview data-doc-href="'+esc(path.startsWith("./")?path:"./"+path)+'" data-doc-label="'+esc(name)+'"':'target="_blank" rel="noopener"')+'><span class="product-document-icon">'+icon(name)+'</span><span class="product-document-copy"><b>'+esc(name)+'</b><small>'+(preview?"Открыть документ":"Открыть файл")+'</small></span><span class="product-document-arrow">↗</span></a>';
  }).join("")+'</div></section>';
}
function substanceTable(rows){
  let last="";
  return '<div class="substance-table-wrap"><table class="substance-table"><thead><tr><th>Вещество</th><th>ppb (мкг/кг)</th></tr></thead><tbody>'+(rows||[]).map((r)=>{const head=r.group&&r.group!==last?(last=r.group,'<tr class="substance-group"><td colspan="2">'+esc(r.group)+'</td></tr>'):"";return head+'<tr><td>'+esc(r.substance||"")+'</td><td>'+esc(r.ppb||"")+'</td></tr>';}).join("")+'</tbody></table></div>';
}
function normalizeTableMerges(table,width,height){
  const out=[];for(const raw of Array.isArray(table?.merges)?table.merges:[]){const row=Math.max(0,Number(raw?.row)||0),col=Math.max(0,Number(raw?.col)||0),rowspan=Math.max(1,Number(raw?.rowspan)||1),colspan=Math.max(1,Number(raw?.colspan)||1);if(row>=height||col>=width)continue;const rs=Math.min(rowspan,height-row),cs=Math.min(colspan,width-col);if(rs<2&&cs<2)continue;if(!out.some(m=>!(row+rs<=m.row||m.row+m.rowspan<=row||col+cs<=m.col||m.col+m.colspan<=col)))out.push({row,col,rowspan:rs,colspan:cs})}return out;
}
function twoColumnCardTable(headers,rows){
  const h=Array.isArray(headers)?headers:[],body=Array.isArray(rows)?rows:[];
  return '<div class="semantic-pair-list">'+
    (h.length?'<div class="semantic-pair-head"><span>'+esc(h[0]||"Параметр")+'</span><span>'+esc(h[1]||"Значение")+'</span></div>':"")+
    body.map(r=>{const warning=/^важно!?$/i.test(String(r?.[0]||"").trim());return '<div class="step-instruction-row semantic-pair-row '+(warning?"is-warning":"")+'"><div class="step-instruction-index semantic-pair-key">'+esc(r?.[0]||"")+'</div><div class="step-instruction-text semantic-pair-value">'+esc(r?.[1]||"")+'</div></div>'}).join("")+
  '</div>';
}
function tablePanel(headers,rows,table=null){
  const h=(headers||[]).filter(Boolean),body=(rows||[]).filter(r=>(r||[]).some(Boolean));if(!h.length||!body.length)return "";
  const merges=normalizeTableMerges(table,h.length,body.length);
  if(h.length===2&&!merges.length)return twoColumnCardTable(h,body);
  const hints=tableColumnHints(h,body);
  return '<div class="table-wrap"><table class="data-table">'+tableColgroup(h,body)+'<thead><tr>'+h.map((x,i)=>'<th class="'+hints[i].className+'">'+esc(x)+'</th>').join("")+'</tr></thead><tbody>'+body.map((r,rowIndex)=>{const cells=[];for(let col=0;col<h.length;col++){const m=merges.find(x=>rowIndex>=x.row&&rowIndex<x.row+x.rowspan&&col>=x.col&&col<x.col+x.colspan);if(m&&!(m.row===rowIndex&&m.col===col))continue;const span=m?' rowspan="'+m.rowspan+'" colspan="'+m.colspan+'"':"";const danger=Array.isArray(table?.dangerCells)&&table.dangerCells.some(x=>Number(x?.[0])===rowIndex&&Number(x?.[1])===col);cells.push('<td class="'+hints[col].className+(danger?" table-cell-danger":"")+'"'+span+'>'+esc(r?.[col]||"")+'</td>')}return '<tr>'+cells.join("")+'</tr>'}).join("")+'</tbody></table></div>';
}
function rluPanel(rows){
  const list=(rows||[]).map(r=>({object:String(r?.[0]||""),result:String(r?.[1]||""),interpretation:String(r?.[2]||"")})).filter(x=>x.object&&x.result);
  const group=(name)=>list.filter(x=>x.object.toLowerCase()===name.toLowerCase());
  const cls=(x)=>/неудовлетвор/i.test(x.interpretation)?"bad":/предупреж/i.test(x.interpretation)?"warn":"good";
  const card=(name)=>'<section class="rlu-card"><div class="rlu-card-head">'+esc(name)+'</div><div class="rlu-bands">'+group(name).map(x=>'<div class="rlu-band '+cls(x)+'"><strong>'+esc(x.result)+'</strong><span>'+esc(x.interpretation)+'</span></div>').join("")+'</div></section>';
  return '<div class="rlu-panel"><div class="rlu-title"><strong>Рекомендуемые нормы производителя</strong><span>Цветовая интерпретация результатов RLU</span></div><div class="rlu-grid">'+card("Поверхность")+card("Вода")+'</div></div>';
}
function tabPanelHtml(p,id){
  const table=tabTableFor(p,id),intro=String(p?.tabIntroTexts?.[id]||"").trim(),tabImage=String(p?.tabImages?.[id]||"").trim();
  const introHtml=intro?'<div class="tab-intro-note">'+esc(intro)+'</div>':"";
  const imageHtml=tabImage?'<figure class="tab-illustration"><img loading="lazy" src="'+esc(imageSrc(tabImage))+'" alt=""></figure>':"";
  if(id==="rlu"&&/Люминометр\s+SMART/i.test(p?.name||"")){
    const custom=(p.customTabs||[]).find(t=>t.id===id);
    const rows=table?.rows?.length?table.rows:(custom?.rows||[]);
    return introHtml+imageHtml+rluPanel(rows);
  }
  if(table?.headers?.length&&table?.rows?.length)return introHtml+imageHtml+tablePanel(table.headers,table.rows,table);
  if(id==="specs"){const rows=fields(p),width=Math.max(2,...rows.map(r=>Array.isArray(r)?r.length:0));if(width>2)return introHtml+imageHtml+pairTable(rows,p,"detailFields","definition-pair-table");return introHtml+imageHtml+twoColumnCardTable([],rows);}
  if(id==="advantages")return pairCards(p.advantages||[],"feature-definition-list",p,"advantages");
  if(id==="indicators")return pairCards(p.indicators||[],"feature-definition-list",p,"indicators");
  if(id==="options")return pairCards(p.options||[],"feature-definition-list",p,"options");
  if(id==="variants")return pairCards(p.variants||[],"feature-definition-list",p,"variants");
  if(id==="complectation")return pairCards(p.complectation||[],"feature-definition-list",p,"complectation");
  if(id==="washCycle")return stepCards(p.washCycle||[]);
  if(id==="workflow")return stepCards(p.workflow||[]);
  if(id==="calibration")return pairCards(p.calibration||[],"feature-definition-list",p,"calibration");
  if(id==="assortment")return pairCards(p.assortment||[],"feature-definition-list",p,"assortment");
  if(id==="consumables")return pairCards(p.consumables||[],"feature-definition-list",p,"consumables");
  if(id==="testKits")return pairCards(p.testKits||[],"feature-definition-list",p,"testKits");
  const custom=(p.customTabs||[]).find((t)=>t.id===id);
  if(custom)return introHtml+imageHtml+(custom.kind==="table"?tablePanel(custom.headers||[],custom.rows||[]):custom.kind==="steps"?stepCards(custom.rows||[]):pairCards(custom.rows||[]));
  if(id==="substances")return substanceTable(p.substances||[]);
  return "";
}
function renderProduct(id){
  const x=ctx(id);if(!x||isProductDeleted(x.section.id,x.product.id))return notFound();const p=x.product,s=x.section,ch=x.chapter;recent.add(p.id);counters();title(p.name);
  const imgs=state.assets.productImages?.[p.id]||[],im=imgs[0]||"",tabs=productTabs(p);
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title,route:"section",id:s.id},{label:p.name}])+'<div class="product-page"><aside class="gallery-card"><div class="gallery-topline"><span>Фотографии товара</span><b>'+(imgs.length?imgs.length:"—")+'</b></div><div class="gallery-main '+(im?"":"product-image placeholder")+'" '+(im?'data-lightbox-product="'+esc(p.id)+'" data-lightbox-index="0"':"")+'>'+(im?'<img src="'+esc(imageSrc(im))+'" alt="'+esc(p.name)+'" style="'+esc(imageViewStyle(p,im,"detail"))+'">':'<div class="gallery-empty"><img src="./assets/brand/favicon.svg" alt=""><strong>Фото пока не привязано</strong><span>Карточка уже работает; изображение появится после сопоставления в диагностике.</span></div>')+'</div>'+(imgs.length>1?'<div class="gallery-thumbs">'+imgs.map((v,i)=>'<button class="gallery-thumb '+(i===0?"active":"")+'" data-gallery-product="'+esc(p.id)+'" data-gallery-index="'+i+'"><img referrerpolicy="no-referrer" src="'+esc(imageSrc(v))+'" alt="" style="'+esc(imageViewStyle(p,v,"detail"))+'"></button>').join("")+'</div>':"")+productDocumentsHtml(p)+'</aside><article class="info-card"><span class="eyebrow">'+esc(s.id)+' · '+esc(s.title)+'</span><h1 class="product-title">'+esc(p.name)+'</h1><div class="product-meta">'+(article(p)?'<span class="badge article">Арт. '+esc(article(p))+'</span>':"")+(p.type?'<span class="badge">'+esc(p.type)+'</span>':"")+(p.color?'<span class="badge">Цвет: '+esc(p.color)+'</span>':"")+'</div>'+(p.purpose?'<p class="product-lead">'+esc(p.purpose)+'</p>':"")+'<div class="quick-actions"><button class="btn '+(favorites.has(p.id)?"active":"")+'" data-fav="'+esc(p.id)+'">★ '+(favorites.has(p.id)?"В избранном":"В избранное")+'</button><button class="btn ghost" data-copy>⌁ Скопировать ссылку</button></div><div class="tabs product-tabs">'+tabs.map((t,i)=>'<button class="tab '+(i===0?"active":"")+'" data-product-tab="'+esc(t.id)+'">'+esc(t.label)+'</button>').join("")+'</div><div class="product-tab-panels">'+tabs.map((t,i)=>'<div class="tab-panel" data-product-panel="'+esc(t.id)+'" '+(i===0?"":"hidden")+'>'+tabPanelHtml(p,t.id)+'</div>').join("")+'</div></article></div>';
}
function renderFavorites(){
  const items=favorites.get().map(ctx).filter(x=>x&&!isProductExcluded(x.section.id,x.product.id));title("Избранное");
  app.innerHTML=crumb([{label:"Избранное"}])+'<div class="page-head"><div><span class="eyebrow">Персональная подборка</span><h1>Избранное</h1><p>'+items.length+' карточек</p></div>'+(items.length?'<div class="page-tools"><button class="btn ghost" data-clear-favorites>Очистить</button></div>':"")+'</div>'+(items.length?'<section class="product-grid">'+items.map(card).join("")+'</section>':'<div class="empty-state"><strong>Здесь пока пусто</strong><p>Нажимайте ★ на нужных товарах.</p></div>');
}
function renderDiagnostics(){
  title("Диагностика данных");
  const s=state.reports.sync||{},im=state.reports.images||{};
  const dup=(s.duplicateArticles||[]);
  const amb=(im.ambiguous||[]);
  const un=(im.imagesUnmatched||[]);
  const missing=(im.productsWithoutImages||[]);
  const suggestions=new Map((im.unmatchedSuggestions||[]).map((x)=>[x.image,x.candidates||[]]));
  const productTotal=Number(im.productsTotal||state.products.size||0);
  const withImages=Number(im.productsWithImages||0);
  const imageTotal=Number(im.imagesTotal||0);
  const imageMatched=Number(im.imagesMatched||0);
  const productCoverage=productTotal?Math.round(withImages/productTotal*100):0;
  const imageCoverage=imageTotal?Math.round(imageMatched/imageTotal*100):0;
  app.innerHTML=crumb([{label:"Диагностика"}])+
    '<div class="page-head"><div><span class="eyebrow">Контроль качества</span><h1>Диагностика Книги знаний</h1><p>Автоматические проверки источников, карточек и изображений. Здесь видно, что уже собрано хорошо, а что ещё требует ручной привязки.</p></div></div>'+
    '<section class="stats"><div class="stat"><strong>'+esc(s.sheets??"—")+'</strong><span>листов Google Sheets</span></div><div class="stat"><strong>'+esc(s.products??"—")+'</strong><span>структурированных карточек</span></div><div class="stat"><strong>'+imageCoverage+'%</strong><span>фотографий уже распределено</span></div><div class="stat"><strong>'+productCoverage+'%</strong><span>товаров имеют индивидуальное фото</span></div></section>'+
    '<section class="data-block"><div class="diag-summary"><div><span class="eyebrow">Текущее состояние</span><h3>Данные собраны, остаток виден и управляем</h3></div><div class="diag-summary-meta"><span>'+imageMatched+' из '+imageTotal+' фото привязано</span><span>'+withImages+' из '+productTotal+' товаров с фото</span><span>Обновлено '+esc(fmtDate(im.generatedAt||s.generatedAt||state.book.generatedAt))+'</span></div></div><div class="diag-grid">'+
      '<div class="diag-item"><b>'+(s.duplicateIds?.length||0)+'</b><span>дубликатов product ID</span></div>'+
      '<div class="diag-item"><b>'+dup.length+'</b><span>повторяющихся артикулов</span></div>'+
      '<div class="diag-item"><b>'+(s.suspiciousProducts?.length||0)+'</b><span>подозрительных карточек</span></div>'+
      '<div class="diag-item"><b>'+amb.length+'</b><span>неоднозначных фото</span></div>'+
      '<div class="diag-item"><b>'+un.length+'</b><span>непривязанных фото</span></div>'+
      '<div class="diag-item"><b>'+missing.length+'</b><span>товаров без индивидуального фото</span></div>'+
    '</div></section>'+
    (dup.length?'<section class="data-block"><h3>Повторяющиеся артикулы</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Артикул</th><th>Количество</th></tr></thead><tbody>'+dup.map((x)=>'<tr><td>'+esc(x.article)+'</td><td>'+esc(x.count)+'</td></tr>').join("")+'</tbody></table></div></section>':"")+
    (amb.length?'<section class="data-block"><div class="section-heading compact"><div><h2>Фото, требующие ручной проверки</h2></div><p>'+amb.length+' файлов</p></div><div class="diag-review-list">'+amb.slice(0,50).map((x)=>'<article class="diag-review"><code>'+esc(x.image)+'</code><div class="diag-candidates">'+(x.candidates||[]).map((y)=>'<button type="button" class="diag-candidate" data-open-product="'+esc(y.id)+'"><strong>'+esc(y.name)+'</strong><span>'+esc(y.section)+(y.score!=null?' · уверенность '+esc(y.score):'')+'</span></button>').join("")+'</div></article>').join("")+'</div></section>':"")+
    (un.length?'<section class="data-block"><div class="section-heading compact"><div><h2>Непривязанные изображения</h2></div><p>'+un.length+' файлов</p></div><div class="diag-review-list">'+un.slice(0,100).map((x)=>{const cand=suggestions.get(x)||[];return '<article class="diag-review"><code>'+esc(x)+'</code>'+(cand.length?'<div class="diag-candidates">'+cand.slice(0,5).map((y)=>'<button type="button" class="diag-candidate" data-open-product="'+esc(y.id)+'"><strong>'+esc(y.name)+'</strong><span>'+esc(y.section)+(y.article?' · арт. '+esc(y.article):'')+'</span></button>').join("")+'</div>':'<span class="diag-no-candidate">Автоподбор не нашёл достаточно уверенного соответствия</span>')+'</article>';}).join("")+(un.length>100?'<div class="note">…ещё '+(un.length-100)+'</div>':"")+'</div></section>':"")+
    (missing.length?'<section class="data-block"><div class="section-heading compact"><div><h2>Товары без индивидуального фото</h2></div><p>'+missing.length+' карточек</p></div><div class="diag-product-list">'+missing.slice(0,120).map((x)=>'<button type="button" class="diag-product" data-open-product="'+esc(x.id)+'"><span>'+esc(x.section)+'</span><strong>'+esc(x.name)+'</strong>'+(x.article?'<small>Арт. '+esc(x.article)+'</small>':'')+'</button>').join("")+'</div>'+(missing.length>120?'<p class="diag-more">Показаны первые 120 карточек из '+missing.length+'. Остальные доступны через поиск.</p>':"")+'</section>':"");
}

function notFound(){title("Не найдено");app.innerHTML='<div class="empty-state"><strong>Страница не найдена</strong><p>Возможно, ссылка относится к старой версии книги.</p><button class="btn primary" data-route="home">На главную</button></div>';}
function render(){
  closeMenu();const r=route();
  const accountMode=r.name==="account"||r.name==="accountProduct"||r.name==="accountSection";
  document.body.classList.toggle("kb-account-mode",accountMode);
  if(accountMode){
    if(window.KB_ADMIN_PAGE?.render)window.KB_ADMIN_PAGE.render();
    else app.innerHTML='<div class="loading-screen"><div class="loader"></div><p>Открываем личный кабинет…</p></div>';
    return;
  }
  if(r.name==="home")renderHome();else if(r.name==="chapter")renderChapter(r.id);else if(r.name==="section")renderSection(r.id);else if(r.name==="product")renderProduct(r.id);else if(r.name==="favorites")renderFavorites();else if(r.name==="diagnostics"&&isAdmin())renderDiagnostics();else notFound();
  activeNav();counters();window.scrollTo(0,0);
}
function searchRender(v){
  const list=state.search(v,20);if(!v.trim()){searchPanel.hidden=true;return;}searchPanel.hidden=false;
  searchPanel.innerHTML=list.length?list.map((x)=>'<div class="search-result" data-search-id="'+esc(x.id)+'"><div><strong>'+esc(x.name)+'</strong><small>'+esc(x.section)+' · '+esc(state.sections.get(x.section)?.section.title||"")+'</small></div>'+(x.article?'<span class="article">'+esc(x.article)+'</span>':"")+'</div>').join(""):'<div class="search-empty">По запросу ничего не найдено</div>';
}
function bind(){
  window.addEventListener("hashchange",render);
  q("#brandHome").onclick=()=>go("home");q("#favoritesBtn").onclick=()=>go("favorites");
  q("#versionLogBtn").onclick=()=>{if(isAdmin())openVersionLog();};
  document.querySelectorAll("[data-close-version]").forEach((x)=>x.onclick=()=>closeVersionLog());
  q("#themeBtn").onclick=()=>{const t=cycleTheme();toast("Тема: "+({"system":"как в системе","light":"светлая","dark":"тёмная"}[t]));};
  q("#openSidebar").onclick=()=>document.body.classList.add("sidebar-open");q("#closeSidebar").onclick=closeMenu;q("#sidebarBackdrop").onclick=closeMenu;
  nav.onclick=(e)=>{const b=e.target.closest("[data-nav-chapter]");if(b)document.querySelector('.nav-chapter[data-chapter="'+CSS.escape(b.dataset.navChapter)+'"]')?.classList.toggle("open");};
  searchInput.oninput=()=>searchRender(searchInput.value);searchInput.onfocus=()=>{if(searchInput.value.trim())searchRender(searchInput.value);};
  searchPanel.onclick=(e)=>{const x=e.target.closest("[data-search-id]");if(x){searchPanel.hidden=true;searchInput.value="";go("product",x.dataset.searchId);}};
  document.addEventListener("click",(e)=>{
    if(!e.target.closest(".search-wrap"))searchPanel.hidden=true;
    const focus=e.target.closest("[data-focus-search]");if(focus){searchInput.focus();searchInput.select();window.scrollTo({top:0,behavior:"smooth"});return;}
    const r=e.target.closest("[data-route]");if(r){go(r.dataset.route,r.dataset.id||"");return;}
    const ch=e.target.closest("[data-open-chapter]");if(ch){go("chapter",ch.dataset.openChapter);return;}
    const s=e.target.closest("[data-open-section]");if(s){go("section",s.dataset.openSection);return;}
    const p=e.target.closest("[data-open-product]");if(p){go("product",p.dataset.openProduct);return;}
    const f=e.target.closest("[data-fav]");if(f){favorites.toggle(f.dataset.fav);render();return;}
    if(e.target.closest("[data-clear-favorites]")){favorites.clear();render();return;}
    if(e.target.closest("[data-copy]")){navigator.clipboard?.writeText(location.href).then(()=>toast("Ссылка скопирована"));return;}
    const pt=e.target.closest("[data-product-tab]");if(pt){const id=pt.dataset.productTab;document.querySelectorAll("[data-product-tab]").forEach((x)=>x.classList.toggle("active",x===pt));document.querySelectorAll("[data-product-panel]").forEach((x)=>x.hidden=x.dataset.productPanel!==id);return;}
    const g=e.target.closest("[data-gallery-product]");if(g){const x=ctx(g.dataset.galleryProduct),imgs=x?state.assets.productImages?.[x.product.id]||[]:[],i=Number(g.dataset.galleryIndex||0),m=q(".gallery-main");if(m&&imgs[i]){m.innerHTML='<img src="'+esc(imageSrc(imgs[i]))+'" alt="'+esc(x.product.name)+'" style="'+esc(imageViewStyle(x.product,imgs[i],"detail"))+'">';m.dataset.lightboxProduct=x.product.id;m.dataset.lightboxIndex=String(i);}document.querySelectorAll(".gallery-thumb").forEach((t)=>t.classList.toggle("active",t===g));return;}
    const direct=e.target.closest("[data-lightbox-src]");
    if(direct){showLightbox([direct.dataset.lightboxSrc],0,direct.querySelector("img")?.alt||"");return;}
    const l=e.target.closest("[data-lightbox-product]");if(l)openLightbox(l.dataset.lightboxProduct,Number(l.dataset.lightboxIndex||0));
    const doc=e.target.closest("[data-doc-preview]");if(doc){e.preventDefault();openDocPreview(doc.dataset.docHref||"",doc.dataset.docLabel||"Документ");return;}
  });
  document.addEventListener("keydown",(e)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();searchInput.focus();}if(e.key==="Escape"){searchPanel.hidden=true;q("#lightbox").hidden=true;closeVersionLog();closeDocPreview();closeMenu();}if(!q("#lightbox").hidden&&e.key==="ArrowLeft")stepLightbox(-1);if(!q("#lightbox").hidden&&e.key==="ArrowRight")stepLightbox(1);});
  q("#lightbox .lightbox-close").onclick=()=>q("#lightbox").hidden=true;
  q("#lightbox .lightbox-prev").onclick=()=>stepLightbox(-1);
  q("#lightbox .lightbox-next").onclick=()=>stepLightbox(1);
  q("#lightbox").onclick=(e)=>{if(e.target===q("#lightbox"))q("#lightbox").hidden=true;};
  const docModal=q("#docPreviewModal");
  q("#docPreviewClose").onclick=()=>closeDocPreview();
  docModal?.addEventListener("close",()=>{q("#docPreviewFrame").src="about:blank";});
  docModal?.addEventListener("click",(e)=>{if(e.target===docModal)closeDocPreview();});
}
function openDocPreview(href,label="Документ"){
  const modal=q("#docPreviewModal"),frame=q("#docPreviewFrame"),title=q("#docPreviewTitle"),meta=q("#docPreviewMeta"),download=q("#docPreviewDownload"),external=q("#docPreviewExternal");
  if(!modal||!frame||!href)return;
  const v=String(href||"").trim();
  const name=(()=>{try{return decodeURIComponent(v.split("/").pop().split("?")[0].split("#")[0]||"document.pdf");}catch{return "document.pdf";}})();
  const cleanName=/\.pdf$/i.test(name)?name:name+".pdf";
  if(title)title.textContent=label||cleanName;
  if(meta)meta.textContent="PDF · встроенный просмотр · "+cleanName;
  frame.src=v;
  frame.title="Предпросмотр: "+(label||cleanName);
  if(download){
    download.href=v;
    if(/^https?:\/\//i.test(v))download.removeAttribute("download");
    else download.download=cleanName;
  }
  if(external)external.href=v;
  if(typeof modal.showModal==="function"){
    if(modal.open)modal.close();
    modal.showModal();
  }else{
    modal.setAttribute("open","");
  }
}
function closeDocPreview(){
  const modal=q("#docPreviewModal");
  if(!modal)return;
  if(typeof modal.close==="function"&&modal.open)modal.close();
  else modal.removeAttribute("open");
}
function openVersionLog(){
  if(!isAdmin())return;
  const modal=q("#versionModal"),box=q("#versionEntries");
  box.innerHTML=(state.versionLog.entries||[]).map((e,i)=>'<article class="version-entry '+(i===0?"latest":"")+'"><div class="version-meta"><strong>v'+esc(e.version)+'</strong><span>'+esc(e.date)+'</span>'+(i===0?'<b>Текущая</b>':"")+'</div><h3>'+esc(e.title||"Обновление")+'</h3><ul>'+(e.changes||[]).map((x)=>'<li>'+esc(x)+'</li>').join("")+'</ul></article>').join("");
  modal.hidden=false;document.body.classList.add("modal-open");
}
function closeVersionLog(){const modal=q("#versionModal");if(modal){modal.hidden=true;document.body.classList.remove("modal-open");}}
function lightboxSrc(v){return imageSrc(v);}
function showLightbox(images,index=0,alt=""){
  const list=(images||[]).filter(Boolean);if(!list.length)return;
  const n=((Number(index)||0)%list.length+list.length)%list.length;
  state.lightbox={images:list,index:n,alt};
  const lb=q("#lightbox"),pic=lb.querySelector("img");
  lb.hidden=false;pic.src=lightboxSrc(list[n]);pic.alt=alt||"";
  lb.querySelector(".lightbox-prev").hidden=list.length<2;
  lb.querySelector(".lightbox-next").hidden=list.length<2;
}
function stepLightbox(delta){
  const g=state.lightbox||{},list=g.images||[];if(list.length<2)return;
  showLightbox(list,(g.index||0)+delta,g.alt||"");
}
function openLightbox(id,i){
  const x=ctx(id),imgs=x?state.assets.productImages?.[x.product.id]||[]:[];if(!imgs.length)return;
  showLightbox(imgs,i,x.product.name);
}
async function loadTerms11(){
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const res=await fetch("./data/terms-1-1.json?v="+Date.now(),{cache:"no-store",signal:controller.signal});
      if(!res.ok)throw new Error("HTTP "+res.status);
      state.terms11Base=await res.json();
      const overrideTerms=state.overrides?.sections?.["1.1"]?.terms11;
      state.terms11=Array.isArray(overrideTerms)&&overrideTerms.length?deepCopy(overrideTerms):deepCopy(state.terms11Base);
      const r=route();
      if(r.name==="section"&&r.id==="1.1")render();
    }finally{clearTimeout(timer)}
  }catch(e){console.warn("Раздел 1.1: не удалось загрузить отдельный источник терминов.",e)}
}
async function fetchOptionalJson(url,{timeout=4000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const res=await fetch(url,{cache:"no-store",signal:controller.signal});
    if(!res.ok)return null;
    return await res.json();
  }catch{return null}
  finally{clearTimeout(timer)}
}
async function init(){
  applyTheme();
  const stamp=Date.now();
  const [bookRes,assetsData,indexData,syncData,imageData,versionData,publishedOverrides]=await Promise.all([
    fetch("./data/book.json?v="+stamp,{cache:"no-store"}),
    fetchOptionalJson("./data/assets.json?v="+stamp),
    fetchOptionalJson("./data/search-index.json?v="+stamp),
    fetchOptionalJson("./data/sync-report.json?v="+stamp),
    fetchOptionalJson("./data/image-match-report.json?v="+stamp),
    fetchOptionalJson("./data/version-log.json?v="+stamp),
    fetchOptionalJson("./data/admin-overrides.json?v="+stamp),
  ]);
  if(!bookRes.ok)throw new Error("Не удалось загрузить данные.");
  state.book=await bookRes.json();
  state.assets=assetsData||state.assets;
  state.index=Array.isArray(indexData)?indexData:[];
  state.reports.sync=syncData;
  state.reports.images=imageData;
  state.versionLog=versionData||state.versionLog;
  const latestOverrides=publishedOverrides&&typeof publishedOverrides==="object"?publishedOverrides:state.overrides;
  state.overrides=mergeOverrideLayer(latestOverrides,localEditorOverrides(latestOverrides));
  state.publishedLiveSnapshots={};
  q("#versionNumber").textContent=state.versionLog.current||"2.0";
  mapData();state.index=buildLiveSearchIndex();state.search=makeSearch(state.index);renderNav();bind();counters();installEditorApi();applyAdminVisibility();q("#syncState").textContent="Каталог · обновлено "+fmtDate(state.book.generatedAt);
  window.addEventListener("kb:admin-change",()=>{applyAdminVisibility();renderNav();const r=route();if(r.name==="diagnostics"&&!isAdmin())go("home");else render();});
  if(!location.hash)go("home");else render();
  loadTerms11();
}
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));}
init().catch((e)=>{console.error(e);app.innerHTML='<div class="empty-state"><strong>Ошибка загрузки</strong><p>'+esc(e.message)+'</p><button class="btn primary" onclick="location.reload()">Повторить</button></div>';});