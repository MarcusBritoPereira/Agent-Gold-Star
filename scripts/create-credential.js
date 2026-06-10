const { client } = require('./lib/n8n');
const { loadEnv } = require('./lib/config');

async function createGeminiCredential() {
  loadEnv();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("No GEMINI_API_KEY found in .env");
    return;
  }

  const { request } = client();
  
  // Debug credential type
  try {
    const types = await request('/credential-types');
    const palm = types.data.find(t => t.name === 'googlePalmApi');
    console.log("googlePalmApi schema:", JSON.stringify(palm?.properties, null, 2));
  } catch (e) {
    console.log(e.message);
  }
  try {
    const existing = await request('/credentials');
    const existingCred = existing.data?.find(c => c.name === 'Gold Star Gemini API');
    
    if (existingCred) {
      console.log("Credential already exists. Updating it.");
      await request(`/credentials/${existingCred.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Gold Star Gemini API',
          type: 'googlePalmApi',
          data: {
            apiKey: apiKey
          }
        })
      });
      console.log("Credential updated: ", existingCred.id);
      return existingCred.id;
    } else {
      console.log("Creating new Google Gemini credential...");
      const created = await request('/credentials', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Gold Star Gemini API',
          type: 'googlePalmApi',
          data: {
            apiKey: apiKey
          }
        })
      });
      console.log("Credential created: ", created.id);
      return created.id;
    }
  } catch (error) {
    console.error("Failed to create credential:", error.message);
    return null;
  }
}

module.exports = { createGeminiCredential };
