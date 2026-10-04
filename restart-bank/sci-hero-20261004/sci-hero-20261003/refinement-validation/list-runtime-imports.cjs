const fs = require('node:fs');
const ts = require('/Users/paulslee/.codex/worktrees/core-capacity-intervention-20260919/node_modules/typescript/lib/typescript.js');
const input = JSON.parse(fs.readFileSync(0,'utf8')); const result = {};
for (const file of input) {
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file, compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,resolveJsonModule:true}}).outputText;
 const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true); const paths=new Set();
 function walk(n){
  if ((ts.isImportDeclaration(n)||ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) paths.add(n.moduleSpecifier.text);
  if(ts.isCallExpression(n)&&n.arguments.length&&ts.isStringLiteral(n.arguments[0])&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==='require'))) paths.add(n.arguments[0].text);
  ts.forEachChild(n,walk);
 }
 walk(ast); result[file]=[...paths];
}
process.stdout.write(JSON.stringify(result));
