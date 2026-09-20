import { supabase } from './supabase';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

// Estado Global
let currentUser: any = null;
let userProfile: any = null;

// =======================================
// INICIALIZAÇÃO
// =======================================
async function initApp() {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    currentUser = user;

    // Busca o perfil atualizado do banco de dados
    const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    
    if (error || !profile) {
        console.warn("Perfil não encontrado na tabela profiles.");
        document.getElementById('user-name-display')!.textContent = user.email || 'Usuário';
    } else {
        userProfile = profile;
        document.getElementById('user-name-display')!.textContent = profile.full_name;
        
        // Exibe a aba de usuários se o perfil for admin
        if (profile.role === 'admin') {
            const navUsers = document.getElementById('nav-users');
            if (navUsers) {
                navUsers.style.display = 'block';
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
        btn.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            
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
    // Sair do sistema
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = '/login.html';
    });

    // Abrir Modal de Novo Processo
    document.getElementById('btn-new-process')?.addEventListener('click', () => {
        (document.getElementById('form-process') as HTMLFormElement).reset();
        document.getElementById('proc-id')!.setAttribute('value', '');
        document.getElementById('fields-notification')!.style.display = 'none';
        document.getElementById('fields-infraction')!.style.display = 'none';
        (document.getElementById('modal-process') as HTMLDialogElement).showModal();
    });

    // Mostrar campos específicos no Formulário
    const typeSelect = document.getElementById('proc-type') as HTMLSelectElement;
    typeSelect.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value;
        document.getElementById('fields-notification')!.style.display = val === 'Notificação' ? 'block' : 'none';
        document.getElementById('fields-infraction')!.style.display = val === 'Auto de Infração' ? 'block' : 'none';
    });

    // Cálculo Prazo Automático
    const notifDate = document.getElementById('notif-date') as HTMLInputElement;
    const notifDays = document.getElementById('notif-days') as HTMLInputElement;
    const calcDate = () => {
        if (notifDate.value && notifDays.value) {
            const d = new Date(notifDate.value);
            d.setDate(d.getDate() + parseInt(notifDays.value));
            document.getElementById('notif-calc')!.textContent = d.toLocaleDateString('pt-BR');
        }
    };
    notifDate.addEventListener('input', calcDate);
    notifDays.addEventListener('input', calcDate);

    // Cálculo UFIV Automático
    const ufivVal = document.getElementById('inf-ufiv-val') as HTMLInputElement;
    const ufivRate = document.getElementById('inf-ufiv-rate') as HTMLInputElement;
    const calcUfiv = () => {
        if (ufivVal.value && ufivRate.value) {
            const total = parseFloat(ufivVal.value) * parseFloat(ufivRate.value);
            document.getElementById('inf-calc')!.textContent = `R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
        }
    };
    ufivVal.addEventListener('input', calcUfiv);
    ufivRate.addEventListener('input', calcUfiv);

    // Salvar Processo (Insert/Update)
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

    // Gerar Relatório PDF
    document.getElementById('btn-export-pdf')?.addEventListener('click', generatePDFReport);
}

// =======================================
// CARREGAMENTO DE DADOS (READ)
// =======================================
async function checkOverdueNotifications() {
    const today = new Date().toISOString().split('T')[0];
    const { data: overdue } = await supabase.from('processes')
        .select('*')
        .eq('type', 'Notificação')
        .lt('due_date', today);

    if (overdue && overdue.length > 0) {
        const tbody = document.querySelector('#overdue-table tbody')!;
        tbody.innerHTML = overdue.map(p => {
            const daysLate = Math.floor((new Date().getTime() - new Date(p.due_date).getTime()) / (1000 * 3600 * 24));
            return `<tr>
                <td>${p.process_number}</td>
                <td>${new Date(p.due_date).toLocaleDateString('pt-BR')}</td>
                <td class="status-red">${daysLate} dias</td>
            </tr>`;
        }).join('');
        (document.getElementById('modal-overdue') as HTMLDialogElement).showModal();
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

    document.getElementById('dash-total')!.textContent = total.toString();
    document.getElementById('dash-overdue')!.textContent = overdueCount.toString();
    document.getElementById('dash-infractions')!.textContent = infractions.length.toString();
    document.getElementById('dash-money')!.textContent = `R$ ${money.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

async function loadProcesses() {
    const { data } = await supabase.from('processes').select('*').order('created_at', { ascending: false });
    if (!data) return;
    
    const tbody = document.querySelector('#processes-table tbody')!;
    tbody.innerHTML = data.map(p => `
        <tr>
            <td><strong>${p.process_number}</strong></td>
            <td>${p.status}</td>
            <td>${p.type}</td>
            <td>${new Date(p.open_date).toLocaleDateString('pt-BR')}</td>
        </tr>
    `).join('');
}

async function loadUsers() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (!data) return;
    
    const tbody = document.querySelector('#users-table tbody')!;
    tbody.innerHTML = data.map(u => `
        <tr>
            <td>${u.full_name}</td>
            <td style="text-transform: capitalize;">${u.role}</td>
            <td>${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
        </tr>
    `).join('');
}

// =======================================
// RELATÓRIOS (PDF)
// =======================================
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

// Inicia Aplicação
initApp();