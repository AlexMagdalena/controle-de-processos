import { supabase } from './supabase';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

// Estado Global
let currentUser: any = null;
let userProfile: any = null;

// Inicialização
async function initApp() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return window.location.href = '/login.html';
    currentUser = user;

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    userProfile = profile;
    
    document.getElementById('user-name-display')!.textContent = profile.full_name;
    if (profile.role === 'admin') document.getElementById('nav-admin')!.style.display = 'block';

    setupTheme();
    setupEventListeners();
    await loadDashboard();
    await checkOverdueNotifications();
}

// Tema
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

// Lógica de Notificações Inteligentes
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

// Dashboard e Relatórios
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

// Cálculos Dinâmicos do Formulário (UFIV e Datas)
function setupEventListeners() {
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = '/login.html';
    });

    const typeSelect = document.getElementById('proc-type') as HTMLSelectElement;
    typeSelect.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value;
        document.getElementById('fields-notification')!.style.display = val === 'Notificação' ? 'block' : 'none';
        document.getElementById('fields-infraction')!.style.display = val === 'Auto de Infração' ? 'block' : 'none';
    });

    // Cálculo Prazo
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

    // Cálculo UFIV
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

    // Salvar Processo (Create/Update com validação OWASP implícita via Supabase client parameterization)
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
        loadDashboard();
    });

    // Relatórios PDF
    document.getElementById('nav-reports')?.addEventListener('click', generatePDFReport);
}

// Geração de PDF nativo
async function generatePDFReport() {
    const { data: processes } = await supabase.from('processes').select('*');
    const doc = new jsPDF();
    doc.text('Relatório Geral de Processos', 14, 15);
    
    const tableData = processes?.map(p => [
        p.process_number,
        p.status,
        p.type,
        p.type === 'Auto de Infração' ? `R$ ${p.total_brl}` : p.due_date || '-'
    ]);

    (doc as any).autoTable({
        startY: 25,
        head: [['Processo', 'Situação', 'Tipo', 'Prazo/Valor']],
        body: tableData,
    });
    
    doc.save('relatorio-processos.pdf');
}

// Boot
initApp();