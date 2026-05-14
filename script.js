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
  const { data: perfiles } = await supabaseClient
    .from('perfiles')
    .select('grupo_id, grupos(id, nombre)')
    .eq('rol', 'alumno')
    .eq('estado', 'activo')
    .not('grupo_id', 'is', null);

  const gruposMap = new Map();
  (perfiles || []).forEach(p => {
    if (p.grupo_id && p.grupos?.nombre) {
      gruposMap.set(p.grupo_id, p.grupos.nombre);
    }
  });

  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">Seleccioná un grupo...</option>' +
    [...gruposMap.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, nombre]) => `<option value="${id}">${nombre}</option>`)
      .join('');

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
    mostrarResumenProgreso()
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
  await cargarSelectorMaterias();
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
  mostrarResumenProgreso()
  if (seleccionado !== 'ninguno') {
    document.getElementById('mascota-flotante').style.display = 'block';
  }
}

async function cargarBannerExamen() {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
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

  // Si hay materia seleccionada en sidebar, ir directo
  if (currentMateria) {
    const materiaObj = materias.find(m => m.id === currentMateria);
    if (materiaObj) { renderMultipleUnidades(materiaObj); return; }
  }

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
    ${!currentMateria ? `<button class="back-btn" style="margin-bottom:16px;width:auto;align-self:flex-start" onclick="renderMultiple()">← Volver a materias</button>` : ''}
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

  let query = supabaseClient
    .from('resultados_multiple')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (currentMateria) {
    const visibleIds = await getVisibleUserIds();
    const { data: unidadesDeMateria } = await supabaseClient
      .from('unidades').select('id')
      .eq('grupo_id', currentMateria)
      .in('alumno_id', visibleIds);
    const unidadIds = (unidadesDeMateria || []).map(u => u.id);
    if (unidadIds.length > 0) {
      query = query.in('unidad_id', unidadIds);
    } else {
      const statsEl = document.getElementById('multiple-stats');
      if (statsEl) statsEl.innerHTML = '<p style="color:var(--muted2);font-size:13px">No hay resultados para esta materia.</p>';
      return;
    }
  }

  const { data } = await query;

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

const TEORIA = [];

const PREGUNTAS = [];

/* ════════════════════════════════════════════════
   ESTADO DE LA APP
   ════════════════════════════════════════════════ */

let currentSection   = 'welcome';
let currentUnidad    = null;   // número de unidad activa (1-11)
let currentGrupoId = null;
let currentMateria = null; // grupo_id del selector de sidebar
let searchQuery      = '';
let refOrigin = null; // { unidad: X } para volver a preguntas de final
let pendingFilminaExpand = null; // id de filmina a expandir tras el próximo renderFilminas

/* ════════════════════════════════════════════════
   INICIALIZACIÓN
   ════════════════════════════════════════════════ */

function init() {
  document.getElementById('count-preguntas').textContent = PREGUNTAS.length;

  const conRefs = PREGUNTAS.filter(p => p.referencias && p.referencias.length > 0).length;
  document.getElementById('stat-con-refs').textContent  = conRefs;
  document.getElementById('stat-preguntas').textContent = PREGUNTAS.length;

  renderUnidadesGrid();
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

  const elF = document.getElementById('stat-filminas');
const elU = document.getElementById('stat-unidades');
if (currentMateria) {
  const uFiltradas = mcUnidades.filter(u => (u.grupo_id || '') === currentMateria);
  const idsF = uFiltradas.map(u => u.id);
  if (elF) elF.textContent = (todasFilminas || []).filter(f => idsF.includes(f.unidad_id)).length;
  if (elU) elU.textContent = new Set(uFiltradas.map(u => u.numero)).size;
} else {
  if (elF) elF.textContent = (todasFilminas || []).length;
  if (elU) elU.textContent = new Set(mcUnidades.map(u => u.numero)).size;
} 

  const grid = document.getElementById('units-grid');
  grid.innerHTML = '';

  if (!mcUnidades.length) {
    grid.innerHTML = `<div class="unit-empty"><div class="ue-icon">📂</div><h4>Sin unidades aún</h4><p>Creá tu primera unidad en Mi Contenido.</p></div>`;
    return;
  }

  // Si hay materia seleccionada en sidebar, ir directo a sus unidades
  if (currentMateria) {
    currentGrupoId = currentMateria;
    const filtradas = mcUnidades.filter(u => (u.grupo_id || '') === currentMateria);
    const grid = document.getElementById('units-grid');
    grid.innerHTML = '';
    const lista = document.createElement('div');
    lista.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;gap:10px';
    const uMap = new Map();
    filtradas.forEach(u => { if (!uMap.has(u.numero)) uMap.set(u.numero, u); });
    [...uMap.values()].sort((a, b) => a.numero - b.numero).forEach(u => {
      const filmCount = (todasFilminas || []).filter(f => f.unidad_id === u.id).length;
      const card = document.createElement('div');
      card.className = 'unit-card';
      card.innerHTML = `
        <div class="unit-card-main" onclick="openUnidad(${u.numero})">
          <div class="unit-num">${u.numero}</div>
          <div class="unit-info">
            <h4>${u.nombre}</h4>
            <div class="unit-filminas-count"><span>${filmCount > 0 ? filmCount + ' filmina' + (filmCount !== 1 ? 's' : '') : 'Sin filminas aún'}</span></div>
          </div>
          <div class="unit-arrow">→</div>
        </div>`;
      lista.appendChild(card);
    });
    grid.appendChild(lista);
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

  const elU = document.getElementById('stat-unidades');
  if (elU) elU.textContent = new Set(mcUnidades.map(u => u.numero)).size;

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
  if (!currentGrupoId) {
    // Usar currentMateria para encontrar el grupo correcto
    const unidad = currentMateria
      ? mcUnidades.find(u => u.numero === numero && u.grupo_id === currentMateria)
      : mcUnidades.find(u => u.numero === numero);
    currentGrupoId = unidad?.grupo_id || null;
  }
  const u = mcUnidades.find(x => x.numero === numero && x.grupo_id === currentGrupoId) || {};


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
const contenidoHtml = /<[a-z][\s\S]*>/i.test(t.contenido)
  ? contenidoRaw
  : contenidoRaw.replace(/\n/g, '<br>');
const contenido = contenidoHtml;
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
${(t.referencias && t.referencias.length) ? `
  <div class="filmina-refs-chips">
    ${t.referencias.map(r => `
      <span class="filmina-ref-chip" onclick="irAFilminaRef(${r.filmina_id})">
        🔗 ${r.texto_origen}
      </span>
    `).join('')}
  </div>
` : ''}
  </div>
</div>`;
    container.appendChild(card);
  });
  // Expandir filmina si hay una pendiente (navegación por referencia cruzada)
  if (pendingFilminaExpand) {
    const fId = pendingFilminaExpand;
    pendingFilminaExpand = null;
    setTimeout(() => {
      const card = document.getElementById(`card-${fId}`);
      if (card) {
        card.classList.add('expanded');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.7)';
        setTimeout(() => card.style.boxShadow = '', 2500);
      }
    }, 50);
  }
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
  // Si hay materia seleccionada, ir directo sin queries innecesarias
  if (currentMateria && currentPerfil?.rol !== 'superadmin') {
    await openMateriaPreguntasGrid(currentMateria);
    return;
  }

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

    // Si hay materia seleccionada en sidebar, ir directo
    if (currentMateria) {
      await openMateriaPreguntasGrid(currentMateria);
      return;
    }
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

 if (!currentMateria) {
  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.style.cssText = 'margin-bottom:16px;width:auto;align-self:flex-start';
  backBtn.textContent = '← Volver a materias';
  backBtn.onclick = () => renderPreguntasGrid();
  container.appendChild(backBtn);
}

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
  let queryUnidades = supabaseClient
    .from('unidades').select('*').in('alumno_id', visibleIds).eq('numero', numero);
  if (currentMateria) queryUnidades = queryUnidades.eq('grupo_id', currentMateria);
  const { data: unidades } = await queryUnidades;

  const unidadIds = (unidades || []).map(u => u.id);
  const unidadNombre = unidades?.[0]?.nombre ?? `Unidad ${numero}`;

  const { data: items } = await supabaseClient
    .from('preguntas_final').select('*')
    .in('unidad_id', unidadIds).order('created_at');

  const container = document.getElementById('preguntas-cards');
  container.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.style.cssText = 'margin-bottom:20px; width:auto; align-self:flex-start;';
  backBtn.textContent = '← Volver a Unidades';
  backBtn.onclick = () => { currentPreguntaUnidad = null; renderPreguntasGrid(); };
  container.appendChild(backBtn);

  const header = document.createElement('div');
  header.className = 'unit-view-header';
  header.innerHTML = `<div class="uvh-badge">Unidad ${numero}</div><h3>${unidadNombre}</h3>`;
  container.appendChild(header);

  if (!items || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'unit-empty';
    empty.innerHTML = `<div class="ue-icon">📂</div><h4>Sin preguntas aún</h4><p>Todavía no se cargaron preguntas para esta unidad.</p>`;
    container.appendChild(empty);
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
  ['welcome','teoria','preguntas','autoevaluacion','consulta', 'multiple','micontenido','calendario','superadmin','settings','progreso','plan'].forEach(id => {
    document.getElementById(`section-${id}`).style.display = 'none';
    const tab = document.getElementById(`tab-${id}`);
    if (tab) tab.classList.remove('active');
  });

  document.getElementById(`section-${s}`).style.display = s === 'welcome' ? 'block' : 'block';
  const tab = document.getElementById(`tab-${s}`);
  if (tab) tab.classList.add('active');

  const titles = { welcome: 'Inicio', teoria: 'Teoría', preguntas: 'Preguntas de Final', autoevaluacion: 'Autoevaluación', micontenido: 'Mi Contenido', plan: 'Plan de Estudio' };
  document.getElementById('section-title-bar').textContent = titles[s];

  // Mostrar barra de búsqueda solo en Teoría y Preguntas
const searchWrap = document.querySelector('.search-wrap');
const resultsCount = document.getElementById('resultsCount');
const soloConBusqueda = ['teoria', 'preguntas'];
searchWrap.style.display = soloConBusqueda.includes(s) ? 'flex' : 'none';
resultsCount.style.display = soloConBusqueda.includes(s) ? 'block' : 'none';

 if (s === 'teoria') {
  await renderUnidadesGrid();
  renderSubnav('teoria');
  getVisibleUserIds().then(visibleIds =>
    supabaseClient.from('filminas').select('unidad_id').in('alumno_id', visibleIds)
      .then(({ data }) => {
        const el = document.getElementById('count-teoria');
        if (el) {
          if (currentMateria) {
            const idsU = mcUnidades.filter(u => (u.grupo_id || '') === currentMateria).map(u => u.id);
            el.textContent = (data || []).filter(f => idsU.includes(f.unidad_id)).length;
          } else {
            el.textContent = (data || []).length;
          }
        }
      })
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
if (s === 'plan') renderPlan();
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
  if (pendingFilminaExpand) return; // navegación cruzada en curso, no re-renderizar
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
   REFERENCIAS CRUZADAS FILMINA → FILMINA
   ════════════════════════════════════════════════ */

function aplicarReferenciasFilmina(html, referencias) {
  if (!referencias || !referencias.length) return html;
  let result = html;
  referencias.forEach(ref => {
    if (!ref.texto_origen || !ref.filmina_id) return;
    const escaped = ref.texto_origen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    result = result.replace(regex,
      `<span class="filmina-ref-link" onclick="irAFilminaRef(${ref.filmina_id})">$1<span class="ref-icon"> ↗</span></span>`
    );
  });
  return result;
}

async function irAFilminaRef(filminaId) {
  const filminaOrigenEl = document.querySelector('.card.expanded');
  const filminaOrigenId = filminaOrigenEl ? filminaOrigenEl.dataset.filminaId : null;
  filminaRefOrigin = { unidad: currentUnidad, filminaId: filminaOrigenId };

  let target = (window.filminasActuales || []).find(f => f.id === filminaId);
  if (!target) {
    const { data } = await supabaseClient
      .from('filminas').select('*, unidades(numero, grupo_id)')
      .eq('id', filminaId).single();
    target = data;
  }
  if (!target) { alert('No se encontró la filmina de referencia.'); return; }

  const targetUnidad = mcUnidades.find(u => u.id === target.unidad_id);
  const targetUnidadNumero = targetUnidad?.numero || target.unidades?.numero;

  const backBtn = document.getElementById('back-to-filmina');
  backBtn.style.display = 'block';
  backBtn.style.bottom = '80px';

  // Setear flag ANTES del showSection para que clearSearch lo ignore
  pendingFilminaExpand = filminaId;
  await showSection('teoria');

  currentGrupoId = targetUnidad?.grupo_id || null;
  openUnidad(targetUnidadNumero);
}

async function volverAFilminaOrigen() {
  const origen = filminaRefOrigin;
  filminaRefOrigin = null;
  document.getElementById('back-to-filmina').style.display = 'none';
  if (origen?.unidad != null) {
    currentGrupoId = null;
    pendingFilminaExpand = origen.filminaId ? parseInt(origen.filminaId) : null;
    await showSection('teoria');
    openUnidad(origen.unidad);
  }
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
    // Global: filminas y preguntas de la materia seleccionada (o todas si no hay selección)
    let filminaQuery = supabaseClient.from('filminas').select('*').in('alumno_id', visibleIds);
    let preguntaQuery = supabaseClient.from('preguntas_final').select('*').in('alumno_id', visibleIds);

    if (currentMateria) {
      const { data: unidadesDeMateria } = await supabaseClient
        .from('unidades').select('id')
        .eq('grupo_id', currentMateria)
        .in('alumno_id', visibleIds);
      const unidadIds = (unidadesDeMateria || []).map(u => u.id);
      if (unidadIds.length > 0) {
        filminaQuery  = supabaseClient.from('filminas').select('*').in('unidad_id', unidadIds);
        preguntaQuery = supabaseClient.from('preguntas_final').select('*').in('unidad_id', unidadIds);
      }
    }

    const { data: filminas } = await filminaQuery;
    (filminas || []).forEach(t => {
      const uObj = mcUnidades.find(u => u.id === t.unidad_id);
      pool.push({
        pregunta: t.titulo, respuesta: t.contenido,
        tipo: 'filmina', unidad: uObj ? uObj.numero : null
      });
    });

    const { data: preguntas } = await preguntaQuery;
    (preguntas || []).forEach(p => {
      const uObj = mcUnidades.find(u => u.id === p.unidad_id);
      pool.push({
        pregunta: p.pregunta, respuesta: p.respuesta,
        tipo: 'final', unidad: uObj ? uObj.numero : null
      });
    });

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
          tiempo_usado: tiempoUsado,
          grupo_id: currentMateria || null
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
    let queryHistorial = supabaseClient
      .from('sesiones')
      .select('*, respuestas(*), analisis(*)')
      .eq('alumno_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (currentMateria) queryHistorial = queryHistorial.eq('grupo_id', currentMateria);

    const { data: sesiones } = await queryHistorial;

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

/* ════════════════════════════════════════════════
   SELECTOR DE MATERIA (SIDEBAR)
   ════════════════════════════════════════════════ */

async function cargarSelectorMaterias() {
  const wrap = document.getElementById('materia-select-wrap');
  const sel  = document.getElementById('materia-selector');
  if (!wrap || !sel) return;

  const visibleIds = await getVisibleUserIds();
  const { data: unidades } = await supabaseClient
    .from('unidades').select('grupo_id, grupos(id, nombre)')
    .in('alumno_id', visibleIds);

  const gruposMap = new Map();
  (unidades || []).forEach(u => {
    if (u.grupo_id && u.grupos?.nombre) {
      gruposMap.set(u.grupo_id, u.grupos.nombre);
    }
  });

  if (gruposMap.size === 0) { wrap.style.display = 'none'; return; }

  sel.innerHTML = '<option value="">📚 Todas las materias</option>' +
    [...gruposMap.entries()].map(([id, nombre]) =>
      `<option value="${id}">${nombre}</option>`
    ).join('');

  wrap.style.display = 'block';

  // Restaurar selección previa
  const saved = localStorage.getItem('materia_' + currentUser.id);
  if (saved && gruposMap.has(saved)) {
    sel.value = saved;
    currentMateria = saved;
    currentGrupoId = saved;
  }
}

function selectMateria() {
  const sel    = document.getElementById('materia-selector');
  const grupoId = sel.value || null;
  currentMateria = grupoId;
  currentGrupoId = grupoId;

  if (grupoId) {
    localStorage.setItem('materia_' + currentUser.id, grupoId);
  } else {
    localStorage.removeItem('materia_' + currentUser.id);
  }

   mostrarResumenProgreso();
  showSection(currentSection || 'welcome');
}

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

async function cargarMisGrupos(selectId) {
  const { data: grupos } = await supabaseClient
    .from('grupos')
    .select('id, nombre')
    .eq('admin_id', currentUser.id)
    .order('nombre');

  const sel = document.getElementById(selectId);
  if (!sel) return;

  if (!grupos?.length) {
    sel.innerHTML = '<option value="">No tenés materias creadas todavía</option>';
    return;
  }

  sel.innerHTML = '<option value="">Seleccioná una materia...</option>' +
    grupos.map(g => `<option value="${g.id}">${g.nombre}</option>`).join('');

  // Preseleccionar la materia activa del sidebar
  if (currentGrupoId) sel.value = currentGrupoId;
}

function showFormUnidad() {
  document.getElementById('mc-form-unidad').style.display = 'block';
  document.getElementById('mc-unidad-numero').value = '';
  document.getElementById('mc-unidad-nombre').value = '';
  document.getElementById('mc-unidad-grupo-wrap').style.display = 'block';
  cargarMisGrupos('mc-unidad-grupo');
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
    const updateData = { unidad_id: parseInt(unidad_id), titulo, contenido, keywords, referencias: editandoFilminaRefs };
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
      referencias: editandoFilminaRefs,
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
            <div class="mc-grupo-header" style="background:var(--dark2)">
  <span class="mc-grupo-title" style="font-size:13px;cursor:pointer;flex:1" onclick="toggleGrupoUnidadFilminas('${uKey}')">📘 ${unidad.nombre} (${unidad.filminas.length})</span>
  <button onclick="toggleReordenar('${uKey}')" id="btn-reordenar-${uKey}" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-size:11px;padding:3px 8px;cursor:pointer;margin-right:6px">↕ Reordenar</button>
  <span class="mc-grupo-toggle" id="mc-uf-toggle-${uKey}" style="cursor:pointer" onclick="toggleGrupoUnidadFilminas('${uKey}')">▼</span>
</div>
            <div id="mc-uf-items-${uKey}" style="display:none;background:var(--dark2,#0f0f1a);padding:8px">
              ${[...unidad.filminas].sort((a,b) => (a.orden||0)-(b.orden||0)).map(f => `
  <div class="mc-item mc-sortable" draggable="false" data-id="${f.id}"
    ondragstart="onDragStart(event)"
    ondragover="onDragOver(event)"
    ondrop="onDrop(event, '${uId}')"
    ondragend="onDragEnd(event)">
    <span class="mc-drag-handle" title="Arrastrá para reordenar">⠿</span>
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
  if (currentMateria && !esSuperadmin) queryS = queryS.eq('grupo_id', currentMateria);
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
let editandoFilminaRefs = []; // referencias de la filmina que se está editando

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
  // Cargar referencias existentes
  editandoFilminaRefs = Array.isArray(f.referencias) ? [...f.referencias] : [];
  renderReferenciasForm();
  document.getElementById('mc-ref-texto').value = '';
  document.getElementById('mc-ref-buscar').value = '';
  document.getElementById('mc-ref-resultados').innerHTML = '';
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
  const systemPrompt = `Sos el Profe IA, un profesor universitario de la carrera de Contador Público. Sos exigente pero justo, y tu objetivo es que el alumno aprenda de verdad.
${contexto}

Tu forma de responder depende de lo que haga el alumno:

MODO EVALUACIÓN (cuando el alumno explica un concepto, responde algo o comparte su entendimiento de un tema):
Respondé con este formato exacto:
📊 CALIFICACIÓN: X/10
✅ LO QUE ESTUVO BIEN: (qué conceptos manejó correctamente)
❌ A CORREGIR: (errores, imprecisiones o conceptos incompletos)
💡 RECOMENDACIÓN: (un consejo de estudio concreto relacionado al tema)

MODO CONSULTA (cuando el alumno hace una pregunta o pide que le expliques algo):
Respondé la pregunta de forma clara y directa. Al final, agregá siempre:
💡 TIP DE ESTUDIO: (una recomendación concreta del listado de abajo, elegida según el contexto)

Recomendaciones de estudio que podés usar (elegí la más relevante según el tema):
- Estudiá con tiempo, no dejés todo para el final
- Usá active recall: cerrá el material y escribí todo lo que recordás sin mirar
- Aplicá la técnica Pomodoro: 25 minutos de foco total, 5 de descanso
- Hacé flashcards con los conceptos clave para repasar en cualquier momento
- Repasá en intervalos espaciados: hoy, en 3 días, en una semana
- Intentá explicar cada tema con tus propias palabras como si se lo enseñaras a alguien
- Relacioná los temas nuevos con los que ya estudiaste antes
- No solo leas: resolvé ejercicios prácticos para fijar la teoría

Respondé siempre en español argentino, de forma directa y sin rodeos.
Sin markdown ni asteriscos. Solo texto plano.
Máximo 350 palabras por respuesta.`;

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
    ${!currentMateria ? `<button class="back-btn" style="margin-bottom:16px;width:auto;align-self:flex-start" onclick="renderUnidadesGrid()">← Volver a materias</button>` : ''}
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
  const banner = document.getElementById('banner-repasos');
  if (!banner) return;

  const { data: repasos } = await supabaseClient
    .from('flashcard_repasos')
    .select('id, filmina_id')
    .eq('alumno_id', currentUser.id)
    .lte('proxima_revision', hoy);

  if (!repasos || !repasos.length) { banner.style.display = 'none'; return; }

  let filminaIds = repasos.map(r => r.filmina_id);

  // Filtrar por materia si hay una seleccionada
  if (currentMateria) {
    const visibleIds = await getVisibleUserIds();
    const { data: unidadesDeMateria } = await supabaseClient
      .from('unidades').select('id')
      .eq('grupo_id', currentMateria)
      .in('alumno_id', visibleIds);
    const unidadIds = (unidadesDeMateria || []).map(u => u.id);

    const { data: filminasDeMateria } = await supabaseClient
      .from('filminas').select('id')
      .in('unidad_id', unidadIds);
    const filminaIdsDeMateria = (filminasDeMateria || []).map(f => f.id);

    filminaIds = filminaIds.filter(id => filminaIdsDeMateria.includes(id));
  }

  if (filminaIds.length > 0) {
    banner.style.display = 'block';
    banner.innerHTML = `🃏 Tenés <strong>${filminaIds.length}</strong> flashcard${filminaIds.length !== 1 ? 's' : ''} para repasar hoy. <a href="#" onclick="abrirRepasosHoy()">Ir a repasar →</a>`;
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
  let unidadesQuery = supabaseClient.from('unidades').select('*, grupos(id, nombre)').in('alumno_id', visibleIds).order('numero');
  if (currentMateria) unidadesQuery = unidadesQuery.eq('grupo_id', currentMateria);

  let sesionesQuery = supabaseClient.from('sesiones').select('*, respuestas(*)').eq('alumno_id', currentUser.id);
  if (currentMateria) sesionesQuery = sesionesQuery.eq('grupo_id', currentMateria);

  const [{ data: unidades }, { data: filminas }, { data: sesiones }, { data: repasos }, { data: todasSesionesPomodoro }] = await Promise.all([
    unidadesQuery,
    supabaseClient.from('filminas').select('id, unidad_id').in('alumno_id', visibleIds),
    sesionesQuery,
    supabaseClient.from('flashcard_repasos').select('filmina_id, repeticiones, easiness_factor').eq('alumno_id', currentUser.id),
    supabaseClient.from('sesiones_pomodoro').select('*').eq('alumno_id', currentUser.id).order('created_at', { ascending: false })
  ]);

  // Filtrar pomodoros por filminas de la materia seleccionada
  let sesionesPomodoro = todasSesionesPomodoro;
  if (currentMateria && unidades && filminas) {
    const unidadIdsDeMateria = new Set((unidades || []).map(u => u.id));
    const filminaIdsDeMateria = new Set(
      (filminas || []).filter(f => unidadIdsDeMateria.has(f.unidad_id)).map(f => f.id)
    );
    sesionesPomodoro = (todasSesionesPomodoro || []).filter(s =>
      (s.filminas_ids || []).some(id => filminaIdsDeMateria.has(id))
    );
  }

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
            <div style="font-size:13px; color:var(--muted2); margin-bottom:6px; font-style:italic;">
  <span id="resumen-${s.id}-text" style="-webkit-line-clamp:3; display:-webkit-box; -webkit-box-orient:vertical; overflow:hidden;">"${s.resumen || ''}"</span>
  ${(s.resumen?.length || 0) > 120 ? `<button onclick="
    const el=document.getElementById('resumen-${s.id}-text');
    const btn=this;
    if(el.style.webkitLineClamp){el.style.webkitLineClamp='';el.style.display='block';btn.textContent='Ver menos'}
    else{el.style.webkitLineClamp='3';el.style.display='-webkit-box';btn.textContent='Ver más'}
  " style="background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;padding:2px 0;font-style:normal;">Ver más</button>` : ''}
</div>
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
  const lista = document.getElementById('recall-filminas-lista');
  const feedbackEl = document.getElementById('recall-feedback');
  const botonesEl = document.getElementById('recall-botones');

  feedbackEl.style.display = 'none';
  botonesEl.style.display = 'flex';

  const todasFilminas = window.filminasActuales || [];
  const filminasLeidas = todasFilminas.filter(f => filminas_leidas_sesion.includes(parseInt(f.id)));

  if (!filminasLeidas.length) {
    lista.innerHTML = '<p style="color:var(--muted2);font-size:13px;">No abriste ninguna filmina en esta sesión.</p>';
  } else {
    lista.innerHTML = filminasLeidas.map((f, i) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="background:rgba(124,109,250,0.2);color:var(--accent);font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;flex-shrink:0;">FILMINA ${i + 1}</span>
          <span style="color:var(--white);font-size:14px;font-weight:600;">${escHtml(f.titulo)}</span>
        </div>
        <textarea id="recall-texto-${f.id}" rows="3" placeholder="¿Qué aprendiste de esta filmina?"
          style="width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--white);font-size:13px;resize:vertical;outline:none;box-sizing:border-box;"></textarea>
      </div>
    `).join('');
  }

  modal.style.display = 'flex';
}

function cerrarModalRecall() {
  document.getElementById('modal-recall').style.display = 'none';
}

async function enviarEvaluacionFilminas() {
  const todasFilminas = window.filminasActuales || [];
  const filminasLeidas = todasFilminas.filter(f => filminas_leidas_sesion.includes(parseInt(f.id)));

  if (!filminasLeidas.length) {
    alert('No abriste ninguna filmina en esta sesión.');
    return;
  }

  const resumenes = filminasLeidas.map(f => ({
    filmina: f,
    texto: (document.getElementById(`recall-texto-${f.id}`)?.value || '').trim()
  }));

  const sinTexto = resumenes.filter(r => !r.texto);
  if (sinTexto.length) {
    alert(`Escribí algo en todas las filminas antes de enviar. Falta: ${sinTexto.map(r => r.filmina.titulo).join(', ')}`);
    return;
  }

  const feedbackEl = document.getElementById('recall-feedback');
  const botonesEl = document.getElementById('recall-botones');

  feedbackEl.style.display = 'block';
  feedbackEl.innerHTML = `
    <div style="text-align:center;padding:24px;color:var(--muted);">
      <div style="font-size:32px;margin-bottom:10px;">🤖</div>
      <p style="font-size:14px;">Evaluando ${filminasLeidas.length} filmina${filminasLeidas.length !== 1 ? 's' : ''}...</p>
      <p style="font-size:12px;color:var(--muted2);margin-top:4px;">Las evaluaciones se hacen en paralelo, ya terminamos.</p>
    </div>`;
  botonesEl.style.display = 'none';

  // Llamadas en paralelo a la IA
  const evaluaciones = await Promise.all(resumenes.map(async ({ filmina, texto }) => {
    const contenidoTexto = (filmina.contenido || '').replace(/<[^>]*>/g, ' ').substring(0, 300);
    const prompt = `Sos un evaluador de aprendizaje universitario. El alumno estudió esta filmina de contabilidad:
Título: ${filmina.titulo}
Contenido: ${contenidoTexto}

El alumno escribió:
"${texto}"

Evaluá del 1 al 10 qué tan bien comprendió el contenido de la filmina.
Respondé EXACTAMENTE con este formato sin texto adicional:
PUNTAJE: [número del 1 al 10]
FEEDBACK: [1 oración breve y directa en español argentino]`;

    try {
      const res = await fetch(IA_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 150
        })
      });
      const data = await res.json();
      const respuesta = data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
      const puntajeMatch = respuesta.match(/PUNTAJE:\s*(\d+)/i);
      const feedbackMatch = respuesta.match(/FEEDBACK:\s*(.+)/i);
      return {
        filmina,
        texto,
        puntaje: puntajeMatch ? Math.min(10, Math.max(1, parseInt(puntajeMatch[1]))) : null,
        feedback: feedbackMatch ? feedbackMatch[1].trim() : 'Sin feedback.'
      };
    } catch (e) {
      return { filmina, texto, puntaje: null, feedback: 'Error al evaluar.' };
    }
  }));

  // Puntaje promedio de la sesión
  const conPuntaje = evaluaciones.filter(e => e.puntaje !== null);
  const promedio = conPuntaje.length
    ? Math.round(conPuntaje.reduce((a, b) => a + b.puntaje, 0) / conPuntaje.length)
    : null;

  // Guardar sesión en sesiones_pomodoro
  const { data: sesionData } = await supabaseClient.from('sesiones_pomodoro').insert({
    alumno_id: currentUser.id,
    filminas_ids: filminas_leidas_sesion,
    resumen: resumenes.map(r => `${r.filmina.titulo}: ${r.texto}`).join(' | '),
    feedback_ia: evaluaciones.map(e => `${e.filmina.titulo}: ${e.feedback}`).join(' | '),
    puntaje: promedio,
    duracion_segundos: pomodoroInicioTimestamp ? Math.round((Date.now() - pomodoroInicioTimestamp) / 1000) : null
  }).select().single();

  // Guardar scores individuales en filmina_scores
  if (sesionData?.id) {
    await supabaseClient.from('filmina_scores').insert(
      evaluaciones.map(e => ({
        alumno_id: currentUser.id,
        filmina_id: parseInt(e.filmina.id),
        sesion_pomodoro_id: sesionData.id,
        puntaje: e.puntaje,
        resumen_alumno: e.texto,
        feedback_ia: e.feedback
      }))
    );
  }

  filminas_leidas_sesion = [];

  // Mostrar resultados
  const getColor = p => !p ? '#94a3b8' : p >= 7 ? '#22c55e' : p >= 5 ? '#f59e0b' : '#ef4444';
  const getEmoji = p => !p ? '❓' : p >= 8 ? '🌟' : p >= 6 ? '👍' : p >= 4 ? '💪' : '📖';

  feedbackEl.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;color:var(--muted);font-weight:600;">Resultados de la sesión</span>
        ${promedio !== null ? `<span style="font-size:22px;font-weight:700;color:${getColor(promedio)};">${promedio}/10</span>` : ''}
      </div>
      ${evaluaciones.map(e => `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start;">
          <span style="font-size:22px;flex-shrink:0;">${getEmoji(e.puntaje)}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:13px;font-weight:600;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(e.filmina.titulo)}</span>
              ${e.puntaje !== null ? `<span style="font-weight:700;color:${getColor(e.puntaje)};font-size:15px;flex-shrink:0;margin-left:8px;">${e.puntaje}/10</span>` : ''}
            </div>
            <p style="font-size:12px;color:var(--muted2);margin:0;">${e.feedback}</p>
          </div>
        </div>
      `).join('')}
      ${promedio !== null && promedio < 7
        ? `<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:12px;margin-top:8px;font-size:13px;color:#f59e0b;">
            💡 Promedio de <strong>${promedio}/10</strong>. Te recomendamos repasar las filminas con puntaje bajo antes del próximo Pomodoro.
           </div>`
        : promedio !== null
        ? `<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:12px;margin-top:8px;font-size:13px;color:#22c55e;">
            🎉 ¡Excelente sesión! Promedio <strong>${promedio}/10</strong>. Seguí así.
           </div>`
        : ''}
    </div>
    <button onclick="cerrarModalRecall()" style="width:100%;background:var(--accent);border:none;border-radius:10px;padding:12px;color:#fff;font-weight:700;font-size:14px;cursor:pointer;">Cerrar y descansar ✓</button>
  `;
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

/* ════════════════════════════════════════════════
   RESUMEN DE PROGRESO AL INICIAR
   ════════════════════════════════════════════════ */

async function mostrarResumenProgreso() {
  const modal = document.getElementById('modal-resumen-progreso');
  if (!modal) return;

  modal.style.display = 'flex';
  document.getElementById('resumen-body').innerHTML = `
    <div style="text-align:center;padding:40px 0;color:var(--muted)">
      <div style="font-size:32px;margin-bottom:12px">⏳</div>
      <p>Cargando tu progreso...</p>
    </div>`;

  try {
    const hoy = new Date().toISOString().split('T')[0];

    // 1. Sesiones de autoevaluación
    let sesionesQuery = supabaseClient
      .from('sesiones')
      .select('unidad, cant_preguntas, fecha')
      .eq('alumno_id', currentUser.id)
      .order('fecha', { ascending: false })
      .limit(200);
    if (currentMateria) sesionesQuery = sesionesQuery.eq('grupo_id', currentMateria);
    const { data: sesiones } = await sesionesQuery;

    // 2. Sesiones Pomodoro
    const { data: pomodorosRaw } = await supabaseClient
  .from('sesiones_pomodoro')
  .select('duracion_segundos, puntaje, filminas_ids, created_at')
  .eq('alumno_id', currentUser.id);;

    // 3. Flashcard repasos
let flashcardsQuery = supabaseClient
  .from('flashcard_repasos')
  .select('filmina_id, repeticiones, proxima_revision, easiness_factor')
  .eq('alumno_id', currentUser.id);
const { data: flashcardsRaw } = await flashcardsQuery;

let flashcards = flashcardsRaw || [];

// Si hay materia seleccionada, filtrar por filminas de esa materia
if (currentMateria && flashcards.length) {
  const visibleIds = await getVisibleUserIds();
  const { data: unidadesDeMateria } = await supabaseClient
    .from('unidades').select('id')
    .eq('grupo_id', currentMateria)
    .in('alumno_id', visibleIds);
  const unidadIds = (unidadesDeMateria || []).map(u => u.id);

  const { data: filminasDeMateria } = await supabaseClient
    .from('filminas').select('id')
    .in('unidad_id', unidadIds);
  const filminaIdsDeMateria = new Set((filminasDeMateria || []).map(f => f.id));

  flashcards = flashcards.filter(f => filminaIdsDeMateria.has(f.filmina_id));
}

    // 4. Resultados opción múltiple
    // DESPUÉS
let mcQuery = supabaseClient
  .from('resultados_multiple')
  .select('correctas, total, grupo_nombre, unidad_id')
  .eq('user_id', currentUser.id);
const { data: resultadosMCRaw } = await mcQuery;

let resultadosMC = resultadosMCRaw || [];
if (currentMateria && resultadosMC.length) {
  const { data: grupoActivo } = await supabaseClient
    .from('grupos').select('nombre').eq('id', currentMateria).single();

  const { data: unidadesDeMateria } = await supabaseClient
    .from('unidades').select('id')
    .eq('grupo_id', currentMateria)
    .eq('alumno_id', currentUser.id);
  const unidadIds = new Set((unidadesDeMateria || []).map(u => u.id));

  resultadosMC = resultadosMC.filter(r =>
    r.grupo_nombre === grupoActivo?.nombre ||  // registros nuevos
    (r.grupo_nombre === null && unidadIds.has(r.unidad_id))  // registros viejos sin grupo
  );
}

    // 5. Próximo examen
    let eventosQuery = supabaseClient
  .from('eventos')
  .select('titulo, fecha, tipo')
  .eq('user_id', currentUser.id)
  .eq('tipo', 'examen')
  .gte('fecha', hoy)
  .order('fecha', { ascending: true })
  .limit(1);
if (currentMateria) eventosQuery = eventosQuery.eq('grupo_id', currentMateria);
const { data: proximosEventos } = await eventosQuery;

// 6. Unidades practicadas vs totales
const visibleIdsResumen = await getVisibleUserIds();
let unidadesQuery = supabaseClient
  .from('unidades')
  .select('id, numero, nombre')
  .in('alumno_id', visibleIdsResumen)
  .order('numero');
if (currentMateria) unidadesQuery = unidadesQuery.eq('grupo_id', currentMateria);
const { data: todasUnidades } = await unidadesQuery;

// Filminas por unidad (para progreso)
const { data: filminasResumen } = await supabaseClient
  .from('filminas').select('id, unidad_id, alumno_id')
  .in('unidad_id', (todasUnidades || []).map(u => u.id))
  .in('alumno_id', visibleIdsResumen);

    // ── Métricas ──

    // Filtrar pomodoros por materia (via filminas_ids)
    let pomodoros = pomodorosRaw || [];
    if (currentMateria) {
      const filminaIdsDeMateria = new Set((filminasResumen || []).map(f => f.id));
      pomodoros = pomodoros.filter(s =>
        (s.filminas_ids || []).some(id => filminaIdsDeMateria.has(id))
      );
    }

    // ── Métricas ──

    const totalSesiones = (sesiones || []).length;
    const minutosEstudio = Math.round(
      (pomodoros || []).reduce((a, p) => a + (p.duracion_segundos || 0), 0) / 60
    );
    const pomodorosConPuntaje = (pomodoros || []).filter(p => p.puntaje != null);
const promedioPuntaje = pomodorosConPuntaje.length > 0
  ? Math.round(pomodorosConPuntaje.reduce((a, p) => a + p.puntaje, 0) / pomodorosConPuntaje.length * 10) / 10
  : null;
    const fcDominadas   = (flashcards || []).filter(f => f.repeticiones >= 3).length;
    const fcParaRepasar = (flashcards || []).filter(f => f.proxima_revision && f.proxima_revision <= hoy).length;

    // Promedio opción múltiple
    let promedioMC = null;
    if (resultadosMC?.length) {
      const totalCorrectas = resultadosMC.reduce((a, r) => a + (r.correctas || 0), 0);
      const totalPregs     = resultadosMC.reduce((a, r) => a + (r.total || 0), 0);
      if (totalPregs > 0) promedioMC = Math.round((totalCorrectas / totalPregs) * 100);
    }

// Promedio MC por materia
    const promediosPorMateria = [];
    const gruposMC = [...new Set((resultadosMC||[]).map(r => r.grupo_nombre).filter(Boolean))];
    gruposMC.forEach(g => {
      const regs = resultadosMC.filter(r => r.grupo_nombre === g);
      const c = regs.reduce((a, r) => a + (r.correctas || 0), 0);
      const t = regs.reduce((a, r) => a + (r.total || 0), 0);
      if (t > 0) promediosPorMateria.push({ nombre: g, pct: Math.round((c / t) * 100) });
    });

    // Racha de días consecutivos
    const diasConActividad = new Set(
      (sesiones || []).map(s => s.fecha?.split('T')[0]).filter(Boolean)
    );
    let racha = 0;
    const fechaIter = new Date();
    for (let i = 0; i < 60; i++) {
      const d = fechaIter.toISOString().split('T')[0];
      if (diasConActividad.has(d)) {
        racha++;
        fechaIter.setDate(fechaIter.getDate() - 1);
      } else {
        if (i === 0) fechaIter.setDate(fechaIter.getDate() - 1); // si hoy no estudió, revisar ayer
        else break;
      }
    }

    // Días sin estudiar (considera autoevaluación + pomodoros)
    const fechasAE = (sesiones || []).map(s => s.fecha?.split('T')[0]).filter(Boolean);
    const fechasPomo = (pomodoros || []).map(s => s.created_at?.split('T')[0]).filter(Boolean);
    const todasFechasEstudio = [...new Set([...fechasAE, ...fechasPomo])].sort().reverse();
    const ultimaSesion = todasFechasEstudio[0] || null;
    let diasSinEstudiar = null;
    if (ultimaSesion) {
      const diff = new Date(hoy) - new Date(ultimaSesion);
      diasSinEstudiar = Math.floor(diff / (1000 * 60 * 60 * 24));
    }

    // Cobertura de unidades
    const unidadesPracticadas = new Set(
      (sesiones || []).map(s => s.unidad).filter(u => u && u !== 'Global')
    ).size;
    const totalUnidades = (todasUnidades || []).length;

    // Próximo examen
    const proximoExamen = proximosEventos?.[0] || null;
    let diasParaExamen = null;
    if (proximoExamen) {
      const diff = new Date(proximoExamen.fecha) - new Date(hoy);
      diasParaExamen = Math.floor(diff / (1000 * 60 * 60 * 24));
    }

    // Progreso por unidad (flashcards + autoevaluación)
const filminasPorUnidad = {};
(filminasResumen || []).forEach(f => {
  if (!filminasPorUnidad[f.unidad_id]) filminasPorUnidad[f.unidad_id] = [];
  filminasPorUnidad[f.unidad_id].push(f.id);
});

const repasosPorFilmina = {};
(flashcards || []).forEach(r => {
  if (r.easiness_factor > 2.5) repasosPorFilmina[r.filmina_id] = true;
});

console.log('filminasResumen:', filminasResumen?.length);
console.log('flashcards:', flashcards?.length);
console.log('repasosPorFilmina:', Object.keys(repasosPorFilmina).length);

const sesionsPorUnidad = {};
    (sesiones || []).forEach(s => {
      const u = s.unidad || 'Global';
      if (!sesionsPorUnidad[u]) sesionsPorUnidad[u] = [];
      const total = s.cant_preguntas || 0;
      if (total > 0) sesionsPorUnidad[u].push(total);
    });

    const sinDatos = totalSesiones === 0 && minutosEstudio === 0 && (flashcards || []).length === 0;
    if (sinDatos) {
      document.getElementById('resumen-body').innerHTML = `
        <div style="text-align:center;padding:32px 0">
          <div style="font-size:48px;margin-bottom:16px">🌱</div>
          <h3 style="color:var(--white);margin-bottom:8px">¡Empezá hoy!</h3>
          <p style="color:var(--muted);font-size:14px">Todavía no tenés actividad registrada.<br>Explorá el material y completá tu primera autoevaluación.</p>
        </div>`;
      return;
    }

    const porUnidad = {};
    (sesiones || []).forEach(s => {
      if (!s.unidad || s.unidad === 'Global') return;
      if (!porUnidad[s.unidad]) porUnidad[s.unidad] = 0;
      porUnidad[s.unidad]++;
    });
    const unidadesOrdenadas = Object.entries(porUnidad).sort((a, b) => a[1] - b[1]);
    const puntoDebil  = unidadesOrdenadas[0] || null;
    const puntoFuerte = unidadesOrdenadas[unidadesOrdenadas.length - 1] || null;

    // Pre-calcular HTML de unidades para evitar template literals anidados
    const unidadesHtml = (todasUnidades || []).map(u => {
      const filminasDeUnidad = filminasPorUnidad[u.id] || [];
      const totalFilminas = filminasDeUnidad.length;
      const filminasRepasadas = filminasDeUnidad.filter(id => repasosPorFilmina[id]).length;
      const pctFlashcards = totalFilminas > 0 ? Math.round((filminasRepasadas / totalFilminas) * 100) : 0;
      const sesionesU = sesionsPorUnidad[u.numero] || [];
      const pctAE = sesionesU.length > 0 ? Math.round(sesionesU.reduce((a, b) => a + b, 0) / sesionesU.length) : 0;
      const progreso = totalFilminas > 0 ? Math.round((pctFlashcards * 0.6) + (pctAE * 0.4)) : pctAE;
      const color = progreso >= 71 ? '#22c55e' : progreso >= 41 ? '#f59e0b' : '#ef4444';
      const estado = progreso >= 71 ? '✅ Dominado' : progreso >= 41 ? '📈 En progreso' : '🔴 Necesita repasar';
      return '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
        + '<span style="font-size:13px;font-weight:600;color:var(--white)">U' + u.numero + ' \u2014 ' + escHtml(u.nombre) + '</span>'
        + '<span style="font-size:11px;color:' + color + '">' + estado + '</span>'
        + '</div>'
        + '<div style="background:rgba(255,255,255,0.08);border-radius:4px;height:6px;margin-bottom:6px">'
        + '<div style="height:6px;border-radius:4px;width:' + progreso + '%;background:' + color + ';transition:width 0.3s"></div>'
        + '</div>'
        + '<div style="display:flex;gap:12px;font-size:11px;color:var(--muted)">'
        + '<span>🃏 ' + pctFlashcards + '% (' + filminasRepasadas + '/' + totalFilminas + ')</span>'
        + '<span>📝 ' + (pctAE > 0 ? pctAE + '%' : 'Sin datos') + '</span>'
        + '<span style="font-weight:700;color:' + color + '">' + progreso + '%</span>'
        + '</div>'
        + (progreso < 71 ? '<button onclick="cerrarResumen();showSection(\'teoria\');openUnidad(' + u.numero + ')" style="margin-top:8px;width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;background:var(--dark2);color:var(--muted);font-size:12px;cursor:pointer">Repasar Unidad ' + u.numero + ' \u2192</button>' : '')
        + '</div>';
    }).join('');

    const slides = [
      // SLIDE 1 — Pomodoro
      `<div class="rslide">
        <div class="rslide-title">⏱ Sesiones de estudio</div>
        ${proximoExamen ? `<div class="resumen-alerta examen" style="margin-bottom:10px">
          <div class="ra-icon">📅</div>
          <div><div class="ra-titulo">Próximo: ${escHtml(proximoExamen.titulo)}</div>
          <div class="ra-subtitulo">${diasParaExamen === 0 ? '¡Es hoy!' : diasParaExamen === 1 ? 'Mañana' : 'En ' + diasParaExamen + ' días'}</div></div>
          <button class="ra-btn" onclick="cerrarResumen();showSection('autoevaluacion')">Practicar →</button>
        </div>` : ''}
        ${diasSinEstudiar !== null && diasSinEstudiar >= 3 ? `<div class="resumen-alerta debil" style="margin-bottom:10px">
          <div class="ra-icon">😴</div>
          <div><div class="ra-titulo">Llevás ${diasSinEstudiar} días sin estudiar</div>
          <div class="ra-subtitulo">¡Retomá el ritmo hoy!</div></div>
          <button class="ra-btn" onclick="cerrarResumen();showSection('teoria')">Empezar →</button>
        </div>` : ''}
        <div class="resumen-chips" style="margin-bottom:10px">
          <div class="resumen-chip"><div class="rc-valor">${(pomodoros||[]).length}</div><div class="rc-label">Sesiones</div></div>
          <div class="resumen-chip"><div class="rc-valor">${minutosEstudio}</div><div class="rc-label">Min. estudiados</div></div>
          ${promedioPuntaje !== null ? `<div class="resumen-chip"><div class="rc-valor" style="color:${promedioPuntaje>=7?'#22c55e':promedioPuntaje>=5?'#f59e0b':'#ef4444'}">${promedioPuntaje}/10</div><div class="rc-label">Promedio recall</div></div>` : ''}
          ${racha > 1 ? `<div class="resumen-chip" style="border-color:rgba(255,160,0,0.4)"><div class="rc-valor" style="color:#FFA000">🔥 ${racha}</div><div class="rc-label">Días seguidos</div></div>` : ''}
        </div>
        ${(pomodoros||[]).length === 0 ? '<p style="color:var(--muted);font-size:13px;text-align:center;padding:8px 0">Todavía no registrás sesiones Pomodoro.</p>' : ''}
        ${resultadosMC.length > 0 ? `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:12px;margin-bottom:8px">✅ Opción múltiple</div>
        <div class="resumen-chips" style="margin-bottom:4px">
          <div class="resumen-chip"><div class="rc-valor">${resultadosMC.length}</div><div class="rc-label">Tests hechos</div></div>
          ${promedioMC !== null ? `<div class="resumen-chip" style="border-color:rgba(80,200,120,0.4)"><div class="rc-valor" style="color:${promedioMC >= 70 ? '#50C878' : '#FF6B6B'}">${promedioMC}%</div><div class="rc-label">Promedio aciertos</div></div>` : ''}
          ${promediosPorMateria.map(m => `<div class="resumen-chip"><div class="rc-valor" style="color:${m.pct >= 70 ? '#50C878' : '#FF6B6B'}">${m.pct}%</div><div class="rc-label" style="font-size:10px">Por materia</div></div>`).join('')}
        </div>` : ''}
      </div>`,

      // SLIDE 2 — Flashcards
      `<div class="rslide">
        <div class="rslide-title">🃏 Flashcards</div>
        <div class="resumen-chips" style="margin-bottom:12px">
          <div class="resumen-chip"><div class="rc-valor">${(flashcards||[]).length}</div><div class="rc-label">Trabajadas</div></div>
          <div class="resumen-chip"><div class="rc-valor">${fcDominadas}</div><div class="rc-label">Dominadas</div></div>
          <div class="resumen-chip" style="${fcParaRepasar > 0 ? 'border-color:rgba(255,100,100,0.4)' : ''}">
            <div class="rc-valor" style="${fcParaRepasar > 0 ? 'color:#FF6B6B' : ''}">${fcParaRepasar}</div>
            <div class="rc-label">Para repasar hoy</div>
          </div>
        </div>
        ${fcParaRepasar > 0 ? `<div class="resumen-alerta neutral">
          <div class="ra-icon">🃏</div>
          <div><div class="ra-titulo">Flashcards pendientes</div>
          <div class="ra-subtitulo">${fcParaRepasar} tarjeta${fcParaRepasar !== 1 ? 's' : ''} para hoy</div></div>
          <button class=\"ra-btn\" onclick=\"cerrarResumen();abrirRepasosHoy()\">Ver →</button>
        </div>` : '<p style=\"color:#22c55e;font-size:13px;text-align:center;padding:8px 0\">✅ ¡Al día con todas las flashcards!</p>'}
        ${(todasUnidades||[]).length > 0 ? '<div style=\"font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:12px;margin-bottom:8px\">Progreso por unidad</div>' + unidadesHtml : ''}
      </div>`,

      // SLIDE 3 — Autoevaluaciones
      `<div class="rslide">
        <div class="rslide-title">🎙 Autoevaluaciones</div>
        <div class="resumen-chips" style="margin-bottom:12px">
          <div class="resumen-chip"><div class="rc-valor">${totalSesiones}</div><div class="rc-label">Tests hechos</div></div>
          <div class="resumen-chip"><div class="rc-valor">${unidadesPracticadas}/${totalUnidades}</div><div class="rc-label">Unidades cubiertas</div></div>
        </div>
        ${puntoDebil ? `<div class="resumen-alerta debil" style="margin-bottom:8px">
          <div class="ra-icon">⚠️</div>
          <div><div class="ra-titulo">Menos practicada</div>
          <div class="ra-subtitulo">${escHtml(puntoDebil[0])} — ${puntoDebil[1]} test${puntoDebil[1] !== 1 ? 's' : ''}</div></div>
          <button class="ra-btn" onclick="cerrarResumen();showSection('teoria')">Repasar →</button>
        </div>` : ''}
        ${puntoFuerte && puntoFuerte[0] !== (puntoDebil ? puntoDebil[0] : null) ? `<div class="resumen-alerta fuerte">
          <div class="ra-icon">💪</div>
          <div><div class="ra-titulo">Más practicada</div>
          <div class="ra-subtitulo">${escHtml(puntoFuerte[0])} — ${puntoFuerte[1]} test${puntoFuerte[1] !== 1 ? 's' : ''}</div></div>
        </div>` : ''}
        ${totalSesiones === 0 ? '<p style="color:var(--muted);font-size:13px;text-align:center;padding:8px 0">Todavía no completaste autoevaluaciones.</p>' : ''}
      </div>`
    ];

    let slideActual = 0;

function renderCarousel() {
      const btnStyle = 'background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:50%;width:32px;height:32px;cursor:pointer;color:var(--white);font-size:18px;display:flex;align-items:center;justify-content:center;z-index:2;position:absolute;top:50%;transform:translateY(-50%)';
      const btnIzq = slideActual > 0 ? '<button onclick="cambiarSlide(-1)" style="' + btnStyle + ';left:-12px">&#8249;</button>' : '';
      const btnDer = slideActual < slides.length - 1 ? '<button onclick="cambiarSlide(1)" style="' + btnStyle + ';right:-12px">&#8250;</button>' : '';
      const dots = slides.map((_, i) => '<div onclick="irSlide(' + i + ')" style="width:' + (i === slideActual ? '18px' : '8px') + ';height:8px;border-radius:4px;background:' + (i === slideActual ? 'var(--accent)' : 'rgba(255,255,255,0.2)') + ';cursor:pointer;transition:all 0.2s"></div>').join('');
      document.getElementById('resumen-body').innerHTML =
        '<div style="position:relative;min-height:200px">'
        + btnIzq + btnDer
        + '<div id="slide-content" style="padding:0 16px">' + slides[slideActual] + '</div>'
        + '</div>'
        + '<div style="display:flex;justify-content:center;gap:6px;margin-top:14px">' + dots + '</div>';
      initSwipe();
    }

    window.cambiarSlide = function(dir) {
      slideActual = Math.max(0, Math.min(slides.length - 1, slideActual + dir));
      renderCarousel();
    };
    window.irSlide = function(i) {
      slideActual = i;
      renderCarousel();
    };

    function initSwipe() {
      const el = document.getElementById('slide-content');
      if (!el) return;
      let startX = 0;
      el.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
      el.addEventListener('touchend', e => {
        const diff = startX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 40) cambiarSlide(diff > 0 ? 1 : -1);
      }, { passive: true });
    }

    renderCarousel();

  } catch (e) {
    console.error('Error resumen progreso:', e);
    document.getElementById('resumen-body').innerHTML =
      '<p style="color:var(--muted);text-align:center;padding:20px">No se pudo cargar el resumen.</p>';
  }
}

function cerrarResumen() {
  document.getElementById('modal-resumen-progreso').style.display = 'none';
}

/* ════════════════════════════════════════════════
   REFERENCIAS CRUZADAS — FORMULARIO MI CONTENIDO
   ════════════════════════════════════════════════ */

function renderReferenciasForm() {
  const lista = document.getElementById('mc-filmina-refs-lista');
  if (!lista) return;
  if (!editandoFilminaRefs.length) {
    lista.innerHTML = '<p style="font-size:12px;color:var(--muted2);margin:0">Sin referencias aún.</p>';
    return;
  }
  lista.innerHTML = editandoFilminaRefs.map((r, i) => `
    <div style="display:flex;align-items:center;gap:6px;background:var(--dark2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;margin-bottom:4px">
      <span style="flex:1;font-size:12px;color:var(--white)">
        <span style="color:var(--accent2);font-weight:600">"${r.texto_origen}"</span>
        <span style="color:var(--muted2)"> → filmina #${r.filmina_id}: ${r.filmina_titulo || ''}</span>
      </span>
      <button onclick="eliminarReferencia(${i})" style="background:none;border:none;color:var(--muted2);cursor:pointer;font-size:14px">✕</button>
    </div>
  `).join('');
}

function eliminarReferencia(index) {
  editandoFilminaRefs.splice(index, 1);
  renderReferenciasForm();
}

async function buscarFilminaDestino() {
  const q = document.getElementById('mc-ref-buscar').value.trim().toLowerCase();
  const resultados = document.getElementById('mc-ref-resultados');
  if (q.length < 2) { resultados.innerHTML = ''; return; }

  const visibleIds = await getVisibleUserIds();
  const { data: filminas } = await supabaseClient
    .from('filminas').select('id, titulo, unidades(numero)')
    .in('alumno_id', visibleIds);

  const filtradas = (filminas || []).filter(f => f.titulo.toLowerCase().includes(q)).slice(0, 6);

  if (!filtradas.length) {
    resultados.innerHTML = '<p style="font-size:12px;color:var(--muted2)">Sin resultados.</p>';
    return;
  }

  resultados.innerHTML = filtradas.map(f => `
    <div onclick="seleccionarFilminaDestino(${f.id}, '${f.titulo.replace(/'/g, "\\'")}')"
      style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:13px;background:var(--dark2);transition:background .15s"
      onmouseover="this.style.background='var(--dark3)'" onmouseout="this.style.background='var(--dark2)'">
      <span style="color:var(--muted)">U${f.unidades?.numero || '?'}</span>
      <span style="color:#f0f0f0;margin-left:6px">${f.titulo}</span>
    </div>
  `).join('');
}

function seleccionarFilminaDestino(id, titulo) {
  const textoOrigen = document.getElementById('mc-ref-texto').value.trim();
  if (!textoOrigen) {
    alert('Primero escribí la frase de esta filmina que va a funcionar como link.');
    return;
  }

  // Evitar duplicados
  const yaExiste = editandoFilminaRefs.some(r => r.filmina_id === id && r.texto_origen === textoOrigen);
  if (yaExiste) { alert('Esta referencia ya existe.'); return; }

  editandoFilminaRefs.push({ filmina_id: id, texto_origen: textoOrigen, filmina_titulo: titulo });
  renderReferenciasForm();

  // Limpiar campos
  document.getElementById('mc-ref-texto').value = '';
  document.getElementById('mc-ref-buscar').value = '';
  document.getElementById('mc-ref-resultados').innerHTML = '';
}

async function sugerirReferenciasIA() {
  const titulo    = document.getElementById('mc-filmina-titulo').value.trim();
  const contenido = document.getElementById('mc-filmina-contenido').value.trim();
  const sugsDiv   = document.getElementById('mc-ref-sugerencias');

  if (!titulo && !contenido) { alert('Completá el título y contenido de la filmina primero.'); return; }

  sugsDiv.innerHTML = '<p style="font-size:12px;color:var(--muted2)">🤖 Analizando...</p>';

  // Traer todas las filminas disponibles como contexto
  const visibleIds = await getVisibleUserIds();
  const { data: todasFilminas } = await supabaseClient
    .from('filminas').select('id, titulo, unidades(numero)')
    .in('alumno_id', visibleIds);

  const listaFilminas = (todasFilminas || [])
    .map(f => `ID:${f.id} | U${f.unidades?.numero || '?'} | ${f.titulo}`)
    .join('\n');

  const prompt = `Sos un asistente que analiza filminas de contabilidad para detectar términos que ya están explicados en otras filminas.

FILMINA ACTUAL:
Título: ${titulo}
Contenido: ${contenido}

FILMINAS DISPONIBLES:
${listaFilminas}

Tu tarea: identificá frases o términos de la filmina actual que YA están explicados en alguna de las filminas disponibles. Devolvé SOLO un JSON válido (sin texto adicional, sin markdown) con este formato exacto:
[
  { "texto_origen": "frase exacta de la filmina actual", "filmina_id": 123, "filmina_titulo": "Título de la filmina destino" }
]
Si no encontrás referencias relevantes, devolvé: []`;

  try {
    const res = await fetch(IA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await res.json();
    const texto = data.content?.[0]?.text || data.respuesta || data.choices?.[0]?.message?.content || '';
    const clean = texto.replace(/```json|```/g, '').trim();
    const sugerencias = JSON.parse(clean);

    if (!sugerencias.length) {
      sugsDiv.innerHTML = '<p style="font-size:12px;color:var(--muted2)">La IA no encontró referencias relevantes en esta filmina.</p>';
      return;
    }

    sugsDiv.innerHTML = `
      <p style="font-size:12px;color:var(--muted2);margin-bottom:6px">✨ Sugerencias de la IA — aprobá las que quieras:</p>
      ${sugerencias.map((s, i) => `
        <div style="display:flex;align-items:center;gap:6px;background:var(--dark2);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:8px 10px;margin-bottom:4px">
          <span style="flex:1;font-size:12px">
            <span style="color:var(--accent2);font-weight:600">"${s.texto_origen}"</span>
            <span style="color:var(--muted2)"> → ${s.filmina_titulo}</span>
          </span>
          <button onclick="aprobarSugerencia(${i}, ${JSON.stringify(s).replace(/"/g, '&quot;')})"
            style="background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);color:var(--accent2);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">
            ✓ Agregar
          </button>
        </div>
      `).join('')}
    `;
  } catch (e) {
    sugsDiv.innerHTML = '<p style="font-size:12px;color:var(--muted2)">Error al procesar la respuesta de la IA.</p>';
    console.error('Error sugerencias IA:', e);
  }
}

function aprobarSugerencia(index, sugerencia) {
  const yaExiste = editandoFilminaRefs.some(
    r => r.filmina_id === sugerencia.filmina_id && r.texto_origen === sugerencia.texto_origen
  );
  if (!yaExiste) {
    editandoFilminaRefs.push(sugerencia);
    renderReferenciasForm();
  }
  // Ocultar la sugerencia aprobada
  const sugsDiv = document.getElementById('mc-ref-sugerencias');
  const items = sugsDiv.querySelectorAll('div[style*="border-radius:8px"]');
  if (items[index]) items[index].style.opacity = '0.3';
}

// ── REORDENAR FILMINAS ──
let dragSrcEl = null;
let reordenActivo = {};

function toggleReordenar(uKey) {
  reordenActivo[uKey] = !reordenActivo[uKey];
  const container = document.getElementById(`mc-uf-items-${uKey}`);
  const btn = document.getElementById(`btn-reordenar-${uKey}`);
  if (!container) return;
  const items = container.querySelectorAll('.mc-sortable');
  items.forEach(item => {
    item.draggable = reordenActivo[uKey];
    item.style.cursor = reordenActivo[uKey] ? 'grab' : 'default';
  });
  if (btn) {
    btn.textContent = reordenActivo[uKey] ? '✓ Listo' : '↕ Reordenar';
    btn.style.borderColor = reordenActivo[uKey] ? '#4ade80' : 'var(--border)';
    btn.style.color = reordenActivo[uKey] ? '#4ade80' : 'var(--muted)';
  }
}

function onDragStart(e) {
  dragSrcEl = e.currentTarget;
  e.dataTransfer.effectAllowed = 'move';
  dragSrcEl.style.opacity = '0.4';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.currentTarget;
  if (target !== dragSrcEl) target.style.borderTop = '2px solid var(--accent)';
}

function onDrop(e, uId) {
  e.preventDefault();
  const target = e.currentTarget;
  target.style.borderTop = '';
  if (dragSrcEl && dragSrcEl !== target) {
    const parent = target.parentNode;
    const items = [...parent.querySelectorAll('.mc-sortable')];
    const srcIdx = items.indexOf(dragSrcEl);
    const tgtIdx = items.indexOf(target);
    if (srcIdx < tgtIdx) parent.insertBefore(dragSrcEl, target.nextSibling);
    else parent.insertBefore(dragSrcEl, target);
    guardarOrdenFilminas(parent, uId);
  }
}

function onDragEnd(e) {
  e.currentTarget.style.opacity = '1';
  document.querySelectorAll('.mc-sortable').forEach(i => i.style.borderTop = '');
}

async function guardarOrdenFilminas(container, uId) {
  const items = container.querySelectorAll('.mc-sortable');
  const updates = [...items].map((el, idx) => ({
    id: el.dataset.id,
    orden: idx
  }));
  for (const u of updates) {
    await supabaseClient.from('filminas').update({ orden: u.orden }).eq('id', u.id);
  }
}  

/* ════════════════════════════════════════════════
   PLAN DE ESTUDIO
   ════════════════════════════════════════════════ */

async function renderPlanContent() {
  const wrap = document.getElementById('plan-wrap');
  wrap.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--muted)"><div style="font-size:32px;margin-bottom:12px">⏳</div><p>Cargando plan...</p></div>`;

  try {
    const MARGEN_DIAS = 3;
    const visibleIds = await getVisibleUserIds();

    const [{ data: todasFilminas }, { data: allScores }] = await Promise.all([
      (() => {
        let q = supabaseClient
          .from('filminas')
          .select('id, titulo, unidad_id, unidades(numero, nombre)')
          .in('alumno_id', visibleIds);
        if (currentMateria) q = q.eq('grupo_id', currentMateria);
        return q;
      })(),
      supabaseClient
        .from('filmina_scores')
        .select('filmina_id, puntaje, created_at')
        .eq('alumno_id', currentUser.id)
        .order('created_at', { ascending: false })
    ]);

    const filminas = todasFilminas || [];
    const scores = allScores || [];

    // Agrupar scores por filmina (ya vienen desc por created_at)
    const scoresPorFilmina = {};
    scores.forEach(s => {
      const key = parseInt(s.filmina_id);
      if (!scoresPorFilmina[key]) scoresPorFilmina[key] = [];
      scoresPorFilmina[key].push(s);
    });

    // Aprendida = últimas 2 sesiones con puntaje >= 7
    const aprendidasIds = new Set();
    Object.entries(scoresPorFilmina).forEach(([id, arr]) => {
      if (arr.length >= 2 && arr[0].puntaje >= 7 && arr[1].puntaje >= 7) {
        aprendidasIds.add(parseInt(id));
      }
    });

    // Estudiadas hoy (al menos un score de hoy)
    const hoyStr = new Date().toISOString().split('T')[0];
    const estudiadasHoyIds = new Set(
      scores
        .filter(s => (s.created_at || '').startsWith(hoyStr))
        .map(s => parseInt(s.filmina_id))
    );
    const estudiadasHoy = filminas.filter(f => estudiadasHoyIds.has(parseInt(f.id)));

    // Fecha del examen y cálculo de días
    const planKey = `plan_fecha_examen_${currentUser.id}_${currentMateria || 'global'}`;
    const fechaExamenStr = localStorage.getItem(planKey);
    let diasRestantes = null, diasEfectivos = null, filminasPorDia = null;

    if (fechaExamenStr) {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const examen = new Date(fechaExamenStr + 'T00:00:00');
      diasRestantes = Math.ceil((examen - hoy) / (1000 * 60 * 60 * 24));
      diasEfectivos = Math.max(1, diasRestantes - MARGEN_DIAS);
      const cantPend = filminas.filter(f => !aprendidasIds.has(parseInt(f.id))).length;
      filminasPorDia = Math.ceil(cantPend / diasEfectivos);
    }

    const totalFilminas = filminas.length;
    const cantAprendidas = filminas.filter(f => aprendidasIds.has(parseInt(f.id))).length;
    const cantPendientes = totalFilminas - cantAprendidas;
    const pctAvance = totalFilminas > 0 ? Math.round((cantAprendidas / totalFilminas) * 100) : 0;
    const colorAvance = pctAvance >= 70 ? '#22c55e' : pctAvance >= 40 ? '#f59e0b' : 'var(--accent)';

    // Agrupar por unidad
    const porUnidad = {};
    filminas.forEach(f => {
      const uNum = f.unidades?.numero || 0;
      if (!porUnidad[uNum]) porUnidad[uNum] = { nombre: f.unidades?.nombre || '', total: 0, aprendidas: 0 };
      porUnidad[uNum].total++;
      if (aprendidasIds.has(parseInt(f.id))) porUnidad[uNum].aprendidas++;
    });

    const getColor = p => !p ? '#94a3b8' : p >= 7 ? '#22c55e' : p >= 5 ? '#f59e0b' : '#ef4444';

    wrap.innerHTML = `

      <!-- Config fecha -->
      <div style="background:rgba(124,109,250,0.08);border:1px solid rgba(124,109,250,0.25);border-radius:14px;padding:20px 24px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent);margin-bottom:12px;">📅 Fecha del examen</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="date" id="plan-fecha-input" value="${fechaExamenStr || ''}"
            style="background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--white);font-size:14px;outline:none;cursor:pointer;">
          <button onclick="guardarFechaExamen()"
            style="background:var(--accent);border:none;border-radius:8px;padding:9px 18px;color:#fff;font-weight:700;font-size:13px;cursor:pointer;">
            Guardar
          </button>
          ${fechaExamenStr ? `<button onclick="borrarFechaExamen()"
            style="background:transparent;border:1px solid var(--border);border-radius:8px;padding:9px 14px;color:var(--muted);font-size:13px;cursor:pointer;">
            ✕ Limpiar
          </button>` : ''}
        </div>
        <p style="font-size:12px;color:var(--muted2);margin:10px 0 0;">
          ${fechaExamenStr && diasRestantes !== null
            ? `Quedan <strong style="color:var(--white)">${diasRestantes} días</strong> para el examen.
               Se reservan <strong style="color:var(--accent2)">${MARGEN_DIAS} días</strong> de repaso final →
               <strong style="color:var(--white)">${diasEfectivos} días efectivos</strong> de estudio.`
            : 'Ingresá la fecha del examen para activar el plan.'}
        </p>
      </div>

      <!-- Chips resumen -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:20px;">
        ${[
          { icon: '📚', val: totalFilminas, label: 'Filminas totales', color: '#38bdf8' },
          { icon: '✅', val: cantAprendidas, label: 'Aprendidas', color: '#22c55e' },
          { icon: '📖', val: cantPendientes, label: 'Pendientes', color: '#f59e0b' },
          diasEfectivos !== null ? { icon: '📅', val: diasEfectivos, label: 'Días efectivos', color: '#7c6dfa' } : null
        ].filter(Boolean).map(c => `
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center;">
            <div style="font-size:20px;margin-bottom:4px;">${c.icon}</div>
            <div style="font-size:24px;font-weight:700;color:${c.color};">${c.val}</div>
            <div style="font-size:11px;color:var(--muted2);margin-top:3px;">${c.label}</div>
          </div>
        `).join('')}
      </div>

      <!-- Barra de avance general -->
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:13px;color:var(--muted);font-weight:600;">Avance general</span>
          <span style="font-size:16px;font-weight:700;color:${colorAvance};">${pctAvance}%</span>
        </div>
        <div style="background:rgba(255,255,255,0.08);border-radius:99px;height:8px;overflow:hidden;">
          <div style="height:100%;border-radius:99px;background:${colorAvance};width:${pctAvance}%;transition:width 0.6s ease;"></div>
        </div>
        <p style="font-size:11px;color:var(--muted2);margin:8px 0 0;">
          Una filmina se considera aprendida cuando obtenés 7 o más en 2 sesiones consecutivas.
        </p>
      </div>

      <!-- Hoy -->
      ${fechaExamenStr && filminasPorDia !== null ? `
      <div style="background:rgba(56,189,248,0.07);border:1px solid rgba(56,189,248,0.25);border-radius:14px;padding:20px 24px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent2);margin-bottom:10px;">🗓 Hoy</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:12px;">
          <span style="font-size:32px;font-weight:700;color:var(--white);">${filminasPorDia}</span>
          <span style="font-size:14px;color:var(--muted);">filminas para estudiar hoy</span>
        </div>
        ${estudiadasHoy.length > 0 ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:12px;color:var(--muted2);">Progreso de hoy: ${estudiadasHoy.length} / ${filminasPorDia}</span>
            <span style="font-size:12px;font-weight:700;color:${estudiadasHoy.length >= filminasPorDia ? '#22c55e' : '#f59e0b'};">
              ${estudiadasHoy.length >= filminasPorDia ? '✓ Meta cumplida' : 'En progreso'}
            </span>
          </div>
          <div style="background:rgba(255,255,255,0.08);border-radius:99px;height:6px;overflow:hidden;margin-bottom:14px;">
            <div style="height:100%;border-radius:99px;background:${estudiadasHoy.length >= filminasPorDia ? '#22c55e' : 'var(--accent2)'};width:${Math.min(100, Math.round((estudiadasHoy.length / filminasPorDia) * 100))}%;transition:width 0.5s;"></div>
          </div>
          <div style="font-size:12px;color:var(--muted2);margin-bottom:8px;">Filminas de hoy:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${estudiadasHoy.map(f => {
              const ultimo = scoresPorFilmina[parseInt(f.id)]?.[0];
              return `<span style="background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px;color:var(--white);">
                ${escHtml(f.titulo)}
                ${ultimo ? `<span style="color:${getColor(ultimo.puntaje)};font-weight:700;margin-left:4px;">${ultimo.puntaje}/10</span>` : ''}
              </span>`;
            }).join('')}
          </div>
        ` : `<p style="font-size:13px;color:var(--muted2);margin:0;">Todavía no estudiaste ninguna filmina hoy. ¡Arrancá un Pomodoro!</p>`}
      </div>` : ''}

      <!-- Por unidad -->
      <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:14px;padding:20px 24px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;">📊 Progreso por unidad</div>
        ${Object.entries(porUnidad).sort((a, b) => a[0] - b[0]).map(([uNum, u]) => {
          const pct = Math.round((u.aprendidas / u.total) * 100);
          const pend = u.total - u.aprendidas;
          const col = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : 'var(--accent)';
          return `
            <div style="margin-bottom:16px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div>
                  <span style="font-size:13px;font-weight:600;color:#f1f5f9;">Unidad ${uNum}</span>
                  ${u.nombre ? `<span style="font-size:12px;color:#94a3b8;margin-left:6px;">${escHtml(u.nombre)}</span>` : ''}
                </div>
                <div>
                  <span style="font-size:13px;font-weight:700;color:${col};">${u.aprendidas}/${u.total}</span>
                  <span style="font-size:11px;color:var(--muted2);margin-left:4px;">(${pend} pendiente${pend !== 1 ? 's' : ''})</span>
                </div>
              </div>
              <div style="background:rgba(255,255,255,0.08);border-radius:99px;height:6px;overflow:hidden;">
                <div style="height:100%;border-radius:99px;background:${col};width:${pct}%;transition:width 0.5s;"></div>
              </div>
            </div>`;
        }).join('')}
      </div>
    `;

  } catch (e) {
    console.error('Error renderPlan:', e);
    document.getElementById('plan-wrap').innerHTML = '<p style="color:var(--muted2);padding:20px;">Error al cargar el plan. Revisá la consola.</p>';
  }
}

function guardarFechaExamen() {
  const input = document.getElementById('plan-fecha-input');
  const val = input?.value;
  if (!val) { alert('Seleccioná una fecha.'); return; }
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(val + 'T00:00:00');
  if (fecha <= hoy) { alert('La fecha del examen tiene que ser en el futuro.'); return; }
  const planKey = `plan_fecha_examen_${currentUser.id}_${currentMateria || 'global'}`;
  localStorage.setItem(planKey, val);
  renderPlan();
}

function borrarFechaExamen() {
  const planKey = `plan_fecha_examen_${currentUser.id}_${currentMateria || 'global'}`;
  localStorage.removeItem(planKey);
  renderPlan();
}

async function renderPlan() {
  showPlanTab('plan');
}

function showPlanTab(tab) {
  const wraps = { plan: 'plan-wrap', evolucion: 'evolucion-wrap', filminas: 'filminas-estado-wrap' };
  ['plan', 'evolucion', 'filminas'].forEach(t => {
    const w = document.getElementById(wraps[t]);
    const b = document.getElementById(`plantab-${t}`);
    if (w) w.style.display = 'none';
    if (b) { b.style.background = 'transparent'; b.style.color = 'var(--muted)'; }
  });
  const activeWrap = document.getElementById(wraps[tab]);
  const activeBtn = document.getElementById(`plantab-${tab}`);
  if (activeWrap) activeWrap.style.display = 'block';
  if (activeBtn) { activeBtn.style.background = 'var(--accent)'; activeBtn.style.color = '#fff'; }

  if (tab === 'plan') renderPlanContent();
  else if (tab === 'evolucion') renderEvolucion();
  else if (tab === 'filminas') renderFilminasEstado();
}
async function renderEvolucion() {
  const wrap = document.getElementById('evolucion-wrap');
  wrap.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--muted)"><div style="font-size:32px;margin-bottom:12px">⏳</div><p>Cargando evolución...</p></div>`;

  try {
    const visibleIds = await getVisibleUserIds();

    let filminasQuery = supabaseClient
      .from('filminas')
      .select('id, titulo, unidades(numero, nombre)')
      .in('alumno_id', visibleIds);
    if (currentMateria) filminasQuery = filminasQuery.eq('grupo_id', currentMateria);
    const { data: todasFilminas } = await filminasQuery;

    const { data: allScores } = await supabaseClient
      .from('filmina_scores')
      .select('filmina_id, puntaje, created_at')
      .eq('alumno_id', currentUser.id)
      .order('created_at', { ascending: true });

    const filminas = todasFilminas || [];
    const scores = allScores || [];

    const scoresPorFilmina = {};
    scores.forEach(s => {
      const key = parseInt(s.filmina_id);
      if (!scoresPorFilmina[key]) scoresPorFilmina[key] = [];
      scoresPorFilmina[key].push(s);
    });

    const evaluadas = filminas
      .filter(f => scoresPorFilmina[parseInt(f.id)]?.length > 0)
      .sort((a, b) => {
        const aLast = scoresPorFilmina[parseInt(a.id)].slice(-1)[0]?.created_at || '';
        const bLast = scoresPorFilmina[parseInt(b.id)].slice(-1)[0]?.created_at || '';
        return bLast.localeCompare(aLast);
      });

    if (!evaluadas.length) {
      wrap.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--muted2);">
          <div style="font-size:40px;margin-bottom:12px;">📊</div>
          <p style="font-size:14px;">Todavía no evaluaste ninguna filmina.</p>
          <p style="font-size:12px;margin-top:4px;">Completá un Pomodoro para ver tu evolución acá.</p>
        </div>`;
      return;
    }

    const getColor = p => p >= 7 ? '#22c55e' : p >= 5 ? '#f59e0b' : '#ef4444';
    const getBg    = p => p >= 7 ? 'rgba(34,197,94,0.15)' : p >= 5 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)';

    wrap.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">📈 HISTORIAL POR FILMINA</div>
        <p style="font-size:12px;color:var(--muted2);">${evaluadas.length} filmina${evaluadas.length !== 1 ? 's' : ''} evaluada${evaluadas.length !== 1 ? 's' : ''}. Las más recientes aparecen primero.</p>
      </div>
      ${evaluadas.map(f => {
        const historial = scoresPorFilmina[parseInt(f.id)];
        const ultimo    = historial[historial.length - 1];
        const anteult   = historial[historial.length - 2];
        const esAprendida = historial.length >= 2 && ultimo.puntaje >= 7 && anteult?.puntaje >= 7;
        const tendencia = !anteult ? '—' : ultimo.puntaje > anteult.puntaje ? '↑' : ultimo.puntaje < anteult.puntaje ? '↓' : '→';
        const tendColor = !anteult ? 'var(--muted2)' : ultimo.puntaje > anteult.puntaje ? '#22c55e' : ultimo.puntaje < anteult.puntaje ? '#ef4444' : '#94a3b8';

        return `
          <div style="background:rgba(255,255,255,0.03);border:1px solid ${esAprendida ? 'rgba(34,197,94,0.3)' : 'var(--border)'};border-radius:12px;padding:14px 16px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div style="min-width:0;flex:1;">
                <span style="font-size:12px;color:var(--muted2);">U${f.unidades?.numero || '?'} · </span>
                <span style="font-size:14px;font-weight:600;color:var(--white);">${escHtml(f.titulo)}</span>
                ${esAprendida ? `<span style="font-size:11px;background:rgba(34,197,94,0.15);color:#22c55e;border-radius:6px;padding:2px 7px;margin-left:6px;font-weight:700;">✓ Aprendida</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:10px;">
                <span style="font-size:18px;font-weight:700;color:${tendColor};">${tendencia}</span>
                <span style="font-size:16px;font-weight:700;color:${getColor(ultimo.puntaje)};">${ultimo.puntaje}/10</span>
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              ${historial.map((s, i) => {
                const fecha = new Date(s.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
                return `
                  <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                    <div style="background:${getBg(s.puntaje)};border:1px solid ${getColor(s.puntaje)};border-radius:6px;padding:4px 8px;font-size:13px;font-weight:700;color:${getColor(s.puntaje)};">${s.puntaje}</div>
                    <span style="font-size:10px;color:var(--muted2);">${fecha}</span>
                  </div>
                  ${i < historial.length - 1 ? `<span style="color:var(--muted2);font-size:12px;margin-bottom:14px;">→</span>` : ''}`;
              }).join('')}
            </div>
          </div>`;
      }).join('')}
    `;

  } catch (e) {
    console.error('Error renderEvolucion:', e);
    wrap.innerHTML = '<p style="color:var(--muted2);padding:20px;">Error al cargar la evolución.</p>';
  }
}

async function renderFilminasEstado() {
  const wrap = document.getElementById('filminas-estado-wrap');
  wrap.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--muted)"><div style="font-size:32px;margin-bottom:12px">⏳</div><p>Analizando filminas...</p></div>`;

  try {
    const visibleIds = await getVisibleUserIds();

    let filminasQuery = supabaseClient
      .from('filminas')
      .select('id, titulo, unidades(numero, nombre)')
      .in('alumno_id', visibleIds);
    if (currentMateria) filminasQuery = filminasQuery.eq('grupo_id', currentMateria);
    const { data: todasFilminas } = await filminasQuery;

    const { data: allScores } = await supabaseClient
      .from('filmina_scores')
      .select('filmina_id, puntaje, created_at')
      .eq('alumno_id', currentUser.id)
      .order('created_at', { ascending: false });

    const filminas = todasFilminas || [];
    const scores = allScores || [];

    const scoresPorFilmina = {};
    scores.forEach(s => {
      const key = parseInt(s.filmina_id);
      if (!scoresPorFilmina[key]) scoresPorFilmina[key] = [];
      scoresPorFilmina[key].push(s);
    });

    const grupos = { riesgo: [], mejorar: [], aprendidas: [], sinevaluar: [] };

    filminas.forEach(f => {
      const fScores = scoresPorFilmina[parseInt(f.id)];
      if (!fScores?.length) { grupos.sinevaluar.push(f); return; }
      const ultimo    = fScores[0].puntaje;
      const anteultimo = fScores[1]?.puntaje;
      if (anteultimo !== undefined && ultimo >= 7 && anteultimo >= 7) {
        grupos.aprendidas.push({ ...f, puntaje: ultimo });
      } else if (ultimo < 5) {
        grupos.riesgo.push({ ...f, puntaje: ultimo });
      } else {
        grupos.mejorar.push({ ...f, puntaje: ultimo });
      }
    });

    const getColor = p => p >= 7 ? '#22c55e' : p >= 5 ? '#f59e0b' : '#ef4444';

    const renderGrupo = (titulo, emoji, color, bgColor, descripcion, lista, showScore = true) => {
      if (!lista.length) return '';
      return `
        <div style="background:${bgColor};border:1px solid ${color}40;border-radius:14px;padding:18px 20px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:14px;font-weight:700;color:${color};">${emoji} ${titulo}</span>
            <span style="font-size:14px;font-weight:700;color:${color};">${lista.length}</span>
          </div>
          <p style="font-size:12px;color:var(--muted2);margin-bottom:12px;">${descripcion}</p>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${lista.slice(0, 8).map(f => `
              <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.2);border-radius:8px;padding:8px 12px;">
                <div style="min-width:0;overflow:hidden;">
                  <span style="font-size:11px;color:#64748b;">U${f.unidades?.numero || '?'} · </span>
                  <span style="font-size:13px;color:#f1f5f9;">${escHtml(f.titulo)}</span>
                </div>
                ${showScore && f.puntaje !== undefined ? `<span style="font-size:13px;font-weight:700;color:${getColor(f.puntaje)};flex-shrink:0;margin-left:8px;">${f.puntaje}/10</span>` : ''}
              </div>
            `).join('')}
            ${lista.length > 8 ? `<p style="font-size:12px;color:var(--muted2);text-align:center;margin:4px 0 0;">+ ${lista.length - 8} más</p>` : ''}
          </div>
        </div>`;
    };

    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:20px;">
        ${[
          { icon: '🔴', val: grupos.riesgo.length,     label: 'En riesgo',    color: '#ef4444' },
          { icon: '🟡', val: grupos.mejorar.length,    label: 'Por mejorar',  color: '#f59e0b' },
          { icon: '🟢', val: grupos.aprendidas.length, label: 'Aprendidas',   color: '#22c55e' },
          { icon: '⚪', val: grupos.sinevaluar.length, label: 'Sin evaluar',  color: 'var(--muted2)' },
        ].map(c => `
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:18px;margin-bottom:4px;">${c.icon}</div>
            <div style="font-size:22px;font-weight:700;color:${c.color};">${c.val}</div>
            <div style="font-size:10px;color:var(--muted2);margin-top:2px;">${c.label}</div>
          </div>
        `).join('')}
      </div>
      ${renderGrupo('En riesgo',   '🔴', '#ef4444', 'rgba(239,68,68,0.06)',   'Último puntaje menor a 5. Repasalas urgente antes de avanzar.',         grupos.riesgo)}
      ${renderGrupo('Por mejorar', '🟡', '#f59e0b', 'rgba(245,158,11,0.06)',  'Vas bien. Una o dos sesiones más y las dominás.',                       grupos.mejorar)}
      ${renderGrupo('Aprendidas',  '🟢', '#22c55e', 'rgba(34,197,94,0.06)',   '2 sesiones consecutivas con 7 o más. ¡Las dominaste!',                  grupos.aprendidas)}
      ${renderGrupo('Sin evaluar', '⚪', '#94a3b8', 'rgba(148,163,184,0.06)', 'Todavía no las repasaste con Pomodoro. Incluílas en tu próxima sesión.', grupos.sinevaluar, false)}
    `;

  } catch (e) {
    console.error('Error renderFilminasEstado:', e);
    wrap.innerHTML = '<p style="color:var(--muted2);padding:20px;">Error al cargar el estado de filminas.</p>';
  }
}