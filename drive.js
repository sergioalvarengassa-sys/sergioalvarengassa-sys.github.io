const api = 'https://www.googleapis.com/drive/v3/';
const upload = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const prefix = 'contas-ccs-v1-';
const driveScope = 'https://www.googleapis.com/auth/drive.appdata';
const driveScopeAlias = 'https://www.googleapis.com/auth/drive.appfolder';
const scope = 'openid https://www.googleapis.com/auth/userinfo.email '+driveScope;
let token, expires = 0, loadIdentity, requestConsent = false;

export function prepareGoogle() {
  loadIdentity ??= new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = () => { loadIdentity = undefined; script.remove(); reject(new Error('Não foi possível carregar o login Google.')); };
    document.head.append(script);
  });
  return loadIdentity;
}
export function connected() {
  return Boolean(token && Date.now()<expires);
}
export function disconnect() {
  token = undefined;
  expires = 0;
}
export async function authorize(clientId, email) {
  if (!globalThis.google?.accounts?.oauth2) throw new Error('Aguarde o carregamento do login e tente novamente.');
  const response = await new Promise((resolve,reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id:clientId, scope, callback:resolve,
      error_callback: error => reject(new Error('Login Google: '+error.type))
    });
    client.requestAccessToken({
      ...(email ? {login_hint:email} : {}),
      prompt:requestConsent ? 'consent' : email ? '' : 'select_account'
    });
  });
  if (response.error) {
    requestConsent = response.error === 'access_denied';
    throw new Error('O Google não concluiu a autorização ('+response.error+').');
  }
  if (!response.access_token) throw new Error('O Google não retornou uma sessão de acesso.');
  const grantedScopes = new Set((response.scope || '').split(/\s+/));
  if (!grantedScopes.has(driveScope) && !grantedScopes.has(driveScopeAlias)) {
    requestConsent = true;
    throw new Error('A permissão para os dados do aplicativo no Drive não foi concedida. Clique em Conectar ao Google Drive novamente e marque essa permissão na tela do Google.');
  }
  requestConsent = false;
  token = response.access_token;
  expires = Date.now() + Number(response.expires_in)*1000 - 30000;
  try {
    const profile = await request('https://openidconnect.googleapis.com/v1/userinfo');
    if (!profile.sub || !profile.email) throw new Error('Conta Google não identificada.');
    return profile;
  } catch (error) {
    disconnect();
    throw error;
  }
}
async function request(url, options={}) {
  if (!connected()) throw new Error('Reconecte sua conta Google para sincronizar.');
  const response = await fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+token}});
  if (response.status===401) {
    disconnect();
    throw new Error('A sessão Google expirou. Reconecte para sincronizar.');
  }
  if (response.status===403 || response.status===429) throw new Error('Drive indisponível. As alterações continuam salvas neste aparelho.');
  if (!response.ok) throw new Error('O Drive retornou o código '+response.status+'.');
  return response.json();
}
export async function listBatches() {
  let cursor;
  const result=[];
  do {
    const query = new URLSearchParams({spaces:'appDataFolder',q:"trashed = false and name contains '"+prefix+"'",
      fields:'nextPageToken,files(id,name,size)',pageSize:'1000'});
    if (cursor) query.set('pageToken',cursor);
    const page = await request(api+'files?'+query);
    result.push(...(page.files || []).filter(file => file.name.startsWith(prefix)));
    cursor=page.nextPageToken;
  } while (cursor);
  return result;
}
export const batchId = file => file.name.slice(prefix.length);
export const fetchBatch = file => {
  if (Number(file.size)>10_000_000) throw new Error('Arquivo de sincronização acima do limite.');
  return request(api+'files/'+encodeURIComponent(file.id)+'?alt=media');
};
export async function pushBatch(batch) {
  const boundary='ccs-'+crypto.randomUUID();
  const metadata={name:prefix+batch.id,parents:['appDataFolder'],mimeType:'application/json'};
  const part='\r\n--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n';
  const body=part.slice(2)+JSON.stringify(metadata)+part+JSON.stringify(batch)+'\r\n--'+boundary+'--\r\n';
  return request(upload,{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
}
