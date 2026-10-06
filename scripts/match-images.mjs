import fs from "node:fs/promises";
import path from "node:path";

const book=JSON.parse(await fs.readFile("data/book.json","utf8"));
const aliases=JSON.parse(await fs.readFile("data/image-aliases.json","utf8").catch(()=>"{}"));
const root=path.resolve("img/photos");
const folderHints={
  "02-testy-4-gruppy":["2.1.1"],
  "03-testy-dopolnitelnyh-grupp":["2.1.2","2.1.3","2.1.4"],
  "05-sistema-extenso":["2.3"],
  "06-test-plastiny-kangaroosci":["2.13"],
  "07-turbidofluorimetr-biotf":["2.15"],
  "08-analizatory-kachestva-moloka":["2.6.1","2.6.2","2.6.3","2.6.4","2.6.5","2.6.6","2.6.7"],
  "09-analizatory-somatiki":["2.7.1","2.7.2"],
  "10-lyuminometr":["2.16"],
  "11-pitatelnye-sredy-uglich":["2.14"],
  "12-inkubatory-i-schityvayuschie-ustroystva":["2.4","2.5"],
  "13-sredstva-dlya-vymeni":["3.4","3.5"],
  "14-vspomogatelnye-tovary-dlya-doeniya":["3.1","3.2","3.3","3.8","3.9"],
  "15-bumaga-polotentsa-salfetki":["3.6"],
  "16-filtry-i-soputstvuyushchie-tovary":["3.7"],
  "17-moyushchie-i-dezinfitsiruyushchie-sredstva":["8.3"],
  "18-dezinfektsiya-generatory-tumana":["9.1"],
  "19-rabochiy-i-uborochnyy-inventar":["8.1","8.2"],
  "20-spetsodezhda-i-sredstva-zashchity":["11.1","11.2","11.3"],
  "21-analiz-pischevareniya-krs-pensilvanskoe-sito":["4.3"],
  "22-diagnostika-obmena-veshchestv-krs":["4.9"],
  "23-fiksatsiya-i-usmirenie-zhivotnyh":["4.7","5.6"],
  "24-uhod-za-kopytami":["5.2"],
  "25-uhod-za-shkuroy-i-udalenie-rogov":["5.1","6.11"]
};
const trMap={"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya"};
function translit(s){return String(s??"").toLowerCase().split("").map(ch=>trMap[ch]??ch).join("")}
function norm(s){
  return translit(s).replace(/\.(png|jpe?g|webp)$/i,"").replace(/^\d{2}-/,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}
function articleNorm(s){return String(s??"").toLowerCase().replace(/[^a-zа-я0-9]/gi,"")}
const SIZE_NAMES=new Set(["s","m","l","xl","xxl","xxxl","xs"]);
const STOP=new Set(["dlya","tian","ankar","sht","sm","mm","s","i","iz","na","po","v","bez","pod"]);
function tokenList(s){
  return norm(s).split("-").filter(x=>(x.length>2||/^\\d+$/.test(x))&&!STOP.has(x));
}
function tokens(s){return new Set(tokenList(s))}
function tokenMatch(a,b){
  if(a===b)return true;
  if(/^\\d+$/.test(a)||/^\\d+$/.test(b))return false;
  const m=Math.min(a.length,b.length);
  return m>=4&&(a.startsWith(b)||b.startsWith(a));
}
function similarity(a,b){
  const A=[...tokens(a)],B=[...tokens(b)]; if(!A.length||!B.length)return 0;
  const used=new Set();let hit=0;
  for(const x of A){
    const j=B.findIndex((y,i)=>!used.has(i)&&tokenMatch(x,y));
    if(j>=0){used.add(j);hit++}
  }
  return hit/Math.max(A.length,B.length);
}
function articleHit(article,file){
  const f=new Set(tokenList(file).map(x=>/^\\d+$/.test(x)?String(Number(x)):x));
  const parts=String(article||"").toLowerCase().match(/[a-zа-я]+|\\d+/gi)||[];
  return parts.some(x=>{
    const z=/^\\d+$/.test(x)?String(Number(x)):norm(x);
    return z.length>=3&&f.has(z);
  });
}
function validProductName(name){
  const n=norm(name);
  return n.length>=4 && !SIZE_NAMES.has(n) && !/^\d+(?:-\d+)*$/.test(n);
}
const images=[];
async function walk(dir){
  for(const ent of await fs.readdir(dir,{withFileTypes:true})){
    const abs=path.join(dir,ent.name);
    if(ent.isDirectory())await walk(abs);
    else if(/\.(png|jpe?g|webp)$/i.test(ent.name)){
      const rel=path.relative(".",abs).split(path.sep).join("/");
      const folder=path.relative(root,path.dirname(abs)).split(path.sep).join("/");
      images.push({path:rel,folder,file:ent.name,norm:norm(ent.name)});
    }
  }
}
await walk(root);

const products=[];
const sectionTitles=[];
for(const ch of book.chapters)for(const sec of ch.sections){
  sectionTitles.push({section:sec.id,title:sec.title});
  for(const p of sec.products||[])products.push({section:sec.id,...p});
}
function scoreImage(img,p){
  if(!validProductName(p.name))return {score:0,strong:false};
  const pn=norm(p.name||""), iname=img.norm;
  const hinted=folderHints[img.folder]||[];
  const inHint=hinted.includes(p.section);
  const exact=pn&&iname===pn;
  const substring=pn.length>=7&&(iname.includes(pn)||pn.includes(iname));
  const sim=similarity(p.name,iname);
  const art=articleNorm(p.article);
  const article=(art.length>=4&&articleNorm(img.file).includes(art))||articleHit(p.article,img.file);
  let s=0;
  if(exact)s=100;
  else if(article)s=94;
  else if(substring)s=88;
  else if(sim>=0.78)s=88;
  else if(sim>=0.62)s=82;
  else if(sim>=0.50)s=76;
  if(inHint)s+=10;
  else if(hinted.length&&s<95)s-=24;
  return {score:Math.max(0,Math.min(110,s)),strong:exact||article||substring||sim>=0.58};
}
const productAssets={};
const sectionAssets={};
const imageAssignments={};
const ambiguous=[];
const invalidAliases=[];
for(const img of images){
  // Фото, загруженные через редактор, лежат в img/photos/admin/<product-id>/.
  // Имя папки уже является стабильным id карточки. Такие привязки считаем ручными
  // и не отправляем обратно в автоматический матчинг: карточка может создаваться
  // в браузере из подробного блока Google Sheets и отсутствовать в book.json.
  const adminMatch=img.folder.match(/^admin\/(.+)$/);
  if(adminMatch?.[1]){
    const productId=adminMatch[1];
    (productAssets[productId] ||= []).push(img.path);
    imageAssignments[img.path]={type:"product",id:productId,score:1000,source:"admin-folder"};
    continue;
  }
  const manual=aliases[img.path];
  if(manual){
    if(manual.product){
      const p=products.find(x=>x.id===manual.product);
      if(p){
        (productAssets[p.id] ||= []).push(img.path);
        imageAssignments[img.path]={type:"product",id:p.id,section:p.section,score:999,source:"alias"};
        continue;
      }
      invalidAliases.push({image:img.path,target:manual.product,type:"product"});
    }else if(manual.section){
      const s=sectionTitles.find(x=>x.section===manual.section);
      if(s){
        (sectionAssets[s.section] ||= []).push(img.path);
        imageAssignments[img.path]={type:"section",id:s.section,score:999,source:"alias"};
        continue;
      }
      invalidAliases.push({image:img.path,target:manual.section,type:"section"});
    }
  }
  const scored=products.map(p=>{
    const e=scoreImage(img,p); return {p,...e};
  }).filter(x=>x.strong&&x.score>=76).sort((a,b)=>b.score-a.score);
  if(scored.length){
    const best=scored[0], second=scored[1];
    const close=scored.filter(x=>best.score-x.score<7);
    if(close.length>1){
      ambiguous.push({image:img.path,candidates:close.slice(0,5).map(x=>({id:x.p.id,name:x.p.name,section:x.p.section,score:+x.score.toFixed(1)}))});
    }else{
      const p=best.p;
      (productAssets[p.id] ||= []).push(img.path);
      imageAssignments[img.path]={type:"product",id:p.id,section:p.section,score:+best.score.toFixed(1)};
      continue;
    }
  }
  const hinted=(folderHints[img.folder]||[]);
  if(hinted.length===1){
    (sectionAssets[hinted[0]] ||= []).push(img.path);
    imageAssignments[img.path]={type:"section",id:hinted[0],score:1};
  }else if(hinted.length>1){
    const ranked=hinted.map(id=>{
      const s=sectionTitles.find(x=>x.section===id);
      return {id,title:s?.title||id,score:similarity(s?.title||"",img.file)};
    }).sort((a,b)=>b.score-a.score);
    const best=ranked[0],second=ranked[1];
    if(best&&best.score>=0.45&&(!second||best.score-second.score>=0.12)){
      (sectionAssets[best.id] ||= []).push(img.path);
      imageAssignments[img.path]={type:"section",id:best.id,score:+best.score.toFixed(2)};
    }
  }
}
// Ручные фото из редактора всегда имеют приоритет над автоматическими совпадениями.
// Если фото заменяли несколько раз, более новый номер (-02, -03...) идёт первым.
for(const [productId,list] of Object.entries(productAssets)){
  const adminPrefix="img/photos/admin/"+productId+"/";
  list.sort((a,b)=>{
    const aa=String(a).startsWith(adminPrefix),bb=String(b).startsWith(adminPrefix);
    if(aa!==bb)return aa?-1:1;
    if(aa&&bb){
      const num=x=>Number(String(x).match(/-(\d+)\.[^.]+$/)?.[1]||0);
      return num(b)-num(a);
    }
    return 0;
  });
}
const matchedImages=Object.keys(imageAssignments);
const unmatchedImages=images.filter(x=>!imageAssignments[x.path]);
function relaxedSuggestions(img){
  const hinted=folderHints[img.folder]||[];
  const pool=hinted.length?products.filter(p=>hinted.includes(p.section)):products;
  return pool.map(p=>{
    const sim=similarity(p.name,img.file);
    const article=articleHit(p.article,img.file);
    const score=(article?1.2:0)+sim;
    return {id:p.id,name:p.name,article:p.article||"",section:p.section,score:+score.toFixed(3)};
  }).filter(x=>x.score>=0.24).sort((a,b)=>b.score-a.score).slice(0,5);
}
const unmatchedSuggestions=unmatchedImages.map(img=>({image:img.path,candidates:relaxedSuggestions(img)}));
const proposedAssets={productImages:productAssets,sectionImages:sectionAssets};
const previousAssets=JSON.parse(await fs.readFile("data/assets.json","utf8").catch(()=>"null"));
let assetsGeneratedAt=new Date().toISOString();
if(previousAssets){
  const {generatedAt:_oldGeneratedAt,...previousCore}=previousAssets;
  if(JSON.stringify(previousCore)===JSON.stringify(proposedAssets))assetsGeneratedAt=previousAssets.generatedAt||assetsGeneratedAt;
}
const assets={generatedAt:assetsGeneratedAt,...proposedAssets};
const report={
  generatedAt:assets.generatedAt,
  imagesTotal:images.length,
  imagesMatched:matchedImages.length,
  imagesUnmatched:unmatchedImages.map(x=>x.path),
  unmatchedSuggestions,
  productsTotal:products.length,
  productsWithImages:products.filter(p=>productAssets[p.id]?.length).length,
  productsWithoutImages:products.filter(p=>!productAssets[p.id]?.length).map(p=>({id:p.id,section:p.section,name:p.name,article:p.article||""})),
  ambiguous,
  invalidAliases
};
await fs.writeFile("data/assets.json",JSON.stringify(assets,null,2)+"\n");
await fs.writeFile("data/image-match-report.json",JSON.stringify(report,null,2)+"\n");
console.log({images:report.imagesTotal,matched:report.imagesMatched,products:report.productsTotal,withImages:report.productsWithImages,ambiguous:ambiguous.length});
