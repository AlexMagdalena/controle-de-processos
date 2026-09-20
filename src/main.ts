import { supabase } from './supabase';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

let currentUser: any = null;
let userProfile: any = null;

// =======================================
// INICIALIZAÇÃO E BLINDAGEM DE PERFIL
// =======================================
async function initApp() {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    currentUser = user;

    const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    
    if (error || !profile) {
        console.warn("Perfil não encontrado na tabela profiles.");
        document.getElementById('user-name-display')!.textContent = user.email || 'Usuário';
    } else {
        userProfile = profile;
        document.getElementById('user-name-display')!.textContent = profile.full_name;
        
        // Garante a exibição da aba de usuários se o perfil for admin
        if (profile.role === 'admin') {
            let navUsers = document.getElementById('nav-users');
            
            if (!navUsers) {
                const nav = document.querySelector('aside nav');
                if (nav) {
                    navUsers = document.createElement('button');
                    navUsers.id = 'nav-users';
                    navUsers.textContent = 'Usuários';
                    nav.appendChild(navUsers);
                }
            }
            
            if (navUsers) {
                navUsers.style.display = 'block';
            }
            
            if (!document.getElementById('view-users')) {
                const mainContent = document.querySelector('main.content');
                if (mainContent) {
                    const viewDiv = document.createElement('section');
                    viewDiv.id = 'view-users';
                    viewDiv.className = 'view';
                    viewDiv.innerHTML = `
                        <h2>Controle de Usuários</h2>
                        <p style="margin-bottom: 20px;">Gerenciamento de perfis de acesso cadastrados.</p>
                        <div class="table-container">
                            <table id="users-table">
                                <thead><tr><th>Nome</th><th>Perfil</th><th>Data de Criação</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    `;
                    mainContent.appendChild(viewDiv);
                }
            }

            loadUsers();
        }
    }

    setupTheme();
    setupNavigation();
    setupEventListeners();
    await loadDashboard();
    await loadProcesses();
    await checkOverdueNotifications();
}

// =======================================
// NAVEGAÇÃO & TEMA
// =======================================
function setupNavigation() {
    const navButtons = document.querySelectorAll('nav button');
    const views = document.querySelectorAll('.view');

    navButtons.forEach(btn => {
        // Remove ouvintes duplicados clonando o elemento se necessário, ou apenas reatribuindo
        const newBtn = btn.cloneNode(true);
        btn.parentNode?.replaceChild(newBtn, btn);
    });

    // Reatribui os eventos após atualizar os botões
    document.querySelectorAll('nav button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            
            btn.classList.add('active');
            const targetId = btn.id.replace('nav-', 'view-');
            document.getElementById(targetId)?.classList.add('active');
        });
    });
}

function setupTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    });
}

