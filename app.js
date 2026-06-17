const SUPABASE_URL = 'https://gqfpiyytofsydcpipnty.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wWSjHfnSG1FJkYzdLslqNA_p6mKD8yn';
const HOST_CODE_STORAGE_KEY = 'br_survival_host_code';
const PLAYER_STORAGE_PREFIX = 'br_survival_player_';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const app = document.getElementById('app');
const params = new URLSearchParams(location.search);

let pollTimer = null;
let countdownTimer = null;
let hostGameId = null;
let currentGameCode = null;
let currentPlayerId = null;
let lastPublicState = null;

let lastAudioSignature = '';

const audio = (() => {
  let ctx = null;
  let muted = localStorage.getItem('br_survival_muted') === '1';
  let unlocked = false;
  let bgAudio = null;
  let heartbeatTimer = null;
  let lastTickSecond = null;

  const files = {
    ambient: 'assets/sfx/ambient-drone.wav',
    start: 'assets/sfx/start.wav',
    round: 'assets/sfx/round.wav',
    correct: 'assets/sfx/correct.wav',
    wrong: 'assets/sfx/wrong.wav',
    death: 'assets/sfx/death.wav',
    victory: 'assets/sfx/victory.wav',
    tick: 'assets/sfx/tick.wav',
    timeout: 'assets/sfx/timeout.wav',
    boom: 'assets/sfx/boom.wav'
  };

  const clips = {};
  function preload() {
    Object.entries(files).forEach(([name, src]) => {
      if (clips[name]) return;
      const a = new Audio(src);
      a.preload = 'auto';
      a.volume = name === 'ambient' ? 0.22 : 0.72;
      if (name === 'ambient') a.loop = true;
      clips[name] = a;
    });
    bgAudio = clips.ambient || null;
  }

  function init() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && !ctx) ctx = new AudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    preload();
    unlocked = true;
    return ctx;
  }

  function playFile(name, volume = null) {
    if (muted) return;
    preload();
    const src = clips[name];
    if (!src) return;
    try {
      const a = src.cloneNode(true);
      a.volume = volume ?? src.volume ?? 0.7;
      a.play().catch(() => {});
    } catch {}
  }

  function gain(value, time = 0.2) {
    const c = init();
    if (!c || muted) return null;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, value), c.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + time);
    g.connect(c.destination);
    return g;
  }
  function tone(freq = 440, duration = .2, type = 'sine', volume = .16, slideTo = null, delay = 0) {
    const c = init();
    if (!c || muted) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    const start = c.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + duration);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(start);
    osc.stop(start + duration + .04);
  }
  function noise(duration = .18, volume = .08, delay = 0, filterFreq = 1200) {
    const c = init();
    if (!c || muted) return;
    const buffer = c.createBuffer(1, Math.floor(c.sampleRate * duration), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const fade = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * fade;
    }
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const g = c.createGain();
    const start = c.currentTime + delay;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.buffer = buffer;
    src.connect(filter);
    filter.connect(g);
    g.connect(c.destination);
    src.start(start);
  }
  function scaryHit() {
    playFile('boom', .65);
    tone(46, .55, 'sawtooth', .11, 24);
    tone(92, .38, 'square', .06, 36, .02);
    noise(.26, .06, .03, 650);
  }
  function heartbeatOnce() {
    if (muted || !unlocked) return;
    tone(48, .10, 'sine', .055, 38);
    tone(42, .12, 'sine', .045, 32, .18);
  }
  function background() {
    if (muted) return;
    init();
    if (bgAudio && bgAudio.paused) {
      try { bgAudio.currentTime = bgAudio.currentTime || 0; bgAudio.volume = 0.18; bgAudio.play().catch(() => {}); } catch {}
    }
    if (!heartbeatTimer) heartbeatTimer = setInterval(heartbeatOnce, 1450);
  }
  function stopBackground() {
    if (bgAudio) { try { bgAudio.pause(); } catch {} }
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  function resetTick() { lastTickSecond = null; }
  return {
    isMuted: () => muted,
    isUnlocked: () => unlocked,
    init,
    enable() { muted = false; localStorage.setItem('br_survival_muted', '0'); init(); this.start(); background(); return muted; },
    toggle() {
      init();
      muted = !muted;
      localStorage.setItem('br_survival_muted', muted ? '1' : '0');
      if (muted) stopBackground(); else { this.click(); background(); }
      return muted;
    },
    click() { playFile('tick', .35); tone(220, .055, 'square', .035, 330); },
    start() { playFile('start', .78); tone(44, .6, 'sawtooth', .10, 88); tone(180, .18, 'sawtooth', .07, 420, .16); noise(.22, .05, .05, 900); },
    round() { playFile('round', .78); scaryHit(); tone(660, .11, 'triangle', .05, 440, .28); },
    correct() { playFile('correct', .65); tone(440, .10, 'sine', .08, 880); tone(660, .12, 'triangle', .07, 990, .1); },
    wrong() { playFile('wrong', .78); tone(155, .36, 'sawtooth', .12, 45); noise(.26, .07, .04, 520); },
    death() { playFile('death', .88); stopBackground(); tone(92, 1.4, 'square', .16, 22); tone(46, 1.2, 'sawtooth', .12, 20, .08); noise(.75, .08, .1, 420); },
    timeout() { playFile('timeout', .72); tone(260, .10, 'square', .08, 120); tone(180, .12, 'square', .07, 90, .13); },
    victory() { playFile('victory', .80); stopBackground(); [392, 523, 659, 784].forEach((f, i) => tone(f, .18, 'triangle', .08, null, i * .12)); },
    tick(second) { if (muted || second === lastTickSecond) return; lastTickSecond = second; if (second <= 5 && second > 0) { playFile('tick', .42); tone(900, .035, 'square', .045, 430); } },
    boom: scaryHit,
    background,
    stopBackground,
    resetTick
  };
})();

function setupSoundToggle() {
  const btn = document.getElementById('sound-toggle');
  if (!btn) return;
  const sync = () => {
    btn.textContent = audio.isMuted() ? '🔇' : '🔊';
    btn.setAttribute('aria-label', audio.isMuted() ? 'Звук выключен' : 'Звук включён');
    btn.title = audio.isMuted() ? 'Включить звук' : 'Выключить звук';
  };
  btn.onclick = () => { audio.toggle(); sync(); };
  sync();
}

const ROUND_TYPE_LABELS = {
  quiz: 'Вопрос',
  fast: 'Быстрый раунд',
  double: 'x2 очков',
  immunity: 'Иммунитет',
  trap: 'Раунд-ловушка',
  sudden: 'Внезапная смерть',
  reflex: 'Мини-игра: реакция',
  memory: 'Память'
};

