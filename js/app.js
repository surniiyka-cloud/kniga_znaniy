
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
  return {...deepCopy(state.publishedLiveSnapshots||{}),...local};
}
function saveLiveSnapshots(v){localStorage.setItem(LIVE_SHEETS_KEY,JSON.stringify(v||{}))}
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
  const inc=sBy("2.4");if(inc){
    const x=splitAdvantages(inc.pairs);
    const modes=uniquePairs(x.fields.filter(r=>/^Режим работы №/i.test(String(r[0]||""))));
    const fields=uniquePairs(x.fields.filter(r=>!/^Режим работы №/i.test(String(r[0]||""))&&!/^(Характеристика|Наименование)$/i.test(String(r[0]||""))));
    const name=(inc.rawRows||[]).find(r=>String(r?.[0]||"").trim()==="Наименование")?.[1]||"Термостатическое устройство TIAS";
    registerCatalog("2.4",name,fields,["img/photos/12-inkubatory-i-schityvayuschie-ustroystva/12-tias.png"],{
      advantages:x.advantages,customTabs:modes.length?[{id:"modes",label:"Режимы работы",kind:"pairs",rows:modes}]:[]
    });
  }

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
  // индикаторные полоски — строка таблицы = отдельная карточка
  const strips=sBy("2.10");if(strips){
    (strips.tables||[]).forEach((t)=>{
      (t.rows||[]).forEach((r)=>{
        const fs=(t.headers||[]).slice(1).map((h,i)=>[h,r[i+1]]).filter((x)=>x[1]);
        registerCatalog("2.10",r[0],fs,[],{type:t.title});
      });
    });
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
    const kangFields=asPairs(between(x=>x==="Общие характеристики",x=>x==="Подготовка и проведение анализа"));
    const kangWorkflow=asPairs(between(x=>x==="Подготовка и проведение анализа",x=>x==="Практическое значение"));
    const kangAdv=asPairs(between(x=>x==="Практическое значение",x=>/^Romer Labs HygieneChek Plus/i.test(x)));
    const kangLine=asLineup(between(x=>x==="Линейка тест-пластин",x=>x==="Общие характеристики"));
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
  // питательные среды — каждая строка ассортимента отдельной карточкой; фото только при уверенном совпадении
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
    for(const r of media.rawRows||media.rows||[]){
      const name=String(r[1]||"").trim(),purpose=String(r[3]||"").trim();
      if(!name||!purpose||name===name.toUpperCase())continue;
      const fs=[["Назначение",purpose],["Фасовка",r[4]||""],["ТУ / стандарт",r[5]||""]].filter((x)=>x[1]);
      const hit=imgMap.find(([rx])=>rx.test(name));
      registerCatalog("2.14",name,fs,hit?[folder+hit[1]]:[]);
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
  if(items.length)q("#sectionFilter").addEventListener("input",(e)=>{const z=e.target.value.toLowerCase().trim(),f=items.filter((it)=>JSON.stringify(it.product).toLowerCase().includes(z));q("#sectionProducts").innerHTML=f.length?f.map(card).join(""):'<div class="empty-state" style="grid-column:1/-1"><strong>Ничего не найдено</strong></div>';});
}

function splitFeatureText(text){
  return String(text||"").split(/;|\.\s+(?=[А-ЯA-ZЁ])/).map((x)=>x.trim().replace(/[.;]+$/,"")).filter((x)=>x.length>2);
}
function classifySheetFields(p){
  const source=(p.sheetFields||[]).map((r)=>[String(r[0]||"").trim(),String(r[1]||"").trim()]).filter((r)=>r[0]&&r[1]);
  const characteristics=[],advantages=[],complectation=[],options=[],variants=[];
  const baseSkip=/^(Наименование|Название|Артикул)$/i;
  for(const [label,value] of source){
    if(baseSkip.test(label))continue;
    if(/(Преимуществ|Особенност|Характеристики?\s*(?:\/|и)\s*(?:особенност|преимуществ))/i.test(label)){
      splitFeatureText(value).forEach((x,i)=>advantages.push(["Пункт "+(i+1),x]));
      continue;
    }
    if(/^(Комплектация|Комплект|Состав комплекта|Состав упаковки)$/i.test(label)){complectation.push([label,value]);continue;}
    if(/^(Опции?|Дополнительные опции|Доп\. ?опции|Дополнительная комплектация)$/i.test(label)){options.push([label,value]);continue;}
    if(/^(Варианты?|Исполнение|Размерный ряд|Модификации?)$/i.test(label)){variants.push([label,value]);continue;}
    characteristics.push([label,value]);
  }
  if(!advantages.length&&p.features){
    splitFeatureText(p.features).forEach((x,i)=>advantages.push(["Особенность "+(i+1),x]));
  }
  const standard=[
    ["Артикул",article(p)||""],["Тип",p.type],["Назначение",p.purpose],["Производитель",p.manufacturer],["Страна",p.country],
    ["Размер",p.size],["Количество",p.quantity],["Рост",p.height],["Ширина",p.width],["Длина",p.length],["Толщина",p.thickness]
  ].filter((x)=>x[1]);
  return {
    characteristics:uniquePairs([...standard,...characteristics]),
    advantages:uniquePairs(advantages),
    complectation:uniquePairs(complectation),
    options:uniquePairs(options),
    variants:uniquePairs(variants)
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
      if(pairs.length>1||advantages.length)applyProductBlock(section,name,pairs,advantages);
    }
  }
}

