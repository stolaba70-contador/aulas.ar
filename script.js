/* ════════════════════════════════════════════════
   SUPABASE
   ════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://wvhomqgvkqtenccwtjen.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2aG9tcWd2a3F0ZW5jY3d0amVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODk5NzMsImV4cCI6MjA5MTM2NTk3M30.JtDsspL0oX_sNqNzL1Z4wxwhvFG5kJHpCjIuejiEiMw';
const IA_ENDPOINT = '/.netlify/functions/ia';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let currentUser = null;
let currentPerfil = null;
let pomodoroActivo = false;
let filminas_leidas_sesion = [];
let filminas_observer = null;


async function getVisibleUserIds() {
  if (currentPerfil?.rol === 'superadmin') {
  return [currentUser.id];
}

  const grupoId = currentPerfil?.grupo_id;
  if (!grupoId) return [currentUser.id];

  const { data } = await supabaseClient
    .rpc('get_group_admin_ids', { p_grupo_id: grupoId });

  const adminIds = (data || []).map(p => p.id);
  return [...new Set([...adminIds, currentUser.id])];
}

async function cargarSelectGrupos(selectId) {
  const { data: grupos } = await supabaseClient
    .from('grupos').select('*').eq('admin_id', currentUser.id).order('nombre');
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">Seleccioná un grupo...</option>' +
    (grupos || []).map(g => `<option value="${g.id}">${g.nombre}</option>`).join('');
  // Preseleccionar el grupo propio
  if (currentPerfil?.grupo_id) sel.value = currentPerfil.grupo_id;
}

/* ════════════════════════════════════════════════
   AUTH FUNCTIONS
   ════════════════════════════════════════════════ */

async function checkAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    showAuthScreen('login');
    return;
  }

  currentUser = session.user;

  const { data: perfil } = await supabaseClient
    .from('perfiles')
    .select('*, grupos(id, nombre)')
    .eq('id', currentUser.id)
    .single();

  if (!perfil) {
    showAuthScreen('login');
    return;
  }

  currentPerfil = perfil;

  if (perfil.estado === 'pendiente') {
    showAuthScreen('pending');
    return;
  }

  document.getElementById('auth-screen').style.display = 'none';

  const personajeGuardado = localStorage.getItem('personaje_' + currentUser.id);
  if (personajeGuardado) {
    document.querySelector('.app-shell').style.display = 'flex';
    aplicarPersonaje(personajeGuardado);
    if (personajeGuardado !== 'ninguno') {
      document.getElementById('mascota-flotante').style.display = 'block';
    }
  } else {
    mostrarCharScreen();
  }

  const userEl = document.getElementById('sidebar-user');
  if (userEl && currentPerfil) {
    userEl.textContent = `👤 ${currentPerfil.nombre}`;
  }

  if (currentPerfil.rol === 'superadmin') {
    document.getElementById('tab-superadmin').style.display = 'flex';
    const wraps = document.querySelectorAll('[id$="-grupo-wrap"]');
    wraps.forEach(w => w.style.display = 'block');
    const vfTab = document.getElementById('mctab-vf');
    if (vfTab) vfTab.style.display = 'inline-block';
  }

  cargarBannerExamen();
  verificarRepasosHoy();
}

function showAuthScreen(screen) {
  document.getElementById('auth-screen').style.display = 'flex';
  document.querySelector('.app-shell').style.display = 'none';
  document.getElementById('auth-login').style.display = 'none';
  document.getElementById('auth-register').style.display = 'none';
  document.getElementById('auth-pending').style.display = 'none';

  let targetCard = null;
  if (screen === 'login') targetCard = document.getElementById('auth-login');
  else if (screen === 'register') targetCard = document.getElementById('auth-register');
  else if (screen === 'pending') targetCard = document.getElementById('auth-pending');

  if (targetCard) {
    targetCard.style.display = 'flex';
    targetCard.style.animation = 'none';
    targetCard.offsetHeight;
    targetCard.style.animation = '';
  }

  setTimeout(initAllCanvases, 50);
}

async function loginUser() {
  const btn = document.querySelector('#auth-login .auth-btn');
  const span = document.createElement('span');
  span.style.cssText = `position:absolute;border-radius:50%;background:rgba(255,255,255,0.3);width:200px;height:200px;left:50%;top:50%;transform:translate(-50%,-50%) scale(0);animation:rippleBtn 0.6s linear forwards;pointer-events:none`;
  btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  btn.appendChild(span);
  setTimeout(() => span.remove(), 700);
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Completá todos los campos.';
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    errorEl.textContent = 'Email o contraseña incorrectos.';
    return;
  }

  await checkAuth();
}

async function registerUser() {
  const nombre = document.getElementById('register-nombre').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';

  if (!nombre || !email || !password) {
    errorEl.textContent = 'Completá todos los campos.';
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({ email, password });

  if (error) {
    errorEl.textContent = error.message;
    return;
  }

  // Crear perfil
  await supabaseClient.from('perfiles').insert({
    id: data.user.id,
    nombre,
    email,
    rol: 'alumno',
    estado: 'pendiente'
  });

  showAuthScreen('pending');
}

async function logoutUser() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  currentPerfil = null;
  showAuthScreen('login');
}

function mostrarCharScreen() {
  const hora = new Date().getHours();
  const saludo = hora < 12 ? '¡Buenos días!' : hora < 19 ? '¡Buenas tardes!' : '¡Buenas noches!';
  const motivacion = hora < 12
    ? '¿Listo para estudiar hoy?'
    : hora < 19
    ? '¿Cómo van los estudios?'
    : '¡Repaso nocturno, excelente!';

  document.getElementById('char-nombre').textContent = currentPerfil.nombre.split(' ')[0];
  document.getElementById('char-saludo').textContent = saludo;
  document.getElementById('char-motivacion').textContent = motivacion;
  document.getElementById('char-screen').style.display = 'flex';
}

// REEMPLAZÁ toda la función por:
function aplicarPersonaje(id) {
  const mascotaImg = document.getElementById('mascota-img');
  const mascotaFlotante = document.getElementById('mascota-flotante');

  if (id === 'ninguno') {
    mascotaFlotante.style.display = 'none';
    // Marcar seleccionado en Settings
    document.querySelectorAll('[id^="settings-char-"]').forEach(el => el.classList.remove('selected'));
    const settingsEl = document.getElementById('settings-char-ninguno');
    if (settingsEl) settingsEl.classList.add('selected');
    return;
  }

  mascotaImg.src = 'assets/img/personaje-' + id + '.png';
  mascotaImg.style.display = 'block';
  mascotaImg.style.margin = '0 auto';
  const tamaños = { 'perro': '360px', 'santi': '200px', 'capi': '252px' };
  mascotaImg.style.width = tamaños[id] || '360px';

  document.querySelectorAll('[id^="settings-char-"]').forEach(el => el.classList.remove('selected'));
  const settingsEl = document.getElementById('settings-char-' + id);
  if (settingsEl) settingsEl.classList.add('selected');
}

function cambiarPersonaje(id) {
  localStorage.setItem('personaje_' + currentUser.id, id);
  aplicarPersonaje(id);
  // Pequeño feedback
  const btn = document.getElementById('settings-char-' + id);
  if (btn) btn.style.borderColor = 'var(--accent)';
  setTimeout(() => showSection('welcome'), 800);
}

function guardarNombresProfes() {
  const izq = document.getElementById('settings-profe-izq').value.trim();
  const der = document.getElementById('settings-profe-der').value.trim();
  if (izq) localStorage.setItem('profe_izq_' + currentUser.id, izq);
  if (der) localStorage.setItem('profe_der_' + currentUser.id, der);
  const ok = document.getElementById('settings-profe-ok');
  ok.style.display = 'block';
  setTimeout(() => ok.style.display = 'none', 2000);
}

function guardarNombresProfes() {
  const izq = document.getElementById('settings-profe-izq').value.trim();
  const der = document.getElementById('settings-profe-der').value.trim();
  if (izq) localStorage.setItem('profe_izq_' + currentUser.id, izq);
  if (der) localStorage.setItem('profe_der_' + currentUser.id, der);
  const ok = document.getElementById('settings-profe-ok');
  ok.style.display = 'block';
  setTimeout(() => ok.style.display = 'none', 2000);
}

// REEMPLAZÁ toda la función por:
function seleccionarPersonaje(id) {
  document.querySelectorAll('.char-option').forEach(el => el.classList.remove('selected'));
  document.getElementById('char-' + id)?.classList.add('selected');

  const mascotaImg = document.getElementById('mascota-img');
  const charMascot = document.getElementById('char-mascot');

  if (id === 'ninguno') {
    charMascot.style.display = 'none';
    mascotaImg.style.display = 'none';
    return;
  }

  charMascot.style.display = 'block';
  charMascot.src = 'assets/img/personaje-' + id + '.png';
  mascotaImg.src = 'assets/img/personaje-' + id + '.png';
  const tamaños = { 'perro': '360px', 'santi': '200px', 'capi': '252px' };
  mascotaImg.style.width = tamaños[id] || '360px';
  mascotaImg.style.margin = '0 auto';
  mascotaImg.style.display = 'block';
}

function entrarApp() {
  const seleccionado = document.querySelector('.char-option.selected')?.id?.replace('char-', '') || 'perro';
  localStorage.setItem('personaje_' + currentUser.id, seleccionado);
  aplicarPersonaje(seleccionado);
  document.getElementById('char-screen').style.display = 'none';
  document.querySelector('.app-shell').style.display = 'flex';
  if (seleccionado !== 'ninguno') {
    document.getElementById('mascota-flotante').style.display = 'block';
  }
}

async function cargarBannerExamen() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data } = await supabaseClient
    .from('eventos')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('tipo', 'examen')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true });

  const banner = document.getElementById('banner-examen');
  if (!banner) return;
  if (!data || !data.length) { banner.style.display = 'none'; return; }

  banner.style.display = 'block';
  banner.innerHTML = data.map(ev => {
    const dias = Math.ceil((new Date(ev.fecha) - new Date(hoy)) / 86400000);
    return dias === 0
      ? `<div>🎯 <strong>¡Hoy es el examen!</strong> ${ev.titulo}</div>`
      : `<div class="alert-critical">📅 <strong>Faltan ${dias} días</strong> para <em>${ev.titulo}</em> · ¿Hoy repasaste?</div>`;
  }).join('');
}

let multipleUnidadActual = {};
let calendarioMes = new Date().getMonth();
let calendarioAnio = new Date().getFullYear();

async function renderCalendario() {
  const wrap = document.getElementById('calendario-wrap');
  const firstDay = new Date(calendarioAnio, calendarioMes, 1);
  const lastDay  = new Date(calendarioAnio, calendarioMes + 1, 0);
  const fechaDesde = firstDay.toISOString().split('T')[0];
  const fechaHasta = lastDay.toISOString().split('T')[0];

  const { data: eventos } = await supabaseClient
    .from('eventos').select('*')
    .eq('user_id', currentUser.id)
    .gte('fecha', fechaDesde).lte('fecha', fechaHasta);

  const eventosMap = {};
  (eventos || []).forEach(e => {
    if (!eventosMap[e.fecha]) eventosMap[e.fecha] = [];
    eventosMap[e.fecha].push(e);
  });

  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const hoy = new Date().toISOString().split('T')[0];
  let html = `
    <div class="cal-header">
      <button onclick="cambiarMes(-1)">←</button>
      <strong>${meses[calendarioMes]} ${calendarioAnio}</strong>
      <button onclick="cambiarMes(1)">→</button>
    </div>
    <div class="cal-grid">
      <div class="cal-dow">Dom</div><div class="cal-dow">Lun</div>
      <div class="cal-dow">Mar</div><div class="cal-dow">Mié</div>
      <div class="cal-dow">Jue</div><div class="cal-dow">Vie</div>
      <div class="cal-dow">Sáb</div>`;

  // Celdas vacías al inicio
  for (let i = 0; i < firstDay.getDay(); i++) html += `<div class="cal-cell empty"></div>`;

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const fecha = `${calendarioAnio}-${String(calendarioMes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const esHoy = fecha === hoy;
    const evs = eventosMap[fecha] || [];
    const tieneExamen = evs.some(e => e.tipo === 'examen');
    html += `<div class="cal-cell${esHoy?' hoy':''}${tieneExamen?' tiene-examen':evs.length?' tiene-evento':''}" onclick="abrirDia('${fecha}')">
      <span class="cal-num">${d}</span>
      ${evs.map(e => `<div class="cal-dot ${e.tipo}">${e.titulo}</div>`).join('')}
    </div>`;
  }
  html += `</div>`;
  wrap.innerHTML = html;
}

function cambiarMes(delta) {
  calendarioMes += delta;
  if (calendarioMes > 11) { calendarioMes = 0; calendarioAnio++; }
  if (calendarioMes < 0)  { calendarioMes = 11; calendarioAnio--; }
  renderCalendario();
}

async function abrirDia(fecha) {
  const { data: eventos } = await supabaseClient
    .from('eventos').select('*')
    .eq('user_id', currentUser.id)
    .eq('fecha', fecha);

  // Construir mensaje con eventos existentes
  let msg = `📅 ${fecha}\n\n`;
  if (eventos && eventos.length) {
    msg += 'Eventos en este día:\n';
    eventos.forEach((e, i) => {
      msg += `${i + 1}. [${e.tipo === 'examen' ? 'EXAMEN' : 'OBJETIVO'}] ${e.titulo}\n`;
    });
    msg += '\n¿Qué querés hacer?\n1 - Agregar nuevo\n2 - Editar uno\n3 - Borrar uno';
  } else {
    msg += 'No hay eventos. ¿Querés agregar uno?';
  }

  const accion = eventos && eventos.length
    ? prompt(msg + '\n\nEscribí 1, 2 o 3:')
    : '1';

  if (!accion) return;

  // AGREGAR
  if (accion === '1') {
    const titulo = prompt('Título del evento:');
    if (!titulo) return;
    const tipo = confirm('¿Es un examen?\nAceptar = Examen · Cancelar = Objetivo') ? 'examen' : 'objetivo';
    await supabaseClient.from('eventos').insert({ user_id: currentUser.id, fecha, titulo, tipo });
  }

  // EDITAR
  if (accion === '2' && eventos.length) {
    const num = parseInt(prompt(`¿Cuál querés editar? (1 - ${eventos.length})`));
    if (!num || num < 1 || num > eventos.length) return;
    const ev = eventos[num - 1];
    const nuevoTitulo = prompt('Nuevo título:', ev.titulo);
    if (!nuevoTitulo) return;
    const nuevoTipo = confirm('¿Es un examen?\nAceptar = Examen · Cancelar = Objetivo') ? 'examen' : 'objetivo';
    await supabaseClient.from('eventos').update({ titulo: nuevoTitulo, tipo: nuevoTipo }).eq('id', ev.id);
  }

  // BORRAR
  if (accion === '3' && eventos.length) {
    const num = parseInt(prompt(`¿Cuál querés borrar? (1 - ${eventos.length})`));
    if (!num || num < 1 || num > eventos.length) return;
    const ev = eventos[num - 1];
    const confirmar = confirm(`¿Borrar "${ev.titulo}"?`);
    if (!confirmar) return;
    await supabaseClient.from('eventos').delete().eq('id', ev.id);
  }

  renderCalendario();
  cargarBannerExamen();
  document.getElementById('mascota-flotante').style.display = 'block'; //
}

/* ════════════════════════════════════════════════
   OPCIÓN MÚLTIPLE
   ════════════════════════════════════════════════ */

let multiplePreguntas = [];
let multipleRespondidas = {};

async function renderMultiple() {
  const wrap = document.getElementById('multiple-wrap');
  wrap.innerHTML = '<p style="color:var(--muted2)">Cargando materias...</p>';

  const visibleIds = await getVisibleUserIds();

  const { data: todasUnidades } = await supabaseClient
    .from('unidades').select('*, grupos(id, nombre)')
    .in('alumno_id', visibleIds).order('numero');

  const unidades = todasUnidades || [];

  if (!unidades.length) {
    wrap.innerHTML = '<p style="color:var(--muted2)">No hay unidades cargadas aún.</p>';
    return;
  }

  // Agrupar por materia igual que Teoría
  const materiasMap = new Map();
  unidades.forEach(u => {
    const gId = u.grupo_id || 'sin-materia';
    const gNombre = u.grupos?.nombre || 'Sin materia';
    if (!materiasMap.has(gId)) materiasMap.set(gId, { id: gId, nombre: gNombre, unidades: [] });
    materiasMap.get(gId).unidades.push(u);
  });

  const materias = [...materiasMap.values()];

  // Si solo hay una materia ir directo a sus unidades
  if (materias.length === 1) {
    renderMultipleUnidades(materias[0]);
    return;
  }

  wrap.innerHTML = `<p style="color:var(--muted2);margin-bottom:16px">Elegí una materia.</p>
    <div class="units-grid" id="multiple-grupos-grid"></div>`;

  const grid = document.getElementById('multiple-grupos-grid');
  materias.forEach(m => {
    const card = document.createElement('div');
    card.className = 'unit-card';
    card.innerHTML = `
      <div class="unit-card-main" onclick='renderMultipleUnidades(${JSON.stringify(m)})'>
        <div class="unit-num">📂</div>
        <div class="unit-info">
          <h4>${m.nombre}</h4>
          <p style="font-size:12px;color:var(--muted2)">${m.unidades.length} unidad${m.unidades.length !== 1 ? 'es' : ''}</p>
        </div>
        <div class="unit-arrow">→</div>
      </div>`;
    grid.appendChild(card);
  });
  document.getElementById('multiple-stats').style.display = 'block';
}

function renderMultipleUnidades(grupo) {
  const wrap = document.getElementById('multiple-wrap');
  const unidades = grupo.unidades.sort((a, b) => a.numero - b.numero);

  wrap.innerHTML = `
    <button class="back-btn" style="margin-bottom:16px" onclick="renderMultiple()">← Volver a materias</button>
    <div class="uvh-badge" style="margin-bottom:16px">${grupo.nombre}</div>
    <p style="color:var(--muted2);margin-bottom:16px">Elegí una unidad para generar preguntas con IA.</p>
    <div class="units-grid" id="multiple-units-grid"></div>
  `;

  const grid = document.getElementById('multiple-units-grid');
  unidades.forEach(u => {
    const card = document.createElement('div');
    card.className = 'unit-card';
    card.innerHTML = `
      <div class="unit-card-main" onclick="iniciarMultiple('${u.id}', ${u.numero}, '${u.nombre.replace(/'/g,"\\'")}', '${grupo.nombre.replace(/'/g,"\\'")}')">
        <div class="unit-num">${u.numero}</div>
        <div class="unit-info"><h4>${u.nombre}</h4></div>
        <div class="unit-arrow">→</div>
      </div>`;
    grid.appendChild(card);
  });
}

async function iniciarMultiple(unidadId, unidadNumero, unidadNombre, unidadGrupoNombre) {
  multipleUnidadActual = { id: unidadId, numero: unidadNumero, nombre: unidadNombre, grupo_nombre: unidadGrupoNombre };
  document.getElementById('multiple-stats').style.display = 'none';
  const wrap = document.getElementById('multiple-wrap');
  wrap.innerHTML = `
    <button class="back-btn" style="margin-bottom:16px" onclick="renderMultiple()">← Volver a unidades</button>
    <div style="color:var(--muted2);margin-top:16px">🤖 Generando preguntas para la Unidad ${unidadNumero}...</div>
  `;

  // Traer filminas de la unidad
  const { data: filminas } = await supabaseClient
    .from('filminas').select('titulo, contenido')
    .eq('unidad_id', unidadId);

  if (!filminas || !filminas.length) {
    wrap.innerHTML = `
      <button class="back-btn" style="margin-bottom:16px" onclick="renderMultiple()">← Volver</button>
      <p style="color:var(--muted2)">Esta unidad no tiene filminas cargadas todavía.</p>
    `;
    return;
  }

  // Armar contexto con el contenido de las filminas
  const filminasMezcladas = [...filminas].sort(() => Math.random() - 0.5);

const contexto = filminasMezcladas.map(f =>
    `${f.titulo}: ${f.contenido.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600)}`
  ).join('\n\n');

  const prompt = `Sos un profesor universitario de contabilidad. Basándote en el siguiente contenido de la Unidad "${unidadNombre}", generá 5 preguntas de opción múltiple.

Contenido:
${contexto}

Reglas ESTRICTAS:
- Leé con atención qué conceptos se INCLUYEN y cuáles se EXCLUYEN en cada definición
- Si la filmina tiene una sección "SE EXCLUYEN", esos ítems son respuestas INCORRECTAS, nunca correctas
- Cada pregunta debe tener exactamente 5 opciones (a, b, c, d, e)
- Solo una opción es correcta y debe ser completa y exacta según el contenido
- NUNCA dividas una definición correcta entre dos opciones
- Las opciones incorrectas deben cambiar conceptos clave (sumar en vez de restar, incluir lo que se excluye, cambiar términos)
- Preferí preguntas sobre conceptos puntuales y bien definidos en el texto
- Respondé ÚNICAMENTE con un array JSON válido, sin texto adicional, sin markdown

Formato exacto:
[
  {
    "pregunta": "¿Texto de la pregunta?",
    "opciones": ["opción a", "opción b", "opción c", "opción d", "opción e"],
    "correcta": 0
  }
]

El campo "correcta" es el índice (0-4) de la opción correcta.`;

  try {
    const response = await fetch(IA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: 2000 })
    });
    const data = await response.json();
    const texto = data.choices?.[0]?.message?.content || '';
    const clean = texto.replace(/```json|```/g, '').trim();
    multiplePreguntas = JSON.parse(clean);
    multipleRespondidas = {};
    renderPreguntasMultiple(unidadNumero, unidadNombre, unidadId);

  } catch (e) {
    wrap.innerHTML = `
      <button class="back-btn" style="margin-bottom:16px" onclick="renderMultiple()">← Volver</button>
      <p style="color:#f87171">Error al generar las preguntas. Intentá de nuevo.</p>
    `;
    console.error(e);
  }
}

function renderPreguntasMultiple(unidadNumero, unidadNombre, unidadId) {
  const wrap = document.getElementById('multiple-wrap');
  const letras = ['a', 'b', 'c', 'd', 'e'];

  let html = `
    <button class="back-btn" style="margin-bottom:16px" onclick="renderMultiple()">← Volver a unidades</button>
    <button class="ae-global-btn" style="margin-bottom:24px;margin-left:8px" onclick="iniciarMultiple('${unidadId}', ${unidadNumero}, '${unidadNombre.replace(/'/g,"\\'")}')">🔄 Generar nuevas preguntas</button>
    <div class="uvh-badge" style="margin-bottom:16px">Unidad ${unidadNumero} — ${unidadNombre}</div>
  `;

  multiplePreguntas.forEach((p, i) => {
    html += `
      <div class="mc-pregunta-card" id="mc-card-${i}">
        <div class="mc-pregunta-num">Pregunta ${i + 1}</div>
        <div class="mc-pregunta-texto">${p.pregunta}</div>
        <div class="mc-opciones" id="mc-opciones-${i}">
          ${p.opciones.map((op, j) => `
            <button class="mc-opcion" onclick="responderMultiple(${i}, ${j})">
              <span class="mc-letra">${letras[j]}</span>
              <span>${op}</span>
            </button>
          `).join('')}
        </div>
        <div class="mc-feedback" id="mc-feedback-${i}" style="display:none"></div>
      </div>
    `;
  });

  wrap.innerHTML = html;
}

function responderMultiple(preguntaIdx, opcionIdx) {
  if (multipleRespondidas[preguntaIdx] !== undefined) return; // ya respondida
  multipleRespondidas[preguntaIdx] = opcionIdx;

  const p = multiplePreguntas[preguntaIdx];
  const letras = ['a', 'b', 'c', 'd', 'e'];
  const botones = document.querySelectorAll(`#mc-opciones-${preguntaIdx} .mc-opcion`);
  const feedback = document.getElementById(`mc-feedback-${preguntaIdx}`);

  botones.forEach((btn, j) => {
    btn.disabled = true;
    if (j === p.correcta) btn.classList.add('mc-correcta');
    else if (j === opcionIdx) btn.classList.add('mc-incorrecta');
  });

  const esCorrecta = opcionIdx === p.correcta;
  feedback.style.display = 'block';
  feedback.innerHTML = esCorrecta
    ? `✅ <strong>¡Correcto!</strong>`
    : `❌ <strong>Incorrecto.</strong> La respuesta correcta era <strong>${letras[p.correcta]}) ${p.opciones[p.correcta]}</strong>`;
  feedback.className = `mc-feedback ${esCorrecta ? 'mc-feedback-ok' : 'mc-feedback-mal'}`;
  // Verificar si se respondieron todas
const totalPreguntas = multiplePreguntas.length;
const totalRespondidas = Object.keys(multipleRespondidas).length;
if (totalRespondidas === totalPreguntas) {
  const correctas = Object.entries(multipleRespondidas)
    .filter(([i, j]) => multiplePreguntas[i].correcta === j).length;
  guardarResultadoMultiple(correctas, totalPreguntas);
}
}

async function guardarResultadoMultiple(correctas, total) {
  const detalle = multiplePreguntas.map((p, i) => ({
    pregunta: p.pregunta,
    opciones: p.opciones,
    correcta: p.correcta,
    respondida: multipleRespondidas[i],
    ok: multipleRespondidas[i] === p.correcta
  }));

  const { error } = await supabaseClient.from('resultados_multiple').insert({
    user_id: currentUser.id,
    unidad_id: multipleUnidadActual.id,
    unidad_numero: multipleUnidadActual.numero,
    unidad_nombre: multipleUnidadActual.nombre,
    grupo_nombre: multipleUnidadActual.grupo_nombre,
    total,
    correctas,
    detalle
  });

  if (error) { console.error('Error al guardar:', error); return; }

  const statsEl = document.getElementById('multiple-stats');
  if (statsEl) cargarEstadisticasMultiple();
}

function getHistorialKey() {
  return currentUser ? `ae_historial_${currentUser.id}` : 'ae_historial_guest';
}

async function cargarEstadisticasMultiple() {
  const { data } = await supabaseClient
    .from('resultados_multiple')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  const statsEl = document.getElementById('multiple-stats');
  if (!statsEl) return;

  if (!data || !data.length) {
    statsEl.innerHTML = '<p style="color:var(--muted2);font-size:13px">Todavía no completaste ningún examen.</p>';
    return;
  }

  const totalSesiones = data.length;
  const totalCorrectas = data.reduce((a, r) => a + r.correctas, 0);
  const totalPreguntas = data.reduce((a, r) => a + r.total, 0);
  const porcentaje = Math.round((totalCorrectas / totalPreguntas) * 100);

  const historial = data.map((r, idx) => {
  const pct = Math.round((r.correctas / r.total) * 100);
  const fecha = new Date(r.created_at).toLocaleDateString('es-AR');
  const letras = ['a', 'b', 'c', 'd', 'e'];

  const detalleHtml = r.detalle ? r.detalle.map((d, qi) => `
    <div class="mc-det-item ${d.ok ? 'mc-det-ok' : 'mc-det-mal'}">
      <div class="mc-det-pregunta">${qi + 1}. ${d.pregunta}</div>
      <div class="mc-det-respuesta">
        ${d.ok
          ? `✅ Correcta: ${letras[d.correcta]}) ${d.opciones[d.correcta]}`
          : `❌ Respondiste: ${letras[d.respondida]}) ${d.opciones[d.respondida]}
             <br>✅ Correcta: ${letras[d.correcta]}) ${d.opciones[d.correcta]}`
        }
      </div>
    </div>
  `).join('') : '';

  return `
    <div class="mc-stat-row" onclick="toggleDetalleMultiple(${idx})" style="cursor:pointer">
      <span class="mc-stat-unidad">${r.grupo_nombre || ''} — Unidad ${r.unidad_numero || ''} — ${r.unidad_nombre}</span>
      <span class="mc-stat-score ${pct >= 60 ? 'ok' : 'mal'}">${r.correctas}/${r.total} (${pct}%)</span>
      <span class="mc-stat-fecha">${fecha}</span>
      <span id="mc-det-icon-${idx}">▶</span>
    </div>
    <div id="mc-detalle-${idx}" style="display:none; margin-bottom:12px; padding:8px; background:var(--dark3); border-radius:10px;">
      ${detalleHtml}
    </div>
  `;
}).join('');

  let allRows = data;

  statsEl.innerHTML = `
    <div class="mc-stat-resumen">
      <div class="mc-stat-chip">Sesiones: <strong>${totalSesiones}</strong></div>
      <div class="mc-stat-chip">Promedio: <strong>${porcentaje}%</strong></div>
      <div class="mc-stat-chip">Total respondidas: <strong>${totalPreguntas}</strong></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:14px">
      <input type="date" id="mc-filtro-fecha" style="background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;padding:6px 12px;color:var(--white);font-size:13px;outline:none;cursor:pointer;" onchange="filtrarHistorialMC()">
      <button onclick="document.getElementById('mc-filtro-fecha').value=''; filtrarHistorialMC()" style="background:transparent;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:4px 8px;">✕ Limpiar</button>
    </div>
    <div class="mc-stat-toggle-header" onclick="toggleMultipleHistorial()" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;margin-top:16px">
      <h4 style="font-size:14px;font-weight:600">📋 Historial</h4>
      <span id="multiple-historial-icon">▼</span>
    </div>
    <div id="multiple-historial-lista" style="margin-top:8px">${historial}</div>
  `;

  document.getElementById('mc-filtro-fecha')._allRows = data;
}

function toggleDetalleMultiple(idx) {
  const det = document.getElementById(`mc-detalle-${idx}`);
  const icon = document.getElementById(`mc-det-icon-${idx}`);
  const visible = det.style.display !== 'none';
  det.style.display = visible ? 'none' : 'block';
  icon.textContent = visible ? '▶' : '▼';
}

function toggleMultipleHistorial() {
  const lista = document.getElementById('multiple-historial-lista');
  const icon = document.getElementById('multiple-historial-icon');
  const visible = lista.style.display !== 'none';
  lista.style.display = visible ? 'none' : 'block';
  icon.textContent = visible ? '▶' : '▼';
}

