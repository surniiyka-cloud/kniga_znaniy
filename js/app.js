
import {makeSearch} from "./search.js";
import {route,href,go} from "./router.js";
import {favorites,comparison,recent,applyTheme,cycleTheme,getTheme} from "./storage.js";

const q=(s)=>document.querySelector(s);
const app=q("#app"), nav=q("#nav"), searchInput=q("#globalSearch"), searchPanel=q("#searchPanel");
const isAdmin=()=>{try{return sessionStorage.getItem("kb_admin")==="1"}catch{return false}};
const state={book:null,assets:{productImages:{},sectionImages:{}},overrides:{version:1,products:{},sections:{},chapters:{}},editorBase:{products:new Map(),images:new Map(),sections:new Map(),chapters:new Map()},index:[],reports:{sync:null,images:null},versionLog:{current:"2.0",entries:[]},products:new Map(),sections:new Map(),chapters:new Map(),sectionCatalog:new Map(),search:()=>[],lightbox:{images:[],index:0,alt:""}};

function esc(v){return String(v??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function fmtDate(v){try{return new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(v));}catch{return v||"—";}}
function article(p){const a=String(p.article||"").trim();return (!a||a==="-"||a==="—")?"":a;}
function imgSrc(p){return state.assets.productImages?.[p.id]?.[0]||"";}
function ctx(id){return state.products.get(id)||null;}
function toast(t){const el=q("#toast");el.textContent=t;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),1800);}
function counters(){q("#favCount").textContent=favorites.get().length;q("#compareCount").textContent=comparison.get().length;}
function title(t){document.title=t?(t+" · Книга знаний TIAN-Трейд"):"Книга знаний · TIAN-Трейд";}
function closeMenu(){document.body.classList.remove("sidebar-open");}
function crumb(items){return '<div class="crumbs"><button data-route="home">Главная</button>'+items.map((x)=>'<span>›</span>'+(x.route?'<button data-route="'+esc(x.route)+'" data-id="'+esc(x.id||"")+'">'+esc(x.label)+'</button>':'<span>'+esc(x.label)+'</span>')).join("")+'</div>';}


