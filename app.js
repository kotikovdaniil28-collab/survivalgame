const SUPABASE_URL = 'https://gqfpiyytofsydcpipnty.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wWSjHfnSG1FJkYzdLslqNA_p6mKD8yn';
const OWNER_EMAIL = 'daniiltimosin72@gmail.com';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const app = document.getElementById('app');
const params = new URLSearchParams(location.search);

let pollTimer = null;
let currentSession = null;

const DEFAULT_QUESTIONS = [
  { question_order: 0, question_text: 'Что тяжелее: 1 кг железа или 1 кг ваты?', option_a: 'Железо', option_b: 'Вата', option_c: 'Одинаково', option_d: 'Зависит от объёма', correct_option: 'C' },
  { question_order: 1, question_text: 'У отца Марины 5 дочерей: Лала, Леле, Лили, Лоло. Как зовут пятую?', option_a: 'Лулу', option_b: 'Марина', option_c: 'Лала', option_d: 'Леля', correct_option: 'B' },
  { question_order: 2, question_text: 'Сколько месяцев в году имеют 28 дней?', option_a: '1', option_b: '2', option_c: '12', option_d: '6', correct_option: 'C' },
  { question_order: 3, question_text: 'Что можно держать после того, как отдал другому?', option_a: 'Слово', option_b: 'Телефон', option_c: 'Ключ', option_d: 'Деньги', correct_option: 'A' },
  { question_order: 4, question_text: 'Если электричка едет на север, куда идёт дым?', option_a: 'На юг', option_b: 'На север', option_c: 'Вверх', option_d: 'Никуда', correct_option: 'D' },
  { question_order: 5, question_text: 'Что становится больше, если его перевернуть вверх ногами?', option_a: '6', option_b: '9', option_c: '8', option_d: '0', correct_option: 'A' },
  { question_order: 6, question_text: 'У какого слова всегда неправильно пишется?', option_a: 'Ошибка', option_b: 'Неправильно', option_c: 'Всегда', option_d: 'Слово', correct_option: 'B' },
  { question_order: 7, question_text: 'На столе 3 яблока. Вы взяли 2. Сколько яблок у вас?', option_a: '1', option_b: '2', option_c: '3', option_d: '0', correct_option: 'B' },
  { question_order: 8, question_text: 'Какое число продолжает ряд: 2, 4, 8, 16, ...?', option_a: '18', option_b: '24', option_c: '32', option_d: '64', correct_option: 'C' },
  { question_order: 9, question_text: 'Мини-испытание: выберите вариант, где все буквы разные.', option_a: 'радар', option_b: 'тест', option_c: 'игра', option_d: 'мама', correct_option: 'C' }
];

function $(selector, root = document) { return root.querySelector(selector); }
function $all(selector, root = document) { return [...root.querySelectorAll(selector)]; }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
function toast(message) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
function code() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
function setTemplate(id) {
  stopPolling();
  app.innerHTML = '';
  app.appendChild(document.getElementById(id).content.cloneNode(true));
}
function inviteUrl(inviteCode) {
  return `${location.origin}${location.pathname}?join=${inviteCode}`;
}
async function copyText(text) {
  await navigator.clipboard.writeText(text);
  toast('Скопировано');
}

async function init() {
  const { data } = await db.auth.getSession();
  currentSession = data.session;
  db.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    if (params.get('admin') === '1') renderAdmin();
  });

  if (params.get('admin') === '1') renderAdmin();
  else if (params.get('join')) renderPlayer(params.get('join').trim().toUpperCase());
  else renderHome();
}

function renderHome() {
  setTemplate('home-template');
  $('#home-join-btn').onclick = () => {
    const value = $('#home-code').value.trim().toUpperCase();
    if (!value) return toast('Введите invite-код');
    location.href = `?join=${encodeURIComponent(value)}`;
  };
  $('#home-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#home-join-btn').click();
  });
}

function renderAdmin() {
  setTemplate('admin-template');
  renderAuthBox();
  const user = currentSession?.user;
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL;
  if (!user) {
    $('#admin-main').innerHTML = `
      <h2 class="big-status">Вход ведущего</h2>
      <p class="muted">Войдите через Supabase Magic Link. После входа создание игр будет доступно только владельцу.</p>
      <div class="empty-state">Авторизация ещё не выполнена.</div>`;
    return;
  }
  if (!isOwner) {
    $('#admin-main').innerHTML = `
      <h2 class="big-status">Доступ закрыт</h2>
      <p class="muted">Текущий аккаунт: <b>${escapeHtml(user.email)}</b></p>
      <div class="empty-state">Создавать игры может только ${OWNER_EMAIL}.</div>`;
    return;
  }
  renderGameList();
}