// =======================================
// EVENTOS & CÁLCULOS
// =======================================
function setupEventListeners() {
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = '/login.html';
    });

    document.getElementById('btn-new-process')?.addEventListener('click', () => {
        (document.getElementById('form-process') as HTMLFormElement).reset();
        document.getElementById('proc-id')!.setAttribute('value', '');
        document.getElementById('fields-notification')!.style.display = 'none';
        document.getElementById('fields-infraction')!.style.display = 'none';
        (document.getElementById('modal-process') as HTMLDialogElement).showModal();
    });

    const typeSelect = document.getElementById('proc-type') as HTMLSelectElement;
    typeSelect?.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value;
        document.getElementById('fields-notification')!.style.display = val === 'Notificação' ? 'block' : 'none';
        document.getElementById('fields-infraction')!.style.display = val === 'Auto de Infração' ? 'block' : 'none';
    });

    const notifDate = document.getElementById('notif-date') as HTMLInputElement;
    const notifDays = document.getElementById('notif-days') as HTMLInputElement;
    const calcDate = () => {
        if (notifDate?.value && notifDays?.value) {
            const d = new Date(notifDate.value);
            d.setDate(d.getDate() + parseInt(notifDays.value));
            document.getElementById('notif-calc')!.textContent = d.toLocaleDateString('pt-BR');
        }
    };
    notifDate?.addEventListener('input', calcDate);
    notifDays?.addEventListener('input', calcDate);

    const ufivVal = document.getElementById('inf-ufiv-val') as HTMLInputElement;
    const ufivRate = document.getElementById('inf-ufiv-rate') as HTMLInputElement;
    const calcUfiv = () => {
        if (ufivVal?.value && ufivRate?.value) {
            const total = parseFloat(ufivVal.value) * parseFloat(ufivRate.value);
            document.getElementById('inf-calc')!.textContent = `R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        }
    };
    ufivVal?.addEventListener('input', calcUfiv);
    ufivRate?.addEventListener('input', calcUfiv);

    document.getElementById('form-process')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const payload: any = {
            user_id: currentUser.id,
            process_number: (document.getElementById('proc-number') as HTMLInputElement).value,
            status: (document.getElementById('proc-status') as HTMLSelectElement).value,
            description: (document.getElementById('proc-desc') as HTMLTextAreaElement).value,
            type: typeSelect.value
        };

        if (payload.type === 'Notificação') {
            payload.notification_date = notifDate.value;
            payload.deadline_days = parseInt(notifDays.value);
            const d = new Date(notifDate.value);
            d.setDate(d.getDate() + payload.deadline_days);
            payload.due_date = d.toISOString().split('T')[0];
        } else if (payload.type === 'Auto de Infração') {
            payload.ufiv_value = parseFloat(ufivVal.value);
            payload.ufiv_rate = parseFloat(ufivRate.value);
            payload.total_brl = payload.ufiv_value * payload.ufiv_rate;
            payload.conversion_date = new Date().toISOString().split('T')[0];
        }

        const id = (document.getElementById('proc-id') as HTMLInputElement).value;
        if (id) {
            await supabase.from('processes').update(payload).eq('id', id);
        } else {
            await supabase.from('processes').insert([payload]);
        }
        
        (document.getElementById('modal-process') as HTMLDialogElement).close();
        await loadDashboard();
        await loadProcesses();
    });

    document.getElementById('btn-export-pdf')?.addEventListener('click', generatePDFReport);
}

// =======================================
// CARREGAMENTO DE DADOS
// =======================================
async function checkOverdueNotifications() {
    const today = new Date().toISOString().split('T')[0];
    const { data: overdue } = await supabase.from('processes')
        .select('*')
        .eq('type', 'Notificação')
        .lt('due_date', today);

    if (overdue && overdue.length > 0) {
        const tbody = document.querySelector('#overdue-table tbody');
        if (tbody) {
            tbody.innerHTML = overdue.map(p => {
                const daysLate = Math.floor((new Date().getTime() - new Date(p.due_date).getTime()) / (1000 * 3600 * 24));
                return `<tr>
                    <td>${p.process_number}</td>
                    <td>${new Date(p.due_date).toLocaleDateString('pt-BR')}</td>
                    <td class="status-red">${daysLate} dias</td>
                </tr>`;
            }).join('');
        }
        (document.getElementById('modal-overdue') as HTMLDialogElement)?.showModal();
    }
}

async function loadDashboard() {
    const { data: processes } = await supabase.from('processes').select('*');
    if (!processes) return;

    const total = processes.length;
    const infractions = processes.filter(p => p.type === 'Auto de Infração');
    const money = infractions.reduce((acc, curr) => acc + (Number(curr.total_brl) || 0), 0);
    
    const today = new Date().toISOString().split('T')[0];
    const overdueCount = processes.filter(p => p.type === 'Notificação' && p.due_date < today).length;

    if (document.getElementById('dash-total')) document.getElementById('dash-total')!.textContent = total.toString();
    if (document.getElementById('dash-overdue')) document.getElementById('dash-overdue')!.textContent = overdueCount.toString();
    if (document.getElementById('dash-infractions')) document.getElementById('dash-infractions')!.textContent = infractions.length.toString();
    if (document.getElementById('dash-money')) document.getElementById('dash-money')!.textContent = `R$ ${money.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

async function loadProcesses() {
    const { data } = await supabase.from('processes').select('*').order('created_at', { ascending: false });
    if (!data) return;
    
    const tbody = document.querySelector('#processes-table tbody');
    if (tbody) {
        tbody.innerHTML = data.map(p => `
            <tr>
                <td><strong>${p.process_number}</strong></td>
                <td>${p.status}</td>
                <td>${p.type}</td>
                <td>${new Date(p.open_date).toLocaleDateString('pt-BR')}</td>
            </tr>
        `).join('');
    }
}

async function loadUsers() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (!data) return;
    
    const tbody = document.querySelector('#users-table tbody');
    if (tbody) {
        tbody.innerHTML = data.map(u => `
            <tr>
                <td>${u.full_name}</td>
                <td style="text-transform: capitalize;">${u.role}</td>
                <td>${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
            </tr>
        `).join('');
    }
}

async function generatePDFReport() {
    const { data: processes } = await supabase.from('processes').select('*');
    const doc = new jsPDF();
    doc.text('Relatório Geral de Processos', 14, 15);
    
    const tableData = processes?.map(p => [
        p.process_number,
        p.status,
        p.type,
        p.type === 'Auto de Infração' ? `R$ ${p.total_brl}` : (p.due_date ? new Date(p.due_date).toLocaleDateString('pt-BR') : '-')
    ]);

    (doc as any).autoTable({
        startY: 25,
        head: [['Processo', 'Situação', 'Tipo', 'Prazo/Valor']],
        body: tableData,
    });
    
    doc.save('relatorio-processos.pdf');
}

initApp();