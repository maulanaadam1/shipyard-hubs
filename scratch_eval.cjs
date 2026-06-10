const fs = require('fs');
const acorn = require('acorn');
const jsx = require('acorn-jsx');
const parser = acorn.Parser.extend(jsx());
try {
  const code = fs.readFileSync('./components/WorkOrderDashboard.tsx', 'utf-8');
  parser.parse(code, { sourceType: 'module', ecmaVersion: 2020 });
  console.log("Syntax is valid (mostly)");
} catch (e) {
  console.log(e.message);
}
