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
  if(overrideCache&&!force)return overrideCache;
  const published=deep(window.KB_EDITOR_API?.overrides?.()||emptyOverrides());
  let local=null;try{local=JSON.parse(localStorage.getItem(LOCAL_KEY)||"null")||null}catch{}
  const pt=Date.parse(published.updatedAt||"")||0,lt=Date.parse(local?.updatedAt||"")||0;
  overrideCache=lt>pt?local:published;
  overrideCache ||= emptyOverrides();
  overrideCache.products ||= {};
  overrideCache.sections ||= {};
  overrideCache.chapters ||= {};
  return overrideCache;
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
async function commitOverrides(data){
  data.version=1;data.updatedAt=new Date().toISOString();
  if(!sessionToken())await connectGithub();
  await putRepoText("data/admin-overrides.json",JSON.stringify(data,null,2)+"\n","Admin: update knowledge book");
  localStorage.setItem(LOCAL_KEY,JSON.stringify(data));
  overrideCache=deep(data);
  return data;
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
function tableHeadersForTab(id,table){
  if(String(id)==="advantages")return ["Преимущества","Описание"];
  return (table?.headers?.length?table.headers:["Название","Значение"]).map(x=>String(x||""));
}
function tableEditorHtml(id,label,table){
  const headers=tableHeadersForTab(id,table);
  const width=Math.max(1,headers.length),rows=(table?.rows||[]).map(r=>Array.from({length:width},(_,i)=>String(r?.[i]||"")));
  return '<article class="kb-table-editor" data-table-editor data-table-id="'+esc(id)+'">'+
    '<div class="kb-table-editor-head"><div><strong>'+esc(label)+'</strong><code>'+esc(id)+'</code></div><div class="kb-table-actions"><button type="button" class="kb-mini" data-table-add-col>+ столбец</button><button type="button" class="kb-mini" data-table-add-row>+ строка</button><button type="button" class="kb-mini danger" data-table-delete>Удалить таблицу</button></div></div>'+
    '<div class="kb-table-scroll"><table class="kb-edit-table"><thead><tr>'+headers.map((h,i)=>'<th><div class="kb-cell-head"><input data-table-header value="'+esc(h)+'"><button type="button" class="kb-col-remove" data-table-remove-col="'+i+'" title="Удалить столбец">×</button></div></th>').join("")+'<th class="kb-row-tools"></th></tr></thead>'+
    '<tbody>'+rows.map(r=>tableRowHtml(r,width)).join("")+'</tbody></table></div></article>';
}
function tableRowHtml(row,width){
  return '<tr data-table-row>'+Array.from({length:width},(_,i)=>'<td><input data-table-cell value="'+esc(row?.[i]||"")+'"></td>').join("")+'<td class="kb-row-tools"><button type="button" class="kb-row-remove" data-table-remove-row title="Удалить строку">×</button></td></tr>';
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
    const id=ed.dataset.tableId,headers=[...ed.querySelectorAll("[data-table-header]")].map(x=>x.value.trim());
    const width=headers.length,rows=[...ed.querySelectorAll("[data-table-row]")].map(tr=>Array.from({length:width},(_,i)=>tr.querySelectorAll("[data-table-cell]")[i]?.value.trim()||"")).filter(r=>r.some(Boolean));
    if(id&&headers.some(Boolean))out[id]={headers,rows};
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
  return '<header class="kb-admin-head"><div><span class="kb-admin-kicker">Личный кабинет</span><h2>'+esc(title)+'</h2><p>'+esc(subtitle||"")+'</p></div>'+navButton+'</header>'+
  '<div class="kb-admin-toolbar"><button class="kb-admin-btn ghost" data-github-connect>'+(sessionToken()?'✓ GitHub подключен':'Подключить GitHub')+'</button><button class="kb-admin-btn ghost" data-admin-export>↓ Скачать резервную копию</button><label class="kb-admin-btn ghost kb-admin-import">↑ Загрузить резервную копию<input type="file" accept="application/json,.json" data-admin-import hidden></label><button class="kb-admin-btn ghost" data-admin-logout>Выйти</button><span class="kb-admin-devnote">Каталог хранится на сайте</span></div>'+
  '<div class="kb-admin-status" data-admin-status></div>'+inner;
}
async function renderAccountPage(){
  syncAccountEntry();
  const r=window.KB_EDITOR_API?.route?.()||{name:"account"};
  if(!adminActive()){
    setBody('<div class="kb-account-login"><div class="kb-account-login-card"><span class="kb-admin-kicker">Личный кабинет</span><h1>Вход в редактор</h1><p>Здесь управляется каталог товаров и содержимое Книги знаний.</p><form data-account-login><label>Пароль<input type="password" name="password" autocomplete="current-password" autofocus></label><button class="kb-admin-btn primary" type="submit">Войти</button><p class="kb-admin-login-error" data-account-login-error></p></form></div></div>');
    return;
  }
  if(r.name==="accountProduct"||r.name==="accountSection"){renderEditor().catch(showError);return;}
  const catalog=window.KB_EDITOR_API.catalog?.()||[];
  const sections=catalog.flatMap(ch=>ch.sections.filter(s=>s.products.length).map(sec=>({...sec,chapterId:ch.id,chapterTitle:ch.title})));
  const html=shell("Личный кабинет","Управление каталогом без Google Sheets",
    '<div class="kb-account-head"><div><h3>Каталог товаров</h3><p class="kb-admin-hint">Теперь это основная база сайта. Google Sheets больше не используется для повседневного редактирования.</p></div></div>'+
    '<div class="kb-account-search"><span>⌕</span><input type="search" data-account-search placeholder="Поиск по личному кабинету: товар, артикул, раздел…" autocomplete="off"></div>'+
    '<div class="kb-account-catalog">'+
    sections.map(sec=>'<section class="kb-account-section" data-account-section-card data-account-search-text="'+esc([sec.id,sec.title,sec.chapterTitle,...sec.products.flatMap(p=>[p.name,p.article])].join(" "))+'"><div class="kb-account-section-head"><div><span class="eyebrow">Глава '+esc(sec.chapterId)+'</span><h2>'+esc(sec.id+" "+sec.title)+'</h2></div><button class="kb-mini" data-account-section="'+esc(sec.id)+'">Редактировать раздел</button></div>'+
      '<div class="kb-account-products">'+sec.products.map(p=>'<article class="kb-account-product" data-account-product-card data-account-product-search="'+esc([p.name,p.article,sec.id,sec.title].join(" "))+'"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.article||"Без артикула")+'</small></div><button class="kb-admin-btn ghost" data-account-edit-product="'+esc(p.id)+'">✎</button></article>').join("")+'</div></section>').join("")+
    '</div><div class="kb-account-empty" data-account-empty hidden>По вашему запросу ничего не найдено.</div>');
  setBody(html);
}
window.KB_ADMIN_PAGE={render:()=>renderAccountPage().catch(showError)};
window.addEventListener("hashchange",syncAccountEntry);
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
function pairRowsEditorHtml(key,label,rows){
  const list=Array.isArray(rows)&&rows.length?rows:[["",""]];
  return '<details class="kb-admin-group kb-pair-editor" open data-pair-editor="'+esc(key)+'"><summary>'+esc(label)+' <small>'+list.filter(r=>r?.[0]||r?.[1]).length+' строк</small></summary><div class="kb-pair-list" data-pair-list>'+list.map((r,i)=>'<div class="kb-pair-row" data-pair-row><input data-pair-label placeholder="Название характеристики" value="'+esc(r?.[0]||"")+'"><span class="kb-pair-arrow">→</span><input data-pair-value placeholder="Значение" value="'+esc(r?.[1]||"")+'"><button type="button" class="kb-mini danger" data-pair-remove title="Удалить строку">×</button></div>').join("")+'</div><button type="button" class="kb-admin-btn ghost kb-pair-add" data-pair-add>+ Добавить характеристику</button></details>';
}
function collectPairRows(form,key){
  return [...form.querySelectorAll('[data-pair-editor="'+CSS.escape(key)+'"] [data-pair-row]')].map(r=>[
    r.querySelector("[data-pair-label]")?.value.trim()||"",
    r.querySelector("[data-pair-value]")?.value.trim()||""
  ]).filter(r=>r[0]||r[1]);
}
function productPairEditors(ctx){
  const standard=PAIR_FIELDS.filter(([key])=>(ctx.product?.[key]||[]).length>0&&key!=="detailFields").map(([key,label])=>'<details class="kb-admin-group"><summary>'+esc(label)+' <small>'+((ctx.product?.[key]||[]).length)+' строк</small></summary><label class="kb-admin-field"><span>Одна строка = <b>название | значение</b>. Порядок строк = порядок на сайте.</span><textarea rows="7" data-pair-key="'+key+'">'+esc(pairText(ctx.product?.[key]||[]))+'</textarea></label></details>');
  const characteristics=pairRowsEditorHtml("detailFields","Характеристики",ctx.product?.detailFields||[]);
  const custom=(ctx.product?.customTabs||[]).map(customTabContentHtml);
  return [characteristics,...standard, ...custom].join("");
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
function photoContextHtml(path,context,title,view){
  const v=photoContextSetting(view,context),scale=Math.round(v.scale*100),ratio="4:3";
  return '<section class="kb-photo-context" data-photo-context="'+context+'">'+
    '<div class="kb-photo-context-head"><div><strong>'+esc(title)+'</strong><span>'+ratio+'</span></div><button type="button" class="kb-mini primary" data-photo-auto>Автоподгон</button></div>'+
    '<div class="kb-photo-preview kb-photo-preview-'+context+'"><img src="'+esc(photoPreviewSrc(path))+'" alt="" style="'+esc(photoPreviewStyle(v))+'"></div>'+
    '<div class="kb-photo-controls">'+
      '<label><span>Масштаб</span><div class="kb-photo-range"><input type="range" min="60" max="400" step="5" value="'+scale+'" data-photo-scale><output data-photo-scale-out>'+scale+'%</output></div></label>'+
      '<label><span>Сдвиг X</span><div class="kb-photo-range"><input type="range" min="-60" max="60" step="1" value="'+v.x+'" data-photo-x><output data-photo-x-out>'+v.x+'</output></div></label>'+
      '<label><span>Сдвиг Y</span><div class="kb-photo-range"><input type="range" min="-60" max="60" step="1" value="'+v.y+'" data-photo-y><output data-photo-y-out>'+v.y+'</output></div></label>'+
      '<label><span>Режим</span><select data-photo-fit><option value="contain" '+(v.fit==="contain"?"selected":"")+'>Вписать целиком</option><option value="cover" '+(v.fit==="cover"?"selected":"")+'>Заполнить рамку</option></select></label>'+
    '</div>'+
    '<div class="kb-photo-quick"><button type="button" class="kb-mini" data-photo-preset-large>+ Крупнее</button><button type="button" class="kb-mini" data-photo-center>По центру</button><button type="button" class="kb-mini" data-photo-copy-context>Ко всем фото</button><button type="button" class="kb-mini" data-photo-reset-view>Сбросить</button></div>'+
  '</section>';
}
function photoRowHtml(path,index,view={}){
  return '<div class="kb-photo-row" data-photo-row data-path="'+esc(path)+'">'+
    '<div class="kb-photo-meta"><strong>Фото '+(index+1)+'</strong><code>'+esc(path)+'</code><button type="button" class="kb-mini primary" data-photo-auto-both>Автоподогнать обе рамки</button></div>'+
    '<div class="kb-photo-context-grid">'+
      photoContextHtml(path,"card","Карточка раздела",view)+
      photoContextHtml(path,"detail","Внутри товара",view)+
    '</div>'+
    '<div class="kb-photo-actions"><button type="button" class="kb-mini" data-photo-up>↑ Выше</button><button type="button" class="kb-mini" data-photo-down>↓ Ниже</button><button type="button" class="kb-mini" data-photo-replace>Заменить файл</button><button type="button" class="kb-mini danger" data-photo-remove>Удалить</button></div>'+
  '</div>';
}
function photoEditorHtml(ctx){
  const images=ctx.images||[],settings=ctx.product?.imageSettings||{};
  return '<section class="kb-admin-section kb-photo-section"><div class="kb-photo-head"><div><h3>Фотографии</h3><p class="kb-admin-hint">У каждой фотографии теперь два независимых кадра: для плитки товара в разделе и для большой фотографии внутри карточки. «Автоподгон» старается убрать пустые поля вокруг товара, заполнить рамку и при этом оставить сам товар целиком.</p></div><div class="kb-photo-head-actions"><button type="button" class="kb-admin-btn ghost" data-photo-add>+ Добавить фото</button><button type="button" class="kb-admin-btn primary" data-photo-save-view>Сохранить вид фото</button><input type="file" accept="image/png,image/jpeg,image/webp" multiple data-photo-file hidden><input type="file" accept="image/png,image/jpeg,image/webp" data-photo-replace-file hidden></div></div><div class="kb-photo-list" data-photo-list>'+images.map((p,i)=>photoRowHtml(p,i,settings[p]||{})).join("")+'</div><textarea data-images hidden>'+esc(linesText(images))+'</textarea></section>';
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
function collectPhotoSettings(body){
  const out={};
  body.querySelectorAll("[data-photo-row]").forEach(row=>{
    const path=row.dataset.path;if(!path)return;
    const item={};
    for(const context of ["card","detail"]){
      const box=row.querySelector('[data-photo-context="'+context+'"]'),v=settingFromContext(box);
      if(v.scale!==1||v.x!==0||v.y!==0||v.fit!=="contain")item[context]=v;
    }
    if(Object.keys(item).length)out[path]=item;
  });
  return out;
}
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
  const id=form.dataset.id,images=syncPhotoState(body),settings=collectPhotoSettings(body),o=await loadOverrides(true),out=deep(o.products?.[id]||{});
  if(same(images,editorCtx.sourceImages||[]))delete out.images;else out.images=images;
  if(same(settings,editorCtx.sourceProduct?.imageSettings||{}))delete out.imageSettings;else out.imageSettings=settings;
  if(emptyObject(out))delete o.products[id];else o.products[id]=out;
  await commitOverrides(o);
  body.querySelectorAll("[data-photo-row]").forEach(r=>r.classList.remove("is-photo-dirty"));
}
async function uploadPhoto(file,path){
  if(!file)throw new Error("Файл не выбран.");
  const ext=imageExt(file);if(!ext)throw new Error("Поддерживаются PNG, JPG и WEBP.");
  if(file.size>15*1024*1024)throw new Error("Фото больше 15 МБ. Сначала уменьшите файл.");
  await putRepoBinary(path,await file.arrayBuffer(),"Admin: upload photo for "+(editorCtx?.product?.name||editorCtx?.id||"product"));
  return path;
}
function renderProductEditor(ctx){
  editorCtx=ctx;
  const existing=deep(overrideCache.products?.[ctx.id]||{});
  const customIds=new Set((ctx.product.customTabs||[]).map(t=>t.id));
  const tabs=(ctx.tabs||[]).map(t=>tabRowHtml(t,ctx.product,customIds.has(t.id))).join("");
  const sheet="";
  setBody(shell(ctx.product.name||ctx.id,ctx.section.id+" · "+ctx.section.title,
    '<form data-admin-product data-id="'+esc(ctx.id)+'" class="kb-admin-form">'+
    '<div class="kb-admin-grid two"><label>Название<input name="name" value="'+esc(ctx.product.name||"")+'"></label><label>Артикул<input name="article" value="'+esc(ctx.product.article||"")+'"></label><label>Тип<input name="type" value="'+esc(ctx.product.type||"")+'"></label><label>Назначение<textarea name="purpose" rows="3">'+esc(ctx.product.purpose||"")+'</textarea></label></div>'+
    (sheet?'<p><a class="kb-admin-link" target="_blank" rel="noopener" href="'+sheet+'">Открыть исходный лист Google Sheets ↗</a></p>':"")+
    '<section class="kb-admin-section"><h3>Содержимое карточки</h3><div data-card-content>'+productPairEditors(ctx)+'</div></section>'+tableEditorsHtml(ctx)+
    '<details class="kb-admin-group" open><summary>Вещества / группы / ppb <small>'+((ctx.product.substances||[]).length)+' строк</small></summary><label class="kb-admin-field"><span>Формат: <b>группа | вещество | ppb</b>. Именно поле «группа» создаёт заголовок перед таблицей.</span><textarea rows="10" data-substances>'+esc(substancesText(ctx.product.substances||[]))+'</textarea></label></details>'+
    '<details class="kb-admin-group"><summary>Расширенные настройки пользовательских вкладок</summary><label class="kb-admin-field"><span>JSON для редких случаев. Обычные вкладки удобнее добавлять кнопкой ниже.</span><textarea rows="12" data-custom-tabs>'+esc(jsonText(ctx.product.customTabs||[]))+'</textarea></label></details>'+
    '<section class="kb-admin-section"><div class="kb-tab-section-head"><div><h3>Порядок и названия вкладок</h3><p class="kb-admin-hint">Добавленная вкладка сразу появляется здесь, в «Содержимом карточки» и в списке таблиц. Пользовательские вкладки можно удалить.</p></div><div class="kb-tab-create"><input type="text" data-new-tab-label placeholder="Название новой вкладки"><button type="button" class="kb-admin-btn ghost" data-add-tab>+ Добавить вкладку</button></div></div><div data-tab-list>'+tabs+'</div></section>'+
    photoEditorHtml(ctx)+
    '<details class="kb-admin-group"><summary>Расширенный JSON override</summary><label class="kb-admin-field"><span>Для редких полей, которых нет в форме. Поля формы при сохранении имеют приоритет.</span><textarea rows="14" data-advanced>'+esc(jsonText(existing))+'</textarea></label></details>'+
    '<div class="kb-admin-savebar"><button type="submit" class="kb-admin-btn primary">Сохранить карточку</button><button type="button" class="kb-admin-btn danger" data-reset-product>Сбросить ручные правки</button></div></form>'
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
  const active=cards.map(p=>'<div class="kb-product-sort-row '+(p.hidden?"is-hidden":"")+'" draggable="true" data-section-product-row data-id="'+esc(p.id)+'">'+
      '<span class="kb-drag" title="Перетащить">⋮⋮</span>'+
      '<div class="kb-product-sort-name"><strong>'+esc(p.name)+'</strong>'+(p.article?'<small>Арт. '+esc(p.article)+'</small>':'')+'</div>'+
      '<button type="button" class="kb-mini" data-product-up title="Выше">↑</button><button type="button" class="kb-mini" data-product-down title="Ниже">↓</button>'+
      '<label class="kb-product-hide"><input type="checkbox" data-product-hidden '+(p.hidden?"checked":"")+'> <span>Скрыть</span></label>'+
      '<button type="button" class="kb-mini danger kb-product-delete" data-product-delete>Удалить</button>'+
    '</div>').join("");
  const removed=deleted.map(p=>'<div class="kb-deleted-product-row" data-section-deleted-row data-id="'+esc(p.id)+'"><div class="kb-product-sort-name"><strong>'+esc(p.name)+'</strong>'+(p.article?'<small>Арт. '+esc(p.article)+'</small>':'')+'</div><label class="kb-product-restore"><input type="checkbox" data-product-restore> <span>Восстановить при сохранении</span></label></div>').join("");
  return '<section class="kb-admin-section"><div class="kb-product-section-head"><div><h3>Карточки товаров</h3><p class="kb-admin-hint"><b>Скрыть</b> — временно убрать карточку с сайта. <b>Удалить</b> — исключить её из структуры сайта, поиска и избранного. Google Sheets при этом не меняется.</p></div><button type="button" class="kb-admin-btn primary" data-add-product>+ Добавить карточку товара</button></div>'+
    (cards.length?'<div class="kb-product-sort" data-section-product-list>'+active+'</div>':'<div class="kb-admin-empty">В этом разделе пока нет карточек. Создай первую вручную.</div>')+
    (deleted.length?'<details class="kb-admin-group kb-deleted-products"><summary>Удалённые карточки <small>'+deleted.length+'</small></summary><div class="kb-deleted-product-list">'+removed+'</div></details>':'')+
    '</section>';
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
function renderSectionEditor(ctx){
  const existing=deep(overrideCache.sections?.[ctx.id]||{});
  const sheet="";
  const content=ctx.id==="1.1"
    ?foundationTermsEditorHtml(ctx)
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
  body.querySelector("[data-account-back]")?.addEventListener("click",()=>location.hash="#/account");
  body.querySelector("[data-account-search]")?.addEventListener("input",e=>{
    const qv=String(e.target.value||"").trim().toLowerCase();
    let shown=0;
    body.querySelectorAll("[data-account-section-card]").forEach(section=>{
      let sectionShown=0;
      section.querySelectorAll("[data-account-product-card]").forEach(card=>{
        const ok=!qv||String(card.dataset.accountProductSearch||"").toLowerCase().includes(qv);
        card.hidden=!ok;if(ok)sectionShown++;
      });
      const sectionText=String(section.dataset.accountSearchText||"").toLowerCase();
      const sectionOk=!qv||sectionText.includes(qv)||sectionShown>0;
      section.hidden=!sectionOk;if(sectionOk)shown++;
    });
    const empty=body.querySelector("[data-account-empty]");if(empty)empty.hidden=shown>0;
  });
  body.querySelectorAll("[data-account-edit-product]").forEach(b=>b.addEventListener("click",()=>location.hash="#/account/product/"+encodeURIComponent(b.dataset.accountEditProduct)));
  body.addEventListener("click",e=>{
    const add=e.target.closest?.("[data-pair-add]");
    if(add){
      const ed=add.closest("[data-pair-editor]"),list=ed?.querySelector("[data-pair-list]");
      if(list)list.insertAdjacentHTML("beforeend",'<div class="kb-pair-row" data-pair-row><input data-pair-label placeholder="Название характеристики"><span class="kb-pair-arrow">→</span><input data-pair-value placeholder="Значение"><button type="button" class="kb-mini danger" data-pair-remove title="Удалить строку">×</button></div>');
      return;
    }
    const remove=e.target.closest?.("[data-pair-remove]");
    if(remove){
      const row=remove.closest("[data-pair-row]"),list=row?.parentElement;
      if(row&&list){
        if(list.querySelectorAll("[data-pair-row]").length<=1){row.querySelectorAll("input").forEach(x=>x.value="");}
        else row.remove();
      }
    }
  });
  body.querySelectorAll("[data-account-section]").forEach(b=>b.addEventListener("click",()=>location.hash="#/account/section/"+encodeURIComponent(b.dataset.accountSection)));


  body.querySelectorAll("[data-rich-editor]"); // keep focus selector warm for delegated formatting
  body.addEventListener("mousedown",e=>{
    const btn=e.target.closest?.("[data-rich-cmd]");if(btn)e.preventDefault();
  });
  body.addEventListener("click",async e=>{
    const cmd=e.target.closest?.("[data-rich-cmd]");
    if(cmd){
      const command=cmd.dataset.richCmd,value=cmd.dataset.richValue||null;
      if(command==="createLink"){
        const url=prompt("Ссылка:", "https://");if(!url)return;
        document.execCommand("createLink",false,url);
      }else document.execCommand(command,false,value);
      return;
    }
    const add=e.target.closest?.("[data-content-add]");
    if(add){
      const type=add.dataset.contentAdd,wrap=body.querySelector("[data-content-builder]");
      if(!wrap)return;
      const id="block-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);
      const defaults={
        text:{id,type,html:"<p>Введите текст…</p>"},
        heading:{id,type,text:"Новый заголовок"},
        list:{id,type,items:["Новый пункт"]},
        quote:{id,type,html:"<p>Выделенная информация…</p>"},
        table:{id,type,headers:["Название","Значение"],rows:[["",""]]},
        image:{id,type,src:"",width:100,align:"center",alt:"",caption:""}
      };
      wrap.insertAdjacentHTML("beforeend",contentBlockEditorHtml(defaults[type]||defaults.text,wrap.children.length));
      const block=wrap.lastElementChild;block?.scrollIntoView({behavior:"smooth",block:"center"});return;
    }
    if(e.target.closest("[data-content-delete]")){e.target.closest("[data-content-block]")?.remove();return}
    if(e.target.closest("[data-content-duplicate]")){
      const block=e.target.closest("[data-content-block]"),wrap=body.querySelector("[data-content-builder]");
      if(!block||!wrap)return;
      const clone=block.cloneNode(true);clone.dataset.blockId="block-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);
      block.after(clone);return;
    }
    const upload=e.target.closest("[data-content-image-upload]");
    if(upload){
      const block=upload.closest("[data-content-block]"),input=body.querySelector("[data-content-image-file]");
      if(input&&block){input.dataset.contentTarget=block.dataset.blockId;input.click()}return;
    }
    const addRow=e.target.closest("[data-content-add-row]");
    if(addRow){
      const table=addRow.closest("[data-content-table]"),w=table?.querySelectorAll("[data-content-table-header]").length||1;
      table?.querySelector("tbody")?.insertAdjacentHTML("beforeend",'<tr data-content-table-row>'+Array.from({length:w},()=>'<td><input data-content-table-cell value=""></td>').join("")+'<td class="kb-row-tools"><button type="button" class="kb-row-remove" data-content-remove-row>×</button></td></tr>');return;
    }
    const addCol=e.target.closest("[data-content-add-col]");
    if(addCol){
      const table=addCol.closest("[data-content-table]"),head=table?.querySelector("thead tr"),idx=table?.querySelectorAll("[data-content-table-header]").length||0;
      head?.insertAdjacentHTML("beforeend",'<th><div class="kb-cell-head"><input data-content-table-header value="Новый столбец"><button type="button" class="kb-col-remove" data-content-remove-col="'+idx+'">×</button></div></th>');
      table?.querySelectorAll("[data-content-table-row]").forEach(tr=>tr.insertAdjacentHTML("beforeend",'<td><input data-content-table-cell value=""></td>'));return;
    }
    const removeCol=e.target.closest("[data-content-remove-col]");
    if(removeCol){
      const table=removeCol.closest("[data-content-table]"),heads=[...table.querySelectorAll("[data-content-table-header]")];if(heads.length<=1)return;
      const idx=heads.indexOf(removeCol.closest("th")?.querySelector("[data-content-table-header]"));removeCol.closest("th")?.remove();
      table.querySelectorAll("[data-content-table-row]").forEach(tr=>tr.querySelectorAll("td:not(.kb-row-tools)")[idx]?.remove());return;
    }
    if(e.target.closest("[data-content-remove-row]")){e.target.closest("[data-content-table-row]")?.remove();return}
  });
  body.addEventListener("input",e=>{
    const w=e.target.closest("[data-block-image-width]");
    if(w){const o=w.closest("[data-content-block]")?.querySelector("[data-block-image-width-out]");if(o)o.textContent=w.value+"%";return}
  });
  body.querySelector("[data-content-image-file]")?.addEventListener("change",async e=>{
    const input=e.currentTarget,file=input.files?.[0],target=input.dataset.contentTarget||"",form=body.querySelector("[data-admin-section]");
    if(!file||!target||!form)return;
    try{
      const ext=imageExt(file);if(!ext)throw new Error("Поддерживаются PNG, JPG и WEBP.");
      if(file.size>15*1024*1024)throw new Error("Изображение больше 15 МБ.");
      showStatus("Загружаю изображение в раздел…","warn");
      const path=nextContentImagePath(form.dataset.id,file);
      await putRepoBinary(path,await file.arrayBuffer(),"Admin: upload section content image");
      const block=body.querySelector('[data-content-block][data-block-id="'+CSS.escape(target)+'"]');
      if(block){
        const hidden=block.querySelector("[data-block-image-src]");if(hidden)hidden.value=path;
        const preview=block.querySelector(".kb-content-image-preview");if(preview)preview.innerHTML='<img src="'+esc(photoPreviewSrc(path))+'" alt="">';
      }
      showStatus("Изображение загружено в репозиторий. Нажми «Сохранить раздел».","ok");
    }catch(err){showError(err)}finally{input.value="";input.dataset.contentTarget=""}
  });
  let draggedContent=null;
  body.querySelectorAll("[data-content-block]").forEach(block=>{
    block.addEventListener("dragstart",()=>{draggedContent=block;block.classList.add("is-dragging")});
    block.addEventListener("dragend",()=>{block.classList.remove("is-dragging");draggedContent=null});
    block.addEventListener("dragover",e=>{e.preventDefault();if(!draggedContent||draggedContent===block)return;const box=block.getBoundingClientRect(),after=e.clientY>box.top+box.height/2;block.parentElement?.insertBefore(draggedContent,after?block.nextSibling:block)});
  });
  body.querySelector("[data-github-connect]")?.addEventListener("click",async e=>{
    try{await connectGithub();e.currentTarget.textContent="✓ GitHub подключен";showStatus("GitHub подключен на время этой вкладки.")}catch(err){showError(err)}
  });
  body.querySelector("[data-admin-logout]")?.addEventListener("click",()=>{
    sessionStorage.removeItem(ADMIN_SESSION_KEY);sessionStorage.removeItem(GITHUB_TOKEN_KEY);location.hash="#/home";closeAdmin();window.dispatchEvent(new CustomEvent("kb:admin-change"));
  });
  body.querySelector("[data-admin-close]")?.addEventListener("click",()=>{location.hash="#/home";closeAdmin()});
  body.querySelector("[data-admin-refresh]")?.addEventListener("click",async e=>{
    const b=e.currentTarget;b.disabled=true;showStatus("Забираю свежие данные из текущего листа Google Sheets…","warn");
    try{
      const r=await window.KB_EDITOR_API?.refreshCurrentSection?.();
      await publishLiveSnapshots((r?.sectionId||"").split(","));
      await renderEditor();
      showStatus("Готово: "+(r?.sections>1?(r.sections+" листов обновлено"):(("раздел "+(r?.sectionId||"")+" обновлён")))+" из Google Sheets и опубликовано ("+(r?.rows||0)+" строк).");
    }catch(err){showError(err)}finally{b.disabled=false}
  });
  body.querySelector("[data-admin-export]")?.addEventListener("click",async()=>{
    const editorOverrides=await loadOverrides(true);
    let liveSheetSnapshots=window.KB_EDITOR_API?.liveSnapshots?.()||{};if(!liveSheetSnapshots||typeof liveSheetSnapshots!=="object"||Array.isArray(liveSheetSnapshots)){try{liveSheetSnapshots=JSON.parse(localStorage.getItem(LIVE_KEY)||"{}")||{}}catch{liveSheetSnapshots={}}}
    const data={format:"tian-knowledge-book-local-backup",version:2,exportedAt:new Date().toISOString(),editorOverrides,liveSheetSnapshots};
    const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    const blob=new Blob([JSON.stringify(data,null,2)+"\n"],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="kniga-znaniy-VSE-pravki-"+stamp+".json";document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showStatus("Сохранён один файл со всеми ручными правками книги и локально обновлёнными листами Google Sheets.");
  });
  body.querySelector("[data-admin-import]")?.addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const data=JSON.parse(await file.text());
      if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("Неверный файл правок.");
      const editorOverrides=data.format==="tian-knowledge-book-local-backup"?(data.editorOverrides||emptyOverrides()):data;
      editorOverrides.products ||= {};editorOverrides.sections ||= {};editorOverrides.chapters ||= {};
      await commitOverrides(editorOverrides);
      if(data.format==="tian-knowledge-book-local-backup"){localStorage.setItem(LIVE_KEY,JSON.stringify(data.liveSheetSnapshots||{}));await publishLiveSnapshots()}
      showStatus("Все правки книги импортированы и опубликованы. Обновляю страницу…");
      location.reload();
    }catch(err){showError(err)}
  });
  body.querySelector("[data-add-table]")?.addEventListener("click",()=>{
    const id=body.querySelector("[data-new-table-tab]")?.value||"";if(!id||!editorCtx)return;
    const wrap=body.querySelector("[data-table-editors]"),existing=wrap?.querySelector('[data-table-editor][data-table-id="'+CSS.escape(id)+'"]');
    if(existing){existing.scrollIntoView({behavior:"smooth",block:"center"});existing.classList.add("kb-flash");setTimeout(()=>existing.classList.remove("kb-flash"),900);return}
    const source=sourceRowsForTab(editorCtx,id),table={headers:tableHeadersForTab(id,null),rows:source.map(r=>[String(r?.[0]||""),String(r?.[1]||"")])};
    const label=body.querySelector('[data-admin-tab-row][data-id="'+CSS.escape(id)+'"] [data-tab-label]')?.value.trim()||tableLabel(editorCtx,id);
    wrap?.insertAdjacentHTML("beforeend",tableEditorHtml(id,label,table));
  });

  body.querySelector("[data-photo-add]")?.addEventListener("click",()=>body.querySelector("[data-photo-file]")?.click());
  body.querySelector("[data-photo-file]")?.addEventListener("change",async e=>{
    const input=e.currentTarget,files=[...(input.files||[])];if(!files.length||!editorCtx)return;
    const btn=body.querySelector("[data-photo-add]");if(btn)btn.disabled=true;showStatus("Загружаю и автоматически кадрирую фотографии…","warn");
    try{
      let current=syncPhotoState(body);
      for(const file of files){
        const ext=imageExt(file);if(!ext)throw new Error("Файл «"+file.name+"» имеет неподдерживаемый формат.");
        let bounds=null;try{bounds=await detectPhotoBounds(file)}catch{}
        const path=nextPhotoPath(editorCtx.id,current,ext);await uploadPhoto(file,path);current.push(path);
        body.querySelector("[data-photo-list]")?.insertAdjacentHTML("beforeend",photoRowHtml(path,current.length-1,{}));
        const row=[...body.querySelectorAll("[data-photo-row]")].at(-1);
        if(bounds)for(const context of ["card","detail"]){const box=row.querySelector('[data-photo-context="'+context+'"]');setPhotoControls(box,autoSettingFromBounds(bounds,context))}
      }
      await persistImagesOnly(body);showStatus("Фотографии загружены, автоподгон рассчитан отдельно для карточки и внутреннего фото.");
    }catch(err){showError(err)}finally{input.value="";if(btn)btn.disabled=false}
  });
  body.querySelector("[data-photo-save-view]")?.addEventListener("click",async e=>{
    const b=e.currentTarget;b.disabled=true;showStatus("Сохраняю отображение фотографий…","warn");
    try{await persistImagesOnly(body);showStatus("Оба варианта отображения фотографий сохранены и опубликованы.")}catch(err){showError(err)}finally{b.disabled=false}
  });
  body.querySelector("[data-photo-replace-file]")?.addEventListener("change",async e=>{
    const input=e.currentTarget,file=input.files?.[0],old=input.dataset.replacePath||"";if(!file||!old)return;
    const row=body.querySelector('[data-photo-row][data-path="'+CSS.escape(old)+'"]');if(!row)return;
    showStatus("Заменяю фотографию и пересчитываю кадр…","warn");
    try{
      const ext=imageExt(file);if(!ext)throw new Error("Поддерживаются PNG, JPG и WEBP.");
      let path=old;
      if(!old.startsWith("img/photos/admin/"))path=nextPhotoPath(editorCtx.id,syncPhotoState(body),ext);
      else path=old.replace(/\.[^.]+$/,"."+ext);
      let bounds=null;try{bounds=await detectPhotoBounds(file)}catch{}
      await uploadPhoto(file,path);
      if(path!==old&&old.startsWith("img/photos/admin/"))await deleteRepoFile(old,"Admin: remove replaced product photo");
      row.dataset.path=path;row.querySelectorAll(".kb-photo-preview img").forEach(img=>img.src=photoPreviewSrc(path));row.querySelector(".kb-photo-meta code").textContent=path;
      if(bounds)for(const context of ["card","detail"]){const box=row.querySelector('[data-photo-context="'+context+'"]');setPhotoControls(box,autoSettingFromBounds(bounds,context))}
      await persistImagesOnly(body);showStatus(bounds?"Фотография заменена; оба кадра пересчитаны и опубликованы.":"Фотография заменена и опубликована. Автоподгон не сработал, но файл сохранён — можно настроить кадр вручную.");
    }catch(err){showError(err)}finally{input.value="";input.dataset.replacePath=""}
  });
  body.addEventListener("click",async e=>{
    const row=e.target.closest?.("[data-photo-row]");if(!row)return;
    const box=e.target.closest?.("[data-photo-context]");
    try{
      if(e.target.closest("[data-photo-auto]")&&box){
        showStatus("Определяю границы товара на фотографии…","warn");
        await autoFitRow(row,box.dataset.photoContext);showStatus("Автоподгон рассчитан. Проверь предпросмотр и нажми «Сохранить вид фото».","warn");return;
      }
      if(e.target.closest("[data-photo-auto-both]")){
        showStatus("Подгоняю фото под обе рамки…","warn");
        await autoFitRow(row);showStatus("Обе рамки рассчитаны. При необходимости подправь ползунками.","warn");return;
      }
      if(e.target.closest("[data-photo-preset-large]")&&box){
        const v=settingFromContext(box);setPhotoControls(box,{...v,scale:Math.min(4,v.scale+.2)});return;
      }
      if(e.target.closest("[data-photo-center]")&&box){const v=settingFromContext(box);setPhotoControls(box,{...v,x:0,y:0});return}
      if(e.target.closest("[data-photo-reset-view]")&&box){setPhotoControls(box,{scale:1,x:0,y:0,fit:"contain"});return}
      if(e.target.closest("[data-photo-copy-context]")&&box){
        const context=box.dataset.photoContext,v=settingFromContext(box);
        body.querySelectorAll('[data-photo-context="'+context+'"]').forEach(x=>setPhotoControls(x,v));
        showStatus("Настройка «"+(context==="card"?"Карточка раздела":"Внутри товара")+"» применена ко всем фото товара. Нажми «Сохранить вид фото».","warn");return;
      }
      if(e.target.closest("[data-photo-up]")){row.previousElementSibling?.before(row);await persistImagesOnly(body);showStatus("Порядок фотографий сохранён.");return}
      if(e.target.closest("[data-photo-down]")){row.nextElementSibling?.after(row);await persistImagesOnly(body);showStatus("Порядок фотографий сохранён.");return}
      if(e.target.closest("[data-photo-replace]")){const input=body.querySelector("[data-photo-replace-file]");if(input){input.dataset.replacePath=row.dataset.path;input.click()}return}
      if(e.target.closest("[data-photo-remove]")){
        const path=row.dataset.path;if(!confirm("Удалить это фото из карточки?"))return;
        if(path.startsWith("img/photos/admin/"))await deleteRepoFile(path,"Admin: delete product photo");
        row.remove();await persistImagesOnly(body);showStatus("Фото удалено из карточки.");return;
      }
    }catch(err){showError(err)}
  });

  body.querySelector("[data-add-product]")?.addEventListener("click",async()=>{
    const sectionId=body.querySelector("[data-admin-section]")?.dataset.id||editorCtx?.sourceSection?.id||editorCtx?.section?.id||"";
    if(!sectionId)return showError(new Error("Не удалось определить раздел товара."));
    const name=(prompt("Название нового товара:")||"").trim();
    if(!name)return;
    const article=(prompt("Артикул (можно оставить пустым):")||"").trim();
    const base=safe("manual-"+sectionId+"-"+name),o=await loadOverrides(true);
    const section=o.sections?.[sectionId]&&typeof o.sections[sectionId]==="object"?o.sections[sectionId]:{};
    section.manualProducts=section.manualProducts&&typeof section.manualProducts==="object"&&!Array.isArray(section.manualProducts)?section.manualProducts:{};
    let id=base,n=2;while(section.manualProducts[id]||o.products?.[id])id=base+"-"+n++;
    section.manualProducts[id]={id,name,article,type:"",purpose:"",detailFields:[],advantages:[],substances:[],indicators:[],tabTables:{},options:[],variants:[],complectation:[],workflow:[],calibration:[],assortment:[],consumables:[],testKits:[],washCycle:[],customTabs:[]};
    o.sections[sectionId]=section;
    await commitOverrides(o);
    overrideCache=deep(o);
    showStatus("Карточка создана. Открываю редактор…");
    location.hash="#/account/product/"+encodeURIComponent(id);location.reload();
  });
  body.querySelector("[data-add-tab]")?.addEventListener("click",()=>{
    const form=body.querySelector("[data-admin-product]"),input=body.querySelector("[data-new-tab-label]");
    if(!form||!input)return;
    const label=input.value.trim();if(!label)return showError(new Error("Введите название новой вкладки."));
    const used=new Set([...form.querySelectorAll("[data-admin-tab-row]")].map(r=>r.dataset.id));
    let base="custom-"+safe(label||"vkladka"),id=base,n=2;while(used.has(id)){id=base+"-"+n++}
    const tab={id,label,kind:"pairs",rows:[]},custom=readCustomTabs(form);custom.push(tab);writeCustomTabs(form,custom);
    body.querySelector("[data-tab-list]")?.insertAdjacentHTML("beforeend",tabRowHtml({id,label},{hiddenTabs:[]},true));
    body.querySelector("[data-card-content]")?.insertAdjacentHTML("beforeend",customTabContentHtml(tab));
    const sel=body.querySelector("[data-new-table-tab]");if(sel){const o=document.createElement("option");o.value=id;o.textContent=label;sel.appendChild(o);sel.value=id}
    input.value="";body.querySelector('[data-admin-tab-row][data-id="'+CSS.escape(id)+'"]')?.scrollIntoView({behavior:"smooth",block:"nearest"});
  });
  body.addEventListener("input",e=>{
    const photo=e.target.closest?.("[data-photo-scale],[data-photo-x],[data-photo-y],[data-photo-fit]");
    if(photo){updatePhotoPreview(photo.closest("[data-photo-context]"));return}
    const input=e.target.closest?.("[data-tab-label]");if(!input)return;
    const row=input.closest("[data-admin-tab-row]"),id=row?.dataset.id,label=input.value.trim()||id;if(!id)return;
    const opt=body.querySelector('[data-new-table-tab] option[value="'+CSS.escape(id)+'"]');if(opt)opt.textContent=label;
    const strong=body.querySelector('[data-table-editor][data-table-id="'+CSS.escape(id)+'"] .kb-table-editor-head strong');if(strong)strong.textContent=label;
    const title=body.querySelector('[data-custom-content-id="'+CSS.escape(id)+'"] summary span');if(title)title.textContent=label;
  });
  body.addEventListener("click",e=>{
    const up=e.target.closest?.("[data-tab-up]");if(up){const r=up.closest("[data-admin-tab-row]");r?.previousElementSibling?.before(r);return}
    const down=e.target.closest?.("[data-tab-down]");if(down){const r=down.closest("[data-admin-tab-row]");r?.nextElementSibling?.after(r);return}
    const del=e.target.closest?.("[data-tab-delete]");if(del){const r=del.closest("[data-admin-tab-row]");if(r?.dataset.customTab==="1")removeCustomTabUi(body,r.dataset.id);return}
    const delContent=e.target.closest?.("[data-remove-custom-tab]");if(delContent){const box=delContent.closest("[data-custom-content-id]");removeCustomTabUi(body,box?.dataset.customContentId);return}
  });
  body.addEventListener("click",e=>{
    const ed=e.target.closest("[data-table-editor]");if(!ed)return;
    if(e.target.closest("[data-table-add-row]")){
      const width=ed.querySelectorAll("[data-table-header]").length;ed.querySelector("tbody")?.insertAdjacentHTML("beforeend",tableRowHtml([],width));return;
    }
    if(e.target.closest("[data-table-add-col]")){
      const head=ed.querySelector("thead tr"),idx=ed.querySelectorAll("[data-table-header]").length;
      head?.querySelector(".kb-row-tools")?.insertAdjacentHTML("beforebegin",'<th><div class="kb-cell-head"><input data-table-header value="Новый столбец"><button type="button" class="kb-col-remove" data-table-remove-col="'+idx+'" title="Удалить столбец">×</button></div></th>');
      ed.querySelectorAll("[data-table-row]").forEach(tr=>tr.querySelector(".kb-row-tools")?.insertAdjacentHTML("beforebegin",'<td><input data-table-cell value=""></td>'));return;
    }
    const col=e.target.closest("[data-table-remove-col]");if(col){
      const headers=[...ed.querySelectorAll("[data-table-header]")];if(headers.length<=1)return showError(new Error("В таблице должен остаться хотя бы один столбец."));
      const index=headers.indexOf(col.closest("th")?.querySelector("[data-table-header]"));col.closest("th")?.remove();
      ed.querySelectorAll("[data-table-row]").forEach(tr=>tr.querySelectorAll("td:not(.kb-row-tools)")[index]?.remove());return;
    }
    if(e.target.closest("[data-table-remove-row]")){e.target.closest("[data-table-row]")?.remove();return}
    if(e.target.closest("[data-table-delete]")){ed.remove();return}
  });
  body.querySelectorAll("[data-product-up]").forEach(b=>b.onclick=()=>{const r=b.closest("[data-section-product-row]");r?.previousElementSibling?.before(r)});
  body.querySelectorAll("[data-product-down]").forEach(b=>b.onclick=()=>{const r=b.closest("[data-section-product-row]");r?.nextElementSibling?.after(r)});
  body.querySelectorAll("[data-product-hidden]").forEach(ch=>ch.onchange=()=>ch.closest("[data-section-product-row]")?.classList.toggle("is-hidden",ch.checked));
  body.querySelectorAll("[data-product-delete]").forEach(b=>b.onclick=()=>{
    const r=b.closest("[data-section-product-row]");if(!r)return;
    if(r.dataset.deletePending==="1"){
      r.dataset.deletePending="";r.classList.remove("is-deleting");b.textContent="Удалить";
      r.querySelectorAll("button,input").forEach(x=>{if(x!==b)x.disabled=false});return;
    }
    const name=r.querySelector(".kb-product-sort-name strong")?.textContent||"эту карточку";
    if(!confirm('Удалить «'+name+'» с сайта? Исходная строка в Google Sheets останется.'))return;
    r.dataset.deletePending="1";r.classList.add("is-deleting");b.textContent="Отменить";
    r.querySelectorAll("button,input").forEach(x=>{if(x!==b)x.disabled=true});
  });
  let draggedProduct=null;
  body.querySelectorAll("[data-section-product-row]").forEach(row=>{
    row.addEventListener("dragstart",()=>{draggedProduct=row;row.classList.add("is-dragging")});
    row.addEventListener("dragend",()=>{row.classList.remove("is-dragging");draggedProduct=null});
    row.addEventListener("dragover",e=>{e.preventDefault();if(!draggedProduct||draggedProduct===row)return;const box=row.getBoundingClientRect(),after=e.clientY>box.top+box.height/2;row.parentElement?.insertBefore(draggedProduct,after?row.nextSibling:row)});
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
  e.preventDefault();const form=e.currentTarget,id=form.dataset.id,btn=e.submitter;btn.disabled=true;
  try{
    const ctx=window.KB_EDITOR_API.current();const src=ctx.sourceProduct||{},fd=new FormData(form);
    let out={};const adv=form.querySelector("[data-advanced]")?.value.trim();
    if(adv){out=JSON.parse(adv);if(!out||Array.isArray(out)||typeof out!=="object")throw new Error("Расширенный JSON должен быть объектом.");}
    delete out.id;
    for(const key of ["name","article","type","purpose"])putDiff(out,key,String(fd.get(key)||""),String(src[key]||""));
    for(const [key] of PAIR_FIELDS){
      const value=key==="detailFields"?collectPairRows(form,key):parsePairs(form.querySelector('[data-pair-key="'+key+'"]')?.value||"");
      putDiff(out,key,value,src[key]||[]);
    }
    const baseHasTables=Object.prototype.hasOwnProperty.call(src||{},"tabTables"),baseTables=deep(src.tabTables||{});if(!baseHasTables&&src.indicatorTable)baseTables.indicators=deep(src.indicatorTable);
    putDiff(out,"tabTables",collectTabTables(form),baseTables);
    delete out.indicatorTable;
    putDiff(out,"substances",parseSubstances(form.querySelector("[data-substances]")?.value||""),src.substances||[]);
    const custom=collectCustomTabs(form);
    putDiff(out,"customTabs",custom,src.customTabs||[]);
    const tabRows=[...form.querySelectorAll("[data-admin-tab-row]")];
    const order=tabRows.map(r=>r.dataset.id),hidden=tabRows.filter(r=>r.querySelector("[data-tab-hidden]")?.checked).map(r=>r.dataset.id),labels={};
    for(const r of tabRows){const id2=r.dataset.id,val=r.querySelector("[data-tab-label]")?.value.trim()||id2,def=defaultTabLabel(id2,src);if(val!==def)labels[id2]=val}
    if(order.length)out.tabOrder=order;else delete out.tabOrder;
    if(hidden.length)out.hiddenTabs=hidden;else delete out.hiddenTabs;
    if(Object.keys(labels).length)out.tabLabels=labels;else delete out.tabLabels;
    let images=parseLines(form.querySelector("[data-images]")?.value||"");
    putDiff(out,"images",images,ctx.sourceImages||[]);
    putDiff(out,"imageSettings",collectPhotoSettings(form),src.imageSettings||{});
    const o=await loadOverrides(true);
    const isManual=Object.values(o.sections||{}).some(sec=>sec?.manualProducts&&Object.prototype.hasOwnProperty.call(sec.manualProducts,id));
    if(emptyObject(out))delete o.products[id];else o.products[id]=out;
    if(isManual){
      for(const sec of Object.values(o.sections||{})){
        if(sec?.manualProducts?.[id]){
          const merged={...deep(sec.manualProducts[id]),...deep(out),id};
          sec.manualProducts[id]=merged;
        }
      }
    }
    await commitOverrides(o);
    overrideCache=deep(o);
    showStatus("Карточка сохранена и опубликована.");
    location.hash="#/account";location.reload();
  }catch(err){showError(err);btn.disabled=false}
}
async function saveSection(e){
  e.preventDefault();const form=e.currentTarget,id=form.dataset.id,btn=e.submitter;btn.disabled=true;
  try{
    const ctx=window.KB_EDITOR_API.current(),src=ctx.sourceSection||{},fd=new FormData(form);
    let out={};const raw=form.querySelector("[data-section-json]")?.value.trim();
    if(raw){out=JSON.parse(raw);if(!out||Array.isArray(out)||typeof out!=="object")throw new Error("JSON раздела должен быть объектом.");}
    putDiff(out,"title",String(fd.get("title")||""),String(src.title||""));
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
      const pendingDeleted=productRows.filter(r=>r.dataset.deletePending==="1").map(r=>r.dataset.id).filter(Boolean);
      const activeRows=productRows.filter(r=>r.dataset.deletePending!=="1");
      const productOrder=activeRows.map(r=>r.dataset.id).filter(Boolean);
      const hiddenProductIds=activeRows.filter(r=>r.querySelector("[data-product-hidden]")?.checked).map(r=>r.dataset.id).filter(Boolean);
      const stillDeleted=deletedRows.filter(r=>!r.querySelector("[data-product-restore]")?.checked).map(r=>r.dataset.id).filter(Boolean);
      const deletedProductIds=[...new Set([...stillDeleted,...pendingDeleted])];
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
