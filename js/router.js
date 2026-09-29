export function route(){
  const raw=(location.hash||"#/home").replace(/^#/,"");
  const parts=raw.split("/").filter(Boolean).map(decodeURIComponent);
  if(!parts.length)return {name:"home"};
  if(parts[0]==="section"&&parts[1])return {name:"section",id:parts[1]};
  if(parts[0]==="product"&&parts[1])return {name:"product",id:parts.slice(1).join("/")};
  if(parts[0]==="chapter"&&parts[1])return {name:"chapter",id:parts[1]};
  if(parts[0]==="favorites")return {name:"favorites"};
  if(parts[0]==="compare")return {name:"compare"};
  return {name:"home"};
}
export function href(name,id=""){
  if(name==="home")return "#/home";
  if(name==="favorites")return "#/favorites";
  if(name==="compare")return "#/compare";
  return `#/${name}/${encodeURIComponent(id)}`;
}
export function go(name,id=""){location.hash=href(name,id)}
