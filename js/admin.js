const LOCAL_KEY="kb_admin_overrides_local";
const LIVE_KEY="kb_live_sheet_snapshots";
const ADMIN_SESSION_KEY="kb_admin";
const GITHUB_TOKEN_KEY="kb_github_token";
const ADMIN_PASSWORD_HASH="f40616bfaf4c1e0631d206330ead19b861546d0400b3f9be0589dbadc985ad8e";
const GITHUB_REPO="surniiyka-cloud/kniga_znaniy";
const GITHUB_BRANCH="main";
let overrideCache=null;

const esc=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const deep=(v)=>v==null?v:JSON.parse(JSON.stringify(v));
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const safe=(v)=>String(v||"item").toLowerCase().replace(/[^a-zа-яё0-9._-]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,90)||"item";

function emptyOverrides(){return {version:1,updatedAt:null,products:{},sections:{},chapters:{}}}
async function loadOverrides(force=false){
  if(overrideCache&&!force)return overrideCache;
  try{overrideCache=JSON.parse(localStorage.getItem(LOCAL_KEY)||"null")||emptyOverrides()}
  catch{overrideCache=emptyOverrides()}
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
  if(!res.ok){let msg="GitHub HTTP "+res.status;try{const j=await res.json();if(j?.message)msg+=" · "+j.message}catch{}throw new Error(msg)}
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
function bytesBase64(buffer){
  const bytes=new Uint8Array(buffer);let bin="";for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(bin);
}
async function repoFile(path){
  try{return await githubFetch("/contents/"+path.split("/").map(encodeURIComponent).join("/")+"?ref="+encodeURIComponent(GITHUB_BRANCH))}catch(e){if(/404/.test(e.message))return null;throw e}
}
async function putRepoText(path,text,message){
  if(!sessionToken())await connectGithub();
  const cur=await repoFile(path),body={message,content:utf8Base64(text),branch:GITHUB_BRANCH};
  if(cur?.sha)body.sha=cur.sha;
  return githubFetch("/contents/"+path.split("/").map(encodeURIComponent).join("/"),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
}
async function putRepoBinary(path,buffer,message){
  if(!sessionToken())await connectGithub();
  const cur=await repoFile(path),body={message,content:bytesBase64(buffer),branch:GITHUB_BRANCH};
  if(cur?.sha)body.sha=cur.sha;
  return githubFetch("/contents/"+path.split("/").map(encodeURIComponent).join("/"),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
}
async function deleteRepoFile(path,message){
  if(!sessionToken())await connectGithub();
  const cur=await repoFile(path);if(!cur?.sha)return;
  return githubFetch("/contents/"+path.split("/").map(encodeURIComponent).join("/"),{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,sha:cur.sha,branch:GITHUB_BRANCH})});
}
async function publishLiveSnapshots(){
  let snaps={};try{snaps=JSON.parse(localStorage.getItem(LIVE_KEY)||"{}")||{}}catch{}
  await putRepoText("data/live-sheet-snapshots.json",JSON.stringify(snaps,null,2)+"\n","Admin: publish refreshed Google Sheets snapshots");
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
function tableEditorHtml(id,label,table){
  const headers=(table?.headers?.length?table.headers:["Название","Значение"]).map(x=>String(x||""));
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
      b.innerHTML="✎ <span>Редактор</span>";b.onclick=openAdmin;actions.prepend(b);
    }
  }
  if(!modal){
    modal=document.createElement("div");modal.id="kbAdminModal";modal.className="kb-admin-modal";modal.hidden=true;
    modal.innerHTML='<div class="kb-admin-backdrop" data-admin-close></div><section class="kb-admin-panel" role="dialog" aria-modal="true"><div id="kbAdminBody"></div></section>';
    document.body.appendChild(modal);
    modal.addEventListener("click",e=>{if(e.target.closest("[data-admin-close]"))closeAdmin()});
  }
}
function setBody(html){ensureUI();modal.querySelector("#kbAdminBody").innerHTML=html;bindBody()}
async function openAdmin(){
  ensureUI();if(!await requireAdmin())return;
  modal.hidden=false;document.body.classList.add("kb-admin-open");renderEditor().catch(showError);
}
function closeAdmin(){if(modal)modal.hidden=true;document.body.classList.remove("kb-admin-open")}
function showError(e){const box=modal?.querySelector("[data-admin-status]");if(box){box.className="kb-admin-status error";box.textContent=e?.message||String(e)}else alert(e?.message||e)}
function showStatus(t,kind="ok"){const box=modal?.querySelector("[data-admin-status]");if(box){box.className="kb-admin-status "+kind;box.textContent=t}}

