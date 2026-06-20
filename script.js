const API_URL = window.location.protocol === 'file:' ? 'http://localhost:8000' : '';
const SESSION_KEY = 'helpdesk_current_user';

const categories = [
  'Оборудование',
  'Программное обеспечение',
  'Сеть и интернет',
  'Доступы и безопасность',
  'Консультация'
];

const statusList = {
  new: { title: 'Новая заявка', className: 'status-new' },
  work: { title: 'В работе', className: 'status-work' },
  wait: { title: 'Ожидает сотрудника', className: 'status-wait' },
  done: { title: 'Выполнено', className: 'status-done' },
  closed: { title: 'Закрыто', className: 'status-closed' }
};

const priorityList = {
  low: { title: 'Низкая', className: 'priority-low' },
  medium: { title: 'Средняя', className: 'priority-medium' },
  high: { title: 'Высокая', className: 'priority-high' }
};

let tickets = [];
let currentUser = null;
let selectedTicketId = null;
let searchText = '';
let authSwitchTimer = null;

const authScreen = document.querySelector('#authScreen');
const app = document.querySelector('#app');
const userName = document.querySelector('#userName');
const userRole = document.querySelector('#userRole');
const ticketList = document.querySelector('#ticketList');
const dashboard = document.querySelector('#dashboard');
const ticketView = document.querySelector('#ticketView');
const pageTitle = document.querySelector('#pageTitle');
const categoryPanel = document.querySelector('#categoryPanel');
const toast = document.querySelector('#toast');
const createTicketBtn = document.querySelector('#createTicketBtn');
const homeBtn = document.querySelector('#homeBtn');

init();

async function init() {
  fillSelects();
  bindAuth();
  bindApp();

  const savedUser = localStorage.getItem(SESSION_KEY);
  if (savedUser) {
    try {
      await loginAs(JSON.parse(savedUser), false);
      return;
    } catch (error) {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  showAuthTab('employeeLogin');
}

function bindAuth() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => showAuthTab(button.dataset.authTab));
  });

  document.querySelector('#employeeRegisterForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const user = await api('/api/register', 'POST', {
        name: document.querySelector('#registerName').value.trim(),
        department: document.querySelector('#registerDepartment').value.trim(),
        login: document.querySelector('#registerLogin').value.trim(),
        password: document.querySelector('#registerPassword').value
      });
      await loginAs(user);
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelector('#employeeLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const login = document.querySelector('#loginEmployeeLogin').value.trim();
      const password = document.querySelector('#loginEmployeePassword').value;
      const user = await api('/api/login', 'POST', {
        role: login === 'admin' && password === 'admin' ? 'support' : 'employee',
        login,
        password
      });
      await loginAs(user);
    } catch (error) {
      showToast(error.message);
    }
  });
}

function bindApp() {
  document.querySelector('#logoutBtn').addEventListener('click', logout);
  document.querySelector('#createTicketBtn').addEventListener('click', openCreateModal);
  document.querySelector('#closeModalBtn').addEventListener('click', closeCreateModal);
  homeBtn.addEventListener('click', showHome);

  document.querySelector('#searchInput').addEventListener('input', (event) => {
    searchText = event.target.value.toLowerCase();
    render();
  });

  document.querySelector('#toggleCategoriesBtn').addEventListener('click', () => {
    categoryPanel.classList.toggle('hidden');
    app.classList.toggle('sidebar-open', !categoryPanel.classList.contains('hidden'));
    document.querySelector('#toggleCategoriesBtn').textContent = categoryPanel.classList.contains('hidden')
      ? 'Показать по категориям'
      : 'Свернуть категории';
    renderCategoryPanel();
  });

  document.querySelector('#ticketForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await createTicket();
  });
}

