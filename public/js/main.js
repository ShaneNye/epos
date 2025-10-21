// public/js/main.js
console.log('[epos] main.js loaded');

/* ---------- DOM Helper ---------- */
function $(sel, parent = document) {
  return parent.querySelector(sel);
}

/* ---------- Messaging ---------- */
function showMessage(text, type = 'error') {
  let msg = $('#auth-message');
  if (!msg) {
    msg = document.createElement('div');
    msg.id = 'auth-message';
    msg.setAttribute('role', 'alert');
    msg.style.marginTop = '0.75rem';
    msg.style.fontSize = '0.95rem';
    msg.style.lineHeight = '1.4';
    msg.style.padding = '0.75rem 1rem';
    msg.style.borderRadius = '8px';
    msg.style.border = '1px solid transparent';
    $('.portal')?.appendChild(msg);
  }
  msg.textContent = text;
  msg.style.background = type === 'error' ? '#ffe6e6' : '#e6fff2';
  msg.style.borderColor = type === 'error' ? '#ffb3b3' : '#b3ffd9';
}

/* ---------- Main Login Logic ---------- */
window.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('.auth-form');
  if (!form) return;
  console.log('✅ Login form found.');

  form.onsubmit = (e) => {
    e.preventDefault();
    return false;
  };

  const apiBase = window.location.origin;

  // --- Handle login ---
  const loginButton = form.querySelector('button[type="submit"]');
  loginButton.addEventListener('click', async () => {
    console.log('🚀 Login button clicked');

    const env = form.env.value;
    const username = form.username.value.trim();
    const password = form.password.value;
    const remember = form.remember?.checked || false;

    if (!username || !password) {
      showMessage('Please enter both username and password.');
      return;
    }

    const loginURL = `${apiBase}/api/login`;
    console.log('➡️ POST', loginURL);

    try {
      const res = await fetch(loginURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env, username, password }),
      });

      const data = await res.json().catch(() => ({}));
      console.log('🔐 Login response:', res.status, data);

      if (!res.ok || !data.ok || !data.token) {
        showMessage(data.message || 'Login failed. Please try again.');
        return;
      }

      // ✅ Save token for use on /home.html
      try {
        if (typeof storageSet === 'function') {
          storageSet(remember, { env, username, token: data.token, remember });
          console.log('💾 Token saved via storageSet');
        } else {
          localStorage.setItem('eposAuth', JSON.stringify({ env, username, token: data.token, remember }));
          console.log('💾 Token saved directly to localStorage');
        }
      } catch (saveErr) {
        console.error('❌ Failed to save token:', saveErr);
      }

      showMessage('Login successful. Redirecting…', 'success');

      setTimeout(() => {
        console.log('➡️ Redirecting to home.html');
        window.location.replace(data.redirect || '/home.html');
      }, 800);

    } catch (err) {
      console.error('❌ Network error:', err);
      showMessage('Network error. Please check your connection and try again.');
    }
  });
});