function filtrarHistorialMC() {
  const fecha = document.getElementById('mc-filtro-fecha').value;
  const data = document.getElementById('mc-filtro-fecha')._allRows;
  const lista = document.getElementById('multiple-historial-lista');

  const filtrado = fecha
    ? data.filter(r => new Date(r.created_at).toLocaleDateString('en-CA') === fecha)
    : data;

  if (!filtrado.length) {
    lista.innerHTML = '<p style="color:var(--muted2);font-size:13px;padding:8px 0">No hay sesiones para esa fecha.</p>';
    return;
  }

  const letras = ['a','b','c','d','e'];
  lista.innerHTML = filtrado.map((r, idx) => {
    const pct = Math.round((r.correctas / r.total) * 100);
    const fechaStr = new Date(r.created_at).toLocaleDateString('es-AR');
    const detalleHtml = r.detalle ? r.detalle.map((d, qi) => `
      <div class="mc-det-item ${d.ok ? 'mc-det-ok' : 'mc-det-mal'}">
        <div class="mc-det-pregunta">${qi + 1}. ${d.pregunta}</div>
        <div class="mc-det-respuesta">
          ${d.ok
            ? `✅ Correcta: ${letras[d.correcta]}) ${d.opciones[d.correcta]}`
            : `❌ Respondiste: ${letras[d.respondida]}) ${d.opciones[d.respondida]}<br>✅ Correcta: ${letras[d.correcta]}) ${d.opciones[d.correcta]}`
          }
        </div>
      </div>
    `).join('') : '';
    return `
      <div class="mc-stat-row" onclick="toggleDetalleMultiple('f${idx}')" style="cursor:pointer">
        <span class="mc-stat-unidad">${r.grupo_nombre || ''} — Unidad ${r.unidad_numero || ''} — ${r.unidad_nombre}</span>
        <span class="mc-stat-score ${pct >= 60 ? 'ok' : 'mal'}">${r.correctas}/${r.total} (${pct}%)</span>
        <span class="mc-stat-fecha">${fechaStr}</span>
        <span id="mc-det-icon-f${idx}">▶</span>
      </div>
      <div id="mc-detalle-f${idx}" style="display:none;margin-bottom:12px;padding:8px;background:var(--dark3);border-radius:10px;">
        ${detalleHtml}
      </div>
    `;
  }).join('');
}

/* ════════════════════════════════════════════════
   DATOS — Reemplazá / ampliá con tu contenido real
   Estructura lista para migrar a Supabase
   ════════════════════════════════════════════════ */

const UNIDADES = [
  { id: 1,  nombre: "Conceptos contables básicos" },
  { id: 2,  nombre: "Caja y Bancos" },
  { id: 3,  nombre: "Inversiones" },
  { id: 4,  nombre: "Créditos" },
  { id: 5,  nombre: "Bienes de cambio" },
  { id: 6,  nombre: "Bienes de uso" },
  { id: 7,  nombre: "Activos Intangibles" },
  { id: 8,  nombre: "Pasivos. Deudas Laborales y Previsionales" },
  { id: 9,  nombre: "Patrimonio Neto" },
  { id: 10, nombre: "Tareas previas a la elaboración de los informes contables básicos" },
  { id: 11, nombre: "Informes contables" },
];

const TEORIA = [

  // ══════════════════════════════════════════
  // UNIDAD 1 — CONCEPTOS CONTABLES BÁSICOS
  // ══════════════════════════════════════════

  {
    id: "T0101",
    unidad: 1,
    titulo: "Modelos Contables — Concepto",
    keywords: ["modelo contable", "normas contables", "información útil", "realidad económica", "conjunto"],
    contenido: `
      <p><strong>Concepto:</strong> Es un conjunto de normas contables coordinadas que tienen por objetivo brindar información útil lo más aproximado a la realidad económica.</p>
    `
  },
  {
    id: "T0102",
    unidad: 1,
    titulo: "Elementos o Parámetros del Modelo Contable",
    keywords: ["elementos", "parámetros", "capital a mantener", "unidad de medida", "criterios de medición"],
    contenido: `
      <p>Los modelos contables se definen a partir de tres <strong>elementos o parámetros</strong>:</p>
      <ul>
        <li><strong>Capital a mantener</strong></li>
        <li><strong>Unidad de medida</strong></li>
        <li><strong>Criterios de medición</strong></li>
      </ul>
    `
  },
  {
    id: "T0103",
    unidad: 1,
    titulo: "Capital a Mantener — Físico y Financiero",
    keywords: ["capital a mantener", "capital físico", "capital financiero", "capacidad operativa", "socios", "dinero"],
    contenido: `
      <p><strong>Capital Físico:</strong> Es el capital necesario para mantener una capacidad operativa dada. Se mide en función de las unidades a producir y distribuir por cada período.</p>
      <p><strong>Capital Financiero:</strong> Es el capital aportado o comprometido a aportar por los socios. Se realiza su medición en dinero.</p>
    `
  },
  {
    id: "T0104",
    unidad: 1,
    titulo: "Unidad de Medida — Nominal y Homogénea",
    keywords: ["unidad de medida", "moneda nominal", "moneda homogénea", "inflación", "estabilidad", "estados contables", "ajuste"],
    contenido: `
      <p><strong>Nominal:</strong> Es la moneda nominal que se utiliza para emitir los estados contables en un contexto de estabilidad (sin ajustar por inflación).</p>
      <p><strong>Homogénea:</strong> Es la moneda de cierre que se utiliza para emitir los estados contables en un contexto de inflación.</p>
    `
  },
  {
    id: "T0105",
    unidad: 1,
    titulo: "Inflación, Deflación y Valores Ajustados",
    keywords: ["inflación", "deflación", "valores ajustados", "poder adquisitivo", "nivel general de precios", "ajuste por inflación"],
    contenido: `
      <p><strong>Inflación:</strong> Es la suba sostenida y generalizada en el nivel general de precios que provoca pérdida en el poder adquisitivo de la moneda.</p>
      <p><strong>Deflación:</strong> Es la disminución en el nivel general de precios que provoca aumento en el poder adquisitivo de la moneda.</p>
      <p><strong>Valores Ajustados:</strong> Son los que surgen de aplicar el ajuste por inflación.</p>
    `
  },
  {
    id: "T0106",
    unidad: 1,
    titulo: "Criterios de Medición — Valores Históricos y Corrientes",
    keywords: ["criterios de medición", "valores históricos", "valores corrientes", "momento de incorporación", "patrimonio", "medición"],
    contenido: `
      <p><strong>Valores Históricos:</strong> Valores expresados al momento de incorporación al patrimonio.</p>
      <p><strong>Valores Corrientes:</strong> Valores expresados al momento al que se refiere la medición.</p>
    `
  },
  {
    id: "T0107",
    unidad: 1,
    titulo: "Valores Históricos — Costo de Adquisición",
    keywords: ["valores históricos", "costo de adquisición", "precio de adquisición", "descuentos", "gastos necesarios", "fletes", "seguros", "costos directos", "costos indirectos"],
    contenido: `
      <p><strong>Valores Históricos:</strong> Son los expresados al momento de la incorporación al patrimonio del ente (costo de adquisición, producción, construcción y desarrollo).</p>
      <p><strong>Costo de Adquisición</strong> — es la suma de los siguientes componentes:</p>
      <ul>
        <li>Precio de adquisición</li>
        <li>Descuentos comerciales y rebajas (se restan)</li>
        <li>Gastos necesarios (honorarios, aranceles de importación e impuestos no recuperables)</li>
        <li>Costos directos de servicios internos y externos (fletes, seguros, preparación del emplazamiento, costo de entrega, manipulación inicial e instalación)</li>
        <li>Costos indirectos asignados</li>
      </ul>
    `
  },
  {
    id: "T0108",
    unidad: 1,
    titulo: "Costo de Producción o Construcción",
    keywords: ["costo de producción", "costo de construcción", "materiales", "insumos", "mano de obra", "depreciaciones", "ociosidad", "improductividades"],
    contenido: `
      <p><strong>Integrado por:</strong></p>
      <ul>
        <li>Materiales e insumos</li>
        <li>Costos de conversión fijos y variables (mano de obra, servicios, depreciaciones y otras cargas)</li>
        <li>Costos directos de puesta en marcha y/o prueba (destinadas a evaluar si el activo está en condiciones de utilizarse)</li>
        <li>Ingresos por ventas de productos con valor comercial que se obtengan durante ese período</li>
        <li>Costos financieros de corresponder</li>
      </ul>
      <p><strong>Excluye:</strong> improductividades físicas o ineficiencias en el uso de los factores, y ociosidad.</p>
    `
  },
  {
    id: "T0109",
    unidad: 1,
    titulo: "Costo de Desarrollo de un Activo Intangible",
    keywords: ["costo de desarrollo", "activo intangible", "patentes", "licencias", "amortización", "honorarios", "derechos legales"],
    contenido: `
      <p><strong>Integrado por:</strong></p>
      <ul>
        <li>Materiales e insumos</li>
        <li>Costos de conversión fijos y variables (mano de obra, servicios, depreciaciones y otras cargas)</li>
        <li>Gastos y honorarios necesarios para registrar derechos legales</li>
        <li>Amortización de patentes y licencias utilizadas para generar el intangible</li>
        <li>Costos financieros de corresponder</li>
      </ul>
    `
  },
  {
    id: "T0110",
    unidad: 1,
    titulo: "Valores Corrientes — Costo de Reposición y de Reproducción",
    keywords: ["valores corrientes", "costo de reposición", "costo de reproducción", "costo de reconstrucción", "VNR", "valor razonable", "valor actual", "momento de medición"],
    contenido: `
      <p><strong>Valores Corrientes:</strong> Son los expresados al momento de la medición (costo de reposición, reproducción, reconstrucción, valor neto de realización, valor razonable, valor actual).</p>
      <p><strong>Costo de Reposición:</strong> Es el costo que tiene un bien al momento de la medición que surge de acumular cada uno de los componentes del costo de adquisición en términos de su reposición.</p>
      <p><strong>Costo de Reproducción y Reconstrucción:</strong> Es el costo que tiene un bien al momento de la medición que surge de acumular cada uno de los componentes del costo de producción y construcción en términos de su reposición.</p>
    `
  },
  {
    id: "T0111",
    unidad: 1,
    titulo: "Costo de Reposición — Fuentes de Precios",
    keywords: ["costo de reposición", "precios", "proveedores", "cotizaciones", "listas de precios", "órdenes de compra", "mercados", "volúmenes normales"],
    contenido: `
      <p>La medición se basará en precios correspondientes a:</p>
      <ul>
        <li>Volúmenes normales o habituales de adquisición, producción o construcción (operaciones repetitivas)</li>
        <li>Volúmenes similares a los adquiridos, producidos o construidos (demás casos)</li>
      </ul>
      <p>Los precios se obtendrán de:</p>
      <ul>
        <li>Cotizaciones o listas de precios de proveedores</li>
        <li>Costos de adquisición, producción o construcción reales</li>
        <li>Órdenes de compras colocadas y pendientes de recepción</li>
        <li>Cotizaciones que resulten de la oferta y demanda en mercados públicos o privados publicadas en boletines, periódicos, revistas o medios digitales</li>
      </ul>
    `
  },
  {
    id: "T0112",
    unidad: 1,
    titulo: "Valor Razonable",
    keywords: ["valor razonable", "mercado principal", "técnicas de valuación", "enfoque de mercado", "enfoque de ingresos", "enfoque del costo", "flujos de efectivo"],
    contenido: `
      <p><strong>Valor Razonable:</strong> Son los precios que en la fecha de la medición:</p>
      <ul>
        <li>Sean observables en el mercado principal o, sino existiera, en el mercado más ventajoso; o estimados mediante técnicas de valuación</li>
        <li>Consideren las características y condición del elemento (activo, pasivo o patrimonio neto) sujeto a medición</li>
      </ul>
      <p><strong>Enfoques para la técnica de valuación:</strong></p>
      <ul>
        <li><strong>Enfoque de mercado:</strong> Precios de activos o pasivos similares o comparables ajustados en función de las características del activo o pasivo a medir</li>
        <li><strong>Enfoque de ingresos:</strong> Valor descontado de los flujos de efectivos netos que puedan esperarse de los activos o pasivos a medir</li>
        <li><strong>Enfoque del costo:</strong> Costo que requeriría la adquisición, producción o construcción de un activo similar que reemplace la capacidad de servicio del activo a medir</li>
      </ul>
    `
  },
  {
    id: "T0113",
    unidad: 1,
    titulo: "Valor Neto de Realización (V.N.R.)",
    keywords: ["VNR", "valor neto de realización", "valor razonable", "ingresos adicionales", "reembolso de exportación", "costos directos de venta", "comisiones", "ingresos brutos"],
    contenido: `
      <p><strong>V.N.R.:</strong> Es el valor del activo que surge de considerar a la fecha de la medición:</p>
      <ul>
        <li>Valor razonable del activo</li>
        <li>(+) Ingresos adicionales no provenientes de la financiación (ej. reembolso de exportación)</li>
        <li>(−) Costos directos de venta (ej. comisiones, impuesto a los ingresos brutos y similares)</li>
      </ul>
    `
  },
  {
    id: "T0114",
    unidad: 1,
    titulo: "Valor Actual (V.A.) y Valor de Uso (V.U.)",
    keywords: ["valor actual", "VA", "valor de uso", "VU", "flujos de efectivo", "tasa de descuento", "tasa de interés efectiva", "ingresos", "egresos"],
    contenido: `
      <p><strong>Valor Actual (V.A.):</strong> Es el valor de los flujos de efectivos netos (ingresos y egresos) descontados a la tasa de interés efectiva del activo/pasivo original sujeto a medición.</p>
      <p><strong>Valor de Uso (V.U.):</strong> Es el valor del activo o grupo de activos que surge de:</p>
      <ul>
        <li>a) Estimar los ingresos y egresos netos de efectivo derivados de su uso continuado y su disposición o realización final, y</li>
        <li>b) Aplicar una tasa de descuento adecuada.</li>
      </ul>
    `
  },
  {
    id: "T0115",
    unidad: 1,
    titulo: "Mediciones en Moneda Extranjera y Diferencias de Cambio",
    keywords: ["moneda extranjera", "tipo de cambio", "diferencias de cambio", "estados contables", "valores corrientes", "ingresos financieros", "transacciones"],
    contenido: `
      <p>Para medir en moneda argentina transacciones y saldos expresados en moneda extranjera, se empleará el tipo de cambio correspondiente a:</p>
      <ul>
        <li><strong>a) La fecha de los estados contables</strong> cuando mida: valores corrientes expresados en moneda extranjera, o efectivo en moneda extranjera y derechos/obligaciones en moneda extranjera.</li>
        <li><strong>b) Las fechas de cada transacción</strong> (compras, ventas, pagos, cobros u otras transacciones).</li>
      </ul>
      <p><strong>Diferencias de Cambio:</strong> Las diferencias surgidas de la medición posterior se contabilizarán como ingresos financieros o costos, según corresponda.</p>
    `
  },
  {
    id: "T0116",
    unidad: 1,
    titulo: "Valor Recuperable de los Activos o Valor Límite",
    keywords: ["valor recuperable", "valor límite", "VNR", "VU", "valor de uso", "valor neto de realización", "mayor valor"],
    contenido: `
      <p><strong>Valor Recuperable o Valor Límite:</strong> Es el mayor valor entre:</p>
      <ul>
        <li><strong>V.N.R.</strong> (Valor Neto de Realización)</li>
        <li><strong>V.U.</strong> (Valor de Uso)</li>
      </ul>
      <p>Ningún activo debe medirse por encima de su valor recuperable.</p>
    `
  },
  {
    id: "T0117",
    unidad: 1,
    titulo: "Tabla de Modelos Contables",
    keywords: ["modelos contables", "contabilidad tradicional", "contabilidad con ajuste", "valores corrientes", "tabla", "combinaciones", "capital físico", "capital financiero", "moneda nominal", "moneda homogénea"],
    contenido: `
      <p>Combinaciones posibles de los parámetros del modelo contable:</p>
      <ul>
        <li><strong>Contabilidad Tradicional:</strong> Capital financiero · Moneda nominal · Valores históricos</li>
        <li><strong>Contabilidad Tradicional con Ajuste:</strong> Capital financiero · Moneda homogénea · Valores históricos</li>
        <li><strong>Contabilidad a Valores Corrientes:</strong> Capital financiero · Moneda nominal · Valores corrientes</li>
        <li><strong>Contabilidad a Valores Corrientes con Ajuste:</strong> Capital financiero · Moneda homogénea · Valores históricos y corrientes</li>
      </ul>
    `
  },
  {
    id: "T0118",
    unidad: 1,
    titulo: "Modelo Tradicional con Ajuste — Metodología",
    keywords: ["modelo tradicional con ajuste", "ajuste por inflación", "RECPAM", "partidas monetarias", "partidas no monetarias", "coeficiente de reexpresión", "índice de cierre", "índice de origen", "valores ajustados"],
    contenido: `
      <p>La inflación <strong>afecta las partidas monetarias o expuestas a la inflación</strong>.</p>
      <p>Se ajusta por las <strong>partidas no monetarias o no expuestas</strong> a la inflación.</p>
      <p><strong>Fórmula:</strong> Partida no monetaria × (Índice de Cierre / Índice de Origen) = Valores Ajustados</p>
      <p><em>Ejemplo:</em> $5.000 × 2,00 = $10.000 → Ajuste: $5.000</p>
      <p><strong>Asiento:</strong> MERCADERÍAS (D) $5.000 / A R.E.C.P.A.M. (H) $5.000</p>
    `
  },
  {
    id: "T0119",
    unidad: 1,
    titulo: "Modelo a Valores Corrientes",
    keywords: ["modelo valores corrientes", "valor de mercado", "resultado de tenencia", "bienes de cambio", "partidas no monetarias"],
    contenido: `
      <p>En el modelo a valores corrientes, las partidas no monetarias se actualizan al <strong>valor de mercado</strong>.</p>
      <p>La diferencia entre el valor de mercado y el valor de costo genera un <strong>Resultado de Tenencia</strong>.</p>
      <p><em>Ejemplo:</em> Partida no monetaria $5.000 → Valor de mercado $12.000 → Resultado de tenencia $7.000</p>
      <p><strong>Asiento:</strong> MERCADERÍAS (D) $7.000 / A RES. DE TENENCIA BIENES DE CAMBIO (H) $7.000</p>
    `
  },
  {
    id: "T0120",
    unidad: 1,
    titulo: "Modelo a Valores Corrientes Ajustados",
    keywords: ["modelo valores corrientes ajustados", "RECPAM", "resultado de tenencia", "coeficiente de reexpresión", "ajuste", "valores ajustados", "valor de mercado"],
    contenido: `
      <p>Combina el ajuste por inflación con la actualización a valores corrientes.</p>
      <p><em>Ejemplo:</em> Partida no monetaria $5.000 × Coeficiente 2,00 = Valores ajustados $10.000 (Ajuste: $5.000)</p>
      <p>Valor de mercado: $12.000 → Resultado de tenencia: $2.000 (diferencia entre valor de mercado y valor ajustado)</p>
      <p><strong>Asiento:</strong> MERCADERÍAS (D) $7.000 / A R.E.C.P.A.M (H) $5.000 / A RES. DE TENENCIA BIENES DE CAMBIO (H) $2.000</p>
    `
  },
  {
    id: "T0121",
    unidad: 1,
    titulo: "Resultados Transaccionales y No Transaccionales",
    keywords: ["resultados transaccionales", "resultados no transaccionales", "intercambio", "terceros", "ventas", "servicios", "acrecentamientos", "valorizaciones", "desvalorizaciones"],
    contenido: `
      <p><strong>Resultados Transaccionales o de Intercambio:</strong> Son los generados por la actividad de la empresa, por las transacciones económicas que realiza con terceros. Ej: venta de bienes, prestación de servicios, construcción, fabricación o desarrollo de activos.</p>
      <p><strong>Resultados No Transaccionales:</strong> Son los generados por acontecimientos internos o externos a la entidad, tales como:</p>
      <ul>
        <li>Acrecentamientos</li>
        <li>Valorizaciones</li>
        <li>Desvalorizaciones</li>
        <li>Inflación</li>
      </ul>
    `
  },
  {
    id: "T0122",
    unidad: 1,
    titulo: "Resultados Inflacionarios y Resultados de Tenencia",
    keywords: ["resultados inflacionarios", "resultados de tenencia", "partidas monetarias", "variaciones de precios", "activos", "pasivos", "moneda extranjera", "mediciones contables"],
    contenido: `
      <p><strong>Resultados Inflacionarios:</strong> Son los generados por las variaciones de los precios de determinados tipos de bienes llamados "monetarios o expuestos".</p>
      <p><strong>Resultados de Tenencia:</strong> Son las diferencias entre las sucesivas mediciones contables de un mismo activo o pasivo atribuibles a causas distintas a algún cambio de condición. Las causas habituales son las modificaciones de precios de los activos y pasivos (incluyendo moneda extranjera).</p>
    `
  },
  {
    id: "T0123",
    unidad: 1,
    titulo: "Modelo Contable RT 16 versus RT 59",
    keywords: ["RT 16", "RT 59", "resolución técnica", "capital financiero", "moneda homogénea", "costo histórico", "VNR", "valor razonable", "valor actual", "componentes financieros implícitos", "hechos contingentes"],
    contenido: `
      <p>Comparación entre los dos marcos normativos:</p>
      <ul>
        <li><strong>Capital a mantener:</strong> Ambas → Capital financiero</li>
        <li><strong>Unidad de medida RT 16:</strong> Moneda homogénea (estabilidad → nominal)</li>
        <li><strong>Unidad de medida RT 59:</strong> Sin ajuste en estabilidad · Moneda de cierre en inflación (tasa acumulada ≥ 100% en 3 años, párrafos 97-98)</li>
        <li><strong>Criterios RT 16 (activos):</strong> Costo histórico · Costo de reposición · V.N.R. · Valor razonable · Valor actual · Participación</li>
        <li><strong>Criterios RT 59:</strong> Costos (adquisición, producción, desarrollo) · Valores corrientes (reposición, valor razonable con VNR) · Mediciones en moneda extranjera · Componentes financieros implícitos · Hechos contingentes · Valor recuperable</li>
      </ul>
    `
  },
  {
    id: "T0124",
    unidad: 1,
    titulo: "Reconocimiento de las Variaciones Patrimoniales",
    keywords: ["variaciones patrimoniales", "ingresos", "gastos", "costos", "ganancias", "pérdidas", "devengamiento", "reconocimiento"],
    contenido: `
      <p>Las variaciones patrimoniales se reconocen por <strong>devengamiento</strong> y comprenden:</p>
      <ul>
        <li><strong>Ingresos</strong></li>
        <li><strong>Gastos</strong></li>
        <li><strong>Costos</strong></li>
        <li><strong>Ganancias</strong></li>
        <li><strong>Pérdidas</strong></li>
      </ul>
      <p>El criterio de devengamiento implica que los efectos de las transacciones y hechos se reconocen cuando ocurren, independientemente de cuándo se cobren o paguen.</p>
    `
  },

  // ══════════════════════════════════════════
  // UNIDAD 2 — CAJA Y BANCOS
  // ══════════════════════════════════════════

  {
    id: "T0201",
    unidad: 2,
    titulo: "Caja y Bancos — Concepto",
    keywords: ["caja y bancos", "concepto", "dinero en efectivo", "cuentas bancarias", "liquidez", "medio de pago", "otros valores"],
    contenido: `
      <p><strong>Caja y Bancos</strong> incluye:</p>
      <ul>
        <li>Dinero en efectivo (Caja — país y exterior)</li>
        <li>Cuentas bancarias (país y exterior)</li>
        <li>Otros valores con similar liquidez</li>
      </ul>
      <p>Requisito fundamental: <strong>capacidad para actuar como medio de pago</strong>.</p>
    `
  },
  {
    id: "T0202",
    unidad: 2,
    titulo: "Características de Caja y Bancos",
    keywords: ["características", "liquidez inmediata", "poder cancelatorio", "activo financiero", "corriente", "inmaterial", "rápida movilidad"],
    contenido: `
      <p>Caja y Bancos es un <strong>Activo</strong> con las siguientes características:</p>
      <ul>
        <li>Liquidez inmediata</li>
        <li>Medio de pago</li>
        <li>Poder cancelatorio</li>
        <li>Financiero</li>
        <li>Corriente</li>
        <li>Inmaterial</li>
        <li>Rápida movilidad</li>
      </ul>
    `
  },
  {
    id: "T0203",
    unidad: 2,
    titulo: "Componentes de Caja y Bancos",
    keywords: ["componentes", "efectivo moneda nacional", "efectivo moneda extranjera", "cuentas corrientes bancarias", "cheques corrientes", "giros postales", "giros bancarios"],
    contenido: `
      <p>Los componentes de Caja y Bancos son:</p>
      <ul>
        <li>Efectivo moneda nacional</li>
        <li>Efectivo moneda extranjera</li>
        <li>Saldos en cuentas corrientes bancarias en pesos y en monedas extranjeras</li>
        <li>Cheques corrientes</li>
        <li>Giros postales y bancarios a la vista</li>
      </ul>
    `
  },
  {
    id: "T0204",
    unidad: 2,
    titulo: "Lo que NO se incluye en Caja y Bancos",
    keywords: ["no se incluye", "depósitos a plazo fijo", "cheques de pago diferido", "anticipos de sueldos", "anticipos de viáticos", "exclusiones"],
    contenido: `
      <p><strong>NO se incluye</strong> en Caja y Bancos:</p>
      <ul>
        <li>Depósitos a plazo fijo</li>
        <li>Cheques de pago diferido</li>
        <li>Anticipos de sueldos al personal</li>
        <li>Anticipos de viáticos</li>
      </ul>
    `
  },
  {
    id: "T0205",
    unidad: 2,
    titulo: "Reconocimiento y Medición Inicial y Posterior",
    keywords: ["reconocimiento", "medición inicial", "medición posterior", "importe nominal", "activo", "definición"],
    contenido: `
      <p><strong>Reconocimiento:</strong> Se reconoce cuando se cumple la definición de Activo <strong>y</strong> de Caja y Bancos.</p>
      <p><strong>Medición inicial y posterior:</strong> Por su <strong>importe Nominal</strong>.</p>
    `
  },
  {
    id: "T0206",
    unidad: 2,
    titulo: "Principales Operaciones de Caja y Bancos",
    keywords: ["operaciones", "ingresos", "egresos", "aportes", "retiros", "ventas", "compras", "cobranzas", "pagos", "préstamos", "devoluciones"],
    contenido: `
      <p><strong>Ingresos:</strong> Aportes, Ventas, Cobranzas, Préstamos.</p>
      <p><strong>Egresos:</strong> Retiros, Compras, Pagos, Devoluciones.</p>
    `
  },
  {
    id: "T0207",
    unidad: 2,
    titulo: "Cuentas del Rubro Caja y Bancos",
    keywords: ["cuentas", "caja", "fondo fijo", "recaudaciones a depositar", "valores a depositar", "moneda extranjera", "banco cuenta corriente", "valores a acreditar", "giros postales", "valores al cobro"],
    contenido: `
      <p>Las principales cuentas del rubro son:</p>
      <ul>
        <li>Caja</li>
        <li>Fondo Fijo</li>
        <li>Recaudaciones a Depositar</li>
        <li>Moneda Extranjera</li>
        <li>Valores a Depositar</li>
        <li>Banco XX Cuenta Corriente en Pesos</li>
        <li>Banco XX Cuenta Corriente en Moneda Extranjera</li>
        <li>Banco XX Valores a Acreditar</li>
        <li>Giros Postales a la Vista / Giros Bancarios a la Vista</li>
        <li>Banco XX Valores al Cobro</li>
      </ul>
    `
  },
  {
    id: "T0208",
    unidad: 2,
    titulo: "Planilla de Caja — Concepto y Estructura",
    imagen: "data:image/png;base64,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",
    keywords: ["planilla de caja", "comprobante interno", "arqueo", "saldo anterior", "ingresos del día", "egresos del día", "saldo del día", "firma cajero", "movimientos"],
    contenido: `
      <p><strong>Concepto:</strong> Es un comprobante de uso interno que sirve para controlar los movimientos de caja y su composición, facilitando el arqueo.</p>
      <p><strong>Estructura:</strong></p>
      <ul>
        <li>Saldo Anterior</li>
        <li>Ingresos del Día</li>
        <li>Egresos del Día</li>
        <li>Saldo del Día</li>
        <li>Firma del Cajero</li>
      </ul>
    `
  },
  {
    id: "T0209",
    unidad: 2,
    titulo: "Arqueo de Caja — Concepto y Finalidad",
    keywords: ["arqueo de caja", "recuento físico", "dinero en efectivo", "cheques", "otros valores", "existencia fondos", "saldo cuenta caja", "control", "verificar"],
    contenido: `
      <p><strong>Concepto:</strong> Es el recuento físico de dinero en efectivo, cheques y otros valores.</p>
      <p><strong>Finalidad — Verificar:</strong></p>
      <ul>
        <li>La existencia de los fondos</li>
        <li>Que los valores arqueados coincidan con el saldo de la cuenta Caja</li>
      </ul>
    `
  },
  {
    id: "T0210",
    unidad: 2,
    titulo: "Arqueo de Caja — Pasos y Oportunidad",
    keywords: ["arqueo", "pasos", "mayor cuenta caja", "documentación respaldatoria", "diferencias", "ajustes contables", "diariamente", "oportunidad"],
    contenido: `
      <p>Si <strong>valores arqueados ≠ saldo cuenta Caja</strong>:</p>
      <ul>
        <li><strong>Paso 1:</strong> Controlar los movimientos del Mayor de la cuenta Caja con la documentación respaldatoria del arqueo.</li>
        <li><strong>Paso 2:</strong> Detectar diferencias y realizar los ajustes contables correspondientes.</li>
      </ul>
      <p><strong>Oportunidad:</strong> Diariamente es lo conveniente.</p>
    `
  },
  {
    id: "T0211",
    unidad: 2,
    titulo: "Ejemplo de Arqueo de Caja",
    imagen: "data:image/png;base64,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fC/kFHWBnvhfyCiimILnc0tr3jhc7WDrAz3wv5BR1gZ74X8goopiC53NLa944XO1g6wM98L+QUdYGe+F/IKKKYgudzS2veOFztYOsDPfC/kFHWBnvhfyCiimILnc0tr3jhc7WDrAz3wv5BR1gZ74X8goopiC53NLa944XO1g6wM98L+QUdYGe+F/IKKKYgudzS2veOFztYOsDPfC/kFHWBnvhfyCiimILnc0tr3jhc7WDrAz3wv5BR1gZ74X8goopiC53NLa944XO1g6wM98L+QUdYGe+F/IKKKYgudzS2veOFztYOsDPfC/kFHWBnvhfyCiimILnc0tr3jhc7WDrAz3wv5BR1gZ74X8goopiC53NLa944XO1g6wM98L+QUdYGe+F/IKKKYgudzS2veOFztYOsDPfC/kFHWBnvhfyCiimILnc0tr3jhc7WDrAz3wv5BR1gZ74X8goopiC53NLa944XO1g6wM98L+QUdYGe+F/IKKKYgudzS2veOFztYOsDPfC/kFHWBnvhfyCiimILnc0tr3jhc7WDrAz3wv5BR1gZ74X8goopiC53NLa944XO1g6wM98L+QUdYGe+F/IKKKYgudzS2veOFztYOsDPfC/kFHWBnvhfyCiimILnc0tr3jhc7WDrAz3wv5BR1gZ74X8goopiC53NLa944XO1g6wM98L+QUdYGe+F/IKKKYgudzS2veOFztYOsDPfC/kFHWBnvhfyCiimILnc0tr3jhc7WDrAz3wv5BR1gZ74X8goopiC53NLa944XO1g6wM98L+QUdYGe+F/IKKKYgudzS2veOFztYyxLM1HkoeS+slB1AIFbXcffooqdZbFIskLhkw0TMMyZFMdYnU//Z",
    keywords: ["ejemplo arqueo", "planilla de arqueo", "billetes", "moneda extranjera", "dólar", "cheque corriente", "viáticos", "tipo de cambio", "sobrante", "faltante"],
    contenido: `
      <p><strong>Ejemplo:</strong> Planilla de Arqueo al 31/3/2025</p>
      <ul>
        <li>Total dinero en efectivo: $492.500,00</li>
        <li>Billete dólar U$S 100 al TC comprador $1.053,50 = $105.350,00</li>
        <li>Recibo N° 245 (Viáticos): $24.500,00</li>
        <li>Factura C-1-347 (Fotocopias): $12.500,00</li>
        <li>Cheque corriente recibido de cliente: $55.000,00</li>
        <li><strong>Total arqueado: $689.850,00</strong></li>
      </ul>
      <p>Saldo contable: $491.500,00 → <strong>Sobrante: $1.000,00</strong></p>
    `
  },
  {
    id: "T0212",
    unidad: 2,
    titulo: "Registración Contable del Arqueo",
    imagen: "data:image/png;base64,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",
    keywords: ["registración contable", "arqueo", "moneda extranjera", "viáticos", "gastos fotocopias", "valores a depositar", "diferencia de caja", "sobrante", "variación patrimonial"],
    contenido: `
      <p><strong>Por arqueo de fondos:</strong><br>
      Moneda Extranjera (D) $105.350 + Viáticos y Movilidad (D) $24.500 + Gastos Fotocopias (D) $12.500 + Valores a Depositar (D) $55.000 / <strong>A Caja</strong> (H) $197.350</p>
      <p><strong>Por ajuste de sobrante (Var.Pat.Mod.Simple Positiva):</strong><br>
      Caja (D) $1.000 / <strong>A Diferencia de Caja</strong> (H) $1.000</p>
    `
  },
  {
    id: "T0213",
    unidad: 2,
    titulo: "Fondo Fijo — Concepto y Ejemplos",
    keywords: ["fondo fijo", "pagos menores", "efectivo", "fotocopias", "artículos de limpieza", "correspondencia", "remises", "factura de servicios", "caja chica"],
    contenido: `
      <p><strong>Concepto:</strong> Es un sistema que permite efectuar pagos menores en efectivo.</p>
      <p><strong>Ejemplos de pagos menores:</strong></p>
      <ul>
        <li>Fotocopias</li>
        <li>Artículos de limpieza</li>
        <li>Correspondencia</li>
        <li>Remises</li>
        <li>Factura de servicios</li>
      </ul>
    `
  },
  {
    id: "T0214",
    unidad: 2,
    titulo: "Fondo Fijo — Momentos y Cambios en el Monto",
    keywords: ["fondo fijo", "constitución", "utilización", "rendición", "reposición", "aumento", "reducción", "momentos"],
    contenido: `
      <p><strong>Momentos del Fondo Fijo:</strong> Constitución · Utilización · Rendición · Reposición</p>
      <p><strong>Cambios en el monto:</strong> Aumento · Reducción</p>
    `
  },
  {
    id: "T0214B",
    unidad: 2,
    titulo: "Planilla de Fondo Fijo",
    imagen: "data:image/png;base64,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",
    keywords: ["planilla fondo fijo", "rendición", "fondo fijo", "formulario"],
    contenido: ``
  },
  {
    id: "T0215",
    unidad: 2,
    titulo: "Cuenta Corriente Bancaria — Concepto y Operaciones",
    keywords: ["cuenta corriente bancaria", "fondos depositados", "disponibilidad", "depósitos", "extracciones", "cheques", "transferencias", "cajero automático", "débitos automáticos"],
    contenido: `
      <p><strong>Concepto:</strong> Está constituida por fondos depositados en un banco de los que se puede disponer libremente, mediante los medios habilitados para tal fin.</p>
      <p><strong>Depósitos:</strong> Efectivo, valores y transferencias.</p>
      <p><strong>Extracciones:</strong> Cheques, transferencias, por cajero automático y débitos automáticos.</p>
    `
  },
  {
    id: "T0216",
    unidad: 2,
    titulo: "Movimientos en la Cuenta Corriente Bancaria",
    keywords: ["movimientos", "débitos bancarios", "créditos bancarios", "gastos bancarios", "comisiones", "intereses descubierto", "IVA", "impuesto débitos créditos", "ingresos brutos", "depósitos bancarios"],
    contenido: `
      <p><strong>Débitos (banco descuenta de la cuenta):</strong></p>
      <ul>
        <li>Gastos bancarios (chequeras, boletas de depósito, mantenimiento)</li>
        <li>Comisiones bancarias (gestión de cobro)</li>
        <li>Intereses por giros en descubierto</li>
        <li>Impuestos (IVA, Imp. Déb. y Créd., Ret. Imp. Ing. Brutos)</li>
      </ul>
      <p><strong>Créditos (banco acredita en la cuenta):</strong></p>
      <ul>
        <li>Depósitos bancarios propios o de terceros</li>
      </ul>
      <p><em>Depósitos = Débito empresa / Crédito banco · Extracciones = Crédito empresa / Débito banco</em></p>
    `
  },
  {
    id: "T0217",
    unidad: 2,
    titulo: "Extracto Bancario",
    keywords: ["extracto bancario", "resumen bancario", "saldo inicial", "saldo final", "créditos", "débitos", "Ley 25413", "impuesto débitos créditos", "retención ingresos brutos", "cheque rechazado"],
    contenido: `
      <p>El extracto bancario es el resumen que emite el banco con todos los movimientos del período. Estructura: Fecha · Descripción · Débitos · Créditos · Saldo.</p>
      <p><strong>Débitos frecuentes:</strong> Ley 25413 (Imp. Débitos y Créditos), comisiones, gastos de chequeras, retención Ingresos Brutos, retención AFIP, cheques rechazados.</p>
      <p><strong>Créditos frecuentes:</strong> Depósitos 24/48 hs., transferencias recibidas.</p>
    `
  },
  {
    id: "T0218",
    unidad: 2,
    titulo: "Valores a Acreditar",
    keywords: ["valores a acreditar", "plazo de acreditación", "plaza", "clearing bancario", "cheques depositados", "disponibilidad fondos", "pendientes de acreditación"],
    contenido: `
      <p>Los bancos tienen establecido el plazo de acreditación para cada plaza del país, ya que la disponibilidad de los fondos <strong>no es igual para todos los cheques depositados</strong>.</p>
      <p>Debe usarse una cuenta que refleje los montos pendientes de acreditación.</p>
      <p><strong>Asiento:</strong> Banco XX – Valores a Acreditar (D) / A Valores a Depositar (H)</p>
    `
  },
  {
    id: "T0219",
    unidad: 2,
    titulo: "Valores al Cobro",
    keywords: ["valores al cobro", "clearing bancario", "plaza", "comisión", "gestión de cobro", "cheque del interior", "acreditación"],
    contenido: `
      <p>Se trata de un cheque sobre una plaza en la que <strong>no es posible el depósito</strong> para su acreditación porque no se encuentra disponible el clearing bancario.</p>
      <p>Se encarga a un banco que haga la cobranza cobrando una comisión que se deduce de los fondos.</p>
      <p><strong>Asiento:</strong> Valores al Cobro (D) / A Valores a Depositar (H)</p>
    `
  },
  {
    id: "T0220",
    unidad: 2,
    titulo: "Transferencias Bancarias",
    keywords: ["transferencias bancarias", "envío de dinero", "cuentas virtuales", "home banking", "e-banking", "cajero automático", "presencial", "CBU", "CVU"],
    contenido: `
      <p><strong>Concepto:</strong> Es el envío de dinero entre dos cuentas (propias o ajenas, cuentas virtuales y cuenta bancaria).</p>
      <p><strong>Se puede realizar:</strong> de manera presencial en el banco · por cajero automático · de manera virtual (Home Banking / E-Banking).</p>
    `
  },
  {
    id: "T0221",
    unidad: 2,
    titulo: "Transferencias entre Cuentas Bancarias",
    imagen: "data:image/png;base64,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c6rDgxe847fwVsYtQPIexd86NcDeP7i/8t3vZkL3Ojx/cX/lu97Mhe508WL3nb2/gnhah0rvnRrgbx/cX/lu97Mhe50eP7i/8t3vZkL3Onixe87e38E8LUOld86NcDeP7i/8t3vZkL3Ojx/cX/lu97Mhe508WL3nb2/gnhah0rvnRrgbx/cX/lu97Mhe50eP7i/8t3vZkL3Onixe87e38E8LUOld86NcDeP7i/8ALd72ZC9zo8f3F/5bvezIXudPFi9529v4J4WodK750a4G8f3F/wCW73syF7nR4/uL/wAt3vZkL3Onixe87e38E8LUOld86NcDeP7i/wDLd72ZC9zo8f3F/wCW73syF7nTxYvedvb+CeFqHSu+dGuBvH9xf+W73syF7nR4/uL/AMt3vZkL3Onixe87e38E8LUOld86NcDeP7i/8t3vZkL3Ojx/cX/lu97Mhe508WL3nb2/gnhah0rvnRrgbx/cX/lu97Mhe50eP7i/8t3vZkL3Onixe87e38E8LUOld86NcDeP7i/8t3vZkL3Ojx/cX/lu97Mhe508WL3nb2/gnhah0rvnRrgbx/cX/lu97Mhe50eP7i/8t3vZkL3Onixe87e38E8LUOld86NcDeP7i/8ALd72ZC9zo8f3F/5bvezIXudPFi9529v4J4WodK750a4G8f3F/wCW73syF7nR4/uL/wAt3vZkL3Onixe87e38E8LUOld86NcDeP7i/wDLd72ZC9zo8f3F/wCW73syF7nTxYvedvb+CeFqHSu+dGuBvH9xf+W73syF7nR4/uL/AMt3vZkL3Onixe87e38E8LUOld86NcDeP7i/8t3vZkL3Ojx/cX/lu97Mhe508WL3nb2/gnhah0rvnRrgbx/cX/lu97Mhe50eP7i/8t3vZkL3Onixe87e38E8LUOld86NcDeP7i/8t3vZkL3Ojx/cX/lu97Mhe508WL3nb2/gnhah0rvnRrgbx/cX/lu97Mhe50eP7i/8t3vZkL3Onixe87e38E8LUOld86NcDeP7i/8ALd72ZC9zo8f3F/5bvezIXudPFi9529v4J4WodK750a4G8f3F/wCW73syF7nR4/uL/wAt3vZkL3Onixe87e38E8LUOld7Pfez82lxeYPTq1ygePvF8jBvZ72bC9zrUf4w8SJpzLupxwn/APsYo/sa1PQ4O3dN0mO38FBXxKi9sCV1/wAI/wB+K3+Txf1n9MXX5/0vi7xIpb7z9Oux2Mt9KEukQYqtwSVFPxmjjG5XV59brnHri4kcr2e9mwvc6jq8HLx7yRHb+CzSxag1gaZ7F3no1wP4/uL/AMt3vZsL3Ovnj+4v/Ld72ZC9zrTxYvedvb+Cm8LUOld86NcDeP7i/wDLd72ZC9zo8f3F/wCW73syF7nTxYvedvb+CeFqHSu+dGuBvH9xf+W73syF7nR4/uL/AMt3vZkL3Onixe87e38E8LUOld86xSfvR+bXBfj+4v8Ay3e9mQvc6+K4+cXlDBvZ4j/ZsL3Og4MXvO3t/BPCtDpXVN3D/GTr3wX/AAguf5of6rmuR3uL3EWYrdKuhxw+fvGMP7G9SFtcZr9t9ct6FVWFvSygvOOxGyVBIISMBIAAyezt+bVmtgN2aWURPWqlPEaLauYzC720a4ec7pDignqqkH6C39Wsf+ElxS9JwPoLf1ap+Ld9zDtVwYrbnn7F3Lo1w1/hJcUvScD6C39Wj/CS4pek4H0Fv6tPFq+5h2rPhS36exdy6NcNf4SXFL0nA+gt/Vo/wkuKXpSB9Bb+rTxavuYdqeFLfp7F3Lo1w1/hJcUvScD6C39Wj/CS4pelIH0Fv6tPFq+5h2p4Ut+nsWr3V5xx5uL5ov8AdmtJ+Sryu3Vkvq66leFwv3BWiyqoSEoS840jYHNqQlJIzgHaEjlgcvPkmqPrBV269zhlu+hbMpv3AXDrOFWs57dimJ3Uv+fe4/8Adf7q1pZaNGp8M+RUfqt9wVqv8a7rKzx+vW4ns0aNWXKlU3XrRo0a0USB8bWy38XRo1qVq9YntYTo0ayFs3ZZWdZz1aNGtStHbrWd140aNbBSDZGjRo1lZRo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERo0aNERr21o0awdlg7LZHVrC9o0a1CjbusOjRo1upUaNGjREaNGjREaDo0aIsjOtg9WjRrUqJ+613evXkaNGtluNkaNGjREaNGjREaNGjRFhe6taTnxtGjUjVYpr//Z",
    keywords: ["transferencias entre cuentas", "mismo banco", "diferentes bancos", "mismo titular", "asiento contable"],
    contenido: ``
  },
  {
    id: "T0222",
    unidad: 2,
    titulo: "Cheques Rechazados — Concepto y Causas",
    keywords: ["cheques rechazados", "falta de fondos", "requisitos formales", "firma no autorizada", "fecha vencida", "importes distintos", "firma distinta", "nota de débito"],
    contenido: `
      <p><strong>Concepto:</strong> Son aquellos cheques depositados en una cuenta corriente que resultan rechazados.</p>
      <p><strong>Causas:</strong></p>
      <ul>
        <li><strong>Falta de requisitos formales:</strong> firma no autorizada · fecha vencida · importes en letras y números distintos · firma distinta de la registrada</li>
        <li><strong>Falta de fondos suficientes</strong></li>
      </ul>
    `
  },
  {
    id: "T0223",
    unidad: 2,
    titulo: "Cheques Rechazados — Registración Contable",
    keywords: ["cheques rechazados", "registración contable", "nota de débito", "banco devuelve", "gastos", "deudores por ventas"],
    contenido: `
      <p>El banco devuelve los cheques emitiendo una <strong>nota de débito</strong> (valor depositado + gastos).</p>
      <p>El ente emite nota de débito al cliente (valor del cheque + gastos).</p>
      <p><strong>Asiento 1:</strong> Cheques Rechazados (D) / A Banco XX Cuenta Corriente (H)</p>
      <p><strong>Asiento 2:</strong> Deudores por Ventas (D) / A Cheques Rechazados (H)</p>
    `
  },
  {
    id: "T0224",
    unidad: 2,
    titulo: "Conciliaciones Bancarias — Concepto y Objetivo",
    keywords: ["conciliación bancaria", "control interno", "movimientos registrados", "extracto bancario", "mayor contable", "suministrar información", "efectuar correcciones", "imputar resultados"],
    contenido: `
      <p><strong>Concepto:</strong> Herramienta de control interno por la que se verifica que todos los movimientos registrados por la empresa han sido tenidos en cuenta por el banco y viceversa.</p>
      <p><strong>Objetivo:</strong> Suministrar información correcta · Efectuar correcciones · Imputar resultados.</p>
    `
  },
  {
    id: "T0225",
    unidad: 2,
    titulo: "Conciliación Bancaria — Procedimiento y Tipos de Diferencias",
    keywords: ["conciliación bancaria", "procedimiento", "cotejar", "tildar", "diferencias temporarias", "diferencias permanentes", "depósitos pendientes", "cheques emitidos no presentados", "notas de débito", "notas de crédito", "errores omisiones"],
    contenido: `
      <p><strong>Pasos:</strong></p>
      <ul>
        <li>1. Cotejar y tildar cada movimiento en el Mayor y el resumen bancario.</li>
        <li>2. Detectar partidas sin tildar que generan diferencias entre ambos saldos.</li>
      </ul>
      <p><strong>Diferencias Temporarias</strong> (no requieren registración):</p>
      <ul>
        <li>Depósitos registrados pendientes de acreditación</li>
        <li>Cheques emitidos no presentados al banco</li>
      </ul>
      <p><strong>Diferencias No Temporarias o Permanentes</strong> (deben registrarse):</p>
      <ul>
        <li>Notas de débitos/créditos no registradas por la empresa</li>
        <li>Errores u omisiones del banco o de la empresa</li>
      </ul>
    `
  },
  {
    id: "T0226",
    unidad: 2,
    titulo: "Armado de la Conciliación — Desde el Saldo del Extracto Bancario",
    keywords: ["armado conciliación", "saldo extracto bancario", "sumar", "restar", "depósitos pendientes acreditación", "cheques emitidos no presentados", "notas débito", "notas crédito", "errores omisiones"],
    contenido: `
      <p><strong>Saldo según Extracto Bancario</strong></p>
      <p><strong>(+) SUMAR:</strong> Depósitos registrados pendientes de acreditación · Notas de débitos no registradas por la empresa · Errores u omisiones</p>
      <p><strong>(−) RESTAR:</strong> Cheques emitidos no presentados al banco · Notas de créditos no registradas por la empresa · Errores u omisiones</p>
      <p>= <strong>Saldo según la Contabilidad</strong></p>
    `
  },
  {
    id: "T0227",
    unidad: 2,
    titulo: "Armado de la Conciliación — Desde el Saldo según la Contabilidad",
    keywords: ["armado conciliación", "saldo contabilidad", "sumar", "restar", "cheques emitidos no presentados", "notas crédito", "depósitos pendientes", "notas débito", "saldo extracto"],
    contenido: `
      <p><strong>Saldo según la Contabilidad</strong></p>
      <p><strong>(−) RESTAR:</strong> Depósitos registrados pendientes de acreditación · Notas de débitos no registradas · Errores u omisiones</p>
      <p><strong>(+) SUMAR:</strong> Cheques emitidos no presentados al banco · Notas de créditos no registradas · Errores u omisiones</p>
      <p>= <strong>Saldo según Extracto Bancario</strong></p>
    `
  },
  {
    id: "T0228",
    unidad: 2,
    titulo: "Tratamiento de las Diferencias en la Conciliación",
    keywords: ["tratamiento diferencias", "diferencias temporarias", "no requieren registración", "diferencias permanentes", "deben registrarse"],
    contenido: `
      <ul>
        <li><strong>Diferencias Temporarias → NO requieren registración</strong> (se resuelven solas en el período siguiente).</li>
        <li><strong>Diferencias No Temporarias o Permanentes → DEBEN registrarse</strong> mediante asientos de ajuste.</li>
      </ul>
    `
  },
  {
    id: "T0229",
    unidad: 2,
    titulo: "Ajustes Contables más Comunes en la Conciliación",
    keywords: ["ajustes contables", "gastos bancarios", "comisiones bancarias", "IVA crédito fiscal", "impuesto débitos créditos", "ingresos brutos", "banco cuenta corriente", "registración débitos"],
    contenido: `
      <p><strong>Asiento típico por débitos bancarios:</strong></p>
      <ul>
        <li>Gastos y Comisiones Bancarias (D) $3.576,00</li>
        <li>IVA Crédito Fiscal (D) $750,96</li>
        <li>Imp. Débitos y Créditos Bancarios (D) $4.293,54</li>
        <li>Imp. sobre los Ingresos Brutos (D) $1.272,00</li>
        <li><strong>A Banco Nación Cta. Cte.</strong> (H) $9.892,50</li>
      </ul>
    `
  },
  {
    id: "T0230",
    unidad: 2,
    titulo: "Efectivo en Moneda Extranjera — Medición y Diferencias de Cambio",
    keywords: ["efectivo moneda extranjera", "tipo de cambio comprador", "diferencia de cambio", "ingreso financiero", "costo financiero", "estados contables", "medición posterior"],
    contenido: `
      <p>Se convierte a moneda argentina al <strong>tipo de cambio comprador</strong> de la fecha de los estados contables.</p>
      <p>La diferencia de cambio se contabiliza como ingreso o costo financiero:</p>
      <ul>
        <li><strong>Positiva:</strong> Moneda Extranjera (D) / A Diferencia de Cambio M.E. (H)</li>
        <li><strong>Negativa:</strong> Diferencia de Cambio M.E. (D) / A Moneda Extranjera (H)</li>
      </ul>
    `
  },

];

