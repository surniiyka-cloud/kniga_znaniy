
import {makeSearch} from "./search.js";
import {route,href,go} from "./router.js";
import {favorites,comparison,recent,applyTheme,cycleTheme,getTheme} from "./storage.js";

const q=(s)=>document.querySelector(s);
const app=q("#app"), nav=q("#nav"), searchInput=q("#globalSearch"), searchPanel=q("#searchPanel");
const isAdmin=(()=>{try{return sessionStorage.getItem("kb_admin")==="1"}catch{return false}})();
const sidebarPrefs={
  get(){try{return localStorage.getItem("kb_sidebar_pinned")!=="0"}catch{return true}},
  set(v){try{localStorage.setItem("kb_sidebar_pinned",v?"1":"0")}catch{}}
};
function sidebarIsWide(){return window.matchMedia("(min-width:901px)").matches;}
function sidebarPinned(){return sidebarIsWide()&&sidebarPrefs.get();}
function applySidebarState(){
  const pinned=sidebarPinned();
  document.body.classList.toggle("sidebar-pinned",pinned);
  document.body.classList.toggle("sidebar-unpinned",!pinned);
  const pin=q("#sidebarPinBtn");
  if(pin){
    pin.setAttribute("aria-pressed",String(pinned));
    pin.title=pinned?"Открепить панель":"Закрепить панель";
    pin.textContent=pinned?"⊣":"⊢";
  }
  if(pinned)document.body.classList.remove("sidebar-open");
}
function toggleSidebarFromBurger(){
  if(sidebarPinned()){
    sidebarPrefs.set(false);applySidebarState();
    return;
  }
  document.body.classList.toggle("sidebar-open");
}
function toggleSidebarPin(){
  const next=!sidebarPinned();
  sidebarPrefs.set(next);
  applySidebarState();
  if(!next)document.body.classList.remove("sidebar-open");
}
const state={book:null,assets:{productImages:{},sectionImages:{}},index:[],reports:{sync:null,images:null},versionLog:{current:"2.0",entries:[]},products:new Map(),sections:new Map(),chapters:new Map(),search:()=>[],lightbox:{images:[],index:0,alt:""}};

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