function showAuthTab(tabName) {
  clearTimeout(authSwitchTimer);
  document.querySelectorAll('.tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.authTab === tabName);
  });

  const nextForm = document.querySelector(`#${tabName}Form`);
  const currentForm = document.querySelector('.auth-form:not(.hidden)');

  if (!currentForm || currentForm === nextForm) {
    nextForm.classList.remove('hidden', 'form-out');
    return;
  }

  currentForm.classList.add('form-out');
  authSwitchTimer = setTimeout(() => {
    document.querySelectorAll('.auth-form').forEach((form) => {
      form.classList.add('hidden');
      form.classList.remove('form-out');
    });
    nextForm.classList.remove('hidden');
  }, 150);
}

async function loginAs(user, saveSession = true) {
  currentUser = user;
  if (saveSession) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }

  authScreen.classList.add('hidden');
  app.classList.remove('hidden');
  userName.textContent = user.name;
  userRole.textContent = user.type === 'support' ? 'Технический специалист' : `${user.department}, сотрудник`;
  createTicketBtn.classList.toggle('hidden', user.type !== 'employee');
  selectedTicketId = null;
  await loadTickets();
}

function logout() {
  currentUser = null;
  selectedTicketId = null;
  localStorage.removeItem(SESSION_KEY);
  app.classList.add('hidden');
  authScreen.classList.remove('hidden');
  showAuthTab('employeeLogin');
}

async function loadTickets() {
  if (!currentUser) return;
  tickets = await api(`/api/tickets?role=${currentUser.type}&userId=${currentUser.id}`);
  render();
}

function showHome() {
  selectedTicketId = null;
  render();
}

function render() {
  renderSidebar();
  renderDashboard();

  if (selectedTicketId) {
    homeBtn.classList.remove('hidden');
    renderTicketDetails();
  } else {
    homeBtn.classList.add('hidden');
    ticketView.classList.add('hidden');
    dashboard.classList.remove('hidden');
    pageTitle.textContent = 'Доска тикетов';
  }
}

function renderSidebar() {
  const visibleTickets = getFilteredTickets();
  ticketList.innerHTML = '';

  if (currentUser.type === 'employee') {
    const myTickets = visibleTickets.filter((ticket) => ticket.employeeId === currentUser.id);
    const otherTickets = visibleTickets.filter((ticket) => ticket.employeeId !== currentUser.id);
    ticketList.append(makeListBlock('Мои тикеты', myTickets));
    ticketList.append(makeListBlock('Все тикеты сотрудников', otherTickets));
    return;
  }

  ticketList.append(makeListBlock('Все тикеты', visibleTickets));
}

function makeListBlock(title, list) {
  const box = document.createElement('div');
  box.innerHTML = `<p class="list-title">${title}</p>`;

  if (!list.length) {
    box.innerHTML += '<p class="small-text">Нет тикетов</p>';
    return box;
  }

  list.forEach((ticket) => box.append(makeTicketCard(ticket)));
  return box;
}

function makeTicketCard(ticket) {
  const button = document.createElement('button');
  button.className = `ticket-card ticket-tone ${statusList[ticket.status].className}`;
  button.classList.toggle('active', ticket.id === selectedTicketId);
  button.innerHTML = `
    <span class="card-line">
      <strong>#${ticket.id}</strong>
      <span class="status ${statusList[ticket.status].className}">${statusList[ticket.status].title}</span>
    </span>
    <strong>${escapeHtml(ticket.title)}</strong>
    <span class="small-text">${escapeHtml(ticket.category)} | ${escapeHtml(ticket.employeeName)}</span>
    <span class="card-tags">
      <span class="priority ${priorityList[ticket.priority].className}">${priorityList[ticket.priority].title}</span>
    </span>
    <span class="small-text">${formatDate(ticket.createdAt)}</span>
  `;
  button.addEventListener('click', () => openTicket(ticket.id));
  return button;
}

