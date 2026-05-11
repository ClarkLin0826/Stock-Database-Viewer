const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const regexes = [
  [/(?<!:)bg-white(?!\/)/g, 'bg-white dark:bg-gray-900'],
  [/(?<!:)bg-gray-50(?!\/)/g, 'bg-gray-50 dark:bg-gray-950'],
  [/(?<!:)bg-gray-100(?!\/)/g, 'bg-gray-100 dark:bg-gray-800'],
  [/(?<!:)bg-gray-200(?!\/)/g, 'bg-gray-200 dark:bg-gray-700'],

  [/(?<!:)text-gray-900/g, 'text-gray-900 dark:text-gray-50'],
  [/(?<!:)text-gray-800/g, 'text-gray-800 dark:text-gray-100'],
  [/(?<!:)text-gray-700/g, 'text-gray-700 dark:text-gray-200'],
  [/(?<!:)text-gray-600/g, 'text-gray-600 dark:text-gray-300'],
  [/(?<!:)text-gray-500/g, 'text-gray-500 dark:text-gray-400'],
  [/(?<!:)text-gray-400/g, 'text-gray-400 dark:text-gray-500'],

  [/(?<!:)border-gray-100/g, 'border-gray-100 dark:border-gray-800'],
  [/(?<!:)border-gray-200/g, 'border-gray-200 dark:border-gray-700'],
  [/(?<!:)border-gray-300/g, 'border-gray-300 dark:border-gray-600'],

  [/(?<!:)hover:bg-gray-50/g, 'hover:bg-gray-50 dark:hover:bg-gray-800'],
  [/(?<!:)hover:bg-gray-100/g, 'hover:bg-gray-100 dark:hover:bg-gray-800'],
  [/(?<!:)hover:bg-gray-200/g, 'hover:bg-gray-200 dark:hover:bg-gray-700'],
  
  [/(?<!:)hover:text-gray-900/g, 'hover:text-gray-900 dark:hover:text-gray-50'],
  [/(?<!:)hover:text-gray-700/g, 'hover:text-gray-700 dark:hover:text-gray-100']
];

for (const [reg, repl] of regexes) {
  content = content.replace(reg, repl);
}

// Clean up duplicate dark classes
content = content.replace(/dark:bg-gray-900 dark:bg-gray-800/g, 'dark:bg-gray-800');
content = content.replace(/dark:[a-z0-9-]+(?:\s+dark:[a-z0-9-]+)+/g, match => {
  const words = match.split(/\s+/);
  return [...new Set(words)].join(' ');
});

fs.writeFileSync('src/App.tsx', content);
console.log('Script ran successfully.');
