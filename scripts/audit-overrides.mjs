import fs from "node:fs/promises";

const current=JSON.parse(await fs.readFile("data/admin-overrides.json","utf8"));
const backup=JSON.parse(await fs.readFile("data/admin-overrides.backup.json","utf8").catch(()=>"{\"products\":{}}"));

const cur=current.products||{};
const prev=backup.products||{};
const missingFrozen=Object.entries(prev)
  .filter(([,p])=>p&&p.__frozen)
  .map(([id])=>id)
  .filter(id=>!cur[id]);
const unfrozen=Object.entries(cur)
  .filter(([,p])=>p&&typeof p==="object"&&!p.__frozen)
  .map(([id])=>id);

if(missingFrozen.length){
  console.error("Потеряны защищённые ручные правки:",missingFrozen);
  process.exit(1);
}
if(unfrozen.length){
  console.error("Найдены незащищённые ручные overrides:",unfrozen);
  process.exit(1);
}
console.log({
  products:Object.keys(cur).length,
  frozen:Object.values(cur).filter(p=>p&&p.__frozen).length,
  protectedFromBackup:Object.values(prev).filter(p=>p&&p.__frozen).length
});
