const LOCAL_KEY="kb_admin_overrides_local";
const LIVE_KEY="kb_live_sheet_snapshots";
const ADMIN_SESSION_KEY="kb_admin";
const GITHUB_TOKEN_KEY="kb_github_token";
const ADMIN_PASSWORD_HASH="f40616bfaf4c1e0631d206330ead19b861546d0400b3f9be0589dbadc985ad8e";
const GITHUB_REPO="surniiyka-cloud/kniga_znaniy";
const GITHUB_BRANCH="main";
let overrideCache=null;
let repoWriteQueue=Promise.resolve();

const esc=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const deep=(v)=>v==null?v:JSON.parse(JSON.stringify(v));
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const safe=(v)=>String(v||"item").toLowerCase().replace(/[^a-zа-яё0-9._-]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,90)||"item";

function emptyOverrides(){return {version:1,updatedAt:null,products:{},sections:{},chapters:{}}}
async function loadOverrides(force=false){
  // Никогда не отдаём наружу сам overrideCache: формы редактируют возвращённый объект
  // до commitOverrides(). Если вернуть ссылку на кэш, baseline тоже незаметно меняется,
  // three-way merge считает, что изменений нет, и в GitHub уходит только updatedAt.
  if(overrideCache&&!force)return deep(overrideCache);
  const published=deep(window.KB_EDITOR_API?.overrides?.()||emptyOverrides());
  // Полный каталог может быть больше квоты localStorage, поэтому черновик overrides
  // больше не хранится целиком в браузере. Источником после сохранения остаётся GitHub.
  try{localStorage.removeItem(LOCAL_KEY)}catch{}
  overrideCache=published;
  overrideCache ||= emptyOverrides();
  overrideCache.products ||= {};
  overrideCache.sections ||= {};
  overrideCache.chapters ||= {};
  return deep(overrideCache);
}
async function sha256(v){
  const bytes=new TextEncoder().encode(String(v||"")),hash=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function adminActive(){try{return sessionStorage.getItem(ADMIN_SESSION_KEY)==="1"}catch{return false}}
async function requireAdmin(){
  if(adminActive())return true;
  const password=prompt("Введите пароль администратора");
  if(password==null)return false;
  if(await sha256(password)!==ADMIN_PASSWORD_HASH){alert("Неверный пароль.");return false}
  sessionStorage.setItem(ADMIN_SESSION_KEY,"1");
  window.dispatchEvent(new CustomEvent("kb:admin-change"));
  return true;
}
function sessionToken(){try{return sessionStorage.getItem(GITHUB_TOKEN_KEY)||""}catch{return ""}}
async function githubFetch(path,options={}){
  const token=sessionToken();if(!token)throw new Error("Сначала подключите GitHub в панели редактора.");
  const res=await fetch("https://api.github.com/repos/"+GITHUB_REPO+path,{
    ...options,
    headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:"Bearer "+token,...(options.headers||{})}
  });
  if(!res.ok){
    let msg="GitHub HTTP "+res.status,details=null;
    try{details=await res.json();if(details?.message)msg+=" · "+details.message}catch{}
    const err=new Error(msg);err.status=res.status;err.github=details;throw err;
  }
  return res.status===204?null:res.json();
}
async function connectGithub(){
  let token=sessionToken();
  if(!token){
    token=(prompt("GitHub token с доступом Contents: Read and write к репозиторию kniga_znaniy. Токен хранится только до закрытия этой вкладки.")||"").trim();
    if(!token)return false;
    sessionStorage.setItem(GITHUB_TOKEN_KEY,token);
  }
  try{await githubFetch("");return true}catch(e){sessionStorage.removeItem(GITHUB_TOKEN_KEY);throw e}
}
function utf8Base64(text){
  const bytes=new TextEncoder().encode(text);let bin="";for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(bin);
}
function base64Utf8(value){
  const bin=atob(String(value||"").replace(/\\s+/g,"")),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function bytesBase64(buffer){
  const bytes=new Uint8Array(buffer);let bin="";for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(bin);
}
async function repoFile(path){
  try{
    const cacheBust=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
    const endpoint="/contents/"+path.split("/").map(encodeURIComponent).join("/")+"?ref="+encodeURIComponent(GITHUB_BRANCH)+"&cb="+cacheBust;
    return await githubFetch(endpoint,{cache:"no-store"});
  }catch(e){if(/404/.test(e.message))return null;throw e}
}
function queuedRepoWrite(fn){
  const run=repoWriteQueue.then(fn,fn);
  repoWriteQueue=run.catch(()=>{});
  return run;
}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function putRepoContent(path,content,message){
  if(!sessionToken())await connectGithub();
  const endpoint="/contents/"+path.split("/").map(encodeURIComponent).join("/");
  let lastErr=null;
  for(let attempt=0;attempt<4;attempt++){
    const cur=await repoFile(path),body={message,content,branch:GITHUB_BRANCH};
    if(cur?.sha)body.sha=cur.sha;
    try{
      return await githubFetch(endpoint,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    }catch(err){
      lastErr=err;
      if(err?.status!==409)throw err;
      await wait(250*(attempt+1));
    }
  }
  throw lastErr||new Error("Не удалось сохранить файл после нескольких попыток.");
}
async function putRepoText(path,text,message){
  return queuedRepoWrite(()=>putRepoContent(path,utf8Base64(text),message));
}
async function putRepoBinary(path,buffer,message){
  return queuedRepoWrite(()=>putRepoContent(path,bytesBase64(buffer),message));
}
async function deleteRepoFile(path,message){
  return queuedRepoWrite(async()=>{
    if(!sessionToken())await connectGithub();
    const endpoint="/contents/"+path.split("/").map(encodeURIComponent).join("/");
    let lastErr=null;
    for(let attempt=0;attempt<4;attempt++){
      const cur=await repoFile(path);if(!cur?.sha)return;
      try{
        return await githubFetch(endpoint,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,sha:cur.sha,branch:GITHUB_BRANCH})});
      }catch(err){
        lastErr=err;if(err?.status!==409)throw err;await wait(180*(attempt+1));
      }
    }
    throw lastErr||new Error("Не удалось удалить файл после нескольких попыток.");
  });
}
async function publishLiveSnapshots(sectionIds=null){
  let local=window.KB_EDITOR_API?.liveSnapshots?.()||{};
  if(!local||typeof local!=="object"||Array.isArray(local)){try{local=JSON.parse(localStorage.getItem(LIVE_KEY)||"{}")||{}}catch{local={}}}
  const path="data/live-sheet-snapshots.json";
  const cur=await repoFile(path);
  let remote={};
  if(cur?.content){
    try{remote=JSON.parse(base64Utf8(cur.content))||{}}catch{remote={}}
  }
  const ids=[...(Array.isArray(sectionIds)?sectionIds:String(sectionIds||"").split(",")).map(x=>String(x).trim()).filter(Boolean)];
  const merged=ids.length?{...remote,...Object.fromEntries(ids.filter(id=>local[id]).map(id=>[id,local[id]]))}:local;
  await putRepoText(path,JSON.stringify(merged,null,2)+"\n","Admin: publish refreshed Google Sheets snapshots");
}
function isPlainObject(v){return !!v&&typeof v==="object"&&!Array.isArray(v)}
function threeWayApply(base,next,remote){
  if(same(base,next))return deep(remote);
  if(isPlainObject(base)&&isPlainObject(next)){
    const out=isPlainObject(remote)?deep(remote):{};
    const keys=new Set([...Object.keys(base||{}),...Object.keys(next||{})]);
    for(const key of keys){
      const had=Object.prototype.hasOwnProperty.call(next,key);
      if(!had){if(!same(base?.[key],undefined))delete out[key];continue}
      if(same(base?.[key],next[key]))continue;
      out[key]=threeWayApply(base?.[key],next[key],out?.[key]);
    }
    return out;
  }
  return deep(next);
}
async function commitOverrides(data){
  data.version=1;
  if(!sessionToken())await connectGithub();

  // Вкладка редактора может быть открыта часами, а admin-overrides.json за это время
  // изменяется другим пользователем/сессией. Никогда не публикуем старый снимок целиком:
  // берём свежую версию GitHub и накладываем только изменения текущей сессии.
  const baseline=deep(overrideCache||emptyOverrides());
  const cur=await repoFile("data/admin-overrides.json");
  let remote=emptyOverrides();
  if(cur?.content){try{remote=JSON.parse(base64Utf8(cur.content))||emptyOverrides()}catch{}}
  const merged=threeWayApply(baseline,data,remote);
  merged.version=1;merged.updatedAt=new Date().toISOString();

  await putRepoText("data/admin-overrides.json",JSON.stringify(merged,null,2)+"\n","Admin: update knowledge book");
  try{localStorage.removeItem(LOCAL_KEY)}catch{}
  overrideCache=deep(merged);
  return merged;
}

function pairText(arr){return (arr||[]).map(r=>[r?.[0]||"",r?.[1]||""].join(" | ")).join("\n")}
function parsePairs(text){
  const out=[];for(const line of String(text||"").split(/\r?\n/)){
    const s=line.trim();if(!s)continue;const i=s.indexOf("|");
    if(i<0)out.push([s,""]);else out.push([s.slice(0,i).trim(),s.slice(i+1).trim()]);
  }return out.filter(r=>r[0]||r[1]);
}
function substancesText(arr){return (arr||[]).map(r=>[r?.group||"",r?.substance||"",r?.ppb||""].join(" | ")).join("\n")}
function parseSubstances(text){
  const out=[];for(const line of String(text||"").split(/\r?\n/)){
    if(!line.trim())continue;const p=line.split("|").map(x=>x.trim());
    out.push({group:p[0]||"",substance:p[1]||"",ppb:p.slice(2).join(" | ").trim()});
  }return out.filter(x=>x.substance||x.group||x.ppb);
}
function linesText(arr){return (arr||[]).join("\n")}
function parseLines(text){return String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean)}
function foundationBodyText(arr){return (arr||[]).join("\n\n")}
function parseFoundationBody(text){return String(text||"").split(/\n\s*\n/).map(x=>x.replace(/\s*\n\s*/g," ").trim()).filter(Boolean)}
function foundationResourcesText(arr){return (arr||[]).map(r=>[r?.label||"",r?.href||""].join(" | ")).join("\n")}
function parseFoundationResources(text){
  const out=[];
  for(const line of String(text||"").split(/\r?\n/)){
    const s=line.trim();if(!s)continue;
    const i=s.indexOf("|");const label=i>=0?s.slice(0,i).trim():s;const href=i>=0?s.slice(i+1).trim():"";
    if(label&&href)out.push({label,href});
  }
  return out;
}
function foundationRelatedText(arr){return (arr||[]).map(r=>[r?.term||"",r?.label||""].join(" | ")).join("\n")}
function parseFoundationRelated(text){
  const out=[];
  for(const line of String(text||"").split(/\r?\n/)){
    const s=line.trim();if(!s)continue;
    const p=s.split("|").map(x=>x.trim()),term=Number(p[0]||0),label=p.slice(1).join(" | ").trim();
    if(term&&label)out.push({label,term});
  }
  return out;
}
function jsonText(v){return JSON.stringify(v??{},null,2)}
function tableText(table){
  if(!table?.headers?.length)return "";
  return [table.headers,...(table.rows||[])].map(r=>(r||[]).join(" | ")).join("\n");
}
function parseTableText(text){
  const rows=String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>line.split("|").map(x=>x.trim()));
  if(!rows.length)return null;
  const headers=rows.shift(),width=headers.length;
  return {headers,rows:rows.map(r=>Array.from({length:width},(_,i)=>r[i]||"")).filter(r=>r.some(Boolean))};
}
function emptyObject(o){return !o||Object.keys(o).length===0}

const PAIR_FIELDS=[
  ["detailFields","Характеристики"],
  ["advantages","Преимущества / особенности"],
  ["indicators","Измеряемые показатели"],
  ["options","Дополнительные опции"],
  ["variants","Варианты исполнения"],
  ["complectation","Комплектация"],
  ["calibration","Калибровка"],
  ["assortment","Линейка / ассортимент"],
  ["consumables","Расходные материалы"],
  ["testKits","Тест-наборы"],
  ["workflow","Порядок работы"],
  ["washCycle","Цикл мойки"]
];

