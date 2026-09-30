const CFG={
  repo:"surniiyka-cloud/kniga_znaniy",
  branch:"site-v2",
  overridesPath:"data/admin-overrides.json",
  workflow:"sync-book-v2.yml"
};
const TOKEN_KEY="kb_admin_token";
let token=sessionStorage.getItem(TOKEN_KEY)||"";
let overrideCache=null,overrideSha=null;

const esc=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const deep=(v)=>v==null?v:JSON.parse(JSON.stringify(v));
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const safe=(v)=>String(v||"item").toLowerCase().replace(/[^a-zа-яё0-9._-]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,90)||"item";
const apiPath=(p)=>p.split("/").map(encodeURIComponent).join("/");

function headers(){
  return {
    "Accept":"application/vnd.github+json",
    "Authorization":"Bearer "+token,
    "X-GitHub-Api-Version":"2022-11-28"
  };
}
function utf8ToBase64(str){
  const bytes=new TextEncoder().encode(str);let out="";
  for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(out);
}
function base64ToUtf8(s){
  const bin=atob(String(s||"").replace(/\s/g,""));const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function bufferToBase64(buffer){
  const bytes=new Uint8Array(buffer);let out="";
  for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(out);
}
async function gh(url,opt={}){
  const res=await fetch(url,{...opt,headers:{...headers(),...(opt.headers||{})}});
  if(res.status===204)return null;
  const text=await res.text();let body=null;try{body=text?JSON.parse(text):null}catch{body=text}
  if(!res.ok){const msg=body?.message||body||("GitHub HTTP "+res.status);throw new Error(msg)}
  return body;
}
async function verifyToken(value){
  token=value.trim();
  if(!token)throw new Error("Вставь GitHub-токен.");
  const info=await gh("https://api.github.com/repos/"+CFG.repo);
  if(info?.permissions&&info.permissions.push===false&&info.permissions.admin===false)throw new Error("У токена нет права записи в репозиторий.");
  sessionStorage.setItem(TOKEN_KEY,token);
  sessionStorage.setItem("kb_admin","1");
  return info;
}
async function loadOverrides(force=false){
  if(overrideCache&&!force)return overrideCache;
  try{
    const j=await gh("https://api.github.com/repos/"+CFG.repo+"/contents/"+apiPath(CFG.overridesPath)+"?ref="+encodeURIComponent(CFG.branch));
    overrideSha=j.sha;
    overrideCache=JSON.parse(base64ToUtf8(j.content));
  }catch(e){
    if(/not found/i.test(String(e.message))){overrideSha=null;overrideCache={version:1,updatedAt:null,products:{},sections:{},chapters:{}};}
    else throw e;
  }
  overrideCache.products ||= {};
  overrideCache.sections ||= {};
  overrideCache.chapters ||= {};
  return overrideCache;
}
async function commitOverrides(data,message){
  data.version=1;data.updatedAt=new Date().toISOString();
  const body={message,content:utf8ToBase64(JSON.stringify(data,null,2)+"\n"),branch:CFG.branch};
  if(overrideSha)body.sha=overrideSha;
  const j=await gh("https://api.github.com/repos/"+CFG.repo+"/contents/"+apiPath(CFG.overridesPath),{
    method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });
  overrideSha=j?.content?.sha||overrideSha;overrideCache=deep(data);return j;
}
async function uploadImage(file,productId,index){
  const ext=(file.name.match(/\.[a-z0-9]+$/i)||[".jpg"])[0].toLowerCase();
  const name=safe(file.name.replace(/\.[^.]+$/,""))+ext;
  const path="img/admin/"+safe(productId)+"/"+Date.now()+"-"+index+"-"+name;
  const content=bufferToBase64(await file.arrayBuffer());
  await gh("https://api.github.com/repos/"+CFG.repo+"/contents/"+apiPath(path),{
    method:"PUT",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message:"admin: upload image for "+productId,content,branch:CFG.branch})
  });
  return path;
}
async function dispatchSync(){
  await gh("https://api.github.com/repos/"+CFG.repo+"/actions/workflows/"+CFG.workflow+"/dispatches",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ref:CFG.branch})
  });
}
async function latestSync(){
  const j=await gh("https://api.github.com/repos/"+CFG.repo+"/actions/runs?branch="+encodeURIComponent(CFG.branch)+"&per_page=20");
  const run=(j.workflow_runs||[]).find(x=>String(x.path||"").endsWith("/"+CFG.workflow));
  return run||null;
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

let modal=null;
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
function openAdmin(){ensureUI();modal.hidden=false;document.body.classList.add("kb-admin-open");token=sessionStorage.getItem(TOKEN_KEY)||token;if(!token)renderLogin();else renderEditor().catch(showError)}
function closeAdmin(){if(modal)modal.hidden=true;document.body.classList.remove("kb-admin-open")}
function showError(e){const box=modal?.querySelector("[data-admin-status]");if(box){box.className="kb-admin-status error";box.textContent=e?.message||String(e)}else alert(e?.message||e)}
function showStatus(t,kind="ok"){const box=modal?.querySelector("[data-admin-status]");if(box){box.className="kb-admin-status "+kind;box.textContent=t}}

function shell(title,subtitle,inner){
  return '<header class="kb-admin-head"><div><span class="kb-admin-kicker">Администратор</span><h2>'+esc(title)+'</h2><p>'+esc(subtitle||"")+'</p></div><button class="kb-admin-x" type="button" data-admin-close>×</button></header>'+
  '<div class="kb-admin-toolbar"><button class="kb-admin-btn ghost" data-admin-sync>↻ Google Sheets</button><button class="kb-admin-btn ghost" data-admin-sync-status>Статус синхронизации</button><button class="kb-admin-btn ghost" data-admin-logout>Выйти</button></div>'+
  '<div class="kb-admin-status" data-admin-status></div>'+inner;
}
function renderLogin(){
  setBody('<header class="kb-admin-head"><div><span class="kb-admin-kicker">Вход администратора</span><h2>Редактор Книги знаний</h2><p>Токен не записывается в сайт и хранится только до закрытия вкладки.</p></div><button class="kb-admin-x" type="button" data-admin-close>×</button></header>'+
  '<form class="kb-admin-login" data-admin-login><label>GitHub token<input type="password" name="token" autocomplete="off" placeholder="github_pat_…"></label><p>Для обычного редактирования достаточно доступа к содержимому репозитория Read/Write. Для кнопки синхронизации добавь Actions Read/Write.</p><button class="kb-admin-btn primary" type="submit">Войти в редактор</button><div class="kb-admin-status" data-admin-status></div></form>');
}
async function renderEditor(){
  await loadOverrides(true);
  const ctx=window.KB_EDITOR_API?.current?.()||{kind:"dashboard"};
  if(ctx.kind==="product")return renderProductEditor(ctx);
  if(ctx.kind==="section")return renderSectionEditor(ctx);
  if(ctx.kind==="chapter")return renderChapterEditor(ctx);
  const sheet=ctx.spreadsheetId?' <a class="kb-admin-link" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/'+encodeURIComponent(ctx.spreadsheetId)+'/edit">Открыть Google Sheets ↗</a>':"";
  setBody(shell("Панель управления","Открой карточку товара, раздел или главу — и нажми «Редактор».",
    '<div class="kb-admin-dashboard"><h3>Что можно менять</h3><p>Карточки товаров, характеристики, преимущества, вкладки, группы ppb, изображения, заголовки разделов и глав. '+sheet+'</p><p>Правки в редакторе хранятся отдельным слоем и не стираются при автоматической пересборке Google Sheets.</p></div>'));
}
function defaultTabLabel(id,p){
  const map={specs:"Характеристики",indicators:"Измеряемые показатели",options:"Дополнительные опции",variants:"Варианты исполнения",advantages:/Анализатор/i.test(p?.type||"")?"Особенности":"Преимущества / особенности",complectation:"Комплектация",washCycle:"Рекомендуемый цикл мойки",workflow:"Порядок работы",calibration:"Калибровка",assortment:"Линейка",consumables:"Расходные материалы",testKits:"Тест-наборы",substances:"Вещества и ppb"};
  return map[id]||(p?.customTabs||[]).find(t=>t.id===id)?.label||id;
}
function productPairEditors(ctx){
  return PAIR_FIELDS.map(([key,label])=>'<details class="kb-admin-group" '+((ctx.product?.[key]||[]).length?"":"")+'><summary>'+esc(label)+' <small>'+((ctx.product?.[key]||[]).length)+' строк</small></summary><label class="kb-admin-field"><span>Одна строка = <b>название | значение</b>. Порядок строк = порядок на сайте.</span><textarea rows="7" data-pair-key="'+key+'">'+esc(pairText(ctx.product?.[key]||[]))+'</textarea></label></details>').join("");
}
function renderProductEditor(ctx){
  const existing=deep(overrideCache.products?.[ctx.id]||{});
  const tabs=(ctx.tabs||[]).map((t,i)=>'<div class="kb-admin-tabrow" data-admin-tab-row data-id="'+esc(t.id)+'"><button type="button" class="kb-mini" data-tab-up>↑</button><button type="button" class="kb-mini" data-tab-down>↓</button><code>'+esc(t.id)+'</code><input value="'+esc(t.label)+'" data-tab-label><label class="kb-hide"><input type="checkbox" data-tab-hidden '+((ctx.product.hiddenTabs||[]).includes(t.id)?"checked":"")+'> скрыть</label></div>').join("");
  const sheet=ctx.spreadsheetId&&ctx.section?.gid!=null?'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(ctx.spreadsheetId)+'/edit#gid='+encodeURIComponent(ctx.section.gid):"";
  setBody(shell(ctx.product.name||ctx.id,ctx.section.id+" · "+ctx.section.title,
    '<form data-admin-product data-id="'+esc(ctx.id)+'" class="kb-admin-form">'+
    '<div class="kb-admin-grid two"><label>Название<input name="name" value="'+esc(ctx.product.name||"")+'"></label><label>Артикул<input name="article" value="'+esc(ctx.product.article||"")+'"></label><label>Тип<input name="type" value="'+esc(ctx.product.type||"")+'"></label><label>Назначение<textarea name="purpose" rows="3">'+esc(ctx.product.purpose||"")+'</textarea></label></div>'+
    (sheet?'<p><a class="kb-admin-link" target="_blank" rel="noopener" href="'+sheet+'">Открыть исходный лист Google Sheets ↗</a></p>':"")+
    '<section class="kb-admin-section"><h3>Содержимое карточки</h3>'+productPairEditors(ctx)+'</section>'+
    '<details class="kb-admin-group" open><summary>Вещества / группы / ppb <small>'+((ctx.product.substances||[]).length)+' строк</small></summary><label class="kb-admin-field"><span>Формат: <b>группа | вещество | ppb</b>. Именно поле «группа» создаёт заголовок перед таблицей.</span><textarea rows="10" data-substances>'+esc(substancesText(ctx.product.substances||[]))+'</textarea></label></details>'+
    '<details class="kb-admin-group"><summary>Пользовательские вкладки</summary><label class="kb-admin-field"><span>JSON-массив вкладок: id, label, kind = pairs/steps, rows.</span><textarea rows="12" data-custom-tabs>'+esc(jsonText(ctx.product.customTabs||[]))+'</textarea></label></details>'+
    '<section class="kb-admin-section"><h3>Порядок и названия вкладок</h3><div data-tab-list>'+tabs+'</div><p class="kb-admin-hint">Стрелками меняй порядок, поле справа переименовывает вкладку, галочка скрывает её.</p></section>'+
    '<section class="kb-admin-section"><h3>Фотографии</h3><label class="kb-admin-field"><span>Один путь на строку. Порядок строк = порядок в галерее.</span><textarea rows="7" data-images>'+esc(linesText(ctx.images||[]))+'</textarea></label><label class="kb-upload">Добавить изображения<input type="file" accept="image/*" multiple data-image-files></label></section>'+
    '<details class="kb-admin-group"><summary>Расширенный JSON override</summary><label class="kb-admin-field"><span>Для редких полей, которых нет в форме. Поля формы при сохранении имеют приоритет.</span><textarea rows="14" data-advanced>'+esc(jsonText(existing))+'</textarea></label></details>'+
    '<div class="kb-admin-savebar"><button type="submit" class="kb-admin-btn primary">Сохранить карточку</button><button type="button" class="kb-admin-btn danger" data-reset-product>Сбросить ручные правки</button></div></form>'
  ));
}
function renderSectionEditor(ctx){
  const existing=deep(overrideCache.sections?.[ctx.id]||{});
  const sheet=ctx.spreadsheetId&&ctx.section?.gid!=null?'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(ctx.spreadsheetId)+'/edit#gid='+encodeURIComponent(ctx.section.gid):"";
  setBody(shell(ctx.id+" · "+ctx.section.title,"Редактирование раздела",
    '<form data-admin-section data-id="'+esc(ctx.id)+'" class="kb-admin-form"><label>Название раздела<input name="title" value="'+esc(ctx.section.title||"")+'"></label>'+
    (sheet?'<p><a class="kb-admin-link" target="_blank" rel="noopener" href="'+sheet+'">Открыть этот лист Google Sheets ↗</a></p>':"")+
    '<label class="kb-admin-field"><span>Дополнительные заметки — одна заметка на строку</span><textarea rows="8" name="notes">'+esc((ctx.section.notes||[]).join("\n"))+'</textarea></label>'+
    '<details class="kb-admin-group"><summary>Расширенный JSON раздела</summary><textarea rows="14" data-section-json>'+esc(jsonText(existing))+'</textarea></details>'+
    '<div class="kb-admin-savebar"><button class="kb-admin-btn primary" type="submit">Сохранить раздел</button><button class="kb-admin-btn danger" type="button" data-reset-section>Сбросить ручные правки</button></div></form>'));
}
function renderChapterEditor(ctx){
  setBody(shell("Глава "+ctx.id,ctx.chapter.title,
    '<form data-admin-chapter data-id="'+esc(ctx.id)+'" class="kb-admin-form"><label>Название главы<input name="title" value="'+esc(ctx.chapter.title||"")+'"></label><div class="kb-admin-savebar"><button class="kb-admin-btn primary" type="submit">Сохранить главу</button><button class="kb-admin-btn danger" type="button" data-reset-chapter>Сбросить ручные правки</button></div></form>'));
}
function bindBody(){
  const body=modal?.querySelector("#kbAdminBody");if(!body)return;
  body.querySelector("[data-admin-login]")?.addEventListener("submit",async e=>{
    e.preventDefault();const b=e.submitter;b.disabled=true;
    try{await verifyToken(new FormData(e.currentTarget).get("token"));showStatus("Вход выполнен.");await renderEditor();}
    catch(err){showError(err);b.disabled=false}
  });
  body.querySelector("[data-admin-logout]")?.addEventListener("click",()=>{sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem("kb_admin");token="";overrideCache=null;location.reload()});
  body.querySelector("[data-admin-sync]")?.addEventListener("click",async e=>{
    e.currentTarget.disabled=true;try{await dispatchSync();showStatus("Пересборка из Google Sheets запущена. Кнопка «Статус синхронизации» покажет результат.");}catch(err){showError(err)}finally{e.currentTarget.disabled=false}
  });
  body.querySelector("[data-admin-sync-status]")?.addEventListener("click",async e=>{
    e.currentTarget.disabled=true;try{const r=await latestSync();if(!r)showStatus("Запусков синхронизации пока не найдено.","warn");else showStatus("Синхронизация: "+(r.status||"—")+(r.conclusion?" · "+r.conclusion:"")+" · "+new Date(r.updated_at||r.created_at).toLocaleString("ru-RU"));}catch(err){showError(err)}finally{e.currentTarget.disabled=false}
  });
  body.querySelectorAll("[data-tab-up]").forEach(b=>b.onclick=()=>{const r=b.closest("[data-admin-tab-row]");r?.previousElementSibling?.before(r)});
  body.querySelectorAll("[data-tab-down]").forEach(b=>b.onclick=()=>{const r=b.closest("[data-admin-tab-row]");r?.nextElementSibling?.after(r)});
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
    putDiff(out,"substances",parseSubstances(form.querySelector("[data-substances]")?.value||""),src.substances||[]);
    const custom=JSON.parse(form.querySelector("[data-custom-tabs]")?.value||"[]");if(!Array.isArray(custom))throw new Error("Пользовательские вкладки должны быть JSON-массивом.");
    putDiff(out,"customTabs",custom,src.customTabs||[]);
    const tabRows=[...form.querySelectorAll("[data-admin-tab-row]")];
    const order=tabRows.map(r=>r.dataset.id),hidden=tabRows.filter(r=>r.querySelector("[data-tab-hidden]")?.checked).map(r=>r.dataset.id),labels={};
    for(const r of tabRows){const id2=r.dataset.id,val=r.querySelector("[data-tab-label]")?.value.trim()||id2,def=defaultTabLabel(id2,src);if(val!==def)labels[id2]=val}
    if(order.length)out.tabOrder=order;else delete out.tabOrder;
    if(hidden.length)out.hiddenTabs=hidden;else delete out.hiddenTabs;
    if(Object.keys(labels).length)out.tabLabels=labels;else delete out.tabLabels;
    let images=parseLines(form.querySelector("[data-images]")?.value||"");
    const files=[...(form.querySelector("[data-image-files]")?.files||[])];
    if(files.length){showStatus("Загружаю изображения…","warn");for(let i=0;i<files.length;i++)images.push(await uploadImage(files[i],id,i))}
    putDiff(out,"images",images,ctx.sourceImages||[]);
    const o=await loadOverrides();if(emptyObject(out))delete o.products[id];else o.products[id]=out;
    await commitOverrides(o,"admin: edit product "+id);showStatus("Карточка сохранена. Обновляю страницу…");location.reload();
  }catch(err){showError(err);btn.disabled=false}
}
async function saveSection(e){
  e.preventDefault();const form=e.currentTarget,id=form.dataset.id,btn=e.submitter;btn.disabled=true;
  try{
    const ctx=window.KB_EDITOR_API.current(),src=ctx.sourceSection||{},fd=new FormData(form);
    let out={};const raw=form.querySelector("[data-section-json]")?.value.trim();if(raw){out=JSON.parse(raw);if(!out||Array.isArray(out)||typeof out!=="object")throw new Error("JSON раздела должен быть объектом.");}
    putDiff(out,"title",String(fd.get("title")||""),String(src.title||""));
    putDiff(out,"notes",parseLines(fd.get("notes")||""),src.notes||[]);
    const o=await loadOverrides();if(emptyObject(out))delete o.sections[id];else o.sections[id]=out;
    await commitOverrides(o,"admin: edit section "+id);showStatus("Раздел сохранён.");location.reload();
  }catch(err){showError(err);btn.disabled=false}
}
async function saveChapter(e){
  e.preventDefault();const form=e.currentTarget,id=form.dataset.id,btn=e.submitter;btn.disabled=true;
  try{
    const ctx=window.KB_EDITOR_API.current(),src=ctx.sourceChapter||{},title=String(new FormData(form).get("title")||""),out={};putDiff(out,"title",title,String(src.title||""));
    const o=await loadOverrides();if(emptyObject(out))delete o.chapters[id];else o.chapters[id]=out;
    await commitOverrides(o,"admin: edit chapter "+id);showStatus("Глава сохранена.");location.reload();
  }catch(err){showError(err);btn.disabled=false}
}
async function resetOverride(kind,id){
  if(!id)return;
  try{const o=await loadOverrides();delete o[kind][id];await commitOverrides(o,"admin: reset "+kind+" "+id);showStatus("Ручные правки сброшены.");location.reload()}catch(err){showError(err)}
}

window.addEventListener("kb:ready",ensureUI);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ensureUI);else ensureUI();
