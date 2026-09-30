import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root=path.resolve("img/photos");
const out=[];

async function walk(dir){
  for(const ent of await fs.readdir(dir,{withFileTypes:true})){
    const abs=path.join(dir,ent.name);
    if(ent.isDirectory()) await walk(abs);
    else if(ent.isFile()){
      const buf=await fs.readFile(abs);
      const st=await fs.stat(abs);
      out.push({
        path:path.relative(".",abs).split(path.sep).join("/"),
        folder:path.relative(root,path.dirname(abs)).split(path.sep).join("/"),
        file:ent.name,
        ext:path.extname(ent.name).slice(1).toLowerCase(),
        bytes:st.size,
        sha256:crypto.createHash("sha256").update(buf).digest("hex")
      });
    }
  }
}
await walk(root);
out.sort((a,b)=>a.path.localeCompare(b.path,"ru"));

const folders={};
for(const f of out){
  folders[f.folder] ||= {files:0,bytes:0};
  folders[f.folder].files++;
  folders[f.folder].bytes+=f.bytes;
}
const byHash={};
for(const f of out)(byHash[f.sha256] ||= []).push(f.path);
const duplicates=Object.values(byHash).filter(x=>x.length>1).sort((a,b)=>b.length-a.length);

const audit={
  generatedAt:new Date().toISOString(),
  totalFiles:out.length,
  totalBytes:out.reduce((s,x)=>s+x.bytes,0),
  extensions:Object.fromEntries([...new Set(out.map(x=>x.ext))].sort().map(ext=>[ext,out.filter(x=>x.ext===ext).length])),
  folders:Object.entries(folders).map(([name,v])=>({name,...v})).sort((a,b)=>a.name.localeCompare(b.name,"ru")),
  duplicateGroups:duplicates,
  files:out
};
await fs.mkdir("data",{recursive:true});
await fs.writeFile("data/image-audit.json",JSON.stringify(audit,null,2)+"\n");
console.log(`Фото: ${audit.totalFiles}; папок: ${audit.folders.length}; дублей: ${audit.duplicateGroups.length}`);
