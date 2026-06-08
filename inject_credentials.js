const fs = require('fs');
const path = require('path');

const CREDENTIAL_ID = 'stfIva6E9dYUW12u';
const CREDENTIAL_NAME = 'Gold Star Postgres';

function injectCredentials() {
  const dir = path.join(__dirname, 'workflows');
  if (!fs.existsSync(dir)) {
    console.error('Workflows directory not found.');
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let modified = false;

    if (content.nodes && Array.isArray(content.nodes)) {
      for (const node of content.nodes) {
        if (node.type === 'n8n-nodes-base.postgres') {
          node.credentials = {
            postgres: {
              id: CREDENTIAL_ID,
              name: CREDENTIAL_NAME
            }
          };
          modified = true;
        }
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
      console.log(`Injected Postgres credentials into ${file}`);
    }
  }
}

injectCredentials();