const TAB_TO_PAIR={
  specs:"detailFields",advantages:"advantages",indicators:"indicators",options:"options",variants:"variants",
  complectation:"complectation",calibration:"calibration",assortment:"assortment",consumables:"consumables",
  testKits:"testKits",workflow:"workflow",washCycle:"washCycle"
};
function sourceRowsForTab(ctx,id){
  const key=TAB_TO_PAIR[id];
  if(key)return deep(ctx.product?.[key]||[]);
  const custom=(ctx.product?.customTabs||[]).find(t=>t.id===id);
  return deep(custom?.rows||[]);
}
function tableLabel(ctx,id){
  return (ctx.tabs||[]).find(t=>t.id===id)?.label||defaultTabLabel(id,ctx.product)||id;
}
function normalizedTabTables(ctx){
  const hasTables=Object.prototype.hasOwnProperty.call(ctx.product||{},"tabTables"),tables=deep(ctx.product?.tabTables||{});
  if(!hasTables&&ctx.product?.indicatorTable)tables.indicators=deep(ctx.product.indicatorTable);
  return tables;
}
function tableHeadersForTab(id,table,label=""){
  if(String(id)==="advantages"||/преимуществ/i.test(String(label)))return ["Преимущества","Описание"];
  return (table?.headers?.length?table.headers:["Название","Значение"]).map(x=>String(x||""));
}
function normalizeTableMergesForEditor(table,width,height){
  const out=[];
  for(const raw of Array.isArray(table?.merges)?table.merges:[]){
    const row=Math.max(0,Number(raw?.row)||0),col=Math.max(0,Number(raw?.col)||0);
    const rowspan=Math.max(1,Number(raw?.rowspan)||1),colspan=Math.max(1,Number(raw?.colspan)||1);
    if(row>=height||col>=width)continue;
    const rs=Math.min(rowspan,height-row),cs=Math.min(colspan,width-col);
    const overlaps=out.some(m=>!(row+rs<=m.row||m.row+m.rowspan<=row||col+cs<=m.col||m.col+m.colspan<=col));
    if(!overlaps&&(rs>1||cs>1))out.push({row,col,rowspan:rs,colspan:cs});
  }
  return out.sort((a,b)=>a.row-b.row||a.col-b.col);
}
function tableMergeAt(merges,row,col){
  return (merges||[]).find(m=>row>=m.row&&row<m.row+m.rowspan&&col>=m.col&&col<m.col+m.colspan)||null;
}
function tableRowHtml(row,width,rowIndex=0,merges=[]){
  const cells=[];
  for(let col=0;col<width;col++){
    const merge=tableMergeAt(merges,rowIndex,col);
    if(merge&&!(merge.row===rowIndex&&merge.col===col))continue;
    const attrs=merge?(' rowspan="'+merge.rowspan+'" colspan="'+merge.colspan+'"'):"";
    const editor=merge
      ? '<textarea data-table-cell class="kb-merged-cell-input" rows="'+Math.max(2,merge.rowspan+1)+'">'+esc(row?.[col]||"")+'</textarea>'
      : '<input data-table-cell value="'+esc(row?.[col]||"")+'">';
    cells.push('<td data-table-cell-pos="'+rowIndex+':'+col+'"'+attrs+'>'+editor+'</td>');
  }
  return '<tr data-table-row data-table-row-index="'+rowIndex+'">'+cells.join("")+'<td class="kb-row-tools"><div class="kb-row-order"><button type="button" class="kb-row-move" data-table-row-up title="Строкой выше" aria-label="Строкой выше">↑</button><button type="button" class="kb-row-move" data-table-row-down title="Строкой ниже" aria-label="Строкой ниже">↓</button></div><button type="button" class="kb-row-merge" data-table-merge-row title="Объединить всю строку" aria-label="Объединить всю строку">↔</button><button type="button" class="kb-row-remove" data-table-remove-row title="Удалить строку">×</button></td></tr>';
}
function tableEditorGridHtml(headers,rows,merges){
  const width=Math.max(1,headers.length);
  return '<table class="kb-edit-table"><thead><tr>'+headers.map((h,i)=>'<th><div class="kb-cell-head"><input data-table-header value="'+esc(h)+'"><button type="button" class="kb-col-remove" data-table-remove-col="'+i+'" title="Удалить столбец">×</button></div></th>').join("")+'<th class="kb-row-tools"></th></tr></thead><tbody>'+rows.map((r,i)=>tableRowHtml(r,width,i,merges)).join("")+'</tbody></table>';
}
function tableEditorHtml(id,label,table){
  const headers=tableHeadersForTab(id,table,label);
  const width=Math.max(1,headers.length),rows=(table?.rows||[]).map(r=>Array.from({length:width},(_,i)=>String(r?.[i]||"")));
  const merges=normalizeTableMergesForEditor(table,width,rows.length);
  return '<article class="kb-table-editor" data-table-editor data-table-id="'+esc(id)+'">'+
    '<div class="kb-table-editor-head"><div><strong>'+esc(label)+'</strong><code>'+esc(id)+'</code></div><div class="kb-table-actions"><button type="button" class="kb-mini" data-table-add-col>+ столбец</button><button type="button" class="kb-mini" data-table-add-row>+ строка</button><button type="button" class="kb-mini" data-table-merge>Объединить выбранные</button><button type="button" class="kb-mini" data-table-unmerge>Разъединить</button><button type="button" class="kb-mini danger" data-table-delete>Удалить таблицу</button></div></div>'+
    '<p class="kb-table-merge-hint">Ctrl/⌘ + клик — выбрать ячейки. ↑ ↓ меняют порядок строк. ↔ объединяет строку в примечание.</p>'+
    '<div class="kb-table-scroll">'+tableEditorGridHtml(headers,rows,merges)+'</div></article>';
}
function readTableEditor(ed){
  const headers=[...ed.querySelectorAll("[data-table-header]")].map(x=>x.value.trim());
  const width=headers.length;
  const rows=Array.from(ed.querySelectorAll("[data-table-row]")).map(tr=>{
    const row=Array(width).fill("");
    tr.querySelectorAll("[data-table-cell-pos]").forEach(td=>{
      const [r,c]=td.dataset.tableCellPos.split(":").map(Number);
      if(Number.isFinite(c)&&c<width)row[c]=td.querySelector("[data-table-cell]")?.value.trim()||"";
    });
    return row;
  });
  const merges=Array.from(ed.querySelectorAll("[data-table-cell-pos][rowspan],[data-table-cell-pos][colspan]")).map(td=>{
    const [row,col]=td.dataset.tableCellPos.split(":").map(Number);
    return {row,col,rowspan:Number(td.getAttribute("rowspan")||1),colspan:Number(td.getAttribute("colspan")||1)};
  }).filter(m=>m.rowspan>1||m.colspan>1);
  return {headers,rows,merges:normalizeTableMergesForEditor({merges},width,rows.length)};
}
function refreshTableEditor(ed,data){
  ed.querySelector(".kb-table-scroll").innerHTML=tableEditorGridHtml(data.headers,data.rows,normalizeTableMergesForEditor(data,data.headers.length,data.rows.length));
}
function selectedTableCells(ed){
  return [...ed.querySelectorAll("[data-table-cell-pos].is-selected")].map(td=>{
    const [row,col]=td.dataset.tableCellPos.split(":").map(Number);return {td,row,col};
  });
}
function mergeSelectedTableCells(ed){
  const selected=selectedTableCells(ed);
  if(selected.length<2)return showError(new Error("Выберите минимум две ячейки через Ctrl/⌘ + клик."));
  const minRow=Math.min(...selected.map(x=>x.row)),maxRow=Math.max(...selected.map(x=>x.row)),minCol=Math.min(...selected.map(x=>x.col)),maxCol=Math.max(...selected.map(x=>x.col));
  if(selected.length!==(maxRow-minRow+1)*(maxCol-minCol+1))return showError(new Error("Для объединения нужно выбрать цельный прямоугольник ячеек."));
  const current=readTableEditor(ed);
  if(current.merges.some(m=>!(maxRow+1<=m.row||m.row+m.rowspan<=minRow||maxCol+1<=m.col||m.col+m.colspan<=minCol)))return showError(new Error("В выбранной области уже есть объединённые ячейки. Сначала разъедините их."));
  current.merges.push({row:minRow,col:minCol,rowspan:maxRow-minRow+1,colspan:maxCol-minCol+1});
  refreshTableEditor(ed,current);
  ed.querySelector('[data-table-cell-pos="'+minRow+':'+minCol+'"]')?.classList.add("is-selected");
}
function unmergeSelectedTableCells(ed){
  const selected=selectedTableCells(ed);if(!selected.length)return showError(new Error("Выберите объединённую ячейку."));
  const current=readTableEditor(ed),targets=current.merges.filter(m=>selected.some(s=>s.row>=m.row&&s.row<m.row+m.rowspan&&s.col>=m.col&&s.col<m.col+m.colspan));
  if(!targets.length)return showError(new Error("В выбранной области нет объединённых ячеек."));
  current.merges=current.merges.filter(m=>!targets.includes(m));refreshTableEditor(ed,current);
}
function mergeWholeTableRow(ed,rowIndex){
  const current=readTableEditor(ed),width=current.headers.length;
  current.merges=current.merges.filter(m=>m.row!==rowIndex);
  if(width>1)current.merges.push({row:rowIndex,col:0,rowspan:1,colspan:width});
  refreshTableEditor(ed,current);
  ed.querySelector('[data-table-cell-pos="'+rowIndex+':0"]')?.classList.add("is-selected");
}
function tableEditorsHtml(ctx){
  const tables=normalizedTabTables(ctx),editors=[];
  for(const [id,table] of Object.entries(tables)){if(!table?.headers?.length)continue;editors.push(tableEditorHtml(id,tableLabel(ctx,id),table));}
  const ids=[...new Set([...(ctx.tabs||[]).map(t=>t.id),...Object.keys(tables)])].filter(id=>id!=="substances");
  const options=ids.map(id=>'<option value="'+esc(id)+'">'+esc(tableLabel(ctx,id))+'</option>').join("");
  return '<section class="kb-admin-section"><div class="kb-table-section-head"><div><h3>Таблицы во вкладках</h3><p class="kb-admin-hint">В списке только реальные вкладки этой карточки. Новая вкладка, добавленная ниже, появляется здесь сразу.</p></div><div class="kb-table-create"><select data-new-table-tab>'+options+'</select><button type="button" class="kb-admin-btn ghost" data-add-table>+ Добавить / преобразовать в таблицу</button></div></div><div data-table-editors>'+editors.join("")+'</div></section>';
}
function collectTabTables(form){
  const out={};
  form.querySelectorAll("[data-table-editor]").forEach(ed=>{
    const id=ed.dataset.tableId,data=readTableEditor(ed);
    if(id&&data.headers.some(Boolean))out[id]=data;
  });
  return out;
}

let modal=null,editorCtx=null;
function ensureUI(){
  if(!document.querySelector("#kbAdminBtn")){
    const actions=document.querySelector(".top-actions");
    if(actions){
      const b=document.createElement("button");b.id="kbAdminBtn";b.className="text-btn kb-admin-top";b.type="button";
      b.innerHTML="♙ <span>Личный кабинет</span>";b.onclick=openAdmin;actions.prepend(b);
    }
  }
  syncAccountEntry();
  if(!modal){
    modal=document.createElement("div");modal.id="kbAdminModal";modal.className="kb-admin-modal";modal.hidden=true;
    modal.innerHTML='<div class="kb-admin-backdrop" data-admin-close></div><section class="kb-admin-panel" role="dialog" aria-modal="true"><div id="kbAdminBody"></div></section>';
    document.body.appendChild(modal);
    modal.addEventListener("click",e=>{if(e.target.closest("[data-admin-close]"))closeAdmin()});
  }
}
function setBody(html){
  const isPage=["account","accountProduct","accountSection"].includes(window.KB_EDITOR_API?.route?.()?.name||"");
  if(isPage){
    const app=document.querySelector("#app");if(app){app.innerHTML='<div class="kb-admin-page">'+html+"</div>";bindBody();return}
  }
  ensureUI();modal.querySelector("#kbAdminBody").innerHTML=html;bindBody()
}
function syncAccountEntry(){
  const b=document.querySelector("#kbAdminBtn"),accountMode=["account","accountProduct","accountSection"].includes(window.KB_EDITOR_API?.route?.()?.name||"");
  if(!b)return;
  b.innerHTML=accountMode?'↩ <span>Выйти из личного кабинета</span>':'♙ <span>Личный кабинет</span>';
  b.onclick=accountMode?logoutAccount:openAdmin;
}
function openAdmin(){location.hash="#/account"}
function logoutAccount(){
  try{sessionStorage.removeItem(ADMIN_SESSION_KEY)}catch{}
  document.body.classList.remove("kb-account-mode");
  location.hash="#/home";
  window.dispatchEvent(new CustomEvent("kb:admin-change"));
}
function closeAdmin(){if(modal)modal.hidden=true;document.body.classList.remove("kb-admin-open")}
function showError(e){const box=modal?.querySelector("[data-admin-status]");if(box){box.className="kb-admin-status error";box.textContent=e?.message||String(e)}else alert(e?.message||e)}
function showStatus(t,kind="ok"){const box=modal?.querySelector("[data-admin-status]");if(box){box.className="kb-admin-status "+kind;box.textContent=t}}

