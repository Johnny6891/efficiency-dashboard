import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = { project: '', rules: 'firestore.rules' };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--project' && val) {
      args.project = String(val);
      i += 1;
      continue;
    }
    if (key === '--rules' && val) {
      args.rules = String(val);
      i += 1;
      continue;
    }
  }
  return args;
}

function base64url(input) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return raw
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createJwt(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaim = base64url(JSON.stringify(claim));
  const signingInput = `${encodedHeader}.${encodedClaim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

async function fetchAccessToken(serviceAccount) {
  const assertion = createJwt(serviceAccount);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error('Access token missing in token response.');
  }
  return json.access_token;
}

async function createRuleset(projectId, rulesContent, accessToken) {
  const endpoint = `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`;
  const body = {
    source: {
      files: [
        {
          name: 'firestore.rules',
          content: rulesContent,
        },
      ],
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create ruleset (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (!json.name) {
    throw new Error('Ruleset creation response missing ruleset name.');
  }
  return json.name;
}

async function releaseRules(projectId, rulesetName, accessToken) {
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  const endpoint = `https://firebaserules.googleapis.com/v1/${releaseName}`;
  const body = {
    release: {
      name: releaseName,
      rulesetName,
    },
    updateMask: 'ruleset_name',
  };

  const res = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to release rules (${res.status}): ${text}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.project) {
    throw new Error('Missing required --project <PROJECT_ID>');
  }

  const rulesPath = path.resolve(args.rules);
  if (!fs.existsSync(rulesPath)) {
    throw new Error(`Rules file not found: ${rulesPath}`);
  }
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set.');
  }
  const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Credential JSON missing client_email/private_key.');
  }

  const token = await fetchAccessToken(serviceAccount);
  const rulesetName = await createRuleset(args.project, rulesContent, token);
  await releaseRules(args.project, rulesetName, token);

  console.log(`Firestore rules released: ${rulesetName}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
