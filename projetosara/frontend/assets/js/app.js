const app = {
        currentUser: null,
        map: null,
        waterLevelChart: null,
        devices: [],
        logs: [],
        markers: [],
        refreshTimer: null,
        supabaseUserId: null,
        adminPanelLoaded: false,
        waterLevelChartHistory: [],

        init() {
            this.setAuthMessage('Faça login para acessar o sistema.');
            if (!document.getElementById('loginScreen')) return;
            this.initializeSupabaseAuth();
        },

        async initializeSupabaseAuth() {
            if (!window.saraSupabase) {
                this.setAuthMessage('Configure a URL e a chave publicável do Supabase em assets/js/supabase-client.js.');
                return;
            }

            const { data, error } = await window.saraSupabase.auth.getSession();
            if (error) {
                this.setAuthMessage('Não foi possível verificar a sessão do Supabase.');
                return;
            }

            if (data.session && data.session.user) {
                await this.loadSupabaseProfile(data.session.user);
            }

            window.saraSupabase.auth.onAuthStateChange((event, session) => {
                if (session && session.user) {
                    window.setTimeout(() => this.loadSupabaseProfile(session.user), 0);
                } else if (event === 'SIGNED_OUT') {
                    this.resetSignedOutState();
                }
            });
        },

        async loadSupabaseProfile(authUser) {
            if (!authUser || this.supabaseUserId === authUser.id) return;
            this.supabaseUserId = authUser.id;

            const { data: profile, error } = await window.saraSupabase
                .from('profiles')
                .select('name, role, phone')
                .eq('id', authUser.id)
                .maybeSingle();

            if (error || !profile) {
                this.supabaseUserId = null;
                this.setAuthMessage('Login Google recebido, mas não foi possível carregar o perfil no Supabase.');
                return;
            }

            localStorage.removeItem('cabeca_token');
            this.currentUser = {
                id: authUser.id,
                email: authUser.email || '',
                name: profile.name || authUser.user_metadata?.full_name || authUser.email || 'Usuário',
                role: profile.role || 'user',
                phone: profile.phone || '',
            };

            if (!this.currentUser.phone.trim()) {
                this.showProfileSetup();
                return;
            }

            this.enterDashboard();
        },

        showProfileSetup() {
            ['loginScreen', 'registerScreen', 'recoverScreen', 'dashboardScreen'].forEach((id) => {
                const screen = document.getElementById(id);
                if (screen) screen.classList.add('d-none');
            });

            const setupScreen = document.getElementById('profileSetupScreen');
            if (setupScreen) setupScreen.classList.remove('d-none');

            const nameInput = document.getElementById('profileName');
            const phoneInput = document.getElementById('profilePhone');
            if (nameInput) nameInput.value = this.currentUser?.name || '';
            if (phoneInput) phoneInput.value = this.currentUser?.phone || '';
            this.setAuthMessage('Complete seu perfil para continuar.');
        },

        async saveProfile(event) {
            event.preventDefault();
            if (!this.currentUser || !window.saraSupabase) return;

            const name = document.getElementById('profileName').value.trim();
            const phone = document.getElementById('profilePhone').value.trim();
            if (!name || !phone) {
                this.setAuthMessage('Informe seu nome e telefone para continuar.');
                return;
            }

            const button = document.getElementById('saveProfileButton');
            if (button) button.disabled = true;
            this.setAuthMessage('Salvando perfil...');

            const { data: profile, error } = await window.saraSupabase
                .from('profiles')
                .update({ name, phone })
                .eq('id', this.currentUser.id)
                .select('id, name, role, phone')
                .single();

            if (button) button.disabled = false;
            if (error) {
                console.error('Falha ao salvar o perfil no Supabase:', error);
                this.setAuthMessage('Não foi possível salvar. Confira se a permissão de editar nome e telefone foi aplicada.');
                return;
            }

            this.currentUser = { ...this.currentUser, ...profile };
            this.enterDashboard();
        },

        setAuthMessage(message) {
            const el = document.getElementById('authMessage');
            if (el) {
                el.textContent = message;
            }
        },

        async loginWithGoogle(event) {
            event.preventDefault();
            if (!window.saraSupabase) {
                this.setAuthMessage('Configure a URL e a chave publicável do Supabase antes de entrar.');
                return;
            }

            this.setAuthMessage('Redirecionando para o Google...');
            const redirectTo = `${window.location.origin}${window.location.pathname}`;
            const { error } = await window.saraSupabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo },
            });

            if (error) {
                this.setAuthMessage(`Não foi possível iniciar o login Google: ${error.message}`);
            }
        },

        enterDashboard() {
            const loginScreen = document.getElementById('loginScreen');
            const registerScreen = document.getElementById('registerScreen');
            const recoverScreen = document.getElementById('recoverScreen');
            const profileSetupScreen = document.getElementById('profileSetupScreen');
            const dashboardScreen = document.getElementById('dashboardScreen');
            if (loginScreen) loginScreen.classList.add('d-none');
            if (registerScreen) registerScreen.classList.add('d-none');
            if (recoverScreen) recoverScreen.classList.add('d-none');
            if (profileSetupScreen) profileSetupScreen.classList.add('d-none');
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
        },

        async loadDashboardData() {
            if (!window.saraSupabase) {
                this.setAuthMessage('Cliente Supabase não inicializado. Confira assets/js/supabase-client.js.');
                return;
            }

            const [devicesResult, readingsResult, alertsResult] = await Promise.all([
                window.saraSupabase
                    .from('devices')
                    .select('id, device_code, name, latitude, longitude, status, risk_level, last_update, created_at')
                    .order('created_at', { ascending: true }),
                window.saraSupabase
                    .from('readings')
                    .select('id, device_id, water_level, distance_cm, temperature, battery, latitude, longitude, status, created_at')
                    .order('created_at', { ascending: false })
                    .limit(200),
                window.saraSupabase
                    .from('alerts')
                    .select('id, device_id, type, message, source, created_at')
                    .order('created_at', { ascending: false })
                    .limit(50),
            ]);

            const queryError = devicesResult.error || readingsResult.error || alertsResult.error;
            if (queryError) {
                console.error('Falha ao consultar dados do dashboard no Supabase:', queryError);
                this.setAuthMessage('Não foi possível carregar os dados do Supabase. Confira as permissões RLS e as tabelas.');
                return;
            }

            // O painel operacional exibe somente o equipamento físico usado no projeto.
            this.devices = (devicesResult.data || []).filter((device) => device.device_code === 'CDA-001');
            const activeDeviceIds = new Set(this.devices.map((device) => String(device.id)));
            this.logs = (readingsResult.data || []).filter((reading) => activeDeviceIds.has(String(reading.device_id)));
            this.updateRealDeviceStatus(new Date().toISOString());
            this.renderSummary();
            this.renderAlerts((alertsResult.data || []).filter((alert) => activeDeviceIds.has(String(alert.device_id))));
            this.renderMap();
            this.renderWaterLevelChart();
            this.renderLatestReading();
            this.renderSuperadminPanel();
        },

        updateRealDeviceStatus(serverTime) {
            const realDevice = this.devices.find((device) => device.device_code === 'CDA-001');
            if (!realDevice || !realDevice.last_update) return;
            const lastUpdate = new Date(String(realDevice.last_update).replace(' ', 'T'));
            const referenceTime = serverTime ? new Date(String(serverTime).replace(' ', 'T')) : new Date();
            const ageSeconds = (referenceTime.getTime() - lastUpdate.getTime()) / 1000;
            realDevice.status = ageSeconds <= 15 ? 'online' : 'offline';
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
                alerts.slice(0, 6).map((alert) => {
                    const message = String(alert.message || 'Alerta');
                    const title = message.split(/\r?\n/).find((line) => line.trim()) || 'Alerta';
                    const device = message.match(/(?:^|\n)\s*Dispositivo:\s*([^\r\n]+)/i)?.[1]?.trim() || 'CDA-001';
                    const level = message.match(/(?:^|\n)\s*N[ií]vel:\s*([^\r\n]+)/i)?.[1]?.trim();
                    const distance = message.match(/(?:^|\n)\s*Dist[aâ]ncia:\s*([^\r\n]+)/i)?.[1]?.trim();
                    const mapUrl = message.match(/https?:\/\/maps\.google\.com\/\?q=[^\s]+/i)?.[0];
                    const date = this.formatDateTime(alert.created_at);
                    return `<article class="border-bottom border-secondary py-3">
                        <div class="d-flex align-items-start gap-2 mb-2"><span class="badge bg-danger">PERIGO</span><strong>${this.escapeHtml(title.replace(/^⚠️\s*/, ''))}</strong></div>
                        <div class="small mb-1"><strong>Dispositivo:</strong> ${this.escapeHtml(device)}</div>
                        ${level ? `<div class="small mb-1"><strong>Nível:</strong> ${this.escapeHtml(level)}</div>` : ''}
                        ${distance ? `<div class="small mb-1"><strong>Distância:</strong> ${this.escapeHtml(distance)}</div>` : ''}
                        <div class="small text-muted">${this.escapeHtml(date)}</div>
                        ${mapUrl ? `<a class="btn btn-sm btn-outline-info mt-2" href="${this.escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">Abrir localização no mapa</a>` : ''}
                    </article>`;
                }).join('') :
                '<div class="text-muted">Nenhum alerta recente.</div>';
        },

        formatDateTime(value) {
            if (!value) return 'Horário indisponível';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
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

        renderWaterLevelChart() {
            if (typeof Chart === 'undefined') return;
            const canvas = document.getElementById('waterLevelChart');
            if (!canvas) return;
            const history = [...this.logs]
                .filter((reading) => Number.isFinite(Number(reading.water_level)) && reading.created_at)
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            this.waterLevelChartHistory = history;
            const labels = history.map((reading) => new Intl.DateTimeFormat('pt-BR', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
            }).format(new Date(reading.created_at)));
            const values = history.map((reading) => Number(reading.water_level));
            if (this.waterLevelChart) {
                this.waterLevelChart.data.labels = labels;
                this.waterLevelChart.data.datasets[0].data = values;
                this.waterLevelChart.update('none');
                return;
            }
            this.waterLevelChart = new Chart(canvas, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Nível da água (%)',
                            data: history.map((reading) => Number(reading.water_level)),
                            borderColor: '#40b4ff',
                            backgroundColor: 'rgba(64, 180, 255, .18)',
                            pointRadius: history.length > 60 ? 0 : 2,
                            pointHoverRadius: 4,
                            borderWidth: 2,
                            tension: 0.2,
                            fill: true,
                        },
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { tooltip: { callbacks: {
                        title: (items) => items[0] ? this.formatDateTime(this.waterLevelChartHistory[items[0].dataIndex]?.created_at) : '',
                        label: (item) => ` Nível: ${Number(item.parsed.y).toFixed(1)}%`,
                    } } },
                    scales: {
                        x: { type: 'category', ticks: { autoSkip: true, maxTicksLimit: 7, color: '#9aa4b2' }, grid: { color: 'rgba(255,255,255,.06)' } },
                        y: { min: 0, max: 100, title: { display: true, text: 'Nível (%)', color: '#9aa4b2' }, ticks: { color: '#9aa4b2' }, grid: { color: 'rgba(255,255,255,.08)' } },
                    },
                },
            });
        },

        latestLog(deviceId) {
            return this.logs.filter((log) => String(log.device_id) === String(deviceId)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
        },

        renderLatestReading() {
            const info = document.getElementById('deviceDetailInfo');
            if (!info) return;
            const device = this.devices[0];
            const reading = device ? this.latestLog(device.id) : null;
            if (!device || !reading) {
                info.innerHTML = '<span class="text-muted">Ainda não há leituras registradas para o CDA-001.</span>';
                return;
            }
            const riskLabels = { danger: 'Perigo', attention: 'Alerta', normal: 'Normal' };
            info.innerHTML = `<div class="row g-3">
                <div class="col-sm-6 col-lg-3"><div class="small text-muted">Nível de água</div><div class="h4 mb-0">${this.escapeHtml(Number(reading.water_level).toFixed(1))}%</div></div>
                <div class="col-sm-6 col-lg-3"><div class="small text-muted">Distância medida</div><div class="h4 mb-0">${Number.isFinite(Number(reading.distance_cm)) ? `${this.escapeHtml(Number(reading.distance_cm).toFixed(2))} cm` : '—'}</div></div>
                <div class="col-sm-6 col-lg-3"><div class="small text-muted">Estado do dispositivo</div><div class="h4 mb-0">${this.escapeHtml(device.status || 'indefinido')}</div></div>
                <div class="col-sm-6 col-lg-3"><div class="small text-muted">Faixa de risco</div><div class="h4 mb-0">${this.escapeHtml(riskLabels[device.risk_level] || device.risk_level || 'indefinida')}</div></div>
                <div class="col-12 small text-muted">Leitura recebida em ${this.escapeHtml(this.formatDateTime(reading.created_at))}</div>
            </div>`;
        },

    async adminRequest(action, payload = {}) {
        const { data: { session } } = await window.saraSupabase.auth.getSession();
        if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
        const { data, error } = await window.saraSupabase.functions.invoke('admin-management', {
            body: { action, ...payload },
            headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (error) throw error;
        return data;
    },

    async renderSuperadminPanel(forceReload = false) {
        const panel = document.getElementById('superadminPanel');
        if (!panel) return;
        panel.classList.toggle('d-none', this.currentUser?.role !== 'superadmin');
        if (this.currentUser?.role !== 'superadmin' || (this.adminPanelLoaded && !forceReload)) return;
        try {
            const data = await this.adminRequest('list');
            this.renderUsers(data.users || []);
            this.renderAdminDevices(data.devices || []);
            this.adminPanelLoaded = true;
        } catch (error) {
            this.adminPanelLoaded = false;
            console.error('Falha ao carregar painel de administração:', error);
            this.setAuthMessage('Não foi possível carregar a administração. Confira a implantação da função admin-management.');
        }
    },

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    },

    renderUsers(users) {
        const container = document.getElementById('usersList');
        if (!container) return;
        container.innerHTML = users.length ? users.map((user) => {
            const id = this.escapeHtml(user.id);
            return `<div class="col-lg-6"><form class="border border-secondary rounded p-3" onsubmit="app.saveAdminUser(event, '${id}')">
                <strong>${this.escapeHtml(user.name || 'Sem nome')}</strong><div class="small text-muted mb-2">${this.escapeHtml(user.email)}</div>
                <div class="row g-2"><div class="col-md-4"><label class="small">Nome</label><input name="name" class="form-control form-control-sm form-control-dark" maxlength="120" value="${this.escapeHtml(user.name)}" required></div>
                <div class="col-md-4"><label class="small">Telefone</label><input name="phone" class="form-control form-control-sm form-control-dark" value="${this.escapeHtml(user.phone)}"></div>
                <div class="col-md-4"><label class="small">Permissão</label><select name="role" class="form-select form-select-sm form-control-dark"><option value="user" ${user.role === 'user' ? 'selected' : ''}>Usuário</option><option value="developer" ${user.role === 'developer' ? 'selected' : ''}>Desenvolvedor</option><option value="superadmin" ${user.role === 'superadmin' ? 'selected' : ''}>Superadmin</option></select></div>
                <div class="col-12 form-check ms-2"><input name="notifications_enabled" class="form-check-input" type="checkbox" ${user.notifications_enabled ? 'checked' : ''}><label class="form-check-label">Receber alertas no Telegram</label></div>
                <div class="col-12"><button class="btn btn-sm btn-outline-info" type="submit">Salvar usuário</button></div></div></form></div>`;
        }).join('') : '<p class="text-muted">Nenhum usuário encontrado.</p>';
    },

    async saveAdminUser(event, userId) {
        event.preventDefault();
        const form = event.currentTarget;
        try {
            await this.adminRequest('update_user', { user_id: userId, name: form.elements.name.value.trim(), phone: form.elements.phone.value.trim(), role: form.elements.role.value, notifications_enabled: form.elements.notifications_enabled.checked });
            this.setAuthMessage('Dados do usuário atualizados.');
            await this.renderSuperadminPanel(true);
        } catch (error) {
            console.error(error);
            this.setAuthMessage(error.message || 'Não foi possível atualizar o usuário.');
        }
    },

    renderAdminDevices(devices) {
        const container = document.getElementById('adminDevicesList');
        if (!container) return;
        container.innerHTML = devices.length ? devices.map((device) => {
            const id = this.escapeHtml(device.id);
            return `<form class="border border-secondary rounded p-3" onsubmit="app.saveAdminDevice(event, '${id}')"><div class="mb-2"><strong>${this.escapeHtml(device.device_code)}</strong><span class="small text-muted ms-2">Código usado pelo ESP32 (fixo)</span></div>
                <div class="row g-2"><div class="col-md-4"><label class="small">Nome</label><input name="name" class="form-control form-control-sm form-control-dark" value="${this.escapeHtml(device.name)}" required></div>
                <div class="col-md-4"><label class="small">Latitude</label><input name="latitude" type="number" step="any" min="-90" max="90" class="form-control form-control-sm form-control-dark" value="${this.escapeHtml(device.latitude)}" required></div>
                <div class="col-md-4"><label class="small">Longitude</label><input name="longitude" type="number" step="any" min="-180" max="180" class="form-control form-control-sm form-control-dark" value="${this.escapeHtml(device.longitude)}" required></div>
                <div class="col-12"><button class="btn btn-sm btn-outline-info" type="submit">Salvar dispositivo</button></div></div></form>`;
        }).join('') : '<p class="text-muted">CDA-001 não encontrado.</p>';
    },

    async saveAdminDevice(event, deviceId) {
        event.preventDefault();
        const form = event.currentTarget;
        try {
            await this.adminRequest('update_device', { device_id: deviceId, name: form.elements.name.value.trim(), latitude: Number(form.elements.latitude.value), longitude: Number(form.elements.longitude.value) });
            this.setAuthMessage('Dados do dispositivo atualizados.');
            await this.loadDashboardData();
        } catch (error) {
            console.error(error);
            this.setAuthMessage(error.message || 'Não foi possível atualizar o dispositivo.');
        }
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

    async logout() {
        if (window.saraSupabase) {
            const { error } = await window.saraSupabase.auth.signOut();
            if (error) {
                this.setAuthMessage('Não foi possível encerrar a sessão do Supabase.');
                return;
            }
        }
        this.resetSignedOutState();
    },

    resetSignedOutState() {
        localStorage.removeItem('cabeca_token');
        this.supabaseUserId = null;
        this.currentUser = null;
        this.adminPanelLoaded = false;
        const dashboardScreen = document.getElementById('dashboardScreen');
        const registerScreen = document.getElementById('registerScreen');
        const loginScreen = document.getElementById('loginScreen');
        const profileSetupScreen = document.getElementById('profileSetupScreen');
        if (dashboardScreen) dashboardScreen.classList.add('d-none');
        if (registerScreen) registerScreen.classList.add('d-none');
        if (profileSetupScreen) profileSetupScreen.classList.add('d-none');
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

};

window.app = app;
window.addEventListener('DOMContentLoaded', () => app.init());