const DEFAULT_ROUNDS = [
  {
    "round_order": 0,
    "type": "quiz",
    "title": "Теорема на 300 лет",
    "question_text": "Какая математическая теорема оставалась недоказанной более 300 лет, пока в 1994 году её не доказал Эндрю Уайлс?",
    "option_a": "Великая теорема Ферма",
    "option_b": "Теорема Пифагора",
    "option_c": "Гипотеза Пуанкаре",
    "option_d": "Теорема Эйлера",
    "correct_option": "A",
    "time_limit_seconds": 22,
    "score_value": 2,
    "penalty_lives": 1
  },
  {
    "round_order": 1,
    "type": "quiz",
    "title": "Эффект Манделы",
    "question_text": "«Эффект Манделы» — это психологический феномен, который заключается в...",
    "option_a": "Боязни замкнутых пространств",
    "option_b": "Возникновении ложных коллективных воспоминаний",
    "option_c": "Способности запоминать лица с первого взгляда",
    "option_d": "Ощущении дежавю",
    "correct_option": "B",
    "time_limit_seconds": 18,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 2,
    "type": "trap",
    "title": "Северный полюс",
    "question_text": "Вы находитесь точно на Северном полюсе. Проходите 1 км на юг, 1 км на восток, затем 1 км на север. Где окажетесь?",
    "option_a": "В 1 км к востоку от Северного полюса",
    "option_b": "Точно на месте старта",
    "option_c": "Заблудитесь",
    "option_d": "В 1 км к югу от старта",
    "correct_option": "B",
    "time_limit_seconds": 20,
    "score_value": 2,
    "penalty_lives": 2
  },
  {
    "round_order": 3,
    "type": "quiz",
    "title": "Василиск",
    "question_text": "Какой мифический монстр убивает взглядом, но сам погибает, услышав пение петуха?",
    "option_a": "Мантикора",
    "option_b": "Горгона Медуза",
    "option_c": "Василиск",
    "option_d": "Химера",
    "correct_option": "C",
    "time_limit_seconds": 16,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 4,
    "type": "trap",
    "title": "Кошки и мыши",
    "question_text": "В тёмной комнате 5 кошек ловят 5 мышей за 5 минут. Сколько минут понадобится 100 кошкам, чтобы поймать 100 мышей?",
    "option_a": "1 минута",
    "option_b": "5 минут",
    "option_c": "100 минут",
    "option_d": "500 минут",
    "correct_option": "B",
    "time_limit_seconds": 14,
    "score_value": 2,
    "penalty_lives": 2
  },
  {
    "round_order": 5,
    "type": "fast",
    "title": "Простые числа",
    "question_text": "Какое число лишнее в ряду: 2, 3, 5, 9, 11?",
    "option_a": "2",
    "option_b": "5",
    "option_c": "9",
    "option_d": "11",
    "correct_option": "C",
    "time_limit_seconds": 9,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 6,
    "type": "double",
    "title": "Фибоначчи",
    "question_text": "Продолжите ряд: 1, 1, 2, 3, 5, 8, ...",
    "option_a": "10",
    "option_b": "11",
    "option_c": "13",
    "option_d": "16",
    "correct_option": "C",
    "time_limit_seconds": 13,
    "score_value": 2,
    "penalty_lives": 1
  },
  {
    "round_order": 7,
    "type": "trap",
    "title": "Обгон",
    "question_text": "Ты обогнал игрока, который был на втором месте. Какое место теперь у тебя?",
    "option_a": "Первое",
    "option_b": "Второе",
    "option_c": "Третье",
    "option_d": "Последнее",
    "correct_option": "B",
    "time_limit_seconds": 10,
    "score_value": 1,
    "penalty_lives": 2
  },
  {
    "round_order": 8,
    "type": "quiz",
    "title": "Монеты",
    "question_text": "Есть 9 одинаковых монет, одна из них легче. За сколько взвешиваний на чашечных весах можно гарантированно найти лёгкую?",
    "option_a": "1",
    "option_b": "2",
    "option_c": "3",
    "option_d": "4",
    "correct_option": "B",
    "time_limit_seconds": 20,
    "score_value": 2,
    "penalty_lives": 1
  },
  {
    "round_order": 9,
    "type": "immunity",
    "title": "Три коробки",
    "question_text": "Три коробки подписаны неправильно: «яблоки», «апельсины», «смесь». Из какой коробки взять один фрукт, чтобы всё определить?",
    "option_a": "Из «яблоки»",
    "option_b": "Из «апельсины»",
    "option_c": "Из «смесь»",
    "option_d": "Из любой",
    "correct_option": "C",
    "time_limit_seconds": 22,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 10,
    "type": "trap",
    "title": "Свечи",
    "question_text": "На столе горело 5 свечей. 2 свечи потухли. Сколько свечей останется в итоге?",
    "option_a": "0",
    "option_b": "2",
    "option_c": "3",
    "option_d": "5",
    "correct_option": "B",
    "time_limit_seconds": 11,
    "score_value": 1,
    "penalty_lives": 2
  },
  {
    "round_order": 11,
    "type": "double",
    "title": "Кодовый замок",
    "question_text": "Первая цифра больше второй на 2. Третья равна сумме первых двух. Сумма всех трёх цифр равна 12. Какая третья цифра?",
    "option_a": "4",
    "option_b": "5",
    "option_c": "6",
    "option_d": "8",
    "correct_option": "C",
    "time_limit_seconds": 22,
    "score_value": 2,
    "penalty_lives": 1
  },
  {
    "round_order": 12,
    "type": "fast",
    "title": "Проценты",
    "question_text": "Сколько будет 15% от 200?",
    "option_a": "15",
    "option_b": "20",
    "option_c": "30",
    "option_d": "35",
    "correct_option": "C",
    "time_limit_seconds": 8,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 13,
    "type": "quiz",
    "title": "Логический вывод",
    "question_text": "Все дрифтеры любят скорость. Никита — дрифтер. Что точно верно?",
    "option_a": "Никита любит скорость",
    "option_b": "Никита любит вопросы",
    "option_c": "Все быстрые — дрифтеры",
    "option_d": "Никита победит",
    "correct_option": "A",
    "time_limit_seconds": 14,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 14,
    "type": "double",
    "title": "Нечётная сумма",
    "question_text": "Чему равна сумма нечётных чисел от 1 до 19 включительно?",
    "option_a": "81",
    "option_b": "90",
    "option_c": "100",
    "option_d": "121",
    "correct_option": "C",
    "time_limit_seconds": 16,
    "score_value": 2,
    "penalty_lives": 1
  },
  {
    "round_order": 15,
    "type": "quiz",
    "title": "Квадрат",
    "question_text": "Периметр квадрата равен 36. Чему равна его площадь?",
    "option_a": "36",
    "option_b": "64",
    "option_c": "81",
    "option_d": "144",
    "correct_option": "C",
    "time_limit_seconds": 14,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 16,
    "type": "fast",
    "title": "Кубик",
    "question_text": "Какова вероятность выбросить чётное число на обычном шестигранном кубике?",
    "option_a": "1/6",
    "option_b": "1/3",
    "option_c": "1/2",
    "option_d": "2/3",
    "correct_option": "C",
    "time_limit_seconds": 8,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 17,
    "type": "memory",
    "title": "Память: BR-код",
    "question_text": "Запомни код: R-8-1-6-3. Какая сумма всех цифр в коде?",
    "option_a": "16",
    "option_b": "18",
    "option_c": "19",
    "option_d": "21",
    "correct_option": "B",
    "time_limit_seconds": 15,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 18,
    "type": "trap",
    "title": "Отцы и сыновья",
    "question_text": "Два отца и два сына съели 3 бургера, каждый по одному. Как такое возможно?",
    "option_a": "Один не ел",
    "option_b": "Их было трое: дед, отец и сын",
    "option_c": "Бургер поделили",
    "option_d": "Это невозможно",
    "correct_option": "B",
    "time_limit_seconds": 15,
    "score_value": 1,
    "penalty_lives": 2
  },
  {
    "round_order": 19,
    "type": "double",
    "title": "Машины и детали",
    "question_text": "5 машин делают 5 деталей за 5 минут. За сколько минут 100 таких машин сделают 100 деталей?",
    "option_a": "5",
    "option_b": "20",
    "option_c": "50",
    "option_d": "100",
    "correct_option": "A",
    "time_limit_seconds": 16,
    "score_value": 2,
    "penalty_lives": 1
  },
  {
    "round_order": 20,
    "type": "quiz",
    "title": "Угол часов",
    "question_text": "Какой меньший угол между стрелками часов в 3:15?",
    "option_a": "0°",
    "option_b": "7,5°",
    "option_c": "15°",
    "option_d": "30°",
    "correct_option": "B",
    "time_limit_seconds": 20,
    "score_value": 2,
    "penalty_lives": 1
  },
  {
    "round_order": 21,
    "type": "trap",
    "title": "Все месяцы",
    "question_text": "Сколько месяцев в году имеют 28 дней?",
    "option_a": "1",
    "option_b": "2",
    "option_c": "6",
    "option_d": "12",
    "correct_option": "D",
    "time_limit_seconds": 8,
    "score_value": 1,
    "penalty_lives": 2
  },
  {
    "round_order": 22,
    "type": "quiz",
    "title": "Рукопожатия",
    "question_text": "В комнате 6 человек. Каждый пожал руку каждому ровно один раз. Сколько всего рукопожатий?",
    "option_a": "12",
    "option_b": "15",
    "option_c": "18",
    "option_d": "30",
    "correct_option": "B",
    "time_limit_seconds": 16,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 23,
    "type": "double",
    "title": "Монти Холл",
    "question_text": "В задаче с 3 дверями ведущий открыл пустую дверь. Если игрок меняет выбор, какова вероятность выиграть?",
    "option_a": "1/3",
    "option_b": "1/2",
    "option_c": "2/3",
    "option_d": "3/4",
    "correct_option": "C",
    "time_limit_seconds": 20,
    "score_value": 2,
    "penalty_lives": 1
  },
  {
    "round_order": 24,
    "type": "fast",
    "title": "Два кубика",
    "question_text": "Какова вероятность получить сумму 7 при броске двух обычных кубиков?",
    "option_a": "1/12",
    "option_b": "1/9",
    "option_c": "1/6",
    "option_d": "1/4",
    "correct_option": "C",
    "time_limit_seconds": 9,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 25,
    "type": "trap",
    "title": "Кошки в углах",
    "question_text": "В квадратной комнате 4 угла. В каждом углу сидит кошка, напротив каждой кошки сидят 3 кошки. Сколько кошек в комнате?",
    "option_a": "4",
    "option_b": "8",
    "option_c": "12",
    "option_d": "16",
    "correct_option": "A",
    "time_limit_seconds": 12,
    "score_value": 1,
    "penalty_lives": 2
  },
  {
    "round_order": 26,
    "type": "quiz",
    "title": "Двоичная система",
    "question_text": "Чему равно двоичное число 1011 в десятичной системе?",
    "option_a": "9",
    "option_b": "10",
    "option_c": "11",
    "option_d": "12",
    "correct_option": "C",
    "time_limit_seconds": 14,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 27,
    "type": "immunity",
    "title": "Выключатели",
    "question_text": "Есть 3 выключателя и лампа в другой комнате. Как гарантированно определить нужный выключатель за один заход к лампе?",
    "option_a": "Включить все три",
    "option_b": "Включить первый, подождать, выключить его, включить второй и зайти",
    "option_c": "Включить только третий",
    "option_d": "Никак нельзя",
    "correct_option": "B",
    "time_limit_seconds": 24,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 28,
    "type": "reflex",
    "title": "Мини-игра: реакция",
    "question_text": "Нажми красную цель до конца таймера. Кто промедлит — теряет жизнь.",
    "option_a": "Успел нажать",
    "option_b": "Не успел",
    "option_c": "Пропуск",
    "option_d": "Ошибка",
    "correct_option": "A",
    "time_limit_seconds": 7,
    "score_value": 1,
    "penalty_lives": 1
  },
  {
    "round_order": 29,
    "type": "sudden",
    "title": "Внезапная смерть",
    "question_text": "Финал: если A больше B, а B больше C, какой вывод точно верен?",
    "option_a": "A меньше C",
    "option_b": "A равно C",
    "option_c": "A больше C",
    "option_d": "C больше B",
    "correct_option": "C",
    "time_limit_seconds": 9,
    "score_value": 3,
    "penalty_lives": 99
  }
];

