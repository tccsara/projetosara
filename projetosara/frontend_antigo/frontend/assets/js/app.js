const app = {
        currentUser: null,
        map: null,
        riskChart: null,
        deviceDetailChart: null,
        devices: [],
        logs: [],
        markers: [],
        refreshTimer: null,
        simulationTimer: null,
        simulationTick: 0,
        apiBase: (() => {
            const loc = window.location.href;
            const prefix = '/frontend/';
            const idx = loc.indexOf(prefix);
            if (idx !== -1 && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
                const base = loc.substring(0, idx);
                return `${base}/backend/api/index.php`;
            }
            return 'http://localhost/projetosara/projetosara/backend/api/index.php';
        })(),

        init() {
            this.setAuthMessage('Faça login para acessar o sistema.');
            if (!document.getElementById('loginScreen')) return;
            this.tryAutoLogin();
        },

        setAuthMessage(message) {
            const el = document.getElementById('authMessage');
            if (el) {
                el.textContent = message;
            }
        },

        login(event) {
            event.preventDefault();
            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            const email = emailInput && emailInput.value ? emailInput.value.trim() : '';
            const password = passwordInput && passwordInput.value ? passwordInput.value : '';

            if (!email || !password) {
                this.setAuthMessage('Informe e-mail e senha para continuar.');
                return;
            }

            this.setAuthMessage('Entrando...');

            axios.post(`${this.apiBase}?route=auth/login`, { email, password })
                .then((response) => {
                    localStorage.setItem('cabeca_token', response.data.token);
                    this.currentUser = response.data.user;
                    this.enterDashboard();
                })
                .catch(() => {
                    this.setAuthMessage('Falha no login. Verifique seu email e senha.');
                });
        },

        register(event) {
            event.preventDefault();
            const name = document.getElementById('registerName').value.trim();
            const email = document.getElementById('registerEmail').value.trim();
            const phone = document.getElementById('registerPhone').value.trim();
            const password = document.getElementById('registerPassword').value;

            if (!name || !email || !phone || !password) {
                this.setAuthMessage('Preencha nome, e-mail, telefone e senha.');
                return;
            }

            this.setAuthMessage('Criando conta...');
            axios.post(`${this.apiBase}?route=auth/register`, { name, email, phone, password })
                .then((response) => {
                    localStorage.setItem('cabeca_token', response.data.token);
                    this.currentUser = response.data.user;
                    document.getElementById('registerForm').reset();
                    this.enterDashboard();
                })
                .catch((error) => {
                    const message = error.response && error.response.data && error.response.data.error ?
                        error.response.data.error :
                        'Não foi possível cadastrar o usuário.';
                    this.setAuthMessage(message);
                });
        },

        enterDashboard() {
            const loginScreen = document.getElementById('loginScreen');
            const registerScreen = document.getElementById('registerScreen');
            const recoverScreen = document.getElementById('recoverScreen');
            const dashboardScreen = document.getElementById('dashboardScreen');
            if (loginScreen) loginScreen.classList.add('d-none');
            if (registerScreen) registerScreen.classList.add('d-none');
            if (recoverScreen) recoverScreen.classList.add('d-none');
            if (dashboardScreen) dashboardScreen.classList.remove('d-none');
            this.renderUserBadge();
            const userName = this.currentUser && this.currentUser.name ? this.currentUser.name : 'usuário';
            this.setAuthMessage(`Bem-vindo, ${userName}`);
            this.initDashboard();
        },

        initDashboard() {
            this.loadDashboardData();
            if (!this.refreshTimer) {
                this.refreshTimer = setInterval(() => this.loadDashboardData(), 5000);
            }
            if (!this.simulationTimer) {
                this.simulationTimer = setInterval(() => this.refreshSimulation(), 10000);
            }
        },

        loadDashboardData() {
            axios.get(`${this.apiBase}?route=dashboard/data`)
                .then((response) => {
                    this.devices = Array.isArray(response.data.devices) ? response.data.devices : [];
                    this.logs = Array.isArray(response.data.logs) ? response.data.logs : [];
                    this.updateRealDeviceStatus(response.data.server_time);
                    this.applyHourlySimulation();
                    this.renderSummary();
                    this.renderAlerts(Array.isArray(response.data.alerts) ? response.data.alerts : []);
                    this.renderMap();
                    this.renderRiskChart();
                    this.populateDeviceSelector();
                    this.renderDeviceChart(this.devices[0]);
                    this.renderSuperadminPanel();
                })
                .catch(() => {
                    this.setAuthMessage('O painel entrou, mas não foi possível carregar os dados dos sensores.');
                });
        },

        updateRealDeviceStatus(serverTime) {
            const realDevice = this.devices.find((device) => device.device_code === 'CDA-001');
            if (!realDevice || !realDevice.last_update) return;
            const lastUpdate = new Date(String(realDevice.last_update).replace(' ', 'T'));
            const referenceTime = serverTime ? new Date(String(serverTime).replace(' ', 'T')) : new Date();
            const ageSeconds = (referenceTime.getTime() - lastUpdate.getTime()) / 1000;
            realDevice.status = ageSeconds <= 15 ? 'online' : 'offline';
        },

        applyHourlySimulation() {
            const simulatedDevices = this.devices.filter((device) => device.device_code !== 'CDA-001');
            simulatedDevices.forEach((device, index) => {
                const phase = (this.simulationTick + index * 3) % 8;
                const waterLevel = 20 + ((phase * 11 + index * 7) % 65);
                const temperature = 22 + ((phase * 1.7 + index * 2) % 12);
                const battery = Math.max(55, 96 - ((this.simulationTick + index * 9) % 35));
                device.status = 'online';
                device.risk_level = waterLevel >= 80 ? 'danger' : waterLevel >= 70 ? 'attention' : 'normal';
                device.last_update = `Simulação: ciclo ${this.simulationTick}`;

                const existingLog = this.latestLog(device.id);
                if (existingLog) {
                    existingLog.water_level = waterLevel;
                    existingLog.temperature = temperature.toFixed(1);
                    existingLog.battery = battery;
                    existingLog.created_at = new Date().toISOString();
                } else {
                    this.logs.push({ device_id: device.id, water_level: waterLevel, temperature, battery, created_at: new Date().toISOString() });
                }
            });
        },

        refreshSimulation() {
            this.simulationTick += 1;
            this.applyHourlySimulation();
            this.renderSummary();
            this.renderRiskChart();
            this.renderDeviceChart(this.devices[0]);
        },

        renderSummary() {
            const container = document.getElementById('summaryCards');
            if (!container) return;

            const online = this.devices.filter((device) => device.status === 'online').length;
            const critical = this.devices.filter((device) => device.risk_level === 'danger').length;
            container.innerHTML = [
                ['Dispositivos', this.devices.length, 'text-info'],
                ['Online', online, 'text-success'],
                ['Risco alto', critical, 'text-danger'],
            ].map(([label, value, color]) => `<div class="col-md-4"><div class="card bg-black border-secondary"><div class="card-body"><div class="small text-muted">${label}</div><div class="h3 mb-0 ${color}">${value}</div></div></div></div>`).join('');
        },

        renderAlerts(alerts) {
            const container = document.getElementById('alertsList');
            if (!container) return;
            container.innerHTML = alerts.length ?
                alerts.slice(0, 6).map((alert) => `<div class="border-bottom border-secondary py-2"><strong>${alert.message || 'Alerta'}</strong><div class="small text-muted">${alert.created_at || ''}</div></div>`).join('') :
                '<div class="text-muted">Nenhum alerta recente.</div>';
        },

        renderMap() {
            if (typeof L === 'undefined') return;
            const mapElement = document.getElementById('map');
            if (!mapElement) return;
            if (!this.map) {
                this.map = L.map(mapElement).setView([-23.185, -46.876], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(this.map);
            }
            this.markers.forEach((marker) => marker.remove());
            this.markers = this.devices.map((device) => {
                const latitude = Number(device.latitude);
                const longitude = Number(device.longitude);
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
                return L.marker([latitude, longitude]).addTo(this.map).bindPopup(`<strong>${device.name || device.device_code || 'Sensor'}</strong><br>Status: ${device.status || 'indefinido'}`);
            }).filter(Boolean);
            if (this.markers.length) this.map.fitBounds(L.featureGroup(this.markers).getBounds().pad(0.2));
            setTimeout(() => this.map.invalidateSize(), 100);
        },

        renderRiskChart() {
            if (typeof Chart === 'undefined') return;
            const canvas = document.getElementById('riskChart');
            if (!canvas) return;
            if (this.riskChart) this.riskChart.destroy();
            const latest = this.devices.map((device) => this.latestLog(device.id));
            this.riskChart = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: this.devices.map((device) => device.name || device.device_code),
                    datasets: [
                        { label: 'Nível de água (%)', data: latest.map((log) => Number(log && log.water_level || 0)), backgroundColor: '#40b4ff' },
                        { label: 'Temperatura (°C)', data: latest.map((log) => Number(log && log.temperature || 0)), backgroundColor: '#ff9f43' },
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
            });
        },

        latestLog(deviceId) {
            return this.logs.filter((log) => String(log.device_id) === String(deviceId)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
        },

        populateDeviceSelector() {
            const select = document.getElementById('deviceSelector');
            if (!select) return;
            select.innerHTML = '<option value="">Selecione um sensor</option>' + this.devices.map((device) => `<option value="${device.id}">${device.name || device.device_code || `Sensor ${device.id}`}</option>`).join('');
        select.onchange = () => this.renderDeviceChart(this.devices.find((device) => String(device.id) === String(select.value)));
    },

    renderDeviceChart(device) {
        if (typeof Chart === 'undefined' || !device) return;
        const canvas = document.getElementById('deviceDetailChart');
        if (!canvas) return;
        const log = this.latestLog(device.id) || {};
        const info = document.getElementById('deviceDetailInfo');
        if (info) info.textContent = `${device.name || device.device_code || 'Sensor'} | Status: ${device.status || 'indefinido'} | Atualização: ${device.last_update || 'sem registro'}`;
        if (this.deviceDetailChart) this.deviceDetailChart.destroy();
        this.deviceDetailChart = new Chart(canvas, { type: 'line', data: { labels: ['Nível de água', 'Temperatura', 'Bateria'], datasets: [{ label: 'Leitura atual', data: [Number(log.water_level || 0), Number(log.temperature || 0), Number(log.battery || 0)], borderColor: '#7ce7c0', backgroundColor: 'rgba(124,231,192,.2)', tension: .25, fill: true }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } } });
    },

    authConfig() {
        return { headers: { Authorization: `Bearer ${localStorage.getItem('cabeca_token')}` } };
    },

    renderSuperadminPanel() {
        const panel = document.getElementById('superadminPanel');
        if (!panel || !this.currentUser || this.currentUser.role !== 'superadmin') return;
        panel.classList.remove('d-none');
        this.renderAlertSettings({ auto_send: 1, threshold_water_level: 80, threshold_temperature: 35 });
        this.renderManualAlertForm();
        this.renderTelegramSettings({ bot_token: '', chat_id: '' });
        this.loadAlertSettings();
        this.loadTelegramSettings();
        this.loadUsers();
    },

    loadAlertSettings() {
        axios.get(`${this.apiBase}?route=alerts/settings`, this.authConfig())
            .then((response) => this.renderAlertSettings(response.data.settings || {}))
            .catch(() => this.setAuthMessage('Não foi possível carregar os ajustes de alertas.'));
    },

    renderAlertSettings(settings) {
        const panel = document.getElementById('alertSettingsPanel');
        if (!panel) return;
        panel.innerHTML = `<h5 class="text-info">Ajustes de alertas</h5>
            <form onsubmit="app.saveAlertSettings(event)" class="row g-2 align-items-end">
                <div class="col-md-4"><label class="form-label">Nível de água (%)</label><input id="alertWaterThreshold" type="number" min="1" max="100" class="form-control form-control-dark" value="${settings.threshold_water_level || 80}" required></div>
                <div class="col-md-4"><label class="form-label">Temperatura (°C)</label><input id="alertTempThreshold" type="number" step="0.1" class="form-control form-control-dark" value="${settings.threshold_temperature || 35}" required></div>
                <div class="col-md-4"><div class="form-check mb-2"><input id="alertAutoSend" class="form-check-input" type="checkbox" ${Number(settings.auto_send) === 1 ? 'checked' : ''}><label class="form-check-label">Enviar alertas automaticamente</label></div><button class="btn btn-info w-100" type="submit">Salvar ajustes</button></div>
            </form>`;
    },

    saveAlertSettings(event) {
        event.preventDefault();
        axios.post(`${this.apiBase}?route=alerts/settings`, { auto_send: document.getElementById('alertAutoSend').checked ? 1 : 0, threshold_water_level: Number(document.getElementById('alertWaterThreshold').value), threshold_temperature: Number(document.getElementById('alertTempThreshold').value) }, this.authConfig())
            .then((response) => { this.renderAlertSettings(response.data.settings); this.setAuthMessage('Ajustes de alertas salvos.'); })
            .catch(() => this.setAuthMessage('Não foi possível salvar os ajustes.'));
    },

    renderManualAlertForm() {
        const panel = document.getElementById('manualAlertPanel');
        if (!panel) return;
        panel.innerHTML = `<h5 class="text-info">Enviar alerta manual</h5><form onsubmit="app.sendManualAlert(event)" class="row g-2 align-items-end"><div class="col-md-4"><label class="form-label">Dispositivo</label><select id="manualAlertDevice" class="form-select form-control-dark" required>${this.devices.map((device) => `<option value="${device.device_code || device.id}">${device.name || device.device_code}</option>`).join('')}</select></div><div class="col-md-5"><label class="form-label">Mensagem</label><input id="manualAlertMessage" class="form-control form-control-dark" value="Alerta manual enviado pelo superadmin." required></div><div class="col-md-3"><button class="btn btn-outline-warning w-100" type="submit">Enviar alerta</button></div></form>`;
    },

    sendManualAlert(event) {
        event.preventDefault();
        axios.post(`${this.apiBase}?route=alerts/send`, { device_id: document.getElementById('manualAlertDevice').value, message: document.getElementById('manualAlertMessage').value }, this.authConfig())
            .then(() => { this.setAuthMessage('Alerta manual enviado.'); this.loadDashboardData(); })
            .catch(() => this.setAuthMessage('Não foi possível enviar o alerta.'));
    },

    loadTelegramSettings() {
        axios.get(`${this.apiBase}?route=telegram/settings`, this.authConfig())
            .then((response) => this.renderTelegramSettings(response.data.settings || {}))
            .catch(() => this.setAuthMessage('Não foi possível carregar os ajustes do Telegram.'));
    },

    renderTelegramSettings(settings) {
        const panel = document.getElementById('telegramSettingsPanel');
        if (!panel) return;
        panel.innerHTML = `<h5 class="text-info">Integração com Telegram</h5>
            <form onsubmit="app.saveTelegramSettings(event)" class="row g-2 align-items-end">
                <div class="col-md-5"><label class="form-label">Token do bot</label><input id="telegramBotToken" type="password" class="form-control form-control-dark" placeholder="123456:ABC..." value="${settings.bot_token || ''}" required></div>
                <div class="col-md-4"><label class="form-label">Chat ID</label><input id="telegramChatId" class="form-control form-control-dark" placeholder="-1001234567890" value="${settings.chat_id || ''}" required></div>
                <div class="col-md-3 d-grid gap-2"><button class="btn btn-info" type="submit">Salvar Telegram</button><button class="btn btn-outline-light" type="button" onclick="app.testTelegram()">Enviar teste</button></div>
            </form>`;
    },

    saveTelegramSettings(event) {
        event.preventDefault();
        axios.post(`${this.apiBase}?route=telegram/settings`, { bot_token: document.getElementById('telegramBotToken').value.trim(), chat_id: document.getElementById('telegramChatId').value.trim() }, this.authConfig())
            .then((response) => { this.renderTelegramSettings(response.data.settings || {}); this.setAuthMessage('Configuração do Telegram salva.'); })
            .catch(() => this.setAuthMessage('Não foi possível salvar o Telegram.'));
    },

    testTelegram() {
        axios.post(`${this.apiBase}?route=telegram/send`, { message: 'Teste de integração do Projeto S.A.R.A.' }, this.authConfig())
            .then(() => this.setAuthMessage('Mensagem de teste enviada ao Telegram.'))
            .catch(() => this.setAuthMessage('Falha no teste do Telegram. Confira o token e o Chat ID.'));
    },

    loadUsers() {
        axios.get(`${this.apiBase}?route=users`, this.authConfig())
            .then((response) => this.renderUsers(response.data.users || []))
            .catch(() => this.setAuthMessage('Não foi possível carregar os usuários.'));
    },

    renderUsers(users) {
        const container = document.getElementById('usersList');
        if (!container) return;
        container.innerHTML = users.map((user) => `<div class="col-md-6"><div class="border border-secondary rounded p-3"><strong>${user.name}</strong><div class="small text-muted mb-2">${user.email}</div><div class="row g-2"><div class="col-7"><select id="userRole${user.id}" class="form-select form-select-sm form-control-dark"><option value="user" ${user.role === 'user' ? 'selected' : ''}>Usuário</option><option value="developer" ${user.role === 'developer' ? 'selected' : ''}>Desenvolvedor</option><option value="superadmin" ${user.role === 'superadmin' ? 'selected' : ''}>Superadmin</option></select></div><div class="col-5"><button class="btn btn-sm btn-outline-info w-100" onclick="app.updateUser(${user.id})">Salvar</button></div></div></div></div>`).join('');
    },

    updateUser(id) {
        axios.put(`${this.apiBase}?route=users`, { id, role: document.getElementById(`userRole${id}`).value }, this.authConfig())
            .then(() => { this.setAuthMessage('Usuário atualizado.'); this.loadUsers(); })
            .catch(() => this.setAuthMessage('Não foi possível atualizar o usuário.'));
    },

    renderUserBadge() {
        const el = document.getElementById('userBadge');
        if (!el) return;

        if (!this.currentUser) {
            el.textContent = '';
            return;
        }

        const roleLabel = this.currentUser.role === 'superadmin' ? 'Superadmin' : this.currentUser.role === 'developer' ? 'Desenvolvedor' : 'Usuário';
        el.innerHTML = `<span class="me-2">${this.currentUser.name}</span><span class="badge bg-info text-dark">${roleLabel}</span>`;
    },

    logout() {
        localStorage.removeItem('cabeca_token');
        this.currentUser = null;
        const dashboardScreen = document.getElementById('dashboardScreen');
        const registerScreen = document.getElementById('registerScreen');
        const loginScreen = document.getElementById('loginScreen');
        if (dashboardScreen) dashboardScreen.classList.add('d-none');
        if (registerScreen) registerScreen.classList.add('d-none');
        if (loginScreen) loginScreen.classList.remove('d-none');
        this.renderUserBadge();
        this.setAuthMessage('Faça login para acessar o sistema.');
    },

    showRegisterScreen(event) {
        if (event) event.preventDefault();
        const loginScreen = document.getElementById('loginScreen');
        const recoverScreen = document.getElementById('recoverScreen');
        const registerScreen = document.getElementById('registerScreen');
        if (loginScreen) loginScreen.classList.add('d-none');
        if (recoverScreen) recoverScreen.classList.add('d-none');
        if (registerScreen) registerScreen.classList.remove('d-none');
    },

    showLoginScreen(event) {
        if (event) event.preventDefault();
        const registerScreen = document.getElementById('registerScreen');
        const recoverScreen = document.getElementById('recoverScreen');
        const loginScreen = document.getElementById('loginScreen');
        if (registerScreen) registerScreen.classList.add('d-none');
        if (recoverScreen) recoverScreen.classList.add('d-none');
        if (loginScreen) loginScreen.classList.remove('d-none');
        this.setAuthMessage('Faça login para acessar o sistema.');
    },

    showRecoverScreen(event) {
        if (event) event.preventDefault();
        const loginScreen = document.getElementById('loginScreen');
        const registerScreen = document.getElementById('registerScreen');
        const recoverScreen = document.getElementById('recoverScreen');
        if (loginScreen) loginScreen.classList.add('d-none');
        if (registerScreen) registerScreen.classList.add('d-none');
        if (recoverScreen) recoverScreen.classList.remove('d-none');
        this.hideRecoveryForms();
        this.setAuthMessage('Escolha como recuperar sua senha.');
    },

    hideRecoveryForms() {
        const emailForm = document.getElementById('recoverEmailForm');
        const phoneForm = document.getElementById('recoverPhoneForm');
        const codeForm = document.getElementById('recoverCodeForm');
        if (emailForm) emailForm.classList.add('d-none');
        if (phoneForm) phoneForm.classList.add('d-none');
        if (codeForm) codeForm.classList.add('d-none');
    },

    recoverByEmail(event) {
        if (event) event.preventDefault();
        this.hideRecoveryForms();
        const emailForm = document.getElementById('recoverEmailForm');
        if (emailForm) emailForm.classList.remove('d-none');
        this.setAuthMessage('Informe seu e-mail para receber o código de recuperação.');
    },

    recoverByPhone(event) {
        if (event) event.preventDefault();
        this.hideRecoveryForms();
        const phoneForm = document.getElementById('recoverPhoneForm');
        if (phoneForm) phoneForm.classList.remove('d-none');
        this.setAuthMessage('Informe seu telefone para receber o código de recuperação.');
    },

    recoverByEmailSubmit(event) {
        if (event) event.preventDefault();
        this.setAuthMessage('A recuperação por e-mail estará disponível em uma próxima atualização.');
    },

    recoverByPhoneSubmit(event) {
        if (event) event.preventDefault();
        this.setAuthMessage('A recuperação por telefone estará disponível em uma próxima atualização.');
    },

    verifyRecoveryCode(event) {
        if (event) event.preventDefault();
        this.setAuthMessage('Código de recuperação enviado. Entre em contato com o suporte para concluir a redefinição.');
    },

    togglePasswordVisibility(inputId, button) {
        const input = document.getElementById(inputId);
        if (!input || !button) return;

        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        button.textContent = isPassword ? 'Ocultar' : 'Mostrar';
    },

    tryAutoLogin() {
        const token = localStorage.getItem('cabeca_token');
        if (!token) {
            this.setAuthMessage('Faça login para acessar o sistema.');
            return;
        }

        axios.get(`${this.apiBase}?route=auth/me`, { headers: { Authorization: `Bearer ${token}` } })
            .then((response) => {
                this.currentUser = response.data.user;
                this.enterDashboard();
            })
            .catch(() => {
                localStorage.removeItem('cabeca_token');
                this.setAuthMessage('Sessão expirada. Faça login novamente.');
            });
    }
};

window.app = app;
window.addEventListener('DOMContentLoaded', () => app.init());