function renderDashboard() {
  const visibleTickets = getFilteredTickets();
  dashboard.innerHTML = `
    <div class="desk-header">
      <div>
        <p class="label">Обзор заявок</p>
        <h2>${currentUser.type === 'support' ? 'Рабочая доска техподдержки' : 'Актуальные обращения сотрудников'}</h2>
      </div>
      <div class="desk-stats">
        ${Object.keys(statusList).map((status) => `
          <span><b>${visibleTickets.filter((ticket) => ticket.status === status).length}</b>${statusList[status].title}</span>
        `).join('')}
      </div>
    </div>

    <div class="kanban-board">
      ${Object.keys(statusList).map((status) => renderBoardColumn(status, visibleTickets)).join('')}
    </div>
  `;

  dashboard.querySelectorAll('[data-open-ticket]').forEach((button) => {
    button.addEventListener('click', () => openTicket(Number(button.dataset.openTicket)));
  });
}

function renderBoardColumn(status, list) {
  const columnTickets = list.filter((ticket) => ticket.status === status);
  const content = columnTickets.length
    ? columnTickets.map(renderBoardTicket).join('')
    : '<p class="empty-column">Тикетов нет</p>';

  return `
    <section class="board-column">
      <div class="board-column-head">
        <h3>${statusList[status].title}</h3>
        <span>${columnTickets.length}</span>
      </div>
      <div class="board-items">${content}</div>
    </section>
  `;
}

function renderBoardTicket(ticket) {
  return `
    <button class="board-ticket ticket-tone ${statusList[ticket.status].className}" data-open-ticket="${ticket.id}">
      <span class="board-ticket-top">
        <b>#${ticket.id}</b>
        <span class="priority ${priorityList[ticket.priority].className}">${priorityList[ticket.priority].title}</span>
      </span>
      <strong>${escapeHtml(ticket.title)}</strong>
      <span class="small-text">${escapeHtml(ticket.category)}</span>
      <span class="small-text">${escapeHtml(ticket.employeeName)} | ${formatDate(ticket.createdAt)}</span>
      ${currentUser.type === 'support' ? `<span class="difficulty-tag">Сложность: ${priorityList[ticket.priority].title}</span>` : ''}
    </button>
  `;
}

function renderCategoryPanel() {
  categoryPanel.innerHTML = categories.map((category) => {
    const categoryTickets = getFilteredTickets().filter((ticket) => ticket.category === category);
    const list = categoryTickets.length
      ? categoryTickets.map((ticket) => `<button class="mini-ticket ticket-tone ${statusList[ticket.status].className}" data-category-ticket="${ticket.id}">#${ticket.id} ${escapeHtml(ticket.title)}</button>`).join('')
      : '<p class="small-text">Пусто</p>';
    return `<div class="category-block"><h3>${category}</h3>${list}</div>`;
  }).join('');

  categoryPanel.querySelectorAll('[data-category-ticket]').forEach((button) => {
    button.addEventListener('click', () => openTicket(Number(button.dataset.categoryTicket)));
  });
}

function openTicket(id) {
  selectedTicketId = id;
  render();
}