function shell(title,subtitle,inner){
  return '<header class="kb-admin-head"><div><span class="kb-admin-kicker">Администратор</span><h2>'+esc(title)+'</h2><p>'+esc(subtitle||"")+'</p></div><button class="kb-admin-x" type="button" data-admin-close>×</button></header>'+
  '<div class="kb-admin-toolbar"><button class="kb-admin-btn primary" data-admin-refresh>⚡ Забрать свежие данные из Google Sheets</button><button class="kb-admin-btn ghost" data-github-connect>'+(sessionToken()?'✓ GitHub подключен':'Подключить GitHub')+'</button><button class="kb-admin-btn ghost" data-admin-export>↓ Скачать все правки книги</button><label class="kb-admin-btn ghost kb-admin-import">↑ Загрузить файл правок книги<input type="file" accept="application/json,.json" data-admin-import hidden></label><button class="kb-admin-btn ghost" data-admin-logout>Выйти из админа</button><span class="kb-admin-devnote">Рабочий редактор · изменения публикуются в main</span></div>'+
  '<div class="kb-admin-status" data-admin-status></div>'+inner;
}
async function renderEditor(){
  await loadOverrides(true);
  const ctx=window.KB_EDITOR_API?.current?.()||{kind:"dashboard"};
  if(ctx.kind==="product")return renderProductEditor(ctx);
  if(ctx.kind==="section")return renderSectionEditor(ctx);
  if(ctx.kind==="chapter")return renderChapterEditor(ctx);
  const sheet=ctx.spreadsheetId?' <a class="kb-admin-link" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/'+encodeURIComponent(ctx.spreadsheetId)+'/edit">Открыть Google Sheets ↗</a>':"";
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
function productPairEditors(ctx){
  const standard=PAIR_FIELDS.filter(([key])=>(ctx.product?.[key]||[]).length>0).map(([key,label])=>'<details class="kb-admin-group"><summary>'+esc(label)+' <small>'+((ctx.product?.[key]||[]).length)+' строк</small></summary><label class="kb-admin-field"><span>Одна строка = <b>название | значение</b>. Порядок строк = порядок на сайте.</span><textarea rows="7" data-pair-key="'+key+'">'+esc(pairText(ctx.product?.[key]||[]))+'</textarea></label></details>');
  const custom=(ctx.product?.customTabs||[]).map(customTabContentHtml);
  return standard.concat(custom).join("")||'<p class="kb-admin-hint">Дополнительных заполненных характеристик пока нет. Новую вкладку можно добавить в блоке ниже.</p>';
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
function photoRowHtml(path,index){
  return '<div class="kb-photo-row" data-photo-row data-path="'+esc(path)+'"><div class="kb-photo-preview"><img src="'+esc(photoPreviewSrc(path))+'" alt=""></div><div class="kb-photo-meta"><strong>Фото '+(index+1)+'</strong><code>'+esc(path)+'</code></div><div class="kb-photo-actions"><button type="button" class="kb-mini" data-photo-up title="Выше">↑</button><button type="button" class="kb-mini" data-photo-down title="Ниже">↓</button><button type="button" class="kb-mini" data-photo-replace>Заменить</button><button type="button" class="kb-mini danger" data-photo-remove>Удалить</button></div></div>';
}
function photoEditorHtml(ctx){
  const images=ctx.images||[];
  return '<section class="kb-admin-section kb-photo-section"><div class="kb-photo-head"><div><h3>Фотографии</h3><p class="kb-admin-hint">Загруженные здесь файлы сохраняются в репозитории в отдельной папке товара и автоматически привязываются к этой карточке. Можно менять порядок, заменять и удалять фото.</p></div><div><button type="button" class="kb-admin-btn ghost" data-photo-add>+ Добавить фото</button><input type="file" accept="image/png,image/jpeg,image/webp" multiple data-photo-file hidden><input type="file" accept="image/png,image/jpeg,image/webp" data-photo-replace-file hidden></div></div><div class="kb-photo-list" data-photo-list>'+images.map(photoRowHtml).join("")+'</div><textarea data-images hidden>'+esc(linesText(images))+'</textarea></section>';
}
function syncPhotoState(body){
  const rows=[...body.querySelectorAll("[data-photo-row]")],paths=rows.map(r=>r.dataset.path).filter(Boolean);
  rows.forEach((r,i)=>{const strong=r.querySelector(".kb-photo-meta strong");if(strong)strong.textContent="Фото "+(i+1)});
  const ta=body.querySelector("[data-images]");if(ta)ta.value=paths.join("\n");
  return paths;
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
  const id=form.dataset.id,images=syncPhotoState(body),o=await loadOverrides(true),out=deep(o.products?.[id]||{});
  if(same(images,editorCtx.sourceImages||[]))delete out.images;else out.images=images;
  if(emptyObject(out))delete o.products[id];else o.products[id]=out;
  await commitOverrides(o);
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
  const sourceSheet=ctx.sourceSection||ctx.section;
  const sheet=ctx.spreadsheetId&&sourceSheet?.gid!=null?'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(ctx.spreadsheetId)+'/edit#gid='+encodeURIComponent(sourceSheet.gid):"";
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
function sectionProductsEditor(ctx){
  const cards=ctx.productCards||[],deleted=ctx.deletedProductCards||[];
  if(!cards.length&&!deleted.length)return "";
  const active=cards.map(p=>'<div class="kb-product-sort-row '+(p.hidden?"is-hidden":"")+'" draggable="true" data-section-product-row data-id="'+esc(p.id)+'">'+
      '<span class="kb-drag" title="Перетащить">⋮⋮</span>'+
      '<div class="kb-product-sort-name"><strong>'+esc(p.name)+'</strong>'+(p.article?'<small>Арт. '+esc(p.article)+'</small>':'')+'</div>'+
      '<button type="button" class="kb-mini" data-product-up title="Выше">↑</button><button type="button" class="kb-mini" data-product-down title="Ниже">↓</button>'+
      '<label class="kb-product-hide"><input type="checkbox" data-product-hidden '+(p.hidden?"checked":"")+'> <span>Скрыть</span></label>'+
      '<button type="button" class="kb-mini danger kb-product-delete" data-product-delete>Удалить</button>'+
    '</div>').join("");
  const removed=deleted.map(p=>'<div class="kb-deleted-product-row" data-section-deleted-row data-id="'+esc(p.id)+'"><div class="kb-product-sort-name"><strong>'+esc(p.name)+'</strong>'+(p.article?'<small>Арт. '+esc(p.article)+'</small>':'')+'</div><label class="kb-product-restore"><input type="checkbox" data-product-restore> <span>Восстановить при сохранении</span></label></div>').join("");
  return '<section class="kb-admin-section"><div><h3>Карточки товаров</h3><p class="kb-admin-hint"><b>Скрыть</b> — временно убрать карточку с сайта. <b>Удалить</b> — исключить её из структуры сайта, поиска и избранного. Google Sheets при этом не меняется.</p></div>'+
    '<div class="kb-product-sort" data-section-product-list>'+active+'</div>'+
    (deleted.length?'<details class="kb-admin-group kb-deleted-products"><summary>Удалённые карточки <small>'+deleted.length+'</small></summary><div class="kb-deleted-product-list">'+removed+'</div></details>':'')+
    '</section>';
}
function renderSectionEditor(ctx){
  const existing=deep(overrideCache.sections?.[ctx.id]||{});
  const sheet=ctx.spreadsheetId&&ctx.section?.gid!=null?'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(ctx.spreadsheetId)+'/edit#gid='+encodeURIComponent(ctx.section.gid):"";
  setBody(shell(ctx.id+" · "+ctx.section.title,"Редактирование раздела",
    '<form data-admin-section data-id="'+esc(ctx.id)+'" class="kb-admin-form"><label>Название раздела<input name="title" value="'+esc(ctx.section.title||"")+'"></label>'+
    (sheet?'<p><a class="kb-admin-link" target="_blank" rel="noopener" href="'+sheet+'">Открыть этот лист Google Sheets ↗</a></p>':"")+sectionProductsEditor(ctx)+
    '<details class="kb-admin-group" open><summary>Пары «название → значение» <small>'+((ctx.section.pairs||[]).length)+' строк</small></summary><label class="kb-admin-field"><span>Одна строка = <b>название | значение</b></span><textarea rows="10" data-section-pairs>'+esc(pairText((ctx.section.pairs||[]).map(x=>[x.label,x.value])))+'</textarea></label></details>'+
    '<label class="kb-admin-field"><span>Дополнительные заметки — одна заметка на строку</span><textarea rows="8" name="notes">'+esc((ctx.section.notes||[]).join("\n"))+'</textarea></label>'+
    '<details class="kb-admin-group"><summary>Таблицы раздела <small>'+((ctx.section.tables||[]).length)+' таблиц</small></summary><label class="kb-admin-field"><span>Расширенный режим: JSON-массив объектов с title, headers и rows.</span><textarea rows="14" data-section-tables>'+esc(jsonText(ctx.section.tables||[]))+'</textarea></label></details>'+
    '<details class="kb-admin-group"><summary>Расширенный JSON раздела</summary><label class="kb-admin-field"><span>Для редких полей. Обычные поля выше при сохранении имеют приоритет.</span><textarea rows="14" data-section-json>'+esc(jsonText(existing))+'</textarea></label></details>'+
    '<div class="kb-admin-savebar"><button class="kb-admin-btn primary" type="submit">Сохранить раздел</button><button class="kb-admin-btn danger" type="button" data-reset-section>Сбросить ручные правки</button></div></form>'));
}
function renderChapterEditor(ctx){
  setBody(shell("Глава "+ctx.id,ctx.chapter.title,
    '<form data-admin-chapter data-id="'+esc(ctx.id)+'" class="kb-admin-form"><label>Название главы<input name="title" value="'+esc(ctx.chapter.title||"")+'"></label><div class="kb-admin-savebar"><button class="kb-admin-btn primary" type="submit">Сохранить главу</button><button class="kb-admin-btn danger" type="button" data-reset-chapter>Сбросить ручные правки</button></div></form>'));
}
function bindBody(){
  const body=modal?.querySelector("#kbAdminBody");if(!body)return;
  body.querySelector("[data-github-connect]")?.addEventListener("click",async e=>{
    try{await connectGithub();e.currentTarget.textContent="✓ GitHub подключен";showStatus("GitHub подключен на время этой вкладки.")}catch(err){showError(err)}
  });
  body.querySelector("[data-admin-logout]")?.addEventListener("click",()=>{
    sessionStorage.removeItem(ADMIN_SESSION_KEY);sessionStorage.removeItem(GITHUB_TOKEN_KEY);closeAdmin();window.dispatchEvent(new CustomEvent("kb:admin-change"));
  });
  body.querySelector("[data-admin-refresh]")?.addEventListener("click",async e=>{
    const b=e.currentTarget;b.disabled=true;showStatus("Забираю свежие данные из текущего листа Google Sheets…","warn");
    try{
      const r=await window.KB_EDITOR_API?.refreshCurrentSection?.();
      await publishLiveSnapshots();
      await renderEditor();
      showStatus("Готово: "+(r?.sections>1?(r.sections+" листов обновлено"):(("раздел "+(r?.sectionId||"")+" обновлён")))+" из Google Sheets и опубликовано ("+(r?.rows||0)+" строк).");
    }catch(err){showError(err)}finally{b.disabled=false}
  });
  body.querySelector("[data-admin-export]")?.addEventListener("click",async()=>{
    const editorOverrides=await loadOverrides(true);
    let liveSheetSnapshots={};try{liveSheetSnapshots=JSON.parse(localStorage.getItem(LIVE_KEY)||"{}")||{}}catch{}
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
    const source=sourceRowsForTab(editorCtx,id),table={headers:["Название","Значение"],rows:source.map(r=>[String(r?.[0]||""),String(r?.[1]||"")])};
    const label=body.querySelector('[data-admin-tab-row][data-id="'+CSS.escape(id)+'"] [data-tab-label]')?.value.trim()||tableLabel(editorCtx,id);
    wrap?.insertAdjacentHTML("beforeend",tableEditorHtml(id,label,table));
  });

  body.querySelector("[data-photo-add]")?.addEventListener("click",()=>body.querySelector("[data-photo-file]")?.click());
  body.querySelector("[data-photo-file]")?.addEventListener("change",async e=>{
    const input=e.currentTarget,files=[...(input.files||[])];if(!files.length||!editorCtx)return;
    const btn=body.querySelector("[data-photo-add]");if(btn)btn.disabled=true;showStatus("Загружаю фотографии в GitHub…","warn");
    try{
      let current=syncPhotoState(body);
      for(const file of files){
        const ext=imageExt(file);if(!ext)throw new Error("Файл «"+file.name+"» имеет неподдерживаемый формат.");
        const path=nextPhotoPath(editorCtx.id,current,ext);await uploadPhoto(file,path);current.push(path);
        body.querySelector("[data-photo-list]")?.insertAdjacentHTML("beforeend",photoRowHtml(path,current.length-1));
      }
      await persistImagesOnly(body);showStatus("Фотографии загружены, привязаны к товару и опубликованы.");
    }catch(err){showError(err)}finally{input.value="";if(btn)btn.disabled=false}
  });
  body.querySelector("[data-photo-replace-file]")?.addEventListener("change",async e=>{
    const input=e.currentTarget,file=input.files?.[0],old=input.dataset.replacePath||"";if(!file||!old)return;
    const row=body.querySelector('[data-photo-row][data-path="'+CSS.escape(old)+'"]');if(!row)return;
    showStatus("Заменяю фотографию…","warn");
    try{
      const ext=imageExt(file);if(!ext)throw new Error("Поддерживаются PNG, JPG и WEBP.");
      let path=old;
      if(!old.startsWith("img/photos/admin/"))path=nextPhotoPath(editorCtx.id,syncPhotoState(body),ext);
      else path=old.replace(/\.[^.]+$/,"."+ext);
      await uploadPhoto(file,path);
      if(path!==old&&old.startsWith("img/photos/admin/"))await deleteRepoFile(old,"Admin: remove replaced product photo");
      row.dataset.path=path;row.querySelector(".kb-photo-preview img").src=photoPreviewSrc(path);row.querySelector(".kb-photo-meta code").textContent=path;
      await persistImagesOnly(body);showStatus("Фотография заменена и опубликована.");
    }catch(err){showError(err)}finally{input.value="";input.dataset.replacePath=""}
  });
  body.addEventListener("click",async e=>{
    const row=e.target.closest?.("[data-photo-row]");if(!row)return;
    try{
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
    for(const [key] of PAIR_FIELDS){const value=parsePairs(form.querySelector('[data-pair-key="'+key+'"]')?.value||"");putDiff(out,key,value,src[key]||[])}
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
    const o=await loadOverrides();if(emptyObject(out))delete o.products[id];else o.products[id]=out;
    await commitOverrides(o);showStatus("Карточка сохранена в тестовом редакторе. Обновляю страницу…");location.reload();
  }catch(err){showError(err);btn.disabled=false}
}
async function saveSection(e){
  e.preventDefault();const form=e.currentTarget,id=form.dataset.id,btn=e.submitter;btn.disabled=true;
  try{
    const ctx=window.KB_EDITOR_API.current(),src=ctx.sourceSection||{},fd=new FormData(form);
    let out={};const raw=form.querySelector("[data-section-json]")?.value.trim();if(raw){out=JSON.parse(raw);if(!out||Array.isArray(out)||typeof out!=="object")throw new Error("JSON раздела должен быть объектом.");}
    putDiff(out,"title",String(fd.get("title")||""),String(src.title||""));
    putDiff(out,"notes",parseLines(fd.get("notes")||""),src.notes||[]);
    const pairs=parsePairs(form.querySelector("[data-section-pairs]")?.value||"").map(([label,value])=>({label,value}));
    putDiff(out,"pairs",pairs,src.pairs||[]);
    const tables=JSON.parse(form.querySelector("[data-section-tables]")?.value||"[]");
    if(!Array.isArray(tables))throw new Error("Таблицы раздела должны быть JSON-массивом.");
    putDiff(out,"tables",tables,src.tables||[]);
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
    await commitOverrides(o);showStatus("Раздел сохранён в тестовом редакторе.");location.reload();
  }catch(err){showError(err);btn.disabled=false}
}
async function saveChapter(e){
  e.preventDefault();const form=e.currentTarget,id=form.dataset.id,btn=e.submitter;btn.disabled=true;
  try{
    const ctx=window.KB_EDITOR_API.current(),src=ctx.sourceChapter||{},title=String(new FormData(form).get("title")||""),out={};putDiff(out,"title",title,String(src.title||""));
    const o=await loadOverrides();if(emptyObject(out))delete o.chapters[id];else o.chapters[id]=out;
    await commitOverrides(o);showStatus("Глава сохранена в тестовом редакторе.");location.reload();
  }catch(err){showError(err);btn.disabled=false}
}
async function resetOverride(kind,id){
  if(!id)return;
  try{const o=await loadOverrides();delete o[kind][id];await commitOverrides(o);showStatus("Ручные правки сброшены.");location.reload()}catch(err){showError(err)}
}

window.addEventListener("kb:ready",ensureUI);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ensureUI);else ensureUI();