function shell(title,subtitle,inner){
  const accountRoute=["account","accountProduct","accountSection"].includes(window.KB_EDITOR_API?.route?.()?.name||"");
  const productOrSection=["accountProduct","accountSection"].includes(window.KB_EDITOR_API?.route?.()?.name||"");
  const navButton=productOrSection?'<button class="kb-admin-back" type="button" data-account-back>← Вернуться в личный кабинет</button>':"";
  const version=String(document.querySelector("#versionNumber")?.textContent||"—").trim();
  return '<header class="kb-admin-head"><div><span class="kb-admin-kicker">Личный кабинет</span><h2>'+esc(title)+'</h2><p>'+esc(subtitle||"")+'</p></div>'+navButton+'</header>'+
  '<div class="kb-admin-toolbar"><button class="kb-admin-btn ghost" data-github-connect>'+(sessionToken()?'✓ GitHub подключен':'Подключить GitHub')+'</button><button class="kb-admin-btn ghost" data-admin-export>↓ Скачать резервную копию</button><label class="kb-admin-btn ghost kb-admin-import">↑ Загрузить резервную копию<input type="file" accept="application/json,.json" data-admin-import hidden></label><button class="kb-admin-btn ghost kb-admin-version" data-account-version>Версия '+esc(version)+' · что изменилось</button><button class="kb-admin-btn ghost" data-admin-logout>Выйти</button><span class="kb-admin-devnote">Каталог хранится на сайте</span></div>'+
  '<div class="kb-admin-status" data-admin-status></div>'+inner;
}
async function updateAccountCounters(body){
  const rows=[...body.querySelectorAll("[data-account-product-card]")],all=rows.length;
  const improve=rows.filter(x=>Number(x.dataset.quality||0)<75).length;
  const photo=rows.filter(x=>x.dataset.hasPhoto==="1").length;
  const tabs=[...body.querySelectorAll("[data-account-filter]")];
  for(const tab of tabs){
    const b=tab.querySelector("b");if(!b)continue;
    if(tab.dataset.accountFilter==="all")b.textContent=all;
    if(tab.dataset.accountFilter==="improve")b.textContent=improve;
    if(tab.dataset.accountFilter==="photo")b.textContent=photo;
  }
  const summary=body.querySelectorAll(".kb-market-summary>div strong");
  if(summary[0])summary[0].textContent=all;
  if(summary[1])summary[1].textContent=photo;
  if(summary[2])summary[2].textContent=improve;
}
function renderAccountPage(){
  syncAccountEntry();
  const r=window.KB_EDITOR_API?.route?.()||{name:"account"};
  if(!adminActive()){
    setBody('<div class="kb-account-login"><div class="kb-account-login-card"><span class="kb-admin-kicker">Личный кабинет</span><h1>Вход в редактор</h1><p>Здесь управляется каталог товаров и содержимое Книги знаний.</p><form data-account-login><label>Пароль<input type="password" name="password" autocomplete="current-password" autofocus></label><button class="kb-admin-btn primary" type="submit">Войти</button><p class="kb-admin-login-error" data-account-login-error></p></form></div></div>');
    return;
  }
  if(r.name==="accountProduct"||r.name==="accountSection"){renderEditor().catch(showError);return;}
  const catalog=window.KB_EDITOR_API.catalog?.()||[];
  const sections=catalog.flatMap(ch=>ch.sections.map(sec=>({...sec,chapterId:ch.id,chapterTitle:ch.title})));
  const allProducts=sections.flatMap(sec=>sec.products.map(p=>{
    const ctx=window.KB_EDITOR_API?.product?.(p.id)||null;
    return {...p,sectionId:sec.id,sectionTitle:sec.title,chapterId:sec.chapterId,ctx,quality:ctx?productQuality(ctx):0,image:ctx?.images?.[0]||""};
  }));
  const improve=allProducts.filter(p=>p.quality<75).length;
  const withPhoto=allProducts.filter(p=>p.image).length;
  const html=shell("Товары","Управление карточками каталога",
    '<div class="kb-market-dashboard">'+
      '<div class="kb-market-tabs"><button type="button" class="active" data-account-filter="all">Все товары <b>'+allProducts.length+'</b></button><button type="button" data-account-filter="improve">Можно улучшить <b>'+improve+'</b></button><button type="button" data-account-filter="photo">С фото <b>'+withPhoto+'</b></button></div>'+
      '<div class="kb-market-actions"><button type="button" class="kb-admin-btn primary" data-account-add-first>+ Создать карточку</button></div>'+
    '</div>'+
    '<div class="kb-market-summary"><div><strong>'+allProducts.length+'</strong><span>карточек</span></div><div><strong>'+withPhoto+'</strong><span>с фотографиями</span></div><div><strong>'+improve+'</strong><span>можно улучшить</span></div></div>'+
    '<div class="kb-account-search kb-market-search"><span>⌕</span><input type="search" data-account-search placeholder="Название, артикул или раздел…" autocomplete="off"><button type="button" class="kb-admin-btn ghost" data-account-clear>Сбросить</button></div>'+
    '<div class="kb-account-catalog kb-market-catalog">'+
    sections.map(sec=>{
      const rows=sec.products.map(p=>{
        const ctx=window.KB_EDITOR_API?.product?.(p.id)||null,q=ctx?productQuality(ctx):0,img=ctx?.images?.[0]||"";
        return '<article class="kb-account-product kb-market-row" data-account-product-card data-quality="'+q+'" data-has-photo="'+(img?"1":"0")+'" data-account-product-search="'+esc([p.name,p.article,sec.id,sec.title].join(" "))+'">'+
          '<label class="kb-market-check"><input type="checkbox" data-account-select-product value="'+esc(p.id)+'"></label>'+
          '<div class="kb-market-thumb '+(img?"":"empty")+'">'+(img?'<img src="'+esc(photoPreviewSrc(img))+'" loading="lazy" alt="">':'<span>TIAN</span>')+'</div>'+
          '<div class="kb-market-product-main"><strong>'+esc(p.name)+'</strong><small>'+esc(p.article?("Арт. "+p.article):"Без артикула")+'</small></div>'+
          '<div class="kb-market-section">'+esc(sec.id)+'<small>'+esc(sec.title)+'</small></div>'+
          '<div class="kb-market-quality '+(q>=80?"good":q>=55?"mid":"low")+'"><b>'+q+'%</b><span>качество</span></div>'+
          '<div class="kb-account-product-actions"><button class="kb-admin-btn ghost" data-account-edit-product="'+esc(p.id)+'">Редактировать</button><button class="kb-admin-btn ghost" title="Дублировать" data-account-duplicate-product="'+esc(p.id)+'">⧉</button><button class="kb-admin-btn danger" title="Удалить" data-account-delete-product="'+esc(p.id)+'">×</button></div>'+
        '</article>';
      }).join("");
      return '<section class="kb-account-section kb-market-section-block" data-account-section-card data-section-id="'+esc(sec.id)+'" data-account-search-text="'+esc([sec.id,sec.title,sec.chapterTitle,...sec.products.flatMap(p=>[p.name,p.article])].join(" "))+'">'+
        '<div class="kb-account-section-head"><div><span class="eyebrow">Глава '+esc(sec.chapterId)+'</span><h2>'+esc(sec.id+" "+sec.title)+'</h2><small>'+sec.products.length+' карточек</small></div>'+
        '<div class="kb-account-section-actions"><button type="button" class="kb-admin-btn ghost" data-account-manage-section="'+esc(sec.id)+'">Управление разделом</button><button type="button" class="kb-admin-btn primary" data-account-add-product="'+esc(sec.id)+'">+ Карточка</button></div></div>'+
        '<div class="kb-market-table-head"><span></span><span>Фото</span><span>Товар</span><span>Раздел</span><span>Качество</span><span>Действия</span></div>'+
        '<div class="kb-account-products">'+rows+'</div></section>';
    }).join("")+
    '</div><div class="kb-account-empty" data-account-empty hidden>По вашему запросу ничего не найдено.</div>');
  setBody(html);
}
window.KB_ADMIN_PAGE={render:()=>{try{return renderAccountPage()}catch(err){showError(err)}}};
function handleAccountRoute(){
  const name=window.KB_EDITOR_API?.route?.()?.name||"";
  if(name==="account"||name==="accountProduct"||name==="accountSection"){try{renderAccountPage()}catch(err){showError(err)}}
}
window.addEventListener("hashchange",()=>{syncAccountEntry();handleAccountRoute()});
async function renderEditor(){
  await loadOverrides(true);
  const ctx=window.KB_EDITOR_API?.current?.()||{kind:"dashboard"};
  if(ctx.kind==="product")return renderProductEditor(ctx);
  if(ctx.kind==="section")return renderSectionEditor(ctx);
  if(ctx.kind==="chapter")return renderChapterEditor(ctx);
  const sheet="";
  setBody(shell("Панель управления","Открой карточку товара, раздел или главу — и нажми «Редактор».",
    '<div class="kb-admin-dashboard"><h3>Что можно менять</h3><p>Карточки товаров, характеристики, преимущества, вкладки, группы ppb, заголовки разделов и глав. '+sheet+'</p><p>Редактор работает с опубликованной версией. Для записи изменений и загрузки фотографий подключается GitHub-токен текущей сессии; он не сохраняется в репозитории или localStorage.</p></div>'));
}
function defaultTabLabel(id,p){
  const map={specs:"Характеристики",indicators:"Измеряемые показатели",options:"Дополнительные опции",variants:"Варианты исполнения",advantages:/Анализатор/i.test(p?.type||"")?"Особенности":"Преимущества / особенности",complectation:"Комплектация",washCycle:"Рекомендуемый цикл мойки",workflow:"Порядок работы",calibration:"Калибровка",assortment:"Линейка",consumables:"Расходные материалы",testKits:"Тест-наборы",substances:"Вещества и ppb"};
  return map[id]||(p?.customTabs||[]).find(t=>t.id===id)?.label||id;
}
function customTabContentHtml(t){
  const kind=t?.kind||"pairs",rows=t?.rows||[],id=t?.id||"",label=t?.label||id;
  if(kind==="table"){
    return '<details class="kb-admin-group kb-custom-tab-content" data-custom-content-id="'+esc(id)+'" data-custom-kind="'+esc(kind)+'"><summary><span>'+esc(label)+'</span><small>таблица</small></summary><div class="kb-custom-tab-note">Содержимое этой вкладки редактируется в блоке «Таблицы во вкладках» ниже.</div><div class="kb-custom-tab-actions"><button type="button" class="kb-mini danger" data-remove-custom-tab>Удалить вкладку</button></div></details>';
  }
  return '<details class="kb-admin-group kb-custom-tab-content" data-custom-content-id="'+esc(id)+'" data-custom-kind="'+esc(kind)+'"><summary><span>'+esc(label)+'</span><small>'+rows.length+' строк</small></summary><label class="kb-admin-field"><span>Одна строка = <b>название | значение</b>. Порядок строк = порядок на сайте.</span><textarea rows="7" data-custom-tab-rows>'+esc(pairText(rows))+'</textarea></label><div class="kb-custom-tab-actions"><button type="button" class="kb-mini danger" data-remove-custom-tab>Удалить вкладку</button></div></details>';
}
function pairRowsEditorHtml(key,label,rows,headers=[]){
  const list=Array.isArray(rows)&&rows.length?rows:[["",""]];
  const width=Math.max(2,Number(headers?.length)||Math.max(2,...list.map(r=>Array.isArray(r)?r.length:0)));
  const defaultHeaders=Array.from({length:width},(_,i)=>headers?.[i]||(["detailFields","advantages"].includes(key)?(i===0?(key==="advantages"?"Преимущество":"Название характеристики"):i===1?"Описание":"Дополнительный столбец "+(i-1)):"Столбец "+(i+1)));
  const normalized=list.map(r=>Array.from({length:width},(_,i)=>String(r?.[i]||"")));
  return '<details class="kb-admin-group kb-pair-editor" open data-pair-editor="'+esc(key)+'">'+
    '<summary>'+esc(label)+' <small>'+list.filter(r=>r?.some?.(x=>String(x||"").trim())).length+' строк</small></summary>'+
    '<div class="kb-pair-toolbar"><span>Строки можно перетаскивать за ⋮⋮. Столбцы можно дополнять.</span><button type="button" class="kb-mini" data-pair-add-col>+ столбец</button></div>'+
    '<div class="kb-pair-list" data-pair-list data-pair-width="'+width+'" style="--pair-width:"+width+">'+
    '<div class="kb-pair-header" data-pair-header-row><span class="kb-pair-header-handle"></span>'+defaultHeaders.map((h,i)=>'<div class="kb-pair-header-cell"><input data-pair-header value="'+esc(h)+'" placeholder="Название столбца">'+(i>=2?'<button type="button" class="kb-pair-col-remove" data-pair-remove-col title="Удалить столбец">×</button>':"")+'</div>').join("")+'<span></span></div>'+
    normalized.map((r)=>'<div class="kb-pair-row" data-pair-row draggable="false" style="--pair-width:'+width+'">'+
      '<button type="button" class="kb-pair-drag" data-pair-drag title="Перетащить строку" aria-label="Перетащить строку">⋮⋮</button>'+
      r.map((v,i)=>'<input data-pair-cell="'+i+'" placeholder="'+esc(defaultHeaders[i]||("Столбец "+(i+1)))+'" value="'+esc(v)+'">').join("")+
      '<button type="button" class="kb-mini danger" data-pair-remove title="Удалить строку">×</button></div>').join("")+
    '</div><button type="button" class="kb-admin-btn ghost kb-pair-add" data-pair-add>+ Добавить строку</button></details>';
}
function collectPairRows(form,key){
  const ed=form.querySelector('[data-pair-editor="'+CSS.escape(key)+'"]'),list=ed?.querySelector("[data-pair-list]");
  const rows=[...ed?.querySelectorAll("[data-pair-row]")||[]].map(r=>[...r.querySelectorAll("[data-pair-cell]")].map(x=>x.value.trim()));
  const headers=[...ed?.querySelectorAll("[data-pair-header]")||[]].map(x=>x.value.trim());
  return {rows:rows.map(r=>r.filter((_,i)=>i<headers.length)).filter(r=>r.some(Boolean)),headers};
}
function productPairEditors(ctx){
  const standard=PAIR_FIELDS.filter(([key])=>(ctx.product?.[key]||[]).length>0).map(([key,label])=>pairRowsEditorHtml(key,label,ctx.product?.[key]||[],ctx.product?.pairHeaders?.[key]||[]));
  const custom=(ctx.product?.customTabs||[]).map(customTabContentHtml);
  return [...standard,...custom].join("");
}
function tabRowHtml(t,p,custom=false){
  return '<div class="kb-admin-tabrow" data-admin-tab-row data-id="'+esc(t.id)+'" data-custom-tab="'+(custom?"1":"0")+'"><button type="button" class="kb-mini" data-tab-up>↑</button><button type="button" class="kb-mini" data-tab-down>↓</button><code>'+esc(t.id)+'</code><input value="'+esc(t.label)+'" data-tab-label><label class="kb-hide"><input type="checkbox" data-tab-hidden '+((p?.hiddenTabs||[]).includes(t.id)?"checked":"")+'> скрыть</label>'+(custom?'<button type="button" class="kb-mini danger kb-tab-delete" data-tab-delete title="Удалить вкладку">×</button>':'<span class="kb-tab-delete-slot"></span>')+'</div>';
}
function readCustomTabs(form){
  const raw=form?.querySelector("[data-custom-tabs]")?.value||"[]";
  const tabs=JSON.parse(raw||"[]");if(!Array.isArray(tabs))throw new Error("Пользовательские вкладки должны быть JSON-массивом.");
  return tabs;
}
function writeCustomTabs(form,tabs){
  const ta=form?.querySelector("[data-custom-tabs]");if(ta)ta.value=jsonText(tabs||[]);
}
function collectCustomTabs(form){
  const raw=readCustomTabs(form),byId=new Map(raw.filter(t=>t&&t.id).map(t=>[String(t.id),deep(t)])),out=[],seen=new Set();
  form.querySelectorAll('[data-admin-tab-row][data-custom-tab="1"]').forEach(r=>{
    const id=r.dataset.id;if(!id)return;seen.add(id);
    const t=byId.get(id)||{id,label:id,kind:"pairs",rows:[]};
    t.id=id;t.label=r.querySelector("[data-tab-label]")?.value.trim()||t.label||id;t.kind=t.kind||"pairs";
    const content=form.querySelector('[data-custom-content-id="'+CSS.escape(id)+'"]');
    const ta=content?.querySelector("[data-custom-tab-rows]");
    if(ta)t.rows=parsePairs(ta.value);
    out.push(t);
  });
  raw.forEach(t=>{if(t?.id&&!seen.has(String(t.id)))out.push(t)});
  return out;
}
function removeCustomTabUi(body,id){
  if(!id)return;
  const row=body.querySelector('[data-admin-tab-row][data-id="'+CSS.escape(id)+'"]');
  const label=row?.querySelector("[data-tab-label]")?.value.trim()||id;
  if(!confirm('Удалить вкладку «'+label+'» из карточки?'))return;
  row?.remove();
  body.querySelector('[data-custom-content-id="'+CSS.escape(id)+'"]')?.remove();
  body.querySelector('[data-table-editor][data-table-id="'+CSS.escape(id)+'"]')?.remove();
  body.querySelector('[data-new-table-tab] option[value="'+CSS.escape(id)+'"]')?.remove();
  const form=body.querySelector("[data-admin-product]");
  if(form){const tabs=readCustomTabs(form).filter(t=>String(t?.id||"")!==id);writeCustomTabs(form,tabs)}
}
function photoPreviewSrc(v){
  const s=String(v||"");return /^https?:\/\//i.test(s)||s.startsWith("data:")||s.startsWith("./")?s:"./"+s;
}
function photoSetting(v){
  const num=(x,d,min,max)=>{const n=Number(x);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):d};
  return {scale:num(v?.scale,1,.6,4),x:num(v?.x,0,-60,60),y:num(v?.y,0,-60,60),fit:v?.fit==="cover"?"cover":"contain"};
}
function photoContextSetting(view,context){
  if(view&&("scale" in view||"x" in view||"y" in view||"fit" in view))return photoSetting(view);
  return photoSetting(view?.[context]||{});
}
function photoPreviewStyle(v){
  const s=photoSetting(v);return "object-fit:"+s.fit+";transform:translate("+s.x+"%,"+s.y+"%) scale("+s.scale+");";
}
function photoRowHtml(path,index){
  return '<div class="kb-photo-row kb-photo-row-simple" data-photo-row data-path="'+esc(path)+'"><div class="kb-photo-preview kb-photo-preview-simple"><img src="'+esc(photoPreviewSrc(path))+'" alt="Фото товара"></div><div class="kb-photo-simple-main"><div class="kb-photo-meta"><strong>Фото '+(index+1)+'</strong><code>'+esc(path)+'</code></div><div class="kb-photo-actions"><button type="button" class="kb-mini" data-photo-up>↑ Выше</button><button type="button" class="kb-mini" data-photo-down>↓ Ниже</button><button type="button" class="kb-mini primary" data-photo-replace>Заменить фото</button><button type="button" class="kb-mini danger" data-photo-remove>Удалить</button></div></div></div>';
}
function fileExt(name){
  const m=String(name||"").toLowerCase().match(/\.([a-z0-9]{1,10})$/);return m?m[1]:"file";
}
function documentIcon(ext){
  ext=String(ext||"").toLowerCase();
  if(ext==="pdf")return "PDF";
  if(["ppt","pptx"].includes(ext))return "PPT";
  if(["doc","docx","rtf"].includes(ext))return "DOC";
  if(["xls","xlsx","csv"].includes(ext))return "XLS";
  return "FILE";
}
function documentRowHtml(doc,index){
  const d=doc||{},path=String(d.path||""),name=String(d.name||path.split("/").pop()||("Файл "+(index+1))),ext=fileExt(name||path);
  return '<div class="kb-document-row" data-document-row data-path="'+esc(path)+'" data-name="'+esc(name)+'"><span class="kb-document-type">'+esc(documentIcon(ext))+'</span><div class="kb-document-meta"><input data-document-name value="'+esc(name)+'"><code>'+esc(path)+'</code></div><div class="kb-document-actions"><button type="button" class="kb-mini" data-document-up>↑</button><button type="button" class="kb-mini" data-document-down>↓</button><button type="button" class="kb-mini danger" data-document-remove>Удалить</button></div></div>';
}
function documentEditorHtml(ctx){
  const docs=Array.isArray(ctx.product?.documents)?ctx.product.documents:[];
  return '<section class="kb-admin-section kb-document-section"><div class="kb-document-head"><div><h3>Файлы и документы</h3><p class="kb-admin-hint">PDF, Word, PowerPoint, Excel и другие рабочие файлы. Количество не ограничено.</p></div><div><button type="button" class="kb-admin-btn ghost" data-document-add>+ Добавить файл</button><input type="file" multiple data-document-file hidden></div></div><div data-document-list>'+docs.map(documentRowHtml).join("")+'</div><div class="kb-admin-hint">Файлы публикуются сразу после загрузки. Название можно изменить перед сохранением карточки.</div></section>';
}
function collectDocuments(form){
  return [...form.querySelectorAll("[data-document-row]")].map(r=>({name:r.querySelector("[data-document-name]")?.value.trim()||r.dataset.name||"Документ",path:r.dataset.path})).filter(x=>x.path);
}
function nextDocumentPath(productId,file,rows){
  const ext=fileExt(file?.name),folder="docs/products/"+safe(productId),base=safe(String(file?.name||"document").replace(/\.[^.]+$/,""))||"document";
  const used=new Set((rows||[]).map(r=>String(r.dataset.path||"")));
  let n=1,path=folder+"/"+base+"."+ext;
  while(used.has(path)){n++;path=folder+"/"+base+"-"+n+"."+ext}
  return path;
}
async function uploadDocument(file,path){
  if(!file)throw new Error("Файл не выбран.");
  if(file.size>40*1024*1024)throw new Error("Файл больше 40 МБ. Для сайта лучше использовать более компактную версию.");
  await putRepoBinary(path,await file.arrayBuffer(),"Admin: upload product document for "+(editorCtx?.product?.name||editorCtx?.id||"product"));
  const check=await repoFile(path);
  if(!check?.sha)throw new Error("GitHub не подтвердил сохранение файла. Привязка к карточке не добавлена.");
  if(Number(check.size||0)!==Number(file.size||0))throw new Error("Размер файла в GitHub не совпал с загруженным. Повторите загрузку.");
  return path;
}
async function persistDocumentsOnly(body){
  const form=body.querySelector("[data-admin-product]");if(!form||!editorCtx)return;
  const id=form.dataset.id,documents=collectDocuments(form),o=await loadOverrides(),out=deep(o.products?.[id]||{});
  if(documents.length)out.documents=deep(documents);else delete out.documents;
  o.products[id]=out;
  for(const sec of Object.values(o.sections||{})){
    if(!sec?.manualProducts||!Object.prototype.hasOwnProperty.call(sec.manualProducts,id))continue;
    const manual=deep(sec.manualProducts[id]||{});
    if(documents.length)manual.documents=deep(documents);else delete manual.documents;
    sec.manualProducts[id]=manual;
  }
  await commitOverrides(o);
  overrideCache=deep(o);
  editorCtx.product={...deep(editorCtx.product||{}),documents:deep(documents)};
}
function photoEditorHtml(ctx){
  const images=ctx.images||[];
  return '<section class="kb-admin-section kb-photo-section" data-photo-section data-photo-state="idle"><div class="kb-photo-head"><div><h3>Фотографии</h3><p class="kb-admin-hint">Показаны фотографии, которые сейчас стоят у товара. Можно добавить ещё фото или заменить конкретное существующее.</p></div><div class="kb-photo-head-actions"><button type="button" class="kb-admin-btn primary" data-photo-add>+ Добавить фото</button><input type="file" accept="image/png,image/jpeg,image/webp" multiple data-photo-file hidden><input type="file" accept="image/png,image/jpeg,image/webp" data-photo-replace-file hidden></div></div><div class="kb-photo-list" data-photo-list>'+images.map((p,i)=>photoRowHtml(p,i)).join("")+'</div><div class="kb-photo-save-state idle" data-photo-save-state><span class="kb-photo-save-icon">○</span><div><strong>Фото без изменений</strong><small>Если заменить или добавить фото, здесь появится подтверждение сохранения.</small></div></div><textarea data-images hidden>'+esc(linesText(images))+'</textarea></section>';
}
function setPhotoSaveState(body,state,message=""){
  const section=body?.querySelector("[data-photo-section]"),box=body?.querySelector("[data-photo-save-state]");
  if(!section||!box)return;
  const states={
    idle:{icon:"○",title:"Фото без изменений",detail:"Карточку можно сохранять."},
    saving:{icon:"…",title:"Сохраняем фото…",detail:"Дождитесь окончания загрузки. Сохранение карточки временно заблокировано."},
    saved:{icon:"✓",title:"Фото сохранены",detail:"Фото записаны и опубликованы. Карточку можно сохранять."},
    error:{icon:"!",title:"Фото не сохранены",detail:"Исправьте ошибку загрузки фото перед сохранением карточки."}
  };
  const x=states[state]||states.idle;
  section.dataset.photoState=state;
  box.className="kb-photo-save-state "+state;
  box.innerHTML='<span class="kb-photo-save-icon">'+x.icon+'</span><div><strong>'+esc(x.title)+'</strong><small>'+esc(message||x.detail)+'</small></div>';
  const save=body.querySelector('[data-admin-product] button[type="submit"]');
  if(save){
    const blocked=state==="saving"||state==="error";
    save.disabled=blocked;
    save.title=blocked?"Сначала дождитесь успешного сохранения фото.":"";
  }
}
function syncPhotoState(body){
  const rows=[...body.querySelectorAll("[data-photo-row]")],paths=rows.map(r=>r.dataset.path).filter(Boolean);
  rows.forEach((r,i)=>{const strong=r.querySelector(".kb-photo-meta strong");if(strong)strong.textContent="Фото "+(i+1)});
  const ta=body.querySelector("[data-images]");if(ta)ta.value=paths.join("\n");
  return paths;
}
function settingFromContext(box){
  return photoSetting({
    scale:Number(box?.querySelector("[data-photo-scale]")?.value||100)/100,
    x:Number(box?.querySelector("[data-photo-x]")?.value||0),
    y:Number(box?.querySelector("[data-photo-y]")?.value||0),
    fit:box?.querySelector("[data-photo-fit]")?.value||"contain"
  });
}
function collectPhotoSettings(){return {}}
function updatePhotoPreview(box){
  if(!box)return;
  const v=settingFromContext(box),img=box.querySelector(".kb-photo-preview img");
  if(img)img.style.cssText=photoPreviewStyle(v);
  const so=box.querySelector("[data-photo-scale-out]"),xo=box.querySelector("[data-photo-x-out]"),yo=box.querySelector("[data-photo-y-out]");
  if(so)so.textContent=Math.round(v.scale*100)+"%";if(xo)xo.textContent=String(v.x);if(yo)yo.textContent=String(v.y);
  box.closest("[data-photo-row]")?.classList.add("is-photo-dirty");
}
function setPhotoControls(box,{scale=1,x=0,y=0,fit="contain"}={}){
  const v=photoSetting({scale,x,y,fit});
  const sc=box?.querySelector("[data-photo-scale]"),xc=box?.querySelector("[data-photo-x]"),yc=box?.querySelector("[data-photo-y]"),fc=box?.querySelector("[data-photo-fit]");
  if(sc)sc.value=String(Math.round(v.scale*100));if(xc)xc.value=String(v.x);if(yc)yc.value=String(v.y);if(fc)fc.value=v.fit;updatePhotoPreview(box);
}
function base64ToBlob(content,type="image/png"){
  const clean=String(content||"").replace(/\s+/g,""),bin=atob(clean),bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new Blob([bytes],{type});
}
async function adminRepoImageBlob(path){
  if(!String(path||"").startsWith("img/photos/admin/"))return null;
  try{
    const file=await repoFile(path);
    if(!file?.content)return null;
    const ext=String(path).split(".").pop().toLowerCase(),type=ext==="png"?"image/png":ext==="webp"?"image/webp":"image/jpeg";
    return base64ToBlob(file.content,type);
  }catch{return null}
}
async function imageElementFromBlob(blob){
  const dataUrl=await new Promise((resolve,reject)=>{
    const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error("Не удалось прочитать локальный файл."));r.readAsDataURL(blob);
  });
  const img=new Image();img.decoding="async";
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("Не удалось декодировать изображение."));img.src=dataUrl});
  return img;
}
async function imageElementFromUrl(url){
  const img=new Image();img.decoding="async";
  if(/^https?:\/\//i.test(url)&&!url.startsWith(location.origin))img.crossOrigin="anonymous";
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("Не удалось прочитать изображение для автоподгона."));img.src=photoPreviewSrc(url)});
  return img;
}
async function detectPhotoBounds(source){
  let actual=source;
  if(typeof source==="string"){
    const repoBlob=await adminRepoImageBlob(source);
    if(repoBlob)actual=repoBlob;
  }
  let img=null,bitmap=null,naturalWidth=0,naturalHeight=0;
  try{
    if(actual instanceof Blob){
      if("createImageBitmap" in window){
        try{bitmap=await createImageBitmap(actual);naturalWidth=bitmap.width;naturalHeight=bitmap.height}catch{}
      }
      if(!bitmap){img=await imageElementFromBlob(actual);naturalWidth=img.naturalWidth;naturalHeight=img.naturalHeight}
    }else{
      img=await imageElementFromUrl(String(actual||""));naturalWidth=img.naturalWidth;naturalHeight=img.naturalHeight;
    }
    if(!naturalWidth||!naturalHeight)throw new Error("Изображение не имеет читаемого размера.");
    const maxSide=640,k=Math.min(1,maxSide/Math.max(naturalWidth,naturalHeight)),w=Math.max(1,Math.round(naturalWidth*k)),h=Math.max(1,Math.round(naturalHeight*k));
    const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(bitmap||img,0,0,w,h);
    let data;
    try{data=ctx.getImageData(0,0,w,h).data}
    catch{throw new Error("Сайт-источник запрещает анализ этой внешней картинки. Сначала загрузи её через «Заменить файл», после чего автоподгон будет работать.")}
    const sampleSize=Math.max(3,Math.round(Math.min(w,h)*.025));
    let br=0,bg=0,bb=0,ba=0,n=0;
    const sample=(x0,y0)=>{for(let y=y0;y<Math.min(h,y0+sampleSize);y++)for(let x=x0;x<Math.min(w,x0+sampleSize);x++){const i=(y*w+x)*4;br+=data[i];bg+=data[i+1];bb+=data[i+2];ba+=data[i+3];n++}};
    sample(0,0);sample(Math.max(0,w-sampleSize),0);sample(0,Math.max(0,h-sampleSize));sample(Math.max(0,w-sampleSize),Math.max(0,h-sampleSize));
    br/=n;bg/=n;bb/=n;ba/=n;
    let minX=w,minY=h,maxX=-1,maxY=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*w+x)*4,a=data[i+3];let content=false;
      if(ba<80)content=a>35;
      else{
        const dr=data[i]-br,dg=data[i+1]-bg,db=data[i+2]-bb,dist=Math.sqrt(dr*dr+dg*dg+db*db);
        content=a>35&&dist>16;
      }
      if(content){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
    }
    if(maxX<minX||maxY<minY)throw new Error("Не удалось уверенно определить границы товара. Используй ручные ползунки.");
    const px=Math.round(w*.025),py=Math.round(h*.025);
    minX=Math.max(0,minX-px);maxX=Math.min(w-1,maxX+px);minY=Math.max(0,minY-py);maxY=Math.min(h-1,maxY+py);
    return {imageAspect:naturalWidth/naturalHeight,x0:minX/w,x1:(maxX+1)/w,y0:minY/h,y1:(maxY+1)/h};
  }finally{
    try{bitmap?.close?.()}catch{}
  }
}
function autoSettingFromBounds(b,context){
  const target=4/3,fw=b.imageAspect>target?1:b.imageAspect/target,fh=b.imageAspect>target?target/b.imageAspect:1;
  const bw=Math.max(.02,b.x1-b.x0),bh=Math.max(.02,b.y1-b.y0),cx=(b.x0+b.x1)/2-.5,cy=(b.y0+b.y1)/2-.5;
  const scale=Math.max(1,Math.min(.96/(fw*bw),.96/(fh*bh)));
  return photoSetting({scale,x:-cx*fw*scale*100,y:-cy*fh*scale*100,fit:"contain"});
}
async function autoFitRow(row,context=null,source=null){
  const path=row?.dataset.path;if(!row||(!path&&!source))return;
  const bounds=await detectPhotoBounds(source||path),contexts=context?[context]:["card","detail"];
  for(const name of contexts){const box=row.querySelector('[data-photo-context="'+name+'"]');setPhotoControls(box,autoSettingFromBounds(bounds,name))}
}
function imageExt(file){
  const byName=(file?.name||"").split(".").pop().toLowerCase();
  if(["png","jpg","jpeg","webp"].includes(byName))return byName==="jpeg"?"jpg":byName;
  const m={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"};return m[file?.type]||"";
}
function nextPhotoPath(productId,files,ext){
  const folder="img/photos/admin/"+safe(productId),base=safe(productId),used=new Set();
  for(const p of files||[]){if(!String(p).startsWith(folder+"/"))continue;const m=String(p).match(/-(\d+)\.[^.]+$/);if(m)used.add(Number(m[1]))}
  let n=1;while(used.has(n))n++;
  return folder+"/"+base+"-"+String(n).padStart(2,"0")+"."+ext;
}
async function persistImagesOnly(body){
  const form=body.querySelector("[data-admin-product]");if(!form||!editorCtx)return;
  setPhotoSaveState(body,"saving");
  const id=form.dataset.id,images=syncPhotoState(body),settings=collectPhotoSettings(body);
  // Берём уже актуальный кэш текущей сессии. Повторный force-read возвращал состояние,
  // с которым страница была открыта, и мог откатывать предыдущую замену/добавление фото.
  const o=await loadOverrides(),out=deep(o.products?.[id]||{});
  if(same(images,editorCtx.sourceImages||[]))delete out.images;else out.images=images;
  if(same(settings,editorCtx.sourceProduct?.imageSettings||{}))delete out.imageSettings;else out.imageSettings=settings;
  if(emptyObject(out))delete o.products[id];else o.products[id]=out;

  // Ручные карточки живут ещё и внутри sections.*.manualProducts.
  // Синхронизируем туда именно фото, иначе после успешной загрузки карточка могла
  // продолжать показывать старое изображение из manualProducts.
  for(const sec of Object.values(o.sections||{})){
    if(!sec?.manualProducts||!Object.prototype.hasOwnProperty.call(sec.manualProducts,id))continue;
    const manual=deep(sec.manualProducts[id]||{});
    if(images.length)manual.images=deep(images);else delete manual.images;
    delete manual.imageSettings;
    sec.manualProducts[id]=manual;
  }

  await commitOverrides(o);
  window.KB_EDITOR_API?.setProductImages?.(id,images);
  editorCtx.images=deep(images);
  body.querySelectorAll("[data-photo-row]").forEach(r=>r.classList.remove("is-photo-dirty"));
  setPhotoSaveState(body,"saved");
}
async function optimizePhotoFile(file){
  if(!file)return file;
  const maxSide=1600,quality=.86;
  let bitmap=null,img=null,w=0,h=0;
  try{
    if("createImageBitmap" in window){
      try{bitmap=await createImageBitmap(file);w=bitmap.width;h=bitmap.height}catch{}
    }
    if(!bitmap){
      img=await imageElementFromBlob(file);w=img.naturalWidth;h=img.naturalHeight;
    }
    if(!w||!h)return file;
    const scale=Math.min(1,maxSide/Math.max(w,h)),tw=Math.max(1,Math.round(w*scale)),th=Math.max(1,Math.round(h*scale));
    // Маленькие WEBP уже достаточно компактны — не перекодируем их повторно.
    if(scale===1&&file.type==="image/webp"&&file.size<450*1024)return file;
    const canvas=document.createElement("canvas");canvas.width=tw;canvas.height=th;
    const ctx=canvas.getContext("2d");ctx.drawImage(bitmap||img,0,0,tw,th);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));
    if(!blob)return file;
    // Не заменяем исходник, если перекодирование внезапно сделало файл больше.
    if(scale===1&&blob.size>=file.size)return file;
    return new File([blob],safe((file.name||"photo").replace(/\.[^.]+$/,""))+".webp",{type:"image/webp",lastModified:Date.now()});
  }catch{
    return file;
  }finally{
    try{bitmap?.close?.()}catch{}
  }
}
async function uploadPhoto(file,path){
  if(!file)throw new Error("Файл не выбран.");
  const ext=imageExt(file);if(!ext)throw new Error("Поддерживаются PNG, JPG и WEBP.");
  if(file.size>15*1024*1024)throw new Error("Фото больше 15 МБ. Сначала уменьшите файл.");
  await putRepoBinary(path,await file.arrayBuffer(),"Admin: upload photo for "+(editorCtx?.product?.name||editorCtx?.id||"product"));
  return path;
}
function editorSectionList(){
  return (window.KB_EDITOR_API?.catalog?.()||[]).flatMap(ch=>(ch.sections||[]).map(sec=>({id:sec.id,title:sec.title,chapterId:ch.id,chapterTitle:ch.title})));
}
function editorSectionOptions(selected=""){
  return editorSectionList().map(s=>'<option value="'+esc(s.id)+'" '+(s.id===selected?"selected":"")+'>'+esc(s.id+" · "+s.title)+'</option>').join("");
}
function productQuality(ctx){
  const p=ctx?.product||{},checks=[
    !!String(p.name||"").trim(),!!String(p.article||"").trim(),!!String(p.type||"").trim(),!!String(p.purpose||"").trim(),
    (ctx?.images||[]).length>0,(p.detailFields||[]).length>=3,(p.advantages||[]).length>0,
    (p.indicators||[]).length>0||Object.keys(p.tabTables||{}).length>0||(p.customTabs||[]).length>0
  ];
  return Math.round(checks.filter(Boolean).length/checks.length*100);
}
function cleanProductForManual(ctx,targetSection){
  const p=deep(ctx?.product||{});
  delete p.id;delete p.manual;delete p.sourceGid;delete p.sourceSectionId;
  p.sourceSectionId=targetSection;
  if((ctx?.images||[]).length)p.images=deep(ctx.images);else delete p.images;
  return p;
}
function nextManualProductId(targetSection,name,o){
  const root="manual-"+safe(targetSection)+"-"+safe(name||"product"),used=new Set([
    ...Object.keys(o.products||{}),
    ...Object.values(o.sections||{}).flatMap(sec=>Object.keys(sec?.manualProducts||{}))
  ]);
  let id=root+"-"+Date.now().toString(36),n=2;while(used.has(id))id=root+"-"+Date.now().toString(36)+"-"+n++;
  return id;
}
async function createManualProduct(sectionId,name="Новая карточка"){
  const o=await loadOverrides(),section=o.sections[sectionId]||(o.sections[sectionId]={}),manualProducts=section.manualProducts||(section.manualProducts={});
  const id=nextManualProductId(sectionId,name,o);
  manualProducts[id]={name:String(name||"Новая карточка").trim()||"Новая карточка",article:"",type:"",purpose:"",detailFields:[["",""]],advantages:[["",""]],sourceSectionId:sectionId};
  await commitOverrides(o);
  location.hash="#/account/product/"+encodeURIComponent(id);location.reload();
}
async function duplicateProductTo(productId,targetSection,{move=false}={}){
  const ctx=window.KB_EDITOR_API?.product?.(productId);if(!ctx)throw new Error("Карточка не найдена.");
  const o=await loadOverrides(),target=o.sections[targetSection]||(o.sections[targetSection]={}),manualProducts=target.manualProducts||(target.manualProducts={});
  const copy=cleanProductForManual(ctx,targetSection),id=nextManualProductId(targetSection,copy.name||ctx.product?.name,o);
  manualProducts[id]=copy;
  if((ctx.images||[]).length){o.products[id]={...(o.products[id]||{}),images:deep(ctx.images)}}
  if(move){
    const sourceSection=ctx.section?.id||ctx.sourceSection?.id;
    let removedManual=false;
    for(const sec of Object.values(o.sections||{})){
      if(sec?.manualProducts&&Object.prototype.hasOwnProperty.call(sec.manualProducts,productId)){delete sec.manualProducts[productId];removedManual=true}
    }
    if(removedManual)delete o.products[productId];
    else if(sourceSection){
      const src=o.sections[sourceSection]||(o.sections[sourceSection]={});
      src.deletedProductIds=[...new Set([...(src.deletedProductIds||[]),productId])];
    }
  }
  await commitOverrides(o);
  location.hash="#/account/product/"+encodeURIComponent(id);location.reload();
}
async function deleteProductById(productId,{navigate=false}={}){
  const ctx=window.KB_EDITOR_API?.product?.(productId);if(!ctx)throw new Error("Карточка не найдена.");
  const o=await loadOverrides();let removedManual=false;
  for(const sec of Object.values(o.sections||{})){
    if(sec?.manualProducts&&Object.prototype.hasOwnProperty.call(sec.manualProducts,productId)){
      delete sec.manualProducts[productId];removedManual=true;
      if(Array.isArray(sec.productOrder))sec.productOrder=sec.productOrder.filter(x=>x!==productId);
      if(Array.isArray(sec.hiddenProductIds))sec.hiddenProductIds=sec.hiddenProductIds.filter(x=>x!==productId);
      if(Array.isArray(sec.deletedProductIds))sec.deletedProductIds=sec.deletedProductIds.filter(x=>x!==productId);
    }
  }
  if(removedManual)delete o.products[productId];
  else{
    const sectionId=ctx.section?.id||ctx.sourceSection?.id;if(!sectionId)throw new Error("Не найден раздел карточки.");
    const sec=o.sections[sectionId]||(o.sections[sectionId]={});
    sec.deletedProductIds=[...new Set([...(sec.deletedProductIds||[]),productId])];
    if(Array.isArray(sec.productOrder))sec.productOrder=sec.productOrder.filter(x=>x!==productId);
    if(Array.isArray(sec.hiddenProductIds))sec.hiddenProductIds=sec.hiddenProductIds.filter(x=>x!==productId);
  }
  await commitOverrides(o);
  overrideCache=deep(o);
  if(navigate)location.hash="#/account";
  return {id:productId,sectionId:ctx.section?.id||ctx.sourceSection?.id||"",manual:removedManual};
}
function productManagementHtml(ctx){
  const quality=productQuality(ctx);
  return '<section class="kb-product-command"><div class="kb-product-command-summary"><div><span class="kb-admin-kicker">Управление карточкой</span><h3>'+esc(ctx.product?.name||ctx.id)+'</h3><p>'+esc(ctx.section?.id+" · "+ctx.section?.title)+'</p></div><div class="kb-card-quality"><strong>'+quality+'%</strong><span>Заполненность</span></div></div>'+
    '<div class="kb-product-command-actions"><button type="button" class="kb-admin-btn ghost" data-duplicate-here>⧉ Дублировать здесь</button>'+
    '<div class="kb-copy-target"><select data-product-target-section>'+editorSectionOptions(ctx.section?.id||"")+'</select><button type="button" class="kb-admin-btn ghost" data-copy-to-section>Копировать в раздел</button><button type="button" class="kb-admin-btn ghost" data-move-to-section>Перенести</button></div>'+
    '<button type="button" class="kb-admin-btn danger" data-delete-current-product>Удалить карточку</button></div></section>';
}
function renderProductEditor(ctx){
  editorCtx=ctx;
  const existing=deep(overrideCache.products?.[ctx.id]||{});
  const customIds=new Set((ctx.product.customTabs||[]).map(t=>t.id));
  const tabs=(ctx.tabs||[]).map(t=>tabRowHtml(t,ctx.product,customIds.has(t.id))).join("");
  const quality=productQuality(ctx);
  setBody(shell(ctx.product.name||ctx.id,ctx.section.id+" · "+ctx.section.title,
    productManagementHtml(ctx)+
    '<form data-admin-product data-id="'+esc(ctx.id)+'" class="kb-admin-form kb-wb-editor">'+
      '<aside class="kb-wb-media">'+
        '<div class="kb-wb-side-title"><span class="kb-admin-kicker">Медиа</span><h3>Фото товара</h3><p>Перетащи, замени или добавь изображения. Первая фотография используется на карточке.</p></div>'+
        photoEditorHtml(ctx)+
        documentEditorHtml(ctx)+
        '<div class="kb-wb-quality-card"><div><strong>'+quality+'%</strong><span>качество карточки</span></div><progress max="100" value="'+quality+'"></progress><small>'+(quality>=80?"Карточка хорошо заполнена.":quality>=55?"Есть несколько полей, которые можно улучшить.":"Заполни основные данные, фото и характеристики.")+'</small></div>'+
      '</aside>'+
      '<main class="kb-wb-content">'+
        '<section class="kb-wb-panel"><div class="kb-wb-panel-head"><div><span class="kb-admin-kicker">Основная информация</span><h3>Карточка товара</h3></div><span class="kb-wb-quality-pill">'+quality+'%</span></div>'+
          '<div class="kb-admin-grid two kb-wb-basic"><label>Наименование<input name="name" value="'+esc(ctx.product.name||"")+'"></label><label>Артикул<input name="article" value="'+esc(ctx.product.article||"")+'"></label><label>Тип / категория<input name="type" value="'+esc(ctx.product.type||"")+'"></label><label class="wide">Описание / назначение<textarea name="purpose" rows="5">'+esc(ctx.product.purpose||"")+'</textarea></label></div>'+
        '</section>'+
        '<section class="kb-wb-panel"><div class="kb-wb-panel-head"><div><span class="kb-admin-kicker">Контент</span><h3>Характеристики и преимущества</h3></div></div><div data-card-content>'+productPairEditors(ctx)+'</div></section>'+
        '<section class="kb-wb-panel">'+tableEditorsHtml(ctx)+'</section>'+
        '<section class="kb-wb-panel"><details class="kb-admin-group" open><summary>Вещества / группы / ppb <small>'+((ctx.product.substances||[]).length)+' строк</small></summary><label class="kb-admin-field"><span>Формат: <b>группа | вещество | ppb</b>.</span><textarea rows="10" data-substances>'+esc(substancesText(ctx.product.substances||[]))+'</textarea></label></details></section>'+
        '<section class="kb-wb-panel"><div class="kb-tab-section-head"><div><span class="kb-admin-kicker">Структура</span><h3>Вкладки карточки</h3><p class="kb-admin-hint">Меняй порядок, подписи и видимость вкладок.</p></div><div class="kb-tab-create"><input type="text" data-new-tab-label placeholder="Название новой вкладки"><button type="button" class="kb-admin-btn ghost" data-add-tab>+ Добавить вкладку</button></div></div><div data-tab-list>'+tabs+'</div></section>'+
        '<details class="kb-admin-group kb-wb-advanced"><summary>Расширенные настройки <small>для редких случаев</small></summary><label class="kb-admin-field"><span>Пользовательские вкладки JSON</span><textarea rows="10" data-custom-tabs>'+esc(jsonText(ctx.product.customTabs||[]))+'</textarea></label><label class="kb-admin-field"><span>Расширенный JSON override</span><textarea rows="12" data-advanced>'+esc(jsonText(existing))+'</textarea></label></details>'+
      '</main>'+
      '<div class="kb-wb-savebar"><div><strong>Редактирование карточки</strong><span data-wb-save-note>Проверь фото и данные перед публикацией.</span></div><button type="button" class="kb-admin-btn ghost" data-account-back>К списку товаров</button><button type="submit" class="kb-admin-btn primary">Сохранить и опубликовать</button></div>'+
    '</form>'
  ));
}