function renderTicketDetails() {
  const ticket = tickets.find((item) => item.id === selectedTicketId);
  if (!ticket) {
    selectedTicketId = null;
    render();
    return;
  }

  const canUseChat = currentUser.type === 'support' || ticket.employeeId === currentUser.id;

  pageTitle.textContent = `Тикет #${ticket.id}`;
  dashboard.classList.add('hidden');
  ticketView.classList.remove('hidden');

  ticketView.innerHTML = `
    <article class="detail-card">
      <div class="detail-head compact">
        <div>
          <span class="category-tag">${escapeHtml(ticket.category)}</span>
          <h2>${escapeHtml(ticket.title)}</h2>
          <span class="status ${statusList[ticket.status].className}">${statusList[ticket.status].title}</span>
          <span class="priority ${priorityList[ticket.priority].className}">Сложность: ${priorityList[ticket.priority].title}</span>
        </div>
      </div>

      <p class="ticket-description">${escapeHtml(ticket.description)}</p>

      <div class="meta-grid">
        <div class="meta-box"><span>Сотрудник</span>${escapeHtml(ticket.employeeName)}</div>
        <div class="meta-box"><span>Отдел</span>${escapeHtml(ticket.department)}</div>
        <div class="meta-box"><span>Создано</span>${formatDate(ticket.createdAt)}</div>
        <div class="meta-box"><span>Сообщений</span>${canUseChat ? ticket.messages.length : 'нет доступа'}</div>
      </div>

      ${currentUser.type === 'support' ? renderSupportControls(ticket) : ''}

      <div class="detail-grid-main">
        <section>
          <h3>Линия выполнения</h3>
          <div class="timeline">
            ${ticket.steps.map((step, index) => renderStep(step, index)).join('')}
          </div>
        </section>
        ${renderInlineChat(ticket, canUseChat)}
      </div>
    </article>
  `;

  if (currentUser.type === 'support') {
    document.querySelector('#changeStatus').addEventListener('change', async (event) => {
      await updateTicket(ticket.id, { status: event.target.value }, `Статус изменен на "${statusList[event.target.value].title}".`);
    });
    document.querySelector('#changePriority').addEventListener('change', async (event) => {
      await updateTicket(ticket.id, { priority: event.target.value });
    });
    document.querySelector('#closeTicketBtn').addEventListener('click', async () => {
      await updateTicket(ticket.id, { status: 'closed' }, 'Тикет закрыт специалистом технической поддержки.');
    });
    const deleteButton = document.querySelector('#deleteTicketBtn');
    if (deleteButton) {
      deleteButton.addEventListener('click', async () => {
        await deleteTicket(ticket.id);
      });
    }
    document.querySelector('#stepForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.querySelector('#stepStatus').value;
      const textInput = document.querySelector('#stepText');
      await addStep(ticket.id, status, textInput.value.trim());
      textInput.value = '';
    });
  }

  if (canUseChat) {
    document.querySelector('#inlineChatForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await sendMessage(ticket.id);
    });
    scrollInlineMessages();
  }
}

function renderSupportControls(ticket) {
  return `
    <div class="detail-actions">
      <label>Статус
        <select id="changeStatus">
          ${Object.keys(statusList).map((key) => `<option value="${key}" ${ticket.status === key ? 'selected' : ''}>${statusList[key].title}</option>`).join('')}
        </select>
      </label>
      <label>Сложность
        <select id="changePriority">
          ${Object.keys(priorityList).map((key) => `<option value="${key}" ${ticket.priority === key ? 'selected' : ''}>${priorityList[key].title}</option>`).join('')}
        </select>
      </label>
      <button class="plain-btn" id="closeTicketBtn">Закрыть тикет</button>
      ${ticket.status === 'closed' ? '<button class="danger-btn" id="deleteTicketBtn">Удалить закрытый тикет</button>' : ''}
      <form class="step-form" id="stepForm">
        <select id="stepStatus">
          ${Object.keys(statusList).map((key) => `<option value="${key}">${statusList[key].title}</option>`).join('')}
        </select>
        <input id="stepText" type="text" placeholder="Что сделал специалист на этом этапе" required>
        <button class="main-btn" type="submit">Добавить этап</button>
      </form>
    </div>
  `;
}

function renderInlineChat(ticket, canUseChat) {
  if (!canUseChat) {
    return `
      <section class="inline-chat locked-chat">
        <h3>Чат по тикету</h3>
        <p>Чат доступен только автору тикета и специалисту технической поддержки.</p>
      </section>
    `;
  }

  return `
    <section class="inline-chat">
      <h3>Чат по тикету</h3>
      <div class="messages inline-messages" id="inlineMessages">
        ${ticket.messages.map(renderMessage).join('')}
      </div>
      <form class="chat-form inline-chat-form" id="inlineChatForm">
        <input type="text" id="messageText" placeholder="Напишите сообщение" required>
        <button class="main-btn" type="submit">Отправить</button>
      </form>
    </section>
  `;
}

