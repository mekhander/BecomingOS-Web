import { ALLOWED_GOOGLE_EMAIL, GOOGLE_CLIENT_ID } from './config.js?v=3';

const AUTH_SESSION_KEY = 'becoming-os-authorized-until';
const SESSION_HOURS = 8;

function waitForGoogle(timeout = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (globalThis.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('Google 로그인 모듈을 불러오지 못했습니다.'));
      }
    }, 100);
  });
}

async function requestIdentity() {
  await waitForGoogle();
  const accessToken = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      callback: response => response.error
        ? reject(new Error('Google 로그인을 완료하지 못했습니다.'))
        : resolve(response.access_token),
      error_callback: () => reject(new Error('Google 로그인이 취소되었습니다.'))
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error('Google 계정을 확인하지 못했습니다.');
  return response.json();
}

export async function requireAuthorizedUser() {
  const gate = document.querySelector('#authGate');
  const button = document.querySelector('#authButton');
  const message = document.querySelector('#authMessage');
  const authorizedUntil = Number(sessionStorage.getItem(AUTH_SESSION_KEY) || 0);

  if (authorizedUntil > Date.now()) {
    gate.hidden = true;
    document.body.classList.remove('locked');
    return;
  }

  return new Promise(resolve => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      message.textContent = 'Google 계정을 확인하고 있습니다…';
      try {
        const profile = await requestIdentity();
        if (!profile.email_verified || profile.email?.toLowerCase() !== ALLOWED_GOOGLE_EMAIL) {
          throw new Error('허용된 BecomingOS 계정이 아닙니다.');
        }
        sessionStorage.setItem(AUTH_SESSION_KEY, String(Date.now() + SESSION_HOURS * 60 * 60 * 1000));
        gate.hidden = true;
        document.body.classList.remove('locked');
        resolve();
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
      }
    });
  });
}