function enrichRegularProducts(){
  for(const [id,x] of state.products){
    const p=x.product;
    if(String(id).startsWith("catalog-"))continue;
    const z=classifySheetFields(p);
    p.detailFields=z.characteristics.length?z.characteristics:[["Артикул",article(p)||"Не указан"],["Тип",p.type],["Назначение",p.purpose]].filter((r)=>r[1]);
    if(z.advantages.length)p.advantages=z.advantages;
    if(z.complectation.length)p.complectation=z.complectation;
    if(z.options.length)p.options=z.options;
    if(z.variants.length)p.variants=z.variants;
    if(!p.advantages?.length&&p.features){
      p.advantages=splitFeatureText(p.features).map((x,i)=>["Особенность "+(i+1),x]);
    }
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
  for(const [id,x] of state.products){
    state.editorBase.products.set(id,deepCopy(x.product));
    state.editorBase.images.set(id,deepCopy(state.assets.productImages?.[id]||[]));
    const pov=ov.products?.[id];if(!pov)continue;
    for(const [k,v] of Object.entries(pov)){if(!["id","images"].includes(k))x.product[k]=deepCopy(v);}
    if(Array.isArray(pov.images))state.assets.productImages[id]=deepCopy(pov.images);
  }
}
function buildLiveSearchIndex(){
  const out=[];
  for(const [id,x] of state.products){if(isProductExcluded(x.section.id,id))continue;const p=x.product;out.push({id,section:x.section.id,chapter:x.chapter.id,name:p.name||"",article:p.article||"",text:[p.name,p.article,p.type,p.purpose,p.features,p.manufacturer,p.country,JSON.stringify(p.detailFields||[]),JSON.stringify(p.advantages||[]),JSON.stringify(p.indicators||[]),JSON.stringify(p.indicatorTable||{}),JSON.stringify(p.tabTables||{}),JSON.stringify(p.substances||[])].filter(Boolean).join(" ")});}
  return out;
}
function installEditorApi(){
  window.KB_EDITOR_API={
    current(){
      const r=route();
      if(r.name==="product"){
        const x=ctx(r.id);if(!x)return {kind:"none"};
        const sourceId=x.product.sourceSectionId||x.section.id,source=bookSectionById(sourceId)?.section||null;
        return {kind:"product",id:r.id,product:deepCopy(x.product),sourceProduct:deepCopy(state.editorBase.products.get(r.id)||{}),images:deepCopy(state.assets.productImages?.[r.id]||[]),sourceImages:deepCopy(state.editorBase.images.get(r.id)||[]),tabs:productTabs(x.product,{includeHidden:true}),section:{id:x.section.id,title:x.section.title,gid:x.section.gid||null},sourceSection:source?{id:source.id,title:source.title,gid:source.gid||x.product.sourceGid||null}:null,chapter:{id:x.chapter.id,title:x.chapter.title},spreadsheetId:state.book.spreadsheetId};
      }
      if(r.name==="section"){
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
    overrides(){return deepCopy(state.overrides||{})},
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
function card(x){
  const p=x.product, images=state.assets.productImages?.[p.id]||[], im=images[0]||"", a=article(p);
  return '<article class="product-card"><div class="product-image '+(im?"":"placeholder")+'" '+(im?'data-open-product="'+esc(p.id)+'"':"")+'>'+(im?'<img src="'+esc(imageSrc(im))+'" loading="lazy" alt="'+esc(p.name)+'" style="'+esc(imageViewStyle(p,im,"card"))+'">':"")+(images.length>1?'<span class="photo-count">◫ '+images.length+'</span>':"")+'</div><div class="product-body"><div class="product-meta">'+(a?'<span class="badge article">Арт. '+esc(a)+'</span>':"")+(p.type?'<span class="badge">'+esc(p.type)+'</span>':"")+'</div><h3>'+esc(p.name)+'</h3>'+(p.purpose?'<p>'+esc(p.purpose)+'</p>':"")+'<div class="product-actions"><button class="btn primary" data-open-product="'+esc(p.id)+'">Подробнее</button><button class="btn icon '+(favorites.has(p.id)?"active":"")+'" data-fav="'+esc(p.id)+'" aria-label="Избранное">★</button></div></div></article>';
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
  if(s.notes?.length){
    out+='<section class="knowledge-section"><div class="section-heading compact"><div><h2>Что важно знать</h2></div></div><div class="note-cards">'+s.notes.map((n)=>'<article class="note-card">'+esc(n)+'</article>').join("")+'</div></section>';
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
    return '<section class="content-block content-table"><div class="content-table-wrap"><table><thead><tr>'+h.map(x=>'<th>'+esc(x)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+h.map((_,j)=>'<td>'+esc(r?.[j]||"")+'</td>').join("")+'</tr>').join("")+'</tbody></table></div></section>';
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
    {id:"quality",number:"04",title:"Валидация и внедрение",range:"21—22",from:21,to:22,desc:"Отделяем пригодность самой методики от её корректного внедрения в конкретной лаборатории."}
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
  const pdfTitleHtml=(t)=>{
    const pdf=(t.resources||[]).find(isPdf);
    if(!pdf)return "";
    const href=resourceHref(pdf.href),label=String(pdf.label||"PDF").trim();
    return '<button type="button" class="foundation-pdf-trigger" data-doc-preview data-doc-href="'+esc(href)+'" data-doc-label="'+esc(label)+'" title="Открыть PDF: '+esc(label)+'"><span class="foundation-pdf-badge">PDF</span><span class="foundation-pdf-label">'+esc(label.replace(/\s*—\s*PDF\s*$/i,""))+'</span></button>';
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
      ?'<div class="foundation-detail-grid">'+(detailBody?'<section class="foundation-detail-copy"><span class="foundation-detail-label">Расширение</span>'+detailBody+'</section>':"")+(docsBlock||"")+(relatedBlock||"")+'</div>'
      :"";
    const details=detailBlocks?'<details class="foundation-details"><summary>Подробнее</summary>'+detailBlocks+'</details>':"";
    const pending=isAdmin()&&(t.pendingResources||[]).length?'<div class="foundation-pending"><span>Ожидают добавления</span>'+esc((t.pendingResources||[]).join(" · "))+'</div>':"";
    const pdfTitle=pdfTitleHtml(t);
    const titleRow='<div class="foundation-title-row">'+pdfTitle+'<div class="foundation-title-copy"><span class="foundation-kicker">ТЕРМИН</span><h3>'+esc(t.title)+'</h3></div></div>';
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
    target.open?.();
    scrollFoundationTo(target);
    target.classList.add("term-focus");
    setTimeout(()=>target.classList.remove("term-focus"),1100);
  }));
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
    sectionContent(s);
  if(items.length){q("#sectionFilter").addEventListener("input",(e)=>{const z=e.target.value.toLowerCase().trim();const f=items.filter((it)=>[it.product.name,it.product.article,it.product.type,it.product.purpose,it.product.features].filter(Boolean).join(" ").toLowerCase().includes(z));q("#sectionProducts").innerHTML=f.length?grouped(f):'<div class="empty-state" style="grid-column:1/-1"><strong>Ничего не найдено</strong></div>';});}
}
function fields(p){
  if(p.detailFields?.length)return p.detailFields.filter((x)=>x?.[0]&&x?.[1]);
  return [["Артикул",article(p)||"Не указан"],["Тип",p.type],["Назначение",p.purpose],["Характеристики / особенности",p.features],["Производитель",p.manufacturer],["Страна",p.country]].filter((x)=>x[1]);
}

function tabTableFor(p,id){
  if(p&&Object.prototype.hasOwnProperty.call(p,"tabTables")){
    return Object.prototype.hasOwnProperty.call(p.tabTables||{},id)?p.tabTables[id]:null;
  }
  if(id==="indicators"&&p?.indicatorTable)return p.indicatorTable;
  return null;
}
function hasTabContent(p,id,pairs=[]){return !!(tabTableFor(p,id)?.rows?.length||(pairs||[]).length)}
function productTabs(p,{includeHidden=false}={}){
  let tabs=[{id:"specs",label:"Характеристики"}];
  if(hasTabContent(p,"indicators",p.indicators))tabs.push({id:"indicators",label:"Измеряемые показатели"});
  if(hasTabContent(p,"options",p.options))tabs.push({id:"options",label:"Дополнительные опции"});
  if(hasTabContent(p,"variants",p.variants))tabs.push({id:"variants",label:"Варианты исполнения"});
  if(hasTabContent(p,"advantages",p.advantages))tabs.push({id:"advantages",label:/Анализатор/i.test(p.type||"")?"Особенности":"Преимущества / особенности"});
  if(hasTabContent(p,"complectation",p.complectation))tabs.push({id:"complectation",label:"Комплектация"});
  if(hasTabContent(p,"washCycle",p.washCycle))tabs.push({id:"washCycle",label:"Рекомендуемый цикл мойки"});
  if(hasTabContent(p,"workflow",p.workflow))tabs.push({id:"workflow",label:"Порядок работы"});
  if(hasTabContent(p,"calibration",p.calibration))tabs.push({id:"calibration",label:"Калибровка"});
  if(hasTabContent(p,"assortment",p.assortment))tabs.push({id:"assortment",label:"Линейка"});
  if(hasTabContent(p,"consumables",p.consumables))tabs.push({id:"consumables",label:"Расходные материалы"});
  if(hasTabContent(p,"testKits",p.testKits))tabs.push({id:"testKits",label:"Тест-наборы"});
  for(const t of p.customTabs||[])if(!tabs.some(x=>x.id===t.id))tabs.push({id:t.id,label:t.label||t.id});
  if(p.substances?.length)tabs.push({id:"substances",label:"Вещества и ppb"});
  const hidden=new Set(p.hiddenTabs||[]);
  if(!includeHidden)tabs=tabs.filter(t=>!hidden.has(t.id));
  if(p.tabLabels)tabs=tabs.map(t=>({...t,label:p.tabLabels[t.id]||t.label}));
  if(Array.isArray(p.tabOrder)&&p.tabOrder.length){const pos=new Map(p.tabOrder.map((id,i)=>[id,i]));tabs.sort((a,b)=>(pos.has(a.id)?pos.get(a.id):999)-(pos.has(b.id)?pos.get(b.id):999));}
  return tabs;
}
function pairCards(rows,cls="feature-definition-list"){
  return '<dl class="'+cls+'">'+(rows||[]).map((r)=>'<dt>'+esc(r?.[0]||"")+'</dt><dd>'+esc(r?.[1]||"")+'</dd>').join("")+'</dl>';
}
function stepCards(rows){
  return '<dl class="feature-definition-list">'+(rows||[]).map((r,i)=>'<dt>'+esc(r?.[0]||("Шаг "+(i+1)))+'</dt><dd>'+esc(r?.[1]||"")+'</dd>').join("")+'</dl>';
}
function substanceTable(rows){
  let last="";
  return '<div class="substance-table-wrap"><table class="substance-table"><thead><tr><th>Вещество</th><th>ppb (мкг/кг)</th></tr></thead><tbody>'+(rows||[]).map((r)=>{const head=r.group&&r.group!==last?(last=r.group,'<tr class="substance-group"><td colspan="2">'+esc(r.group)+'</td></tr>'):"";return head+'<tr><td>'+esc(r.substance||"")+'</td><td>'+esc(r.ppb||"")+'</td></tr>';}).join("")+'</tbody></table></div>';
}
function tablePanel(headers,rows){
  const h=(headers||[]).filter(Boolean),body=(rows||[]).filter(r=>(r||[]).some(Boolean));if(!h.length||!body.length)return "";
  return '<div class="table-wrap"><table class="data-table"><thead><tr>'+h.map(x=>'<th>'+esc(x)+'</th>').join("")+'</tr></thead><tbody>'+body.map(r=>'<tr>'+Array.from({length:h.length},(_,i)=>'<td>'+esc(r?.[i]||"")+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
}
function rluPanel(rows){
  const list=(rows||[]).map(r=>({object:String(r?.[0]||""),result:String(r?.[1]||""),interpretation:String(r?.[2]||"")})).filter(x=>x.object&&x.result);
  const group=(name)=>list.filter(x=>x.object.toLowerCase()===name.toLowerCase());
  const cls=(x)=>/неудовлетвор/i.test(x.interpretation)?"bad":/предупреж/i.test(x.interpretation)?"warn":"good";
  const card=(name)=>'<section class="rlu-card"><div class="rlu-card-head">'+esc(name)+'</div><div class="rlu-bands">'+group(name).map(x=>'<div class="rlu-band '+cls(x)+'"><strong>'+esc(x.result)+'</strong><span>'+esc(x.interpretation)+'</span></div>').join("")+'</div></section>';
  return '<div class="rlu-panel"><div class="rlu-title"><strong>Рекомендуемые нормы производителя</strong><span>Цветовая интерпретация результатов RLU</span></div><div class="rlu-grid">'+card("Поверхность")+card("Вода")+'</div></div>';
}
function tabPanelHtml(p,id){
  const table=tabTableFor(p,id);
  if(id==="rlu"&&/Люминометр\s+SMART/i.test(p?.name||"")){
    const custom=(p.customTabs||[]).find(t=>t.id===id);
    const rows=table?.rows?.length?table.rows:(custom?.rows||[]);
    return rluPanel(rows);
  }
  if(table?.headers?.length&&table?.rows?.length)return tablePanel(table.headers,table.rows);
  if(id==="specs")return '<dl class="definition-list">'+fields(p).map((r)=>'<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>').join("")+'</dl>';
  if(id==="advantages")return pairCards(p.advantages||[]);
  if(id==="indicators")return pairCards(p.indicators||[]);
  if(id==="options")return pairCards(p.options||[]);
  if(id==="variants")return pairCards(p.variants||[]);
  if(id==="complectation")return pairCards(p.complectation||[]);
  if(id==="washCycle")return stepCards(p.washCycle||[]);
  if(id==="workflow")return stepCards(p.workflow||[]);
  if(id==="calibration")return pairCards(p.calibration||[]);
  if(id==="assortment")return pairCards(p.assortment||[]);
  if(id==="consumables")return pairCards(p.consumables||[]);
  if(id==="testKits")return pairCards(p.testKits||[]);
  const custom=(p.customTabs||[]).find((t)=>t.id===id);
  if(custom)return custom.kind==="table"?tablePanel(custom.headers||[],custom.rows||[]):custom.kind==="steps"?stepCards(custom.rows||[]):pairCards(custom.rows||[]);
  if(id==="substances")return substanceTable(p.substances||[]);
  return "";
}
function renderProduct(id){
  const x=ctx(id);if(!x||isProductDeleted(x.section.id,x.product.id))return notFound();const p=x.product,s=x.section,ch=x.chapter;recent.add(p.id);counters();title(p.name);
  const imgs=state.assets.productImages?.[p.id]||[],im=imgs[0]||"",tabs=productTabs(p);
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title,route:"section",id:s.id},{label:p.name}])+'<div class="product-page"><aside class="gallery-card"><div class="gallery-topline"><span>Фотографии товара</span><b>'+(imgs.length?imgs.length:"—")+'</b></div><div class="gallery-main '+(im?"":"product-image placeholder")+'" '+(im?'data-lightbox-product="'+esc(p.id)+'" data-lightbox-index="0"':"")+'>'+(im?'<img src="'+esc(imageSrc(im))+'" alt="'+esc(p.name)+'" style="'+esc(imageViewStyle(p,im,"detail"))+'">':'<div class="gallery-empty"><img src="./assets/brand/favicon.svg" alt=""><strong>Фото пока не привязано</strong><span>Карточка уже работает; изображение появится после сопоставления в диагностике.</span></div>')+'</div>'+(imgs.length>1?'<div class="gallery-thumbs">'+imgs.map((v,i)=>'<button class="gallery-thumb '+(i===0?"active":"")+'" data-gallery-product="'+esc(p.id)+'" data-gallery-index="'+i+'"><img referrerpolicy="no-referrer" src="'+esc(imageSrc(v))+'" alt="" style="'+esc(imageViewStyle(p,v,"detail"))+'"></button>').join("")+'</div>':"")+'</aside><article class="info-card"><span class="eyebrow">'+esc(s.id)+' · '+esc(s.title)+'</span><h1 class="product-title">'+esc(p.name)+'</h1><div class="product-meta">'+(article(p)?'<span class="badge article">Арт. '+esc(article(p))+'</span>':"")+(p.type?'<span class="badge">'+esc(p.type)+'</span>':"")+'</div>'+(p.purpose?'<p class="product-lead">'+esc(p.purpose)+'</p>':"")+'<div class="quick-actions"><button class="btn '+(favorites.has(p.id)?"active":"")+'" data-fav="'+esc(p.id)+'">★ '+(favorites.has(p.id)?"В избранном":"В избранное")+'</button><button class="btn ghost" data-copy>⌁ Скопировать ссылку</button></div><div class="tabs product-tabs">'+tabs.map((t,i)=>'<button class="tab '+(i===0?"active":"")+'" data-product-tab="'+esc(t.id)+'">'+esc(t.label)+'</button>').join("")+'</div><div class="product-tab-panels">'+tabs.map((t,i)=>'<div class="tab-panel" data-product-panel="'+esc(t.id)+'" '+(i===0?"":"hidden")+'>'+tabPanelHtml(p,t.id)+'</div>').join("")+'</div></article></div>';
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
    const doc=e.target.closest("[data-doc-preview]");if(doc){openDocPreview(doc.dataset.docHref||"",doc.dataset.docLabel||"Документ");return;}
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
async function init(){
  applyTheme();
  const stamp=Date.now();
  const rs=await Promise.all([
    fetch("./data/book.json?v="+stamp,{cache:"no-store"}),
    fetch("./data/assets.json?v="+stamp,{cache:"no-store"}),
    fetch("./data/search-index.json?v="+stamp,{cache:"no-store"}),
    fetch("./data/sync-report.json?v="+stamp,{cache:"no-store"}).catch(()=>null),
    fetch("./data/image-match-report.json?v="+stamp,{cache:"no-store"}).catch(()=>null),
    fetch("./data/version-log.json?v="+stamp,{cache:"no-store"}).catch(()=>null),
    fetch("./data/admin-overrides.json?v="+stamp,{cache:"no-store"}).catch(()=>null),
    fetch("./data/live-sheet-snapshots.json?v="+stamp,{cache:"no-store"}).catch(()=>null)
  ]);
  if(!rs[0].ok)throw new Error("Не удалось загрузить данные.");
  state.book=await rs[0].json();
  state.assets=rs[1]?.ok?await rs[1].json():state.assets;
  state.index=rs[2]?.ok?await rs[2].json():[];
  state.reports.sync=rs[3]?.ok?await rs[3].json():null;
  state.reports.images=rs[4]?.ok?await rs[4].json():null;
  state.versionLog=rs[5]?.ok?await rs[5].json():state.versionLog;
  const publishedOverrides=rs[6]?.ok?await rs[6].json():state.overrides;
  state.overrides=mergeOverrideLayer(publishedOverrides,localEditorOverrides(publishedOverrides));
  state.publishedLiveSnapshots=rs[7]?.ok?await rs[7].json():{};
  applyStoredLiveSnapshots();
  q("#versionNumber").textContent=state.versionLog.current||"2.0";
  mapData();state.index=buildLiveSearchIndex();state.search=makeSearch(state.index);renderNav();bind();counters();installEditorApi();applyAdminVisibility();q("#syncState").textContent="Google Sheets · обновлено "+fmtDate(state.book.generatedAt);
  window.addEventListener("kb:admin-change",()=>{applyAdminVisibility();renderNav();const r=route();if(r.name==="diagnostics"&&!isAdmin())go("home");else render();});
  if(!location.hash)go("home");else render();
  loadTerms11();
}
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));}
init().catch((e)=>{console.error(e);app.innerHTML='<div class="empty-state"><strong>Ошибка загрузки</strong><p>'+esc(e.message)+'</p><button class="btn primary" onclick="location.reload()">Повторить</button></div>';});
