const PREFIX="tian_kb_v2_";
function read(key,fallback){
  try{const v=localStorage.getItem(PREFIX+key);return v==null?fallback:JSON.parse(v)}catch{return fallback}
}
function write(key,value){
  try{localStorage.setItem(PREFIX+key,JSON.stringify(value))}catch{}
  return value;
}
export const favorites={
  get:()=>read("favorites",[]),
  has:id=>read("favorites",[]).includes(id),
  toggle(id){const a=this.get();const i=a.indexOf(id);if(i>=0)a.splice(i,1);else a.unshift(id);return write("favorites",a)},
  clear:()=>write("favorites",[])
};
export const recent={
  get:()=>read("recent",[]),
  add(id){const a=this.get().filter(x=>x!==id);a.unshift(id);return write("recent",a.slice(0,12))}
};
export function getTheme(){return read("theme","system")}
export function setTheme(theme){write("theme",theme);applyTheme(theme);return theme}
export function applyTheme(theme=getTheme()){
  const dark=theme==="dark"||(theme==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme=dark?"dark":"light";
}
export function cycleTheme(){
  const cur=getTheme(), next=cur==="system"?"light":cur==="light"?"dark":"system";
  setTheme(next);return next;
}