function safeSlug(v){return String(v||"item").toLowerCase().replace(/[^a-zа-яё0-9]+/gi,"-").replace(/^-|-$/g,"").slice(0,72)||"item";}
function displaySections(ch){
  const base=ch.sections.filter((s)=>isAdmin()||!["1.3","2.2.1"].includes(s.id));
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
  const p={id,name,article:opts.article||find(/^Артикул$/i),type:opts.type||find(/^(Тип|Тип оборудования|Категория)$/i),purpose:opts.purpose||find(/^Назначение$/i),detailFields:f,advantages:opts.advantages||[],substances:opts.substances||[],indicators:opts.indicators||[],options:opts.options||[],variants:opts.variants||[],complectation:opts.complectation||[],workflow:opts.workflow||[],calibration:opts.calibration||[],assortment:opts.assortment||[],consumables:opts.consumables||[],testKits:opts.testKits||[],washCycle:opts.washCycle||[],customTabs:opts.customTabs||[]};
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
  const out={fields:[],indicators:[],options:[],variants:[],calibration:[],equipment:[],advantages:[],customTabs:[]};
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
    out[mode].push(pair);
  }
  for(const k of ["fields","indicators","options","variants","calibration","equipment","advantages"])out[k]=uniquePairs(out[k]);
  out.customTabs=out.customTabs.map((t)=>({...t,rows:uniquePairs(t.rows)})).filter((t)=>t.rows.length);
  return out;
}
function unisensorImage(name){
  const n=String(name||"").toLowerCase();
  const imgs=state.assets.sectionImages?.["2.1.2"]||[];
  const key=n.includes("aflasensor")?"aflasensor":n.includes("cowsensor")?"cowsensor":n.includes("aminosensor")?"aminosensor":n.includes("milksensor")?"milksensor":n.includes("quinosensor")?"quinosensor":n.includes("sulfasensor")?"sulfasensor":n.includes("tylosensor")?"tylosensor":"";
  return key?(imgs.find((x)=>x.toLowerCase().includes(key))||""):"";
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
    const img=unisensorImage(marker);
    registerCatalog("2.1.2",cleanName,parsed.fields,img?[img]:[],{advantages:parsed.advantages,substances:parsed.substances});
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
  const compMilk=[],compMeat=[],workMilk=[],workMeat=[],calibration=[],advantages=[],substances=[];let mode="",sub="";
  for(const r of rows){
    const a=String(r[0]||"").trim(),v=String(r[1]||"").trim();
    if(a==="КОМПЛЕКТАЦИЯ"){mode="comp";sub="";continue}
    if(a==="ПОРЯДОК РАБОТЫ"){mode="workflow";sub="";continue}
    if(a==="КАЛИБРОВКА"){mode="cal";continue}
    if(a==="ПРЕИМУЩЕСТВА И ПРАКТИЧЕСКОЕ ЗНАЧЕНИЕ"){mode="adv";continue}
    if(a.startsWith("ТАБЛИЦА ЧУВСТВИТЕЛЬНОСТИ EXTENSO")){mode="sens";continue}
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
    }else if(mode==="sens"){
      const group=String(r[1]||"").trim(),name=String(r[2]||"").trim(),ppb=String(r[3]||"").trim();
      if(name&&ppb&&!/Определяемое вещество/i.test(name))substances.push({group,substance:name,ppb});
    }
  }
  const customTabs=[
    {id:"extMilk",label:"EXTENSO для молока",kind:"pairs",rows:milk},
    {id:"extMeat",label:"EXTENSO для мяса",kind:"pairs",rows:meat},
    {id:"compMilk",label:"Комплектация · молоко",kind:"pairs",rows:compMilk},
    {id:"compMeat",label:"Комплектация · мясо",kind:"pairs",rows:compMeat},
    {id:"workMilk",label:"Порядок работы · молоко",kind:"steps",rows:workMilk},
    {id:"workMeat",label:"Порядок работы · мясо",kind:"steps",rows:workMeat}
  ];
  return {fields,customTabs,calibration,advantages,substances};
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
  const fourImages={
    "4SENSOR KIT 060":"img/photos/02-testy-4-gruppy/02-ekspress-test-4sensor.png",
    "4SENSOR SENSITIVE":"img/photos/02-testy-4-gruppy/02-ekspress-test-4sensor-sensitive.png",
    "ANKAR MILK TEST 4":"img/photos/02-testy-4-gruppy/02-ekspress-test-ankar-milk-test.png",
    "GARANT 4 ULTRA MILK":"img/photos/02-testy-4-gruppy/02-ekspress-test-garant-4-utra-milk.png"
  };
  fourStarts.forEach((st,i)=>{
    const marker=String(fr[st]?.[0]||"").trim(),parsed=parseParallelProduct(fr,st,fourStarts[i+1]??fr.length);
    registerCatalog("2.1.1",parsed.name||marker,parsed.fields,fourImages[marker]?[fourImages[marker]]:[],{
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
      type:"Анализатор качества молока",indicators:x.indicators,options:x.options,variants:x.variants,
      calibration:x.calibration,advantages:x.advantages,customTabs
    });
  }
  for(const child of ch.sections.filter((s)=>s.id.startsWith("2.7."))){
    const x=parseAnalyzerRaw(child),fields=uniquePairs(x.fields);
    const customTabs=[...(x.customTabs||[]),...(x.equipment.length?[{id:"equipment-"+safeSlug(child.id),label:"Оснащение",kind:"pairs",rows:x.equipment}]:[])];
    registerCatalog("2.7",child.title,fields,state.assets.sectionImages?.[child.id]||[],{
      type:"Анализатор соматических клеток",indicators:x.indicators,options:x.options,variants:x.variants,
      calibration:x.calibration,advantages:x.advantages,customTabs
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
    const normRows=norms>=0?sourcePairs(rows.slice(norms+1),{keepSingles:true}):[];
    const customTabs=[];
    if(luciRows.length)customTabs.push({id:"luci",label:"LuciPac A3",kind:"pairs",rows:luciRows});
    if(normRows.length)customTabs.push({id:"rlu",label:"Интерпретация RLU",kind:"pairs",rows:normRows});
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
function renderCatalogSection(ch,s){
  const items=state.sectionCatalog.get(s.id)||[];
  const sourceSections=s.composite?ch.sections.filter(x=>x.id.startsWith(s.id+".")):[ch.sections.find(x=>x.id===s.id)||s];
  const sourceHtml=sourceSections.map(x=>'<section class="catalog-source"><div class="section-heading compact"><div><span class="eyebrow">'+esc(x.id)+'</span><h2>'+esc(x.title)+'</h2></div></div>'+sectionSupplement(x)+'</section>').join("");
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title}])+
    '<div class="page-head"><div><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>'+esc(s.title)+'</h1><p>'+items.length+' карточек</p></div></div>'+
    (items.length?'<div class="filter-row"><input class="filter-input" id="sectionFilter" type="search" placeholder="Поиск внутри раздела…"></div><section class="product-grid" id="sectionProducts">'+items.map(card).join("")+'</section>':'<div class="empty-state"><strong>Карточки готовятся</strong></div>')+sourceHtml;
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
function sectionSupplement(s){
  const blocks=[];
  for(const t of s.tables||[]){
    if(!t?.rows?.length)continue;
    blocks.push('<details class="section-reference"><summary><span><strong>'+esc(t.title||"Справочная таблица")+'</strong><small>'+t.rows.length+' строк</small></span><b>+</b></summary><div class="section-reference-body"><div class="table-wrap"><table class="data-table"><thead><tr>'+(t.headers||[]).map((h)=>'<th>'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+t.rows.map((r)=>'<tr>'+r.map((v)=>'<td>'+esc(v)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div></div></details>');
  }
  if(s.notes?.length){
    blocks.push('<section class="section-notes"><div class="section-heading compact"><div><span class="eyebrow">Справочно</span><h2>Дополнительная информация</h2></div></div><dl class="feature-definition-list">'+s.notes.map((n,i)=>'<dt>Материал '+(i+1)+'</dt><dd>'+esc(n)+'</dd>').join("")+'</dl></section>');
  }
  const raw=rawTables(s);if(raw)blocks.push(raw);
  return blocks.join("");
}
function deepCopy(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function mapData(){
  state.products.clear();state.sections.clear();state.chapters.clear();state.sectionCatalog.clear();
  state.editorBase={products:new Map(),images:new Map(),sections:new Map(),chapters:new Map()};
  const ov=state.overrides||{};
  state.book.chapters.forEach((ch)=>{
    state.editorBase.chapters.set(ch.id,{title:ch.title});
    if(ov.chapters?.[ch.id]?.title!==undefined)ch.title=String(ov.chapters[ch.id].title||"");
    state.chapters.set(ch.id,ch);
    ch.sections.forEach((s)=>{
      state.editorBase.sections.set(s.id,{title:s.title,notes:deepCopy(s.notes||[]),pairs:deepCopy(s.pairs||[]),tables:deepCopy(s.tables||[])});
      const sov=ov.sections?.[s.id];
      if(sov){for(const [k,v] of Object.entries(sov)){if(!["id","gid","products","rawRows","packedRows"].includes(k))s[k]=deepCopy(v);}}
      state.sections.set(s.id,{chapter:ch,section:(ch.id==="2"&&s.id==="2.13"?{...s,title:state.overrides?.sections?.["2.13"]?.title||"Тест-пластины KangarooSci"}:s)});
      (s.products||[]).forEach((p)=>state.products.set(p.id,{chapter:ch,section:s,product:p}));
    });
    if(ch.id==="2"){
      state.sections.set("2.6",{chapter:ch,section:{id:"2.6",title:ov.sections?.["2.6"]?.title||"Анализаторы качества молока",composite:true}});
      state.sections.set("2.7",{chapter:ch,section:{id:"2.7",title:ov.sections?.["2.7"]?.title||"Анализаторы соматических клеток",composite:true}});
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
  for(const [id,x] of state.products){const p=x.product;out.push({id,section:x.section.id,chapter:x.chapter.id,name:p.name||"",article:p.article||"",text:[p.name,p.article,p.type,p.purpose,p.features,p.manufacturer,p.country,JSON.stringify(p.detailFields||[]),JSON.stringify(p.advantages||[]),JSON.stringify(p.indicators||[]),JSON.stringify(p.substances||[])].filter(Boolean).join(" ")});}
  return out;
}
function installEditorApi(){
  window.KB_EDITOR_API={
    current(){
      const r=route();
      if(r.name==="product"){
        const x=ctx(r.id);if(!x)return {kind:"none"};
        return {kind:"product",id:r.id,product:deepCopy(x.product),sourceProduct:deepCopy(state.editorBase.products.get(r.id)||{}),images:deepCopy(state.assets.productImages?.[r.id]||[]),sourceImages:deepCopy(state.editorBase.images.get(r.id)||[]),tabs:productTabs(x.product),section:{id:x.section.id,title:x.section.title,gid:x.section.gid||null},chapter:{id:x.chapter.id,title:x.chapter.title},spreadsheetId:state.book.spreadsheetId};
      }
      if(r.name==="section"){
        const x=state.sections.get(r.id);if(!x)return {kind:"none"};
        const base=state.editorBase.sections.get(r.id)||{title:x.section.title};
        return {kind:"section",id:r.id,section:deepCopy(x.section),sourceSection:deepCopy(base),chapter:{id:x.chapter.id,title:x.chapter.title},spreadsheetId:state.book.spreadsheetId};
      }
      if(r.name==="chapter"){
        const ch=state.chapters.get(r.id);return ch?{kind:"chapter",id:r.id,chapter:deepCopy(ch),sourceChapter:deepCopy(state.editorBase.chapters.get(r.id)||{title:ch.title}),spreadsheetId:state.book.spreadsheetId}:{kind:"none"};
      }
      return {kind:"dashboard",spreadsheetId:state.book.spreadsheetId};
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
function card(x){
  const p=x.product, images=state.assets.productImages?.[p.id]||[], im=images[0]||"", a=article(p);
  return '<article class="product-card"><div class="product-image '+(im?"":"placeholder")+'" '+(im?'data-open-product="'+esc(p.id)+'"':"")+'>'+(im?'<img src="./'+esc(im)+'" loading="lazy" alt="'+esc(p.name)+'">':"")+(images.length>1?'<span class="photo-count">◫ '+images.length+'</span>':"")+'</div><div class="product-body"><div class="product-meta">'+(a?'<span class="badge article">Арт. '+esc(a)+'</span>':"")+(p.type?'<span class="badge">'+esc(p.type)+'</span>':"")+'</div><h3>'+esc(p.name)+'</h3>'+(p.purpose?'<p>'+esc(p.purpose)+'</p>':"")+'<div class="product-actions"><button class="btn primary" data-open-product="'+esc(p.id)+'">Подробнее</button><button class="btn icon '+(favorites.has(p.id)?"active":"")+'" data-fav="'+esc(p.id)+'" aria-label="Избранное">★</button><button class="btn icon '+(comparison.has(p.id)?"active":"")+'" data-compare="'+esc(p.id)+'" aria-label="Сравнить">⇄</button></div></div></article>';
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
  return '<section class="visual-catalog"><div class="section-heading compact"><div><span class="eyebrow">Позиции раздела</span><h2>Товары и оборудование</h2></div><p>'+images.length+' фото</p></div><div class="visual-grid">'+images.map((im)=>'<article class="visual-card"><button class="visual-image" type="button" data-lightbox-src="./'+esc(im)+'"><img src="./'+esc(im)+'" loading="lazy" alt="'+esc(visualTitle(im))+'"></button><div class="visual-body"><span class="visual-kicker">'+esc(s.id)+'</span><h3>'+esc(visualTitle(im))+'</h3><p>Фото относится к этой конкретной позиции. Характеристики и справочные данные собраны ниже.</p></div></article>').join("")+'</div></section>';
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
function rawTables(s){
  let inner="";
  (s.tables||[]).forEach((t)=>{
    inner+='<section class="raw-table-block"><h3>'+esc(t.title||"Дополнительные данные")+'</h3><div class="table-wrap"><table class="data-table"><thead><tr>'+((t.headers||[]).map((h)=>'<th>'+esc(h)+'</th>').join(""))+'</tr></thead><tbody>'+((t.rows||[]).map((r)=>'<tr>'+r.map((v)=>'<td>'+esc(v)+'</td>').join("")+'</tr>').join(""))+'</tbody></table></div></section>';
  });
  const sourceRows=(s.rawRows?.length?s.rawRows:s.rows)||[];
  if(sourceRows.length){
    const cols=Math.max(1,...sourceRows.map((r)=>r.length));
    inner+='<section class="raw-table-block"><h3>Все строки Google Sheets</h3><div class="table-wrap"><table class="data-table"><tbody>'+sourceRows.map((r)=>'<tr>'+Array.from({length:cols},(_,i)=>'<td>'+esc(r[i]||"")+'</td>').join("")+'</tr>').join("")+'</tbody></table></div></section>';
  }
  if(s.packedRows?.length){
    inner+='<section class="raw-table-block"><h3>Исходные многострочные блоки</h3><div class="table-wrap"><table class="data-table"><tbody>'+s.packedRows.map((x)=>'<tr><th>Строка '+esc(x.sourceRow)+'</th>'+(x.cells||[]).map((v)=>'<td class="multiline-source">'+esc(v).replace(/\n/g,"<br>")+'</td>').join("")+'</tr>').join("")+'</tbody></table></div></section>';
  }
  if(!inner)return "";
  return '<details class="raw-details"><summary><span><strong>Полные табличные данные</strong><small>Открыть исходные таблицы и служебные материалы раздела</small></span><b>+</b></summary><div class="raw-details-body">'+inner+'</div></details>';
}
function sectionContent(s){return knowledgeCards(s)+rawTables(s);}

function renderHome(){
  title("");
  const recentItems=recent.get().map(ctx).filter(Boolean).slice(0,6);
  const photoProducts=Object.keys(state.assets.productImages||{}).length;
  app.innerHTML='<section class="hero"><div class="hero-copy"><span class="eyebrow">TIAN-Трейд · внутренняя база знаний</span><h1>Вся продуктовая экспертиза — в одной системе</h1><p>Поиск по ассортименту, артикулам, назначению и характеристикам. Данные автоматически собираются из рабочей Книги знаний.</p><div class="hero-actions"><button class="btn hero-btn" data-focus-search>⌕ Найти товар</button><button class="btn hero-btn secondary" data-route="favorites">★ Избранное</button></div><div class="hero-meta"><span class="hero-chip">'+state.book.chapters.length+' глав</span><span class="hero-chip">'+state.sections.size+' подразделов</span><span class="hero-chip">'+state.products.size+' карточек</span><span class="hero-chip">Обновлено '+fmtDate(state.book.generatedAt)+'</span></div></div></section><section class="stats"><div class="stat"><strong>'+state.book.chapters.length+'</strong><span>глав</span></div><div class="stat"><strong>'+state.sections.size+'</strong><span>подразделов</span></div><div class="stat"><strong>'+state.products.size+'</strong><span>структурированных карточек</span></div><div class="stat"><strong>'+photoProducts+'</strong><span>товаров с индивидуальными фото</span></div></section><section class="home-tools"><button type="button" class="home-tool" data-focus-search><span>⌕</span><strong>Глобальный поиск</strong><small>Название, артикул, назначение</small></button><button type="button" class="home-tool" data-route="compare"><span>⇄</span><strong>Сравнение товаров</strong><small>До четырёх карточек рядом</small></button><button type="button" class="home-tool" data-route="diagnostics"><span>✓</span><strong>Диагностика данных</strong><small>Фото, дубликаты и качество базы</small></button></section><div class="section-heading"><div><span class="eyebrow">Навигация</span><h2>Разделы Книги знаний</h2></div></div><section class="chapter-grid">'+state.book.chapters.map((ch)=>'<article class="chapter-card" data-num="'+esc(ch.id)+'" data-open-chapter="'+esc(ch.id)+'"><span class="chapter-num">'+esc(ch.id)+'</span><span class="chapter-arrow">↗</span><h3>'+esc(ch.title)+'</h3><p>'+ch.sections.length+' подразделов</p></article>').join("")+'</section>'+(recentItems.length?'<div class="section-heading"><div><span class="eyebrow">История</span><h2>Недавно просмотренные</h2></div></div><section class="recent-grid">'+recentItems.map(card).join("")+'</section>':"");
}
function renderImportant(title,items,foot=""){
  return '<section class="important-panel"><div class="important-icon">!</div><div><h2>'+esc(title)+'</h2><ul>'+items.map((x)=>'<li><strong>'+esc(x[0])+'</strong> '+esc(x[1])+'</li>').join("")+'</ul>'+(foot?'<p class="important-foot">'+esc(foot)+'</p>':"")+'</div></section>';
}
function renderTermsSection(ch,s){
  const important=[
    ["Сертификат или Декларация?","Не все товары требуют обязательного сертификата. Для многих достаточно декларации о соответствии. Однако именно сертификат выдается на бланке и заверяется органом по сертификации, тогда как за достоверность декларации отвечает сам заявитель. Мы поможем подобрать оптимальную схему."],
    ["Сроки действия не вечны.","Сертификаты и декларации ТР ТС/ЕАЭС обычно выдаются на срок до 5 лет. А вот свидетельства о поверке средств измерений (СИ) имеют свой межповерочный интервал — от 1 года до нескольких лет. Просроченный документ приравнивается к его отсутствию."],
    ["Территориальность.","Документы, оформленные по техническим регламентам ЕАЭС (ТР ТС), действуют на всей территории Союза: Россия, Беларусь, Казахстан, Армения, Кыргызстан. Национальные ГОСТы, например ГОСТ Р, действуют только в пределах РФ."],
    ["Метрология — это отдельный мир.","Не путайте поверку — обязательную процедуру для СИ, применяемых в сфере госрегулирования, и калибровку — добровольную процедуру для внутренних нужд. Аккредитация лаборатории подтверждает её право проводить официальные испытания."],
    ["Валидация и верификация.","Это не просто «проверки». Верификация подтверждает, что лаборатория корректно применяет методику, а валидация — что сама методика подходит для поставленной задачи и условий применения."]
  ];
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title}])+
    '<div class="page-head"><div><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>'+esc(s.title)+'</h1><p>Словарь ключевых документов, метрологических процедур и рабочих понятий.</p></div></div>'+
    '<section class="term-grid">'+(s.pairs||[]).map((x,i)=>'<article class="term-card"><div class="term-no">'+String(i+1).padStart(2,"0")+'</div><div><span class="term-label">Термин</span><h3>'+esc(x.label)+'</h3><span class="definition-label">Определение</span><p>'+esc(x.value)+'</p></div></article>').join("")+'</section>'+
    renderImportant("Важно знать перед началом оформления документов:",important)+rawTables(s);
}
function renderNormsSection(ch,s){
  const rows=(s.rawRows||s.rows||[]);
  const docs=[],units=[],reading=[],steps=[];
  let mode="";
  for(const r of rows){
    const a=String(r[0]||"").trim();
    if(a.startsWith("1.")){mode="docs";continue}
    if(a.startsWith("2.")){mode="units";continue}
    if(a.startsWith("3.")){mode="reading";continue}
    if(a==="Порядок подбора товара"){mode="steps";continue}
    if(["Документ","Обозначение","Показатель / обозначение","Шаг"].includes(a))continue;
    if(!a||a.startsWith("Важно:"))continue;
    const target=mode==="docs"?docs:mode==="units"?units:mode==="reading"?reading:mode==="steps"?steps:null;
    if(target)target.push(r);
  }
  const important=[
    ["Не путайте характеристики с нормативами.","Диапазон измерения и предел обнаружения (ppb) — это возможности прибора. «Не более» и «Не менее» — это требования закона: ТР ТС, ГОСТ."],
    ["ppb = мкг/кг.","Символы < и > обозначают границы, а не точные значения."],
    ["Минимальный ppb — не панацея.","Низкий предел обнаружения по одному веществу не делает тест лучшим. Оценивайте весь спектр определяемых соединений и диапазон чувствительности."],
    ["Учитывайте матрицу и время.","Методы для молока, мяса и поверхностей различаются. Время анализа, например 5+5 мин, не включает пробоподготовку."],
    ["Комплексный подход.","Нельзя выбрать товар только по одному параметру. Учитывайте задачу, образец, норматив, методику, время и комплектацию: количество тестов и опции."]
  ];
  const cards=(arr,kind)=>'<div class="norm-grid">'+arr.map((r)=>'<article class="norm-card"><span>'+esc(kind)+'</span><h3>'+esc(r[0])+'</h3><p>'+esc(r[1]||"")+'</p>'+(r[2]?'<small>'+esc(r[2])+'</small>':"")+(r[3]?'<em>'+esc(r[3])+'</em>':"")+'</article>').join("")+'</div>';
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title}])+
    '<div class="page-head"><div><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>'+esc(s.title)+'</h1><p>Нормативные документы, единицы измерения и правила чтения характеристик — без табличной каши.</p></div></div>'+
    '<section class="knowledge-section"><div class="section-heading compact"><div><span class="eyebrow">Документы</span><h2>Нормативы</h2></div><p>'+docs.length+' позиций</p></div>'+cards(docs,"Норматив")+'</section>'+
    '<section class="knowledge-section"><div class="section-heading compact"><div><span class="eyebrow">Сокращения</span><h2>Обозначения и единицы измерения</h2></div><p>'+units.length+' терминов</p></div>'+cards(units,"Обозначение")+'</section>'+
    '<section class="knowledge-section"><div class="section-heading compact"><div><span class="eyebrow">Практика</span><h2>Как читать показатели</h2></div><p>'+reading.length+' пояснений</p></div>'+cards(reading,"Показатель")+'</section>'+
    (steps.length?'<section class="knowledge-section"><div class="section-heading compact"><div><span class="eyebrow">Алгоритм</span><h2>Порядок подбора товара</h2></div></div><div class="step-list">'+steps.map((r,i)=>'<article><b>'+esc(r[0]||String(i+1))+'</b><p>'+esc(r[1]||"")+'</p></article>').join("")+'</div></section>':"")+
    renderImportant("Важно знать перед подбором тестов и оборудования:",important,"Обратите внимание: опции, например измерение лактозы, и комплектации — 96/112/480 тестов — могут различаться. Уточняйте артикулы при заказе.")+rawTables(s);
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
  const items=(s.products||[]).map((p)=>({chapter:ch,section:s,product:p}));
  const sectionImgs=state.assets.sectionImages?.[s.id]||[];
  const subtitle=items.length?items.length+" карточек":(sectionImgs.length?sectionImgs.length+" визуальных позиций":"Справочный материал");
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title}])+
    '<div class="page-head"><div><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>'+esc(s.title)+'</h1><p>'+subtitle+'</p></div></div>'+
    (items.length?'<div class="filter-row"><input class="filter-input" id="sectionFilter" type="search" placeholder="Поиск внутри раздела…"></div><section class="product-grid" id="sectionProducts">'+grouped(items)+'</section>':visualCatalog(s,sectionImgs))+
    (items.length?sectionSupplement(s):sectionContent(s));
  if(items.length){q("#sectionFilter").addEventListener("input",(e)=>{const z=e.target.value.toLowerCase().trim();const f=items.filter((it)=>[it.product.name,it.product.article,it.product.type,it.product.purpose,it.product.features].filter(Boolean).join(" ").toLowerCase().includes(z));q("#sectionProducts").innerHTML=f.length?grouped(f):'<div class="empty-state" style="grid-column:1/-1"><strong>Ничего не найдено</strong></div>';});}
}
function fields(p){
  if(p.detailFields?.length)return p.detailFields.filter((x)=>x?.[0]&&x?.[1]);
  return [["Артикул",article(p)||"Не указан"],["Тип",p.type],["Назначение",p.purpose],["Характеристики / особенности",p.features],["Производитель",p.manufacturer],["Страна",p.country]].filter((x)=>x[1]);
}

function productTabs(p){
  let tabs=[{id:"specs",label:"Характеристики"}];
  if(p.indicators?.length)tabs.push({id:"indicators",label:"Измеряемые показатели"});
  if(p.options?.length)tabs.push({id:"options",label:"Дополнительные опции"});
  if(p.variants?.length)tabs.push({id:"variants",label:"Варианты исполнения"});
  if(p.advantages?.length)tabs.push({id:"advantages",label:/Анализатор/i.test(p.type||"")?"Особенности":"Преимущества / особенности"});
  if(p.complectation?.length)tabs.push({id:"complectation",label:"Комплектация"});
  if(p.washCycle?.length)tabs.push({id:"washCycle",label:"Рекомендуемый цикл мойки"});
  if(p.workflow?.length)tabs.push({id:"workflow",label:"Порядок работы"});
  if(p.calibration?.length)tabs.push({id:"calibration",label:"Калибровка"});
  if(p.assortment?.length)tabs.push({id:"assortment",label:"Линейка"});
  if(p.consumables?.length)tabs.push({id:"consumables",label:"Расходные материалы"});
  if(p.testKits?.length)tabs.push({id:"testKits",label:"Тест-наборы"});
  for(const t of p.customTabs||[])tabs.push({id:t.id,label:t.label});
  if(p.substances?.length)tabs.push({id:"substances",label:"Вещества и ppb"});
  const hidden=new Set(p.hiddenTabs||[]),labels=p.tabLabels||{},order=p.tabOrder||[];
  tabs=tabs.filter(t=>!hidden.has(t.id)).map(t=>({...t,label:labels[t.id]||t.label}));
  if(order.length){const rank=new Map(order.map((id,i)=>[id,i]));tabs.sort((a,b)=>(rank.has(a.id)?rank.get(a.id):999)-(rank.has(b.id)?rank.get(b.id):999));}
  return tabs;
}
function pairCards(rows,cls="feature-definition-list"){
  return '<dl class="'+cls+'">'+(rows||[]).map((r)=>'<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>').join("")+'</dl>';
}
function stepCards(rows){
  return '<dl class="feature-definition-list">'+(rows||[]).map((r,i)=>'<dt>'+esc(r[0]||("Шаг "+(i+1)))+'</dt><dd>'+esc(r[1]||"")+'</dd>').join("")+'</dl>';
}
function substanceTable(rows){
  let last="";
  return '<div class="substance-table-wrap"><table class="substance-table"><thead><tr><th>Вещество</th><th>ppb (мкг/кг)</th></tr></thead><tbody>'+(rows||[]).map((r)=>{const head=r.group&&r.group!==last?(last=r.group,'<tr class="substance-group"><td colspan="2">'+esc(r.group)+'</td></tr>'):"";return head+'<tr><td>'+esc(r.substance)+'</td><td>'+esc(r.ppb)+'</td></tr>';}).join("")+'</tbody></table></div>';
}
function tabPanelHtml(p,id){
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
  if(custom)return custom.kind==="steps"?stepCards(custom.rows||[]):pairCards(custom.rows||[]);
  if(id==="substances")return substanceTable(p.substances||[]);
  return "";
}
function renderProduct(id){
  const x=ctx(id);if(!x)return notFound();const p=x.product,s=x.section,ch=x.chapter;recent.add(p.id);counters();title(p.name);
  const imgs=state.assets.productImages?.[p.id]||[],im=imgs[0]||"",tabs=productTabs(p);
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title,route:"section",id:s.id},{label:p.name}])+'<div class="product-page"><aside class="gallery-card"><div class="gallery-topline"><span>Фотографии товара</span><b>'+(imgs.length?imgs.length:"—")+'</b></div><div class="gallery-main '+(im?"":"product-image placeholder")+'" '+(im?'data-lightbox-product="'+esc(p.id)+'" data-lightbox-index="0"':"")+'>'+(im?'<img src="./'+esc(im)+'" alt="'+esc(p.name)+'">':'<div class="gallery-empty"><img src="./assets/brand/favicon.svg" alt=""><strong>Фото пока не привязано</strong><span>Карточка уже работает; изображение появится после сопоставления в диагностике.</span></div>')+'</div>'+(imgs.length>1?'<div class="gallery-thumbs">'+imgs.map((v,i)=>'<button class="gallery-thumb '+(i===0?"active":"")+'" data-gallery-product="'+esc(p.id)+'" data-gallery-index="'+i+'"><img src="./'+esc(v)+'" alt=""></button>').join("")+'</div>':"")+'</aside><article class="info-card"><span class="eyebrow">'+esc(s.id)+' · '+esc(s.title)+'</span><h1 class="product-title">'+esc(p.name)+'</h1><div class="product-meta">'+(article(p)?'<span class="badge article">Арт. '+esc(article(p))+'</span>':"")+(p.type?'<span class="badge">'+esc(p.type)+'</span>':"")+'</div>'+(p.purpose?'<p class="product-lead">'+esc(p.purpose)+'</p>':"")+'<div class="quick-actions"><button class="btn '+(favorites.has(p.id)?"active":"")+'" data-fav="'+esc(p.id)+'">★ '+(favorites.has(p.id)?"В избранном":"В избранное")+'</button><button class="btn '+(comparison.has(p.id)?"active":"")+'" data-compare="'+esc(p.id)+'">⇄ '+(comparison.has(p.id)?"Добавлено":"Сравнить")+'</button><button class="btn ghost" data-copy>⌁ Скопировать ссылку</button></div><div class="tabs product-tabs">'+tabs.map((t,i)=>'<button class="tab '+(i===0?"active":"")+'" data-product-tab="'+esc(t.id)+'">'+esc(t.label)+'</button>').join("")+'</div><div class="product-tab-panels">'+tabs.map((t,i)=>'<div class="tab-panel" data-product-panel="'+esc(t.id)+'" '+(i===0?"":"hidden")+'>'+tabPanelHtml(p,t.id)+'</div>').join("")+'</div></article></div>';
}
function renderFavorites(){
  const items=favorites.get().map(ctx).filter(Boolean);title("Избранное");
  app.innerHTML=crumb([{label:"Избранное"}])+'<div class="page-head"><div><span class="eyebrow">Персональная подборка</span><h1>Избранное</h1><p>'+items.length+' карточек</p></div>'+(items.length?'<div class="page-tools"><button class="btn ghost" data-clear-favorites>Очистить</button></div>':"")+'</div>'+(items.length?'<section class="product-grid">'+items.map(card).join("")+'</section>':'<div class="empty-state"><strong>Здесь пока пусто</strong><p>Нажимайте ★ на нужных товарах.</p></div>');
}
function renderCompare(){
  const items=comparison.get().map(ctx).filter(Boolean);title("Сравнение");
  const rows=[["Артикул",(x)=>article(x.product)||"—"],["Тип",(x)=>x.product.type||"—"],["Назначение",(x)=>x.product.purpose||"—"],["Характеристики",(x)=>x.product.features||"—"]];
  app.innerHTML=crumb([{label:"Сравнение"}])+'<div class="page-head"><div><span class="eyebrow">До 4 товаров</span><h1>Сравнение</h1><p>'+items.length+' выбрано</p></div>'+(items.length?'<div class="page-tools"><button class="btn ghost" data-clear-compare>Очистить</button></div>':"")+'</div>'+(items.length?'<div class="table-wrap"><table class="compare-table"><thead><tr><th>Параметр</th>'+items.map((x)=>'<th class="compare-product-head"><strong>'+esc(x.product.name)+'</strong><small>'+esc(x.section.id)+' · '+esc(x.section.title)+'</small><button class="btn ghost" data-compare="'+esc(x.product.id)+'">Убрать</button></th>').join("")+'</tr></thead><tbody>'+rows.map((r)=>{const vals=items.map(r[1]),diff=new Set(vals).size>1;return '<tr class="'+(diff?"compare-diff":"")+'"><td><strong>'+esc(r[0])+'</strong></td>'+vals.map((v)=>'<td>'+esc(v)+'</td>').join("")+'</tr>';}).join("")+'</tbody></table></div>':'<div class="empty-state"><strong>Выберите товары для сравнения</strong><p>На карточках нажимайте ⇄.</p></div>');
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
  if(r.name==="home")renderHome();else if(r.name==="chapter")renderChapter(r.id);else if(r.name==="section")renderSection(r.id);else if(r.name==="product")renderProduct(r.id);else if(r.name==="favorites")renderFavorites();else if(r.name==="compare")renderCompare();else if(r.name==="diagnostics")renderDiagnostics();else notFound();
  activeNav();counters();window.scrollTo(0,0);
}
function searchRender(v){
  const list=state.search(v,20);if(!v.trim()){searchPanel.hidden=true;return;}searchPanel.hidden=false;
  searchPanel.innerHTML=list.length?list.map((x)=>'<div class="search-result" data-search-id="'+esc(x.id)+'"><div><strong>'+esc(x.name)+'</strong><small>'+esc(x.section)+' · '+esc(state.sections.get(x.section)?.section.title||"")+'</small></div>'+(x.article?'<span class="article">'+esc(x.article)+'</span>':"")+'</div>').join(""):'<div class="search-empty">По запросу ничего не найдено</div>';
}
function bind(){
  window.addEventListener("hashchange",render);
  q("#brandHome").onclick=()=>go("home");q("#favoritesBtn").onclick=()=>go("favorites");q("#compareBtn").onclick=()=>go("compare");
  q("#versionLogBtn").onclick=()=>openVersionLog();
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
    const c=e.target.closest("[data-compare]");if(c){const z=comparison.toggle(c.dataset.compare);if(z.limit){toast("Можно сравнить максимум 4 товара");return;}render();return;}
    if(e.target.closest("[data-clear-favorites]")){favorites.clear();render();return;}
    if(e.target.closest("[data-clear-compare]")){comparison.clear();render();return;}
    if(e.target.closest("[data-copy]")){navigator.clipboard?.writeText(location.href).then(()=>toast("Ссылка скопирована"));return;}
    const pt=e.target.closest("[data-product-tab]");if(pt){const id=pt.dataset.productTab;document.querySelectorAll("[data-product-tab]").forEach((x)=>x.classList.toggle("active",x===pt));document.querySelectorAll("[data-product-panel]").forEach((x)=>x.hidden=x.dataset.productPanel!==id);return;}
    const g=e.target.closest("[data-gallery-product]");if(g){const x=ctx(g.dataset.galleryProduct),imgs=x?state.assets.productImages?.[x.product.id]||[]:[],i=Number(g.dataset.galleryIndex||0),m=q(".gallery-main");if(m&&imgs[i]){m.innerHTML='<img src="./'+esc(imgs[i])+'" alt="'+esc(x.product.name)+'">';m.dataset.lightboxProduct=x.product.id;m.dataset.lightboxIndex=String(i);}document.querySelectorAll(".gallery-thumb").forEach((t)=>t.classList.toggle("active",t===g));return;}
    const direct=e.target.closest("[data-lightbox-src]");
    if(direct){showLightbox([direct.dataset.lightboxSrc],0,direct.querySelector("img")?.alt||"");return;}
    const l=e.target.closest("[data-lightbox-product]");if(l)openLightbox(l.dataset.lightboxProduct,Number(l.dataset.lightboxIndex||0));
  });
  document.addEventListener("keydown",(e)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();searchInput.focus();}if(e.key==="Escape"){searchPanel.hidden=true;q("#lightbox").hidden=true;closeVersionLog();closeMenu();}if(!q("#lightbox").hidden&&e.key==="ArrowLeft")stepLightbox(-1);if(!q("#lightbox").hidden&&e.key==="ArrowRight")stepLightbox(1);});
  q("#lightbox .lightbox-close").onclick=()=>q("#lightbox").hidden=true;
  q("#lightbox .lightbox-prev").onclick=()=>stepLightbox(-1);
  q("#lightbox .lightbox-next").onclick=()=>stepLightbox(1);
  q("#lightbox").onclick=(e)=>{if(e.target===q("#lightbox"))q("#lightbox").hidden=true;};
}
function openVersionLog(){
  const modal=q("#versionModal"),box=q("#versionEntries");
  box.innerHTML=(state.versionLog.entries||[]).map((e,i)=>'<article class="version-entry '+(i===0?"latest":"")+'"><div class="version-meta"><strong>v'+esc(e.version)+'</strong><span>'+esc(e.date)+'</span>'+(i===0?'<b>Текущая</b>':"")+'</div><h3>'+esc(e.title||"Обновление")+'</h3><ul>'+(e.changes||[]).map((x)=>'<li>'+esc(x)+'</li>').join("")+'</ul></article>').join("");
  modal.hidden=false;document.body.classList.add("modal-open");
}
function closeVersionLog(){const modal=q("#versionModal");if(modal){modal.hidden=true;document.body.classList.remove("modal-open");}}
function lightboxSrc(v){const s=String(v||"");return s.startsWith("./")?s:"./"+s;}
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
    fetch("./data/admin-overrides.json?v="+stamp,{cache:"no-store"}).catch(()=>null)
  ]);
  if(!rs[0].ok)throw new Error("Не удалось загрузить данные.");
  state.book=await rs[0].json();
  state.assets=rs[1]?.ok?await rs[1].json():state.assets;
  state.index=rs[2]?.ok?await rs[2].json():[];
  state.reports.sync=rs[3]?.ok?await rs[3].json():null;
  state.reports.images=rs[4]?.ok?await rs[4].json():null;
  state.versionLog=rs[5]?.ok?await rs[5].json():state.versionLog;
  state.overrides=rs[6]?.ok?await rs[6].json():state.overrides;
  q("#versionNumber").textContent=state.versionLog.current||"2.0";
  mapData();state.index=buildLiveSearchIndex();state.search=makeSearch(state.index);renderNav();bind();counters();installEditorApi();q("#syncState").textContent="Google Sheets · обновлено "+fmtDate(state.book.generatedAt);
  if(!location.hash)go("home");else render();
}
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));}
init().catch((e)=>{console.error(e);app.innerHTML='<div class="empty-state"><strong>Ошибка загрузки</strong><p>'+esc(e.message)+'</p><button class="btn primary" onclick="location.reload()">Повторить</button></div>';});
