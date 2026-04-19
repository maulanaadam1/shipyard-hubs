const fs = require('fs');
const path = require('path');

const directories = ['./components', './app'];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // Replace background colors and adjust text color for contrast
  content = content.replace(/bg-teal-600 text-white/g, 'bg-[#FDB913] text-slate-900');
  content = content.replace(/bg-teal-500 text-white/g, 'bg-[#FDB913] text-slate-900');
  content = content.replace(/bg-teal-600/g, 'bg-[#FDB913]');
  content = content.replace(/bg-teal-500/g, 'bg-[#FDB913]');
  
  // Replace text colors
  content = content.replace(/text-teal-600/g, 'text-[#FDB913]');
  content = content.replace(/text-teal-500/g, 'text-[#FDB913]');
  content = content.replace(/text-teal-700/g, 'text-[#e5a611]');
  content = content.replace(/text-teal-400/g, 'text-[#FDB913]');
  content = content.replace(/text-teal-300/g, 'text-[#FDB913]/70');
  content = content.replace(/text-teal-200/g, 'text-[#FDB913]/50');
  content = content.replace(/text-teal-100/g, 'text-[#FDB913]/30');
  
  // Replace border colors
  content = content.replace(/border-teal-600/g, 'border-[#FDB913]');
  content = content.replace(/border-teal-500/g, 'border-[#FDB913]');
  content = content.replace(/border-teal-400/g, 'border-[#FDB913]/70');
  content = content.replace(/border-teal-200/g, 'border-[#FDB913]/30');
  content = content.replace(/border-teal-100/g, 'border-[#FDB913]/20');
  
  // Replace ring colors
  content = content.replace(/ring-teal-500\/20/g, 'ring-[#FDB913]/30');
  content = content.replace(/ring-teal-500/g, 'ring-[#FDB913]');
  
  // Replace hover states
  content = content.replace(/hover:bg-teal-700/g, 'hover:bg-[#e5a611]');
  content = content.replace(/hover:bg-teal-600/g, 'hover:bg-[#FDB913]');
  content = content.replace(/hover:bg-teal-500/g, 'hover:bg-[#FDB913]');
  content = content.replace(/hover:bg-teal-400/g, 'hover:bg-[#FDB913]/80');
  content = content.replace(/hover:text-teal-700/g, 'hover:text-[#e5a611]');
  content = content.replace(/hover:text-teal-600/g, 'hover:text-[#FDB913]');
  content = content.replace(/hover:text-teal-500/g, 'hover:text-[#FDB913]');
  content = content.replace(/hover:border-teal-200/g, 'hover:border-[#FDB913]/30');
  
  // Replace light backgrounds
  content = content.replace(/bg-teal-50/g, 'bg-[#FDB913]/10');
  content = content.replace(/bg-teal-100/g, 'bg-[#FDB913]/20');
  
  // Replace shadow colors
  content = content.replace(/shadow-teal-600\/20/g, 'shadow-[#FDB913]/20');
  
  // Replace specific hex codes if any
  content = content.replace(/#0d9488/g, '#FDB913'); // teal-600 hex
  content = content.replace(/#14b8a6/g, '#FDB913'); // teal-500 hex
  content = content.replace(/#0f766e/g, '#e5a611'); // teal-700 hex

  // Fix Header specific text color
  content = content.replace(/<header className="h-16 bg-\[#FDB913\] text-white/g, '<header className="h-16 bg-[#FDB913] text-slate-900');

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      processFile(fullPath);
    }
  }
}

directories.forEach(walkDir);
console.log('Done replacing colors.');
