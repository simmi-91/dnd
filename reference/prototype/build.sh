#!/usr/bin/env bash
# Bygger elowen-kampguide.html fra kildefilene. Krever Node og esbuild (npm i -D esbuild).
set -e
cd "$(dirname "$0")"
npx esbuild app.jsx --loader:.jsx=jsx --jsx-factory=React.createElement --jsx-fragment=React.Fragment --target=es2019 --log-level=warning > app.js
node -e "
const fs=require('fs');
const js=fs.readFileSync('derive.js','utf8')+'\n'+fs.readFileSync('app.js','utf8');
if(js.includes('</script'))throw new Error('script close tag in js');
fs.writeFileSync('elowen-kampguide.html', fs.readFileSync('shell.html','utf8').replace('/*APP*/', ()=>js));
"