function renderMessage(message) {
  return `
    <div class="message ${message.type}">
      <b>${escapeHtml(message.author)}</b>
      <p>${escapeHtml(message.text)}</p>
      <small>${formatDate(message.createdAt)}</small>
    </div>
  `;
}

function renderStep(step, index) {
  return `
    <div class="step ${statusList[step.status].className}">
      <b>${index + 1}. ${statusList[step.status].title}</b>
      <span class="small-text">${formatDate(step.createdAt)}</span>
      <p>${escapeHtml(step.text)}</p>
    </div>
  `;
}

async function createTicket() {
  const status = document.querySelector('#ticketStatus').value;
  const description = document.querySelector('#ticketDescription').value.trim();
  const result = await api('/api/tickets', 'POST', {
    employeeId: currentUser.id,
    employeeName: currentUser.name,
    category: document.querySelector('#ticketCategory').value,
    title: document.querySelector('#ticketTitle').value.trim(),
    description,
    status,
    priority: status === 'new' ? 'medium' : 'high'
  });

  selectedTicketId = result.id;
  closeCreateModal();
  showToast('Тикет создан');
  await loadTickets();
}

async function updateTicket(id, fields, stepText = '') {
  await api(`/api/tickets/${id}`, 'PATCH', { ...fields, stepText });
  await loadTickets();
}

async function addStep(id, status, text) {
  await api(`/api/tickets/${id}/steps`, 'POST', { status, text });
  await loadTickets();
}

async function deleteTicket(id) {
  const ticket = tickets.find((item) => item.id === id);
  if (!ticket || ticket.status !== 'closed') {
    showToast('Удалять можно только закрытые тикеты');
    return;
  }

  if (!confirm(`Удалить тикет #${id}? Это действие нельзя отменить.`)) {
    return;
  }

  await api(`/api/tickets/${id}?role=${currentUser.type}`, 'DELETE');
  selectedTicketId = null;
  showToast('Закрытый тикет удалён');
  await loadTickets();
}

function openCreateModal() {
  if (currentUser.type !== 'employee') {
    showToast('Создавать тикеты может только сотрудник');
    return;
  }
  document.querySelector('#ticketForm').reset();
  document.querySelector('#ticketModal').classList.remove('hidden');
}

function closeCreateModal() {
  document.querySelector('#ticketModal').classList.add('hidden');
}

async function sendMessage(ticketId) {
  const input = document.querySelector('#messageText');
  if (!input || !input.value.trim()) return;

  await api(`/api/tickets/${ticketId}/messages`, 'POST', {
    type: currentUser.type === 'support' ? 'support' : 'employee',
    author: currentUser.type === 'support' ? 'Техподдержка' : currentUser.name,
    employeeId: currentUser.id,
    role: currentUser.type,
    text: input.value.trim()
  });

  input.value = '';
  await loadTickets();
  scrollInlineMessages();
}

function fillSelects() {
  document.querySelector('#ticketCategory').innerHTML = categories
    .map((category) => `<option value="${category}">${category}</option>`)
    .join('');

  document.querySelector('#ticketStatus').innerHTML = `
    <option value="new">Новая заявка</option>
    <option value="work">Проблема мешает работе</option>
    <option value="wait">Нужна консультация</option>
  `;
}

function getFilteredTickets() {
  return tickets.filter((ticket) => {
    const text = `${ticket.title} ${ticket.employeeName} ${ticket.category} ${ticket.description}`.toLowerCase();
    return text.includes(searchText);
  });
}

async function api(path, method = 'GET', body = null) {
  const options = { method, headers: {} };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(API_URL + path, options);
  } catch (error) {
    throw new Error('Сервер не отвечает. Запустите py server.py и откройте http://localhost:8000');
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Ошибка сервера');
  }

  return data;
}

function scrollInlineMessages() {
  const box = document.querySelector('#inlineMessages');
  if (box) {
    box.scrollTop = box.scrollHeight;
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2400);
}