const PREGUNTAS = [
  {
  id: "P0101",
  unidad: 1,
  pregunta: "Exprese el concepto de Modelo Contable y de cada uno de los elementos que intervienen en su determinación.",
  respuesta: ``,
  referencias: ["T0101", "T0102", "T0103", "T0104", "T0105", "T0106"]
},
{
  id: "P0102",
  unidad: 1,
  pregunta: "Indique a qué Modelo Contable corresponde cada una de las siguientes combinaciones de elementos: 1. Capital a mantener Financiero, Unidad de medida Homogénea y Criterio de valuación a Valores Corrientes. 2. Capital a mantener Financiero, Unidad de medida Heterogénea y Criterio de valuación a Valores Históricos.",
  respuesta: ``,
  referencias: ["T0117"]
},
{
  id: "P0103",
  unidad: 1,
  pregunta: "Conceptualice Resultados Transaccionales brindando como ejemplo dos Rubros diferentes que correspondan a dichos resultados y el nombre de dos Cuentas que integren cada uno de los Rubros consignados.",
  respuesta: ``,
  referencias: ["T0121"]
},
{
  id: "P0104",
  unidad: 1,
  pregunta: "Conceptualice Resultados no Transaccionales brindando como ejemplo tres Cuentas.",
  respuesta: ``,
  referencias: ["T0121", "T0122"]
},
{
  id: "P0105",
  unidad: 1,
  pregunta: "Modelos Contables: Complete el siguiente cuadro consignando en cada columna (vertical) un elemento de los Modelos Contables y en cada línea (horizontal) el nombre de cada Modelo propiamente dicho. Luego complete cada casillero con el tipo de elemento que corresponde a cada modelo.",
  respuesta: ``,
  referencias: ["T0102", "T0103", "T0104", "T0117"]
},
{
  id: "P0106",
  unidad: 1,
  pregunta: "Conceptualice Costos de Adquisición, Costo de Reproducción y Valor Neto de Realización mencionando para cada componente de cada uno de ellos los ejemplos correspondientes. Brinde un ejemplo de activo donde se apliquen los mismos criterios de medición.",
  respuesta: ``,
  referencias: ["T0107", "T0110", "T0113"]
},
{
  id: "P0107",
  unidad: 1,
  pregunta: "Brinde el concepto completo de: Resultados Transaccionales y Resultados No Transaccionales.",
  respuesta: ``,
  referencias: ["T0121", "T0122"]
},
{
  id: "P0108",
  unidad: 1,
  pregunta: `En cada caso planteado: exprese si se trata de Resultados Transaccionales o No Transaccionales y diga el nombre completo de la Cuenta que corresponda:
  <ol>
    <li>Renta generada por tractor de propiedad de la empresa alquilado a terceros.</li>
    <li>Disminución de los precios de computadoras expuestos a rápidos avances y desarrollos tecnológicos.</li>
    <li>Ganancia derivada de fluctuaciones del precio de los metales preciosos mantenidos en el activo.</li>
    <li>Resultado obtenido por la destrucción total de un rodado a causa de un desastre natural.</li>
    <li>Importes obtenidos en concepto de amortización de la inversión realizada en títulos públicos.</li>
    <li>Incremento del valor de un terreno adquirido y mantenido en el activo con la finalidad de su reventa futura.</li>
    <li>Interés devengado proveniente de préstamo efectuado a entidad asociada por venta a plazo de mercaderías.</li>
  </ol>`,
  respuesta: ``,
  referencias: ["T0121", "T0122"]
},
];


/* ════════════════════════════════════════════════
   ESTADO DE LA APP
   ════════════════════════════════════════════════ */

let currentSection   = 'welcome';
let currentUnidad    = null;   // número de unidad activa (1-11)
let currentGrupoId = null;
let searchQuery      = '';
let refOrigin = null; // { unidad: X } para volver a preguntas de final

/* ════════════════════════════════════════════════
   INICIALIZACIÓN
   ════════════════════════════════════════════════ */

function init() {
  document.getElementById('count-preguntas').textContent = PREGUNTAS.length;

  const conRefs = PREGUNTAS.filter(p => p.referencias && p.referencias.length > 0).length;
  document.getElementById('stat-con-refs').textContent  = conRefs;
  document.getElementById('stat-preguntas').textContent = PREGUNTAS.length;

  renderUnidadesGrid();
  renderPreguntasGrid();
}

/* ════════════════════════════════════════════════
   RENDER UNIDADES GRID
   ════════════════════════════════════════════════ */

// REEMPLAZÁ la función entera por:
async function renderUnidadesGrid() {
  currentGrupoId = null;
  const visibleIds = await getVisibleUserIds();

  const { data: todasUnidades } = await supabaseClient
    .from('unidades').select('*, grupos(id, nombre)')
    .in('alumno_id', visibleIds).order('numero');

  mcUnidades = todasUnidades || [];

  const { data: todasFilminas } = await supabaseClient
    .from('filminas').select('unidad_id')
    .in('alumno_id', visibleIds);

  const grid = document.getElementById('units-grid');
  grid.innerHTML = '';

  if (!mcUnidades.length) {
    grid.innerHTML = `<div class="unit-empty"><div class="ue-icon">📂</div><h4>Sin unidades aún</h4><p>Creá tu primera unidad en Mi Contenido.</p></div>`;
    return;
  }

  // Superadmin: mostrar tarjetas por grupo
  if (currentPerfil?.rol === 'superadmin') {
    const gruposMap = new Map();
    mcUnidades.forEach(u => {
      const gId = u.grupos?.id || 'sin-grupo';
      const gNombre = u.grupos?.nombre || 'Sin grupo';
      if (!gruposMap.has(gId)) gruposMap.set(gId, { nombre: gNombre, unidades: [] });
      gruposMap.get(gId).unidades.push(u);
    });

    gruposMap.forEach((g, gId) => {
      const totalFilminas = g.unidades.reduce((acc, u) => {
        return acc + (todasFilminas || []).filter(f => f.unidad_id === u.id).length;
      }, 0);

      const card = document.createElement('div');
      card.className = 'unit-card';
      card.innerHTML = `
        <div class="unit-card-main" onclick="openGrupoTeoria('${gId}')">
          <div class="unit-num">📂</div>
          <div class="unit-info">
            <h4>${g.nombre}</h4>
            <div class="unit-filminas-count">
              <span>${g.unidades.length} unidad${g.unidades.length !== 1 ? 'es' : ''} · ${totalFilminas} filmina${totalFilminas !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="unit-arrow">→</div>
        </div>`;
      grid.appendChild(card);
    });

  } else {
    // Alumno: mostrar por materia primero
    const { data: todosGrupos } = await supabaseClient.from('grupos').select('id, nombre');
    const gruposLookup = {};
    (todosGrupos || []).forEach(g => gruposLookup[g.id] = g.nombre);

    // Agrupar unidades por grupo
    const materiasMap = new Map();
    mcUnidades.forEach(u => {
      const gId = u.grupo_id || 'sin-materia';
      const gNombre = gruposLookup[u.grupo_id] || 'Sin materia';
      if (!materiasMap.has(gId)) materiasMap.set(gId, { nombre: gNombre, unidades: [] });
      materiasMap.get(gId).unidades.push(u);
    });

    materiasMap.forEach((materia, gId) => {
      const card = document.createElement('div');
      card.className = 'unit-card';
      const totalFilminas = materia.unidades.reduce((acc, u) => {
        const matchIds = [u.id];
        return acc + (todasFilminas || []).filter(f => matchIds.includes(f.unidad_id)).length;
      }, 0);
      card.innerHTML = `
        <div class="unit-card-main" onclick="openMateriaTeoria('${gId}')">
          <div class="unit-num">📂</div>
          <div class="unit-info">
            <h4>${materia.nombre}</h4>
            <div class="unit-filminas-count">
              <span>${materia.unidades.length} unidad${materia.unidades.length !== 1 ? 'es' : ''} · ${totalFilminas} filmina${totalFilminas !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="unit-arrow">→</div>
        </div>`;
      grid.appendChild(card);
    });
  }
}
function openGrupoTeoria(grupoId) {
  const unidadesDelGrupo = mcUnidades.filter(u => (u.grupos?.id || 'sin-grupo') === grupoId);
  const grupoNombre = unidadesDelGrupo[0]?.grupos?.nombre || 'Sin grupo';

  const grid = document.getElementById('units-grid');
  grid.innerHTML = '';

  // Contenedor con header fuera del grid
  const wrapper = document.createElement('div');
  wrapper.style.gridColumn = '1 / -1';
  wrapper.innerHTML = `
    <button class="back-btn" style="margin-bottom:16px" onclick="renderUnidadesGrid()">← Volver a grupos</button>
    <div class="unit-view-header" style="margin-bottom:16px"><h3>📂 ${grupoNombre}</h3></div>
  `;
  grid.appendChild(wrapper);

  // Contenedor de unidades (apiladas verticalmente)
  const listaUnidades = document.createElement('div');
  listaUnidades.style.gridColumn = '1 / -1';
  listaUnidades.style.display = 'flex';
  listaUnidades.style.flexDirection = 'column';
  listaUnidades.style.gap = '10px';

  const unidadesMap = new Map();
  unidadesDelGrupo.forEach(u => { if (!unidadesMap.has(u.numero)) unidadesMap.set(u.numero, u); });
  const displayUnidades = [...unidadesMap.values()].sort((a, b) => a.numero - b.numero);

  displayUnidades.forEach(u => {
    const card = document.createElement('div');
    card.className = 'unit-card';
    card.innerHTML = `
      <div class="unit-card-main" onclick="openUnidad(${u.numero})">
        <div class="unit-num">${u.numero}</div>
        <div class="unit-info">
          <h4>${u.nombre}</h4>
        </div>
        <div class="unit-arrow">→</div>
      </div>`;
    listaUnidades.appendChild(card);
  });

  grid.appendChild(listaUnidades);
}

async function renderUnidadesGridAE() {
  const grid = document.getElementById('units-grid-ae');
  if (!grid) return;
  grid.innerHTML = '';

  const visibleIds = await getVisibleUserIds();
  const { data: todasUnidades } = await supabaseClient
    .from('unidades').select('*').in('alumno_id', visibleIds).order('numero');

  const unidadesMap = new Map();
  (todasUnidades || []).forEach(u => { if (!unidadesMap.has(u.numero)) unidadesMap.set(u.numero, u); });
  const displayUnidades = [...unidadesMap.values()];
  mcUnidades = todasUnidades || [];  //

  const { data: todasFilminas } = await supabaseClient
    .from('filminas').select('unidad_id').in('alumno_id', visibleIds);

  displayUnidades.forEach(u => {
    const matchIds = (todasUnidades || []).filter(x => x.numero === u.numero).map(x => x.id);
    const count = todasFilminas ? todasFilminas.filter(f => matchIds.includes(f.unidad_id)).length : 0;
    const card = document.createElement('div');
    card.className = 'unit-card';
    card.innerHTML = `
      <div class="unit-card-main" onclick="openAutoevaluacion(${u.numero})">
        <div class="unit-num">${u.numero}</div>
        <div class="unit-info">
          <h4>${u.nombre}</h4>
          <div class="unit-filminas-count">
            <span>${count > 0 ? count + ' filmina' + (count !== 1 ? 's' : '') : 'Sin filminas aún'}</span>
          </div>
        </div>
        <div class="unit-arrow">→</div>
      </div>`;
    grid.appendChild(card);
  });
}

