/* Passwords live only in this page's closure, never in browser storage or URLs. */
(function (root) {
  function createSession() {
    let password = '';
    let active = false;
    let pending = false;
    let retryAt = 0;
    return {
      update(value) { active = value === true; if (!active) retryAt = 0; },
      canSubmit(now) { return active && !pending && now >= retryAt; },
      canReplace(now) { return active && !pending && retryAt > 0 && now >= retryAt; },
      hasPassword() { return password.length > 0; },
      submit(value, now, send) {
        if (!this.canSubmit(now)) return false;
        const candidate = value === undefined ? password : value;
        if (!/^[\x20-\x7e]{1,1024}$/.test(candidate)) return false;
        if (!send({ type: 'authorize', password: candidate })) return false;
        password = candidate;
        pending = true;
        return true;
      },
      result(status, now) { pending = false; retryAt = now + (status === 'submitted' ? 2000 : 0); },
      forget() { password = ''; },
      reset() { password = ''; active = false; pending = false; retryAt = 0; },
    };
  }

  function mount({ document, send, fetchState }) {
    const get = (id) => document.getElementById(id);
    const session = createSession();
    const panel = get('authorization');
    const button = get('authorize');
    const replace = get('replaceAuthorization');
    const forget = get('forgetAuthorization');
    const notice = get('authorizationNotice');
    const dialog = get('authorizationDialog');
    const input = get('authorizationPassword');
    const error = get('authorizationError');
    const visibility = get('authorizationVisibility');
    let connected = false;
    let generation = 0;
    let pollTimer;
    let responseTimer;
    let cooldownTimer;

    function render() {
      button.disabled = !connected || !session.canSubmit(Date.now());
      get('submitAuthorization').disabled = button.disabled;
      replace.hidden = !session.canReplace(Date.now());
      forget.hidden = !session.hasPassword();
    }
    function clearDialog() {
      input.value = '';
      input.type = 'password';
      error.textContent = '';
      visibility.textContent = '显示密码';
      visibility.setAttribute('aria-pressed', 'false');
    }
    function openDialog() { clearDialog(); dialog.showModal(); input.focus(); }
    function closeDialog() { dialog.close(); clearDialog(); }
    async function poll(epoch) {
      try {
        const state = await fetchState();
        if (!connected || epoch !== generation) return;
        panel.hidden = state.authorization?.supported !== true;
        session.update(state.authorization?.requestActive);
        if (!state.authorization?.requestActive) {
          notice.textContent = '无当前请求';
          if (dialog.open) closeDialog();
        } else if (notice.textContent === '无当前请求') {
          notice.textContent = '有待处理请求';
        }
      } catch {
        if (!connected || epoch !== generation) return;
        session.update(false);
        notice.textContent = '无法检查当前授权请求';
      }
      if (connected && epoch === generation) {
        render();
        pollTimer = setTimeout(() => void poll(epoch), 1000);
      }
    }
    function submit(value) {
      if (!session.submit(value, Date.now(), send)) {
        error.textContent = '请输入有效 ASCII 密码，并确认连接和授权请求仍有效。';
        return;
      }
      closeDialog();
      notice.textContent = '正在提交…';
      render();
      // A missing reply never triggers an automatic password resend.
      responseTimer = setTimeout(() => {
        session.result('timeout', Date.now());
        notice.textContent = '未收到提交结果，请检查桌面后重试。';
        render();
      }, 5000);
    }
    button.addEventListener('click', () => session.hasPassword() ? submit() : openDialog());
    replace.addEventListener('click', openDialog);
    forget.addEventListener('click', () => { session.forget(); render(); });
    get('authorizationForm').addEventListener('submit', (event) => { event.preventDefault(); submit(input.value); });
    get('cancelAuthorization').addEventListener('click', closeDialog);
    dialog.addEventListener('close', clearDialog);
    visibility.addEventListener('click', () => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      visibility.textContent = visible ? '隐藏密码' : '显示密码';
      visibility.setAttribute('aria-pressed', String(visible));
    });
    return {
      connected() { connected = true; void poll(++generation); },
      disconnected() {
        connected = false;
        generation++;
        clearTimeout(pollTimer);
        clearTimeout(responseTimer);
        clearTimeout(cooldownTimer);
        session.reset();
        closeDialog();
        notice.textContent = '无当前请求';
        render();
      },
      receive(message) {
        if (message.type !== 'authorizationResult') return;
        clearTimeout(responseTimer);
        session.result(message.status, Date.now());
        notice.textContent = message.status === 'submitted'
          ? '已提交；若窗口仍在，2 秒后可重新输入密码。'
          : '输入未提交，请检查桌面的授权请求后重试。';
        render();
        clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(render, 2000);
      },
    };
  }
  if (typeof module !== 'undefined') module.exports = { createSession, mount };
  else root.TapPadAuthorization = { createSession, mount };
})(globalThis);