function $(selector, root = document) { return root.querySelector(selector); }
function $all(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function normalizeCode(code) { return String(code || '').trim().toUpperCase(); }
function randomCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function getHostCode() { return localStorage.getItem(HOST_CODE_STORAGE_KEY) || ''; }
function setHostCode(code) { localStorage.setItem(HOST_CODE_STORAGE_KEY, code); }
function clearHostCode() { localStorage.removeItem(HOST_CODE_STORAGE_KEY); }
function playerKey(code) { return `${PLAYER_STORAGE_PREFIX}${normalizeCode(code)}`; }
function getStoredPlayerId(code) { return localStorage.getItem(playerKey(code)); }
function setStoredPlayerId(code, id) { localStorage.setItem(playerKey(code), id); }
function clearStoredPlayerId(code) { localStorage.removeItem(playerKey(code)); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
function stopCountdown() { if (countdownTimer) clearInterval(countdownTimer); countdownTimer = null; }
function inviteUrl(code) { return `${location.origin}${location.pathname}?game=${encodeURIComponent(code)}`; }
function hostGameUrl(id) { return `${location.origin}${location.pathname}?host=1&gameId=${encodeURIComponent(id)}`; }
function displayUrl(code) { return `${location.origin}${location.pathname}?screen=${encodeURIComponent(code)}`; }
function statusBadge(status) {
  const map = { waiting: 'Ожидание', running: 'Идёт игра', finished: 'Завершена' };
  return `<span class="badge ${escapeHtml(status)}">${map[status] || status}</span>`;
}
function typeLabel(type) { return ROUND_TYPE_LABELS[type] || 'Раунд'; }
function toast(message, variant = '') {
  const root = document.getElementById('toast-root');
  const item = document.createElement('div');
  item.className = `toast ${variant}`;
  item.textContent = message;
  root.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}
async function rpc(name, args = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
function setMode(mode) {
  document.body.classList.toggle('host-mode', mode === 'host');
  document.body.classList.toggle('game-mode', mode === 'game');
  document.body.classList.toggle('broadcast-mode', mode === 'broadcast');
}
function renderShell(content, mode = 'page') {
  setMode(mode === 'host' ? 'host' : mode === 'game' ? 'game' : mode === 'broadcast' ? 'broadcast' : 'page');
  app.innerHTML = content;
}

function renderHome() {
  stopPolling(); stopCountdown(); currentGameCode = null; currentPlayerId = null;
  renderShell(`
    <div class="page">
      <section class="hero">
        <div class="hero-inner">
          <div class="eyebrow">Discord • browser survival</div>
          <h1>Игра на <span>выживание</span></h1>
          <p class="hero-lead">30 раундов, логические ловушки, мини-игры, спецраунды, 3 жизни и только один победитель.</p>
          <div class="hero-date">
            <span class="chip">📍 Трибуна Discord</span>
            <span class="chip">🕓 17.06.2026 в 16:00</span>
          </div>
          <div class="join-panel" id="join">
            <input id="home-code" maxlength="18" placeholder="Введите invite-код" autocomplete="off" />
            <button class="primary-btn" id="home-join-btn">Войти</button>
          </div>
          <div class="hero-stats">
            <div class="stat-card"><b>3</b><span>жизни у игрока</span></div>
            <div class="stat-card"><b>30</b><span>раундов</span></div>
            <div class="stat-card"><b>1</b><span>победитель</span></div>
          </div>
        </div>
      </section>

      <section class="section" id="rules">
        <div class="section-head">
          <div>
            <h2 class="section-title">Правила игры</h2>
            <p class="section-subtitle">Игроки заходят по ссылке, вводят ник и выживают в раундах до финала.</p>
          </div>
        </div>
        <div class="rules-grid">
          <div class="rules-image" role="img" aria-label="Правила игры"></div>
          <div class="rules-copy glass">
            <h3>Как проходит матч</h3>
            <div class="rule-list">
              ${renderRule(1, 'Вход по ссылке', 'Игрок открывает приглашение и вводит ник. Регистрация не нужна.')}
              ${renderRule(2, '3 жизни', 'Ошибка, тайм-аут или провал мини-игры снимает жизнь.')}
              ${renderRule(3, 'Раунды', 'Ведущий запускает вопросы, блиц, ловушки, реакцию и финал.')}
              ${renderRule(4, 'Спецэффекты', 'x2 даёт больше очков, иммунитет спасает от одной ошибки.')}
              ${renderRule(5, 'Победа', 'Побеждает последний живой. Если раунды закончились — лидер по очкам.')}
            </div>
          </div>
        </div>
      </section>
    </div>
  `);
  $('#home-join-btn').onclick = () => {
    audio.click();
    const code = normalizeCode($('#home-code').value);
    if (!code) return toast('Введите invite-код', 'bad');
    location.href = `?game=${encodeURIComponent(code)}`;
  };
  $('#home-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#home-join-btn').click();
  });
}
function renderRule(num, title, text) {
  return `<div class="rule-item"><div class="rule-num">${num}</div><div><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></div></div>`;
}

async function renderHost() {
  stopPolling(); stopCountdown();
  setMode('host');
  const stored = getHostCode();
  if (!stored) return renderHostLogin();
  const idFromUrl = params.get('gameId');
  if (idFromUrl) {
    hostGameId = idFromUrl;
    renderHostGame(idFromUrl);
  } else {
    renderHostList();
  }
}
function renderHostLogin(message = '') {
  renderShell(`
    <div class="page">
      <section class="host-layout">
        <aside class="host-side glass">
          <h2>Панель ведущего</h2>
          <p class="muted">Страница скрыта с главной. Вход только по прямой ссылке и коду ведущего.</p>
          <div class="hr"></div>
          <label class="tiny">Код ведущего</label>
          <input id="host-code" type="password" placeholder="Введите код" autocomplete="off" />
          <div class="hr"></div>
          <button class="primary-btn" id="host-login">Войти</button>
          ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ''}
        </aside>
        <main class="host-main glass">
          <h1>Управление <span>игрой</span></h1>
          <p class="hero-lead">Создание игры, invite-ссылки, запуск раундов и контроль выбывания.</p>
        </main>
      </section>
    </div>
  `, 'host');
  $('#host-login').onclick = async () => {
    audio.click();
    const code = $('#host-code').value.trim();
    if (!code) return toast('Введите код ведущего', 'bad');
    try {
      await rpc('br_host_list_games', { p_host_code: code });
      setHostCode(code);
      audio.correct();
      renderHostList();
    } catch (e) {
      audio.wrong();
      toast(e.message || 'Неверный код', 'bad');
    }
  };
  $('#host-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#host-login').click();
  });
}
async function renderHostList() {
  stopPolling(); stopCountdown();
  const hostCode = getHostCode();
  renderShell(`
    <div class="page">
      <section class="host-layout">
        <aside class="host-side glass">
          <div class="row-between">
            <h2>Ведущий</h2>
            <button class="ghost-btn" id="logout-host">Выйти</button>
          </div>
          <p class="muted">Создай матч, скопируй invite-ссылку и отправь участникам в Discord.</p>
          <div class="hr"></div>
          <h3>Создать игру</h3>
          <div class="form-grid">
            <input id="game-title" value="Игра на выживание" placeholder="Название игры" />
            <div class="grid-2">
              <input id="invite-code" value="${randomCode()}" maxlength="18" placeholder="Invite-код" />
              <input id="lives" type="number" value="3" min="1" max="10" placeholder="Жизни" />
            </div>
            <button class="soft-btn" id="regen-code">Сгенерировать код</button>
            <button class="primary-btn" id="create-game">Создать игру с 30 раундами</button>
          </div>
          <p class="tiny">Кнопка ведущего не показывается на главной. Ссылка для тебя: <span class="code">?host=1</span></p>
        </aside>
        <main class="host-main glass">
          <div class="row-between">
            <div>
              <h1>Игры <span>на выживание</span></h1>
              <p class="muted">Список созданных матчей.</p>
            </div>
            <button class="soft-btn" id="refresh-games">Обновить</button>
          </div>
          <div id="games-list" class="host-games"><div class="empty">Загрузка...</div></div>
          <div class="hr"></div>
          <details>
            <summary class="muted">Расширенная настройка раундов JSON</summary>
            <p class="tiny">Встроено 30 сложных раундов. Можно редактировать вопросы, варианты, типы и таймер. Типы: quiz, fast, double, immunity, trap, sudden, reflex, memory.</p>
            <textarea id="rounds-json">${escapeHtml(JSON.stringify(DEFAULT_ROUNDS, null, 2))}</textarea>
          </details>
        </main>
      </section>
    </div>
  `, 'host');

  $('#logout-host').onclick = () => { clearHostCode(); renderHostLogin(); };
  $('#regen-code').onclick = () => { $('#invite-code').value = randomCode(); };
  $('#refresh-games').onclick = loadGames;
  $('#create-game').onclick = () => { audio.start(); createGame(); };
  await loadGames();

  async function loadGames() {
    try {
      const games = await rpc('br_host_list_games', { p_host_code: hostCode });
      const list = $('#games-list');
      if (!games || !games.length) {
        list.innerHTML = '<div class="empty">Игр пока нет. Создай первый матч.</div>';
        return;
      }
      list.innerHTML = games.map(game => `
        <article class="game-card">
          <div class="row-between">
            <div>
              <h3>${escapeHtml(game.title)}</h3>
              <div class="row">${statusBadge(game.status)} <span class="chip">Код: <span class="code">${escapeHtml(game.invite_code)}</span></span></div>
            </div>
            <button class="primary-btn open-game" data-id="${escapeHtml(game.id)}">Открыть</button>
          </div>
          <div class="copy-box">
            <input readonly value="${escapeHtml(inviteUrl(game.invite_code))}" />
            <button class="soft-btn copy-link" data-link="${escapeHtml(inviteUrl(game.invite_code))}">Копировать</button>
          </div>
        </article>
      `).join('');
      $all('.open-game').forEach(btn => btn.onclick = () => { location.href = `?host=1&gameId=${btn.dataset.id}`; });
      $all('.copy-link').forEach(btn => btn.onclick = () => copyText(btn.dataset.link));
    } catch (e) {
      if (String(e.message).toLowerCase().includes('код')) {
        clearHostCode();
        renderHostLogin('Код устарел или неверный. Введите заново.');
      } else {
        $('#games-list').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
      }
    }
  }
  async function createGame() {
    try {
      const rounds = JSON.parse($('#rounds-json').value);
      const title = $('#game-title').value.trim() || 'Игра на выживание';
      const code = normalizeCode($('#invite-code').value || randomCode());
      const lives = Number($('#lives').value || 3);
      const created = await rpc('br_host_create_game', {
        p_host_code: hostCode,
        p_title: title,
        p_invite_code: code,
        p_lives_per_player: lives,
        p_rounds: rounds
      });
      toast('Игра создана', 'good');
      location.href = `?host=1&gameId=${created.id}`;
    } catch (e) {
      toast(e.message || 'Не удалось создать игру', 'bad');
    }
  }
}
async function renderHostGame(gameId) {
  stopPolling(); stopCountdown();
  const hostCode = getHostCode();
  if (!hostCode) return renderHostLogin();
  hostGameId = gameId;

  renderShell(`
    <div class="page">
      <section class="host-main glass">
        <div id="host-game-content"><div class="empty">Загрузка игры...</div></div>
      </section>
    </div>
  `, 'host');

  await refreshHostGame();
  pollTimer = setInterval(refreshHostGame, 2500);

  async function refreshHostGame() {
    try {
      const state = await rpc('br_host_game_state', { p_host_code: hostCode, p_game_id: gameId });
      renderHostState(state);
    } catch (e) {
      if (String(e.message).toLowerCase().includes('код')) {
        clearHostCode(); stopPolling(); renderHostLogin('Код ведущего неверный.'); return;
      }
      $('#host-game-content').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
    }
  }
  function renderHostState(state) {
    const game = state.game;
    const players = state.players || [];
    const rounds = state.rounds || [];
    const answers = state.answers || [];
    const currentRound = rounds.find(r => r.round_order === game.current_round_index);
    const alive = players.filter(p => !p.eliminated).length;
    const answered = currentRound ? answers.filter(a => a.round_id === currentRound.id).length : 0;
    const winner = getWinner(players);
    $('#host-game-content').innerHTML = `
      <div class="row-between">
        <div>
          <h1>${escapeHtml(game.title)} <span>${escapeHtml(game.invite_code)}</span></h1>
          <div class="row">${statusBadge(game.status)} <span class="chip">Раунд: ${game.current_round_index >= 0 ? game.current_round_index + 1 : 0}/${rounds.length}</span></div>
        </div>
        <button class="soft-btn" id="back-games">К списку</button>
      </div>
      <div class="copy-box host-links-box">
        <label><span>Ссылка игрокам</span><input readonly value="${escapeHtml(inviteUrl(game.invite_code))}" /></label>
        <button class="primary-btn" id="copy-invite">Скопировать invite</button>
        <label><span>Экран трансляции</span><input readonly value="${escapeHtml(displayUrl(game.invite_code))}" /></label>
        <button class="soft-btn" id="copy-display">Скопировать экран</button>
        <button class="soft-btn" id="open-display">Открыть экран</button>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><b>${players.length}</b><span>игроков</span></div>
        <div class="kpi"><b>${alive}</b><span>живых</span></div>
        <div class="kpi"><b>${answered}</b><span>ответили</span></div>
        <div class="kpi"><b>${winner ? escapeHtml(winner.name) : '—'}</b><span>лидер</span></div>
      </div>
      <div class="row">
        <button class="primary-btn" id="start-game" ${game.status !== 'waiting' ? 'disabled' : ''}>Запустить игру</button>
        <button class="soft-btn" id="next-round" ${game.status !== 'running' ? 'disabled' : ''}>Следующий раунд</button>
        <button class="danger-btn" id="finish-game" ${game.status === 'finished' ? 'disabled' : ''}>Завершить</button>
        <button class="danger-btn" id="reset-game">Сбросить</button>
        <button class="danger-btn" id="delete-game">Удалить</button>
      </div>
      <div class="host-panels">
        <section class="host-card">
          <h2>Текущий раунд</h2>
          ${currentRound ? renderHostRound(currentRound, answers, players, game) : '<div class="empty">Игра ещё не запущена. Игроки могут заходить в лобби.</div>'}
          <div class="hr"></div>
          <h3>Все раунды</h3>
          ${rounds.map(r => `<div class="round-card"><div class="row-between"><b>${r.round_order + 1}. ${escapeHtml(r.title)}</b><span class="badge">${typeLabel(r.type)}</span></div><p class="muted">${escapeHtml(r.question_text)}</p></div>`).join('')}
        </section>
        <section class="host-card">
          <h2>Участники</h2>
          ${renderPlayers(players)}
        </section>
      </div>
    `;
    $('#back-games').onclick = () => { location.href = '?host=1'; };
    $('#copy-invite').onclick = () => { audio.click(); copyText(inviteUrl(game.invite_code)); };
    $('#copy-display').onclick = () => { audio.click(); copyText(displayUrl(game.invite_code)); };
    $('#open-display').onclick = () => { audio.click(); window.open(displayUrl(game.invite_code), '_blank'); };
    $('#start-game').onclick = () => { audio.start(); hostAction('br_host_start_game', 'Игра запущена'); };
    $('#next-round').onclick = () => { audio.round(); hostAction('br_host_next_round', 'Следующий раунд запущен'); };
    $('#finish-game').onclick = () => { audio.victory(); hostAction('br_host_finish_game', 'Игра завершена'); };
    $('#reset-game').onclick = () => confirmAction('Сбросить ответы, жизни и статус игры?', () => hostAction('br_host_reset_game', 'Игра сброшена'));
    $('#delete-game').onclick = () => confirmAction('Удалить игру полностью?', async () => {
      await rpc('br_host_delete_game', { p_host_code: hostCode, p_game_id: gameId });
      toast('Игра удалена', 'good');
      location.href = '?host=1';
    });
  }
  async function hostAction(functionName, successMessage) {
    try {
      await rpc(functionName, { p_host_code: hostCode, p_game_id: gameId });
      toast(successMessage, 'good');
      await refreshHostGame();
    } catch (e) {
      toast(e.message || 'Ошибка действия', 'bad');
    }
  }
}
function renderHostRound(round, answers, players, game) {
  const byPlayer = new Map(players.map(p => [p.id, p]));
  const end = game.round_started_at ? new Date(new Date(game.round_started_at).getTime() + round.time_limit_seconds * 1000) : null;
  return `
    <div class="round-card">
      <div class="row-between">
        <span class="round-type">${typeLabel(round.type)}</span>
        <span class="timer" data-end="${end ? end.toISOString() : ''}">--</span>
      </div>
      <h2>${escapeHtml(round.title)}</h2>
      <p>${escapeHtml(round.question_text)}</p>
      <div class="grid-2">
        ${['A','B','C','D'].map(key => `<div class="mini-card" style="padding:12px"><b>${key}</b> ${escapeHtml(round[`option_${key.toLowerCase()}`])}${round.correct_option === key ? ' <span class="red">✓</span>' : ''}</div>`).join('')}
      </div>
    </div>
    <h3>Ответы</h3>
    <div class="answers-table">
      ${answers.filter(a => a.round_id === round.id).length ? answers.filter(a => a.round_id === round.id).map(a => {
        const p = byPlayer.get(a.player_id);
        return `<div class="answer-row ${a.is_correct ? 'good' : 'bad'}"><span>${escapeHtml(p?.name || 'Игрок')} — ${escapeHtml(a.answer)}</span><b>${a.is_correct ? '+' + a.score_delta : a.lives_delta + ' жизнь'}</b></div>`;
      }).join('') : '<div class="empty">Ответов пока нет.</div>'}
    </div>
  `;
}
function renderPlayers(players = []) {
  if (!players.length) return '<div class="empty">Игроков пока нет.</div>';
  const sorted = [...players].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.score - a.score || b.lives - a.lives || new Date(a.joined_at) - new Date(b.joined_at));
  return `<div class="player-list">${sorted.map((p, index) => `
    <div class="player-card ${p.eliminated ? 'eliminated' : ''}">
      <div>
        <div class="player-name">${index + 1}. ${escapeHtml(p.name)} ${p.eliminated ? '<span class="muted">выбыл</span>' : ''}</div>
        <div class="meta"><span class="lives">❤ ${p.lives}</span><span class="score">🏆 ${p.score}</span><span class="shield">🛡 ${p.shield_count || 0}</span></div>
      </div>
      <span class="badge ${p.eliminated ? 'finished' : 'running'}">${p.eliminated ? 'OUT' : 'LIVE'}</span>
    </div>
  `).join('')}</div>`;
}

