const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/focus:bg-white/g, 'focus:bg-white dark:focus:bg-gray-900');

fs.writeFileSync('src/App.tsx', content);