function mapData(){
  state.products.clear();state.sections.clear();state.chapters.clear();
  state.book.chapters.forEach((ch)=>{
    state.chapters.set(ch.id,ch);
    ch.sections.forEach((s)=>{
      state.sections.set(s.id,{chapter:ch,section:s});
      (s.products||[]).forEach((p)=>state.products.set(p.id,{chapter:ch,section:s,product:p}));
    });
  });
}
function renderNav(){
  nav.innerHTML=state.book.chapters.map((ch)=>{
    const sections=ch.sections.filter((s)=>isAdmin||s.id!=="1.3");
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
  if(s.rows?.length){
    const cols=Math.max(1,...s.rows.map((r)=>r.length));
    inner+='<section class="raw-table-block"><h3>Исходные материалы раздела</h3><div class="table-wrap"><table class="data-table"><tbody>'+s.rows.map((r)=>'<tr>'+Array.from({length:cols},(_,i)=>'<td>'+esc(r[i]||"")+'</td>').join("")+'</tr>').join("")+'</tbody></table></div></section>';
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
    renderImportant("Важно знать перед началом оформления документов:",important);
}
function renderNormsSection(ch,s){
  const rows=(s.rows||[]);
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
    renderImportant("Важно знать перед подбором тестов и оборудования:",important,"Обратите внимание: опции, например измерение лактозы, и комплектации — 96/112/480 тестов — могут различаться. Уточняйте артикулы при заказе.");
}
function renderChapter(id){
  const ch=state.chapters.get(id);if(!ch)return notFound();title(ch.title);
  const sections=ch.sections.filter((s)=>isAdmin||s.id!=="1.3");
  app.innerHTML=crumb([{label:"Глава "+ch.id}])+'<div class="page-head"><div><span class="eyebrow">Глава '+esc(ch.id)+'</span><h1>'+esc(ch.title)+'</h1><p>'+sections.length+' подразделов</p></div></div><section class="chapter-grid">'+sections.map((s)=>'<article class="chapter-card" data-num="'+esc(s.id)+'" data-open-section="'+esc(s.id)+'"><span class="chapter-num">'+esc(s.id)+'</span><span class="chapter-arrow">↗</span><h3>'+esc(s.title)+'</h3><p>'+((s.products||[]).length?((s.products||[]).length+" карточек"):"Справочный материал")+'</p></article>').join("")+'</section>';
}
function renderSection(id){
  const x=state.sections.get(id);if(!x)return notFound();const ch=x.chapter,s=x.section;if(id==="1.3"&&!isAdmin)return notFound();title(s.id+" "+s.title);
  if(id==="1.1")return renderTermsSection(ch,s);
  if(id==="1.2")return renderNormsSection(ch,s);
  const items=(s.products||[]).map((p)=>({chapter:ch,section:s,product:p}));
  const sectionImgs=state.assets.sectionImages?.[s.id]||[];
  const subtitle=items.length?items.length+" карточек":(sectionImgs.length?sectionImgs.length+" визуальных позиций":"Справочный материал");
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title}])+
    '<div class="page-head"><div><span class="eyebrow">'+esc(s.id)+' · '+esc(ch.title)+'</span><h1>'+esc(s.title)+'</h1><p>'+subtitle+'</p></div></div>'+
    (items.length?'<div class="filter-row"><input class="filter-input" id="sectionFilter" type="search" placeholder="Поиск внутри раздела…"></div><section class="product-grid" id="sectionProducts">'+grouped(items)+'</section>':visualCatalog(s,sectionImgs))+
    sectionContent(s);
  if(items.length){q("#sectionFilter").addEventListener("input",(e)=>{const z=e.target.value.toLowerCase().trim();const f=items.filter((it)=>[it.product.name,it.product.article,it.product.type,it.product.purpose,it.product.features].filter(Boolean).join(" ").toLowerCase().includes(z));q("#sectionProducts").innerHTML=f.length?grouped(f):'<div class="empty-state" style="grid-column:1/-1"><strong>Ничего не найдено</strong></div>';});}
}
function fields(p){
  return [["Артикул",article(p)||"Не указан"],["Тип",p.type],["Назначение",p.purpose],["Характеристики / особенности",p.features],["Производитель",p.manufacturer],["Страна",p.country]].filter((x)=>x[1]);
}
function renderProduct(id){
  const x=ctx(id);if(!x)return notFound();const p=x.product,s=x.section,ch=x.chapter;recent.add(p.id);counters();title(p.name);
  const imgs=state.assets.productImages?.[p.id]||[],im=imgs[0]||"";
  app.innerHTML=crumb([{label:"Глава "+ch.id,route:"chapter",id:ch.id},{label:s.id+" "+s.title,route:"section",id:s.id},{label:p.name}])+'<div class="product-page"><aside class="gallery-card"><div class="gallery-topline"><span>Фотографии товара</span><b>'+(imgs.length?imgs.length:"—")+'</b></div><div class="gallery-main '+(im?"":"product-image placeholder")+'" '+(im?'data-lightbox-product="'+esc(p.id)+'" data-lightbox-index="0"':"")+'>'+(im?'<img src="./'+esc(im)+'" alt="'+esc(p.name)+'">':'<div class="gallery-empty"><img src="./assets/brand/favicon.svg" alt=""><strong>Фото пока не привязано</strong><span>Карточка уже работает; изображение появится после сопоставления в диагностике.</span></div>')+'</div>'+(imgs.length>1?'<div class="gallery-thumbs">'+imgs.map((v,i)=>'<button class="gallery-thumb '+(i===0?"active":"")+'" data-gallery-product="'+esc(p.id)+'" data-gallery-index="'+i+'"><img src="./'+esc(v)+'" alt=""></button>').join("")+'</div>':"")+'</aside><article class="info-card"><span class="eyebrow">'+esc(s.id)+' · '+esc(s.title)+'</span><h1 class="product-title">'+esc(p.name)+'</h1><div class="product-meta">'+(article(p)?'<span class="badge article">Арт. '+esc(article(p))+'</span>':"")+(p.type?'<span class="badge">'+esc(p.type)+'</span>':"")+'</div>'+(p.purpose?'<p class="product-lead">'+esc(p.purpose)+'</p>':"")+'<div class="quick-actions"><button class="btn '+(favorites.has(p.id)?"active":"")+'" data-fav="'+esc(p.id)+'">★ '+(favorites.has(p.id)?"В избранном":"В избранное")+'</button><button class="btn '+(comparison.has(p.id)?"active":"")+'" data-compare="'+esc(p.id)+'">⇄ '+(comparison.has(p.id)?"Добавлено":"Сравнить")+'</button><button class="btn ghost" data-copy>⌁ Скопировать ссылку</button></div><div class="tabs"><button class="tab active">Карточка товара</button></div><div class="tab-panel"><dl class="definition-list">'+fields(p).map((r)=>'<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>').join("")+'</dl></div></article></div>';
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
  q("#openSidebar").onclick=toggleSidebarFromBurger;q("#sidebarPinBtn").onclick=toggleSidebarPin;q("#closeSidebar").onclick=closeMenu;q("#sidebarBackdrop").onclick=closeMenu;
  window.addEventListener("resize",applySidebarState);
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
  applySidebarState();
  const rs=await Promise.all([
    fetch("./data/book.json",{cache:"no-store"}),
    fetch("./data/assets.json",{cache:"no-store"}),
    fetch("./data/search-index.json",{cache:"no-store"}),
    fetch("./data/sync-report.json",{cache:"no-store"}).catch(()=>null),
    fetch("./data/image-match-report.json",{cache:"no-store"}).catch(()=>null),
    fetch("./data/version-log.json",{cache:"no-store"}).catch(()=>null)
  ]);
  if(!rs[0].ok||!rs[2].ok)throw new Error("Не удалось загрузить данные.");
  state.book=await rs[0].json();
  state.assets=rs[1].ok?await rs[1].json():state.assets;
  state.index=await rs[2].json();
  state.reports.sync=rs[3]?.ok?await rs[3].json():null;
  state.reports.images=rs[4]?.ok?await rs[4].json():null;
  state.versionLog=rs[5]?.ok?await rs[5].json():state.versionLog;
  q("#versionNumber").textContent=state.versionLog.current||"2.0";
  state.search=makeSearch(state.index);
  mapData();renderNav();bind();counters();q("#syncState").textContent="Данные обновлены "+fmtDate(state.book.generatedAt);
  if(!location.hash)go("home");else render();
}
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));}
init().catch((e)=>{console.error(e);app.innerHTML='<div class="empty-state"><strong>Ошибка загрузки</strong><p>'+esc(e.message)+'</p><button class="btn primary" onclick="location.reload()">Повторить</button></div>';});
