const fs = require('fs');
const path = require('path');

function walk(dir, files = []) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const res = path.resolve(dir, file);
    if (fs.statSync(res).isDirectory()) {
      walk(res, files);
    } else if (res.endsWith('.tsx')) {
      files.push(res);
    }
  }
  return files;
}

const files = walk('src/pages');
let changed = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  const regex = /<Box component=\{Link\} to=\{([^}]+)\} sx=\{\{\s*display:\s*'inline-flex'[\s\S]*?\}\}>\s*<ArrowBackRounded sx=\{\{ fontSize: 15 \}\} \/> Overview\s*<\/Box>/g;
  
  const newContent = content.replace(regex, (match, p1) => {
    return `<Box component={Link} to={${p1}} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: \`1.5px solid \${colors.borderLight}\`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: \`all \${motion.durationFast} \${motion.easeOut}\`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
        </Box>`;
  });
  
  if (content !== newContent) {
    fs.writeFileSync(file, newContent);
    changed++;
    console.log('Fixed', file);
  }
}
console.log('Total fixed:', changed);
