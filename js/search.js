function norm(s){
  return String(s??"").toLowerCase().replace(/ё/g,"е").replace(/[×х]/g,"x")
    .replace(/[^a-zа-я0-9.]+/gi," ").replace(/\s+/g," ").trim();
}
function compact(s){return norm(s).replace(/[^a-zа-я0-9]/gi,"")}
export function makeSearch(index){
  const prepared=index.map(x=>({...x,_n:norm(x.name),_a:compact(x.article),_t:norm(x.text)}));
  return function search(query,limit=30){
    const q=norm(query), qc=compact(query);
    if(!q)return [];
    const terms=q.split(" ").filter(Boolean);
    return prepared.map(x=>{
      let score=0;
      if(x._n===q)score+=120;
      if(x._n.startsWith(q))score+=70;
      else if(x._n.includes(q))score+=46;
      if(qc&&x._a===qc)score+=130;
      else if(qc&&qc.length>=3&&x._a.includes(qc))score+=72;
      for(const term of terms){
        if(x._n.includes(term))score+=18;
        if(x._t.includes(term))score+=6;
      }
      return {item:x,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.item.name.localeCompare(b.item.name,"ru"))
      .slice(0,limit).map(x=>x.item);
  }
}
