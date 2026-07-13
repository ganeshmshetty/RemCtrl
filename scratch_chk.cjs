const fs = require('fs');
const content = fs.readFileSync('/Users/ganesh/Library/Application Support/Electron/workflows.json', 'utf8');
const obj = JSON.parse(content);
const sel = obj.workflows[0].steps[1].selector;
console.log(`Selector is: >${sel}<, length: ${sel.length}, char codes: ${[...sel].map(c => c.charCodeAt(0)).join(',')}`);