async function renderPlayerGame(code) {
  stopPolling(); stopCountdown();
  currentGameCode = normalizeCode(code);
  if (!currentGameCode) return renderHome();
  currentPlayerId = getStoredPlayerId(currentGameCode);
  setMode('game');
  renderShell(`<div class="game-shell"><div class="empty">Загрузка игры...</div></div>`, 'game');

  if (!currentPlayerId) {
    await renderJoinGame(currentGameCode);
  } else {
    await renderPublicGame();
    pollTimer = setInterval(renderPublicGame, 2000);
  }
}
async function renderJoinGame(code) {
  try {
    const state = await rpc('br_public_game_state', { p_invite_code: code });
    if (!state || !state.game) throw new Error('Игра не найдена');
    renderShell(`
      <div class="game-shell">
        <section class="join-card glass">
          <div class="eyebrow">Invite: ${escapeHtml(code)}</div>
          <h1>${escapeHtml(state.game.title)} <span>вход</span></h1>
          <p class="muted">Введите ник. После входа ждите запуска раунда от ведущего.</p>
          <div class="form-grid">
            <input id="player-name" maxlength="32" placeholder="Ваш ник" autocomplete="off" />
            <button class="primary-btn" id="join-game">Войти в лобби</button>
          </div>
          <div class="hr"></div>
          <p class="tiny">У каждого игрока 3 жизни. Ошибки и тайм-ауты снимают жизни. Побеждает последний выживший.</p>
        </section>
      </div>
    `, 'game');
    $('#join-game').onclick = async () => {
      audio.start();
      const name = $('#player-name').value.trim();
      if (name.length < 2) return toast('Ник должен быть от 2 символов', 'bad');
      try {
        const player = await rpc('br_join_game', { p_invite_code: code, p_name: name });
        setStoredPlayerId(code, player.id);
        currentPlayerId = player.id;
        audio.background();
        toast('Вы в игре', 'good');
        await renderPublicGame();
        pollTimer = setInterval(renderPublicGame, 2000);
      } catch (e) {
        toast(e.message || 'Не удалось войти', 'bad');
      }
    };
    $('#player-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join-game').click(); });
  } catch (e) {
    renderShell(`<div class="game-shell"><div class="join-card glass"><h1>Игра <span>не найдена</span></h1><p class="muted">${escapeHtml(e.message)}</p><button class="primary-btn" onclick="location.href='./'">На главную</button></div></div>`, 'game');
  }
}
async function renderPublicGame() {
  try {
    const state = await rpc('br_public_game_state', { p_invite_code: currentGameCode });
    if (!state || !state.game) throw new Error('Игра не найдена');
    lastPublicState = state;
    const me = (state.players || []).find(p => p.id === currentPlayerId);
    if (!me) {
      clearStoredPlayerId(currentGameCode);
      currentPlayerId = null;
      stopPolling();
      return renderJoinGame(currentGameCode);
    }
    const roundSig = `${state.game.status}:${state.current_round?.id || 'none'}:${me.lives}:${me.eliminated ? 'out' : 'in'}`;
    if (lastAudioSignature && roundSig !== lastAudioSignature) {
      const prev = lastAudioSignature.split(':');
      const prevLives = Number(prev[2] || me.lives);
      if (state.game.status === 'running' && state.current_round?.id && prev[1] !== state.current_round.id) audio.round();
      if (me.eliminated || me.lives <= 0) audio.death();
      else if (me.lives < prevLives) audio.wrong();
    }
    lastAudioSignature = roundSig;
    if (state.game.status === 'waiting') return renderLobby(state, me);
    if (state.game.status === 'finished') return renderFinished(state, me);
    return renderRunning(state, me);
  } catch (e) {
    renderShell(`<div class="game-shell"><div class="empty">${escapeHtml(e.message || 'Ошибка загрузки')}</div></div>`, 'game');
  }
}
function renderLobby(state, me) {
  stopCountdown();
  renderShell(`
    <div class="game-shell">
      <section class="lobby-hero lobby-clean">
        <div class="lobby-dock glass">
          <div class="lobby-mainline">
            <div>
              <div class="eyebrow">Вы подключены • код ${escapeHtml(state.game.invite_code)}</div>
              <p class="muted lobby-only-status">Ждите команду ведущего. Первый раунд начнётся одновременно для всех игроков.</p>
            </div>
            <div class="lobby-stats">
              <div class="stat-card"><b>${(state.players || []).length}</b><span>игроков</span></div>
              <div class="stat-card"><b>${me.lives}</b><span>жизни</span></div>
              <div class="stat-card"><b>${me.score}</b><span>очков</span></div>
            </div>
          </div>
        </div>
      </section>
      <section class="game-grid lobby-grid">
        <div class="status-panel glass">
          <div class="row-between">
            <h2>Как выжить</h2>
            <span class="badge waiting">Ожидание</span>
          </div>
          <div class="rule-list compact-rules">
            ${renderRule(1, 'Думай, а не кликай наугад', 'В ловушках неверный ответ может снять сразу 2 жизни.')}
            ${renderRule(2, 'Следи за таймером', 'Быстрые раунды дают мало времени, тайм-аут считается ошибкой.')}
            ${renderRule(3, 'Бери бонусы', 'Раунд иммунитета даёт щит, а x2 помогает вырваться в лидеры.')}
          </div>
        </div>
        <aside class="leaderboard glass">
          <h2>Игроки в матче</h2>
          ${renderPlayers(state.players || [])}
        </aside>
      </section>
    </div>
  `, 'game');
}
function renderRunning(state, me) {
  audio.background();
  const round = state.current_round;
  const answeredIds = state.answered_player_ids || [];
  const hasAnswered = answeredIds.includes(currentPlayerId);
  const eliminated = me.eliminated || me.lives <= 0;
  const end = round?.ends_at || '';
  renderShell(`
    <div class="game-shell">
      <section class="game-grid">
        <main class="stage glass">
          <div class="round-top">
            <div>
              <div class="round-type">${round ? typeLabel(round.type) : 'Ожидание'}</div>
              <h1 class="question-title">${round ? escapeHtml(round.title || 'Раунд') : 'Раунд скоро начнётся'}</h1>
            </div>
            <div class="timer" data-end="${escapeHtml(end)}">--</div>
          </div>
          ${eliminated ? renderEliminated(me) : renderRoundBody(round, hasAnswered)}
        </main>
        <aside class="leaderboard glass">
          <div class="row-between">
            <h2>Таблица</h2>
            <span class="badge running">LIVE</span>
          </div>
          <div class="player-card">
            <div>
              <div class="player-name">Вы: ${escapeHtml(me.name)}</div>
              <div class="meta"><span class="lives">❤ ${me.lives}</span><span class="score">🏆 ${me.score}</span><span class="shield">🛡 ${me.shield_count || 0}</span></div>
            </div>
          </div>
          <div class="hr"></div>
          ${renderPlayers(state.players || [])}
        </aside>
      </section>
    </div>
  `, 'game');
  startCountdown();
  if (!eliminated && round && !hasAnswered) attachRoundHandlers(round);
}
function renderRoundBody(round, hasAnswered) {
  if (!round) return '<div class="empty">Ведущий готовит следующий раунд.</div>';
  const already = hasAnswered ? '<div class="result-banner">Ответ принят. Дождитесь следующего раунда.</div>' : '';
  if (round.type === 'reflex') {
    return `
      <p class="question-desc">${escapeHtml(round.question_text)}</p>
      <div class="reflex-area">
        <button class="reflex-btn" id="reflex-submit" ${hasAnswered ? 'disabled' : ''}>Нажать</button>
      </div>
      ${already}
    `;
  }
  return `
    <p class="question-desc">${escapeHtml(round.question_text)}</p>
    <div class="options">
      ${['A','B','C','D'].map(key => `<button class="option-btn ${hasAnswered ? 'answered' : ''}" data-answer="${key}" ${hasAnswered ? 'disabled' : ''}><b>${key}</b>${escapeHtml(round[`option_${key.toLowerCase()}`])}</button>`).join('')}
    </div>
    ${already}
  `;
}
function renderEliminated(me) {
  return `
    <div class="winner-card">
      <div class="eyebrow">Вы выбыли</div>
      <h2>Игра окончена</h2>
      <p class="muted">Ваш результат: ${escapeHtml(me.score)} очков. Следите за финалом в таблице.</p>
    </div>
  `;
}
function attachRoundHandlers(round) {
  $all('.option-btn').forEach(btn => btn.onclick = () => submitAnswer(round.id, btn.dataset.answer));
  const reflex = $('#reflex-submit');
  if (reflex) reflex.onclick = () => submitAnswer(round.id, 'A');
}
async function submitAnswer(roundId, answer) {
  try {
    const result = await rpc('br_submit_answer', {
      p_invite_code: currentGameCode,
      p_player_id: currentPlayerId,
      p_round_id: roundId,
      p_answer: answer
    });
    if (result.is_correct) {
      audio.correct();
      const bonus = result.gained_shield ? ' + иммунитет' : '';
      toast(`Верно: +${result.score_delta} очк.${bonus}`, 'good');
    } else if (result.used_shield) {
      audio.correct();
      toast('Ошибка, но иммунитет спас жизнь', 'good');
    } else {
      audio.wrong();
      toast(`Неверно: ${result.lives_delta} жизнь`, 'bad');
    }
    await renderPublicGame();
  } catch (e) {
    toast(e.message || 'Ответ не принят', 'bad');
    await renderPublicGame();
  }
}
function renderFinished(state, me) {
  stopCountdown(); stopPolling();
  audio.victory();
  const winner = getWinner(state.players || []);
  renderShell(`
    <div class="game-shell">
      <section class="winner-card">
        <div class="eyebrow">Финал</div>
        <h2>${winner ? escapeHtml(winner.name) : 'Победитель не определён'}</h2>
        <p class="hero-lead">${winner ? 'Побеждает последний выживший / лидер по очкам.' : 'Игра завершена.'}</p>
        <div class="row" style="justify-content:center">
          <span class="chip">Ваш счёт: ${escapeHtml(me?.score ?? 0)}</span>
          <span class="chip">Ваши жизни: ${escapeHtml(me?.lives ?? 0)}</span>
        </div>
      </section>
      <section class="status-panel glass">
        <h2>Итоговая таблица</h2>
        ${renderPlayers(state.players || [])}
      </section>
    </div>
  `, 'game');
}
function startCountdown() {
  stopCountdown();
  audio.resetTick();
  const timer = $('.timer[data-end]');
  if (!timer) return;
  const end = Date.parse(timer.dataset.end || '');
  if (!end) { timer.textContent = '--'; return; }
  const tick = () => {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    timer.textContent = `00:${String(left).padStart(2, '0')}`;
    audio.tick(left);
    if (left === 0) audio.timeout();
    timer.style.borderColor = left <= 5 ? 'rgba(255,81,81,.82)' : 'rgba(255,45,37,.58)';
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}
function getWinner(players = []) {
  if (!players.length) return null;
  const alive = players.filter(p => !p.eliminated && p.lives > 0);
  const pool = alive.length ? alive : players;
  return [...pool].sort((a, b) => b.score - a.score || b.lives - a.lives || new Date(a.joined_at) - new Date(b.joined_at))[0];
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано', 'good');
  } catch {
    toast('Не удалось скопировать', 'bad');
  }
}
function confirmAction(text, action) {
  if (confirm(text)) action();
}


