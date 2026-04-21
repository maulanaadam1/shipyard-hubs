const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory() && !file.includes('node_modules') && !file.includes('.next') && !file.includes('.git')) { 
            results = results.concat(walk(file));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            results.push(file);
        }
    });
    return results;
}

const files = walk('./');
files.forEach(file => {
    if (file.includes('api-client.ts')) return;

    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    
    if (content.includes('@/lib/supabase')) {
        content = content.replace(/import \{ supabase \} from '@\/lib\/supabase'/g, "import { api } from '@/lib/api-client'");
        changed = true;
    }
    if (/supabase\s*\./.test(content)) {
        content = content.replace(/supabase\s*\./g, "api.");
        changed = true;
    }
    
    if (changed) {
        fs.writeFileSync(file, content);
        console.log('Updated ' + file);
    }
});