/* ════════════════════════════════════════════════
   ABRIR UNIDAD
   ════════════════════════════════════════════════ */

function openUnidad(numero) {
  currentUnidad = numero;
  // Solo actualizar currentGrupoId si no viene de una materia ya seleccionada
if (!currentGrupoId) {
  currentGrupoId = mcUnidades.find(u => u.numero === numero)?.grupo_id || null;
}
  const u = mcUnidades.find(x => x.numero === numero) || {};

  document.getElementById('view-unidades').style.display = 'none';
  document.getElementById('view-filminas').style.display = 'block';
  document.getElementById('uvh-badge').textContent  = `Unidad ${numero}`;
  document.getElementById('uvh-titulo').textContent = u.nombre ?? '';

  const backToPreg = document.getElementById('back-to-preguntas');
  backToPreg.style.display = refOrigin !== null ? 'inline-flex' : 'none';

  renderFilminas(numero);
  renderSubnav('teoria');
  closeSidebar();
}

function backToUnidades() {
  currentGrupoId = null;
  currentUnidad = null;
  document.getElementById('view-unidades').style.display = 'block';
  document.getElementById('view-filminas').style.display = 'none';
  clearSearch();
  renderSubnav('teoria');
}

/* ════════════════════════════════════════════════
   RENDER FILMINAS DE UNA UNIDAD
   ════════════════════════════════════════════════ */