function renderBroadcastGame(code) {
  stopPolling(); stopCountdown();
  currentGameCode = normalizeCode(code);
  lastAudioSignature = '';
  renderShell(`<div class="broadcast-shell"><div class="broadcast-loading">Загрузка экрана трансляции...</div></div>`, 'broadcast');
  renderBroadcastAudioGate();
  refreshBroadcastGame();
  pollTimer = setInterval(refreshBroadcastGame, 1200);
}
function renderBroadcastAudioGate() {
  const existing = document.querySelector('.broadcast-audio-gate');
  if (audio.isMuted() || audio.isUnlocked()) { if (existing) existing.remove(); return; }
  if (existing) return;
  const gate = document.createElement('button');
  gate.className = 'broadcast-audio-gate';
  gate.innerHTML = '<b>🔊 Включить звук трансляции</b><span>Нажми один раз на втором браузере перед стримом</span>';
  gate.onclick = () => { audio.enable(); gate.remove(); };
  document.body.appendChild(gate);
}
async function refreshBroadcastGame() {
  try {
    const state = await rpc('br_public_game_state', { p_invite_code: currentGameCode });
    if (!state || !state.game) throw new Error('Игра не найдена');
    renderBroadcastState(state);
  } catch (e) {
    renderShell(`<div class="broadcast-shell"><div class="broadcast-error">${escapeHtml(e.message || 'Ошибка загрузки')}</div></div>`, 'broadcast');
  }
}
function renderBroadcastState(state) {
  const game = state.game;
  const round = state.current_round;
  const players = state.players || [];
  const answers = state.answered_player_ids || [];
  const alive = players.filter(p => !p.eliminated && p.lives > 0).length;
  const sig = `${game.status}:${round?.id || 'none'}:${alive}:${answers.length}`;
  if (lastAudioSignature && sig !== lastAudioSignature) {
    const prev = lastAudioSignature.split(':');
    if (game.status === 'running' && round?.id && prev[1] !== round.id) audio.round();
    if (Number(prev[2] || alive) > alive) audio.death();
  }
  lastAudioSignature = sig;
  if (game.status === 'waiting') return renderBroadcastLobby(state);
  if (game.status === 'finished') return renderBroadcastFinished(state);
  return renderBroadcastRunning(state);
}
function renderBroadcastLobby(state) {
  stopCountdown();
  audio.background();
  renderShell(`
    <div class="broadcast-shell broadcast-lobby-bg">
      <div class="broadcast-topline">
        <div class="broadcast-brand"><img src="assets/br-logo.png" alt="" /> <span><b>BLACK</b> RUSSIA</span></div>
        <div class="broadcast-code">КОД: ${escapeHtml(state.game.invite_code)}</div>
      </div>
      <main class="broadcast-lobby-card">
        <div class="broadcast-kicker">Экран трансляции</div>
        <h1>Лобби <span>ожидания</span></h1>
        <p>Игроки заходят по ссылке, вводят ник и готовятся к первому раунду.</p>
        <div class="broadcast-big-stats">
          <div><b>${(state.players || []).length}</b><span>игроков подключено</span></div>
          <div><b>3</b><span>жизни на старте</span></div>
          <div><b>30</b><span>раундов выживания</span></div>
        </div>
      </main>
      <aside class="broadcast-roster glass">
        <h2>Участники</h2>
        ${renderBroadcastPlayers(state.players || [])}
      </aside>
    </div>
  `, 'broadcast');
  renderBroadcastAudioGate();
}
function renderBroadcastRunning(state) {
  audio.background();
  const round = state.current_round;
  const players = state.players || [];
  const answered = (state.answered_player_ids || []).length;
  const alive = players.filter(p => !p.eliminated && p.lives > 0).length;
  const end = round?.ends_at || '';
  renderShell(`
    <div class="broadcast-shell broadcast-game-bg">
      <div class="broadcast-topline">
        <div class="broadcast-brand"><img src="assets/br-logo.png" alt="" /> <span><b>BLACK</b> RUSSIA</span></div>
        <div class="broadcast-live"><span></span> LIVE • ${escapeHtml(state.game.invite_code)}</div>
      </div>
      <main class="broadcast-stage glass ${round?.type || ''}">
        <div class="broadcast-round-head">
          <div>
            <div class="round-type">${round ? typeLabel(round.type) : 'Раунд'}</div>
            <h1>${round ? escapeHtml(round.title || 'Раунд') : 'Раунд скоро начнётся'}</h1>
          </div>
          <div class="timer broadcast-timer" data-end="${escapeHtml(end)}">--</div>
        </div>
        ${round ? `
          <p class="broadcast-question">${escapeHtml(round.question_text)}</p>
          ${round.type === 'reflex' ? '<div class="broadcast-reflex">⚡ РЕАКЦИЯ</div>' : `<div class="broadcast-options">
            ${['A','B','C','D'].map(key => `<div class="broadcast-option"><b>${key}</b><span>${escapeHtml(round[`option_${key.toLowerCase()}`])}</span></div>`).join('')}
          </div>`}
        ` : '<div class="broadcast-question">Ведущий готовит следующий раунд.</div>'}
        <div class="broadcast-status-strip">
          <div><b>${answered}</b><span>ответили</span></div>
          <div><b>${alive}</b><span>живых</span></div>
          <div><b>${players.length}</b><span>всего</span></div>
        </div>
      </main>
      <aside class="broadcast-roster glass">
        <h2>Таблица</h2>
        ${renderBroadcastPlayers(players)}
      </aside>
    </div>
  `, 'broadcast');
  renderBroadcastAudioGate();
  startCountdown();
}
function renderBroadcastFinished(state) {
  stopCountdown();
  audio.victory();
  const winner = getWinner(state.players || []);
  renderShell(`
    <div class="broadcast-shell broadcast-finish-bg">
      <div class="broadcast-topline">
        <div class="broadcast-brand"><img src="assets/br-logo.png" alt="" /> <span><b>BLACK</b> RUSSIA</span></div>
        <div class="broadcast-code">ФИНАЛ</div>
      </div>
      <main class="broadcast-winner glass">
        <div class="broadcast-kicker">Победитель</div>
        <h1>${winner ? escapeHtml(winner.name) : 'Не определён'}</h1>
        <p>Последний выживший забирает матч.</p>
      </main>
      <aside class="broadcast-roster glass">
        <h2>Итоговая таблица</h2>
        ${renderBroadcastPlayers(state.players || [])}
      </aside>
    </div>
  `, 'broadcast');
  renderBroadcastAudioGate();
}
function renderBroadcastPlayers(players = []) {
  if (!players.length) return '<div class="empty">Игроки ещё не подключились.</div>';
  const sorted = [...players].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.score - a.score || b.lives - a.lives || new Date(a.joined_at) - new Date(b.joined_at)).slice(0, 12);
  return `<div class="broadcast-player-list">${sorted.map((p, index) => `
    <div class="broadcast-player ${p.eliminated ? 'out' : ''}">
      <strong>${index + 1}. ${escapeHtml(p.name)}</strong>
      <span>❤ ${p.lives} · 🏆 ${p.score} · 🛡 ${p.shield_count || 0}</span>
    </div>
  `).join('')}</div>`;
}

(function init() {
  setupSoundToggle();
  const hostMode = params.has('host') || params.has('admin');
  const displayCode = params.get('screen') || params.get('display') || params.get('cast') || params.get('broadcast');
  const gameCode = params.get('game') || params.get('join') || params.get('code');
  if (hostMode) return renderHost();
  if (displayCode) return renderBroadcastGame(displayCode);
  if (gameCode) return renderPlayerGame(gameCode);
  return renderHome();
})();
