const spreadsheetId="16PAmRHUQoAFUpWuvp4OkAzqR6XfPkZp9a3WZ2ebsQ3k";
const gid="1781424892";
const url=`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

function parseCsv(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i+1] === '"') { cell += '"'; i++; }
        else quoted=false;
      } else cell += ch;
    } else {
      if (ch === '"') quoted=true;
      else if (ch === ",") { row.push(cell); cell=""; }
      else if (ch === "\n") { row.push(cell.replace(/\r$/,"")); rows.push(row); row=[]; cell=""; }
      else cell += ch;
    }
  }
  row.push(cell.replace(/\r$/,""));
  if (row.some(v=>v!=="")) rows.push(row);
  return rows;
}
const res=await fetch(url);
if(!res.ok) throw new Error(`HTTP ${res.status}`);
const rows=parseCsv(await res.text());
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
const outline=rows.map((r,i)=>({row:i+1,cells:r.map(clean).filter(Boolean)})).filter(x=>x.cells.length);
process.stdout.write(JSON.stringify(outline,null,2));