async function renderFilminas(numero, query = '') {
  const container = document.getElementById('teoria-cards');
  container.innerHTML = '<p style="padding:1rem;color:var(--muted2)">Cargando...</p>';

  const visibleIds = await getVisibleUserIds();
  const matchingUnidades = mcUnidades.filter(u => 
  u.numero === numero && 
  visibleIds.includes(u.alumno_id) &&
  (currentGrupoId ? u.grupo_id === currentGrupoId : true)
);
  const unidadIds = matchingUnidades.map(u => u.id);

  if (!unidadIds.length) {
    container.innerHTML = '';
    document.getElementById('unit-empty').style.display = 'block';
    return;
  }

  const { data: items } = await supabaseClient
    .from('filminas').select('*')
    .in('unidad_id', unidadIds).order('id');

  container.innerHTML = '';
  let filminas = items || [];
window.filminasActuales = filminas;

  if (query) {
    const q = query.toLowerCase();
    filminas = filminas.filter(t =>
      t.titulo.toLowerCase().includes(q) ||
      t.contenido.toLowerCase().includes(q) ||
      (t.keywords && t.keywords.toLowerCase().includes(q))
    );
  }

  const empty = document.getElementById('unit-empty');
  if (!filminas.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  filminas.forEach((t, index) => {
    const card = document.createElement('div');
    const colores = ['card-c0','card-c1','card-c2','card-c3','card-c4'];
    card.className = 'card ' + colores[index % colores.length];
    card.id = `card-${t.id}`;
    card.dataset.filminaId = t.id;
    
    const contenidoRaw = query ? highlight(t.contenido, query) : t.contenido;
// Si no hay tags HTML (texto plano), convertir saltos de línea
const contenido = /<[a-z][\s\S]*>/i.test(t.contenido)
  ? contenidoRaw
  : contenidoRaw.replace(/\n/g, '<br>');
    card.innerHTML = `
      <div class="card-header" onclick="toggleCard('${t.id}'); registrarFilminaLeida('${t.id}')">
        <div class="card-num">${index + 1}</div>
        <div class="card-info">
          <div class="card-title">${query ? highlight(t.titulo, query) : t.titulo}</div>
        </div>
        <button class="card-toggle" aria-label="expandir">▼</button>
      </div>
      <div class="card-body">
  <div class="card-body-inner">
    ${t.imagen_url ? `<img src="${t.imagen_url}" style="max-width:100%;border-radius:8px;margin-bottom:12px" />` : ''}
    <div class="filmina-content">${contenido}</div>
<button class="tts-btn" onclick="leerFilmina(this, '${encodeURIComponent(t.titulo + '. ' + t.contenido.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())}')" title="Escuchar">
  🔊
</button>
  </div>
</div>`;
    container.appendChild(card);
  });
  iniciarTrackingFilminas();
}

function iniciarTrackingFilminas() {
  filminas_leidas_sesion = [];
}

/* ════════════════════════════════════════════════
   RENDER PREGUNTAS
   ════════════════════════════════════════════════ */

let currentPreguntaUnidad = null;

async function renderPreguntasGrid() {
  const visibleIds = await getVisibleUserIds();
  const { data: todasUnidades } = await supabaseClient
    .from('unidades').select('*').in('alumno_id', visibleIds).order('numero');

  const { data: todosGrupos } = await supabaseClient.from('grupos').select('id, nombre');
  const gruposLookup = {};
  (todosGrupos || []).forEach(g => gruposLookup[g.id] = g.nombre);

  const unidadesMap = new Map();
  (todasUnidades || []).forEach(u => { if (!unidadesMap.has(u.numero)) unidadesMap.set(u.numero, u); });
  const allUnidadIds = (todasUnidades || []).map(u => u.id);

  const { data: todasPreguntas } = await supabaseClient
    .from('preguntas_final').select('*, unidades(id, numero, nombre, grupo_id)')
    .in('alumno_id', visibleIds);

  const container = document.getElementById('preguntas-cards');
  container.innerHTML = '';

  const esSuperadmin = currentPerfil?.rol === 'superadmin';

  if (esSuperadmin) {
    // Superadmin: vista por grupos como antes
    const displayUnidades = [...unidadesMap.values()];
    const grid = document.createElement('div');
    grid.className = 'units-grid';

    displayUnidades.forEach(u => {
      const matchIds = (todasUnidades || []).filter(x => x.numero === u.numero).map(x => x.id);
      const count = todasPreguntas ? todasPreguntas.filter(p => matchIds.includes(p.unidad_id)).length : 0;
      const card = document.createElement('div');
      card.className = 'unit-card';
      card.innerHTML = `
        <div class="unit-card-main" onclick="openPreguntasUnidad(${u.numero})">
          <div class="unit-num">${u.numero}</div>
          <div class="unit-info">
            <h4>${u.nombre}</h4>
            <div class="unit-filminas-count">
              <span>${count > 0 ? count + ' pregunta' + (count !== 1 ? 's' : '') : 'Sin preguntas aún'}</span>
            </div>
          </div>
          <div class="unit-arrow">→</div>
        </div>`;
      grid.appendChild(card);
    });
    container.appendChild(grid);

  } else {
    // Alumno: vista por materia → unidad
    const materiasMap = new Map();
    (todasUnidades || []).forEach(u => {
      const gId = u.grupo_id || 'sin-materia';
      const gNombre = gruposLookup[u.grupo_id] || 'Sin materia';
      if (!materiasMap.has(gId)) materiasMap.set(gId, { nombre: gNombre, unidades: [] });
      materiasMap.get(gId).unidades.push(u);
    });

    materiasMap.forEach((materia, gId) => {
      const totalPreguntas = materia.unidades.reduce((acc, u) => {
        return acc + (todasPreguntas || []).filter(p => p.unidad_id === u.id).length;
      }, 0);

      const card = document.createElement('div');
      card.className = 'unit-card';
      card.style.marginBottom = '10px';
      card.innerHTML = `
        <div class="unit-card-main" onclick="openMateriaPreguntasGrid('${gId}')">
          <div class="unit-num">📂</div>
          <div class="unit-info">
            <h4>${materia.nombre}</h4>
            <div class="unit-filminas-count">
              <span>${materia.unidades.length} unidad${materia.unidades.length !== 1 ? 'es' : ''} · ${totalPreguntas} pregunta${totalPreguntas !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="unit-arrow">→</div>
        </div>`;
      container.appendChild(card);
    });
  }
}

async function openMateriaPreguntasGrid(grupoId) {
  const visibleIds = await getVisibleUserIds();
  const { data: unidades } = await supabaseClient
    .from('unidades').select('*').in('alumno_id', visibleIds).eq('grupo_id', grupoId).order('numero');

  const { data: todosGrupos } = await supabaseClient.from('grupos').select('id, nombre');
  const grupoNombre = todosGrupos?.find(g => g.id === grupoId)?.nombre || 'Materia';

  const container = document.getElementById('preguntas-cards');
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.style.marginBottom = '16px';
  backBtn.textContent = '← Volver a materias';
  backBtn.onclick = () => renderPreguntasGrid();
  container.appendChild(backBtn);

  const header = document.createElement('div');
  header.className = 'unit-view-header';
  header.innerHTML = `<h3>📂 ${grupoNombre}</h3>`;
  container.appendChild(header);

  const lista = document.createElement('div');
  lista.style.display = 'flex';
  lista.style.flexDirection = 'column';
  lista.style.gap = '10px';

  (unidades || []).forEach(u => {
    const card = document.createElement('div');
    card.className = 'unit-card';
    card.innerHTML = `
      <div class="unit-card-main" onclick="openPreguntasUnidad(${u.numero})">
        <div class="unit-num">${u.numero}</div>
        <div class="unit-info">
          <h4>${u.nombre}</h4>
        </div>
        <div class="unit-arrow">→</div>
      </div>`;
    lista.appendChild(card);
  });

  container.appendChild(lista);
}

async function openPreguntasUnidad(numero) {
  currentPreguntaUnidad = numero;
  const visibleIds = await getVisibleUserIds();
  const { data: unidades } = await supabaseClient
    .from('unidades').select('*').in('alumno_id', visibleIds).eq('numero', numero);

  const unidadIds = (unidades || []).map(u => u.id);
  const unidadNombre = unidades?.[0]?.nombre ?? `Unidad ${numero}`;

  const { data: items } = await supabaseClient
    .from('preguntas_final').select('*')
    .in('unidad_id', unidadIds).order('created_at');

  const container = document.getElementById('preguntas-cards');
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.style.marginBottom = '20px';
  backBtn.textContent = '← Volver a Unidades';
  backBtn.onclick = () => { currentPreguntaUnidad = null; renderPreguntasGrid(); };
  container.appendChild(backBtn);

  const header = document.createElement('div');
  header.className = 'unit-view-header';
  header.innerHTML = `<div class="uvh-badge">Unidad ${numero}</div><h3>${unidadNombre}</h3>`;
  container.appendChild(header);

  if (!items || !items.length) {
    container.innerHTML += `<div class="unit-empty"><div class="ue-icon">📂</div><h4>Sin preguntas aún</h4><p>Todavía no se cargaron preguntas para esta unidad.</p></div>`;
    return;
  }

  items.forEach((p, index) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = `card-${p.id}`;
    const esPropia = p.alumno_id === currentUser.id;
    card.innerHTML = `
      <div class="card-header" onclick="toggleCard('${p.id}')">
        <div class="card-num q-num">${index + 1}</div>
        <div class="card-info">
          <div class="card-title">${escHtml(p.pregunta)}</div>
        </div>
        <button class="card-toggle" aria-label="expandir">▼</button>
      </div>
      <div class="card-body">
        <div class="card-body-inner">
          <div class="resp-label">Respuesta</div>
          <div class="resp-text">${escHtml(p.respuesta) || '<em>Sin respuesta cargada</em>'}</div>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

async function renderPreguntas(query = '') {
  if (!query) { await renderPreguntasGrid(); return; }

  const visibleIds = await getVisibleUserIds();
  const { data: items } = await supabaseClient
    .from('preguntas_final').select('*')
    .in('alumno_id', visibleIds);

  const container = document.getElementById('preguntas-cards');
  container.innerHTML = '';
  const q = query.toLowerCase();
  const filtered = (items || []).filter(p =>
    p.pregunta.toLowerCase().includes(q) || p.respuesta?.toLowerCase().includes(q)
  );
  document.getElementById('empty-preguntas').style.display = filtered.length === 0 ? 'block' : 'none';

  filtered.forEach((p, index) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = `card-${p.id}`;
    card.innerHTML = `
      <div class="card-header" onclick="toggleCard('${p.id}')">
        <div class="card-num q-num">${index + 1}</div>
        <div class="card-info"><div class="card-title">${highlight(p.pregunta, query)}</div></div>
        <button class="card-toggle" aria-label="expandir">▼</button>
      </div>
      <div class="card-body">
        <div class="card-body-inner">
          <div class="resp-label">Respuesta</div>
          <div class="resp-text">${highlight(p.respuesta || '', query)}</div>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

/* ════════════════════════════════════════════════
   SUBNAV
   ════════════════════════════════════════════════ */

function renderSubnav(section) {
  const subnav = document.getElementById('subnav');
  const items  = document.getElementById('subnav-items');
  const label  = document.getElementById('subnav-label');
  items.innerHTML = '';

  if (section === 'teoria') {
    label.textContent = 'Unidades';
    subnav.style.display = 'block';

     const visibles = [...new Map(mcUnidades.map(u => [u.numero, u])).values()];
    visibles.forEach(u => {
      const btn = document.createElement('button');
      btn.className = 'subnav-item' + (currentUnidad === u.numero ? ' active' : '');
      btn.innerHTML = `<span class="subnav-num">${u.numero}</span><span class="subnav-label">${u.nombre.length > 28 ? u.nombre.slice(0,28)+'…' : u.nombre}</span>`;
      btn.onclick = () => openUnidad(u.numero);
      items.appendChild(btn);
    });


  } else if (section === 'preguntas') {
    label.textContent = 'Por unidad';
    const uList = [...new Set(PREGUNTAS.map(p => p.unidad))];
    if (uList.length === 0) { subnav.style.display = 'none'; return; }
    subnav.style.display = 'block';

    uList.forEach(u => {
      const btn = document.createElement('button');
      btn.className = 'subnav-item';
      btn.textContent = u;
      btn.onclick = () => scrollToUnidad(u);
      items.appendChild(btn);
    });

  } else {
    subnav.style.display = 'none';
  }
}

function scrollToUnidad(unidad) {
  const headers = document.querySelectorAll('.unidad-header h3');
  for (const h of headers) {
    if (h.textContent === unidad) {
      h.closest('.unidad-header').scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
  }
  closeSidebar();
}

/* ════════════════════════════════════════════════
   SECCIONES
   ════════════════════════════════════════════════ */

async function showSection(s) {
  currentSection = s;

  // Mostrar mascota solo en Inicio
  const mascota = document.getElementById('mascota-flotante');
  const personajeActual = localStorage.getItem('personaje_' + currentUser?.id);
if (mascota) mascota.style.display = (s === 'welcome' && personajeActual !== 'ninguno') ? 'block' : 'none';
  ['welcome','teoria','preguntas','autoevaluacion','consulta', 'multiple','micontenido','calendario','superadmin','settings','progreso'].forEach(id => {
    document.getElementById(`section-${id}`).style.display = 'none';
    const tab = document.getElementById(`tab-${id}`);
    if (tab) tab.classList.remove('active');
  });

  document.getElementById(`section-${s}`).style.display = s === 'welcome' ? 'block' : 'block';
  const tab = document.getElementById(`tab-${s}`);
  if (tab) tab.classList.add('active');

  const titles = { welcome: 'Inicio', teoria: 'Teoría', preguntas: 'Preguntas de Final', autoevaluacion: 'Autoevaluación', micontenido: 'Mi Contenido' };
  document.getElementById('section-title-bar').textContent = titles[s];

  if (s === 'teoria') {
  await renderUnidadesGrid();
  renderSubnav('teoria');
  getVisibleUserIds().then(visibleIds =>
    supabaseClient.from('filminas').select('id', { count: 'exact', head: true }).in('alumno_id', visibleIds)
      .then(({ count }) => { const el = document.getElementById('count-teoria'); if (el) el.textContent = count || 0; })
  );
}
else if (s === 'preguntas') {
  await renderPreguntasGrid();
  renderSubnav('preguntas');
  getVisibleUserIds().then(visibleIds =>
    supabaseClient.from('preguntas_final').select('id', { count: 'exact', head: true }).in('alumno_id', visibleIds)
      .then(({ count }) => { const el = document.getElementById('count-preguntas'); if (el) el.textContent = count || 0; })
  );
}
  else document.getElementById('subnav').style.display = 'none';

  if (s === 'autoevaluacion') { renderHistorial(); renderUnidadesGridAE(); cargarEstadisticasAE(); }
if (s === 'micontenido') { cargarUnidades(); cargarFilminas(); cargarPreguntasMC(); }
if (s === 'superadmin') cargarPanelSuperadmin();
if (s === 'calendario') renderCalendario();
if (s === 'progreso') renderProgreso();
if (s === 'welcome') setTimeout(() => verificarRepasosHoy(), 500);
if (s === 'multiple') { renderMultiple(); cargarEstadisticasMultiple(); }
if (s === 'settings') {
  const inputIzq = document.getElementById('settings-profe-izq');
  const inputDer = document.getElementById('settings-profe-der');
  if (inputIzq) inputIzq.value = localStorage.getItem('profe_izq_' + currentUser.id) || '';
  if (inputDer) inputDer.value = localStorage.getItem('profe_der_' + currentUser.id) || '';
}
if (s === 'consulta') renderConsulta();

 
  // Limpiar búsqueda al cambiar sección
clearSearch();
closeSidebar();

// Mostrar barra de búsqueda solo en Teoría y Preguntas
const searchWrap = document.querySelector('.search-wrap');
const resultsCount = document.getElementById('resultsCount');
const soloConBusqueda = ['teoria', 'preguntas'];
searchWrap.style.display = soloConBusqueda.includes(s) ? 'flex' : 'none';
resultsCount.style.display = soloConBusqueda.includes(s) ? 'block' : 'none';
}

/* ════════════════════════════════════════════════
   BÚSQUEDA
   ════════════════════════════════════════════════ */

function handleSearch(val) {
  searchQuery = val.trim();
  const clearBtn = document.getElementById('searchClear');
  clearBtn.style.display = val ? 'block' : 'none';

  const count = document.getElementById('resultsCount');

  if (currentSection === 'teoria') {
    if (currentUnidad !== null) {
      const q = searchQuery.toLowerCase();
      const found = TEORIA.filter(t =>
        t.unidad === currentUnidad && (
          t.titulo.toLowerCase().includes(q) ||
          t.contenido.toLowerCase().includes(q) ||
          (t.keywords && t.keywords.some(k => k.toLowerCase().includes(q)))
        )
      );
      renderFilminas(currentUnidad, searchQuery);
      count.textContent = searchQuery ? `${found.length} resultado${found.length !== 1 ? 's' : ''}` : '';
      if (searchQuery) setTimeout(() => expandAll('teoria-cards'), 50);
    } else {
      const q = searchQuery.toLowerCase();
      const found = TEORIA.filter(t =>
        t.titulo.toLowerCase().includes(q) ||
        t.contenido.toLowerCase().includes(q) ||
        (t.keywords && t.keywords.some(k => k.toLowerCase().includes(q)))
      );
      count.textContent = searchQuery ? `${found.length} resultado${found.length !== 1 ? 's' : ''}` : '';
      if (searchQuery && found.length > 0) {
        const primeraUnidad = found[0].unidad;
        openUnidad(primeraUnidad);
        setTimeout(() => renderFilminas(primeraUnidad, searchQuery), 150);
        setTimeout(() => expandAll('teoria-cards'), 300);
      }
    }
  } else if (currentSection === 'preguntas') {
    const q = searchQuery.toLowerCase();
    const found = PREGUNTAS.filter(p =>
      p.pregunta.toLowerCase().includes(q) ||
      p.respuesta.toLowerCase().includes(q)
    );
    renderPreguntas(searchQuery);
    count.textContent = searchQuery ? `${found.length} resultado${found.length !== 1 ? 's' : ''}` : '';
    if (searchQuery) setTimeout(() => expandAll('preguntas-cards'), 50);
  }
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').style.display = 'none';
  document.getElementById('resultsCount').textContent = '';
  searchQuery = '';
  if (currentSection === 'teoria' && currentUnidad !== null) renderFilminas(currentUnidad);
  else if (currentSection === 'preguntas') renderPreguntas();
}

function expandAll(containerId) {
  document.querySelectorAll(`#${containerId} .card`).forEach(c => c.classList.add('expanded'));
}

/* ════════════════════════════════════════════════
   TOGGLE CARD
   ════════════════════════════════════════════════ */

function toggleCard(id) {
  const card = document.getElementById(`card-${id}`);
  card.classList.toggle('expanded');
}

/* ════════════════════════════════════════════════
   REFERENCIA CRUZADA
   ════════════════════════════════════════════════ */

function goToRef(refId) {
  const t = TEORIA.find(x => x.id === refId);
  if (!t) return;

  refOrigin = { unidad: currentPreguntaUnidad };
  showSection('teoria');

  setTimeout(() => {
    openUnidad(t.unidad);
    setTimeout(() => {
      const card = document.getElementById(`card-${refId}`);
      if (card) {
        card.classList.add('expanded');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.boxShadow = '0 0 0 2px rgba(245,158,11,0.6)';
        setTimeout(() => card.style.boxShadow = '', 1500);
      }
    }, 100);
  }, 100);
}
function volverAPreguntas() {
  const unidad = refOrigin ? refOrigin.unidad : null;
  refOrigin = null;
  document.getElementById('back-to-preguntas').style.display = 'none';
  showSection('preguntas');
  if (unidad !== null) {
    setTimeout(() => openPreguntasUnidad(unidad), 100);
  }
}

/* ════════════════════════════════════════════════
   TOOLTIP
   ════════════════════════════════════════════════ */

function showTooltip(e, refId) {
  const t = TEORIA.find(x => x.id === refId);
  if (!t) return;
  const tooltip = document.getElementById('refTooltip');
  tooltip.innerHTML = `<strong>📖 ${t.id} – ${t.titulo}</strong>${t.unidad}`;
  const rect = e.target.getBoundingClientRect();
  tooltip.style.left = (rect.left) + 'px';
  tooltip.style.top  = (rect.top - 70) + 'px';
  tooltip.classList.add('visible');
}

function hideTooltip() {
  document.getElementById('refTooltip').classList.remove('visible');
}

/* ════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════ */

function highlight(text, query) {
  if (!query) return text;
  const re = new RegExp(`(${escapeRe(query)})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function toggleDesktopSidebar() {
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('main');
  sidebar.classList.toggle('collapsed');
  main.classList.toggle('sidebar-collapsed');
}

/* ════════════════════════════════════════════════
   AUTOEVALUACIÓN
   ════════════════════════════════════════════════ */

let aeUnidad      = null;   // null = global, number = unidad específica
let aeQuestions   = [];     // preguntas seleccionadas
let aeIndex       = 0;      // pregunta actual
let aeRolled      = 0;      // número sacado

const DICE_FACES = ['1','2','3','4','5','6'];

const DIALOGS_AE = [
  { name: 'Profa. García', text: '¡Bienvenido alumno, hoy es tu examen final!', profe: 'izq' },
  { name: 'Prof. Rodríguez', text: 'Girá el bolillero por favor.', profe: 'der' }
];
let aeDialogIndex = 0;

function showAulaStep() {
  const nombreIzq = localStorage.getItem('profe_izq_' + currentUser.id);
  const nombreDer = localStorage.getItem('profe_der_' + currentUser.id);
  if (nombreIzq) DIALOGS_AE[0].name = nombreIzq;
  if (nombreDer) DIALOGS_AE[1].name = nombreDer;

  aeDialogIndex = 0;
  renderDialog(0);
  document.getElementById('aeModal').classList.add('aula-mode');
  document.getElementById('ae-step-aula').style.display = 'block';
}

function renderDialog(i) {
  const d = DIALOGS_AE[i];
  const isIzq = d.profe === 'izq';

  // Mostrar burbuja del que habla, ocultar la del otro
  document.getElementById('bubble-izq').classList.toggle('visible', isIzq);
  document.getElementById('bubble-der').classList.toggle('visible', !isIzq);

  // Escribir texto en la burbuja correcta
  if (isIzq) {
    document.getElementById('bubble-name-izq').textContent = d.name;
    document.getElementById('bubble-text-izq').textContent = d.text;
  } else {
    document.getElementById('bubble-name-der').textContent = d.name;
    document.getElementById('bubble-text-der').textContent = d.text;
  }

  // Animación speaking
  document.getElementById('profe-izq').classList.toggle('speaking', isIzq);
  document.getElementById('profe-der').classList.toggle('speaking', !isIzq);

  const btn = document.getElementById('dialog-next-btn');
  if (i >= DIALOGS_AE.length - 1) {
    btn.textContent = 'Girar bolillero →';
    btn.onclick = skipToRoll;
  } else {
    btn.textContent = '▶ Siguiente';
    btn.onclick = nextDialog;
  }
}

function nextDialog() {
  aeDialogIndex++;
  aeDialogIndex >= DIALOGS_AE.length ? skipToRoll() : renderDialog(aeDialogIndex);
}

function skipToRoll() {
  document.querySelector('.aula-pizarron span').textContent = '✦ GIRÁ EL BOLILLERO ✦';
  document.querySelector('.dialog-actions').style.display = 'none';
  document.getElementById('bubble-izq').classList.remove('visible');
  document.getElementById('bubble-der').classList.remove('visible');
  document.getElementById('aula-bolillero').style.display = 'flex';
  document.querySelector('.aula-scene').style.filter = 'brightness(0.05)';
}

function openAutoevaluacion(unidad) {
  aeUnidad = unidad;
  aeRolled = 0;
  aeQuestions = [];
  aeIndex = 0;

  const f = document.getElementById('aeDiceFace');
f.textContent = '';
f.setAttribute('opacity','0');
const bg = document.getElementById('bolillasGroup');
if (bg) bg.style.opacity = '1';

  // Reset dado
  const dice = document.getElementById('aeDice');
  dice.onclick = rollDice;
  dice.style.cursor = 'pointer';
  dice.style.opacity = '1';

  // Reset hint
  const hint = document.querySelector('.ae-dice-hint');
  if (hint) hint.innerHTML = 'Hacé clic en el bolillero';

  // Ocultar botón comenzar si existe
  const startBtn = document.getElementById('ae-start-btn');
  if (startBtn) startBtn.style.display = 'none';

  showAulaStep();
  document.getElementById('ae-step-questions').style.display = 'none';
  document.getElementById('ae-step-done').style.display = 'none';

  document.getElementById('aeOverlay').classList.add('open');
  // Trigger reflow then show modal
  const modal = document.getElementById('aeModal');
  modal.style.display = 'block';
  requestAnimationFrame(() => modal.classList.add('open'));
}

function closeAutoevaluacion() {
  clearInterval(timerInterval);
  const modal = document.getElementById('aeModal');
  modal.classList.remove('open');
  document.getElementById('aeOverlay').classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 200);
  document.getElementById('aula-bolillero').style.display = 'none';
  document.getElementById('ae-step-aula').style.display = 'none';
  document.querySelector('.aula-scene').style.filter = '';
  document.getElementById('aeModal').classList.remove('aula-mode');
  const startBtn = document.getElementById('ae-start-btn');
  if (startBtn) startBtn.style.display = 'none';
  document.getElementById('aeModal').classList.remove('aula-questions');
}

function rollDice() {
  const dice = document.getElementById('aeDice');
  const face = document.getElementById('aeDiceFace');
  dice.classList.add('rolling');

  // Animación intermedia
  let ticks = 0;
  const interval = setInterval(() => {
    face.textContent = DICE_FACES[Math.floor(Math.random() * 6)];
    ticks++;
    if (ticks >= 10) {
      clearInterval(interval);
      aeRolled = Math.floor(Math.random() * 6) + 1;
      face.textContent = DICE_FACES[aeRolled - 1];
face.setAttribute('opacity','0.95');
document.getElementById('bolillasGroup').style.opacity = '0';
dice.classList.remove('rolling');

      // Mostrar resultado antes de pasar a preguntas
      const hint = document.querySelector('.ae-dice-hint');
      if (hint) {
        hint.innerHTML = `<strong style="color:var(--accent2);font-size:16px;">¡Sacaste un ${aeRolled}!</strong><br>
          <span style="color:var(--muted2);font-size:13px;">
            ${aeRolled === 1 ? 'Te toca 1 pregunta' : `Te tocan ${aeRolled} preguntas`}
          </span>`;
      }

      const btn = document.getElementById('ae-start-btn');
btn.style.display = 'block';
btn.onclick = () => {
  document.getElementById('aula-bolillero').style.display = 'none';
  document.getElementById('ae-step-aula').style.display = 'none';
  document.getElementById('aeModal').classList.remove('aula-mode');
  document.querySelector('.aula-scene').style.filter = '';
  buildQuestions(aeRolled);
};

      // Deshabilitar el dado para que no se vuelva a tirar
      dice.onclick = null;
      dice.style.cursor = 'default';
      dice.style.opacity = '0.7';
    }
  }, 60);
}

async function buildQuestions(n) {
  const visibleIds = await getVisibleUserIds();
  let pool = [];

  if (aeUnidad) {
    // Filminas de la unidad
    const matchUnidades = mcUnidades.filter(u =>
  u.numero === aeUnidad &&
  visibleIds.includes(u.alumno_id) &&
  (!currentGrupoId || u.grupo_id === currentGrupoId)
);
    const unidadIds = matchUnidades.map(u => u.id);

    const { data: filminas } = await supabaseClient
      .from('filminas').select('*').in('unidad_id', unidadIds);
    (filminas || []).forEach(t => pool.push({
      pregunta: t.titulo, respuesta: t.contenido,
      tipo: 'filmina', unidad: aeUnidad
    }));

    // Preguntas de final de la unidad
    const { data: preguntas } = await supabaseClient
      .from('preguntas_final').select('*').in('unidad_id', unidadIds);
    (preguntas || []).forEach(p => pool.push({
      pregunta: p.pregunta, respuesta: p.respuesta,
      tipo: 'final', unidad: aeUnidad
    }));

  } else {
    // Global: todas las filminas y preguntas visibles
    const { data: filminas } = await supabaseClient
      .from('filminas').select('*').in('alumno_id', visibleIds);
    (filminas || []).forEach(t => pool.push({
      pregunta: t.titulo, respuesta: t.contenido,
      tipo: 'filmina', unidad: null
    }));

    const { data: preguntas } = await supabaseClient
      .from('preguntas_final').select('*').in('alumno_id', visibleIds);
    (preguntas || []).forEach(p => pool.push({
      pregunta: p.pregunta, respuesta: p.respuesta,
      tipo: 'final', unidad: null
    }));
  }

  if (pool.length === 0) {
    alert('No hay contenido cargado en esta unidad todavía.');
    return;
  }

  const shuffled = pool.sort(() => Math.random() - 0.5);
  aeQuestions = shuffled.slice(0, Math.min(n, pool.length));
  aeIndex = 0;

  document.getElementById('aula-bolillero').style.display = 'none';
document.getElementById('ae-step-aula').style.display = 'none';
document.getElementById('aeModal').classList.remove('aula-mode');
document.querySelector('.aula-scene').style.filter = '';
document.getElementById('ae-step-aula').style.display = 'none';
document.getElementById('aeModal').classList.remove('aula-mode');
document.getElementById('aeModal').classList.add('aula-questions');
  document.getElementById('ae-step-questions').style.display = 'block';
  renderAllQuestions();
}

function renderAllQuestions() {
  aeIndex = 0;
  renderCurrentQuestion();
  startTimer();
}

function renderCurrentQuestion() {
  const container = document.getElementById('ae-all-questions');
  const q = aeQuestions[aeIndex];
  if (!q) return; 
  const uObj = mcUnidades.find(x => x.numero === q.unidad);
  const uLabel = uObj ? `U${q.unidad} — ${uObj.nombre}` : '';

  container.innerHTML = `
    <div class="ae-question-item">
      <div class="ae-q-header">
        <div>
          <div class="ae-q-label">Pregunta ${aeIndex + 1} de ${aeQuestions.length}</div>
          <div class="ae-q-text">${q.pregunta}</div>
          <div class="ae-q-unit">${uLabel}</div>
        </div>
        <button class="ae-mic-btn" id="ae-mic-0" onclick="toggleRecording(0)" title="Grabar respuesta con voz">🎤</button>
      </div>
      <textarea
        class="ae-textarea"
        id="ae-answer-current"
        placeholder="Escribí tu respuesta acá..."
      >${q.respuesta_temp || ''}</textarea>
    </div>
  `;

  document.getElementById('aeQCount').textContent =
    `${aeIndex + 1} / ${aeQuestions.length}`;

  // Mostrar/ocultar botones
  const prevBtn = document.getElementById('exam-prev-btn');
  const nextBtn = document.getElementById('exam-next-btn');
  const finishBtn = document.getElementById('exam-finish-btn');

  prevBtn.style.display = aeIndex === 0 ? 'none' : 'block';

  if (aeIndex === aeQuestions.length - 1) {
    nextBtn.style.display = 'none';
    finishBtn.style.display = 'block';
  } else {
    nextBtn.style.display = 'block';
    finishBtn.style.display = 'none';
  }
}

function saveCurrentAnswer() {
  const ta = document.getElementById('ae-answer-current');
  if (ta && aeQuestions[aeIndex]) aeQuestions[aeIndex].respuesta_temp = ta.value;
}

// ANTES
function nextQuestion() {
  saveCurrentAnswer();
  if (aeIndex < aeQuestions.length - 1) {
    const bubble = document.getElementById('exam-bubble');
    bubble.style.display = 'block';

    setTimeout(() => {
      bubble.style.display = 'none';
      aeIndex++;
      renderCurrentQuestion();
    }, 2000);
  }
}

// DESPUÉS
function nextQuestion() {
  saveCurrentAnswer();
  if (aeIndex < aeQuestions.length - 1) {
    const nextBtn = document.getElementById('exam-next-btn');
    if (nextBtn) nextBtn.disabled = true;

    const bubble = document.getElementById('exam-bubble');
    bubble.style.display = 'block';

    setTimeout(() => {
      bubble.style.display = 'none';
      aeIndex++;
      renderCurrentQuestion();
      if (nextBtn) nextBtn.disabled = false;
    }, 2000);
  }
}

function prevQuestion() {
  saveCurrentAnswer();
  if (aeIndex > 0) {
    aeIndex--;
    renderCurrentQuestion();
  }
}

let timerInterval = null;
let timerSeconds  = 0;

function startTimer() {
  clearInterval(timerInterval);
  timerSeconds = aeQuestions.length * 600;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timerSeconds--;
    updateTimerDisplay();
    if (timerSeconds <= 0) {
      clearInterval(timerInterval);
      document.getElementById('ae-timer').textContent = '⏰ ¡Tiempo!';
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
  const s = String(timerSeconds % 60).padStart(2, '0');
  const el = document.getElementById('ae-timer');
  if (el) {
    el.textContent = `⏱ ${m}:${s}`;
    el.className = 'ae-timer' + (timerSeconds <= 60 ? ' ae-timer-warning' : '');
  }
}

async function finishSession() {
  clearInterval(timerInterval);
  saveCurrentAnswer();

  const respuestas = aeQuestions.map((q) => ({
    pregunta: q.pregunta,
    respuesta: q.respuesta_temp || '',
    unidad: q.unidad,
    tipo: q.tipo
  }));

  // Calcular tiempo usado
  const totalSeconds = aeQuestions.length * 600;
  const usedSeconds  = totalSeconds - timerSeconds;
  const mins = Math.floor(usedSeconds / 60);
  const secs = usedSeconds % 60;
  const tiempoUsado = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

  // Armar sesión para localStorage (backup local)
  const sesionLocal = {
    id: Date.now(),
    fecha: new Date().toLocaleDateString('es-AR'),
    hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    unidad: aeUnidad ? `Unidad ${aeUnidad}` : 'Global',
    cantPreguntas: aeQuestions.length,
    tiempoUsado,
    respuestas
  };

  // Guardar en localStorage
  const historialLocal = JSON.parse(localStorage.getItem(getHistorialKey()) || '[]');
  historialLocal.unshift(sesionLocal);
  localStorage.setItem(getHistorialKey(), JSON.stringify(historialLocal));

  // Guardar en Supabase si hay usuario logueado
  if (currentUser) {
    try {
      // 1. Insertar sesión
      const { data: sesionData, error: sesionError } = await supabaseClient
        .from('sesiones')
        .insert({
          alumno_id: currentUser.id,
          fecha: new Date().toISOString().split('T')[0],
          hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          unidad: aeUnidad ? `Unidad ${aeUnidad}` : 'Global',
          cant_preguntas: aeQuestions.length,
          tiempo_usado: tiempoUsado
        })
        .select()
        .single();

      if (!sesionError && sesionData) {
        // 2. Insertar respuestas
        const respuestasSupabase = respuestas.map(r => ({
          sesion_id: sesionData.id,
          alumno_id: currentUser.id,
          pregunta: r.pregunta,
          respuesta_alumno: r.respuesta,
          unidad: r.unidad,
          tipo: r.tipo
        }));

        await supabaseClient.from('respuestas').insert(respuestasSupabase);
      }
    } catch (e) {
      console.error('Error guardando en Supabase:', e);
    }
  }

  // Mostrar pantalla de fin
  document.getElementById('ae-step-questions').style.display = 'none';
  document.getElementById('ae-step-done').style.display = 'block';
  document.getElementById('aeDoneSub').textContent =
    `Respondiste ${aeQuestions.length} pregunta${aeQuestions.length !== 1 ? 's' : ''} en ${tiempoUsado}. ¡Guardado!`;
}

async function analizarRespuestas() {
  const btn = document.querySelector('.ae-analyze-btn');
  const resultDiv = document.getElementById('ae-analysis-result');
  const textDiv = document.getElementById('ae-analysis-text');

  btn.disabled = true;
  btn.textContent = '⏳ Los profesores están debatiendo...';
document.getElementById('ae-done-profes').style.display = 'flex';
  resultDiv.style.display = 'block';
  textDiv.textContent = 'Analizando tus respuestas...';

  // Armar el prompt con las preguntas y respuestas
  const historial = JSON.parse(localStorage.getItem(getHistorialKey()) || '[]');
  const ultimaSesion = historial[0];

  if (!ultimaSesion) {
    textDiv.textContent = 'No se encontró la sesión.';
    return;
  }

// Obtener unidades involucradas en el test
  const unidadesInvolucradas = [...new Set(ultimaSesion.respuestas.map(r => r.unidad).filter(Boolean))];
  const visibleIds = await getVisibleUserIds();

  // Buscar filminas de esas unidades
  let contextoTeorico = '';
  if (unidadesInvolucradas.length) {
    const matchUnidades = mcUnidades.filter(u => unidadesInvolucradas.includes(u.numero) && visibleIds.includes(u.alumno_id));
    const unidadIds = matchUnidades.map(u => u.id);
    const { data: filminas } = await supabaseClient.from('filminas').select('*, unidades(numero, nombre)').in('unidad_id', unidadIds);
    const grouped = {};
    (filminas || []).forEach(f => {
      const num = f.unidades?.numero;
      if (!grouped[num]) grouped[num] = { nombre: f.unidades?.nombre, items: [] };
      grouped[num].items.push(f);
    });
    contextoTeorico = Object.entries(grouped).map(([num, g]) =>
      `UNIDAD ${num} — ${g.nombre}:\n` +
      g.items.map(f => `- ${f.titulo}: ${f.contenido.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}`).join('\n')
    ).join('\n\n');
  }

  // Buscar preguntas de final de esas unidades
  let contextoPreguntasFinales = '';
  if (unidadesInvolucradas.length) {
    const matchUnidades = mcUnidades.filter(u => unidadesInvolucradas.includes(u.numero) && visibleIds.includes(u.alumno_id));
    const unidadIds = matchUnidades.map(u => u.id);
    const { data: pregs } = await supabaseClient.from('preguntas_final').select('*, unidades(numero, nombre)').in('unidad_id', unidadIds);
    const grouped = {};
    (pregs || []).forEach(p => {
      const num = p.unidades?.numero;
      if (!grouped[num]) grouped[num] = { nombre: p.unidades?.nombre, items: [] };
      grouped[num].items.push(p);
    });
    contextoPreguntasFinales = Object.entries(grouped).map(([num, g]) =>
      `PREGUNTAS DE FINAL U${num} — ${g.nombre}:\n` +
      g.items.map(p => `- ${p.pregunta}${p.respuesta ? '\n  Respuesta esperada: ' + p.respuesta.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim() : ''}`).join('\n')
    ).join('\n\n');
  }  

  // Respuestas del alumno
  const respuestasAlumno = ultimaSesion.respuestas.map((r, i) =>
    `Pregunta ${i + 1}: ${r.pregunta}\nRespuesta del alumno: ${r.respuesta || 'Sin respuesta'}`
  ).join('\n\n');

  const prompt = `Sos un profesor de Contabilidad Básica universitaria.
A continuación te brindo el contenido teórico de la app y las preguntas de final esperadas, seguido de las respuestas que escribió un alumno en su autoevaluación.
Analizá las respuestas del alumno comparándolas con el contenido teórico y las respuestas esperadas.

═══ CONTENIDO TEÓRICO DE LA APP ═══
${contextoTeorico}

═══ PREGUNTAS DE FINAL ESPERADAS ═══
${contextoPreguntasFinales}

═══ RESPUESTAS DEL ALUMNO ═══
${respuestasAlumno}

Por favor respondé con este formato exacto:
✅ CONCEPTOS QUE DOMINÓ BIEN:
(listá los conceptos que respondió correctamente comparando con el contenido de la app)

⚠️ CONCEPTOS CON ERRORES PARCIALES:
(listá los conceptos donde hubo errores o imprecisiones respecto al contenido teórico)

❌ ÁREAS A MEJORAR:
(listá los temas que necesita repasar, con referencia a las filminas específicas)

💡 RECOMENDACIONES:
(sugerencias concretas de qué filminas releer o qué temas profundizar)

Sé específico, constructivo y basate únicamente en el contenido de la app. Si no respondió alguna pregunta, indicalo.`;

  try {
    const response = await fetch(IA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: 1000 })
    });
    const data = await response.json();
    const texto = data.choices?.[0]?.message?.content || 'No se pudo obtener el análisis.';;

    // Formatear el texto con saltos de línea
    textDiv.innerHTML = texto
      .replace(/\n/g, '<br>')
      .replace(/✅/g, '<span style="color:#4ade80">✅</span>')
      .replace(/⚠️/g, '<span style="color:#fbbf24">⚠️</span>')
      .replace(/❌/g, '<span style="color:#f87171">❌</span>')
      .replace(/💡/g, '<span style="color:#7ab3ff">💡</span>');

    btn.textContent = '✓ Devolución lista';

    // Guardar análisis en localStorage
    historial[0].analisis = texto;
    localStorage.setItem(getHistorialKey(), JSON.stringify(historial));

    // Guardar análisis en Supabase
    if (currentUser) {
      try {
        // Buscar la última sesión del usuario
        const { data: ultimaSesion } = await supabaseClient
          .from('sesiones')
          .select('id')
          .eq('alumno_id', currentUser.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (ultimaSesion) {
          await supabaseClient.from('analisis').insert({
            sesion_id: ultimaSesion.id,
            alumno_id: currentUser.id,
            texto_analisis: texto
          });
        }
      } catch (e) {
        console.error('Error guardando análisis en Supabase:', e);
      }
    }

  } catch (error) {
    textDiv.textContent = 'Error al conectar con la IA. Intentá de nuevo.';
    btn.disabled = false;
    btn.textContent = '👨‍🏫 Devolución de los profesores';
  }
}

async function renderHistorial() {
  const container = document.getElementById('ae-historial-container');
  if (!container) return;

  let historial = [];

  if (currentPerfil && (currentPerfil.rol === 'admin' || currentPerfil.rol === 'superadmin')) {
    // Admin: leer todas las sesiones de Supabase
    const { data: sesiones } = await supabaseClient
      .from('sesiones')
      .select(`
        *,
        respuestas (*),
        analisis (*),
        perfiles (nombre, email)
      `)
      .order('created_at', { ascending: false });

    if (sesiones) {
      historial = sesiones.map(s => ({
        id: s.id,
        fecha: new Date(s.created_at).toLocaleDateString('es-AR'),
        fechaISO: new Date(s.created_at).toLocaleDateString('en-CA'),
        hora: new Date(s.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        unidad: s.unidad,
        cantPreguntas: s.cant_preguntas,
        tiempoUsado: s.tiempo_usado,
        alumno: s.perfiles 
  ? `${Array.isArray(s.perfiles) ? s.perfiles[0]?.nombre : s.perfiles.nombre} (${Array.isArray(s.perfiles) ? s.perfiles[0]?.email : s.perfiles.email})`
  : 'Desconocido',
        respuestas: s.respuestas.map(r => ({
          pregunta: r.pregunta,
          respuesta: r.respuesta_alumno
        })),
        analisis: s.analisis?.[0]?.texto_analisis || null
      }));
    }
  } else {
    // Alumno: leer de Supabase
    const { data: sesiones } = await supabaseClient
      .from('sesiones')
      .select('*, respuestas(*), analisis(*)')
      .eq('alumno_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (sesiones) {
      historial = sesiones.map(s => ({
        id: s.id,
        fecha: new Date(s.created_at).toLocaleDateString('es-AR'),
        fechaISO: new Date(s.created_at).toLocaleDateString('en-CA'),
        hora: new Date(s.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        unidad: s.unidad,
        cantPreguntas: s.cant_preguntas,
        tiempoUsado: s.tiempo_usado,
        respuestas: s.respuestas.map(r => ({
          pregunta: r.pregunta,
          respuesta: r.respuesta_alumno
        })),
        analisis: s.analisis?.[0]?.texto_analisis || null
      }));
    }
  }

  if (historial.length === 0) {
    container.innerHTML = `
      <div class="unit-empty">
        <div class="ue-icon">📋</div>
        <h4>Sin historial aún</h4>
        <p>Completá una autoevaluación para ver tus resultados acá.</p>
      </div>`;
    return;
  }

  const renderCards = (lista) => lista.map((sesion, si) => `
    <div class="historial-card">
      <div class="historial-header" onclick="toggleHistorialCard('hdet-${si}')">
        <div class="historial-info">
          ${sesion.alumno ? `<div class="historial-alumno">👤 ${sesion.alumno}</div>` : ''}
          <div class="historial-fecha">📅 ${sesion.fecha} · ${sesion.hora}</div>
          <div class="historial-meta">
            <span class="meta-tag u-tag">${sesion.unidad}</span>
            <span class="meta-tag">${sesion.cantPreguntas} pregunta${sesion.cantPreguntas !== 1 ? 's' : ''}</span>
            <span class="meta-tag">⏱ ${sesion.tiempoUsado}</span>
          </div>
        </div>
        <button class="card-toggle">▼</button>
      </div>
      <div class="historial-detalle" id="hdet-${si}" style="display:none">
        ${sesion.analisis ? `
          <div class="historial-analisis">
            <div class="ae-a-label">🤖 Análisis de IA</div>
            <div class="historial-analisis-text">${sesion.analisis
              .replace(/\n/g, '<br>')
              .replace(/✅/g, '<span style="color:#4ade80">✅</span>')
              .replace(/⚠️/g, '<span style="color:#fbbf24">⚠️</span>')
              .replace(/❌/g, '<span style="color:#f87171">❌</span>')
              .replace(/💡/g, '<span style="color:#7ab3ff">💡</span>')
            }</div>
          </div>
        ` : ''}
        ${sesion.respuestas.map((r, ri) => `
          <div class="historial-item">
            <div class="historial-pregunta">
              <span class="card-num">${ri + 1}</span>
              ${r.pregunta}
            </div>
            <div class="historial-respuesta">
              ${r.respuesta
                ? `<div class="resp-text">${r.respuesta}</div>`
                : `<div class="resp-text" style="color:var(--muted);font-style:italic">Sin respuesta</div>`
              }
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <input type="date" id="ae-filtro-fecha" style="background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;padding:6px 12px;color:var(--white);font-size:13px;outline:none;cursor:pointer;" onchange="filtrarHistorialTests()">
      <button onclick="document.getElementById('ae-filtro-fecha').value=''; filtrarHistorialTests()" style="background:transparent;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:4px 8px;">✕ Limpiar</button>
    </div>
    <div id="ae-historial-lista">${renderCards(historial)}</div>
  `;

  document.getElementById('ae-filtro-fecha')._historial = historial;
  window._renderHistorialCards = renderCards;
}

function toggleHistorialCard(id) {
  const el = document.getElementById(id);
  const btn = el.previousElementSibling.querySelector('.card-toggle');
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'block';
  btn.style.transform = isOpen ? '' : 'rotate(180deg)';
}

function filtrarHistorialTests() {
  const fecha = document.getElementById('ae-filtro-fecha').value;
  const historial = document.getElementById('ae-filtro-fecha')._historial;
  const lista = document.getElementById('ae-historial-lista');

  const filtrado = fecha
    ? historial.filter(s => s.fechaISO === fecha)
    : historial;

  if (!filtrado.length) {
    lista.innerHTML = '<p style="color:var(--muted2);font-size:13px;padding:8px 0">No hay tests para esa fecha.</p>';
    return;
  }

  lista.innerHTML = window._renderHistorialCards(filtrado);
}


function showDone() {
  document.getElementById('ae-step-questions').style.display = 'none';
  document.getElementById('ae-step-done').style.display = 'block';
  document.getElementById('aeDoneSub').textContent =
    `Repasaste ${aeQuestions.length} tema${aeQuestions.length !== 1 ? 's' : ''} al azar. ¡Bien hecho!`;
}

function restartAutoevaluacion() {
  openAutoevaluacion(aeUnidad);
}

/* ════════════════════════════════════════════════
   SIDEBAR MOBILE
   ════════════════════════════════════════════════ */

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

/* ════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  init();
});
  /* ════════════════════════════════════════════════
   MI CONTENIDO
   ════════════════════════════════════════════════ */

let mcUnidades = []; // unidades del usuario cargadas de Supabase

function showMCTab(tab) {
  ['unidades','filminas','preguntas','vf'].forEach(t => {
    const el = document.getElementById(`mc-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`mctab-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'filminas' || tab === 'preguntas' || tab === 'vf') cargarSelectUnidades();
  if (tab === 'vf') cargarVF();
}

// ── UNIDADES ──

function showFormUnidad() {
  document.getElementById('mc-form-unidad').style.display = 'block';
  document.getElementById('mc-unidad-numero').value = '';
  document.getElementById('mc-unidad-nombre').value = '';
  if (currentPerfil?.rol === 'superadmin') {
    document.getElementById('mc-unidad-grupo-wrap').style.display = 'block';
    cargarSelectGrupos('mc-unidad-grupo');
  } else {
    // Para alumnos también mostrar selector con sus propias materias
    document.getElementById('mc-unidad-grupo-wrap').style.display = 'block';
    cargarSelectGruposAlumno('mc-unidad-grupo');
  }
}

function cancelarFormUnidad() {
  document.getElementById('mc-form-unidad').style.display = 'none';
  editandoUnidadId = null;
  document.querySelector('#mc-form-unidad .ae-finish-btn').textContent = 'Guardar';
}

async function guardarUnidad() {
  const numero = parseInt(document.getElementById('mc-unidad-numero').value);
  const nombre = document.getElementById('mc-unidad-nombre').value.trim();

  if (!numero || !nombre) { alert('Completá todos los campos.'); return; }

  if (editandoUnidadId) {
    // MODO EDICIÓN
    const { error } = await supabaseClient.from('unidades')
      .update({ numero, nombre })
      .eq('id', editandoUnidadId);
    if (error) { alert('Error al actualizar: ' + error.message); return; }
    editandoUnidadId = null;
  } else {
    // MODO CREACIÓN
    const grupoId = currentPerfil?.rol === 'superadmin'
      ? document.getElementById('mc-unidad-grupo')?.value || currentPerfil?.grupo_id
      : document.getElementById('mc-unidad-grupo')?.value || currentPerfil?.grupo_id;

    const { error } = await supabaseClient.from('unidades').insert({
      alumno_id: currentUser.id,
      numero, nombre,
      grupo_id: grupoId
    });
    if (error) { alert('Error al guardar: ' + error.message); return; }
  }

  cancelarFormUnidad();
  cargarUnidades();
}

async function cargarUnidades() {
  const { data } = await supabaseClient
    .from('unidades')
    .select('*')
    .eq('alumno_id', currentUser.id)
    .order('numero');

  mcUnidades = data || [];

  const lista = document.getElementById('mc-lista-unidades');
  if (mcUnidades.length === 0) {
    lista.innerHTML = `<div class="unit-empty"><div class="ue-icon">📂</div><h4>Sin unidades aún</h4><p>Creá tu primera unidad.</p></div>`;
    return;
  }

  // Traer grupos
  const { data: grupos } = await supabaseClient.from('grupos').select('id, nombre');
  const gruposLookup = {};
  (grupos || []).forEach(g => gruposLookup[g.id] = g.nombre);

  // Enriquecer mcUnidades con el nombre del grupo
mcUnidades = mcUnidades.map(u => ({
  ...u,
  grupo_nombre: u.grupos?.nombre || 'Sin materia'
}));

  // Agrupar unidades por grupo_id
  const agrupadas = {};
  mcUnidades.forEach(u => {
    const gId = u.grupo_id || 'sin-grupo';
    const gNombre = gruposLookup[u.grupo_id] || 'Sin grupo';
    if (!agrupadas[gId]) agrupadas[gId] = { nombre: gNombre, unidades: [] };
    agrupadas[gId].unidades.push(u);
  });

  lista.innerHTML = Object.entries(agrupadas).map(([gId, g], idx) => `
    <div class="mc-grupo-unidad">
      <div class="mc-grupo-header" onclick="toggleGrupoUnidades(${idx})">
        <span class="mc-grupo-title">📂 ${g.nombre} (${g.unidades.length})</span>
        <span class="mc-grupo-toggle" id="mc-grupo-unidades-toggle-${idx}">▼</span>
      </div>
      <div class="mc-grupo-items" id="mc-grupo-unidades-items-${idx}" style="display:none">
        ${g.unidades.map(u => `
          <div class="mc-item">
            <div class="mc-item-info">
              <span class="mc-item-num">${u.numero}</span>
              <span class="mc-item-nombre">${u.nombre}</span>
            </div>
            <button class="mc-delete-btn" onclick="editarUnidad(${u.id})" style="margin-right:6px">✏️</button>
            <button class="mc-delete-btn" onclick="borrarUnidad(${u.id})">🗑</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function toggleGrupoUnidades(idx) {
  const items = document.getElementById(`mc-grupo-unidades-items-${idx}`);
  const toggle = document.getElementById(`mc-grupo-unidades-toggle-${idx}`);
  const visible = items.style.display !== 'none';
  items.style.display = visible ? 'none' : 'block';
  if (toggle) toggle.textContent = visible ? '▼' : '▲';
}

async function borrarUnidad(id) {
  if (!confirm('¿Borrar esta unidad y todo su contenido?')) return;
  await supabaseClient.from('unidades').delete().eq('id', id);
  cargarUnidades();
}

// ── FILMINAS ──

function showFormFilmina() {
  document.getElementById('mc-form-filmina').style.display = 'block';
  document.getElementById('mc-filmina-titulo').value = '';
  document.getElementById('mc-filmina-contenido').value = '';
  document.getElementById('mc-filmina-keywords').value = '';
  if (currentPerfil?.rol === 'superadmin') {
    document.getElementById('mc-filmina-grupo-wrap').style.display = 'block';
    cargarSelectGrupos('mc-filmina-grupo');
  }
}

function cancelarFormFilmina() {
  document.getElementById('mc-form-filmina').style.display = 'none';
  document.getElementById('mc-filmina-imagen').value = '';
  document.getElementById('mc-filmina-imagen-preview').innerHTML = '';
  editandoFilminaId = null;
  document.querySelector('#mc-form-filmina .ae-finish-btn').textContent = 'Guardar';
}

async function guardarFilmina() {
  const unidad_id = document.getElementById('mc-filmina-unidad').value;
  const titulo    = document.getElementById('mc-filmina-titulo').value.trim();
  const contenido = document.getElementById('mc-filmina-contenido').value.trim();
  const keywords  = document.getElementById('mc-filmina-keywords').value.trim();
  const imagenFile = document.getElementById('mc-filmina-imagen').files[0];

  if (!unidad_id || !titulo) { alert('Seleccioná una unidad y escribí un título.'); return; }

  // Subir imagen si hay nueva
  let imagen_url = null;
  if (imagenFile) {
    const nombreLimpio = imagenFile.name
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quita tildes
  .replace(/[^a-zA-Z0-9.-]/g, '_');  // reemplaza espacios y otros por _
const fileName = `${Date.now()}_${nombreLimpio}`;
    const { error: uploadError } = await supabaseClient.storage
      .from('filminas-imagenes').upload(fileName, imagenFile);
    if (uploadError) { alert('Error al subir imagen: ' + uploadError.message); return; }
    const { data: { publicUrl } } = supabaseClient.storage
      .from('filminas-imagenes').getPublicUrl(fileName);
    imagen_url = publicUrl;
  }

  if (editandoFilminaId) {
    const updateData = { unidad_id: parseInt(unidad_id), titulo, contenido, keywords };
    if (imagen_url) updateData.imagen_url = imagen_url;
    const { error } = await supabaseClient.from('filminas')
      .update(updateData).eq('id', editandoFilminaId);
    if (error) { alert('Error al actualizar: ' + error.message); return; }
    editandoFilminaId = null;
  } else {
    const grupoId = currentPerfil?.rol === 'superadmin'
      ? document.getElementById('mc-filmina-grupo')?.value || currentPerfil?.grupo_id
      : currentPerfil?.grupo_id;

    const { error } = await supabaseClient.from('filminas').insert({
      alumno_id: currentUser.id,
      unidad_id: parseInt(unidad_id),
      titulo, contenido, keywords,
      orden: 0, grupo_id: grupoId, imagen_url
    });
    if (error) { alert('Error al guardar: ' + error.message); return; }
  }

  cancelarFormFilmina();
  cargarFilminas();
}

async function cargarFilminas() {
  const { data } = await supabaseClient
    .from('filminas')
    .select('*, unidades(id, numero, nombre, grupo_id)')
    .eq('alumno_id', currentUser.id)
    .order('created_at');

  const lista = document.getElementById('mc-lista-filminas');
  if (!data || data.length === 0) {
    lista.innerHTML = `<div class="unit-empty"><div class="ue-icon">📄</div><h4>Sin filminas aún</h4><p>Creá tu primera filmina.</p></div>`;
    return;
  }

  // Traer grupos
  const { data: grupos } = await supabaseClient.from('grupos').select('id, nombre');
  const gruposLookup = {};
  (grupos || []).forEach(g => gruposLookup[g.id] = g.nombre);

  // Agrupar por materia (grupo) → unidad
  const materias = {};
  data.forEach(f => {
    const gId = f.unidades?.grupo_id || 'sin-materia';
    const gNombre = gruposLookup[f.unidades?.grupo_id] || 'Sin materia';
    const uId = f.unidades?.id || 'sin-unidad';
    const uNombre = f.unidades ? `U${f.unidades.numero} — ${f.unidades.nombre}` : 'Sin unidad';

    if (!materias[gId]) materias[gId] = { nombre: gNombre, unidades: {} };
    if (!materias[gId].unidades[uId]) materias[gId].unidades[uId] = { nombre: uNombre, filminas: [] };
    materias[gId].unidades[uId].filminas.push(f);
  });

  let html = '';
  let mIdx = 0;
  Object.entries(materias).forEach(([gId, materia]) => {
    const totalFilminas = Object.values(materia.unidades).reduce((a, u) => a + u.filminas.length, 0);
    html += `
      <div class="mc-grupo-unidad">
        <div class="mc-grupo-header" onclick="toggleGrupoMateriaFilminas(${mIdx})">
          <span class="mc-grupo-title">📂 ${materia.nombre} (${totalFilminas})</span>
          <span class="mc-grupo-toggle" id="mc-mf-toggle-${mIdx}">▼</span>
        </div>
        <div id="mc-mf-items-${mIdx}" style="display:none;padding:8px">`;

    let uIdx = 0;
    Object.entries(materia.unidades).forEach(([uId, unidad]) => {
      const uKey = `${mIdx}_${uIdx}`;
      html += `
          <div class="mc-grupo-unidad" style="margin-bottom:8px">
            <div class="mc-grupo-header" onclick="toggleGrupoUnidadFilminas('${uKey}')" style="background:var(--dark2)">
              <span class="mc-grupo-title" style="font-size:13px">📘 ${unidad.nombre} (${unidad.filminas.length})</span>
              <span class="mc-grupo-toggle" id="mc-uf-toggle-${uKey}">▼</span>
            </div>
            <div id="mc-uf-items-${uKey}" style="display:none;background:var(--dark2,#0f0f1a);padding:8px">
              ${unidad.filminas.map(f => `
                <div class="mc-item">
                  <div class="mc-item-info">
                    <span class="mc-item-nombre">${f.titulo}</span>
                  </div>
                  <button class="mc-delete-btn" onclick="editarFilmina(${f.id})" style="margin-right:6px">✏️</button>
                  <button class="mc-delete-btn" onclick="borrarFilmina(${f.id})">🗑</button>
                </div>
              `).join('')}
            </div>
          </div>`;
      uIdx++;
    });

    html += `</div></div>`;
    mIdx++;
  });

  lista.innerHTML = html;
}

function toggleGrupoMateriaFilminas(idx) {
  const items = document.getElementById(`mc-mf-items-${idx}`);
  const toggle = document.getElementById(`mc-mf-toggle-${idx}`);
  const visible = items.style.display !== 'none';
  items.style.display = visible ? 'none' : 'block';
  if (toggle) toggle.textContent = visible ? '▼' : '▲';
}

function toggleGrupoUnidadFilminas(key) {
  const items = document.getElementById(`mc-uf-items-${key}`);
  const toggle = document.getElementById(`mc-uf-toggle-${key}`);
  const visible = items.style.display !== 'none';
  items.style.display = visible ? 'none' : 'block';
  if (toggle) toggle.textContent = visible ? '▼' : '▲';
}

function toggleGrupoFilminas(idx) {
  const items = document.getElementById(`mc-grupo-items-${idx}`);
  const toggle = document.getElementById(`mc-grupo-toggle-${idx}`);
  const visible = items.style.display !== 'none';
  items.style.display = visible ? 'none' : 'block';
  if (toggle) toggle.textContent = visible ? '▼' : '▲';
}

async function borrarFilmina(id) {
  if (!confirm('¿Borrar esta filmina?')) return;
  await supabaseClient.from('filminas').delete().eq('id', id);
  cargarFilminas();
}

// ── PREGUNTAS ──

function showFormPregunta() {
  document.getElementById('mc-form-pregunta').style.display = 'block';
  document.getElementById('mc-pregunta-texto').value = '';
  document.getElementById('mc-pregunta-respuesta').value = '';
  if (currentPerfil?.rol === 'superadmin') {
    document.getElementById('mc-pregunta-grupo-wrap').style.display = 'block';
    cargarSelectGrupos('mc-pregunta-grupo');
  }
}

function cancelarFormPregunta() {
  document.getElementById('mc-form-pregunta').style.display = 'none';
  editandoPreguntaId = null;
  document.querySelector('#mc-form-pregunta .ae-finish-btn').textContent = 'Guardar';
}

async function guardarPregunta() {
  const unidad_id = document.getElementById('mc-pregunta-unidad').value;
  const pregunta  = document.getElementById('mc-pregunta-texto').value.trim();
  const respuesta = document.getElementById('mc-pregunta-respuesta').value.trim();

  if (!unidad_id || !pregunta) { alert('Seleccioná una unidad y escribí la pregunta.'); return; }

  if (editandoPreguntaId) {
    const { error } = await supabaseClient.from('preguntas_final')
      .update({ unidad_id: parseInt(unidad_id), pregunta, respuesta })
      .eq('id', editandoPreguntaId);
    if (error) { alert('Error al actualizar: ' + error.message); return; }
    editandoPreguntaId = null;
  } else {
    const grupoId = currentPerfil?.rol === 'superadmin'
      ? document.getElementById('mc-pregunta-grupo')?.value || currentPerfil?.grupo_id
      : currentPerfil?.grupo_id;

    const { error } = await supabaseClient.from('preguntas_final').insert({
      alumno_id: currentUser.id,
      unidad_id: parseInt(unidad_id),
      pregunta, respuesta,
      grupo_id: grupoId
    });
    if (error) { alert('Error al guardar: ' + error.message); return; }
  }

  cancelarFormPregunta();
  cargarPreguntasMC();
}

async function cargarPreguntasMC() {
  const { data } = await supabaseClient
    .from('preguntas_final')
    .select('*, unidades(id, numero, nombre, grupo_id)')
    .eq('alumno_id', currentUser.id)
    .order('created_at');

  const lista = document.getElementById('mc-lista-preguntas');
  if (!data || data.length === 0) {
    lista.innerHTML = `<div class="unit-empty"><div class="ue-icon">❓</div><h4>Sin preguntas aún</h4><p>Creá tu primera pregunta.</p></div>`;
    return;
  }

  // Traer grupos
  const { data: grupos } = await supabaseClient.from('grupos').select('id, nombre');
  const gruposLookup = {};
  (grupos || []).forEach(g => gruposLookup[g.id] = g.nombre);

  // Agrupar por materia → unidad
  const materias = {};
  data.forEach(p => {
    const gId = p.unidades?.grupo_id || 'sin-materia';
    const gNombre = gruposLookup[p.unidades?.grupo_id] || 'Sin materia';
    const uId = p.unidades?.id || 'sin-unidad';
    const uNombre = p.unidades ? `U${p.unidades.numero} — ${p.unidades.nombre}` : 'Sin unidad';

    if (!materias[gId]) materias[gId] = { nombre: gNombre, unidades: {} };
    if (!materias[gId].unidades[uId]) materias[gId].unidades[uId] = { nombre: uNombre, preguntas: [] };
    materias[gId].unidades[uId].preguntas.push(p);
  });

  let html = '';
  let mIdx = 0;
  Object.entries(materias).forEach(([gId, materia]) => {
    const totalPreguntas = Object.values(materia.unidades).reduce((a, u) => a + u.preguntas.length, 0);
    html += `
      <div class="mc-grupo-unidad">
        <div class="mc-grupo-header" onclick="toggleGrupoMateriaPreguntas(${mIdx})">
          <span class="mc-grupo-title">📂 ${materia.nombre} (${totalPreguntas})</span>
          <span class="mc-grupo-toggle" id="mc-mp-toggle-${mIdx}">▼</span>
        </div>
        <div id="mc-mp-items-${mIdx}" style="display:none;padding:8px">`;

    let uIdx = 0;
    Object.entries(materia.unidades).forEach(([uId, unidad]) => {
      const uKey = `${mIdx}_${uIdx}`;
      html += `
          <div class="mc-grupo-unidad" style="margin-bottom:8px">
            <div class="mc-grupo-header" onclick="toggleGrupoUnidadPreguntas('${uKey}')" style="background:var(--dark2)">
              <span class="mc-grupo-title" style="font-size:13px">📘 ${unidad.nombre} (${unidad.preguntas.length})</span>
              <span class="mc-grupo-toggle" id="mc-up-toggle-${uKey}">▼</span>
            </div>
            <div id="mc-up-items-${uKey}" style="display:none;background:var(--dark2,#0f0f1a);padding:8px">
              ${unidad.preguntas.map(p => `
                <div class="mc-item">
                  <div class="mc-item-info">
                    <span class="mc-item-nombre">${p.pregunta}</span>
                  </div>
                  <button class="mc-delete-btn" onclick="editarPregunta(${p.id})" style="margin-right:6px">✏️</button>
                  <button class="mc-delete-btn" onclick="borrarPreguntaMC(${p.id})">🗑</button>
                </div>
              `).join('')}
            </div>
          </div>`;
      uIdx++;
    });

    html += `</div></div>`;
    mIdx++;
  });

  lista.innerHTML = html;
}

function toggleGrupoMateriaPreguntas(idx) {
  const items = document.getElementById(`mc-mp-items-${idx}`);
  const toggle = document.getElementById(`mc-mp-toggle-${idx}`);
  const visible = items.style.display !== 'none';
  items.style.display = visible ? 'none' : 'block';
  if (toggle) toggle.textContent = visible ? '▼' : '▲';
}

function toggleGrupoUnidadPreguntas(key) {
  const items = document.getElementById(`mc-up-items-${key}`);
  const toggle = document.getElementById(`mc-up-toggle-${key}`);
  const visible = items.style.display !== 'none';
  items.style.display = visible ? 'none' : 'block';
  if (toggle) toggle.textContent = visible ? '▼' : '▲';
}

async function borrarPreguntaMC(id) {
  if (!confirm('¿Borrar esta pregunta?')) return;
  await supabaseClient.from('preguntas_final').delete().eq('id', id);
  cargarPreguntasMC();
}

// ── HELPERS ──

async function cargarSelectUnidades() {
  const { data } = await supabaseClient
    .from('unidades')
    .select('*')
    .eq('alumno_id', currentUser.id)
    .order('numero');

  mcUnidades = data || [];

  // Traer grupos
  const { data: grupos } = await supabaseClient.from('grupos').select('id, nombre');
  const gruposLookup = {};
  (grupos || []).forEach(g => gruposLookup[g.id] = g.nombre);

  // Agrupar unidades por grupo
  const agrupadas = {};
  mcUnidades.forEach(u => {
    const gNombre = gruposLookup[u.grupo_id] || 'Sin grupo';
    if (!agrupadas[gNombre]) agrupadas[gNombre] = [];
    agrupadas[gNombre].push(u);
  });

  // Armar HTML con optgroups
  let optionsHtml = '<option value="">Seleccioná una unidad</option>';
  Object.entries(agrupadas).forEach(([gNombre, unidades]) => {
    optionsHtml += `<optgroup label="📂 ${gNombre}">`;
    unidades.forEach(u => {
      optionsHtml += `<option value="${u.id}" data-grupo="${u.grupo_id}">U${u.numero} — ${u.nombre}</option>`;
    });
    optionsHtml += '</optgroup>';
  });

  ['mc-filmina-unidad', 'mc-pregunta-unidad', 'mc-vf-unidad'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = optionsHtml;
  });
}

/* ════════════════════════════════════════════════
   PDF → FILMINAS CON IA
   ════════════════════════════════════════════════ */

async function procesarPDF(input) {
  const file = input.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    alert('Solo se aceptan archivos PDF.');
    input.value = '';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert('El archivo es demasiado grande. Máximo 5MB.');
    input.value = '';
    return;
  }

  const unidadId = document.getElementById('mc-filmina-unidad').value;
if (!unidadId) {
  alert('Primero seleccioná una unidad en el formulario de filminas.');
  input.value = '';
  return;
}

// Guardar grupo_id en el momento de selección
const selectEl = document.getElementById('mc-filmina-unidad');
const selectedOption = selectEl?.options[selectEl.selectedIndex];
const grupoIdCapturado = selectedOption?.dataset?.grupo || currentPerfil?.grupo_id;

  let preview = document.getElementById('mc-pdf-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'mc-pdf-preview';
    preview.className = 'mc-pdf-preview';
    document.getElementById('mc-lista-filminas').before(preview);
  }
  preview.innerHTML = `<div class="mc-pdf-preview-title">⏳ Leyendo PDF...</div>`;

  try {
    // Extraer texto con pdf.js
    const arrayBuffer = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    if (pdf.numPages > 40) {
  alert(`El PDF tiene ${pdf.numPages} páginas. Máximo 40 páginas.`);
      input.value = '';
      preview.innerHTML = '';
      return;
    }

    let textoCompleto = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const textoPagina = content.items.map(item => item.str).join(' ');
      textoCompleto += `\n--- Página ${i} ---\n${textoPagina}`;
    }

    if (textoCompleto.trim().length < 50) {
      alert('No se pudo extraer texto del PDF. Es posible que sea un archivo escaneado o de solo imágenes.');
      input.value = '';
      preview.innerHTML = '';
      return;
    }

    preview.innerHTML = `<div class="mc-pdf-preview-title">⏳ Generando filminas con IA...</div>`;

    // Dividir texto en bloques de 6000 chars para no perder nada
    const CHUNK_SIZE = 6000;
    const chunks = [];
    for (let i = 0; i < textoCompleto.length; i += CHUNK_SIZE) {
      chunks.push(textoCompleto.slice(i, i + CHUNK_SIZE));
    }

    let todasFilminas = [];

    for (let ci = 0; ci < chunks.length; ci++) {
      preview.innerHTML = `<div class="mc-pdf-preview-title">⏳ Procesando bloque ${ci + 1} de ${chunks.length}...</div>`;

      const response = await fetch(IA_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    max_tokens: 4000,
    messages: [{ role: 'user', content: `Sos un profesor universitario. Analizá este fragmento de material de estudio y creá una filmina detallada por cada concepto, definición o tema que aparezca.

REGLAS IMPORTANTES:
- Una filmina por concepto, NO agrupes varios en una sola
- El contenido debe ser COMPLETO y DETALLADO, incluyendo toda la información del texto
- Usá ejemplos y explicaciones del texto original, no los simplifiques
- No omitas ningún concepto aunque parezca menor
- Devolvé SOLO un JSON array, sin texto adicional ni backticks

FORMATO:
[
  {
    "titulo": "Nombre del concepto",
    "contenido": "<p>Explicación completa y detallada con todos los datos del texto.</p><ul><li>Punto importante 1</li><li>Punto importante 2</li></ul>",
    "keywords": "palabra1, palabra2, palabra3"
  }
]

FRAGMENTO DEL PDF:
${chunks[ci]}` }]
  })
});

const data = await response.json();
const texto = data.choices?.[0]?.message?.content || '';
console.log('Cerebras response:', data);
console.log('Texto:', texto.substring(0, 300));

      try {
        const jsonMatch = texto.match(/\[[\s\S]*\]/);
        const clean = jsonMatch ? jsonMatch[0] : texto.trim();
        const bloque = JSON.parse(clean);
        todasFilminas = todasFilminas.concat(bloque);
      } catch (e) {
        console.warn(`Error en bloque ${ci + 1}:`, texto.substring(0, 200));
      }

      // Pausa entre llamadas para no saturar la API
      if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 13000));
    }

    const filminas = todasFilminas;

    if (!filminas.length) {
      preview.innerHTML = `<div class="mc-pdf-preview-title">❌ No se encontraron temas en el PDF.</div>`;
      return;
    }

    preview.innerHTML = `
      <div class="mc-pdf-preview-title">
        ✅ Se encontraron ${filminas.length} filminas
        <span style="font-size:12px;color:var(--muted2)">Revisá y guardá</span>
      </div>
      ${filminas.map((f, i) => `
        <div class="mc-pdf-filmina">
          <h4>${i + 1}. ${f.titulo}</h4>
          <p>${f.contenido.replace(/<[^>]*>/g, ' ').substring(0, 120)}...</p>
        </div>
      `).join('')}
      <button class="mc-pdf-save-btn" onclick="guardarFilminasPDF(${JSON.stringify(filminas).replace(/"/g, '&quot;')}, ${unidadId}, '${grupoIdCapturado}')">
        💾 Guardar todas las filminas
      </button>
    `;

  } catch (e) {
    preview.innerHTML = `<div class="mc-pdf-preview-title">❌ Error de conexión. Intentá de nuevo.</div>`;
    console.error(e);
  }

  input.value = '';
}

async function guardarFilminasPDF(filminas, unidadId, grupoId) {
  const btn = document.querySelector('.mc-pdf-save-btn');
  btn.textContent = '⏳ Guardando...';
  btn.disabled = true;

  const rows = filminas.map((f, i) => ({
    alumno_id: currentUser.id,
    unidad_id: parseInt(unidadId),
    titulo: f.titulo,
    contenido: f.contenido,
    keywords: f.keywords,
    orden: i,
    grupo_id: grupoId
  }));

  const { error } = await supabaseClient.from('filminas').insert(rows);

  if (error) {
    alert('Error al guardar: ' + error.message);
    btn.textContent = '💾 Guardar todas las filminas';
    btn.disabled = false;
    return;
  }

  document.getElementById('mc-pdf-preview').remove();
  cargarFilminas();
  alert(`✅ ${filminas.length} filminas guardadas correctamente.`);
}

/* ════════════════════════════════════════════════
   TRANSCRIPCIÓN DE VOZ CON GROQ WHISPER
   ════════════════════════════════════════════════ */

const GROQ_KEY = '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';

let mediaRecorder = null;
let audioChunks = [];
let activeRecordingIndex = null;
let autoStopTimeout = null;

function toggleRecording(index) {
  if (activeRecordingIndex === index) {
    stopRecording();
  } else {
    if (activeRecordingIndex !== null) stopRecording();
    startRecording(index);
  }
}

async function startRecording(index) {
  const btn = document.getElementById(`ae-mic-${index}`);
  const textarea = document.getElementById(`ae-answer-current`);
  if (!btn || !textarea) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    activeRecordingIndex = index;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // Detener todos los tracks del micrófono
      stream.getTracks().forEach(t => t.stop());

      btn.innerHTML = '⏳';
      btn.disabled = true;

      try {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.webm');
        formData.append('model', 'whisper-large-v3');
        formData.append('language', 'es');
        formData.append('response_format', 'json');

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_KEY}` },
          body: formData
        });

        const result = await response.json();
        if (result.text) {
          textarea.value += (textarea.value ? ' ' : '') + result.text.trim();
        } else {
          console.error('Groq error:', result);
          alert('No se pudo transcribir. Intentá de nuevo.');
        }
      } catch (e) {
        console.error('Error transcripción:', e);
        alert('Error de conexión al transcribir.');
      }

      btn.innerHTML = '🎤';
      btn.disabled = false;
      btn.classList.remove('recording');
      activeRecordingIndex = null;
    };

     mediaRecorder.start();
    btn.classList.add('recording');
    btn.innerHTML = '⏹';

    // Auto-stop a los 5 minutos
    autoStopTimeout = setTimeout(() => {
      stopRecording();
    }, 5 * 60 * 1000);

  } catch (e) {
    alert('No se pudo acceder al micrófono. Verificá los permisos.');
    console.error(e);
  }
}

function stopRecording() {
  if (autoStopTimeout) {
    clearTimeout(autoStopTimeout);
    autoStopTimeout = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}
/* ════════════════════════════════════════════════
   PANEL SUPERADMIN
   ════════════════════════════════════════════════ */

async function cargarPanelSuperadmin() {
  await Promise.all([
    cargarPendientes(),
    cargarActivos(),
    cargarGrupos(),
    cargarEstadisticas()
  ]);
}

function leerFilmina(btn, textoEncoded) {
  const texto = decodeURIComponent(textoEncoded).substring(0, 1000);

  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    btn.textContent = '🔊';
    return;
  }

  const utterance = new SpeechSynthesisUtterance(texto);
  utterance.lang = 'es-AR';
  utterance.rate = 0.95;

  // Intentar usar una voz en español si está disponible
  const voces = window.speechSynthesis.getVoices();
  const vozEspanol = voces.find(v => v.name.includes('Pablo'))
  || voces.find(v => v.lang.startsWith('es'))
  || null;
  if (vozEspanol) utterance.voice = vozEspanol;

  btn.textContent = '⏹';
  utterance.onend = () => btn.textContent = '🔊';
  utterance.onerror = () => btn.textContent = '🔊';

  window.speechSynthesis.speak(utterance);
}

// ── PENDIENTES ──

async function cargarPendientes() {
  const { data } = await supabaseClient
    .from('perfiles').select('*, grupos(nombre)')
    .eq('estado', 'pendiente').order('created_at');

  const container = document.getElementById('sa-pendientes');
  if (!data || !data.length) {
    container.innerHTML = `<div class="sa-empty">No hay usuarios pendientes.</div>`;
    return;
  }

  const { data: grupos } = await supabaseClient.from('grupos').select('*').eq('admin_id', currentUser.id).order('nombre');

  container.innerHTML = data.map(u => `
    <div class="sa-user-item">
      <div class="sa-user-info">
        <div class="sa-user-name">${u.nombre}</div>
        <div class="sa-user-email">${u.email}</div>
        <div class="sa-user-meta">Registrado: ${new Date(u.created_at).toLocaleDateString('es-AR')}</div>
      </div>
      <div class="sa-user-actions">
        <select class="sa-select" id="grupo-select-${u.id}">
          <option value="">Asignar grupo...</option>
          ${(grupos || []).map(g => `<option value="${g.id}">${g.nombre}</option>`).join('')}
        </select>
        <button class="sa-btn-primary" onclick="aprobarUsuario('${u.id}')">✅ Aprobar</button>
        <button class="sa-btn-danger" onclick="rechazarUsuario('${u.id}')">❌ Rechazar</button>
      </div>
    </div>
  `).join('');
}

async function aprobarUsuario(id) {
  const grupoId = document.getElementById(`grupo-select-${id}`).value;
  if (!grupoId) { alert('Seleccioná un grupo antes de aprobar.'); return; }

  const { error } = await supabaseClient.from('perfiles')
    .update({ estado: 'activo', grupo_id: grupoId })
    .eq('id', id);

  if (error) { alert('Error: ' + error.message); return; }
  cargarPendientes();
  cargarActivos();
  cargarEstadisticas();
}

async function rechazarUsuario(id) {
  if (!confirm('¿Rechazar este usuario?')) return;
  await supabaseClient.from('perfiles').update({ estado: 'rechazado' }).eq('id', id);
  cargarPendientes();
}

// ── ACTIVOS ──

async function cargarActivos() {
  const { data } = await supabaseClient
    .from('perfiles').select('*, grupos(nombre)')
    .eq('estado', 'activo').order('nombre');

  const container = document.getElementById('sa-activos');
  if (!data || !data.length) {
    container.innerHTML = `<div class="sa-empty">No hay usuarios activos.</div>`;
    return;
  }

  const { data: grupos } = await supabaseClient.from('grupos').select('*').eq('admin_id', currentUser.id).order('nombre');

  container.innerHTML = data.map(u => `
    <div class="sa-user-item">
      <div class="sa-user-info">
        <div class="sa-user-name">${u.nombre} <span style="font-size:11px;color:var(--muted2)">(${u.rol})</span></div>
        <div class="sa-user-email">${u.email}</div>
        <div class="sa-user-meta">Grupo: ${u.grupos?.nombre || 'Sin grupo'}</div>
      </div>
      <div class="sa-user-actions">
        <select class="sa-select" onchange="cambiarGrupo('${u.id}', this.value)">
          <option value="">Cambiar grupo...</option>
          ${(grupos || []).map(g => `<option value="${g.id}" ${u.grupo_id === g.id ? 'selected' : ''}>${g.nombre}</option>`).join('')}
        </select>
        ${u.rol !== 'superadmin' ? `<button class="sa-btn-danger" onclick="desactivarUsuario('${u.id}')">🚫 Desactivar</button>` : ''}
      </div>
    </div>
  `).join('');
}

async function cambiarGrupo(userId, grupoId) {
  if (!grupoId) return;
  await supabaseClient.from('perfiles').update({ grupo_id: grupoId }).eq('id', userId);
  cargarActivos();
}

async function desactivarUsuario(id) {
  if (!confirm('¿Desactivar este usuario?')) return;
  await supabaseClient.from('perfiles').update({ estado: 'pendiente' }).eq('id', id);
  cargarActivos();
  cargarPendientes();
}

// ── GRUPOS ──

async function cargarGrupos() {
  const { data: grupos } = await supabaseClient.from('grupos').select('*').eq('admin_id', currentUser.id).order('nombre');
  const { data: perfiles } = await supabaseClient.from('perfiles').select('grupo_id').eq('estado', 'activo');

  const container = document.getElementById('sa-grupos');
  if (!grupos || !grupos.length) {
    container.innerHTML = `<div class="sa-empty">No hay grupos creados.</div>`;
    return;
  }

  container.innerHTML = grupos.map(g => {
    const count = perfiles ? perfiles.filter(p => p.grupo_id === g.id).length : 0;
    return `
      <div class="sa-grupo-item">
        <div>
          <div class="sa-grupo-nombre">${g.nombre}</div>
          <div class="sa-grupo-meta">${count} usuario${count !== 1 ? 's' : ''}</div>
        </div>
        <button class="sa-btn-danger" onclick="borrarGrupo('${g.id}')">🗑</button>
      </div>
    `;
  }).join('');
}

async function crearGrupo() {
  const nombre = document.getElementById('sa-grupo-nombre').value.trim();
  if (!nombre) { alert('Escribí un nombre para el grupo.'); return; }

  const { error } = await supabaseClient.from('grupos').insert({
    nombre,
    admin_id: currentUser.id
  });

  if (error) { alert('Error: ' + error.message); return; }

  document.getElementById('sa-grupo-nombre').value = '';
  document.getElementById('sa-form-grupo').style.display = 'none';
  cargarGrupos();
}

async function borrarGrupo(id) {
  if (!confirm('¿Borrar este grupo? Los usuarios quedarán sin grupo asignado.')) return;
  await supabaseClient.from('grupos').delete().eq('id', id);
  cargarGrupos();
  cargarActivos();
}

// ── ESTADÍSTICAS ──

async function cargarEstadisticas() {
  const [
    { count: totalUsuarios },
    { count: totalGrupos },
    { count: totalFilminas },
    { count: totalPreguntas }
  ] = await Promise.all([
    supabaseClient.from('perfiles').select('id', { count: 'exact', head: true }).eq('estado', 'activo'),
    supabaseClient.from('grupos').select('id', { count: 'exact', head: true }),
    supabaseClient.from('filminas').select('id', { count: 'exact', head: true }),
    supabaseClient.from('preguntas_final').select('id', { count: 'exact', head: true })
  ]);

  document.getElementById('sa-stats').innerHTML = `
    <div class="sa-stat-card">
      <div class="sa-stat-num">${totalUsuarios || 0}</div>
      <div class="sa-stat-label">Usuarios activos</div>
    </div>
    <div class="sa-stat-card">
      <div class="sa-stat-num">${totalGrupos || 0}</div>
      <div class="sa-stat-label">Grupos</div>
    </div>
    <div class="sa-stat-card">
      <div class="sa-stat-num">${totalFilminas || 0}</div>
      <div class="sa-stat-label">Filminas cargadas</div>
    </div>
    <div class="sa-stat-card">
      <div class="sa-stat-num">${totalPreguntas || 0}</div>
      <div class="sa-stat-label">Preguntas cargadas</div>
    </div>
  `;
}
/* ════════════════════════════════════════════════
   ESTADÍSTICAS AUTOEVALUACIÓN
   ════════════════════════════════════════════════ */

function toggleEstadisticas() {
  const grid = document.getElementById('ae-stats-grid');
  const icon = document.getElementById('ae-stats-toggle-icon');
  const visible = grid.style.display !== 'none';
  grid.style.display = visible ? 'none' : 'grid';
  if (icon) icon.textContent = visible ? '▼' : '▲';
}

function toggleHistorial() {
  const container = document.getElementById('ae-historial-container');
  const icon = document.getElementById('ae-historial-toggle-icon');
  const visible = container.style.display !== 'none';
  container.style.display = visible ? 'none' : 'block';
  icon.textContent = visible ? '▶' : '▼';
}

async function cargarEstadisticasAE() {
  const section = document.getElementById('ae-stats-section');
  const grid = document.getElementById('ae-stats-grid');
  if (!section || !grid) return;
  section.style.display = 'block';
  grid.innerHTML = '<p style="color:var(--muted2);padding:12px">Cargando...</p>';
  grid.style.display = 'grid';
  const toggleIcon = document.getElementById('ae-stats-toggle-icon');
  if (toggleIcon) toggleIcon.textContent = '▲';

  const esSuperadmin = currentPerfil?.rol === 'superadmin';
  let queryS = supabaseClient.from('sesiones').select('*, respuestas(*)');
  if (!esSuperadmin) queryS = queryS.eq('alumno_id', currentUser.id);
  const { data: sesiones } = await queryS;

  if (!sesiones || !sesiones.length) {
    grid.innerHTML = '<p style="color:var(--muted2);padding:12px">Sin datos aún.</p>';
    return;
  }

  const totalSesiones = sesiones.length;
  const totalPreguntas = sesiones.reduce((acc, s) => acc + (s.respuestas?.length || 0), 0);

  const tiempos = sesiones.map(s => {
    if (!s.tiempo_usado) return 0;
    const [m, seg] = s.tiempo_usado.split(':').map(Number);
    return m * 60 + seg;
  }).filter(t => t > 0);
  const tiempoPromedio = tiempos.length ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : 0;
  const minProm = String(Math.floor(tiempoPromedio / 60)).padStart(2, '0');
  const segProm = String(tiempoPromedio % 60).padStart(2, '0');

  const porUnidad = {};
  sesiones.forEach(s => { const u = s.unidad || 'Global'; porUnidad[u] = (porUnidad[u] || 0) + 1; });
  const unidadTop = Object.entries(porUnidad).sort((a, b) => b[1] - a[1])[0];

  const porPregunta = {};
  sesiones.forEach(s => {
    (s.respuestas || []).forEach(r => {
      const key = r.pregunta?.substring(0, 60) || 'Sin título';
      porPregunta[key] = (porPregunta[key] || 0) + 1;
    });
  });
  const preguntasTop = Object.entries(porPregunta).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const preguntasMenos = Object.entries(porPregunta).sort((a, b) => a[1] - b[1]).slice(0, 5);

  let alumnosHtml = '';
  if (esSuperadmin) {
    const { data: perfilesData } = await supabaseClient.from('perfiles').select('id, nombre');
    const perfilesMap = {};
    (perfilesData || []).forEach(p => perfilesMap[p.id] = p.nombre);

    const porAlumno = {};
    sesiones.forEach(s => { const nombre = perfilesMap[s.alumno_id] || 'Desconocido'; porAlumno[nombre] = (porAlumno[nombre] || 0) + 1; });
    const alumnosTop = Object.entries(porAlumno).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const pregPorAlumno = {};
    sesiones.forEach(s => {
      const nombre = perfilesMap[s.alumno_id] || 'Desconocido';
      if (!pregPorAlumno[nombre]) pregPorAlumno[nombre] = {};
      (s.respuestas || []).forEach(r => {
        const key = r.pregunta?.substring(0, 50) || 'Sin título';
        pregPorAlumno[nombre][key] = (pregPorAlumno[nombre][key] || 0) + 1;
      });
    });
    const pregTopPorAlumno = Object.entries(pregPorAlumno).map(([alumno, pregs]) => {
      const top = Object.entries(pregs).sort((a, b) => b[1] - a[1])[0];
      return { alumno, pregunta: top?.[0] || '-', veces: top?.[1] || 0 };
    }).sort((a, b) => b.veces - a.veces);

    alumnosHtml = `
      <div class="ae-stats-tabla">
        <div class="ae-stats-tabla-title">👤 Alumnos más activos</div>
        ${alumnosTop.map(([nombre, count]) => `
          <div class="ae-stats-row">
            <span class="ae-stats-row-label">${nombre}</span>
            <span class="ae-stats-row-val">${count} sesión${count !== 1 ? 'es' : ''}</span>
          </div>`).join('')}
      </div>
      <div class="ae-stats-tabla" style="grid-column: 1 / -1">
        <div class="ae-stats-tabla-title">🔁 Pregunta más respondida por alumno</div>
        ${pregTopPorAlumno.map(({ alumno, pregunta, veces }) => `
          <div class="ae-stats-row">
            <span class="ae-stats-row-label"><strong>${alumno}:</strong> ${pregunta}</span>
            <span class="ae-stats-row-val">${veces}x</span>
          </div>`).join('')}
      </div>`;
  }

  // Traer intentos V/F
  let queryVF = supabaseClient.from('vf_intentos').select('*, unidades(numero, nombre)');
  if (!esSuperadmin) queryVF = queryVF.eq('alumno_id', currentUser.id);
  const { data: intentosVF } = await queryVF;

  const totalIntentosVF = intentosVF?.length || 0;
  const totalCorrectas = (intentosVF || []).reduce((a, i) => a + i.correctas, 0);
  const totalPreguntasVF = (intentosVF || []).reduce((a, i) => a + i.total, 0);
  const porcentajeAcierto = totalPreguntasVF ? Math.round((totalCorrectas / totalPreguntasVF) * 100) : 0;

  let vfHtml = '';
  if (totalIntentosVF > 0) {
    let perfilesLookup = {};
    if (esSuperadmin) {
      const { data: perfilesData } = await supabaseClient.from('perfiles').select('id, nombre');
      (perfilesData || []).forEach(p => perfilesLookup[p.id] = p.nombre);
    }

    const ultimos = (intentosVF || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
    vfHtml = `
      <div class="ae-stats-tabla" style="grid-column: 1 / -1">
        <div class="ae-stats-tabla-title">✅ Últimos intentos V/F</div>
        ${ultimos.map((i, idx) => `
          <div class="vf-intento-item">
            <div class="vf-intento-header" onclick="toggleVFIntento(${idx})" style="cursor:pointer;user-select:none">
              <div class="ae-stats-row" style="border:none;padding:10px 16px">
                <span class="ae-stats-row-label">
                  <span id="vf-arrow-${idx}" style="display:inline-block;margin-right:8px;color:var(--accent2)">▶</span>
                  ${esSuperadmin ? `<strong>${perfilesLookup[i.alumno_id] || 'Desconocido'}:</strong> ` : ''}${new Date(i.created_at).toLocaleDateString('es-AR')} — U${i.unidades?.numero || '?'} ${i.unidades?.nombre || ''}
                </span>
                <span class="ae-stats-row-val">${i.correctas}/${i.total}</span>
              </div>
            </div>
            <div id="vf-detalle-${idx}" style="display:none;padding:0 16px 12px">
              ${(i.detalle || []).map((d, di) => `
                <div style="padding:8px;border-radius:8px;border:1px solid var(--border);margin-bottom:6px;font-size:12px;background:${d.acerto ? 'rgba(76,175,80,0.1)' : 'rgba(244,67,54,0.1)'}">
                  <div style="color:var(--text);margin-bottom:4px">
                    ${d.acerto ? '✅' : '❌'} <strong>P${di + 1}:</strong> ${d.pregunta}
                  </div>
                  <div style="color:var(--muted2);font-size:11px">
                    Respuesta correcta: <strong>${d.respuesta_correcta ? 'Verdadero' : 'Falso'}</strong>
                    ${d.respondida !== null ? ` · Respondió: <strong>${d.respondida ? 'Verdadero' : 'Falso'}</strong>` : ' · Sin responder'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>`;
  }

  grid.innerHTML = `
    <div class="ae-stat-card"><div class="ae-stat-num">${totalSesiones}</div><div class="ae-stat-label">Sesiones totales</div></div>
    <div class="ae-stat-card"><div class="ae-stat-num">${totalPreguntas}</div><div class="ae-stat-label">Preguntas respondidas</div></div>
    <div class="ae-stat-card"><div class="ae-stat-num">${minProm}:${segProm}</div><div class="ae-stat-label">Tiempo promedio</div></div>
    <div class="ae-stat-card"><div class="ae-stat-num">${unidadTop ? unidadTop[1] : 0}</div><div class="ae-stat-label">Sesiones en ${unidadTop ? unidadTop[0] : '-'}</div><div class="ae-stat-sub">Unidad más evaluada</div></div>
    ${alumnosHtml}
    <div class="ae-stats-tabla" style="grid-column: 1 / -1">
      <div class="ae-stats-tabla-title">🔝 Preguntas más repasadas</div>
      ${preguntasTop.map(([preg, count]) => `<div class="ae-stats-row"><span class="ae-stats-row-label">${preg}</span><span class="ae-stats-row-val">${count}x</span></div>`).join('')}
    </div>
    <div class="ae-stats-tabla" style="grid-column: 1 / -1">
      <div class="ae-stats-tabla-title">📉 Preguntas menos repasadas</div>
      ${preguntasMenos.map(([preg, count]) => `<div class="ae-stats-row"><span class="ae-stats-row-label">${preg}</span><span class="ae-stats-row-val">${count}x</span></div>`).join('')}
    </div>
    ${totalIntentosVF > 0 ? `
      <div class="ae-stat-card"><div class="ae-stat-num">${totalIntentosVF}</div><div class="ae-stat-label">Intentos V/F</div></div>
      <div class="ae-stat-card"><div class="ae-stat-num">${porcentajeAcierto}%</div><div class="ae-stat-label">Aciertos V/F</div></div>
    ` : ''}
    ${vfHtml}`;
  grid.style.display = 'grid';
}

// ── EDITAR UNIDAD ──

let editandoUnidadId = null;

function editarUnidad(id) {
  const u = mcUnidades.find(x => x.id === id);
  if (!u) return;
  editandoUnidadId = id;
  document.getElementById('mc-form-unidad').style.display = 'block';
  document.getElementById('mc-unidad-numero').value = u.numero;
  document.getElementById('mc-unidad-nombre').value = u.nombre;
  document.querySelector('#mc-form-unidad .ae-finish-btn').textContent = 'Actualizar';
  document.getElementById('mc-form-unidad').scrollIntoView({ behavior: 'smooth' });
}
// ── EDITAR FILMINA ──

let editandoFilminaId = null;

async function editarFilmina(id) {
  const { data: f } = await supabaseClient.from('filminas').select('*').eq('id', id).single();
  if (!f) return;
  editandoFilminaId = id;
  await cargarSelectUnidades();
  document.getElementById('mc-form-filmina').style.display = 'block';
  document.getElementById('mc-filmina-unidad').value = f.unidad_id;
  document.getElementById('mc-filmina-titulo').value = f.titulo;
  document.getElementById('mc-filmina-contenido').value = f.contenido;
  document.getElementById('mc-filmina-keywords').value = f.keywords || '';
  document.querySelector('#mc-form-filmina .ae-finish-btn').textContent = 'Actualizar';
  document.getElementById('mc-form-filmina').scrollIntoView({ behavior: 'smooth' });
}
// ── EDITAR PREGUNTA ──

let editandoPreguntaId = null;

async function editarPregunta(id) {
  const { data: p } = await supabaseClient.from('preguntas_final').select('*').eq('id', id).single();
  if (!p) return;
  editandoPreguntaId = id;
  await cargarSelectUnidades();
  document.getElementById('mc-form-pregunta').style.display = 'block';
  document.getElementById('mc-pregunta-unidad').value = p.unidad_id;
  document.getElementById('mc-pregunta-texto').value = p.pregunta;
  document.getElementById('mc-pregunta-respuesta').value = p.respuesta || '';
  document.querySelector('#mc-form-pregunta .ae-finish-btn').textContent = 'Actualizar';
  document.getElementById('mc-form-pregunta').scrollIntoView({ behavior: 'smooth' });
}

/* ════════════════════════════════════════════════
   V/F - CARGA EN MI CONTENIDO
   ════════════════════════════════════════════════ */

let editandoVFId = null;

function showFormVF() {
  document.getElementById('mc-form-vf').style.display = 'block';
  document.getElementById('mc-vf-pregunta').value = '';
  document.getElementById('mc-vf-respuesta').value = 'true';
  if (currentPerfil?.rol === 'superadmin') {
    document.getElementById('mc-vf-grupo-wrap').style.display = 'block';
    cargarSelectGrupos('mc-vf-grupo');
  }
}

function cancelarFormVF() {
  document.getElementById('mc-form-vf').style.display = 'none';
  editandoVFId = null;
  document.querySelector('#mc-form-vf .ae-finish-btn').textContent = 'Guardar';
}

async function guardarVF() {
  const unidad_id = document.getElementById('mc-vf-unidad').value;
  const pregunta  = document.getElementById('mc-vf-pregunta').value.trim();
  const respuesta_correcta = document.getElementById('mc-vf-respuesta').value === 'true';

  if (!unidad_id || !pregunta) { alert('Seleccioná una unidad y escribí la pregunta.'); return; }

  if (editandoVFId) {
    const { error } = await supabaseClient.from('verdadero_falso')
      .update({ unidad_id: parseInt(unidad_id), pregunta, respuesta_correcta })
      .eq('id', editandoVFId);
    if (error) { alert('Error al actualizar: ' + error.message); return; }
    editandoVFId = null;
  } else {
    const grupoId = currentPerfil?.rol === 'superadmin'
      ? document.getElementById('mc-vf-grupo')?.value || currentPerfil?.grupo_id
      : currentPerfil?.grupo_id;

    const { error } = await supabaseClient.from('verdadero_falso').insert({
      alumno_id: currentUser.id,
      unidad_id: parseInt(unidad_id),
      pregunta,
      respuesta_correcta,
      grupo_id: grupoId
    });
    if (error) { alert('Error al guardar: ' + error.message); return; }
  }

  cancelarFormVF();
  cargarVF();
}

async function editarVF(id) {
  const { data: p } = await supabaseClient.from('verdadero_falso').select('*').eq('id', id).single();
  if (!p) return;
  editandoVFId = id;
  await cargarSelectUnidades();
  document.getElementById('mc-form-vf').style.display = 'block';
  document.getElementById('mc-vf-unidad').value = p.unidad_id;
  document.getElementById('mc-vf-pregunta').value = p.pregunta;
  document.getElementById('mc-vf-respuesta').value = p.respuesta_correcta ? 'true' : 'false';
  document.querySelector('#mc-form-vf .ae-finish-btn').textContent = 'Actualizar';
  document.getElementById('mc-form-vf').scrollIntoView({ behavior: 'smooth' });
}

async function borrarVF(id) {
  if (!confirm('¿Borrar esta pregunta V/F?')) return;
  await supabaseClient.from('verdadero_falso').delete().eq('id', id);
  cargarVF();
}

async function cargarVF() {
  const { data } = await supabaseClient
    .from('verdadero_falso')
    .select('*, unidades(numero, nombre)')
    .eq('alumno_id', currentUser.id)
    .order('created_at');

  const lista = document.getElementById('mc-lista-vf');
  if (!data || data.length === 0) {
    lista.innerHTML = `<div class="unit-empty"><div class="ue-icon">✅</div><h4>Sin preguntas V/F</h4><p>Creá tu primera pregunta.</p></div>`;
    return;
  }

  // Agrupar por unidad
  const grupos = {};
  data.forEach(p => {
    const key = p.unidades?.numero ?? 'sin-unidad';
    if (!grupos[key]) {
      grupos[key] = { numero: p.unidades?.numero, nombre: p.unidades?.nombre || 'Sin unidad', items: [] };
    }
    grupos[key].items.push(p);
  });

  const gruposOrdenados = Object.values(grupos).sort((a, b) => (a.numero || 999) - (b.numero || 999));

  lista.innerHTML = gruposOrdenados.map((g, idx) => `
    <div class="mc-grupo-unidad">
      <div class="mc-grupo-header" onclick="toggleGrupoVF(${idx})">
        <span class="mc-grupo-title">📘 V/F de U${g.numero ?? '?'} — ${g.nombre} (${g.items.length})</span>
        <span class="mc-grupo-toggle" id="mc-grupo-vf-toggle-${idx}">▼</span>
      </div>
      <div class="mc-grupo-items" id="mc-grupo-vf-items-${idx}" style="display:none">
        ${g.items.map(p => `
          <div class="mc-item">
            <div class="mc-item-info">
              <span class="mc-item-num">${p.respuesta_correcta ? '✅V' : '❌F'}</span>
              <span class="mc-item-nombre">${p.pregunta}</span>
            </div>
            <button class="mc-delete-btn" onclick="editarVF(${p.id})" style="margin-right:6px">✏️</button>
            <button class="mc-delete-btn" onclick="borrarVF(${p.id})">🗑</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function toggleGrupoVF(idx) {
  const items = document.getElementById(`mc-grupo-vf-items-${idx}`);
  const toggle = document.getElementById(`mc-grupo-vf-toggle-${idx}`);
  const visible = items.style.display !== 'none';
  items.style.display = visible ? 'none' : 'block';
  if (toggle) toggle.textContent = visible ? '▼' : '▲';
}
/* ════════════════════════════════════════════════
   V/F - TEST PARA EL ALUMNO
   ════════════════════════════════════════════════ */

let vfPreguntas = [];
let vfUnidadActual = null;

async function iniciarVF(numUnidad) {
  vfUnidadActual = numUnidad;

  const visibleIds = await getVisibleUserIds();
  const matchUnidades = mcUnidades.filter(u => 
  u.numero === numUnidad && 
  visibleIds.includes(u.alumno_id) &&
  (currentSection !== 'teoria' || !currentGrupoId || u.grupo_id === currentGrupoId)
);
  const unidadIds = matchUnidades.map(u => u.id);

  if (!unidadIds.length) {
    alert('No hay preguntas V/F para esta unidad.');
    return;
  }

  const { data } = await supabaseClient
    .from('verdadero_falso')
    .select('*')
    .in('unidad_id', unidadIds);

  if (!data || !data.length) {
    alert('No hay preguntas V/F cargadas para esta unidad todavía.');
    return;
  }

  // Mezclar
  vfPreguntas = data.sort(() => Math.random() - 0.5);

  document.getElementById('vf-step-questions').style.display = 'block';
  document.getElementById('vf-step-done').style.display = 'none';
  document.getElementById('vfQCount').textContent = `${vfPreguntas.length} pregunta${vfPreguntas.length !== 1 ? 's' : ''}`;

  const container = document.getElementById('vf-all-questions');
  container.innerHTML = vfPreguntas.map((p, i) => `
    <div class="ae-question-item">
      <div class="ae-q-label">Pregunta ${i + 1}</div>
      <div class="ae-q-text">${p.pregunta}</div>
      <div class="vf-opciones">
        <label class="vf-opcion">
          <input type="radio" name="vf-${i}" value="true">
          <span>✅ Verdadero</span>
        </label>
        <label class="vf-opcion">
          <input type="radio" name="vf-${i}" value="false">
          <span>❌ Falso</span>
        </label>
      </div>
    </div>
  `).join('');

  document.getElementById('vfOverlay').classList.add('open');
  const modal = document.getElementById('vfModal');
  modal.style.display = 'block';
  requestAnimationFrame(() => modal.classList.add('open'));
}

async function finishVF() {
  let correctas = 0;
  const detalle = [];

  vfPreguntas.forEach((p, i) => {
    const seleccion = document.querySelector(`input[name="vf-${i}"]:checked`);
    const respondida = seleccion ? seleccion.value === 'true' : null;
    const acerto = respondida === p.respuesta_correcta;
    if (acerto) correctas++;
    detalle.push({
      pregunta: p.pregunta,
      respuesta_correcta: p.respuesta_correcta,
      respondida,
      acerto
    });
  });

  // Guardar intento
  const unidadDbId = mcUnidades.find(u => u.numero === vfUnidadActual)?.id;
  await supabaseClient.from('vf_intentos').insert({
    alumno_id: currentUser.id,
    unidad_id: unidadDbId,
    total: vfPreguntas.length,
    correctas,
    detalle
  });

  // Mostrar resultado
  document.getElementById('vf-step-questions').style.display = 'none';
  document.getElementById('vf-step-done').style.display = 'block';
  document.getElementById('vfScore').textContent = `${correctas} / ${vfPreguntas.length} correctas`;

  const erradas = detalle.filter(d => !d.acerto);
  if (erradas.length) {
    document.getElementById('vfDetalle').innerHTML = `
      <h4 style="color:var(--text);margin-bottom:8px">Preguntas erradas:</h4>
      ${erradas.map(e => `
        <div style="padding:10px;border-radius:8px;border:1px solid var(--border);margin-bottom:8px;font-size:13px">
          <div style="color:var(--text);margin-bottom:4px">${e.pregunta}</div>
          <div style="color:var(--muted2);font-size:12px">
            Correcto: <strong style="color:var(--accent2)">${e.respuesta_correcta ? 'Verdadero' : 'Falso'}</strong>
          </div>
        </div>
      `).join('')}`;
  } else {
    document.getElementById('vfDetalle').innerHTML = '<p style="color:var(--accent2);text-align:center">🎉 ¡Todas correctas!</p>';
  }
}

function reiniciarVF() {
  iniciarVF(vfUnidadActual);
}

function closeVF() {
  const modal = document.getElementById('vfModal');
  modal.classList.remove('open');
  document.getElementById('vfOverlay').classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 200);
}

function toggleVFIntento(idx) {
  const det = document.getElementById(`vf-detalle-${idx}`);
  const arrow = document.getElementById(`vf-arrow-${idx}`);
  const visible = det.style.display !== 'none';
  det.style.display = visible ? 'none' : 'block';
  if (arrow) arrow.textContent = visible ? '▶' : '▼';
}

/* ════════════════════════════════════════════════
   PROFE IA
   ════════════════════════════════════════════════ */

let profeHistorial = [];

function toggleProfeIA() {
  const sidebar = document.getElementById('profe-sidebar');
  sidebar.classList.toggle('open');
}

function handleProfeKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendProfeIA();
  }
}

async function getContextoActual() {
  if (!currentSection) return '';

  if (currentSection === 'teoria' && currentUnidad !== null) {
    const u = mcUnidades.find(x => x.numero === currentUnidad);

    // Traer filminas de la unidad actual
    const matchUnidades = mcUnidades.filter(x => x.numero === currentUnidad);
    const unidadIds = matchUnidades.map(x => x.id);

    const { data: filminas } = await supabaseClient
      .from('filminas').select('titulo, contenido')
      .in('unidad_id', unidadIds);

    let contextoFilminas = '';
    if (filminas && filminas.length) {
      contextoFilminas = filminas.map(f =>
        `- ${f.titulo}: ${f.contenido.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1500)}`
      ).join('\n');
    }

    return `El alumno está estudiando la Unidad ${currentUnidad} — ${u?.nombre || ''}.
Contenido de la unidad:
${contextoFilminas}
Respondé basándote en este contenido cuando sea posible.`;
  }

  if (currentSection === 'preguntas') {
    return 'El alumno está repasando las preguntas de examen final.';
  }

  if (currentSection === 'autoevaluacion') {
    return 'El alumno está en la sección de autoevaluación.';
  }

  return '';
}

async function sendProfeIA() {
  const input = document.getElementById('profe-input');
  const messages = document.getElementById('profe-messages');
  const pregunta = input.value.trim();
  if (!pregunta) return;

  // Mostrar mensaje del usuario
  input.value = '';
  const msgUser = document.createElement('div');
  msgUser.className = 'profe-msg profe-msg-user';
  msgUser.textContent = pregunta;
  messages.appendChild(msgUser);

  // Mostrar "escribiendo..."
  const thinking = document.createElement('div');
  thinking.className = 'profe-msg profe-msg-thinking';
  thinking.textContent = 'Profe IA está escribiendo...';
  messages.appendChild(thinking);
  messages.scrollTop = messages.scrollHeight;

  // Agregar al historial
  profeHistorial.push({ role: 'user', content: pregunta });

  const contexto = await getContextoActual();
  const systemPrompt = `Sos el Profe IA, un asistente de estudio universitario amigable y conciso. 
${contexto}
Respondé siempre en español argentino, de forma clara y directa. 
Si el alumno pide ejemplos, dalos. 
No uses markdown ni asteriscos. Texto plano solamente.
Máximo 300 palabras por respuesta.`;

try {
    const response = await fetch(IA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          ...profeHistorial.slice(-10)
        ],
        max_tokens: 800
      })
    });
    const data = await response.json();
    const respuesta = data.choices?.[0]?.message?.content || 'No pude procesar tu pregunta. Intentá de nuevo.';

    profeHistorial.push({ role: 'assistant', content: respuesta });
    thinking.className = 'profe-msg profe-msg-bot';
    thinking.textContent = respuesta;

  } catch (e) {
    thinking.className = 'profe-msg profe-msg-bot';
    thinking.textContent = 'Error de conexión. Intentá de nuevo.';
    console.error(e);
  }

  messages.scrollTop = messages.scrollHeight;
}

/* ════════════════════════════════════════════════
   MATERIAS (GRUPOS DEL ALUMNO)
   ════════════════════════════════════════════════ */

function showFormMateria() {
  document.getElementById('mc-form-materia').style.display = 'block';
  document.getElementById('mc-materia-nombre').value = '';
  document.getElementById('mc-form-materia').scrollIntoView({ behavior: 'smooth' });
}

function cancelarFormMateria() {
  document.getElementById('mc-form-materia').style.display = 'none';
}

async function guardarMateria() {
  const nombre = document.getElementById('mc-materia-nombre').value.trim();
  if (!nombre) { alert('Escribí un nombre para la materia.'); return; }

  const { error } = await supabaseClient.from('grupos').insert({
    nombre,
    admin_id: currentUser.id
  });

  if (error) { alert('Error al guardar: ' + error.message); return; }

  cancelarFormMateria();
  cargarUnidades();
  alert(`✅ Materia "${nombre}" creada. Ahora podés crear unidades dentro de ella.`);
}

async function cargarSelectGruposAlumno(selectId) {
  const { data: grupos } = await supabaseClient
    .from('grupos')
    .select('*')
    .eq('admin_id', currentUser.id)
    .order('nombre');

  const sel = document.getElementById(selectId);
  if (!sel) return;

  if (!grupos || !grupos.length) {
    sel.innerHTML = '<option value="">Primero creá una materia</option>';
    return;
  }

  sel.innerHTML = '<option value="">Seleccioná una materia...</option>' +
    grupos.map(g => `<option value="${g.id}">${g.nombre}</option>`).join('');
}
function openMateriaTeoria(grupoId) {
  currentGrupoId = grupoId;
  const unidadesDelGrupo = mcUnidades.filter(u => (u.grupo_id || 'sin-materia') === grupoId);
  const grupoNombre = unidadesDelGrupo[0] ? 
    (document.querySelector(`[onclick="openMateriaTeoria('${grupoId}')"] h4`)?.textContent || 'Materia') 
    : 'Materia';

  const grid = document.getElementById('units-grid');
  grid.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.style.gridColumn = '1 / -1';

  // Buscar nombre del grupo
  const nombreGrupo = mcUnidades.find(u => u.grupo_id === grupoId)?.grupo_nombre || grupoId;

  wrapper.innerHTML = `
    <button class="back-btn" style="margin-bottom:16px" onclick="renderUnidadesGrid()">← Volver a materias</button>
  `;
  grid.appendChild(wrapper);

  const listaUnidades = document.createElement('div');
  listaUnidades.style.gridColumn = '1 / -1';
  listaUnidades.style.display = 'flex';
  listaUnidades.style.flexDirection = 'column';
  listaUnidades.style.gap = '10px';

  const unidadesMap = new Map();
  unidadesDelGrupo.forEach(u => { if (!unidadesMap.has(u.numero)) unidadesMap.set(u.numero, u); });
  const displayUnidades = [...unidadesMap.values()].sort((a, b) => a.numero - b.numero);

  displayUnidades.forEach(u => {
    const card = document.createElement('div');
    card.className = 'unit-card';
    card.innerHTML = `
      <div class="unit-card-main" onclick="openUnidad(${u.numero})">
        <div class="unit-num">${u.numero}</div>
        <div class="unit-info">
          <h4>${u.nombre}</h4>
        </div>
        <div class="unit-arrow">→</div>
      </div>`;
    listaUnidades.appendChild(card);
  });

  grid.appendChild(listaUnidades);
}

/* ════════════════════════════════════════════════
   FLASHCARDS
   ════════════════════════════════════════════════ */

let fcFilminas = [];
let fcIndex = 0;
let fcVolteada = false;

/* ══ FLASHCARDS — Swiper + Anime.js ══ */
let fcSwiperInstance = null;

async function abrirFlashcards() {
  const visibleIds = await getVisibleUserIds();
  const matchingUnidades = mcUnidades.filter(u =>
    u.numero === currentUnidad &&
    visibleIds.includes(u.alumno_id) &&
    (currentGrupoId ? u.grupo_id === currentGrupoId : true)
  );
  const unidadIds = matchingUnidades.map(u => u.id);
  if (!unidadIds.length) return;

  const { data: items } = await supabaseClient
    .from('filminas').select('*')
    .in('unidad_id', unidadIds).order('id');

  if (!items || !items.length) {
    alert('Esta unidad no tiene filminas cargadas.');
    return;
  }

  fcFilminas = items;
  fcIndex = 0;
  fcVolteada = false;

  // Construir slides
  const wrapper = document.getElementById('fc-swiper-wrapper');
  wrapper.innerHTML = fcFilminas.map((f, i) => `
    <div class="swiper-slide" data-index="${i}">
      <div class="fc-card" onclick="voltearFlashcard()">
        <div class="fc-card-inner" id="fc-inner-${i}">
          <div class="fc-front">
            <div class="fc-front-badge">🃏 Concepto</div>
            <div class="fc-front-text">${f.titulo}</div>
          </div>
          <div class="fc-back">
            <div class="fc-back-badge">📖 Contenido</div>
            <div class="fc-back-content">${f.contenido}</div>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  // Mostrar pantalla
  const screen = document.getElementById('fc-screen');
  screen.style.display = 'flex';

  // Animación de entrada de la pantalla
  anime({ targets: screen, opacity: [0, 1], duration: 300, easing: 'easeOutQuad' });

  // Actualizar contador
  actualizarFcCounter();

  // Destruir instancia anterior si existe
  if (fcSwiperInstance) { fcSwiperInstance.destroy(true, true); fcSwiperInstance = null; }

  // Inicializar Swiper
  fcSwiperInstance = new Swiper('#fcSwiper', {
    effect: 'cards',
    grabCursor: true,
    cardsEffect: { slideShadows: true, rotate: 4, perSlideOffset: 8 },
    on: {
      slideChange() {
        fcIndex = fcSwiperInstance.activeIndex;
        fcVolteada = false;
        document.getElementById('fc-rating').style.display = 'none';
        document.getElementById('fc-hint').textContent = 'Tocá la tarjeta para voltearla';
        // Resetear el inner del slide anterior
        document.querySelectorAll('.fc-card-inner').forEach(el => {
          el.style.transform = 'rotateY(0deg)';
        });
        actualizarFcCounter();
      }
    }
  });
}

function actualizarFcCounter() {
  document.getElementById('fc-counter').textContent =
    `${(fcSwiperInstance?.activeIndex ?? fcIndex) + 1} / ${fcFilminas.length}`;
}

function fcNavNext() {
  const last = fcFilminas.length - 1;
  if (fcSwiperInstance.activeIndex === last) {
    fcSwiperInstance.slideTo(0);
  } else {
    fcSwiperInstance.slideNext();
  }
}

function fcNavPrev() {
  if (fcSwiperInstance.activeIndex === 0) {
    fcSwiperInstance.slideTo(fcFilminas.length - 1);
  } else {
    fcSwiperInstance.slidePrev();
  }
}

function voltearFlashcard() {
  const inner = document.getElementById(`fc-inner-${fcIndex}`);
  if (!inner) return;

  if (!fcVolteada) {
    // Frente → Dorso
    anime({
      targets: inner,
      rotateY: [0, 180],
      duration: 480,
      easing: 'easeInOutBack'
    });
    fcVolteada = true;
    document.getElementById('fc-hint').textContent = 'Tocá para ver el título';
    setTimeout(() => {
      document.getElementById('fc-rating').style.display = 'block';
      anime({
        targets: '#fc-rating',
        opacity: [0, 1],
        translateY: [10, 0],
        duration: 300,
        easing: 'easeOutQuad'
      });
    }, 300);
  } else {
    // Dorso → Frente
    anime({
      targets: inner,
      rotateY: [180, 0],
      duration: 480,
      easing: 'easeInOutBack'
    });
    fcVolteada = false;
    document.getElementById('fc-hint').textContent = 'Tocá la tarjeta para voltearla';
    document.getElementById('fc-rating').style.display = 'none';
  }
}

async function calificarFlashcard(calidad) {
  const f = fcFilminas[fcIndex];

  // Intervalos fijos: 0=no sabía→1día, 3=más o menos→2días, 5=sabía→3días
  const intervaloPorCalidad = { 0: 1, 3: 2, 5: 3 };
  const intervalo = intervaloPorCalidad[calidad] ?? 1;

  const proximaFecha = new Date();
  proximaFecha.setDate(proximaFecha.getDate() + intervalo);
  const proxima = proximaFecha.toISOString().split('T')[0];

  // easiness_factor fijo en 2.5 — no usamos SM-2
  await supabaseClient.from('flashcard_repasos').upsert({
    alumno_id: currentUser.id,
    filmina_id: f.id,
    proxima_revision: proxima,
    intervalo_dias: intervalo,
    repeticiones: 1,
    easiness_factor: calidad === 5 ? 2.6 : 2.4,  // levemente > 2.5 solo si sabía
    updated_at: new Date().toISOString()
  }, { onConflict: 'alumno_id,filmina_id' });

  const labels = { 0: '📅 Repasás mañana', 3: '📅 Repasás en 2 días', 5: '📅 Repasás en 3 días' };
  document.getElementById('fc-hint').textContent = labels[calidad] || '✓ Guardado';
  document.getElementById('fc-rating').style.display = 'none';

  // Avanzar al siguiente slide
  setTimeout(() => {
    if (fcIndex < fcFilminas.length - 1) {
      fcSwiperInstance.slideNext();
    } else {
      // Última tarjeta: pequeña celebración y cierre
      anime({
        targets: '#fc-screen',
        scale: [1, 1.02, 1],
        duration: 400,
        easing: 'easeInOutQuad',
        complete: () => cerrarFlashcards()
      });
    }
  }, 800);
}

function cerrarFlashcards() {
  const screen = document.getElementById('fc-screen');
  anime({
    targets: screen,
    opacity: [1, 0],
    duration: 250,
    easing: 'easeInQuad',
    complete: () => {
      screen.style.display = 'none';
      if (fcSwiperInstance) { fcSwiperInstance.destroy(true, true); fcSwiperInstance = null; }
      document.getElementById('fc-swiper-wrapper').innerHTML = '';
    }
  });
}

lucide.createIcons();

/* ════════════════════════════════════════════════
   MASCOTA INTERACTIVA
   ════════════════════════════════════════════════ */

const MENSAJES_MASCOTA = [
  "¡Vamos que se puede! 💪",
  "¿Ya repasaste hoy?",
  "Cada filmina que leés es un paso más 📖",
  "¡Sos un crack del estudio!",
  "Pequeños avances diarios = grandes resultados",
  "¿Cuándo es el próximo parcial? ¡A prepararse!",
  "El esfuerzo de hoy es el éxito de mañana ⭐",
  "¡No te rindas, ya casi llegás!",
];

function mostrarMensajeMascota() {
  // Elegir mensaje aleatorio
  const msg = MENSAJES_MASCOTA[Math.floor(Math.random() * MENSAJES_MASCOTA.length)];

  // Crear o reusar el globo
  let globo = document.getElementById('mascota-globo');
  if (!globo) {
    globo = document.createElement('div');
    globo.id = 'mascota-globo';
    globo.style.cssText = `
      position: fixed;
      bottom: 330px;
      right: 70px;
      background: var(--surf2);
      border: 1px solid var(--accent2);
      border-radius: 14px;
      padding: 10px 14px;
      max-width: 200px;
      font-size: 13px;
      color: var(--white);
      z-index: 999;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      animation: fadeInUp 0.2s ease;
    `;
    document.body.appendChild(globo);
  }

  globo.textContent = msg;
  globo.style.display = 'block';

  // Auto-ocultar después de 3 segundos
  clearTimeout(globo._timer);
  globo._timer = setTimeout(() => globo.style.display = 'none', 3000);
}

async function verificarRepasosHoy() {
  if (!currentUser) return;
  const hoy = new Date().toISOString().split('T')[0];
  const { data } = await supabaseClient
    .from('flashcard_repasos')
    .select('id')
    .eq('alumno_id', currentUser.id)
    .lte('proxima_revision', hoy);

  const banner = document.getElementById('banner-repasos');
  if (!banner) return;
  if (data && data.length > 0) {
    banner.style.display = 'block';
    banner.innerHTML = `🃏 Tenés <strong>${data.length}</strong> flashcard${data.length !== 1 ? 's' : ''} para repasar hoy. <a href="#" onclick="abrirRepasosHoy()">Ir a repasar →</a>`;
  } else {
    banner.style.display = 'none';
  }
}

async function abrirRepasosHoy() {
  const hoy = new Date().toISOString().split('T')[0];

  const { data: repasos } = await supabaseClient
    .from('flashcard_repasos')
    .select('filmina_id, proxima_revision')
    .eq('alumno_id', currentUser.id)
    .lte('proxima_revision', hoy)
    .order('proxima_revision', { ascending: true });

  if (!repasos || !repasos.length) return;

  const filminaIds = repasos.map(r => r.filmina_id);

  const { data: filminas } = await supabaseClient
    .from('filminas')
    .select('*')
    .in('id', filminaIds);

  if (!filminas || !filminas.length) return;

  // Ordenar según el orden de repasos (más urgente primero)
  fcFilminas = filminaIds.map(id => filminas.find(f => f.id === id)).filter(Boolean);
  fcIndex = 0;
  fcVolteada = false;

  // Primero navegar, después manipular el DOM
  const screen = document.getElementById('fc-screen');
  if (screen) { screen.style.display = 'flex'; }

  setTimeout(() => {
    const wrapper = document.getElementById('fc-swiper-wrapper');
    if (!wrapper) return;

    wrapper.innerHTML = fcFilminas.map((f, i) => `
      <div class="swiper-slide" data-index="${i}">
        <div class="fc-card" onclick="voltearFlashcard()">
          <div class="fc-card-inner" id="fc-inner-${i}">
            <div class="fc-front">
              <div class="fc-front-badge">🃏 Concepto</div>
              <div class="fc-front-text">${f.titulo}</div>
            </div>
            <div class="fc-back">
              <div class="fc-back-badge">📖 Contenido</div>
              <div class="fc-back-content">${f.contenido}</div>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    const counter = document.getElementById('fc-counter');
    const hint    = document.getElementById('fc-hint');
    const rating  = document.getElementById('fc-rating');
    const done    = document.getElementById('fc-done');
    if (counter) counter.textContent = `1 / ${fcFilminas.length}`;
    if (hint)    hint.textContent = 'Tocá la tarjeta para voltear';
    if (rating)  rating.style.display = 'none';
    if (done)    done.classList.remove('visible');

    if (fcSwiperInstance) { fcSwiperInstance.destroy(true, true); fcSwiperInstance = null; }

    setTimeout(() => {
      if (fcSwiperInstance) { fcSwiperInstance.destroy(true, true); fcSwiperInstance = null; }
      fcSwiperInstance = new Swiper('#fcSwiper', {
        effect: 'cards',
        grabCursor: true,
        cardsEffect: { slideShadows: true, rotate: 4, perSlideOffset: 8 },
        on: {
          slideChange() {
            fcIndex = fcSwiperInstance.activeIndex;
            fcVolteada = false;
            document.getElementById('fc-rating').style.display = 'none';
            document.getElementById('fc-hint').textContent = 'Tocá la tarjeta para voltearla';
            document.querySelectorAll('.fc-card-inner').forEach(el => {
              el.style.transform = 'rotateY(0deg)';
            });
            actualizarFcCounter();
          }
        }
      });
      actualizarFcCounter();
    }, 100);

  }, 150);
}

/* ════════════════════════════════════════════════
   MI PROGRESO

/* ════════════════════════════════════════════════
   MI PROGRESO
   ════════════════════════════════════════════════ */

async function renderProgreso() {
  const wrap = document.getElementById('progreso-wrap');
  wrap.innerHTML = '<p style="color:var(--muted2);padding:16px">Cargando progreso...</p>';

  const visibleIds = await getVisibleUserIds();

  // Traer unidades, filminas, sesiones y repasos
  const [{ data: unidades }, { data: filminas }, { data: sesiones }, { data: repasos }, { data: sesionesPomodoro }] = await Promise.all([
    supabaseClient.from('unidades').select('*, grupos(id, nombre)').in('alumno_id', visibleIds).order('numero'),
    supabaseClient.from('filminas').select('id, unidad_id').in('alumno_id', visibleIds),
    supabaseClient.from('sesiones').select('*, respuestas(*)').eq('alumno_id', currentUser.id),
    supabaseClient.from('flashcard_repasos').select('filmina_id, repeticiones, easiness_factor').eq('alumno_id', currentUser.id),
    supabaseClient.from('sesiones_pomodoro').select('*').eq('alumno_id', currentUser.id).order('created_at', { ascending: false })
  ]);

  if (!unidades || !unidades.length) {
    wrap.innerHTML = '<p style="color:var(--muted2);padding:16px">No hay unidades cargadas aún.</p>';
    return;
  }

  // Agrupar filminas por unidad_id
  const filminasPorUnidad = {};
  (filminas || []).forEach(f => {
    if (!filminasPorUnidad[f.unidad_id]) filminasPorUnidad[f.unidad_id] = [];
    filminasPorUnidad[f.unidad_id].push(f.id);
  });

  // Repasos exitosos por filmina
  const repasosPorFilmina = {};
  (repasos || []).forEach(r => {
    if (r.easiness_factor > 2.5) repasosPorFilmina[r.filmina_id] = true;
  });

  // Promedio de autoevaluaciones por unidad
  const sesionsPorUnidad = {};
  (sesiones || []).forEach(s => {
    const u = s.unidad || 'Global';
    if (!sesionsPorUnidad[u]) sesionsPorUnidad[u] = [];
    const total = s.respuestas?.length || 0;
    const correctas = s.respuestas?.filter(r => r.calificacion >= 3).length || 0;
    if (total > 0) sesionsPorUnidad[u].push(Math.round((correctas / total) * 100));
  });

  // Agrupar unidades por materia
  const materiasMap = new Map();
  unidades.forEach(u => {
    const gId = u.grupo_id || 'sin-materia';
    const gNombre = u.grupos?.nombre || 'General';
    if (!materiasMap.has(gId)) materiasMap.set(gId, { nombre: gNombre, unidades: [] });
    materiasMap.get(gId).unidades.push(u);
  });

  let html = '';

  materiasMap.forEach(materia => {
    html += `<div class="progreso-materia">
      <div class="progreso-materia-titulo">📂 ${materia.nombre}</div>`;

    materia.unidades.forEach(u => {
      const filminasDeUnidad = filminasPorUnidad[u.id] || [];
      const totalFilminas = filminasDeUnidad.length;
      const filminasRepasadas = filminasDeUnidad.filter(id => repasosPorFilmina[id]).length;
      const pctFlashcards = totalFilminas > 0 ? Math.round((filminasRepasadas / totalFilminas) * 100) : 0;

      const sesionesUnidad = sesionsPorUnidad[u.numero] || [];
      const pctAE = sesionesUnidad.length > 0
        ? Math.round(sesionesUnidad.reduce((a, b) => a + b, 0) / sesionesUnidad.length)
        : 0;

      const progreso = totalFilminas > 0
        ? Math.round((pctFlashcards * 0.6) + (pctAE * 0.4))
        : pctAE;

      const color = progreso >= 71 ? '#22c55e' : progreso >= 41 ? '#f59e0b' : '#ef4444';
      const estado = progreso >= 71 ? '✅ Dominado' : progreso >= 41 ? '📈 En progreso' : '🔴 Necesita repasar';

      html += `
        <div class="progreso-unidad">
          <div class="progreso-unidad-header">
            <span class="progreso-unidad-nombre">Unidad ${u.numero} — ${u.nombre}</span>
            <span class="progreso-estado" style="color:${color}">${estado}</span>
          </div>
          <div class="progreso-bar-wrap">
            <div class="progreso-bar" style="width:${progreso}%;background:${color}"></div>
          </div>
          <div class="progreso-detalle">
            <span>🃏 Flashcards: ${pctFlashcards}% (${filminasRepasadas}/${totalFilminas})</span>
            <span>📝 Autoevaluación: ${pctAE > 0 ? pctAE + '%' : 'Sin datos'}</span>
            <span style="font-weight:700;color:${color}">Total: ${progreso}%</span>
          </div>
        </div>`;
    });

    html += `</div>`;
  });

  // ── SECCIÓN POMODORO ──
  const sp = sesionesPomodoro || [];
  if (sp.length > 0) {
    const promPuntaje = Math.round(sp.filter(s => s.puntaje).reduce((a, b) => a + b.puntaje, 0) / sp.filter(s => s.puntaje).length);
    const ultimasSesiones = sp.slice(0, 5);

    html += `
    <div class="progreso-materia" style="margin-top:24px">
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
  <div class="progreso-materia-titulo" style="margin-bottom:0">🍅 Historial Pomodoro</div>
  <div style="display:flex; align-items:center; gap:8px;">
    <label style="font-size:12px; color:var(--muted); font-weight:600; letter-spacing:0.06em; text-transform:uppercase;">Filtrar por fecha</label>
    <input type="date" id="pomodoro-filtro-fecha" style="background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:8px; padding:6px 12px; color:var(--white); font-size:13px; outline:none; cursor:pointer;" onchange="filtrarSesionesPomodoro()">
    <button onclick="document.getElementById('pomodoro-filtro-fecha').value=''; filtrarSesionesPomodoro()" style="background:transparent; border:none; color:var(--muted); font-size:12px; cursor:pointer; padding:4px 8px;">✕ Limpiar</button>
  </div>
</div>
      <div style="display:flex; gap:16px; margin-bottom:16px; flex-wrap:wrap;">
  <div style="background:rgba(124,109,250,0.08); border:1px solid rgba(124,109,250,0.2); border-radius:10px; padding:12px 20px; text-align:center;">
<div id="pomo-stat-sesiones" style="font-size:24px; font-weight:700; color:#f0f0f0">${sp.length}</div>
    <div style="font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em;">Sesiones</div>
  </div>
  <div style="background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:12px 20px; text-align:center;">
    <div id="pomo-stat-prom" style="font-size:24px; font-weight:700; color:#f0f0f0">${promPuntaje || '-'}/10</div>
    <div style="font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em;">Prom. puntaje</div>
  </div>
  <div style="background:rgba(224,184,74,0.08); border:1px solid rgba(224,184,74,0.2); border-radius:10px; padding:12px 20px; text-align:center;">
    <div id="pomo-stat-nivel" style="font-size:24px; font-weight:700; color:#f0f0f0">${sp[sp.length-1]?.nivel_sesion || sp.length}</div>
    <div style="font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.08em;">Nivel actual</div>
  </div>
</div>
      <div id="pomodoro-sesiones-lista" style="display:flex; flex-direction:column; gap:10px;" data-sesiones='${JSON.stringify(sp.map(s => ({...s, resumen: s.resumen, feedback_ia: s.feedback_ia})))}'>
  ${ultimasSesiones.map(s => {
          const fecha = new Date(s.created_at).toLocaleDateString('es-AR', { day:'numeric', month:'short' });
          const puntaje = s.puntaje || '—';
          const color = s.puntaje >= 7 ? '#22c55e' : s.puntaje >= 5 ? '#f59e0b' : '#ef4444';
          return `
          <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:10px; padding:14px 16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="font-size:12px; color:var(--muted);">📅 ${fecha} · Sesión ${s.nivel_sesion} · ${(s.filminas_ids||[]).length} filminas${s.duracion_segundos ? ' · ⏱ ' + Math.floor(s.duracion_segundos/60) + ' min' : ''}</span>
              <span style="font-weight:700; color:${color}; font-size:14px;">${puntaje}/10</span>
            </div>
            <p style="font-size:13px; color:var(--muted2); margin-bottom:6px; font-style:italic;">"${s.resumen?.substring(0, 120)}${s.resumen?.length > 120 ? '...' : ''}"</p>
            <p style="font-size:13px; color:var(--muted);">${s.feedback_ia || ''}</p>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  wrap.innerHTML = html;

  wrap.innerHTML = html;
}

// ══ CONSULTA CON EL PROFESOR ══

let consultaPdfTexto = '';
let consultaVozActiva = false;
let consultaRecognition = null;
let consultaHistorial = [];

function renderConsulta() {
  // Restaurar PDF guardado si existe
  const nombreGuardado = localStorage.getItem('consulta_pdf_nombre_' + currentUser.id);
  if (nombreGuardado) {
    consultaPdfTexto = localStorage.getItem('consulta_pdf_texto_' + currentUser.id) || '';
    document.getElementById('consulta-pdf-nombre').textContent = nombreGuardado;
    document.getElementById('consulta-pdf-activo').style.display = 'flex';
  }
}

function cargarConsultaPDF(input) {
  const file = input.files[0];
  if (!file) return;

  const nombreEl = document.getElementById('consulta-pdf-nombre');
  const activoEl = document.getElementById('consulta-pdf-activo');
  nombreEl.textContent = 'Procesando...';
  activoEl.style.display = 'flex';
  agregarMensajeConsulta('sistema', '📄 Leyendo el PDF...');

  const reader = new FileReader();
  reader.onload = async function(e) {
    const typedArray = new Uint8Array(e.target.result);
    const pdf = await pdfjsLib.getDocument(typedArray).promise;
    let texto = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      texto += content.items.map(item => item.str).join(' ') + '\n';
    }
    texto = texto.substring(0, 20000);
    consultaPdfTexto = texto;
    consultaHistorial = []; // reiniciar conversación con nuevo PDF
    localStorage.setItem('consulta_pdf_texto_' + currentUser.id, texto);
    localStorage.setItem('consulta_pdf_nombre_' + currentUser.id, file.name);
    nombreEl.textContent = file.name;
    agregarMensajeConsulta('profe', `Listo, leí "${file.name}". Podés preguntarme lo que quieras sobre el contenido. Presioná el micrófono y hablame.`);
    hablarConsulta(`Listo, leí el apunte. Presioná el micrófono y preguntame.`);
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
}

function quitarConsultaPDF() {
  consultaPdfTexto = '';
  consultaHistorial = [];
  localStorage.removeItem('consulta_pdf_texto_' + currentUser.id);
  localStorage.removeItem('consulta_pdf_nombre_' + currentUser.id);
  document.getElementById('consulta-pdf-activo').style.display = 'none';
  document.getElementById('consulta-pdf-nombre').textContent = '';
  document.getElementById('consulta-mensajes').innerHTML = '';
}

function agregarMensajeConsulta(tipo, texto) {
  const wrap = document.getElementById('consulta-mensajes');
  const div = document.createElement('div');
  const esAlumno = tipo === 'alumno';
  const esSistema = tipo === 'sistema';
  div.style.cssText = `
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 14px;
    line-height: 1.5;
    max-width: 85%;
    align-self: ${esAlumno ? 'flex-end' : 'flex-start'};
    background: ${esAlumno ? 'var(--accent)' : esSistema ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)'};
    color: ${esSistema ? 'var(--muted)' : 'var(--white)'};
    font-style: ${esSistema ? 'italic' : 'normal'};
  `;
  div.textContent = (esAlumno ? '👤 ' : esSistema ? '' : '🤖 ') + texto;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function toggleConsultaVoz() {
  if (consultaVozActiva) {
    consultaRecognition?.stop();
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Tu navegador no soporta reconocimiento de voz. Usá Chrome o Edge.');
    return;
  }

  consultaRecognition = new SR();
  consultaRecognition.lang = 'es-AR';
  consultaRecognition.interimResults = false;
  consultaRecognition.maxAlternatives = 1;

  consultaRecognition.onstart = () => {
    consultaVozActiva = true;
    const btn = document.getElementById('consulta-mic-btn');
    btn.style.background = '#ef4444';
    btn.style.boxShadow = '0 4px 20px rgba(239,68,68,0.5)';
    btn.textContent = '⏹';
    document.getElementById('consulta-mic-estado').textContent = 'Escuchando... hablá ahora';
  };

  consultaRecognition.onresult = async (e) => {
    const pregunta = e.results[0][0].transcript;
    agregarMensajeConsulta('alumno', pregunta);
    document.getElementById('consulta-mic-estado').textContent = 'Procesando...';
    await responderConsulta(pregunta);
  };

  consultaRecognition.onend = () => {
    consultaVozActiva = false;
    const btn = document.getElementById('consulta-mic-btn');
    btn.style.background = 'var(--accent)';
    btn.style.boxShadow = '0 4px 20px rgba(124,109,250,0.4)';
    btn.textContent = '🎤';
    document.getElementById('consulta-mic-estado').textContent = 'Presioná el micrófono para hablar';
  };

  consultaRecognition.onerror = () => {
    consultaVozActiva = false;
    document.getElementById('consulta-mic-estado').textContent = 'Error al escuchar. Intentá de nuevo.';
  };

  consultaRecognition.start();
}

async function responderConsulta(pregunta) {
  consultaHistorial.push({ role: 'user', content: pregunta });

  const contextoPDF = consultaPdfTexto
    ? `El alumno subió el siguiente apunte:\n${consultaPdfTexto.substring(0, 8000)}\nRespondé basándote en este contenido.`
    : 'El alumno no subió ningún apunte. Respondé de forma general.';

  const systemPrompt = `Sos un profesor universitario amigable y claro. ${contextoPDF}
Respondé siempre en español argentino, de forma concisa (máximo 100 palabras).
No uses markdown ni asteriscos. Texto plano solamente. Hablás directamente con el alumno.`;

  try {
    const response = await fetch(IA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          ...consultaHistorial.slice(-8)
        ],
        max_tokens: 300
      })
    });
    const data = await response.json();
    const respuesta = data.choices?.[0]?.message?.content || 'No pude procesar tu pregunta. Intentá de nuevo.';
    consultaHistorial.push({ role: 'assistant', content: respuesta });
    agregarMensajeConsulta('profe', respuesta);
    hablarConsulta(respuesta);

  } catch(e) {
    agregarMensajeConsulta('sistema', 'Error al conectar con el profesor. Verificá tu conexión.');
  }
}

async function hablarConsulta(texto) {
  try {
    const audio = await puter.ai.txt2speech(texto, {
      voice: 'Lucia',
      engine: 'neural',
      language: 'es-ES'
    });
    audio.play();
  } catch(e) {
    const utt = new SpeechSynthesisUtterance(texto);
    utt.lang = 'es-AR';
    window.speechSynthesis.speak(utt);
  }
}

let pomodoroIntervalo = null;
let pomodoroSegundos = 0;
let pomodoroInicioTimestamp = null;

let pomodoroMinutosElegidos = 25;

function abrirConfigPomodoro() {
  if (pomodoroActivo) return;
  pomodoroMinutosElegidos = 25;
  document.getElementById('pomodoro-config-seleccion').textContent = '✓ 25 minutos seleccionados';
  document.getElementById('pomodoro-minutos-custom').value = '';
  document.querySelectorAll('.tiempo-opt').forEach(b => b.classList.remove('selected'));
  document.querySelector('.tiempo-opt[data-min="25"]').classList.add('selected');
  document.getElementById('modal-pomodoro-config').style.display = 'flex';
}

function seleccionarTiempo(min) {
  pomodoroMinutosElegidos = min;
  document.getElementById('pomodoro-minutos-custom').value = '';
  document.getElementById('pomodoro-config-seleccion').textContent = `✓ ${min} minutos seleccionados`;
  document.querySelectorAll('.tiempo-opt').forEach(b => b.classList.remove('selected'));
  document.querySelector(`.tiempo-opt[data-min="${min}"]`).classList.add('selected');
}

function confirmarPomodoro() {
  const custom = parseInt(document.getElementById('pomodoro-minutos-custom').value);
  if (custom && custom > 0 && custom <= 120) {
    pomodoroMinutosElegidos = custom;
  } else if (!pomodoroMinutosElegidos) {
    alert('Elegí un tiempo antes de iniciar.');
    return;
  }
  document.getElementById('modal-pomodoro-config').style.display = 'none';
  iniciarPomodoro();
}

function iniciarPomodoro() {
  if (pomodoroIntervalo) clearInterval(pomodoroIntervalo);
  if (pomodoroActivo) return;
  pomodoroActivo = true;
  pomodoroInicioTimestamp = Date.now();
  filminas_leidas_sesion = [];
  pomodoroSegundos = pomodoroMinutosElegidos * 60;

  document.querySelector('[onclick*="iniciarVF"]').style.display = 'none';
  document.querySelector('[onclick*="openAutoevaluacion"]').style.display = 'none';
  document.querySelector('[onclick*="abrirFlashcards"]').style.display = 'none';
  document.getElementById('pomodoro-btn').style.display = 'none';
  document.getElementById('pomodoro-ring').style.display = 'inline-flex';

  actualizarRing();
  pomodoroIntervalo = setInterval(() => {
    pomodoroSegundos--;
    actualizarRing();
    if (pomodoroSegundos <= 0) finalizarPomodoro();
  }, 1000);
}

function actualizarRing() {
  const total = pomodoroMinutosElegidos * 60;
  const ratio = pomodoroSegundos / total;
  const circunferencia = 131.9;
  document.getElementById('ring-progress').setAttribute('stroke-dashoffset', circunferencia * (1 - ratio));
  const m = String(Math.floor(pomodoroSegundos / 60)).padStart(2, '0');
  const s = String(pomodoroSegundos % 60).padStart(2, '0');
  document.getElementById('ring-time').textContent = `${m}:${s}`;
}

function pausarPomodoro() {
  if (pomodoroIntervalo) {
    clearInterval(pomodoroIntervalo);
    pomodoroIntervalo = null;
    const btn = document.getElementById('pomodoro-pause-btn');
    btn.textContent = 'Reanudar';
    btn.onclick = reanudarPomodoro;
  }
}

function reanudarPomodoro() {
  const btn = document.getElementById('pomodoro-pause-btn');
  btn.textContent = 'Pausar';
  btn.onclick = pausarPomodoro;
  pomodoroIntervalo = setInterval(() => {
    pomodoroSegundos--;
    actualizarRing();
    if (pomodoroSegundos <= 0) finalizarPomodoro();
  }, 1000);
}

function finalizarPomodoro() {
  clearInterval(pomodoroIntervalo);
  pomodoroIntervalo = null;
  pomodoroActivo = false;

  document.querySelector('[onclick*="iniciarVF"]').style.display = '';
  document.querySelector('[onclick*="openAutoevaluacion"]').style.display = '';
  document.querySelector('[onclick*="abrirFlashcards"]').style.display = '';
  document.getElementById('pomodoro-btn').style.display = '';
  document.getElementById('pomodoro-ring').style.display = 'none';

  abrirModalRecall();
}

function abrirModalRecall() {
  const modal = document.getElementById('modal-recall');
  document.getElementById('recall-count').textContent = filminas_leidas_sesion.length;
  document.getElementById('recall-input').value = '';
  document.getElementById('recall-feedback').style.display = 'none';

 document.getElementById('recall-aviso').textContent = 'Escribí con tus palabras lo más importante que aprendiste.';

  modal.style.display = 'flex';
}

async function enviarRecall() {
  const resumen = document.getElementById('recall-input').value.trim();
  if (!resumen) { alert('Escribí algo antes de enviar.'); return; }

  if (filminas_leidas_sesion.length === 0) {
  alert('No abriste ninguna filmina en esta sesión.');
  return;
}

  const feedbackEl = document.getElementById('recall-feedback');
  feedbackEl.style.display = 'block';
  feedbackEl.textContent = 'Analizando tu resumen...';

  const { data: todasSesiones } = await supabaseClient
  .from('sesiones_pomodoro')
  .select('id')
  .eq('alumno_id', currentUser.id);
const nivel = (todasSesiones?.length || 0) + 1;

  const todasFilminas = window.filminasActuales || [];
  const filminasLeidas = todasFilminas.filter(f => filminas_leidas_sesion.includes(parseInt(f.id)));
  const contexto = filminasLeidas.map(f => `- ${f.titulo}: ${f.contenido.replace(/<[^>]*>/g, ' ').substring(0, 200)}`).join('\n');

  const prompt = `Sos un profesor universitario evaluando el resumen de un alumno de Contador Público.

El alumno leyó EXCLUSIVAMENTE estas filminas:
${contexto || '(no se registraron filminas específicas)'}

Resumen del alumno:
"${resumen}"

Tu tarea es evaluar si el resumen refleja correctamente el contenido de las filminas. 
IMPORTANTE: Solo evaluá en base al contenido de las filminas. No agregues conceptos, definiciones ni correcciones que no estén en las filminas. Si el alumno omite algo, señalá qué parte de la filmina no mencionó. Si agrega algo incorrecto, indicá qué dice la filmina al respecto.

Nivel del alumno: sesión número ${nivel}.
${nivel <= 3 ? 'Sé permisivo y alentador. Valorá el intento aunque sea incompleto.' : nivel <= 10 ? 'Señalá con amabilidad qué partes de las filminas no fueron mencionadas.' : 'Exigí que el resumen refleje con precisión el contenido exacto de las filminas.'}

Respondé con:
1. Un puntaje del 1 al 10
2. Dos o tres líneas de feedback basado SOLO en las filminas
3. Si corresponde, qué parte de la filmina debería repasar

Sé breve y directo. Respondé en español argentino.`;

  let feedback = 'Sin feedback disponible.';
  let puntaje = null;

 try {
    const response = await fetch(IA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400
      })
    });
    const data = await response.json();
    feedback = data.choices?.[0]?.message?.content || 'No se pudo obtener feedback.';
    const puntajeMatch = feedback.match(/Puntaje[^0-9]*(10|[1-9])/i);
    puntaje = puntajeMatch ? parseInt(puntajeMatch[1]) : null;
  } catch (e) {
    feedback = 'Sin feedback disponible (error de IA).';
  }

  feedbackEl.textContent = feedback;

  const { error: insertError } = await supabaseClient.from('sesiones_pomodoro').insert({
    alumno_id: currentUser.id,
    filminas_ids: filminas_leidas_sesion,
    resumen,
    feedback_ia: feedback,
    puntaje,
    nivel_sesion: nivel,
    duracion_segundos: pomodoroInicioTimestamp ? Math.round((Date.now() - pomodoroInicioTimestamp) / 1000) : null
  });

  if (insertError) {
    console.error('Error guardando sesión:', insertError);
  } else {
    filminas_leidas_sesion = [];
  }
}

function registrarFilminaLeida(id) {
  const idNum = parseInt(id);
  if (!filminas_leidas_sesion.includes(idNum)) {
    filminas_leidas_sesion.push(idNum);
  }
}

function filtrarSesionesPomodoro() {
  const fecha = document.getElementById('pomodoro-filtro-fecha')?.value;
  const lista = document.getElementById('pomodoro-sesiones-lista');
  if (!lista) return;

  const sesiones = JSON.parse(lista.dataset.sesiones || '[]');
  const filtradas = fecha
    ? sesiones.filter(s => {
        if (!s.created_at) return false;
        const d = new Date(s.created_at);
        const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        return iso === fecha;
      })
    : sesiones.slice(0, 5);

  // Actualizar stats según filtro
  const base = fecha ? filtradas : sesiones;
  const conPuntaje = base.filter(s => s.puntaje);
  const prom = conPuntaje.length
    ? Math.round(conPuntaje.reduce((a, b) => a + b.puntaje, 0) / conPuntaje.length)
    : null;

  const elSesiones = document.getElementById('pomo-stat-sesiones');
  const elProm     = document.getElementById('pomo-stat-prom');
  const elNivel    = document.getElementById('pomo-stat-nivel');

  if (elSesiones) elSesiones.textContent = base.length;
  if (elProm)     elProm.textContent = (prom || '-') + '/10';
  if (elNivel)    elNivel.textContent = base[base.length - 1]?.nivel_sesion || base.length || '-';

  // Actualizar lista
  lista.innerHTML = filtradas.length
    ? filtradas.map(s => {
        const d = new Date(s.created_at);
        const fechaStr = d.toLocaleDateString('es-AR', { day:'numeric', month:'short' });
        const hora = d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
        const puntaje = s.puntaje || '—';
        const color = s.puntaje >= 7 ? '#22c55e' : s.puntaje >= 5 ? '#f59e0b' : '#ef4444';
        return `
        <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:10px; padding:14px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:12px; color:var(--muted);">📅 ${fechaStr} ${hora} · Sesión ${s.nivel_sesion} · ${(s.filminas_ids||[]).length} filminas${s.duracion_segundos ? ' · ⏱ ' + Math.floor(s.duracion_segundos/60) + ' min' : ''}</span>
            <span style="font-weight:700; color:${color}; font-size:14px;">${puntaje}/10</span>
          </div>
          <p style="font-size:13px; color:var(--muted2); margin-bottom:6px; font-style:italic;">"${s.resumen}"</p>
          <p style="font-size:13px; color:var(--muted);">${s.feedback_ia || 'Sin feedback.'}</p>
        </div>`;
      }).join('')
    : '<p style="color:var(--muted2); font-size:13px;">No hay sesiones para esa fecha.</p>';
}

function initCardCanvas(cv) {
  const card = cv.parentElement;
  const ctx  = cv.getContext('2d');
  let W, H;

  function resize() {
    const r = card.getBoundingClientRect();
    W = cv.width  = r.width;
    H = cv.height = r.height;
  }
  resize();

  let auroraT = 0;
  function drawAurora() {
    auroraT += 0.004;
    const cx1 = W * (0.3 + 0.2 * Math.sin(auroraT));
    const cy1 = H * (0.2 + 0.15 * Math.cos(auroraT * 0.7));
    const cx2 = W * (0.7 + 0.15 * Math.cos(auroraT * 1.2));
    const cy2 = H * (0.7 + 0.1  * Math.sin(auroraT * 0.9));
    ctx.fillStyle = '#0f1628';
    ctx.fillRect(0, 0, W, H);
    let g1 = ctx.createRadialGradient(cx1, cy1, 0, cx1, cy1, W * 0.65);
    g1.addColorStop(0,   'rgba(30, 58, 138, 0.55)');
    g1.addColorStop(0.5, 'rgba(37, 99, 235, 0.2)');
    g1.addColorStop(1,   'rgba(37, 99, 235, 0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);
    let g2 = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, W * 0.5);
    g2.addColorStop(0,   'rgba(99, 60, 180, 0.3)');
    g2.addColorStop(0.6, 'rgba(99, 60, 180, 0.08)');
    g2.addColorStop(1,   'rgba(99, 60, 180, 0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
  }

  class Bubble {
    constructor() { this.init(true); }
    init(spread = false) {
      this.x = Math.random() * W;
      this.y = spread ? Math.random() * H : H + 30;
      this.r  = Math.random() * 60 + 20;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = -(Math.random() * 0.4 + 0.15);
      this.alpha = Math.random() * 0.07 + 0.02;
      this.hue = Math.random() > 0.5 ? 220 : 250;
    }
    update() {
      this.x += this.vx; this.y += this.vy;
      if (this.y + this.r < 0) this.init();
    }
    draw() {
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r);
      g.addColorStop(0,   `hsla(${this.hue},80%,65%,${this.alpha})`);
      g.addColorStop(0.5, `hsla(${this.hue},70%,50%,${this.alpha * 0.4})`);
      g.addColorStop(1,   `hsla(${this.hue},70%,50%,0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  class Star {
    constructor() {
      this.x = Math.random() * W;
      this.y = Math.random() * H;
      this.size  = Math.random() * 1.2 + 0.3;
      this.phase = Math.random() * Math.PI * 2;
      this.speed = Math.random() * 0.02 + 0.008;
    }
    update() { this.phase += this.speed; }
    draw() {
      ctx.save();
      ctx.globalAlpha = 0.15 + 0.1 * Math.sin(this.phase);
      ctx.fillStyle = '#a5b4fc';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const bubbles = Array.from({ length: 10 }, () => new Bubble());
  const stars   = Array.from({ length: 40 }, () => new Star());

  function loop() {
    requestAnimationFrame(loop);
    drawAurora();
    stars.forEach(s => { s.update(); s.draw(); });
    bubbles.forEach(b => { b.update(); b.draw(); });
  }
  loop();
  window.addEventListener('resize', resize);
}

function initAllCanvases() {
  document.querySelectorAll('.card-canvas').forEach(cv => {
    if (cv.dataset.init) return;
    cv.dataset.init = '1';
    initCardCanvas(cv);
  });
}