function renderAuthBox() {
  const box = $('#auth-box');
  const user = currentSession?.user;
  if (user) {
    box.innerHTML = `
      <div class="game-card">
        <div class="badge ${user.email.toLowerCase() === OWNER_EMAIL ? 'good' : 'bad'}">${user.email.toLowerCase() === OWNER_EMAIL ? 'OWNER' : 'НЕ ВЛАДЕЛЕЦ'}</div>
        <p class="muted">Вы вошли как<br><b>${escapeHtml(user.email)}</b></p>
        <button id="logout" class="soft-btn">Выйти</button>
      </div>`;
    $('#logout').onclick = async () => { await db.auth.signOut(); toast('Вы вышли'); };
    return;
  }
  box.innerHTML = `
    <div class="stack">
      <input id="owner-email" value="${OWNER_EMAIL}" />
      <button id="login" class="primary-btn">Получить ссылку входа</button>
      <p class="muted">Supabase отправит Magic Link на email. Откройте ссылку и вернитесь на сайт.</p>
    </div>`;
  $('#login').onclick = async () => {
    const email = $('#owner-email').value.trim().toLowerCase();
    const { error } = await db.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}${location.pathname}?admin=1` }
    });
    if (error) toast(error.message);
    else toast('Ссылка для входа отправлена на email');
  };
}

async function renderGameList() {
  const main = $('#admin-main');
  main.innerHTML = `
    <div class="row-between">
      <div>
        <h2 class="big-status">Игры</h2>
        <p class="muted">Создайте игру, получите invite-ссылку и отправьте её участникам в Discord.</p>
      </div>
      <button id="new-game" class="primary-btn">Создать игру</button>
    </div>
    <div class="hr"></div>
    <div id="games-list" class="card-grid"></div>`;
  $('#new-game').onclick = renderCreateGame;

  const { data, error } = await db.from('games').select('*').order('created_at', { ascending: false });
  if (error) return main.insertAdjacentHTML('beforeend', `<div class="empty-state">${escapeHtml(error.message)}</div>`);
  const list = $('#games-list');
  if (!data?.length) {
    list.innerHTML = `<div class="empty-state">Пока нет созданных игр.</div>`;
    return;
  }
  list.innerHTML = data.map(g => `
    <article class="game-card">
      <div class="row-between">
        <h3>${escapeHtml(g.title)}</h3>
        ${statusBadge(g.status)}
      </div>
      <p class="muted">Код: <span class="code">${escapeHtml(g.invite_code)}</span></p>
      <button class="soft-btn manage" data-id="${g.id}">Открыть</button>
    </article>`).join('');
  $all('.manage').forEach(btn => btn.onclick = () => renderManageGame(btn.dataset.id));
}

function renderCreateGame() {
  const main = $('#admin-main');
  main.innerHTML = `
    <div class="row-between">
      <h2 class="big-status">Новая игра</h2>
      <button id="back" class="soft-btn">Назад</button>
    </div>
    <div class="stack">
      <label>Название игры<input id="game-title" value="Игра на выживание | BLACK RUSSIA" /></label>
      <label>Жизни игрока<input id="lives" type="number" min="1" max="10" value="3" /></label>
      <label>Вопросы JSON</label>
      <textarea id="questions-json"></textarea>
      <button id="create" class="primary-btn">Создать invite-ссылку</button>
    </div>`;
  $('#questions-json').value = JSON.stringify(DEFAULT_QUESTIONS, null, 2);
  $('#back').onclick = renderGameList;
  $('#create').onclick = createGame;
}

async function createGame() {
  const title = $('#game-title').value.trim() || 'Игра на выживание';
  const lives = Number($('#lives').value || 3);
  let questions;
  try { questions = JSON.parse($('#questions-json').value); }
  catch { return toast('Вопросы должны быть в формате JSON'); }
  if (!Array.isArray(questions) || !questions.length) return toast('Добавьте хотя бы один вопрос');

  const user = currentSession?.user;
  const invite_code = code();
  const { data: game, error: gameError } = await db.from('games').insert({
    title,
    invite_code,
    lives_per_player: lives,
    owner_id: user.id,
    owner_email: user.email
  }).select('*').single();
  if (gameError) return toast(gameError.message);

  const rows = questions.map((q, index) => ({
    game_id: game.id,
    question_order: Number.isInteger(q.question_order) ? q.question_order : index,
    question_text: q.question_text,
    option_a: q.option_a,
    option_b: q.option_b,
    option_c: q.option_c,
    option_d: q.option_d,
    correct_option: String(q.correct_option || '').toUpperCase(),
    type: q.type || 'quiz',
    time_limit_seconds: q.time_limit_seconds || 25
  }));
  const { error: qError } = await db.from('questions').insert(rows);
  if (qError) return toast(qError.message);
  toast('Игра создана');
  renderManageGame(game.id);
}

async function renderManageGame(gameId) {
  stopPolling();
  const main = $('#admin-main');
  main.innerHTML = `<div class="empty-state">Загрузка игры...</div>`;
  async function load() {
    const [{ data: game, error: gErr }, { data: players }, { data: questions }, { data: answers }] = await Promise.all([
      db.from('games').select('*').eq('id', gameId).single(),
      db.from('players').select('*').eq('game_id', gameId).order('score', { ascending: false }).order('joined_at'),
      db.from('questions').select('*').eq('game_id', gameId).order('question_order'),
      db.from('answers').select('*').eq('game_id', gameId)
    ]);
    if (gErr) { main.innerHTML = `<div class="empty-state">${escapeHtml(gErr.message)}</div>`; return; }
    const current = questions?.find(q => q.question_order === game.current_question_index);
    const alive = players?.filter(p => !p.eliminated).length || 0;
    main.innerHTML = `
      <div class="row-between">
        <div>
          <h2 class="big-status">${escapeHtml(game.title)}</h2>
          <div class="row">${statusBadge(game.status)} <span class="pill">Код: <span class="code">${escapeHtml(game.invite_code)}</span></span></div>
        </div>
        <button id="back" class="soft-btn">К списку</button>
      </div>
      <div class="copy-box">
        <input readonly value="${inviteUrl(game.invite_code)}" />
        <button id="copy" class="primary-btn">Скопировать</button>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><b>${players?.length || 0}</b><span>участников</span></div>
        <div class="kpi"><b>${alive}</b><span>в игре</span></div>
        <div class="kpi"><b>${questions?.length || 0}</b><span>вопросов</span></div>
        <div class="kpi"><b>${game.current_question_index + 1 > 0 ? game.current_question_index + 1 : 0}</b><span>текущий раунд</span></div>
      </div>
      <div class="row">
        <button id="start" class="primary-btn" ${game.status !== 'waiting' ? 'disabled' : ''}>Старт</button>
        <button id="next" class="soft-btn" ${game.status !== 'running' ? 'disabled' : ''}>Следующий вопрос</button>
        <button id="finish" class="danger-btn" ${game.status === 'finished' ? 'disabled' : ''}>Завершить</button>
        <button id="reset" class="danger-btn">Сбросить игру</button>
      </div>
      <div class="hr"></div>
      <div class="card-grid">
        <section class="question-card">
          <h3>Текущий вопрос</h3>
          ${current ? renderQuestionAdmin(current, answers || []) : '<p class="muted">Игра ещё не запущена.</p>'}
        </section>
        <section class="question-card">
          <h3>Участники</h3>
          <div>${renderPlayers(players || [])}</div>
        </section>
      </div>`;
    $('#back').onclick = () => { stopPolling(); renderGameList(); };
    $('#copy').onclick = () => copyText(inviteUrl(game.invite_code));
    $('#start').onclick = () => updateGame(gameId, { status: 'running', current_question_index: 0 });
    $('#next').onclick = () => {
      const nextIndex = game.current_question_index + 1;
      if (nextIndex >= (questions?.length || 0)) updateGame(gameId, { status: 'finished' });
      else updateGame(gameId, { current_question_index: nextIndex });
    };
    $('#finish').onclick = () => updateGame(gameId, { status: 'finished' });
    $('#reset').onclick = async () => {
      if (!confirm('Сбросить ответы, участников и вернуть игру в ожидание?')) return;
      await db.from('answers').delete().eq('game_id', gameId);
      await db.from('players').delete().eq('game_id', gameId);
      await updateGame(gameId, { status: 'waiting', current_question_index: -1 });
    };
  }
  async function updateGame(id, patch) {
    const { error } = await db.from('games').update(patch).eq('id', id);
    if (error) toast(error.message);
    else load();
  }
  await load();
  pollTimer = setInterval(load, 2500);
}

function renderQuestionAdmin(q, answers) {
  const qAnswers = answers.filter(a => a.question_id === q.id);
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  qAnswers.forEach(a => { counts[String(a.answer).toUpperCase()] = (counts[String(a.answer).toUpperCase()] || 0) + 1; });
  return `
    <p><b>${escapeHtml(q.question_text)}</b></p>
    <p class="muted">Правильный ответ: <b>${escapeHtml(q.correct_option)}</b></p>
    <div class="answer-bar">
      <div>A: ${counts.A}</div><div>B: ${counts.B}</div><div>C: ${counts.C}</div><div>D: ${counts.D}</div>
    </div>
    <p class="muted">Ответили: ${qAnswers.length}</p>`;
}

function renderPlayers(players) {
  if (!players.length) return '<div class="empty-state">Участники ещё не подключились.</div>';
  return players.map((p, i) => `
    <div class="leader-item">
      <div>
        <div class="name">${i + 1}. ${escapeHtml(p.name)}</div>
        <div class="meta">Очки: ${p.score} • Жизни: ${p.lives}</div>
      </div>
      ${p.eliminated ? '<span class="badge bad">Выбыл</span>' : '<span class="badge good">В игре</span>'}
    </div>`).join('');
}

function statusBadge(status) {
  const map = { waiting: ['warn', 'Ожидание'], running: ['good', 'Идёт игра'], finished: ['bad', 'Финиш'] };
  const [cls, text] = map[status] || ['warn', status];
  return `<span class="badge ${cls}">${text}</span>`;
}

async function renderPlayer(inviteCode) {
  setTemplate('player-template');
  const savedId = localStorage.getItem(`br_player_${inviteCode}`);
  await loadPlayerScreen(inviteCode, savedId);
  pollTimer = setInterval(() => loadPlayerScreen(inviteCode, localStorage.getItem(`br_player_${inviteCode}`)), 2200);
}

async function loadPlayerScreen(inviteCode, playerId) {
  const { data: games, error } = await db.rpc('get_game_by_code', { p_invite_code: inviteCode });
  const game = Array.isArray(games) ? games[0] : games;
  if (error || !game) {
    $('#player-header').innerHTML = `<h2 class="big-status">Игра не найдена</h2><p class="muted">Проверьте invite-ссылку.</p>`;
    $('#player-stage').innerHTML = '';
    $('#player-leaderboard').innerHTML = '';
    return;
  }
  let player = null;
  if (playerId) {
    const { data } = await db.from('players').select('*').eq('id', playerId).eq('game_id', game.id).maybeSingle();
    player = data;
  }
  const { data: players } = await db.from('players').select('*').eq('game_id', game.id).order('score', { ascending: false }).order('joined_at');
  $('#player-header').innerHTML = `
    <div class="row-between">
      <div>
        <div class="eyebrow">BLACK RUSSIA EVENT</div>
        <h2 class="big-status">${escapeHtml(game.title)}</h2>
        <div class="row">${statusBadge(game.status)} <span class="pill">Код: ${escapeHtml(game.invite_code)}</span></div>
      </div>
      ${player ? `<div class="game-card"><b>${escapeHtml(player.name)}</b><div class="meta">Жизни: ${player.lives} • Очки: ${player.score}</div></div>` : ''}
    </div>`;
  $('#player-leaderboard').innerHTML = `<h3>Участники</h3>${renderPlayers(players || [])}`;

  if (!player) return renderJoin(game, inviteCode);
  if (player.eliminated) return renderEliminated(player);
  if (game.status === 'waiting') return renderWaiting(player);
  if (game.status === 'finished') return renderFinished(players || [], player);
  return renderCurrentQuestion(game, player);
}

function renderJoin(game, inviteCode) {
  $('#player-stage').innerHTML = `
    <h2 class="big-status">Вход в игру</h2>
    <p class="muted">Введите ник, чтобы попасть в лобби. Регистрация не нужна.</p>
    <div class="join-box">
      <input id="player-name" maxlength="32" placeholder="Ваш ник" />
      <button id="join" class="primary-btn">Присоединиться</button>
    </div>`;
  $('#join').onclick = async () => {
    const name = $('#player-name').value.trim();
    if (name.length < 2) return toast('Введите ник минимум из 2 символов');
    const { data, error } = await db.rpc('join_game', { p_invite_code: inviteCode, p_name: name });
    if (error) return toast(error.message);
    const player = Array.isArray(data) ? data[0] : data;
    localStorage.setItem(`br_player_${inviteCode}`, player.id);
    toast('Вы в игре');
    loadPlayerScreen(inviteCode, player.id);
  };
}
function renderWaiting(player) {
  $('#player-stage').innerHTML = `
    <h2 class="big-status">Ожидание старта</h2>
    <p class="muted">Вы в лобби. Ведущий скоро запустит игру в трибуне Discord.</p>
    <div class="game-card"><b>${escapeHtml(player.name)}</b><div class="meta">Жизни: ${player.lives} • Очки: ${player.score}</div></div>`;
}
function renderEliminated(player) {
  $('#player-stage').innerHTML = `
    <h2 class="big-status">Вы выбыли</h2>
    <p class="muted">У вас закончились жизни. Можно следить за игрой в Discord.</p>
    <div class="game-card"><b>${escapeHtml(player.name)}</b><div class="meta">Финальный счёт: ${player.score}</div></div>`;
}
function renderFinished(players, player) {
  const alive = players.filter(p => !p.eliminated).sort((a, b) => b.score - a.score)[0];
  const winner = alive || players.sort((a, b) => b.score - a.score)[0];
  $('#player-stage').innerHTML = `
    <h2 class="big-status">Игра завершена</h2>
    <p class="muted">Победитель: <b>${escapeHtml(winner?.name || 'не определён')}</b></p>
    <div class="game-card"><b>Ваш результат</b><div class="meta">Очки: ${player.score} • Жизни: ${player.lives}</div></div>`;
}

async function renderCurrentQuestion(game, player) {
  const { data: questions, error } = await db.from('player_questions').select('*').eq('game_id', game.id).eq('question_order', game.current_question_index).limit(1);
  const q = questions?.[0];
  if (error || !q) {
    $('#player-stage').innerHTML = `<h2 class="big-status">Раунд готовится</h2><p class="muted">Ждите вопрос от ведущего.</p>`;
    return;
  }
  const { data: existing } = await db.from('answers').select('id').eq('player_id', player.id).eq('question_id', q.id).maybeSingle();
  if (existing) {
    $('#player-stage').innerHTML = `<h2 class="big-status">Ответ принят</h2><p class="muted">Ждите следующий вопрос. Ведущий переключит раунд.</p>`;
    return;
  }
  $('#player-stage').innerHTML = `
    <div class="row-between">
      <span class="badge warn">Раунд ${game.current_question_index + 1}</span>
      <span class="pill">${q.time_limit_seconds || 25} сек.</span>
    </div>
    <h2 class="question-title">${escapeHtml(q.question_text)}</h2>
    <div class="options">
      ${['A','B','C','D'].map(k => `<button class="option-btn" data-answer="${k}"><span class="option-key">${k}</span>${escapeHtml(q[`option_${k.toLowerCase()}`])}</button>`).join('')}
    </div>`;
  $all('.option-btn').forEach(btn => btn.onclick = () => submitAnswer(player.id, q.id, btn.dataset.answer, game.invite_code));
}
async function submitAnswer(playerId, questionId, answer, inviteCode) {
  $all('.option-btn').forEach(b => b.disabled = true);
  const { data, error } = await db.rpc('submit_answer', { p_player_id: playerId, p_question_id: questionId, p_answer: answer });
  if (error) {
    toast(error.message);
    $all('.option-btn').forEach(b => b.disabled = false);
    return;
  }
  const result = Array.isArray(data) ? data[0] : data;
  toast(result.correct ? 'Верно! +1 очко' : 'Неверно. Минус жизнь');
  await loadPlayerScreen(inviteCode, playerId);
}

init();