function sectionContentBlocks(ctx){
  const s=ctx.section||{};
  if(Array.isArray(s.contentBlocks))return deep(s.contentBlocks);
  const out=[];
  if(Array.isArray(s.pairs)&&s.pairs.length){
    out.push({id:"legacy-pairs",type:"table",headers:["Параметр","Значение"],rows:s.pairs.map(x=>[String(x.label||""),String(x.value||"")])});
  }
  if(Array.isArray(s.notes)&&s.notes.length){
    out.push({id:"legacy-notes",type:"list",items:s.notes.map(x=>String(x||"")).filter(Boolean)});
  }
  for(const t of s.tables||[]){
    if(t?.headers?.length)out.push({id:"legacy-table-"+out.length,type:"table",title:t.title||"",headers:t.headers.map(x=>String(x||"")),rows:(t.rows||[]).map(r=>(r||[]).map(x=>String(x||"")))});
  }
  return out;
}
function richToolbar(){
  return '<div class="kb-rich-toolbar">'+
    '<button type="button" data-rich-cmd="bold"><b>B</b></button><button type="button" data-rich-cmd="italic"><i>I</i></button>'+
    '<button type="button" data-rich-cmd="underline"><u>U</u></button><span class="kb-rich-sep"></span>'+
    '<button type="button" data-rich-cmd="formatBlock" data-rich-value="h3">Заголовок</button>'+
    '<button type="button" data-rich-cmd="formatBlock" data-rich-value="p">Абзац</button>'+
    '<button type="button" data-rich-cmd="insertUnorderedList">• Список</button>'+
    '<button type="button" data-rich-cmd="createLink">Ссылка</button>'+
  '</div>';
}
function contentTableHtml(b){
  const headers=Array.isArray(b?.headers)&&b.headers.length?b.headers:["Название","Значение"],width=headers.length;
  const rows=Array.isArray(b?.rows)?b.rows:[];
  return '<div class="kb-content-table" data-content-table>'+
    '<div class="kb-content-table-title"><input data-block-table-title placeholder="Заголовок таблицы (необязательно)" value="'+esc(b?.title||"")+'">'+
    '<button type="button" class="kb-mini" data-content-add-col>+ столбец</button><button type="button" class="kb-mini" data-content-add-row>+ строка</button></div>'+
    '<div class="kb-table-scroll"><table><thead><tr>'+headers.map((h,i)=>'<th><div class="kb-cell-head"><input data-content-table-header value="'+esc(h)+'"><button type="button" class="kb-col-remove" data-content-remove-col="'+i+'">×</button></div></th>').join("")+'</tr></thead>'+
    '<tbody>'+rows.map(r=>'<tr data-content-table-row>'+Array.from({length:width},(_,i)=>'<td><input data-content-table-cell value="'+esc(r?.[i]||"")+'"></td>').join("")+'<td class="kb-row-tools"><button type="button" class="kb-row-remove" data-content-remove-row>×</button></td></tr>').join("")+'</tbody></table></div></div>';
}
function contentBlockEditorHtml(b,index){
  const id=b?.id||("block-"+Date.now()+"-"+index),type=b?.type||"text";
  let body="";
  if(type==="heading")body='<label class="kb-admin-field"><span>Заголовок</span><input data-block-heading value="'+esc(b?.text||b?.html||"")+'"></label>';
  else if(type==="list")body='<label class="kb-admin-field"><span>Одна строка — один пункт</span><textarea rows="6" data-block-list>'+esc((b?.items||[]).join("\n"))+'</textarea></label>';
  else if(type==="quote")body=richToolbar()+'<div class="kb-rich-editor" contenteditable="true" data-block-html>'+safeAdminHtml(b?.html||"")+'</div>';
  else if(type==="table")body=contentTableHtml(b);
  else if(type==="image"){
    const src=String(b?.src||"");
    body='<div class="kb-content-image-editor">'+
      '<div class="kb-content-image-preview">'+(src?'<img src="'+esc(photoPreviewSrc(src))+'" alt="">':'<span>Изображение ещё не загружено</span>')+'</div>'+
      '<div class="kb-content-image-tools"><button type="button" class="kb-admin-btn ghost" data-content-image-upload>Загрузить / заменить</button>'+
      '<label>Ширина <input type="range" min="20" max="100" step="5" value="'+Math.min(100,Math.max(20,Number(b?.width)||100))+'" data-block-image-width><output data-block-image-width-out>'+Math.min(100,Math.max(20,Number(b?.width)||100))+'%</output></label>'+
      '<label>Выравнивание <select data-block-image-align><option value="left" '+(b?.align==="left"?"selected":"")+'>Слева</option><option value="center" '+(!b?.align||b.align==="center"?"selected":"")+'>По центру</option><option value="right" '+(b?.align==="right"?"selected":"")+'>Справа</option></select></label>'+
      '<input data-block-image-src type="hidden" value="'+esc(src)+'">'+
      '<label>Подпись<input data-block-image-caption value="'+esc(b?.caption||"")+'"></label>'+
      '<label>Описание изображения<input data-block-image-alt value="'+esc(b?.alt||"")+'"></label></div></div>';
  } else body=richToolbar()+'<div class="kb-rich-editor" contenteditable="true" data-block-html>'+safeAdminHtml(b?.html||"<p>Введите текст…</p>")+'</div>';
  return '<article class="kb-content-block" draggable="true" data-content-block data-block-id="'+esc(id)+'" data-block-type="'+esc(type)+'">'+
    '<header><span class="kb-block-drag">⋮⋮</span><strong>'+({text:"Текст",heading:"Заголовок",list:"Список",quote:"Цитата",table:"Таблица",image:"Изображение"}[type]||"Блок")+'</strong>'+
    '<div><button type="button" class="kb-mini" data-content-duplicate>Дублировать</button><button type="button" class="kb-mini danger" data-content-delete>Удалить</button></div></header>'+
    '<div class="kb-content-block-body">'+body+'</div></article>';
}
function safeAdminHtml(html){
  return String(html||"").replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,"").replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta)[^>]*\/?>/gi,"").replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi,"");
}
function sectionBuilderHtml(ctx){
  const blocks=sectionContentBlocks(ctx);
  return '<section class="kb-admin-section kb-content-builder-section">'+
    '<div class="kb-content-builder-head"><div><h3>Конструктор содержимого</h3><p class="kb-admin-hint">Собирай раздел как страницу: текст, заголовки, списки, таблицы и изображения. Блоки можно перетаскивать мышкой.</p></div>'+
    '<div class="kb-content-add"><button type="button" class="kb-admin-btn ghost" data-content-add="text">+ Текст</button><button type="button" class="kb-admin-btn ghost" data-content-add="heading">+ Заголовок</button><button type="button" class="kb-admin-btn ghost" data-content-add="list">+ Список</button><button type="button" class="kb-admin-btn ghost" data-content-add="table">+ Таблица</button><button type="button" class="kb-admin-btn ghost" data-content-add="image">+ Изображение</button></div></div>'+
    '<div class="kb-content-builder" data-content-builder>'+blocks.map(contentBlockEditorHtml).join("")+'</div>'+
    '<input type="file" accept="image/png,image/jpeg,image/webp" data-content-image-file hidden></section>';
}
function collectSectionContentBlocks(form){
  const out=[];
  form.querySelectorAll("[data-content-block]").forEach((el,i)=>{
    const type=el.dataset.blockType,id=el.dataset.blockId||("block-"+i),b={id,type};
    if(type==="heading")b.text=el.querySelector("[data-block-heading]")?.value.trim()||"";
    else if(type==="list")b.items=String(el.querySelector("[data-block-list]")?.value||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    else if(type==="image"){
      b.src=el.querySelector("[data-block-image-src]")?.value.trim()||"";
      b.width=Number(el.querySelector("[data-block-image-width]")?.value||100);
      b.align=el.querySelector("[data-block-image-align]")?.value||"center";
      b.caption=el.querySelector("[data-block-image-caption]")?.value.trim()||"";
      b.alt=el.querySelector("[data-block-image-alt]")?.value.trim()||"";
    }else if(type==="table"){
      b.title=el.querySelector("[data-block-table-title]")?.value.trim()||"";
      b.headers=[...el.querySelectorAll("[data-content-table-header]")].map(x=>x.value.trim());
      const w=b.headers.length;
      b.rows=[...el.querySelectorAll("[data-content-table-row]")].map(tr=>Array.from({length:w},(_,j)=>tr.querySelectorAll("[data-content-table-cell]")[j]?.value.trim()||"")).filter(r=>r.some(Boolean));
    }else b.html=safeAdminHtml(el.querySelector("[data-block-html]")?.innerHTML||"");
    if(type==="image"&&!b.src)return;
    if(type==="heading"&&!b.text)return;
    if(type==="table"&&!b.headers.some(Boolean))return;
    out.push(b);
  });
  return out;
}
function sectionProductsEditor(ctx){
  const cards=ctx.productCards||[],deleted=ctx.deletedProductCards||[];
  const active=cards.map(p=>'<div class="kb-product-sort-row '+(p.hidden?"is-hidden":"")+'" draggable="false" data-section-product-row data-id="'+esc(p.id)+'">'+
      '<button type="button" class="kb-drag kb-product-drag" data-product-drag draggable="true" title="Зажмите и перетащите карточку" aria-label="Перетащить карточку">⋮⋮</button>'+
      '<div class="kb-product-sort-name"><strong>'+esc(p.name)+'</strong>'+(p.article?'<small>Арт. '+esc(p.article)+'</small>':'')+'</div>'+
      '<button type="button" class="kb-mini" data-open-section-product title="Открыть карточку">✎</button><button type="button" class="kb-mini" data-product-up title="Выше">↑</button><button type="button" class="kb-mini" data-product-down title="Ниже">↓</button>'+
      '<label class="kb-product-hide"><input type="checkbox" data-product-hidden '+(p.hidden?"checked":"")+'> <span>Скрыть</span></label>'+
      '<button type="button" class="kb-mini danger kb-product-delete" data-product-delete>Удалить</button>'+
    '</div>').join("");
  const removed=deleted.map(p=>'<div class="kb-deleted-product-row" data-section-deleted-row data-id="'+esc(p.id)+'"><div class="kb-product-sort-name"><strong>'+esc(p.name)+'</strong>'+(p.article?'<small>Арт. '+esc(p.article)+'</small>':'')+'</div><label class="kb-product-restore"><input type="checkbox" data-product-restore> <span>Восстановить при сохранении</span></label></div>').join("");
  return '<section class="kb-admin-section"><div class="kb-product-section-head"><div><h3>Карточки товаров</h3><p class="kb-admin-hint"><b>Перетаскивай карточки за ручку ⋮⋮</b> — новый порядок сохраняется сразу. <b>Скрыть</b> — временно убрать карточку с сайта. <b>Удалить</b> — исключить её из структуры сайта, поиска и избранного. Google Sheets при этом не меняется.</p></div><button type="button" class="kb-admin-btn primary" data-add-product>+ Добавить карточку товара</button></div>'+
    (cards.length?'<div class="kb-product-sort" data-section-product-list>'+active+'</div>':'<div class="kb-admin-empty">В этом разделе пока нет карточек. Создай первую вручную.</div>')+
    (deleted.length?'<details class="kb-admin-group kb-deleted-products"><summary>Удалённые карточки <small>'+deleted.length+'</small></summary><div class="kb-deleted-product-list">'+removed+'</div></details>':'')+
    '</section>';
}

async function persistSectionProductOrder(body){
  const form=body?.querySelector("[data-admin-section]"),sectionId=form?.dataset.id;
  if(!sectionId)return;
  const order=[...form.querySelectorAll("[data-section-product-row]")].map(r=>r.dataset.id).filter(Boolean);
  const o=await loadOverrides(),sec=o.sections[sectionId]||(o.sections[sectionId]={});
  sec.productOrder=order;
  await commitOverrides(o);
  overrideCache=deep(o);
}

function nextContentImagePath(sectionId,file){
  const ext=imageExt(file)||"png",base=safe("section-"+sectionId),stamp=Date.now().toString(36);
  return "img/content/"+base+"/"+base+"-"+stamp+"."+ext;
}
function foundationTermsEditorHtml(ctx){
  const terms=Array.isArray(ctx.terms11)?ctx.terms11:[];
  if(!terms.length)return '<section class="kb-admin-section"><p class="kb-admin-hint">Источник терминов 1.1 пока не загружен. Обнови страницу и попробуй снова.</p></section>';
  return '<section class="kb-admin-section kb-foundation-admin"><div class="kb-foundation-admin-head"><div><h3>Термины 1.1</h3><p class="kb-admin-hint">Первый уровень — короткое определение. Ниже редактируется расширение, ссылки, PDF и связи. Пустая строка в поле «Расширение» разделяет абзацы.</p></div><span class="kb-foundation-admin-count">'+terms.length+' терминов</span></div>'+
    '<div class="kb-foundation-admin-list">'+terms.map(t=>'<details class="kb-admin-group kb-foundation-term-editor" data-foundation-edit-term data-term-number="'+esc(String(t.number))+'"><summary><span class="kb-foundation-term-no">'+String(t.number).padStart(2,"0")+'</span><strong>'+esc(t.title||"Без названия")+'</strong><small>редактировать</small></summary><div class="kb-foundation-term-form">'+
      '<label class="kb-admin-field"><span>Термин</span><input data-foundation-title value="'+esc(t.title||"")+'"></label>'+
      '<label class="kb-admin-field"><span>Краткое определение</span><textarea rows="3" data-foundation-definition>'+esc(t.definition||t.summary||"")+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Расширение</span><textarea rows="8" data-foundation-body>'+esc(foundationBodyText(t.body||[]))+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Материалы: одна строка = <b>название | ссылка</b></span><textarea rows="4" data-foundation-resources>'+esc(foundationResourcesText(t.resources||[]))+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Связанные термины: одна строка = <b>номер | название</b></span><textarea rows="3" data-foundation-related>'+esc(foundationRelatedText(t.related||[]))+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Ожидают добавления — одна строка</span><textarea rows="3" data-foundation-pending>'+esc((t.pendingResources||[]).join("\n"))+'</textarea></label>'+
    '</div></details>').join("")+'</div></section>';
}
function norms12Source(ctx){
  const s=ctx?.section||{},rows=Array.isArray(s.rawRows)?s.rawRows:(Array.isArray(s.rows)?s.rows:[]);
  const units=[],reading=[],steps=[];let mode="";
  const heads={"1. Нормативные документы":"docs","2. Обозначения и единицы измерения":"units","3. Как читать показатели и таблицы":"reading","Порядок подбора товара":"steps"};
  const skip=new Set(["Документ","Обозначение","Показатель / обозначение","Шаг"]);
  for(const r of rows){
    const a=String(r?.[0]||"").trim();if(!a)continue;
    if(heads[a]){mode=heads[a];continue}
    if(/^Важно:/i.test(a)||skip.has(a))continue;
    if(mode==="units")units.push(r);
    else if(mode==="reading")reading.push(r);
    else if(mode==="steps")steps.push([String(r?.[0]||"").trim(),String(r?.[1]||"").trim()]);
  }
  const records=[];
  for(const r of units){
    const label=String(r?.[0]||"").trim(),meaning=String(r?.[1]||"").trim(),where=String(r?.[2]||"").trim();if(!label)continue;
    records.push({label,meaning,definition:meaning,whereSource:where,example:"",important:"",detailsText:[],type:"abbreviation"});
  }
  for(const r of reading){
    const label=String(r?.[0]||"").trim(),definition=String(r?.[1]||"").trim(),example=String(r?.[2]||"").trim(),important=String(r?.[3]||"").trim();if(!label)continue;
    records.push({label,meaning:"",definition,whereSource:"",example,important,detailsText:[],type:"concept"});
  }
  for(const t of (s.glossaryTerms||[])){
    const label=String(t?.label||"").trim();if(!label)continue;
    records.push({label,meaning:"",definition:String(t?.summary||"").trim(),whereSource:String(t?.where||"").trim(),example:"",important:"",detailsText:Array.isArray(t?.details)?t.details.map(x=>String(x||"")):[],type:String(t?.type||"concept")});
  }
  return {
    records:Array.isArray(s.norms12Records)?deep(s.norms12Records):records,
    steps:Array.isArray(s.norms12Steps)?deep(s.norms12Steps):steps
  };
}
function norms12RecordHtml(r,index){
  return '<details class="kb-admin-group" data-norms12-record open>'+
    '<summary><strong>'+esc(r.label||("Запись "+(index+1)))+'</strong><small>редактировать</small></summary>'+
    '<div class="kb-admin-grid">'+
      '<label class="kb-admin-field"><span>Термин / обозначение</span><input data-norms12-label value="'+esc(r.label||"")+'"></label>'+
      '<label class="kb-admin-field"><span>Расшифровка / значение</span><textarea rows="2" data-norms12-meaning>'+esc(r.meaning||"")+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Краткое определение</span><textarea rows="3" data-norms12-definition>'+esc(r.definition||"")+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Где используется</span><textarea rows="2" data-norms12-where>'+esc(r.whereSource||"")+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Пример</span><textarea rows="2" data-norms12-example>'+esc(r.example||"")+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Важно</span><textarea rows="2" data-norms12-important>'+esc(r.important||"")+'</textarea></label>'+
      '<label class="kb-admin-field kb-admin-span-2"><span>Подробнее — каждый абзац с новой строки</span><textarea rows="5" data-norms12-details>'+esc((r.detailsText||[]).join("\n"))+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Тип</span><select data-norms12-type><option value="concept"'+(r.type==="concept"?" selected":"")+'>Термин</option><option value="abbreviation"'+(r.type==="abbreviation"?" selected":"")+'>Сокращение / обозначение</option></select></label>'+
      '<div class="kb-admin-field"><span>Действие</span><button type="button" class="kb-admin-btn danger" data-norms12-remove>Удалить запись</button></div>'+
    '</div></details>';
}
function norms12EditorHtml(ctx){
  const src=norms12Source(ctx);
  return '<section class="kb-admin-section"><div class="kb-product-section-head"><div><h3>Сокращения, обозначения и единицы измерения</h3><p class="kb-admin-hint">Здесь редактируются именно те карточки, которые видны в разделе 1.2. Текст сохраняется без автоматического переписывания.</p></div><button type="button" class="kb-admin-btn primary" data-norms12-add>+ Добавить запись</button></div>'+
    '<div data-norms12-list>'+src.records.map(norms12RecordHtml).join("")+'</div>'+
    '<div class="kb-product-section-head"><div><h3>Порядок подбора товара</h3><p class="kb-admin-hint">Шаги из нижней памятки раздела 1.2.</p></div><button type="button" class="kb-admin-btn ghost" data-norms12-step-add>+ Добавить шаг</button></div>'+
    '<div data-norms12-steps>'+src.steps.map((r,i)=>'<div class="kb-admin-row" data-norms12-step><input data-norms12-step-label value="'+esc(r?.[0]||"")+'" placeholder="Шаг"><textarea rows="2" data-norms12-step-text placeholder="Описание">'+esc(r?.[1]||"")+'</textarea><button type="button" class="kb-admin-btn danger" data-norms12-step-remove>×</button></div>').join("")+'</div>'+
  '</section>';
}
function readNorms12(form){
  const records=[...form.querySelectorAll("[data-norms12-record]")].map(el=>({
    label:el.querySelector("[data-norms12-label]")?.value.trim()||"",
    meaning:el.querySelector("[data-norms12-meaning]")?.value.trim()||"",
    definition:el.querySelector("[data-norms12-definition]")?.value.trim()||"",
    whereSource:el.querySelector("[data-norms12-where]")?.value.trim()||"",
    example:el.querySelector("[data-norms12-example]")?.value.trim()||"",
    important:el.querySelector("[data-norms12-important]")?.value.trim()||"",
    detailsText:parseLines(el.querySelector("[data-norms12-details]")?.value||""),
    type:el.querySelector("[data-norms12-type]")?.value||"concept"
  })).filter(x=>x.label);
  const steps=[...form.querySelectorAll("[data-norms12-step]")].map(el=>[
    el.querySelector("[data-norms12-step-label]")?.value.trim()||"",
    el.querySelector("[data-norms12-step-text]")?.value.trim()||""
  ]).filter(r=>r[0]||r[1]);
  return {records,steps};
}

function renderSectionEditor(ctx){
  const existing=deep(overrideCache.sections?.[ctx.id]||{});
  const sheet="";
  const content=ctx.id==="1.1"
    ?foundationTermsEditorHtml(ctx)
    :ctx.id==="1.2"
      ?norms12EditorHtml(ctx)
      :sectionProductsEditor(ctx)+sectionBuilderHtml(ctx)+
      '<details class="kb-admin-group"><summary>Старые структурированные данные <small>резерв</small></summary><p class="kb-admin-hint">Оставлены для совместимости со старыми разделами. Новое содержимое редактируй выше — визуальным конструктором.</p>'+
      '<label class="kb-admin-field"><span>Пары «название → значение»</span><textarea rows="7" data-section-pairs>'+esc(pairText((ctx.section.pairs||[]).map(x=>[x.label,x.value])))+'</textarea></label>'+
      '<label class="kb-admin-field"><span>Заметки — одна на строку</span><textarea rows="5" name="notes">'+esc((ctx.section.notes||[]).join("\n"))+'</textarea></label></details>';
  setBody(shell(ctx.id+" · "+ctx.section.title,"Редактирование раздела",
    '<form data-admin-section data-id="'+esc(ctx.id)+'" class="kb-admin-form">'+
    '<label>Название раздела<input name="title" value="'+esc(ctx.section.title||"")+'"></label>'+
    (sheet?'<p><a class="kb-admin-link" target="_blank" rel="noopener" href="'+sheet+'">Открыть этот лист Google Sheets ↗</a></p>':"")+
    content+
    '<details class="kb-admin-group"><summary>Расширенный JSON раздела</summary><label class="kb-admin-field"><span>Для редких полей. Основной редактор выше сохраняется в ручных правках.</span><textarea rows="14" data-section-json>'+esc(jsonText(existing))+'</textarea></label></details>'+
    '<div class="kb-admin-savebar"><button class="kb-admin-btn primary" type="submit">Сохранить раздел</button><button class="kb-admin-btn danger" type="button" data-reset-section>Сбросить ручные правки</button></div></form>'));
}
function renderChapterEditor(ctx){
  setBody(shell("Глава "+ctx.id,ctx.chapter.title,
    '<form data-admin-chapter data-id="'+esc(ctx.id)+'" class="kb-admin-form"><label>Название главы<input name="title" value="'+esc(ctx.chapter.title||"")+'"></label><div class="kb-admin-savebar"><button class="kb-admin-btn primary" type="submit">Сохранить главу</button><button class="kb-admin-btn danger" type="button" data-reset-chapter>Сбросить ручные правки</button></div></form>'));
}
function bindBody(){
  const body=document.querySelector(".kb-admin-page")||modal?.querySelector("#kbAdminBody");if(!body)return;
  body.querySelector("[data-account-login]")?.addEventListener("submit",async e=>{
    e.preventDefault();const password=new FormData(e.currentTarget).get("password")||"";
    if(await sha256(password)!==ADMIN_PASSWORD_HASH){e.currentTarget.querySelector("[data-account-login-error]").textContent="Неверный пароль.";return}
    sessionStorage.setItem(ADMIN_SESSION_KEY,"1");
    if(window.KB_ADMIN_PAGE?.render)await window.KB_ADMIN_PAGE.render();
    else location.hash="#/account";
  });
  body.querySelector("[data-account-version]")?.addEventListener("click",()=>document.querySelector("#versionLogBtn")?.click());
  body.querySelector("[data-account-back]")?.addEventListener("click",()=>{
    const r=window.KB_EDITOR_API?.route?.()||{};
    const sectionId=r.name==="accountProduct"?(editorCtx?.section?.id||editorCtx?.sourceSection?.id||""):"";
    location.hash=sectionId?"#/account/section/"+encodeURIComponent(sectionId):"#/account";
  });
  const applyAccountFilters=()=>{
    const qv=String(body.querySelector("[data-account-search]")?.value||"").trim().toLowerCase();
    const mode=body.querySelector("[data-account-filter].active")?.dataset.accountFilter||"all";
    let shown=0;
    body.querySelectorAll("[data-account-section-card]").forEach(section=>{
      let sectionShown=0;
      section.querySelectorAll("[data-account-product-card]").forEach(card=>{
        const matchesText=!qv||String(card.dataset.accountProductSearch||"").toLowerCase().includes(qv);
        const quality=Number(card.dataset.quality||0),hasPhoto=card.dataset.hasPhoto==="1";
        const matchesMode=mode==="all"||(mode==="improve"&&quality<75)||(mode==="photo"&&hasPhoto);
        const ok=matchesText&&matchesMode;card.hidden=!ok;if(ok)sectionShown++;
      });
      section.hidden=sectionShown===0;if(sectionShown)shown++;
    });
    const empty=body.querySelector("[data-account-empty]");if(empty)empty.hidden=shown>0;
  };
  body.querySelector("[data-account-search]")?.addEventListener("input",applyAccountFilters);
  body.querySelectorAll("[data-account-filter]").forEach(b=>b.addEventListener("click",()=>{
    body.querySelectorAll("[data-account-filter]").forEach(x=>x.classList.toggle("active",x===b));applyAccountFilters();
  }));
  body.querySelector("[data-account-clear]")?.addEventListener("click",()=>{
    const input=body.querySelector("[data-account-search]");if(input)input.value="";
    const all=body.querySelector('[data-account-filter="all"]');body.querySelectorAll("[data-account-filter]").forEach(x=>x.classList.toggle("active",x===all));applyAccountFilters();
  });
  body.querySelector("[data-account-add-first]")?.addEventListener("click",async()=>{
    const sections=editorSectionList();if(!sections.length)return showError(new Error("Нет доступных разделов."));
    const suggested=sections[0].id,answer=prompt("В какой раздел создать карточку? Введите номер раздела, например 2.10.",suggested);
    if(answer==null)return;const target=sections.find(s=>s.id===String(answer).trim());
    if(!target)return showError(new Error("Раздел "+String(answer).trim()+" не найден."));
    const name=prompt("Название новой карточки","Новая карточка");if(name==null)return;
    try{showStatus("Создаём карточку…");await createManualProduct(target.id,name)}catch(err){showError(err)}
  });
  body.querySelectorAll("[data-account-edit-product]").forEach(b=>b.addEventListener("click",()=>location.hash="#/account/product/"+encodeURIComponent(b.dataset.accountEditProduct)));
  body.querySelectorAll("[data-account-manage-section]").forEach(b=>b.addEventListener("click",()=>location.hash="#/account/section/"+encodeURIComponent(b.dataset.accountManageSection)));
  body.querySelectorAll("[data-account-add-product]").forEach(b=>b.addEventListener("click",async()=>{
    const name=prompt("Название новой карточки","Новая карточка");if(name==null)return;
    try{showStatus("Создаём карточку…");await createManualProduct(b.dataset.accountAddProduct,name)}catch(err){showError(err)}
  }));
  body.querySelectorAll("[data-account-duplicate-product]").forEach(b=>b.addEventListener("click",async()=>{
    const id=b.dataset.accountDuplicateProduct,ctx=window.KB_EDITOR_API?.product?.(id);if(!ctx)return;
    if(!confirm('Создать копию «'+(ctx.product?.name||id)+'» в этом же разделе?'))return;
    try{showStatus("Создаём копию…");await duplicateProductTo(id,ctx.section.id)}catch(err){showError(err)}
  }));
  body.querySelectorAll("[data-account-delete-product]").forEach(b=>b.addEventListener("click",async()=>{
    const id=b.dataset.accountDeleteProduct,ctx=window.KB_EDITOR_API?.product?.(id);if(!ctx)return;
    if(!confirm('Удалить карточку «'+(ctx.product?.name||id)+'» с сайта?'))return;
    try{
      showStatus("Удаляем карточку…");await deleteProductById(id);
      const row=b.closest("[data-account-product-card]"),section=row?.closest("[data-account-section-card]");
      row?.remove();
      if(section&&!section.querySelector("[data-account-product-card]"))section.remove();
      updateAccountCounters(body);
      showStatus("Карточка удалена.");
    }catch(err){showError(err)}
  }));
  body.querySelector("[data-norms12-add]")?.addEventListener("click",()=>{
    const list=body.querySelector("[data-norms12-list]");if(!list)return;
    list.insertAdjacentHTML("beforeend",norms12RecordHtml({label:"",meaning:"",definition:"",whereSource:"",example:"",important:"",detailsText:[],type:"concept"},list.querySelectorAll("[data-norms12-record]").length));
  });
  body.querySelector("[data-norms12-step-add]")?.addEventListener("click",()=>{
    body.querySelector("[data-norms12-steps]")?.insertAdjacentHTML("beforeend",'<div class="kb-admin-row" data-norms12-step><input data-norms12-step-label value="" placeholder="Шаг"><textarea rows="2" data-norms12-step-text placeholder="Описание"></textarea><button type="button" class="kb-admin-btn danger" data-norms12-step-remove>×</button></div>');
  });
  body.addEventListener("click",e=>{
    const normsRemove=e.target.closest?.("[data-norms12-remove]");
    if(normsRemove){normsRemove.closest("[data-norms12-record]")?.remove();return}
    const normsStepRemove=e.target.closest?.("[data-norms12-step-remove]");
    if(normsStepRemove){normsStepRemove.closest("[data-norms12-step]")?.remove();return}
    const addTab=e.target.closest?.("[data-add-tab]");
    if(addTab){
      const form=body.querySelector("[data-admin-product]"),input=body.querySelector("[data-new-tab-label]");
      if(!form||!input)return;
      const label=input.value.trim();
      if(!label)return showError(new Error("Введите название новой вкладки."));
      const existingIds=new Set([
        ...body.querySelectorAll("[data-admin-tab-row]"),
        ...readCustomTabs(form).map(t=>({dataset:{id:String(t?.id||"")}}))
      ].map(x=>String(x.dataset.id||"")).filter(Boolean));
      const base="custom-"+safe(label),root=base==="custom-"?"custom-tab":base;
      let id=root,n=2;while(existingIds.has(id))id=root+"-"+n++;
      const tab={id,label,kind:"pairs",rows:[]};
      const tabs=readCustomTabs(form);tabs.push(tab);writeCustomTabs(form,tabs);
      body.querySelector("[data-tab-list]")?.insertAdjacentHTML("beforeend",tabRowHtml({id,label},editorCtx?.product||{},true));
      body.querySelector("[data-card-content]")?.insertAdjacentHTML("beforeend",customTabContentHtml(tab));
      const select=body.querySelector("[data-new-table-tab]");
      if(select&&!select.querySelector('option[value="'+CSS.escape(id)+'"]'))select.insertAdjacentHTML("beforeend",'<option value="'+esc(id)+'">'+esc(label)+'</option>');
      input.value="";
      showStatus("Вкладка «"+label+"» добавлена. Сохраните карточку, чтобы опубликовать её.");
      return;
    }
    const tabDelete=e.target.closest?.("[data-tab-delete], [data-remove-custom-tab]");
    if(tabDelete){
      const row=tabDelete.closest("[data-admin-tab-row]");
      const id=row?.dataset.id || tabDelete.closest("[data-custom-content-id]")?.dataset.customContentId;
      if(id){removeCustomTabUi(body,id);return}
    }
    const ed=e.target.closest("[data-table-editor]");if(!ed)return;
    const cell=e.target.closest("[data-table-cell-pos]");
    if(cell&&(e.ctrlKey||e.metaKey)){
      e.preventDefault();
      cell.classList.toggle("is-selected");
      return;
    }
    if(e.target.closest("[data-table-add-row]")){const data=readTableEditor(ed);data.rows.push(Array(data.headers.length).fill(""));refreshTableEditor(ed,data);return}
    if(e.target.closest("[data-table-add-col]")){const data=readTableEditor(ed);data.headers.push("Новый столбец");data.rows.forEach(r=>r.push(""));refreshTableEditor(ed,data);return}
    if(e.target.closest("[data-table-merge]")){mergeSelectedTableCells(ed);return}
    if(e.target.closest("[data-table-unmerge]")){unmergeSelectedTableCells(ed);return}
    if(e.target.closest("[data-table-merge-row]")){const tr=e.target.closest("[data-table-row]");mergeWholeTableRow(ed,Number(tr?.dataset.tableRowIndex||0));return}
    const rowMove=e.target.closest("[data-table-row-up],[data-table-row-down]");
    if(rowMove){
      const tr=rowMove.closest("[data-table-row]"),index=Number(tr?.dataset.tableRowIndex||0),data=readTableEditor(ed);
      const delta=rowMove.matches("[data-table-row-up]")?-1:1,next=index+delta;
      if(next<0||next>=data.rows.length)return;
      if((data.merges||[]).some(m=>m.rowspan>1))return showError(new Error("Сначала разъедините вертикально объединённые ячейки, затем меняйте порядок строк."));
      [data.rows[index],data.rows[next]]=[data.rows[next],data.rows[index]];
      data.merges=(data.merges||[]).map(m=>m.row===index?{...m,row:next}:m.row===next?{...m,row:index}:m);
      refreshTableEditor(ed,data);return;
    }
    const col=e.target.closest("[data-table-remove-col]");if(col){
      const data=readTableEditor(ed);if(data.headers.length<=1)return showError(new Error("В таблице должен остаться хотя бы один столбец."));
      const index=Number(col.dataset.tableRemoveCol);data.headers.splice(index,1);data.rows.forEach(r=>r.splice(index,1));
      data.merges=data.merges.flatMap(m=>{if(m.col>index){m.col--;return[m]}if(m.col+m.colspan-1<index)return[m];if(m.col===index&&m.colspan>1){m.colspan--;return m.colspan>1?[m]:[]}if(m.col<index&&m.col+m.colspan-1>=index){m.colspan--;return m.colspan>1?[m]:[]}return[]});
      refreshTableEditor(ed,data);return;
    }
    if(e.target.closest("[data-table-remove-row]")){
      const tr=e.target.closest("[data-table-row]"),index=Number(tr?.dataset.tableRowIndex||0),data=readTableEditor(ed);data.rows.splice(index,1);
      data.merges=data.merges.flatMap(m=>{if(m.row>index){m.row--;return[m]}if(m.row+m.rowspan-1<index)return[m];if(m.row===index&&m.rowspan>1){m.rowspan--;return m.rowspan>1?[m]:[]}if(m.row<index&&m.row+m.rowspan-1>=index){m.rowspan--;return m.rowspan>1?[m]:[]}return[]});
      refreshTableEditor(ed,data);return;
    }
    if(e.target.closest("[data-table-delete]")){ed.remove();return}
  });
  let draggedPairRow=null;
  const bindPairDrag=row=>{
    if(!row||row.dataset.pairDragBound==="1")return;
    row.dataset.pairDragBound="1";
    const handle=row.querySelector("[data-pair-drag]");
    if(!handle)return;
    row.setAttribute("draggable","false");
    handle.setAttribute("draggable","true");
    handle.addEventListener("dragstart",e=>{
      draggedPairRow=row;
      e.dataTransfer?.setData("text/plain","pair");
      if(e.dataTransfer)e.dataTransfer.effectAllowed="move";
      row.classList.add("is-dragging");
    });
    handle.addEventListener("dragend",()=>{
      row.classList.remove("is-dragging");
      draggedPairRow=null;
    });
    row.addEventListener("dragover",e=>{
      if(!draggedPairRow||draggedPairRow===row)return;
      e.preventDefault();
      if(e.dataTransfer)e.dataTransfer.dropEffect="move";
      const box=row.getBoundingClientRect();
      const after=e.clientY>box.top+box.height/2;
      row.parentElement?.insertBefore(draggedPairRow,after?row.nextSibling:row);
    });
  };
  body.querySelectorAll("[data-pair-editor=\"detailFields\"] [data-pair-row]").forEach(bindPairDrag);

  body.querySelectorAll("[data-tab-up]").forEach(b=>b.onclick=()=>{const r=b.closest("[data-admin-tab-row]");r?.previousElementSibling?.before(r)});
  body.querySelectorAll("[data-tab-down]").forEach(b=>b.onclick=()=>{const r=b.closest("[data-admin-tab-row]");r?.nextElementSibling?.after(r)});

  body.querySelector("[data-duplicate-here]")?.addEventListener("click",async()=>{
    const id=body.querySelector("[data-admin-product]")?.dataset.id||editorCtx?.id;if(!id)return;
    if(!confirm("Создать полную копию этой карточки в текущем разделе?"))return;
    try{showStatus("Создаём копию карточки…");await duplicateProductTo(id,editorCtx?.section?.id)}catch(err){showError(err)}
  });
  body.querySelector("[data-copy-to-section]")?.addEventListener("click",async()=>{
    const id=body.querySelector("[data-admin-product]")?.dataset.id||editorCtx?.id,target=body.querySelector("[data-product-target-section]")?.value;
    if(!id||!target)return;
    if(!confirm("Скопировать карточку в раздел "+target+"? Исходная карточка останется на месте."))return;
    try{showStatus("Копируем карточку…");await duplicateProductTo(id,target)}catch(err){showError(err)}
  });
  body.querySelector("[data-move-to-section]")?.addEventListener("click",async()=>{
    const id=body.querySelector("[data-admin-product]")?.dataset.id||editorCtx?.id,target=body.querySelector("[data-product-target-section]")?.value;
    if(!id||!target)return;
    if(target===editorCtx?.section?.id)return showError(new Error("Для переноса выберите другой раздел."));
    if(!confirm("Перенести карточку в раздел "+target+"? В текущем разделе она будет удалена."))return;
    try{showStatus("Переносим карточку…");await duplicateProductTo(id,target,{move:true})}catch(err){showError(err)}
  });
  body.querySelector("[data-delete-current-product]")?.addEventListener("click",async()=>{
    const id=body.querySelector("[data-admin-product]")?.dataset.id||editorCtx?.id;if(!id)return;
    if(!confirm('Удалить карточку «'+(editorCtx?.product?.name||id)+'» с сайта?'))return;
    try{
      showStatus("Удаляем карточку…");await deleteProductById(id,{navigate:true});
      showStatus("Карточка удалена.");
    }catch(err){showError(err)}
  });
  let photoReplaceRow=null;
  const documentInput=body.querySelector("[data-document-file]");
  body.querySelector("[data-document-add]")?.addEventListener("click",()=>{if(documentInput){documentInput.value="";documentInput.click()}});
  documentInput?.addEventListener("change",async()=>{
    const files=[...(documentInput.files||[])];if(!files.length)return;
    const list=body.querySelector("[data-document-list]"),id=body.querySelector("[data-admin-product]")?.dataset.id||editorCtx?.id;
    try{
      showStatus("Загружаем документы…");
      for(const file of files){
        const rows=[...body.querySelectorAll("[data-document-row]")],path=nextDocumentPath(id,file,rows);
        await uploadDocument(file,path);
        list?.insertAdjacentHTML("beforeend",documentRowHtml({name:file.name,path},rows.length));
      }
      await persistDocumentsOnly(body);
      showStatus("Документы загружены и привязаны к карточке.");
    }catch(err){showError(err)}
  });
  const photoAddInput=body.querySelector("[data-photo-file]"),photoReplaceInput=body.querySelector("[data-photo-replace-file]");
  body.querySelector("[data-photo-add]")?.addEventListener("click",()=>{if(photoAddInput){photoAddInput.value="";photoAddInput.click()}});
  photoAddInput?.addEventListener("change",async()=>{
    const files=[...(photoAddInput.files||[])];if(!files.length)return;
    try{setPhotoSaveState(body,"saving");showStatus("Загружаем фото…");const list=body.querySelector("[data-photo-list]"),id=body.querySelector("[data-admin-product]")?.dataset.id||editorCtx?.id;
      for(const file of files){const prepared=await optimizePhotoFile(file),path=nextPhotoPath(id,syncPhotoState(body),imageExt(prepared));await uploadPhoto(prepared,path);list?.insertAdjacentHTML("beforeend",photoRowHtml(path,list.querySelectorAll("[data-photo-row]").length))}
      syncPhotoState(body);await persistImagesOnly(body);showStatus("Фото добавлено и опубликовано.");
    }catch(err){setPhotoSaveState(body,"error",err?.message||"Не удалось сохранить фото.");showError(err)}
  });
  body.addEventListener("click",async e=>{
    const docRemove=e.target.closest?.("[data-document-remove]");
    if(docRemove){
      const row=docRemove.closest("[data-document-row]");if(!row||!confirm("Убрать этот файл из карточки?"))return;
      row.remove();try{await persistDocumentsOnly(body);showStatus("Файл убран из карточки.")}catch(err){showError(err)}return;
    }
    const docUp=e.target.closest?.("[data-document-up]");
    if(docUp){const r=docUp.closest("[data-document-row]");r?.previousElementSibling?.before(r);try{await persistDocumentsOnly(body)}catch(err){showError(err)}return}
    const docDown=e.target.closest?.("[data-document-down]");
    if(docDown){const r=docDown.closest("[data-document-row]");r?.nextElementSibling?.after(r);try{await persistDocumentsOnly(body)}catch(err){showError(err)}return}
    const replace=e.target.closest?.("[data-photo-replace]");if(replace){photoReplaceRow=replace.closest("[data-photo-row]");if(photoReplaceInput){photoReplaceInput.value="";photoReplaceInput.click()}return}
    const remove=e.target.closest?.("[data-photo-remove]");if(remove){const row=remove.closest("[data-photo-row]");if(!row||!confirm("Удалить это фото из карточки товара?"))return;row.remove();syncPhotoState(body);try{setPhotoSaveState(body,"saving");await persistImagesOnly(body);showStatus("Фото удалено из карточки.")}catch(err){setPhotoSaveState(body,"error",err?.message||"Не удалось сохранить удаление фото.");showError(err)}return}
    const up=e.target.closest?.("[data-photo-up]");if(up){const row=up.closest("[data-photo-row]");row?.previousElementSibling?.before(row);syncPhotoState(body);try{setPhotoSaveState(body,"saving");await persistImagesOnly(body);showStatus("Порядок фото сохранён.")}catch(err){setPhotoSaveState(body,"error",err?.message||"Не удалось сохранить порядок фото.");showError(err)}return}
    const down=e.target.closest?.("[data-photo-down]");if(down){const row=down.closest("[data-photo-row]");row?.nextElementSibling?.after(row);syncPhotoState(body);try{setPhotoSaveState(body,"saving");await persistImagesOnly(body);showStatus("Порядок фото сохранён.")}catch(err){setPhotoSaveState(body,"error",err?.message||"Не удалось сохранить порядок фото.");showError(err)}return}
  });
  photoReplaceInput?.addEventListener("change",async()=>{
    const file=photoReplaceInput.files?.[0],row=photoReplaceRow;photoReplaceRow=null;if(!file||!row)return;
    try{setPhotoSaveState(body,"saving");showStatus("Заменяем фото…");const id=body.querySelector("[data-admin-product]")?.dataset.id||editorCtx?.id,prepared=await optimizePhotoFile(file),newPath=nextPhotoPath(id,syncPhotoState(body),imageExt(prepared));await uploadPhoto(prepared,newPath);row.dataset.path=newPath;const img=row.querySelector("img");if(img)img.src=photoPreviewSrc(newPath)+"?v="+Date.now();const code=row.querySelector("code");if(code)code.textContent=newPath;syncPhotoState(body);await persistImagesOnly(body);showStatus("Фото заменено и опубликовано.");}catch(err){setPhotoSaveState(body,"error",err?.message||"Не удалось заменить фото.");showError(err)}
  });

  body.addEventListener("click",e=>{
    const addCol=e.target.closest?.("[data-pair-add-col]");
    if(addCol){
      const ed=addCol.closest("[data-pair-editor]"),list=ed?.querySelector("[data-pair-list]");
      if(!ed||!list)return;
      const headers=[...list.querySelectorAll("[data-pair-header]")];
      const index=headers.length;
      const label=index===0?"Название характеристики":index===1?(ed.dataset.pairEditor==="advantages"?"Описание":"Значение"):"Дополнительный столбец "+(index-1);
      const h=document.createElement("div");h.className="kb-pair-header-cell";h.innerHTML='<input data-pair-header placeholder="Название столбца" value="'+esc(label)+'"><button type="button" class="kb-pair-col-remove" data-pair-remove-col title="Удалить столбец">×</button>';
      list.querySelector("[data-pair-header-row]")?.insertBefore(h,list.querySelector("[data-pair-header-row] > span"));
      list.querySelectorAll("[data-pair-row]").forEach(row=>{
        const input=document.createElement("input");input.dataset.pairCell=String(index);input.placeholder=label;row.insertBefore(input,row.querySelector("[data-pair-remove]"));
      });
      list.dataset.pairWidth=String(index+1);list.style.setProperty("--pair-width",String(index+1));
      return;
    }
    const removeCol=e.target.closest?.("[data-pair-remove-col]");
    if(removeCol){
      const ed=removeCol.closest("[data-pair-editor]"),list=ed?.querySelector("[data-pair-list]");
      const cell=removeCol.closest(".kb-pair-header-cell"),headers=[...list.querySelectorAll("[data-pair-header]")],index=headers.indexOf(cell?.querySelector("[data-pair-header]"));
      if(index<2)return;
      list.querySelectorAll("[data-pair-row]").forEach(row=>row.querySelector('[data-pair-cell="'+index+'"]')?.remove());
      cell?.remove();
      list.querySelectorAll("[data-pair-row]").forEach(row=>[...row.querySelectorAll("[data-pair-cell]")].forEach((input,i)=>input.dataset.pairCell=String(i)));
      return;
    }
    const add=e.target.closest?.("[data-pair-add]");
    if(add){
      const ed=add.closest("[data-pair-editor]"),list=ed?.querySelector("[data-pair-list]");
      if(!ed||!list)return;
      const width=Number(list.dataset.pairWidth||2),headers=[...list.querySelectorAll("[data-pair-header]")].map(x=>x.value.trim());
      const row=document.createElement("div");row.className="kb-pair-row";row.dataset.pairRow="";row.setAttribute("draggable","false");row.style.gridTemplateColumns="30px repeat("+width+",minmax(220px,1fr)) 26px";row.style.setProperty("--pair-width",String(width));
      row.innerHTML='<button type="button" class="kb-pair-drag" data-pair-drag title="Перетащить строку" aria-label="Перетащить строку">⋮⋮</button>'+
        Array.from({length:width},(_,i)=>'<input data-pair-cell="'+i+'" placeholder="'+esc(headers[i]||("Столбец "+(i+1)))+'">').join("")+
        '<button type="button" class="kb-mini danger" data-pair-remove title="Удалить строку">×</button>';
      list.appendChild(row);
      bindPairDrag(row);
      row.querySelector("[data-pair-cell]")?.focus();
      return;
    }
    const remove=e.target.closest?.("[data-pair-remove]");
    if(remove){
      const rows=remove.closest("[data-pair-list]")?.querySelectorAll("[data-pair-row]")||[];
      if(rows.length<=1){remove.closest("[data-pair-row]")?.querySelectorAll("input").forEach(x=>x.value="");return}
      remove.closest("[data-pair-row]")?.remove();
    }
  });
  body.querySelector("[data-add-product]")?.addEventListener("click",async()=>{
    const sectionId=body.querySelector("[data-admin-section]")?.dataset.id;if(!sectionId)return;
    const name=prompt("Название новой карточки","Новая карточка");if(name==null)return;
    try{showStatus("Создаём карточку…");await createManualProduct(sectionId,name)}catch(err){showError(err)}
  });
  body.querySelectorAll("[data-open-section-product]").forEach(b=>b.onclick=()=>{
    const id=b.closest("[data-section-product-row]")?.dataset.id;if(id)location.hash="#/account/product/"+encodeURIComponent(id);
  });
  body.querySelectorAll("[data-product-up]").forEach(b=>b.onclick=async()=>{const r=b.closest("[data-section-product-row]");if(!r?.previousElementSibling)return;r.previousElementSibling.before(r);try{showStatus("Сохраняем порядок…");await persistSectionProductOrder(body);showStatus("Порядок карточек сохранён.")}catch(err){showError(err)}});
  body.querySelectorAll("[data-product-down]").forEach(b=>b.onclick=async()=>{const r=b.closest("[data-section-product-row]");if(!r?.nextElementSibling)return;r.nextElementSibling.after(r);try{showStatus("Сохраняем порядок…");await persistSectionProductOrder(body);showStatus("Порядок карточек сохранён.")}catch(err){showError(err)}});
  body.querySelectorAll("[data-product-hidden]").forEach(ch=>ch.onchange=()=>ch.closest("[data-section-product-row]")?.classList.toggle("is-hidden",ch.checked));
  body.querySelectorAll("[data-product-delete]").forEach(b=>b.onclick=async()=>{
    const r=b.closest("[data-section-product-row]");if(!r)return;
    const id=r.dataset.id,name=r.querySelector(".kb-product-sort-name strong")?.textContent||"эту карточку";
    if(!id||!confirm('Удалить «'+name+'» с сайта?'))return;
    try{
      b.disabled=true;showStatus("Удаляем карточку…");
      await deleteProductById(id);
      r.remove();
      showStatus("Карточка удалена.");
    }catch(err){b.disabled=false;showError(err)}
  });
  let draggedProduct=null,productOrderChanged=false;
  body.querySelectorAll("[data-section-product-row]").forEach(row=>{
    const handle=row.querySelector("[data-product-drag]");
    if(!handle)return;
    row.setAttribute("draggable","false");
    handle.addEventListener("dragstart",e=>{
      draggedProduct=row;productOrderChanged=false;
      e.dataTransfer?.setData("text/plain",row.dataset.id||"product");
      if(e.dataTransfer)e.dataTransfer.effectAllowed="move";
      row.classList.add("is-dragging");
    });
    handle.addEventListener("dragend",async()=>{
      row.classList.remove("is-dragging");
      draggedProduct=null;
      body.querySelectorAll("[data-section-product-row]").forEach(x=>x.classList.remove("is-drop-target"));
      if(!productOrderChanged)return;
      try{showStatus("Сохраняем новый порядок карточек…");await persistSectionProductOrder(body);showStatus("Порядок карточек сохранён.")}
      catch(err){showError(err)}
      finally{productOrderChanged=false}
    });
    row.addEventListener("dragover",e=>{
      if(!draggedProduct||draggedProduct===row)return;
      e.preventDefault();
      if(e.dataTransfer)e.dataTransfer.dropEffect="move";
      const box=row.getBoundingClientRect(),after=e.clientY>box.top+box.height/2;
      const before=after?row.nextSibling:row;
      if(before!==draggedProduct&&before!==draggedProduct.nextSibling){
        row.parentElement?.insertBefore(draggedProduct,before);
        productOrderChanged=true;
      }
      body.querySelectorAll("[data-section-product-row]").forEach(x=>x.classList.toggle("is-drop-target",x===row));
    });
    row.addEventListener("dragleave",()=>row.classList.remove("is-drop-target"));
    row.addEventListener("drop",e=>{e.preventDefault();row.classList.remove("is-drop-target")});
  });
    body.querySelector("[data-admin-product]")?.addEventListener("submit",saveProduct);
  body.querySelector("[data-admin-section]")?.addEventListener("submit",saveSection);
  body.querySelector("[data-admin-chapter]")?.addEventListener("submit",saveChapter);
  body.querySelector("[data-reset-product]")?.addEventListener("click",()=>resetOverride("products",body.querySelector("[data-admin-product]")?.dataset.id));
  body.querySelector("[data-reset-section]")?.addEventListener("click",()=>resetOverride("sections",body.querySelector("[data-admin-section]")?.dataset.id));
  body.querySelector("[data-reset-chapter]")?.addEventListener("click",()=>resetOverride("chapters",body.querySelector("[data-admin-chapter]")?.dataset.id));
}
function putDiff(out,key,value,base){
  if(same(value,base))delete out[key];else out[key]=deep(value);
}
async function saveProduct(e){
  e.preventDefault();const form=e.currentTarget,id=form.dataset.id,btn=e.submitter;
  const photoState=form.querySelector("[data-photo-section]")?.dataset.photoState||"idle";
  if(photoState==="saving")return showError(new Error("Фото ещё сохраняется. Дождитесь зелёного подтверждения под блоком фотографий."));
  if(photoState==="error")return showError(new Error("Последнее изменение фото не сохранилось. Исправьте ошибку загрузки фото перед сохранением карточки."));
  btn.disabled=true;
  try{
    const ctx=window.KB_EDITOR_API.current(),fd=new FormData(form);

    // Карточка хранится как самостоятельный опубликованный снимок.
    // Google Sheets / book.json остаются только историческим импортным источником и
    // больше не являются базой, относительно которой считаются diff-правки.
    let out=deep(ctx.product||{});
    delete out.id;delete out.manual;delete out.sourceSectionId;delete out.sourceGid;
    delete out.sheetFields;delete out.rawRows;delete out.packedRows;delete out.appendDetailFields;

    const adv=form.querySelector("[data-advanced]")?.value.trim();
    if(adv){
      const extra=JSON.parse(adv);
      if(!extra||Array.isArray(extra)||typeof extra!=="object")throw new Error("Расширенный JSON должен быть объектом.");
      out={...out,...deep(extra)};
    }
    delete out.id;
    out.__frozen=true;

    for(const key of ["name","article","type","purpose"])out[key]=String(fd.get(key)||"");

    out.pairHeaders=deep(out.pairHeaders||{});
    for(const [key] of PAIR_FIELDS){
      const pair=collectPairRows(form,key);
      out[key]=deep(pair.rows);
      const defaultHeaders=key==="advantages"?["Преимущество","Описание"]:["Название характеристики","Значение"];
      if(pair.headers.some((h,i)=>h&&h!==defaultHeaders[i])||pair.headers.length>2)out.pairHeaders[key]=deep(pair.headers);
      else delete out.pairHeaders[key];
    }
    if(emptyObject(out.pairHeaders))delete out.pairHeaders;

    out.tabTables=collectTabTables(form);
    delete out.indicatorTable;
    out.substances=parseSubstances(form.querySelector("[data-substances]")?.value||"");
    out.customTabs=collectCustomTabs(form);

    const tabRows=[...form.querySelectorAll("[data-admin-tab-row]")];
    out.tabOrder=tabRows.map(r=>r.dataset.id);
    out.hiddenTabs=tabRows.filter(r=>r.querySelector("[data-tab-hidden]")?.checked).map(r=>r.dataset.id);
    const labels={};
    for(const r of tabRows){
      const id2=r.dataset.id,val=r.querySelector("[data-tab-label]")?.value.trim()||id2;
      const def=defaultTabLabel(id2,ctx.product||{});
      if(val!==def)labels[id2]=val;
    }
    out.tabLabels=labels;
    if(!out.tabOrder.length)delete out.tabOrder;
    if(!out.hiddenTabs.length)delete out.hiddenTabs;
    if(emptyObject(out.tabLabels))delete out.tabLabels;

    const images=parseLines(form.querySelector("[data-images]")?.value||"");
    if(images.length)out.images=deep(images);else delete out.images;
    const documents=collectDocuments(form);
    if(documents.length)out.documents=deep(documents);else delete out.documents;
    const imageSettings=collectPhotoSettings(form);
    if(!emptyObject(imageSettings))out.imageSettings=imageSettings;else delete out.imageSettings;

    const o=await loadOverrides();
    const isManual=Object.values(o.sections||{}).some(sec=>sec?.manualProducts&&Object.prototype.hasOwnProperty.call(sec.manualProducts,id));
    o.products[id]=deep(out);

    if(isManual){
      for(const sec of Object.values(o.sections||{})){
        if(sec?.manualProducts?.[id]){
          sec.manualProducts[id]={...deep(out),id,manual:true,sourceSectionId:sec.manualProducts[id].sourceSectionId||ctx.section?.id||""};
        }
      }
    }

    const committed=await commitOverrides(o);
    overrideCache=deep(committed);
    window.KB_EDITOR_API?.setProductOverride?.(id,committed.products?.[id]||out);
    editorCtx={...ctx,product:{...deep(ctx.product),...deep(out)},images:deep(images)};
    showStatus("Карточка закреплена на сайте и сохранена. Данные из таблиц больше не восстановят старый текст.");
    const returnSection=ctx.section?.id||ctx.sourceSection?.id||"";
    location.hash=returnSection?"#/account/section/"+encodeURIComponent(returnSection):"#/account";
  }catch(err){showError(err);btn.disabled=false}
}
async function saveSection(e){
  e.preventDefault();const form=e.currentTarget,id=form.dataset.id,btn=e.submitter;btn.disabled=true;
  try{
    const ctx=window.KB_EDITOR_API.current(),src=ctx.sourceSection||{},fd=new FormData(form);
    let out={};const raw=form.querySelector("[data-section-json]")?.value.trim();
    if(raw){out=JSON.parse(raw);if(!out||Array.isArray(out)||typeof out!=="object")throw new Error("JSON раздела должен быть объектом.");}
    putDiff(out,"title",String(fd.get("title")||""),String(src.title||""));
    if(id==="1.2"){
      const edited=readNorms12(form);
      out.norms12Records=edited.records;
      out.norms12Steps=edited.steps;
      const o=await loadOverrides();
      const previous=o.sections?.[id]||{};
      for(const key of ["glossaryTerms","manualProducts","productOrder","hiddenProductIds","deletedProductIds"])if(previous[key]!==undefined&&out[key]===undefined)out[key]=deep(previous[key]);
      o.sections[id]=out;
      await commitOverrides(o);overrideCache=deep(o);showStatus("Раздел 1.2 сохранён и опубликован.");location.hash="#/account/section/1.2";location.reload();return;
    }
    if(id==="1.1"){
      const terms=[...form.querySelectorAll("[data-foundation-edit-term]")].map(el=>{
        const number=Number(el.dataset.termNumber||0);
        const base=(ctx.sourceTerms11||[]).find(t=>Number(t.number)===number)||{};
        return {
          number,
          title:el.querySelector("[data-foundation-title]")?.value.trim()||String(base.title||"").trim(),
          definition:el.querySelector("[data-foundation-definition]")?.value.trim()||String(base.definition||"").trim(),
          body:parseFoundationBody(el.querySelector("[data-foundation-body]")?.value||""),
          resources:parseFoundationResources(el.querySelector("[data-foundation-resources]")?.value||""),
          related:parseFoundationRelated(el.querySelector("[data-foundation-related]")?.value||""),
          pendingResources:parseLines(el.querySelector("[data-foundation-pending]")?.value||"")
        };
      }).filter(t=>t.number&&t.title);
      putDiff(out,"terms11",terms,ctx.sourceTerms11||[]);
      const o=await loadOverrides();if(emptyObject(out))delete o.sections[id];else o.sections[id]=out;
      await commitOverrides(o);overrideCache=deep(o);showStatus("Термины 1.1 сохранены и опубликованы.");location.hash="#/account";location.reload();return;
    }
    const blocks=collectSectionContentBlocks(form);
    putDiff(out,"contentBlocks",blocks,src.contentBlocks||[]);
    // Keep manually created marketplace cards when saving the section itself.
    const existingSectionOverrides=(await loadOverrides()).sections?.[id]||{};
    if(existingSectionOverrides.manualProducts&&typeof existingSectionOverrides.manualProducts==="object"&&!Array.isArray(existingSectionOverrides.manualProducts)){
      out.manualProducts=deep(existingSectionOverrides.manualProducts);
    }
    const productRows=[...form.querySelectorAll("[data-section-product-row]")];
    const deletedRows=[...form.querySelectorAll("[data-section-deleted-row]")];
    if(productRows.length||deletedRows.length){
      const activeRows=productRows;
      const productOrder=activeRows.map(r=>r.dataset.id).filter(Boolean);
      const hiddenProductIds=activeRows.filter(r=>r.querySelector("[data-product-hidden]")?.checked).map(r=>r.dataset.id).filter(Boolean);
      const stillDeleted=deletedRows.filter(r=>!r.querySelector("[data-product-restore]")?.checked).map(r=>r.dataset.id).filter(Boolean);
      const deletedProductIds=[...new Set(stillDeleted)];
      putDiff(out,"productOrder",productOrder,src.productOrder||[]);
      putDiff(out,"hiddenProductIds",hiddenProductIds,src.hiddenProductIds||[]);
      putDiff(out,"deletedProductIds",deletedProductIds,src.deletedProductIds||[]);
    }
    const o=await loadOverrides();if(emptyObject(out))delete o.sections[id];else o.sections[id]=out;
    await commitOverrides(o);overrideCache=deep(o);showStatus("Раздел сохранён и опубликован.");location.hash="#/account";location.reload();
  }catch(err){showError(err);btn.disabled=false}
}
async function saveChapter(e){
  e.preventDefault();const form=e.currentTarget,id=form.dataset.id,btn=e.submitter;btn.disabled=true;
  try{
    const ctx=window.KB_EDITOR_API.current(),src=ctx.sourceChapter||{},title=String(new FormData(form).get("title")||""),out={};putDiff(out,"title",title,String(src.title||""));
    const o=await loadOverrides();if(emptyObject(out))delete o.chapters[id];else o.chapters[id]=out;
    await commitOverrides(o);overrideCache=deep(o);showStatus("Глава сохранена и опубликована.");location.hash="#/account";location.reload();
  }catch(err){showError(err);btn.disabled=false}
}
async function resetOverride(kind,id){
  if(!id)return;
  try{const o=await loadOverrides();delete o[kind][id];await commitOverrides(o);showStatus("Ручные правки сброшены.");location.reload()}catch(err){showError(err)}
}

window.addEventListener("kb:ready",ensureUI);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ensureUI);else ensureUI();
